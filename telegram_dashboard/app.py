import asyncio
import contextlib
import logging
import re
import secrets
import sys
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

from . import privacy, providers, updater
from .agent import AgentRunner, session_ref
from .ai import AiService, clean_svg, client_gone, parse_ticket, pick_folder, stream_answer
from .auth import LocalGuardMiddleware
from .autobe import AutoBe
from .claude import (
    claude_account,
    claude_login,
    claude_login_code,
    claude_logout,
    claude_reset,
    claude_runs,
    refresh_usage,
)
from .config import Settings, write_private_json
from .digest import DigestService, aware
from .errors import ApiError, int_or_404
from .events import Hub, event_stream
from .external_runs import external_runs, run_provider
from .models import (
    AiAccount,
    AiCatalogEntry,
    AiDeepBatchRequest,
    AiDeepRequest,
    AiDraftRequest,
    AiGuideRequest,
    AiLoginStarted,
    AiMascotJob,
    AiMascotRequest,
    AiPrefs,
    AiProvider,
    AiResetRequest,
    AiResetResult,
    AiResult,
    AiRun,
    AiTestRequest,
    AiTestResult,
    AiTicketDraft,
    AiTicketRequest,
    BeReply,
    BriefingAskRequest,
    BriefingItem,
    ChangesPage,
    ChatsResponse,
    ClaudeAccount,
    ClaudeLoginCode,
    ClaudeLoginStarted,
    DigestConsent,
    DigestConsentRequest,
    DigestRequest,
    DigestResult,
    GroupInfo,
    HandledAllResponse,
    HandledRequest,
    HistoryPage,
    LoopBack,
    LoopDoneRequest,
    LoopImportRequest,
    Member,
    MessageDTO,
    MessageRef,
    MessagesPage,
    OutboxDTO,
    PendingItem,
    PinRequest,
    ProjectDTO,
    ProjectRequest,
    QaItem,
    QaMarkRequest,
    QaPosted,
    QaPostRequest,
    QaSummaryRequest,
    RemindRequest,
    RemindResult,
    ReplyRequest,
    RuleAdded,
    RuleDTO,
    RuleRequest,
    SavedDigest,
    SavedMessageRequest,
    SnoozeRequest,
    StatusDTO,
    StoredMessage,
    TelegramApp,
    TelegramPhone,
    TelegramSignIn,
    TelegramSignInResult,
    WeekStats,
    YouTrackAuth,
    YouTrackIssue,
    YouTrackRequest,
    YouTrackUser,
    to_dto,
)
from .qa import chain_code, find_threads, has_tag, names_code, qa_code
from .storage import Db, Store, _dt, parse_cursor
from .tasks import add_refs, assist_history, mark_tags, new_task_id, start_task
from .tasks import build_router as build_task_router
from .telegram import TelegramBridge, Transport, notify_mac
from .yt_dashboard import YouTrackDashboard, YtError, build_router, whoami

log = logging.getLogger("telegram_dashboard.app")
FAILED_STATUS = {"retry_after": 429, "forbidden": 403, "reply_not_found": 404, "not_connected": 503}
LIVE_READS = 4  # parallel Telegram calls in /api/briefing and /api/qa
QA_TTL = 30.0  # seconds a group's live Q&A read is reused: every page polls each followed group
QA_SCAN = 600  # newest messages read per group for Q&A
MEMBERS_TTL = 300.0  # seconds a group's member list (reply box @ popup) is reused


GUIDE_PROMPT = (
    "Em là trợ lý biết tuốt của ứng dụng Radar (2 tab: Telegram và YouTrack, cùng Cài đặt), trò chuyện với "
    "người dùng. Trong <guide> là danh mục tính năng, mỗi dòng có [id], vị trí, tác dụng và các bước. Câu hỏi"
    " về cách dùng: trả lời từ danh mục; không thấy thì nói rõ là không thấy, đừng bịa. Trả lời ngắn gọn, "
    "markdown, theo thứ tự: một câu trả lời thẳng; rồi các bước làm đánh số, ghi đúng nhãn nút/phím tắt; tính"
    ' năng phù hợp ghi tên in đậm kèm [id] (app biến [id] thành nút "Chỉ tôi tận nơi"). Khi cần mở một trang,'
    " thêm link markdown tới đúng một trong các trang sau (app biến thành nút mở trang): Telegram [Hôm "
    "nay](/?chat=__today__), [Việc cần xử lý](/?chat=__all__), [Đã ghim](/?chat=__pinned__), "
    "[Q&A](/?chat=__qa__), [Briefing](/?chat=__briefing__), [AI Agent](/?chat=__tasks__); YouTrack [Trang "
    "chủ](/youtrack/?view=home), [Dashboard](/youtrack/?view=dash), [Ticket](/youtrack/?view=tickets), "
    "[Release](/youtrack/?view=release), [Thành viên](/youtrack/?view=people), [YouTrack "
    "AI](/youtrack/?view=ai); Cài đặt [Chung](/settings/#general), [Telegram](/settings/#telegram), "
    "[YouTrack](/settings/#youtrack), [AI](/settings/#ai), [Cập nhật](/settings/#github), [Phím "
    "tắt](/settings/#shortcuts). Nhãn link ghi rõ đích, vd. [Cài đặt › Telegram](/settings/#telegram); không "
    "bịa đường dẫn khác. <page> là trang người dùng đang mở; <history> là các lượt hỏi trước."
)
# The bot is junior to the user: it calls itself "em" and the user by name (YouTrack, else Telegram), or "anh/chị".
GUIDE_VOICE = (
    ' Xưng hô: em là bot, ngôi thấp hơn người dùng; luôn xưng "em", gọi người dùng là {name}. Giọng vui vẻ, lễ '
    "phép, gần gũi (có thể thêm một emoji hợp ngữ cảnh), vẫn ngắn gọn. Trả lời tiếng Anh: xưng I, gọi bằng tên nếu có."
)


def _guide_name(name: str) -> str:
    """How the bot calls the user: by their display name (one line, no markup), else "anh/chị"."""
    name = re.sub(r"[^\w .'-]", "", (name.strip().splitlines() or [""])[0]).strip()[:60]
    if not name:
        return '"anh/chị"'
    return (f'tên gọi trong "{name}" (tên tiếng Việt: một hai chữ cuối); không đoán giới tính từ tên, cần đại từ '
            'thì dùng "anh/chị"')  # fmt: skip


GUIDE_CODE = (
    " Em được đọc (chỉ đọc) mã nguồn của chính app: thư mục hiện tại là backend Python, web/src (nếu có) là "
    "giao diện. Câu hỏi về rule, điều kiện một nút / mục ẩn hay hiện, vì sao không thấy, giới hạn, mặc định: "
    "đọc code để trả lời đúng như code đang chạy, nói điều kiện bằng lời người dùng, cuối câu ghi nguồn "
    "`file:dòng`."
)

MASCOT_PROMPT = (
    "You draw a mascot icon for an app's AI assistant, from the user's description and style. "
    'Reply with ONE <svg> element only, no prose, no code fence. viewBox="0 0 32 32", '
    "the character fills the box, has a face and reads clearly at 16 px. "
    "Allowed elements: g, path, circle, ellipse, rect, line, polyline, polygon, defs, "
    "linearGradient, radialGradient, stop. "
    "Presentation attributes only (fill, stroke, stroke-width, opacity, transform…), hex colours: "
    "no style, class, text, image, href, script, filter or animation. Under 6000 characters."
)
MASCOT_STYLES = {
    "cute": "cute and friendly, flat, big eyes, soft rounded shapes, 2-4 solid colours plus at most one gradient",
    "pixel": "pixel art on a 16x16 grid of 2x2 cells, chunky, 3-5 colours: ONE <path> per colour, each cell written "
    "as M x y h2 v2 h-2 z (x, y even)",
    "line": "minimal line art: rounded strokes in one or two colours, stroke-width 1.5-2, almost no fill",
}


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
        app.state.autobe = auto = AutoBe(app.state)  # Vòng BE tự chạy: rules relay / agent on new tags
        app.state.agent.on_idle, bridge.on_tags = auto.on_idle, auto.on_tags
        app.state.yt = yt_dashboard  # links.py reads YouTrack articles / tickets with its token
        app.state.settings = settings
        await bridge.start()
        auto = asyncio.create_task(updater.auto_loop(settings, app.state.agent))
        # YouTrack rounds with no page open: new-ticket banner (macOS; the page toasts), Báo lại, ticket snoozes
        mac = settings.notify and sys.platform == "darwin"
        watch = asyncio.create_task(yt_dashboard.watch(db, notify_mac if mac else None))
        try:
            yield
        finally:
            auto.cancel()
            watch.cancel()
            # Agents and Telegram first; one failing step never skips the others.
            for step in (app.state.agent.stop_all, bridge.stop, yt_dashboard.aclose):
                try:
                    await step()
                except Exception:
                    log.warning("shutdown step %s failed", step.__name__, exc_info=True)
            for task in (auto, watch):
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    yt_dashboard = YouTrackDashboard(settings)
    app = FastAPI(title="Radar", lifespan=lifespan)
    app.add_middleware(
        LocalGuardMiddleware,
        host_header=settings.host_header,
        app_origin=settings.app_origin,
        token=settings.api_token,
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
    app.include_router(privacy.build_router(settings))

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
            youtrack_configured=settings.youtrack_configured,
            telegram_api_id=settings.telegram_api_id,
            telegram_me=s.bridge.me or None,
            telegram_name=s.bridge.me_name or None,
            db_epoch=cursor.rpartition(":")[0],
            cursor=cursor,
        )

    @app.get("/api/chats")
    async def chats(request: Request, since: datetime | None = None, until: datetime | None = None) -> ChatsResponse:
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
    async def handled(chat_id: str, message_id: str, body: HandledRequest, request: Request) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        if await s.db.read(s.store.get_message, chat_id, mid) is None:
            raise ApiError(404, "message_not_found")
        by = "me" if body.react else "quiet"
        if await s.db.write(s.store.set_handled, chat_id, mid, body.handled, by) and body.react:
            s.bridge.react(chat_id, [mid], body.handled)
        await mark_tags(s, chat_id, [mid], body.handled, body.react)  # its Q&A and the sessions on it follow

    @app.post("/api/chats/{chat_id}/handled-all")
    async def handled_all(
        chat_id: str,
        request: Request,
        since: datetime | None = None,
        until: datetime | None = None,
        skip: Annotated[list[int], Query(max_length=1000)] = [],  # noqa: B006 -- tags the list leaves to Q&A
    ) -> HandledAllResponse:
        s = S(request)
        ids = await s.db.write(s.store.mark_all_handled, chat_id, since, until, skip=skip)
        await mark_tags(s, chat_id, ids, True, False)  # as Done one by one, still without reactions
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
            # loop: the Báo lại list changed; auto: the last failure of the BE automation (autobe.py)
            return {"state": s.bridge.state, "loop": s.store.loop_rev, "auto": [s.autobe.rev, s.autobe.error]}

        yield ServerSentEvent(retry=3000, comment="open")
        async for ev in event_stream(s.store, s.hub, start, alive=alive, status=bridge_status):
            yield ev

    @app.post("/api/messages/reply", responses={202: {"model": OutboxDTO}})
    async def reply(body: ReplyRequest, request: Request, response: Response) -> OutboxDTO:
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
        """Photos and nearby messages of a tag, for a draft or a ticket: (nearby, images)."""
        s = S(request)
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

    @app.post(
        "/api/ai/draft",
        responses={200: {"model": AiResult, "description": "NDJSON: delta / reset lines, then {done: AiResult}"}},
    )
    async def ai_draft(body: AiDraftRequest, request: Request) -> StreamingResponse:
        """With header X-Ai-Job (an id the page picked): a background run that outlives the reply panel ("Trả lời từ
        code" takes minutes), read again by GET /api/ai/job/{id}; without: it stops when the page goes."""
        job = request.headers.get("x-ai-job", "")
        if job and not yt_dashboard.jobs.free(job):
            raise ApiError(409, "ai_job_taken")
        client_gone.set(request.is_disconnected)
        nearby, images = await _draft_extras(request, body)
        kind = "answer" if body.project else "draft"  # a project picked: "Trả lời từ code"
        tickets = await yt_dashboard.brief(body.ticket_ids) if kind == "answer" else ""

        def run(on_text, history=None, ref=""):
            return S(request).ai.run(
                kind, body.chat_id, body.message_ids, body.instruction, body.project, nearby=nearby, images=images,
                platform=body.platform, role=body.role, intro=body.intro, on_text=on_text, tickets=tickets,
                history=history, ref=ref,
            )  # fmt: skip

        async def work(on_text):
            return (await run(on_text)).model_dump()

        if body.save:  # Trợ lý AI: a turn of the tag's saved session (one code path for the reply panel and AI Agent)
            work = await _assist_turn(S(request), body, run, bool(job))
        return yt_dashboard.jobs.start(job, work) if job else stream_answer(work)

    async def _assist_turn(s, body: AiDraftRequest, run, background: bool):
        """Log the turn in the tag's Trợ lý AI session (made on its first ask), with the earlier turns in its prompt;
        it starts now, so once this answers the session shows it running. The answer's `work`. `background` (a job):
        the turn outlives the page, which only took it (AI Agent's follow-up) or may close (Trả lời từ code)."""
        tag = int_or_404(body.message_ids[0], "message_not_found")
        task_id = await s.db.write(s.store.assist_task, new_task_id(), body.chat_id, tag)
        history = assist_history((await asyncio.to_thread(s.agent.read, task_id))[0])
        early: list = []  # text the run streamed before a reader came
        relay = [early.append]
        prompt = {"text": body.shown or body.instruction, **({"code": body.project} if body.project else {})}
        if background:  # the turn's task copies this context: a reader leaving must not stop its run
            client_gone.set(None)
        turn = s.agent.side_start(task_id, prompt, lambda: run(lambda t: relay[0](t), history, session_ref(task_id)),
                                  lambda r: r.analysis or r.text)  # fmt: skip
        await add_refs(s, task_id, [(body.chat_id, m) for m in body.message_ids[1:]])

        async def work(on_text):
            for t in early:
                on_text(t)
            relay[0] = on_text
            try:
                return (await turn).model_dump()
            except asyncio.CancelledError:  # Stop from the AI Agent page: an answer, not a stream left hanging
                if turn.cancelled() and not asyncio.current_task().cancelling():
                    raise ApiError(499, "ai_cancelled", detail="Đã dừng lượt AI") from None
                raise

        return work

    # One store of background AI runs for the whole app (YouTrack's): the Telegram side reads / stops its own here.
    @app.get("/api/ai/job/{job_id}", responses={200: {"description": "NDJSON, as the run that started it"}})
    async def ai_job(job_id: str) -> StreamingResponse:
        got = yt_dashboard.jobs.attach(job_id)
        if got is None:
            raise ApiError(404, "ai_job_gone")
        return got

    @app.delete("/api/ai/job/{job_id}", status_code=204)
    async def ai_job_stop(job_id: str) -> None:
        yt_dashboard.jobs.stop(job_id)

    @app.post("/api/ai/deep")
    async def ai_deep(body: AiDeepRequest, request: Request) -> dict:
        """Deep thinking on a combo (question to BE + BE's confirmation): a read-only AI Agent session."""
        s = S(request)
        if not s.agent.available:
            raise ApiError(422, "ai_agent_missing")
        fetch = s.bridge.fetch_ids if s.bridge.state == "connected" else None
        prompt, title = await s.ai.deep(body.chat_id, body.question_id, body.confirm_id, body.project,
                                        body.instruction, fetch=fetch)  # fmt: skip
        task_id = new_task_id()
        await start_task(s, task_id, body.chat_id, int(body.confirm_id), body.project, prompt, "plan",
                         kind="deep", title=title, about=body,
                         refs=[(body.chat_id, body.question_id), (body.chat_id, body.confirm_id)])  # fmt: skip
        return {"id": task_id}

    @app.post("/api/ai/deep-batch")
    async def ai_deep_batch(body: AiDeepBatchRequest, request: Request) -> dict:
        """Đối chiếu BE in bulk: several digest items of one chat, one read-only AI Agent session (a table per item)."""
        s = S(request)
        if not s.agent.available:
            raise ApiError(422, "ai_agent_missing")
        fetch = s.bridge.fetch_ids if s.bridge.state == "connected" else None
        items = [(i.text, i.message_ids, i.waiting, i.key) for i in body.items]
        prompt, title, anchor = await s.ai.deep_batch(body.chat_id, items, body.project, body.instruction,
                                                      fetch=fetch)  # fmt: skip
        task_id = new_task_id()
        await start_task(s, task_id, body.chat_id, anchor, body.project, prompt, "plan", kind="deep", title=title,
                         about=body, refs=[(body.chat_id, m) for i in body.items for m in i.message_ids],
                         ask_refs=False)  # many topics: which one an ask is about is unknown  # fmt: skip
        return {"id": task_id}

    @app.post("/api/ai/ticket")
    async def ai_ticket(body: AiTicketRequest, request: Request) -> AiTicketDraft:
        """A YouTrack ticket proposal (summary, Type, Priority, templated description) of a tag."""
        client_gone.set(request.is_disconnected)
        nearby, images = await _draft_extras(request, body)
        fields = {"Type": body.types, "Priority": body.priorities}
        r = await S(request).ai.run(
            "ticket", body.chat_id, body.message_ids, body.instruction, None,
            nearby=nearby, images=images, platform=body.platform, role=body.role, intro=body.intro, fields=fields,
        )  # fmt: skip
        return AiTicketDraft(**parse_ticket(r.text, fields))

    @app.post("/api/ai/guide", responses={200: {"description": "NDJSON: delta / reset lines, then {done: {text}}"}})
    async def ai_guide(body: AiGuideRequest, request: Request) -> StreamingResponse:
        """Which features answer the user's question, and how to use them: from the guide the page sends."""
        client_gone.set(request.is_disconnected)
        s = S(request)
        past = "".join(f"<turn>\nHỏi: {h.q}\nĐáp: {h.a}\n</turn>\n" for h in body.history)
        user = (
            f"<guide>\n{body.guide}\n</guide>\n<page>{body.page}</page>\n<history>\n{past}</history>\n\n"
            f"Câu hỏi của người dùng: {body.question}"
        )
        # the app's own code, read-only: the backend always ships; the web source only in a checkout (not the installs)
        web = s.settings.root / "web" / "src"

        here = str(Path(__file__).parent)
        code = {"project": here, "read_dir": str(web) if web.is_dir() else None} if body.code else {}

        async def work(on_text):
            system = GUIDE_PROMPT + GUIDE_VOICE.format(name=_guide_name(body.name)) + (GUIDE_CODE if body.code else "")
            return {"text": await s.ai.ask(user, system=system, on_text=on_text, feature="guide", guide=True, **code)}

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
    async def put_digest_consent(chat_id: str, body: DigestConsentRequest, request: Request) -> DigestConsent:
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
        limit: Annotated[int, Query(ge=1, le=2000)] = 2000,  # what one digest reads (MAX_RUN)
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

    @app.get("/api/chats/{chat_id}/evidence")
    async def evidence(
        chat_id: str, request: Request, ids: Annotated[list[int], Query(min_length=1, max_length=40)]
    ) -> list[MessageDTO]:
        """Live, not stored: the messages a digest item cites plus the ones they reply to (Briefing's
        item detail shows them as the evidence behind it)."""
        s = S(request)
        await _known_chat(s, chat_id)
        want = {i for i in ids if 0 < i < 2**31}  # Telegram ids are int32
        msgs = await s.bridge.fetch_ids(chat_id, sorted(want)) if want else []
        parents = {m.reply_to_id for m in msgs if m.reply_to_id} - want
        if parents:
            msgs += await s.bridge.fetch_ids(chat_id, sorted(parents)[:20])
        keep = {m.message_id: m for m in msgs if m.chat_id == chat_id and not m.deleted}
        return [to_dto(keep[k]) for k in sorted(keep)]

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
            until = row["consent_until"]
            return BriefingItem(chat_id=row["chat_id"], title=row["title"], consent=row["consent"],
                                consent_until=None if until is None else datetime.fromtimestamp(until, UTC),
                                latest_id=latest, saved=_saved(row["digest"]))  # fmt: skip

        rows = await s.db.read(s.store.briefing_rows)
        return list(await asyncio.gather(*(item(r) for r in rows)))

    member_reads: dict[str, tuple[float, list[Member]]] = {}
    members_live = asyncio.Semaphore(LIVE_READS)

    @app.get("/api/chats/{chat_id}/members")
    async def members(chat_id: str, request: Request) -> list[Member]:
        """The group's members, live from Telegram, reused for MEMBERS_TTL: the reply box's @ popup."""
        s = S(request)
        if (hit := member_reads.get(chat_id)) and time.monotonic() - hit[0] < MEMBERS_TTL:
            return hit[1]
        async with members_live:
            out = await s.bridge.members(chat_id)
        if len(member_reads) > 50:
            member_reads.clear()
        member_reads[chat_id] = (time.monotonic(), out)
        return out

    qa_reads: dict[tuple[str, int], tuple[float, list[StoredMessage]]] = {}
    qa_live = asyncio.Semaphore(LIVE_READS)  # shared by every /api/qa call: 8 groups load at once

    async def _qa_msgs(s, chat_id: str, days: int) -> list[StoredMessage]:
        """The group's messages over `days`, live from Telegram, reused for QA_TTL."""
        k = (chat_id, days)
        if (hit := qa_reads.get(k)) and time.monotonic() - hit[0] < QA_TTL:
            return hit[1]
        async with qa_live:
            until = datetime.now(UTC)
            msgs = await s.bridge.fetch_range(chat_id, until - timedelta(days=days), until, QA_SCAN)
            # A question answered with Q&A may be older than the range: read it so it still leads its thread.
            older = {m.reply_to_id for m in msgs if m.reply_to_id and names_code(m.text)} - {m.message_id for m in msgs}
            if older:
                msgs += await s.bridge.fetch_ids(chat_id, sorted(older)[-20:])
        if len(qa_reads) > 100:
            qa_reads.clear()
        qa_reads[k] = (time.monotonic(), msgs)
        return msgs

    @app.get("/api/qa")
    async def qa(chat_id: str, request: Request, days: Annotated[int, Query(ge=1, le=30)] = 7) -> list[QaItem]:
        """Q&A threads of one group over the last `days`, live from Telegram (not stored, no AI), latest activity first.
        Tags we keep come as their stored copy (kept, with done / pin state), so the row offers its tag actions."""
        s = S(request)
        s.bridge.ensure_connected()  # offline: 503 not_connected, not "no Q&A"
        await _known_chat(s, chat_id)
        msgs = await _qa_msgs(s, chat_id, days)
        ids = [m.message_id for m in msgs]
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids) if ids else ([], "")
        mine = {k.message_id: k for k in kept}
        title = (await s.db.read(s.store.get_chat, chat_id) or {}).get("title") or chat_id

        def dto(m: StoredMessage) -> MessageDTO:
            k = mine.get(m.message_id)  # the stored copy has no @username (never stored): the live one's
            return to_dto(k).model_copy(update={"kept": True, "sender_username": m.sender_username}) if k else to_dto(m)

        marks = await s.db.read(s.store.qa_marks, chat_id)
        threads = [QaItem(code=code, chat_title=title, question=dto(ms[0]), answers=[dto(m) for m in ms[1:]],
                          done=marks.get(code) == "done")
                   for code, ms in find_threads(msgs) if marks.get(code) != "deleted"]  # fmt: skip
        return sorted(threads, key=lambda i: (i.answers or [i.question])[-1].date, reverse=True)

    @app.put("/api/qa/mark", status_code=204)
    async def qa_mark(body: QaMarkRequest, request: Request) -> None:
        """Xong (no nudge, not waiting) or removed from the dashboard's Q&A (Telegram keeps the messages).
        null undoes. Xong / undoing it moves the thread's kept tags too, as Done on each from the list (no reaction)."""
        s = S(request)
        await _known_chat(s, body.chat_id)
        prev = await s.db.write(s.store.set_qa_mark, body.chat_id, body.code, body.state)
        if body.state == "done" or (body.state is None and prev == "done"):
            on = body.state == "done"
            if ids := await s.db.write(s.store.mark_qa_thread, body.chat_id, body.code, on):
                await mark_tags(s, body.chat_id, ids, on, False)  # their sessions follow, as Done from the list

    @app.post("/api/qa", status_code=201)
    async def qa_post(body: QaPostRequest, request: Request) -> QaPosted:
        """Post a question to any group the account is in, the text then a "#QA…" line; with `reply_to`, a reply in
        its thread as typed, or (`start`) an answer to someone's question that opens a thread on it. Answering a tag
        we keep marks it done, like a reply from the reply panel. `start` on a message already in a thread (up its reply
        chain) answers in that thread as typed: no second code. A question / answer that tags nobody (@username) goes
        out as a plain message: no code, no Q&A."""
        s = S(request)
        await _known_chat(s, body.chat_id)
        reply_to = None if body.reply_to is None else int_or_404(body.reply_to, "reply_not_found")
        joined = None
        if reply_to is not None and body.start:
            joined = await chain_code(lambda ids: s.bridge.fetch_ids(body.chat_id, ids), reply_to)
        opens = (reply_to is None or body.start) and not joined and has_tag(body.text)
        code = qa_code(datetime.now(UTC)) if opens else None
        text = body.text.strip() + (f"\n{code}" if code else "")
        mid = await s.bridge.send_direct(body.chat_id, reply_to, text)
        for k in [k for k in qa_reads if k[0] == body.chat_id]:  # the page refetches: show the post
            qa_reads.pop(k)
        if reply_to:
            await s.db.write(s.store.set_handled, body.chat_id, reply_to, True, "dashboard")
        return QaPosted(message_id=str(mid), code=joined or code, joined=bool(joined))

    @app.post("/api/qa/summary", responses={200: {"description": "NDJSON: delta / reset lines, then {done: {text}}"}})
    async def qa_summary(body: QaSummaryRequest, request: Request) -> StreamingResponse:
        """AI conclusion of one Q&A thread (question, answer, what is still open), for a ticket or a recap."""
        client_gone.set(request.is_disconnected)
        s = S(request)
        await _known_chat(s, body.chat_id)
        ids = [int_or_404(i, "message_not_found") for i in body.message_ids]
        accepted = None if body.accepted_id is None else int_or_404(body.accepted_id, "message_not_found")
        fetch = s.bridge.fetch_ids if s.bridge.state == "connected" else None

        async def work(on_text):
            return {"text": await s.ai.qa_summary(body.chat_id, ids, fetch, accepted, body.intro, on_text)}

        return stream_answer(work)

    @app.post("/api/briefing/ask", responses={200: {"description": "NDJSON: delta / reset lines, then {done: {text}}"}})
    async def briefing_ask(body: BriefingAskRequest, request: Request) -> StreamingResponse:
        """Ask AI across every group's latest digest (no new Telegram reads)."""
        client_gone.set(request.is_disconnected)

        async def work(on_text):
            return {"text": await S(request).digest.ask(body.question, body.intro, on_text)}

        return stream_answer(work)

    @app.get("/api/briefing/answered")
    async def briefing_answered(request: Request) -> dict[str, list[str]]:
        """chat_id -> digest-cited message ids I have replied to since (Briefing ticks them off)."""
        return await S(request).digest.answered()

    @app.get("/api/briefing/be-replies")
    async def briefing_be_replies(request: Request) -> dict[str, list[BeReply]]:
        """chat_id -> replies from others to questions still open with BE, newer than the digest (Với BE shows them)."""
        return await S(request).digest.be_replies()

    @app.post("/api/briefing/saved", status_code=204)
    async def briefing_saved(body: SavedMessageRequest, request: Request) -> None:
        """Send the briefing (or an AI answer about it) to my own Saved Messages."""
        await S(request).bridge.send_saved(body.text)

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

    @app.get("/api/snoozed")
    async def snoozed(request: Request) -> list[PendingItem]:
        """Tags hidden for now: Hôm nay lists them under "Bạn đang chờ"."""
        s = S(request)
        return [PendingItem(chat_title=t, message=m) for t, m in await s.db.read(s.store.list_snoozed)]

    @app.get("/api/pinned")
    async def pinned(request: Request) -> list[PendingItem]:
        s = S(request)
        return [PendingItem(chat_title=t, message=m) for t, m in await s.db.read(s.store.list_pinned)]

    @app.put("/api/chats/{chat_id}/messages/{message_id}/snooze", status_code=204)
    async def snooze(chat_id: str, message_id: str, body: SnoozeRequest, request: Request) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        on = body.on if body.until else None
        if await s.db.write(s.store.set_snooze, chat_id, mid, body.until, on):
            return
        # Cả nhóm: a plain message, not kept yet. Keep it (tracked groups only), so it comes back as a tag.
        live = next(iter(await s.bridge.fetch_ids(chat_id, [mid])), None) if body.until and 0 < mid < 2**31 else None
        if not (live and not live.deleted and await s.db.write(s.store.apply_message, live)
                and await s.db.write(s.store.set_snooze, chat_id, mid, body.until, on)):
            raise ApiError(404, "message_not_found")

    @app.get("/api/loopback")
    async def loop_back(request: Request) -> LoopBack:
        """ "Báo lại" items the background YouTrack watch queued, and its last failure."""
        s = S(request)
        rows = await s.db.read(s.store.loop_items)
        return LoopBack(items=[{**r, "message_id": str(r["message_id"])} for r in rows], error=yt_dashboard.watch_error)

    @app.post("/api/loopback/done", status_code=204)
    async def loop_done(body: LoopDoneRequest, request: Request) -> None:
        """Dismissed ("Bỏ qua"); a reply sent to the message closes its items on its own."""
        s = S(request)
        await s.db.write(s.store.done_loop, body.chat_id, int(body.message_id), body.ticket)

    @app.post("/api/loopback/import")
    async def loop_import(body: LoopImportRequest, request: Request) -> dict[str, int]:
        """ponytail: one-time move of a browser's old localStorage queue; drop after a few releases."""
        s = S(request)
        items = [(i.ticket, i.state, i.chat_id, int(i.message_id)) for i in body.items]
        return {"added": await s.db.write(s.store.add_loop_items, items)}

    @app.put("/api/chats/{chat_id}/messages/{message_id}/remind")
    async def remind(chat_id: str, message_id: str, body: RemindRequest, request: Request) -> RemindResult:
        """ "Nhắc lại sau": reopen a tag (e.g. just answered "để mình check") and hide it until `until`; it comes
        back to Việc cần xử lý then. No reaction change on Telegram. `restore` (Undo) puts back how it was done,
        without closing its Q&A or sessions as Xong would."""
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        was = await s.db.write(s.store.remind, chat_id, mid, body.until, restore=body.restore)
        if was is None:
            raise ApiError(404, "message_not_found")
        return RemindResult(was=was)

    @app.get("/api/stats/week")
    async def week_stats(request: Request) -> WeekStats:
        s = S(request)
        return WeekStats(**await s.db.read(s.store.week_stats))

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
        """One message by id: the kept copy, else live from Telegram."""
        s = S(request)
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
    async def before(chat_id: str, message_id: str, request: Request, reply_to: int | None = None) -> list[MessageDTO]:
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
        extra = ""
        if body.kind == "agent":  # its sessions run without the page: they keep the project and who the user is
            if not await s.db.read(s.store.has_project, body.project):
                raise ApiError(404, "project_not_found")
            extra = body.model_dump_json(include={"project", "role", "platform", "intro"})
        rule, cleared = await s.db.write(s.store.add_rule, body.kind, body.value, body.label, extra)
        refs = [MessageRef(chat_id=c, message_id=str(m)) for c, m in cleared]
        return RuleAdded(rule=RuleDTO(**rule), handled=len(refs), cleared=refs)

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
        """This app's runs plus the ones made outside it (Claude Code / Codex transcripts), newest first."""
        own, outside = await asyncio.gather(
            asyncio.to_thread(claude_runs, settings, days), asyncio.to_thread(external_runs, days)
        )
        rows = sorted([*own, *outside], key=lambda r: str(r["at"]), reverse=True)
        return [AiRun(**{"provider": run_provider(str(r.get("model", ""))), **r}) for r in rows]

    @app.post("/api/ai/test")
    async def ai_test(body: AiTestRequest, request: Request) -> AiTestResult:
        """One tiny run on the picked CLI and model: does it answer, and how fast."""
        t0 = time.monotonic()
        text = await S(request).ai.ask(
            "Reply with exactly: OK",
            system="",
            heavy=body.task,
            brief=body.brief,
            yt=body.yt,
            feature="test",
            guide=body.guide,
        )
        return AiTestResult(text=text[:200], ms=round((time.monotonic() - t0) * 1000))

    # ponytail: AI mascot drawings live in memory (the last 8); a restart forgets them, the page then shows none
    mascots: list[dict] = []

    @app.post("/api/ai/mascot", status_code=202)
    async def ai_mascot(body: AiMascotRequest, request: Request) -> AiMascotJob:
        """Start drawing an SVG mascot from the member's description (Cài đặt › Linh vật AI) on the CLI's quickest
        model, in the background like an AI session: the page may close; GET shows it running, then its drawing."""
        ai = S(request).ai
        job = {"id": secrets.token_hex(6), "description": body.description, "style": body.style, "state": "running"}
        user = f"Style: {MASCOT_STYLES[body.style]}\nMascot: {body.description}"

        async def draw() -> None:
            try:
                svg = clean_svg(await ai.ask(user, system=MASCOT_PROMPT, feature="mascot", fast=True))
                job.update({"state": "done", "svg": svg} if svg else {"state": "error", "error": "mascot_invalid"})
            except ApiError as e:
                job.update(state="error", error=e.code, detail=e.detail or "")
            except Exception:
                log.exception("AI mascot drawing failed")
                job.update(state="error", error="ai_failed")

        mascots.append(job)
        del mascots[:-8]
        job["task"] = asyncio.get_running_loop().create_task(draw())  # held by the job; DELETE cancels it
        return AiMascotJob(**job)

    @app.get("/api/ai/mascot")
    async def ai_mascots() -> list[AiMascotJob]:
        """The mascot drawings since the server started, oldest first (running ones included)."""
        return [AiMascotJob(**j) for j in mascots]

    @app.delete("/api/ai/mascot/{job_id}", status_code=204)
    async def ai_mascot_drop(job_id: str) -> None:
        """Stop a running drawing, or forget a finished one."""
        for j in [j for j in mascots if j["id"] == job_id]:
            j["task"].cancel()
            mascots.remove(j)

    @app.get("/api/ai/accounts")
    async def ai_accounts(fresh: bool = False) -> list[AiAccount]:
        """Codex and Antigravity logins and quotas (Claude has its own /api/claude/account); `fresh`
        reads the quotas now instead of from the last few minutes."""
        got = await asyncio.gather(*(providers.account(settings, p, fresh) for p in providers.OTHERS))
        return [AiAccount(**a) for a in got]

    @app.post("/api/ai/{provider}/reset")
    async def ai_reset(provider: AiProvider, body: AiResetRequest) -> AiResetResult:
        """Use one of the plan's free limit resets now: Claude's or Codex's (504 ai_reset_unknown: no answer,
        it may have gone through)."""
        if provider == "antigravity":
            raise ApiError(404, "not_found")
        run = claude_reset if provider == "claude" else providers.codex_reset
        return AiResetResult(outcome=await run(settings, body.credit_id, request_id=body.request_id))

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

    async def _find_issues(query: str, top: int) -> list[YouTrackIssue]:
        """YouTrack's own search (its relevance order); [] when it refuses the query (400). A bad token /
        no YouTrack is raised: "no matching ticket" would make the user file a duplicate."""
        try:
            rows = await yt_dashboard.yt("/api/issues", query=query, fields="idReadable,summary", **{"$top": top})
        except YtError as e:
            if e.status != 400:
                raise
            log.warning("tickets not looked up: %s %s", e.status, e.message)
            return []
        base = settings.youtrack_url.rstrip("/")
        return [
            YouTrackIssue(id=i["idReadable"], url=f"{base}/issue/{i['idReadable']}",
                          summary=i.get("summary") or "")
            for i in rows
        ]  # fmt: skip

    def _open_in(project: str, q: str, min_len: int) -> str | None:
        """YQL for the project's open tickets matching q's words, or None (nothing to search)."""
        words = re.findall(rf"\w{{{min_len},}}", q)[:8]  # plain words only: query syntax chars never reach YQL
        project = re.sub(r"[^\w-]", "", project) or settings.youtrack_project
        if not settings.youtrack_configured or not words or not project:
            return None
        return f"project: {project} #Unresolved {' '.join(words)}"  # shortName: no braces

    @app.get("/api/youtrack/similar")
    async def youtrack_similar(q: str, project: str = "") -> list[YouTrackIssue]:
        """Open tickets whose text matches q (YouTrack's own relevance): ones possibly related."""
        query = _open_in(project, q, 3)
        return await _find_issues(query, 5) if query else []

    @app.get("/api/youtrack/search")
    async def youtrack_search(q: str, project: str = "") -> list[YouTrackIssue]:
        """A ticket to comment on: an ID (VA-123) finds that one in any state; words search the
        project's open tickets (2+ letters: short Vietnamese words count)."""
        if not settings.youtrack_configured:
            return []
        if m := re.fullmatch(r"\s*([A-Za-z][A-Za-z0-9]*-\d+)\s*", q):
            return await _find_issues(f"issue ID: {m[1].upper()}", 1)
        query = _open_in(project, q, 2)
        return await _find_issues(query, 10) if query else []

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
