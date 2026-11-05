import asyncio
import contextlib
import logging
import re
import time
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.staticfiles import StaticFiles
from telethon import errors as tg_errors

from . import providers, updater
from .agent import AgentRunner
from .ai import AiService, client_gone, parse_ticket, pick_folder, stream_answer
from .auth import LocalGuardMiddleware
from .claude import (
    claude_account,
    claude_login,
    claude_login_code,
    claude_logout,
    claude_runs,
    refresh_usage,
)
from .config import Settings, write_private_json
from .digest import DigestService, aware
from .errors import ApiError, int_or_404
from .events import Hub, event_stream
from .models import (
    AiAccount,
    AiCatalogEntry,
    AiDeepRequest,
    AiDraftRequest,
    AiGuideRequest,
    AiLoginStarted,
    AiPrefs,
    AiProvider,
    AiResult,
    AiRun,
    AiTestRequest,
    AiTestResult,
    AiTicketDraft,
    AiTicketRequest,
    BriefingItem,
    ChangesPage,
    ChatsResponse,
    ClaudeAccount,
    ClaudeLoginCode,
    ClaudeLoginStarted,
    ConsentPref,
    DigestConsent,
    DigestConsentRequest,
    DigestRequest,
    DigestResult,
    GroupInfo,
    HandledAllResponse,
    HandledRequest,
    HistoryPage,
    MessageDTO,
    MessagesPage,
    OutboxDTO,
    PendingItem,
    PinRequest,
    ProjectDTO,
    ProjectRequest,
    ReplyRequest,
    RuleAdded,
    RuleDTO,
    RuleRequest,
    SavedDigest,
    SnoozeRequest,
    StatusDTO,
    TelegramApp,
    TelegramPhone,
    TelegramSignIn,
    TelegramSignInResult,
    YouTrackAuth,
    YouTrackIssue,
    YouTrackRequest,
    YouTrackUser,
    to_dto,
)
from .storage import Db, Store, _dt, parse_cursor
from .tasks import build_router as build_task_router
from .tasks import new_task_id, start_task
from .telegram import TelegramBridge, Transport
from .yt_dashboard import YouTrackDashboard, YtError, build_router, whoami

log = logging.getLogger("telegram_dashboard.app")
FAILED_STATUS = {"retry_after": 429, "forbidden": 403, "reply_not_found": 404, "not_connected": 503}
LIVE_READS = 4  # parallel Telegram calls in /api/briefing


GUIDE_PROMPT = (
    "Bạn là trợ lý hướng dẫn sử dụng ứng dụng Telegram Dashboard (2 tab: Telegram và YouTrack, cùng Cài đặt). "
    "Trong <guide> là danh mục tính năng, mỗi dòng có [id], vị trí, tác dụng và các bước. Chỉ dựa vào danh mục đó; "
    "nếu không có tính năng phù hợp thì nói rõ là không thấy, đừng bịa. Trả lời tiếng Việt, ngắn gọn, markdown: "
    "nêu tính năng phù hợp nhất (tên in đậm kèm [id]), rồi các bước làm theo đánh số, ghi đúng nhãn nút/phím tắt. "
    "Có thể gợi ý thêm 1-2 tính năng liên quan."
)


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
        bridge = TelegramBridge(st, db, t, notify=settings.notify, reaction=settings.done_reaction)
        app.state.store, app.state.hub, app.state.db, app.state.bridge = st, hub, db, bridge
        app.state.ai = AiService(settings, st, db)
        app.state.ai.me = lambda: bridge.me
        app.state.digest = DigestService(settings, st, db, bridge, app.state.ai)
        app.state.agent = AgentRunner(settings)
        app.state.yt = yt_dashboard  # links.py reads YouTrack articles with its token
        await bridge.start()
        auto = asyncio.create_task(updater.auto_loop(settings, app.state.agent))
        try:
            yield
        finally:
            auto.cancel()
            # Agents and Telegram first; one failing step never skips the others.
            for step in (app.state.agent.stop_all, bridge.stop, yt_dashboard.aclose):
                try:
                    await step()
                except Exception:
                    log.warning("shutdown step %s failed", step.__name__, exc_info=True)
            with contextlib.suppress(asyncio.CancelledError):
                await auto

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

    # Live Telegram reads run with no flood sleep: say how long to wait instead of a bare 500.
    @app.exception_handler(tg_errors.FloodWaitError)
    async def flood_wait(r: Request, e: tg_errors.FloodWaitError):
        return await api_error(r, ApiError(429, "flood_wait", retry_after=e.seconds))

    @app.exception_handler(tg_errors.RPCError)
    async def telegram_error(r: Request, e: tg_errors.RPCError):
        return await api_error(r, ApiError(502, "telegram_error", detail=type(e).__name__))

    @app.exception_handler(YtError)
    async def yt_error(_: Request, e: YtError):
        return JSONResponse({"error": e.message}, status_code=e.status)  # the YouTrack UI reads a string

    app.include_router(build_router(yt_dashboard), include_in_schema=False)
    app.include_router(build_task_router(settings))
    app.include_router(updater.build_router(settings))

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
            ai_configured=s.ai.configured,
            ai_require_consent=settings.ai_require_consent,
            youtrack_configured=settings.youtrack_configured,
            telegram_api_id=settings.telegram_api_id,
            telegram_me=s.bridge.me or None,
            db_epoch=cursor.rpartition(":")[0],
            cursor=cursor,
        )

    @app.get("/api/chats")
    async def chats(
        request: Request, since: datetime | None = None, until: datetime | None = None
    ) -> ChatsResponse:
        s = S(request)
        items, cursor = await s.db.read(s.store.list_chats, since, until)
        return ChatsResponse(items=[c for c in items if c.tracking], snapshot_cursor=cursor)

    @app.delete("/api/chats/{chat_id}/data", status_code=204)
    async def purge(chat_id: str, request: Request) -> None:
        s = S(request)
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
        handled: bool = False,
    ) -> MessagesPage:
        s = S(request)
        items, cursor, has_more = await s.db.read(
            s.store.query_messages,
            chat_id,
            before=None if before is None else int_or_404(before, "invalid_cursor"),
            after=None if after is None else int_or_404(after, "invalid_cursor"),
            limit=limit,
            q=q or None,
            since=since,
            until=until,
            pending=pending,
            handled=handled,
        )
        return MessagesPage(items=items, snapshot_cursor=cursor, has_more=has_more)

    @app.get("/api/chats/{chat_id}/live")
    async def live(
        chat_id: str,
        request: Request,
        before: str | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> MessagesPage:
        """Every message of the group, live from Telegram (not stored), newest page first."""
        s = S(request)
        await _known_chat(s, chat_id)
        mid = None if before is None else int_or_404(before, "invalid_cursor")
        msgs = await s.bridge.fetch_page(chat_id, mid, limit)
        ids = [m.message_id for m in msgs]
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids) if ids else ([], "")
        tags = {k.message_id for k in kept}
        items = [to_dto(m).model_copy(update={"kept": m.message_id in tags}) for m in msgs]
        return MessagesPage(items=items, snapshot_cursor="", has_more=len(msgs) == limit)

    @app.put("/api/chats/{chat_id}/messages/{message_id}/handled", status_code=204)
    async def handled(
        chat_id: str, message_id: str, body: HandledRequest, request: Request
    ) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        if await s.db.read(s.store.get_message, chat_id, mid) is None:
            raise ApiError(404, "message_not_found")
        if await s.db.write(s.store.set_handled, chat_id, mid, body.handled) and body.react:
            s.bridge.react(chat_id, [mid], body.handled)

    @app.post("/api/chats/{chat_id}/handled-all")
    async def handled_all(
        chat_id: str,
        request: Request,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> HandledAllResponse:
        s = S(request)
        ids = await s.db.write(s.store.mark_all_handled, chat_id, since, until)
        return HandledAllResponse(count=len(ids), message_ids=ids)  # no reactions: would flood Telegram

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
            return {"state": s.bridge.state}

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

    async def _draft_extras(request: Request, body: AiDraftRequest):
        """Photos and nearby messages of a tag, for a draft or a ticket: (nearby, images).
        Consent mode: 403 up front, before anything is read."""
        s = S(request)
        s.ai.require_read()
        nearby, images = None, []
        ids = [int_or_404(i, "message_not_found") for i in body.message_ids]
        msgs, _c = await s.db.read(s.store.get_messages_by_ids, body.chat_id, ids)
        for m in msgs:
            if m.media_kind != "photo":
                continue
            if photo := await _photo(request, m.chat_id, m.message_id):
                images.append(photo)
            else:
                log.warning("draft without photo %s/%s: not available", m.chat_id, m.message_id)
        if body.with_context and len(ids) == 1 and s.bridge.state == "connected":
            try:
                nearby = await s.bridge.fetch_context(body.chat_id, ids[0])
            except Exception as e:  # context is a bonus; draft from the tag alone
                log.warning("draft without context for %s: %r", body.chat_id, e)
        return nearby, images

    @app.post("/api/ai/draft", responses={200: {
        "model": AiResult, "description": "NDJSON: delta / reset lines, then {done: AiResult}"}})
    async def ai_draft(body: AiDraftRequest, request: Request) -> StreamingResponse:
        client_gone.set(request.is_disconnected)
        nearby, images = await _draft_extras(request, body)

        async def work(on_text):
            r = await S(request).ai.run(
                "draft", body.chat_id, body.message_ids, body.instruction, body.project,
                nearby=nearby, images=images, platform=body.platform, role=body.role, on_text=on_text,
            )  # fmt: skip
            return r.model_dump()

        return stream_answer(work)

    @app.post("/api/ai/deep")
    async def ai_deep(body: AiDeepRequest, request: Request) -> dict:
        """Deep thinking on a combo (question to BE + BE's confirmation): a read-only AI Agent session."""
        s = S(request)
        if not s.agent.available:
            raise ApiError(422, "ai_agent_missing")
        fetch = s.bridge.fetch_ids if s.bridge.state == "connected" else None
        prompt, title = await s.ai.deep(body.chat_id, body.question_id, body.confirm_id, body.project,
                                        body.instruction, body.platform, fetch=fetch)  # fmt: skip
        task_id = new_task_id()
        await start_task(s, task_id, body.chat_id, int(body.confirm_id), body.project, prompt, "plan",
                         kind="deep", title=title)  # fmt: skip
        return {"id": task_id}

    @app.post("/api/ai/ticket")
    async def ai_ticket(body: AiTicketRequest, request: Request) -> AiTicketDraft:
        """A YouTrack ticket proposal (summary, Type, Priority, templated description) of a tag."""
        client_gone.set(request.is_disconnected)
        nearby, images = await _draft_extras(request, body)
        fields = {"Type": body.types, "Priority": body.priorities}
        r = await S(request).ai.run(
            "ticket", body.chat_id, body.message_ids, body.instruction, None,
            nearby=nearby, images=images, platform=body.platform, role=body.role, fields=fields,
        )  # fmt: skip
        return AiTicketDraft(**parse_ticket(r.text, fields))

    @app.post("/api/ai/guide", responses={200: {"description": "NDJSON: delta / reset lines, then {done: {text}}"}})
    async def ai_guide(body: AiGuideRequest, request: Request) -> StreamingResponse:
        """Which features answer the user's question, and how to use them: from the guide the page sends."""
        client_gone.set(request.is_disconnected)
        user = f"<guide>\n{body.guide}\n</guide>\n\nCâu hỏi của người dùng: {body.question}"

        async def work(on_text):
            return {"text": await S(request).ai.ask(user, system=GUIDE_PROMPT, on_text=on_text, feature="guide")}

        return stream_answer(work)

    # ---- Digest: chat-wide consent, live history, structured summary ------------
    async def _known_chat(s, chat_id: str) -> None:
        """Tagged or not: any group the account is in may be digested. An untagged one is
        registered untracked, so it stays out of the inbox and its messages are never kept."""
        if await s.db.read(s.store.get_chat, chat_id) is not None:
            return
        g = next((g for g in await s.bridge.list_groups() if g.chat_id == chat_id), None)
        if g is None or g.migrated:
            raise ApiError(404, "chat_not_found")
        await s.db.write(s.store.upsert_chat_info, g.chat_id, g.title, g.kind)

    @app.get("/api/groups")
    async def groups(request: Request) -> list[GroupInfo]:
        """Every Telegram group the account is in, live: Briefing adds untagged ones from here."""
        return [g for g in await S(request).bridge.list_groups() if not g.migrated]

    async def _consent(s, chat_id: str) -> DigestConsent:
        exp = await s.db.read(s.store.get_digest_consent, chat_id)
        return DigestConsent(enabled=exp is not None, expires_at=_dt(exp))

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
            created_at=_dt(d["created_at"]),
            last_message_id=str(d["last_message_id"]),
            last_date=_dt(d["last_date"]),
        )

    @app.get("/api/briefing")
    async def briefing(request: Request) -> list[BriefingItem]:
        """Tracked groups and digest-only ones, with their Digest state; latest_id tells
        whether there is news."""
        s = S(request)
        live = asyncio.Semaphore(LIVE_READS)

        async def item(row: dict) -> BriefingItem:
            latest = None
            if row["consent"] and s.bridge.state == "connected":  # only groups the AI may read
                try:
                    async with live:
                        latest = str(await s.bridge.transport.latest_id(row["chat_id"]))
                except Exception as e:  # one unreachable group must not hide the others
                    log.warning("briefing: latest id of %s unknown: %r", row["chat_id"], e)
            return BriefingItem(chat_id=row["chat_id"], title=row["title"], consent=row["consent"],
                                latest_id=latest, saved=_saved(row["digest"]))  # fmt: skip

        rows = await s.db.read(s.store.briefing_rows)
        return list(await asyncio.gather(*(item(r) for r in rows)))

    @app.post("/api/digest")
    async def digest(body: DigestRequest, request: Request) -> DigestResult:
        client_gone.set(request.is_disconnected)  # "Dừng" / leaving the page stops the claude run
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
        mid = int_or_404(message_id, "message_not_found")
        if not await s.db.write(s.store.set_snooze, chat_id, mid, body.until):
            raise ApiError(404, "message_not_found")

    @app.put("/api/chats/{chat_id}/messages/{message_id}/pin", status_code=204)
    async def pin(chat_id: str, message_id: str, body: PinRequest, request: Request) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        if not await s.db.write(s.store.set_pinned, chat_id, mid, body.pinned):
            raise ApiError(404, "message_not_found")

    @app.get("/api/chats/{chat_id}/messages/{message_id}/context")
    async def context(chat_id: str, message_id: str, request: Request) -> list[MessageDTO]:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        if await s.db.read(s.store.get_message, chat_id, mid) is None:
            raise ApiError(404, "message_not_found")  # only around tags we keep
        live = await s.bridge.fetch_context(chat_id, mid)
        # Live copies don't know which of them are kept tags marked done: take that from the store.
        ids = [m.message_id for m in live]
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids) if ids else ([], "")
        done = {k.message_id for k in kept if k.handled}
        return [to_dto(m.model_copy(update={"handled": m.message_id in done})) for m in live]

    @app.get("/api/chats/{chat_id}/messages/{message_id}")
    async def one_message(chat_id: str, message_id: str, request: Request) -> MessageDTO:
        """One message by id (a ref pasted into an AI Agent session): the kept copy, else live from
        Telegram. Consent mode: 403, its text is for the AI."""
        s = S(request)
        s.ai.require_read()
        mid = int_or_404(message_id, "message_not_found")
        if not 0 < mid < 2**31:  # Telegram ids are int32
            raise ApiError(404, "message_not_found")
        m = await s.db.read(s.store.get_message, chat_id, mid)
        if m is None:
            await _known_chat(s, chat_id)
            m = next(iter(await s.bridge.fetch_ids(chat_id, [mid])), None)
        if m is None or m.deleted:
            raise ApiError(404, "message_not_found")
        return to_dto(m)

    @app.get("/api/chats/{chat_id}/messages/{message_id}/before")
    async def before(
        chat_id: str, message_id: str, request: Request, reply_to: int | None = None
    ) -> list[MessageDTO]:
        """Live, not stored: Deep thinking's question candidates for a BE answer (see fetch_before)."""
        s = S(request)
        await _known_chat(s, chat_id)
        mid = int_or_404(message_id, "message_not_found")
        return [to_dto(m) for m in await s.bridge.fetch_before(chat_id, mid, reply_to)]

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
            except Exception as e:
                log.warning("photo %s/%s not downloaded: %r", chat_id, mid, e)
                return None
        return dest

    @app.get("/api/chats/{chat_id}/messages/{message_id}/photo", response_class=FileResponse)
    async def photo(chat_id: str, message_id: str, request: Request):
        p = await _photo(request, chat_id, int_or_404(message_id, "message_not_found"))
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

    # ---- Claude account (the CLI's login) --------------------------------------
    @app.get("/api/claude/account")
    async def claude_status() -> ClaudeAccount:
        return ClaudeAccount(**await claude_account(settings))

    @app.post("/api/claude/login")
    async def claude_start_login() -> ClaudeLoginStarted:
        return ClaudeLoginStarted(url=await claude_login(settings))

    @app.post("/api/claude/login/code", status_code=204)
    async def claude_finish_login(body: ClaudeLoginCode) -> None:
        await claude_login_code(body.code)

    @app.post("/api/claude/refresh")
    async def claude_refresh() -> ClaudeAccount:
        """Read the quota again now instead of from the 3-minute cache."""
        refresh_usage()
        return ClaudeAccount(**await claude_account(settings))

    @app.post("/api/claude/logout", status_code=204)
    async def claude_sign_out() -> None:
        await claude_logout(settings)

    # ---- AI: the picked CLI, each CLI's picks and catalog, the run log ----------
    @app.get("/api/ai/prefs")
    async def get_ai_prefs() -> AiPrefs:
        return AiPrefs(**providers.prefs(settings))

    @app.put("/api/ai/prefs")
    async def put_ai_prefs(body: AiPrefs) -> AiPrefs:
        providers.save_prefs(settings, body.model_dump())
        return AiPrefs(**providers.prefs(settings))

    @app.get("/api/ai/catalog")
    async def ai_catalog() -> list[AiCatalogEntry]:
        return [AiCatalogEntry(**c) for c in providers.catalog(settings)]

    @app.get("/api/ai/runs")
    async def get_ai_runs(days: Annotated[int, Query(ge=1, le=90)] = 30) -> list[AiRun]:
        return [AiRun(**r) for r in await asyncio.to_thread(claude_runs, settings, days)]

    @app.post("/api/ai/test")
    async def ai_test(body: AiTestRequest, request: Request) -> AiTestResult:
        """One tiny run on the picked CLI and model: does it answer, and how fast."""
        t0 = time.monotonic()
        text = await S(request).ai.ask("Reply with exactly: OK", system="", heavy=body.task, feature="test")
        return AiTestResult(text=text[:200], ms=round((time.monotonic() - t0) * 1000))

    @app.get("/api/ai/accounts")
    async def ai_accounts(fresh: bool = False) -> list[AiAccount]:
        """Codex and Antigravity logins and quotas (Claude has its own /api/claude/account); `fresh`
        reads the quotas now instead of from the last few minutes."""
        got = await asyncio.gather(*(providers.account(settings, p, fresh) for p in providers.OTHERS))
        return [AiAccount(**a) for a in got]

    @app.post("/api/ai/{provider}/login")
    async def ai_login(provider: AiProvider) -> AiLoginStarted:
        if provider == "claude":
            raise ApiError(404, "not_found")
        return AiLoginStarted(url=await providers.login(settings, provider))

    @app.post("/api/ai/{provider}/logout", status_code=204)
    async def ai_logout(provider: AiProvider) -> None:
        if provider == "claude":
            raise ApiError(404, "not_found")
        await providers.logout(settings, provider)

    # ---- Settings: Telegram account + consent (data/config.json, wins over .env) ----
    @app.put("/api/telegram/app", status_code=204)
    async def telegram_app(body: TelegramApp, request: Request) -> None:
        """Save the API ID/hash from my.telegram.org and reconnect with them."""
        nonlocal settings
        from .telegram import TelethonTransport

        settings.ensure_data_dir()
        settings.save_config(telegram_api_id=body.api_id, telegram_api_hash=body.api_hash)
        settings = replace(settings, telegram_api_id=body.api_id, telegram_api_hash=body.api_hash)
        await S(request).bridge.set_transport(TelethonTransport(settings))

    def _login_transport(request: Request):
        t = S(request).bridge.transport
        if t is None or not hasattr(t, "sign_in"):
            raise ApiError(409, "telegram_not_configured")
        return t

    @app.post("/api/telegram/code", status_code=204)
    async def telegram_code(body: TelegramPhone, request: Request) -> None:
        await _login_transport(request).send_code(body.phone.replace(" ", ""))

    @app.post("/api/telegram/sign-in")
    async def telegram_sign_in(body: TelegramSignIn, request: Request) -> TelegramSignInResult:
        if not await _login_transport(request).sign_in(body.code, body.password):
            return TelegramSignInResult(password_required=True)
        session = Path(f"{settings.session_path}.session")
        if session.exists():
            session.chmod(0o600)
        await S(request).bridge.start()  # the run loop stopped at login_required
        return TelegramSignInResult(password_required=False)

    @app.put("/api/settings/consent", status_code=204)
    async def set_consent(body: ConsentPref, request: Request) -> None:
        nonlocal settings
        settings.ensure_data_dir()
        settings.save_config(ai_require_consent=body.ai_require_consent)
        settings = replace(settings, ai_require_consent=body.ai_require_consent)
        ai = S(request).ai
        ai.settings = replace(ai.settings, ai_require_consent=body.ai_require_consent)

    # ---- YouTrack ------------------------------------------------------------
    @app.put("/api/youtrack/auth")
    async def youtrack_auth(body: YouTrackAuth) -> YouTrackUser:
        """Check a pasted URL + token with YouTrack, keep it in data/ (0600), use it now."""
        nonlocal settings
        url = body.url.rstrip("/")
        user = await whoami(url, body.token)
        settings.ensure_data_dir()
        write_private_json(settings.youtrack_path, {"url": url, "token": body.token})
        settings = replace(settings, youtrack_url=url, youtrack_token=body.token)
        yt_dashboard.set_auth(url, body.token)
        return YouTrackUser(**user)

    @app.post("/api/youtrack/issues")
    async def youtrack_issue(body: YouTrackRequest, request: Request) -> YouTrackIssue:
        if not settings.youtrack_configured:
            raise ApiError(503, "youtrack_not_configured")
        project = body.project or settings.youtrack_project
        if not project:
            raise ApiError(422, "youtrack_project_not_found")
        issue_id, url = await yt_dashboard.create_issue(body.summary, body.description, project, body.markdown)
        sets = (("Type", body.type), ("Priority", body.priority), ("Assignee", body.assignee))
        cmd = " ".join(f"{k} {{{v}}}" for k, v in sets if v)
        warning = ""
        if cmd:
            post = {"query": cmd, "issues": [{"idReadable": issue_id}]}
            try:
                await yt_dashboard.yt("/api/commands", post=post, fields="id")
            except YtError as e:
                log.warning("ticket %s created, fields not set: %s", issue_id, e.message)
                warning = f"Chưa đặt được Type / Priority / Assignee: {e.message}."
        if body.chat_id and body.message_id:  # the tag's screenshot goes with the bug report
            photo = await _photo(request, body.chat_id, int(body.message_id))
            if photo is not None:
                try:
                    await yt_dashboard.attach(issue_id, photo)
                except YtError as e:
                    log.warning("ticket %s created, photo not attached: %s", issue_id, e.message)
                    warning = f"{warning} Không đính kèm được ảnh.".strip()
        yt_dashboard.stale()  # the YouTrack page shows it on its next refresh
        return YouTrackIssue(id=issue_id, url=url, warning=warning)

    @app.get("/api/youtrack/similar")
    async def youtrack_similar(q: str, project: str = "") -> list[YouTrackIssue]:
        """Open tickets whose text matches q (YouTrack's own relevance), to spot a duplicate."""
        words = re.findall(r"\w{3,}", q)[:8]  # plain words only: query syntax chars never reach YQL
        project = re.sub(r"[^\w-]", "", project) or settings.youtrack_project
        if not settings.youtrack_configured or not words or not project:
            return []
        query = f"project: {project} #Unresolved {' '.join(words)}"  # shortName: no braces
        try:
            rows = await yt_dashboard.yt(
                "/api/issues", query=query, fields="idReadable,summary", **{"$top": 5}
            )
        except YtError as e:
            log.warning("similar tickets not checked: %s %s", e.status, e.message)
            return []  # a hint only; never blocks creating the ticket
        base = settings.youtrack_url.rstrip("/")
        return [
            YouTrackIssue(id=i["idReadable"], url=f"{base}/issue/{i['idReadable']}",
                          summary=i.get("summary") or "")
            for i in rows
        ]  # fmt: skip

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
