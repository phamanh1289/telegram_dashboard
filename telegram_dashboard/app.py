from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.staticfiles import StaticFiles

from .ai import AiService, grant_problem
from .auth import COOKIE, LocalAuth, LocalGuardMiddleware, require_session
from .config import Settings
from .errors import ApiError
from .events import Hub, event_stream
from .models import (
    AiDraftRequest,
    AiPermissionRequest,
    AiPermissionResponse,
    AiResult,
    AiSummaryRequest,
    ChangesPage,
    ChatDTO,
    ChatsResponse,
    MessagesPage,
    OutboxDTO,
    ReplyRequest,
    StatusDTO,
    TrackingRequest,
    UnlockRequest,
)
from .storage import Db, Store, parse_cursor
from .telegram import TelegramBridge, Transport

Session = Annotated[str, Depends(require_session)]

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
    auth: LocalAuth | None = None,
    ai_client=None,
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
        bridge = TelegramBridge(st, db, t)
        app.state.store, app.state.hub, app.state.db, app.state.bridge = st, hub, db, bridge
        app.state.ai = AiService(settings, st, db, ai_client)
        await bridge.start()
        try:
            yield
        finally:
            await bridge.stop()

    app = FastAPI(title="Telegram Dashboard", lifespan=lifespan)
    app.state.auth = auth or LocalAuth()
    app.add_middleware(
        LocalGuardMiddleware, host_header=settings.host_header, app_origin=settings.app_origin
    )

    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError):
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        body = {"code": e.code, "retry_after": e.retry_after, "detail": e.detail}
        return JSONResponse({"error": body}, status_code=e.status, headers=headers)

    def S(request: Request):
        return request.app.state

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.post("/api/unlock", status_code=204)
    async def unlock(body: UnlockRequest, request: Request, response: Response) -> None:
        token = request.app.state.auth.unlock(body.code)
        response.set_cookie(
            COOKIE, token, httponly=True, samesite="strict", path="/api", max_age=12 * 3600
        )

    @app.post("/api/logout", status_code=204)
    async def logout(request: Request, response: Response) -> None:
        request.app.state.auth.revoke(request.cookies.get(COOKIE))
        response.delete_cookie(COOKIE, path="/api")
        request.app.state.hub.notify()  # wakes SSE loops so they notice the dead session

    @app.get("/api/status")
    async def status(request: Request, _: Session) -> StatusDTO:
        s = S(request)
        cursor = await s.db.read(s.store.current_cursor)
        state = s.bridge.state
        if state == "setup_required" and settings.telegram_configured:
            state = "login_required"
        return StatusDTO(
            state=state,
            detail=s.bridge.detail,
            ai_configured=settings.ai_configured,
            db_epoch=cursor.rpartition(":")[0],
            cursor=cursor,
        )

    @app.get("/api/chats")
    async def chats(request: Request, _: Session) -> ChatsResponse:
        s = S(request)
        available = None
        if s.bridge.state == "connected":
            groups = await s.bridge.list_groups()
            for g in groups:
                await s.db.write(s.store.upsert_chat_info, g.chat_id, g.title, g.kind)
            available = {g.chat_id for g in groups if not g.migrated}
        items, cursor = await s.db.read(s.store.list_chats)
        out: list[ChatDTO] = []
        for c in items:
            c.available = available is None or c.chat_id in available
            c.sync_state = s.bridge.sync_state.get(c.chat_id, "idle")
            if c.tracking or c.available:
                out.append(c)
        return ChatsResponse(items=out, snapshot_cursor=cursor)

    @app.put("/api/chats/{chat_id}/tracking")
    async def tracking(
        chat_id: str, body: TrackingRequest, request: Request, _: Session
    ) -> ChatDTO:
        s = S(request)
        await s.db.write(s.store.set_tracking, chat_id, body.enabled)
        if body.enabled and s.bridge.state == "connected":
            s.bridge.schedule_sync(chat_id)
        items, _c = await s.db.read(s.store.list_chats)
        chat = next(c for c in items if c.chat_id == chat_id)
        chat.sync_state = s.bridge.sync_state.get(chat_id, "idle")
        return chat

    @app.delete("/api/chats/{chat_id}/data", status_code=204)
    async def purge(chat_id: str, request: Request, _: Session) -> None:
        s = S(request)
        task = s.bridge._tasks.pop(chat_id, None)
        if task:
            task.cancel()
        await s.db.write(s.store.purge_chat, chat_id)

    @app.get("/api/chats/{chat_id}/messages")
    async def messages(
        chat_id: str,
        request: Request,
        _: Session,
        before: str | None = None,
        after: str | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        q: Annotated[str | None, Query(max_length=200)] = None,
    ) -> MessagesPage:
        s = S(request)
        items, cursor, has_more = await s.db.read(
            s.store.query_messages,
            chat_id,
            before=None if before is None else _int_or_404(before, "invalid_cursor"),
            after=None if after is None else _int_or_404(after, "invalid_cursor"),
            limit=limit,
            q=q or None,
        )
        return MessagesPage(items=items, snapshot_cursor=cursor, has_more=has_more)

    @app.get("/api/changes")
    async def changes(
        request: Request,
        _: Session,
        cursor: str,
        limit: Annotated[int, Query(ge=1, le=500)] = 200,
    ) -> ChangesPage:
        s = S(request)
        items, nxt, has_more, reset = await s.db.read(s.store.changes_since, cursor, limit)
        return ChangesPage(items=items, next_cursor=nxt, has_more=has_more, reset=reset)

    @app.get("/api/events", response_class=EventSourceResponse)
    async def events(
        request: Request,
        token: Session,
        cursor: str | None = None,
        last_event_id: Annotated[str | None, Header()] = None,
    ):
        s = S(request)
        auth: LocalAuth = request.app.state.auth
        start = last_event_id or cursor
        if start is not None and parse_cursor(start) is None:
            start = "invalid"  # forces a reset event

        async def alive() -> bool:
            return auth.valid(token) and not await request.is_disconnected()

        def bridge_status() -> dict:
            return {"state": s.bridge.state, "sync": dict(sorted(s.bridge.sync_state.items()))}

        yield ServerSentEvent(retry=3000, comment="open")
        async for ev in event_stream(s.store, s.hub, start, alive=alive, status=bridge_status):
            yield ev

    @app.post("/api/messages/reply", responses={202: {"model": OutboxDTO}})
    async def reply(
        body: ReplyRequest, request: Request, response: Response, _: Session
    ) -> OutboxDTO:
        rec = await S(request).bridge.submit_reply(body)
        if rec.status == "failed":
            code = rec.error_code or "send_failed"
            raise ApiError(FAILED_STATUS.get(code, 502), code, retry_after=rec.retry_after)
        if rec.status != "sent":
            response.status_code = 202
        return rec

    @app.get("/api/outbox/{request_id}")
    async def outbox(request_id: str, request: Request, _: Session) -> OutboxDTO:
        s = S(request)
        rec = await s.db.read(s.store.outbox_get, request_id)
        if rec is None:
            raise ApiError(404, "not_found")
        return rec

    @app.put("/api/chats/{chat_id}/ai-permission")
    async def ai_permission(
        chat_id: str, body: AiPermissionRequest, request: Request, _: Session
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
    async def ai_draft(body: AiDraftRequest, request: Request, _: Session) -> AiResult:
        return await S(request).ai.run("draft", body.chat_id, body.message_ids, body.instruction)

    @app.post("/api/ai/summary")
    async def ai_summary(body: AiSummaryRequest, request: Request, _: Session) -> AiResult:
        return await S(request).ai.run("summary", body.chat_id, body.message_ids)

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
