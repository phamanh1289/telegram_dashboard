import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.staticfiles import StaticFiles

from .agent import AgentRunner
from .ai import (
    AiService,
    delete_task_files,
    grant_problem,
    open_task,
    pick_folder,
    read_task_prompt,
    read_task_result,
    task_result_path,
    terminal_read,
    terminal_send,
)
from .auth import LocalGuardMiddleware
from .config import Settings
from .digest import DigestService
from .errors import ApiError
from .events import Hub, event_stream
from .models import (
    AiDraftRequest,
    AiPermissionRequest,
    AiPermissionResponse,
    AiResult,
    AiSummaryRequest,
    ChangesPage,
    DigestConsent,
    DigestConsentRequest,
    DigestRequest,
    DigestResult,
    HistoryPage,
    BriefingItem,
    SavedDigest,
    ChatsResponse,
    HandledAllResponse,
    HandledRequest,
    MessageDTO,
    MessagesPage,
    OutboxDTO,
    PendingItem,
    ProjectDTO,
    ProjectRequest,
    ReplyRequest,
    RuleAdded,
    RuleDTO,
    RuleRequest,
    PinRequest,
    SnoozeRequest,
    StatusDTO,
    TaskDTO,
    TaskInput,
    TaskMessage,
    TaskRequest,
    YouTrackIssue,
    YouTrackRequest,
    to_dto,
)
from .storage import Db, Store, parse_cursor
from .telegram import TelegramBridge, Transport
from .youtrack import create_issue
from .yt_dashboard import YouTrackDashboard, YtError, build_router

FAILED_STATUS = {"retry_after": 429, "forbidden": 403, "reply_not_found": 404, "not_connected": 503}


def _int_or_404(value: str, code: str = "reply_not_found") -> int:
    try:
        return int(value)
    except ValueError:
        raise ApiError(404, code) from None


def create_app(
    settings: Settings,
    *,
    transport: Transport | None = None,
    store: Store | None = None,
) -> FastAPI:
    """Build the app. Nothing here touches Telegram; the lifespan starts the bridge."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.ensure_data_dir()
        st = store or Store(settings.db_path)
        hub = Hub()
        db = Db(st, hub)
        await db.write(st.outbox_recover)
        t = transport
        if t is None and settings.telegram_configured:
            from .telegram import TelethonTransport

            t = TelethonTransport(settings)
        bridge = TelegramBridge(st, db, t, notify=settings.notify)
        app.state.store, app.state.hub, app.state.db, app.state.bridge = st, hub, db, bridge
        app.state.ai = AiService(settings, st, db)
        app.state.digest = DigestService(settings, st, db, bridge, app.state.ai)
        app.state.agent = AgentRunner(settings)
        await bridge.start()
        try:
            yield
        finally:
            await yt_dashboard.aclose()
            await app.state.agent.stop_all()
            await bridge.stop()

    yt_dashboard = YouTrackDashboard(settings)
    app = FastAPI(title="Telegram Dashboard", lifespan=lifespan)
    app.add_middleware(
        LocalGuardMiddleware, host_header=settings.host_header, app_origin=settings.app_origin
    )

    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError):
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        body = {"code": e.code, "retry_after": e.retry_after, "detail": e.detail}
        return JSONResponse({"error": body}, status_code=e.status, headers=headers)

    @app.exception_handler(YtError)
    async def yt_error(_: Request, e: YtError):
        return JSONResponse({"error": e.message}, status_code=e.status)  # the YouTrack UI reads a string

    app.include_router(build_router(yt_dashboard), include_in_schema=False)

    def S(request: Request):
        return request.app.state

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/status")
    async def status(request: Request) -> StatusDTO:
        s = S(request)
        cursor = await s.db.read(s.store.current_cursor)
        state = s.bridge.state
        if state == "setup_required" and settings.telegram_configured:
            state = "login_required"
        return StatusDTO(
            state=state,
            detail=s.bridge.detail,
            ai_configured=settings.ai_configured,
            ai_require_consent=settings.ai_require_consent,
            youtrack_configured=settings.youtrack_configured,
            db_epoch=cursor.rpartition(":")[0],
            cursor=cursor,
        )

    @app.get("/api/chats")
    async def chats(
        request: Request, since: datetime | None = None, until: datetime | None = None
    ) -> ChatsResponse:
        s = S(request)
        items, cursor = await s.db.read(s.store.list_chats, since, until)
        out = [c for c in items if c.tracking]
        for c in out:
            c.sync_state = s.bridge.sync_state.get(c.chat_id, "idle")
        return ChatsResponse(items=out, snapshot_cursor=cursor)

    @app.delete("/api/chats/{chat_id}/data", status_code=204)
    async def purge(chat_id: str, request: Request) -> None:
        s = S(request)
        task = s.bridge._tasks.pop(chat_id, None)
        if task:
            task.cancel()
        await s.db.write(s.store.purge_chat, chat_id)

    @app.get("/api/chats/{chat_id}/messages")
    async def messages(
        chat_id: str,
        request: Request,
        before: str | None = None,
        after: str | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        q: Annotated[str | None, Query(max_length=200)] = None,
        since: datetime | None = None,
        until: datetime | None = None,
        pending: bool = False,
    ) -> MessagesPage:
        s = S(request)
        items, cursor, has_more = await s.db.read(
            s.store.query_messages,
            chat_id,
            before=None if before is None else _int_or_404(before, "invalid_cursor"),
            after=None if after is None else _int_or_404(after, "invalid_cursor"),
            limit=limit,
            q=q or None,
            since=since,
            until=until,
            pending=pending,
        )
        return MessagesPage(items=items, snapshot_cursor=cursor, has_more=has_more)

    @app.put("/api/chats/{chat_id}/messages/{message_id}/handled", status_code=204)
    async def handled(
        chat_id: str, message_id: str, body: HandledRequest, request: Request
    ) -> None:
        s = S(request)
        mid = _int_or_404(message_id, "message_not_found")
        if await s.db.read(s.store.get_message, chat_id, mid) is None:
            raise ApiError(404, "message_not_found")
        await s.db.write(s.store.set_handled, chat_id, mid, body.handled)

    @app.post("/api/chats/{chat_id}/handled-all")
    async def handled_all(
        chat_id: str,
        request: Request,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> HandledAllResponse:
        s = S(request)
        n = await s.db.write(s.store.mark_all_handled, chat_id, since, until)
        return HandledAllResponse(count=n)

    @app.get("/api/changes")
    async def changes(
        request: Request,
        cursor: str,
        limit: Annotated[int, Query(ge=1, le=500)] = 200,
    ) -> ChangesPage:
        s = S(request)
        items, nxt, has_more, reset = await s.db.read(s.store.changes_since, cursor, limit)
        return ChangesPage(items=items, next_cursor=nxt, has_more=has_more, reset=reset)

    @app.get("/api/events", response_class=EventSourceResponse)
    async def events(
        request: Request,
            cursor: str | None = None,
        last_event_id: Annotated[str | None, Header()] = None,
    ):
        s = S(request)
        start = last_event_id or cursor
        if start is not None and parse_cursor(start) is None:
            start = "invalid"  # forces a reset event

        async def alive() -> bool:
            return not await request.is_disconnected()

        def bridge_status() -> dict:
            return {"state": s.bridge.state, "sync": dict(sorted(s.bridge.sync_state.items()))}

        yield ServerSentEvent(retry=3000, comment="open")
        async for ev in event_stream(s.store, s.hub, start, alive=alive, status=bridge_status):
            yield ev

    @app.post("/api/messages/reply", responses={202: {"model": OutboxDTO}})
    async def reply(
        body: ReplyRequest, request: Request, response: Response
    ) -> OutboxDTO:
        rec = await S(request).bridge.submit_reply(body)
        if rec.status == "failed":
            code = rec.error_code or "send_failed"
            raise ApiError(FAILED_STATUS.get(code, 502), code, retry_after=rec.retry_after)
        if rec.status != "sent":
            response.status_code = 202
        return rec

    @app.get("/api/outbox/{request_id}")
    async def outbox(request_id: str, request: Request) -> OutboxDTO:
        s = S(request)
        rec = await s.db.read(s.store.outbox_get, request_id)
        if rec is None:
            raise ApiError(404, "not_found")
        return rec

    @app.put("/api/chats/{chat_id}/ai-permission")
    async def ai_permission(
        chat_id: str, body: AiPermissionRequest, request: Request
    ) -> AiPermissionResponse:
        s = S(request)
        if not await s.db.read(s.store.is_tracking, chat_id):
            raise ApiError(409, "not_tracking")
        now = datetime.now(UTC)
        granted, rejected = [], {}
        for g in body.grants:
            mid = _int_or_404(g.message_id, "message_not_found")
            msg = await s.db.read(s.store.get_message, chat_id, mid)
            problem = grant_problem(msg, g, now)
            if problem:
                rejected[g.message_id] = problem
                continue
            await s.db.write(s.store.put_grant, chat_id, mid, g.scope, g.expires_at, g.participants)
            granted.append(g.message_id)
        revoke = [_int_or_404(i, "message_not_found") for i in body.revoke_message_ids]
        if revoke:
            await s.db.write(s.store.revoke_grants, chat_id, revoke)
        return AiPermissionResponse(
            granted=granted, revoked=body.revoke_message_ids, rejected=rejected
        )

    @app.post("/api/ai/draft")
    async def ai_draft(body: AiDraftRequest, request: Request) -> AiResult:
        s = S(request)
        nearby, images = None, []
        if not settings.ai_require_consent:  # extras carry no consent grants
            ids = [_int_or_404(i, "message_not_found") for i in body.message_ids]
            msgs, _c = await s.db.read(s.store.get_messages_by_ids, body.chat_id, ids)
            for m in msgs:
                photo = m.media_kind == "photo" and await _photo(request, m.chat_id, m.message_id)
                if photo:
                    images.append(photo)
            if body.with_context and len(ids) == 1 and s.bridge.state == "connected":
                try:
                    nearby = await s.bridge.fetch_context(body.chat_id, ids[0])
                except Exception:
                    nearby = None  # context is a bonus; draft from the tag alone
        return await s.ai.run(
            "draft", body.chat_id, body.message_ids, body.instruction, body.project,
            nearby=nearby, images=images, platform=body.platform,
        )  # fmt: skip

    @app.post("/api/ai/summary")
    async def ai_summary(body: AiSummaryRequest, request: Request) -> AiResult:
        return await S(request).ai.run("summary", body.chat_id, body.message_ids)

    # ---- Digest: chat-wide consent, live history, structured summary ------------
    async def _known_chat(s, chat_id: str) -> None:
        if await s.db.read(s.store.get_chat, chat_id) is None:
            raise ApiError(404, "chat_not_found")

    async def _consent(s, chat_id: str) -> DigestConsent:
        exp = await s.db.read(s.store.get_digest_consent, chat_id)
        at = None if exp is None else datetime.fromtimestamp(exp, UTC)
        return DigestConsent(enabled=at is not None, expires_at=at)

    @app.get("/api/chats/{chat_id}/digest-consent")
    async def get_digest_consent(chat_id: str, request: Request) -> DigestConsent:
        s = S(request)
        await _known_chat(s, chat_id)
        return await _consent(s, chat_id)

    @app.put("/api/chats/{chat_id}/digest-consent")
    async def put_digest_consent(
        chat_id: str, body: DigestConsentRequest, request: Request
    ) -> DigestConsent:
        s = S(request)
        await _known_chat(s, chat_id)
        exp = datetime.now(UTC) + timedelta(days=body.days) if body.enabled else None
        await s.db.write(s.store.set_digest_consent, chat_id, exp)
        return await _consent(s, chat_id)

    @app.get("/api/chats/{chat_id}/history")
    async def history(
        chat_id: str,
        request: Request,
        since: datetime,
        until: datetime | None = None,
        limit: Annotated[int, Query(ge=1, le=400)] = 400,
    ) -> HistoryPage:
        """Live from Telegram, not stored: the Digest view reads and picks from this."""
        s = S(request)
        await _known_chat(s, chat_id)
        aware = lambda d: d if d.tzinfo else d.replace(tzinfo=UTC)  # noqa: E731
        msgs = await s.bridge.fetch_range(
            chat_id, aware(since), aware(until) if until else datetime.now(UTC), limit + 1
        )
        return HistoryPage(items=[to_dto(m) for m in msgs[-limit:]], truncated=len(msgs) > limit)

    @app.get("/api/chats/{chat_id}/digest")
    async def saved_digest(chat_id: str, request: Request) -> SavedDigest | None:
        """Latest digest of this chat and how far digests have read (null when none)."""
        s = S(request)
        await _known_chat(s, chat_id)
        return _saved(await s.db.read(s.store.get_digest, chat_id))

    def _saved(d: dict | None) -> SavedDigest | None:
        if d is None:
            return None
        return SavedDigest(
            result=DigestResult.model_validate_json(d["result"]),
            created_at=datetime.fromtimestamp(d["created_at"], UTC),
            last_message_id=str(d["last_message_id"]),
            last_date=datetime.fromtimestamp(d["last_date"], UTC),
        )

    @app.get("/api/briefing")
    async def briefing(request: Request) -> list[BriefingItem]:
        """Every tracked group with its Digest state; latest_id tells whether there is news."""
        s = S(request)
        out = []
        for chat_id in await s.db.read(s.store.tracked_chat_ids):
            chat = await s.db.read(s.store.get_chat, chat_id)
            consent = await s.db.read(s.store.get_digest_consent, chat_id) is not None
            latest = None
            if consent and s.bridge.state == "connected":  # only groups the AI may read
                try:
                    latest = str(await s.bridge.transport.latest_id(chat_id))
                except Exception:
                    pass  # one unreachable group must not hide the others
            out.append(BriefingItem(
                chat_id=chat_id, title=chat["title"], consent=consent, latest_id=latest,
                saved=_saved(await s.db.read(s.store.get_digest, chat_id)),
            ))  # fmt: skip
        return out

    @app.post("/api/digest")
    async def digest(body: DigestRequest, request: Request) -> DigestResult:
        return await S(request).digest.run(body)

    @app.get("/api/projects")
    async def projects(request: Request) -> list[ProjectDTO]:
        s = S(request)
        return [ProjectDTO(**p) for p in await s.db.read(s.store.list_projects)]

    async def _add_project(request: Request, raw: str) -> ProjectDTO:
        s = S(request)
        path = Path(raw.strip()).expanduser().resolve()
        if not path.is_dir():
            raise ApiError(422, "project_not_a_directory")
        await s.db.write(s.store.add_project, str(path), path.name)
        return ProjectDTO(path=str(path), name=path.name)

    @app.post("/api/projects")
    async def add_project(body: ProjectRequest, request: Request) -> ProjectDTO:
        return await _add_project(request, body.path)

    @app.post("/api/projects/pick", responses={204: {"description": "Cancelled"}})
    async def pick_project(request: Request, response: Response) -> ProjectDTO | None:
        path = await pick_folder()
        if path is None:
            response.status_code = 204
            return None
        return await _add_project(request, path)

    @app.delete("/api/projects", status_code=204)
    async def remove_project(path: str, request: Request) -> None:
        s = S(request)
        await s.db.write(s.store.remove_project, path)

    @app.post("/api/tasks", status_code=204)
    async def task(body: TaskRequest, request: Request) -> None:
        s = S(request)
        if not await s.db.read(s.store.has_project, body.project):
            raise ApiError(404, "project_not_found")
        task_id = f"{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
        mid = None if body.message_id is None else _int_or_404(body.message_id, "message_not_found")
        tty = session = None
        if body.mode == "terminal":
            tty = await open_task(settings, body.project, body.prompt, task_id)
        else:
            if not s.agent.available:
                raise ApiError(422, "ai_agent_missing")
            session = s.agent.new_session()
            await s.agent.start(task_id, body.project, body.prompt, body.mode, session, False)
        await s.db.write(
            s.store.add_task, task_id, body.chat_id, mid, body.project, body.prompt, tty,
            body.mode, session,
        )  # fmt: skip

    @app.get("/api/tasks")
    async def tasks(request: Request, chat_id: str | None = None) -> list[TaskDTO]:
        s = S(request)
        rows = await s.db.read(s.store.list_tasks, chat_id)
        return [
            TaskDTO(
                id=r["id"], chat_id=r["chat_id"],
                message_id=None if r["message_id"] is None else str(r["message_id"]),
                project=r["project"], created_at=r["created_at"],
                result=read_task_result(settings, r["id"]),
                prompt=r["prompt"] or read_task_prompt(settings, r["id"]),
                interactive=bool(r["tty"]), mode=r["mode"],
                running=S(request).agent.running(r["id"]) if r["mode"] != "terminal"
                else read_task_result(settings, r["id"]) is None,
                chat_title=r["chat_title"], sender_name=r["sender_name"],
                message_text=r["message_text"],
            )
            for r in rows
        ]  # fmt: skip

    @app.post("/api/tasks/{task_id}/reopen", status_code=204)
    async def reopen_task(task_id: str, request: Request) -> None:
        """Run the same task again in a fresh Terminal; clears the old result."""
        s = S(request)
        row = await s.db.read(s.store.get_task, task_id)
        if row is None:
            raise ApiError(404, "task_not_found")
        prompt = row["prompt"] or read_task_prompt(settings, task_id)
        if not prompt:
            raise ApiError(404, "task_not_found")
        await s.agent.stop(task_id)
        delete_task_files(settings, task_id)
        s.agent.log_path(task_id).unlink(missing_ok=True)
        if row["mode"] == "terminal":
            tty = await open_task(settings, row["project"], prompt, task_id)
            await s.db.write(s.store.set_task_tty, task_id, tty)
        else:
            session = s.agent.new_session()
            await s.agent.start(task_id, row["project"], prompt, row["mode"], session, False)
            await s.db.write(s.store.set_task_session, task_id, session)

    @app.get("/api/tasks/{task_id}/events")
    async def task_events(task_id: str, request: Request, after: int = 0) -> dict:
        """Conversation log of a headless task; poll with the returned `next`."""
        s = S(request)
        row = await s.db.read(s.store.get_task, task_id)
        if row is None:
            raise ApiError(404, "task_not_found")
        items, total = s.agent.read(task_id, after)
        return {"items": items, "next": total, "total": total, "running": s.agent.running(task_id)}

    @app.post("/api/tasks/{task_id}/message", status_code=204)
    async def task_message(task_id: str, body: TaskMessage, request: Request) -> None:
        """Follow-up turn in a headless task (resumes the same session)."""
        s = S(request)
        row = await s.db.read(s.store.get_task, task_id)
        if row is None or row["mode"] == "terminal" or not row["session_id"]:
            raise ApiError(404, "task_not_found")
        if s.agent.running(task_id):
            raise ApiError(409, "task_busy")
        await s.agent.start(task_id, row["project"], body.text, row["mode"], row["session_id"], True)

    @app.post("/api/tasks/{task_id}/stop", status_code=204)
    async def task_stop(task_id: str, request: Request) -> None:
        await S(request).agent.stop(task_id)

    async def _task_tty(s, task_id: str) -> str:
        row = await s.db.read(s.store.get_task, task_id)
        if row is None:
            raise ApiError(404, "task_not_found")
        return row["tty"] or ""

    @app.get("/api/tasks/{task_id}/terminal")
    async def task_terminal(task_id: str, request: Request) -> dict[str, str]:
        """Live text of the task's Terminal tab."""
        return {"text": await terminal_read(await _task_tty(S(request), task_id))}

    @app.post("/api/tasks/{task_id}/capture", status_code=204)
    async def task_capture(task_id: str, request: Request) -> None:
        """No result file (the agent never wrote one): use the Terminal's output as the report."""
        text = await terminal_read(await _task_tty(S(request), task_id), 8000)
        path = task_result_path(settings, task_id)
        path.write_text("(Trích từ Terminal)\n" + text)
        path.chmod(0o600)

    @app.post("/api/tasks/{task_id}/input", status_code=204)
    async def task_input(task_id: str, body: TaskInput, request: Request) -> None:
        """Type a line into the task's Terminal tab (answer a prompt, give a follow-up)."""
        await terminal_send(await _task_tty(S(request), task_id), body.text)

    @app.delete("/api/tasks/{task_id}", status_code=204)
    async def delete_task(task_id: str, request: Request) -> None:
        s = S(request)
        await s.agent.stop(task_id)
        if not await s.db.write(s.store.delete_task, task_id):
            raise ApiError(404, "task_not_found")
        delete_task_files(settings, task_id)
        s.agent.log_path(task_id).unlink(missing_ok=True)

    # ---- inbox helpers -----------------------------------------------------
    @app.get("/api/pending")
    async def pending(
        request: Request, since: datetime | None = None, until: datetime | None = None
    ) -> list[PendingItem]:
        s = S(request)
        rows = await s.db.read(s.store.list_pending, since, until)
        return [PendingItem(chat_title=t, message=m) for t, m in rows]

    @app.get("/api/pinned")
    async def pinned(request: Request) -> list[PendingItem]:
        s = S(request)
        return [PendingItem(chat_title=t, message=m) for t, m in await s.db.read(s.store.list_pinned)]

    @app.put("/api/chats/{chat_id}/messages/{message_id}/snooze", status_code=204)
    async def snooze(chat_id: str, message_id: str, body: SnoozeRequest, request: Request) -> None:
        s = S(request)
        mid = _int_or_404(message_id, "message_not_found")
        if not await s.db.write(s.store.set_snooze, chat_id, mid, body.until):
            raise ApiError(404, "message_not_found")

    @app.put("/api/chats/{chat_id}/messages/{message_id}/pin", status_code=204)
    async def pin(chat_id: str, message_id: str, body: PinRequest, request: Request) -> None:
        s = S(request)
        mid = _int_or_404(message_id, "message_not_found")
        if not await s.db.write(s.store.set_pinned, chat_id, mid, body.pinned):
            raise ApiError(404, "message_not_found")

    @app.get("/api/chats/{chat_id}/messages/{message_id}/context")
    async def context(chat_id: str, message_id: str, request: Request) -> list[MessageDTO]:
        s = S(request)
        mid = _int_or_404(message_id, "message_not_found")
        if await s.db.read(s.store.get_message, chat_id, mid) is None:
            raise ApiError(404, "message_not_found")  # only around tags we keep
        return [to_dto(m) for m in await s.bridge.fetch_context(chat_id, mid)]

    async def _photo(request: Request, chat_id: str, mid: int) -> Path | None:
        """Cached copy of a kept tag's photo, downloaded on first use."""
        s = S(request)
        m = await s.db.read(s.store.get_message, chat_id, mid)
        if m is None or m.media_kind != "photo":
            return None
        media = settings.data_dir / "media"
        media.mkdir(mode=0o700, exist_ok=True)
        dest = media / f"{chat_id.lstrip('-')}_{mid}.jpg"
        if not dest.is_file():
            if s.bridge.state != "connected":
                return None
            try:
                if not await s.bridge.download_photo(chat_id, mid, dest):
                    return None
            except Exception:
                return None
        return dest

    @app.get("/api/chats/{chat_id}/messages/{message_id}/photo", response_class=FileResponse)
    async def photo(chat_id: str, message_id: str, request: Request):
        p = await _photo(request, chat_id, _int_or_404(message_id, "message_not_found"))
        if p is None:
            raise ApiError(404, "photo_not_available")
        return FileResponse(p, media_type="image/jpeg")

    # ---- auto-handle rules ---------------------------------------------------
    @app.get("/api/rules")
    async def rules(request: Request) -> list[RuleDTO]:
        s = S(request)
        return [RuleDTO(**r) for r in await s.db.read(s.store.list_rules)]

    @app.post("/api/rules")
    async def add_rule(body: RuleRequest, request: Request) -> RuleAdded:
        s = S(request)
        rule, n = await s.db.write(s.store.add_rule, body.kind, body.value, body.label)
        return RuleAdded(rule=RuleDTO(**rule), handled=n)

    @app.delete("/api/rules/{rule_id}", status_code=204)
    async def remove_rule(rule_id: int, request: Request) -> None:
        s = S(request)
        await s.db.write(s.store.remove_rule, rule_id)

    # ---- YouTrack ------------------------------------------------------------
    @app.post("/api/youtrack/issues")
    async def youtrack_issue(body: YouTrackRequest) -> YouTrackIssue:
        if not settings.youtrack_configured:
            raise ApiError(503, "youtrack_not_configured")
        issue_id, url = await create_issue(settings, body.summary, body.description)
        return YouTrackIssue(id=issue_id, url=url)

    @app.api_route(
        "/api/{rest:path}",
        methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        include_in_schema=False,
    )
    async def api_404(rest: str):
        raise ApiError(404, "not_found")

    if settings.static_dir.is_dir():
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="web")
    else:

        @app.get("/", include_in_schema=False)
        async def no_build():
            return JSONResponse(
                {"error": {"code": "web_not_built", "detail": "Run `npm run build` first."}},
                status_code=503,
            )

    return app
