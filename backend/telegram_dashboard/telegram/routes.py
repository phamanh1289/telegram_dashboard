import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import FileResponse

from .. import local_data
from ..config import Settings
from ..errors import ApiError, int_or_404
from ..models import (
    ChatsResponse,
    HandledAllResponse,
    HandledRequest,
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
    RemindRequest,
    RemindResult,
    ReplyRequest,
    RuleAdded,
    RuleDTO,
    RuleRequest,
    SnoozeRequest,
    TelegramApp,
    TelegramPhone,
    TelegramSignIn,
    TelegramSignInResult,
    WeekStats,
    to_dto,
)
from ..tasks import mark_tags, remove_task
from .live_reads import TelegramReads

log = logging.getLogger(__name__)

FAILED_STATUS = {"retry_after": 429, "forbidden": 403, "reply_not_found": 404, "not_connected": 503}
MEDIA_DAYS = 30


def S(request: Request):
    return request.app.state


def prune_media(settings: Settings, chat_id: str | None = None) -> None:
    """Startup: drop cached photos older than MEDIA_DAYS; with `chat_id` (Xóa dữ liệu nhóm): all of that group's."""
    cut = time.time() - MEDIA_DAYS * 86_400
    for p in (settings.data_dir / "media").glob(f"{chat_id.lstrip('-')}_*.jpg" if chat_id else "*.jpg"):
        with contextlib.suppress(OSError):
            if chat_id or p.stat().st_mtime < cut:
                p.unlink()


async def photo_file(request: Request, chat_id: str, mid: int) -> Path | None:
    """Cached copy of a kept tag's photo, downloaded on first use."""
    s = S(request)
    m = await s.db.read(s.store.get_message, chat_id, mid)
    if m is None or m.media_kind != "photo":
        return None
    media = s.settings.data_dir / "media"  # pruned by prune_media
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


async def known_chat(s, live_reads: TelegramReads, chat_id: str) -> None:
    """Tagged or not: any group the account is in may be digested. An untagged one is
    registered untracked, so it stays out of the inbox and its messages are never kept."""
    if await s.db.read(s.store.get_chat, chat_id) is not None:
        return
    g = next((g for g in await live_reads.groups(s.bridge) if g.chat_id == chat_id), None)
    if g is None or g.migrated:
        raise ApiError(404, "chat_not_found")
    await s.db.write(s.store.upsert_chat_info, g.chat_id, g.title, g.kind)


def build_router(
    get_settings: Callable[[], Settings], set_settings: Callable[[Settings], None], live_reads: TelegramReads,
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/chats")
    async def chats(request: Request, since: datetime | None = None, until: datetime | None = None) -> ChatsResponse:
        s = S(request)
        items, cursor = await s.db.read(s.store.list_chats, since, until)
        return ChatsResponse(items=[c for c in items if c.tracking], snapshot_cursor=cursor)


    @router.delete("/api/chats/{chat_id}/data", status_code=204)
    async def purge(chat_id: str, request: Request) -> None:
        s = S(request)
        # the AI sessions holding its messages go too (a session quoting several groups: the whole session), before
        # the rows: a run still going is stopped, so it cannot write the text back
        for task_id in await s.db.read(s.store.chat_tasks, chat_id):
            await remove_task(s, task_id)
        await s.db.write(s.store.purge_chat, chat_id)
        await asyncio.to_thread(prune_media, get_settings(), chat_id)
        await local_data.compact(s)


    @router.get("/api/chats/{chat_id}/messages")
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


    @router.get("/api/chats/{chat_id}/live")
    async def live(
        chat_id: str,
        request: Request,
        before: str | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> MessagesPage:
        """Every message of the group, live from Telegram (not stored), newest page first."""
        s = S(request)
        await known_chat(s, live_reads, chat_id)
        mid = None if before is None else int_or_404(before, "invalid_cursor")
        msgs = await live_reads.click(s.bridge.fetch_page(chat_id, mid, limit))
        ids = [m.message_id for m in msgs]
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids) if ids else ([], "")
        tags = {k.message_id for k in kept}
        items = [to_dto(m).model_copy(update={"kept": m.message_id in tags}) for m in msgs]
        return MessagesPage(items=items, snapshot_cursor="", has_more=len(msgs) == limit)


    @router.put("/api/chats/{chat_id}/messages/{message_id}/handled", status_code=204)
    async def handled(chat_id: str, message_id: str, body: HandledRequest, request: Request) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        stored = await s.db.read(s.store.get_message, chat_id, mid) is not None
        if not stored and not (body.handled and await _keep_live(s, chat_id, mid)):
            raise ApiError(404, "message_not_found")
        by = "me" if body.react else "quiet"
        if await s.db.write(s.store.set_handled, chat_id, mid, body.handled, by) and body.react:
            s.bridge.react(chat_id, [mid], body.handled)
        await mark_tags(s, chat_id, [mid], body.handled, body.react)  # its Q&A and the sessions on it follow


    @router.post("/api/chats/{chat_id}/handled-all")
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


    @router.post("/api/messages/reply", responses={202: {"model": OutboxDTO}})
    async def reply(body: ReplyRequest, request: Request, response: Response) -> OutboxDTO:
        rec = await S(request).bridge.submit_reply(body)
        if rec.status == "failed":
            code = rec.error_code or "send_failed"
            raise ApiError(FAILED_STATUS.get(code, 502), code, retry_after=rec.retry_after)
        if rec.status != "sent":
            response.status_code = 202
        return rec


    @router.get("/api/outbox/{request_id}")
    async def outbox(request_id: str, request: Request) -> OutboxDTO:
        s = S(request)
        rec = await s.db.read(s.store.outbox_get, request_id)
        if rec is None:
            raise ApiError(404, "not_found")
        return rec


    @router.get("/api/chats/{chat_id}/members")
    async def members(chat_id: str, request: Request) -> list[Member]:
        """The group's live member list, reused for the reply box's @ popup."""
        return await live_reads.members(S(request).bridge, chat_id)


    @router.get("/api/pending")
    async def pending(
        request: Request, since: datetime | None = None, until: datetime | None = None
    ) -> list[PendingItem]:
        s = S(request)
        rows = await s.db.read(s.store.list_pending, since, until)
        return [PendingItem(chat_title=t, message=m) for t, m in rows]


    @router.get("/api/snoozed")
    async def snoozed(request: Request) -> list[PendingItem]:
        """Tags hidden for now: Hôm nay lists them under "Bạn đang chờ"."""
        s = S(request)
        return [PendingItem(chat_title=t, message=m) for t, m in await s.db.read(s.store.list_snoozed)]


    @router.get("/api/pinned")
    async def pinned(request: Request) -> list[PendingItem]:
        s = S(request)
        return [PendingItem(chat_title=t, message=m) for t, m in await s.db.read(s.store.list_pinned)]


    @router.put("/api/chats/{chat_id}/messages/{message_id}/snooze", status_code=204)
    async def snooze(chat_id: str, message_id: str, body: SnoozeRequest, request: Request) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        on = body.on if body.until else None
        if await s.db.write(s.store.set_snooze, chat_id, mid, body.until, on):
            return
        if not (
            body.until
            and await _keep_live(s, chat_id, mid)
            and await s.db.write(s.store.set_snooze, chat_id, mid, body.until, on)
        ):
            raise ApiError(404, "message_not_found")


    async def _keep_live(s, chat_id: str, mid: int) -> bool:
        """Cả nhóm: a plain message, not kept yet. Keep it (tracked groups only): Hoãn / Xong / Ghim make it a tag."""
        live = next(iter(await live_reads.click(s.bridge.fetch_ids(chat_id, [mid]))), None) if 0 < mid < 2**31 else None
        return bool(live and not live.deleted and await s.db.write(s.store.apply_message, live))


    @router.get("/api/loopback")
    async def loop_back(request: Request) -> LoopBack:
        """ "Báo lại" items the background YouTrack watch queued, and its last failure."""
        s = S(request)
        rows = await s.db.read(s.store.loop_items)
        return LoopBack(items=[{**r, "message_id": str(r["message_id"])} for r in rows], error=s.yt.watch_error)


    @router.post("/api/loopback/done", status_code=204)
    async def loop_done(body: LoopDoneRequest, request: Request) -> None:
        """Dismissed ("Bỏ qua"); a reply sent to the message closes its items on its own."""
        s = S(request)
        await s.db.write(s.store.done_loop, body.chat_id, int(body.message_id), body.ticket)


    @router.post("/api/loopback/import")
    async def loop_import(body: LoopImportRequest, request: Request) -> dict[str, int]:
        """ponytail: one-time move of a browser's old localStorage queue; drop after a few releases."""
        s = S(request)
        items = [(i.ticket, i.state, i.chat_id, int(i.message_id)) for i in body.items]
        return {"added": await s.db.write(s.store.add_loop_items, items)}


    @router.put("/api/chats/{chat_id}/messages/{message_id}/remind")
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


    @router.get("/api/stats/week")
    async def week_stats(request: Request) -> WeekStats:
        s = S(request)
        return WeekStats(**await s.db.read(s.store.week_stats))


    @router.put("/api/chats/{chat_id}/messages/{message_id}/pin", status_code=204)
    async def pin(chat_id: str, message_id: str, body: PinRequest, request: Request) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        if not await s.db.write(s.store.set_pinned, chat_id, mid, body.pinned) and not (
            body.pinned
            and await _keep_live(s, chat_id, mid)
            and await s.db.write(s.store.set_pinned, chat_id, mid, True)
        ):
            raise ApiError(404, "message_not_found")


    @router.get("/api/chats/{chat_id}/messages/{message_id}/context")
    async def context(chat_id: str, message_id: str, request: Request) -> list[MessageDTO]:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        stored = await s.db.read(s.store.get_message, chat_id, mid) is not None
        if not stored and not await s.db.read(s.store.is_tracking, chat_id):
            raise ApiError(404, "message_not_found")  # around kept tags, or any message of a tracked group (Cả nhóm)
        live = await live_reads.click(s.bridge.fetch_context(chat_id, mid))
        # Live copies don't know which of them are kept tags marked done: take that from the store.
        ids = [m.message_id for m in live]
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids) if ids else ([], "")
        done = {k.message_id for k in kept if k.handled}
        return [to_dto(m.model_copy(update={"handled": m.message_id in done})) for m in live]


    @router.get("/api/chats/{chat_id}/messages/{message_id}")
    async def one_message(chat_id: str, message_id: str, request: Request) -> MessageDTO:
        """One message by id: the kept copy, else live from Telegram."""
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        if not 0 < mid < 2**31:  # Telegram ids are int32
            raise ApiError(404, "message_not_found")
        m = await s.db.read(s.store.get_message, chat_id, mid)
        if m is None:
            await known_chat(s, live_reads, chat_id)
            m = next(iter(await live_reads.click(s.bridge.fetch_ids(chat_id, [mid]))), None)
        if m is None or m.deleted:
            raise ApiError(404, "message_not_found")
        return to_dto(m)


    @router.get("/api/chats/{chat_id}/messages/{message_id}/before")
    async def before(chat_id: str, message_id: str, request: Request, reply_to: int | None = None) -> list[MessageDTO]:
        """Live, not stored: Deep thinking's question candidates for a BE answer (see fetch_before)."""
        s = S(request)
        await known_chat(s, live_reads, chat_id)
        mid = int_or_404(message_id, "message_not_found")
        return [to_dto(m) for m in await live_reads.click(s.bridge.fetch_before(chat_id, mid, reply_to))]


    @router.get("/api/chats/{chat_id}/messages/{message_id}/photo", response_class=FileResponse)
    async def photo(chat_id: str, message_id: str, request: Request):
        p = await photo_file(request, chat_id, int_or_404(message_id, "message_not_found"))
        if p is None:
            raise ApiError(404, "photo_not_available")
        return FileResponse(p, media_type="image/jpeg")


    @router.get("/api/rules")
    async def rules(request: Request) -> list[RuleDTO]:
        s = S(request)
        return [RuleDTO(**r) for r in await s.db.read(s.store.list_rules)]


    @router.get("/api/senders")
    async def senders(request: Request) -> list[Member]:
        """Everyone seen writing in the saved messages: Settings › Luôn bỏ qua picks a sender to ignore from it."""
        s = S(request)
        return [Member(**m) for m in await s.db.read(s.store.known_senders)]


    @router.post("/api/rules")
    async def add_rule(body: RuleRequest, request: Request) -> RuleAdded:
        s = S(request)
        extra = ""
        # its sessions run without the page: they keep the project and who the user is. relay needs one only to open a
        # session on a Q&A thread none holds (autobe.on_tags): without a project it just relays
        if body.kind in ("agent", "relay"):
            if not await s.db.read(s.store.has_project, body.project):
                if body.kind == "agent":
                    raise ApiError(404, "project_not_found")
            else:
                extra = body.model_dump_json(include={"project", "role", "platform", "intro"})
        rule, cleared = await s.db.write(s.store.add_rule, body.kind, body.value, body.label, extra)
        refs = [MessageRef(chat_id=c, message_id=str(m)) for c, m in cleared]
        return RuleAdded(rule=RuleDTO(**rule), handled=len(refs), cleared=refs)


    @router.delete("/api/rules/{rule_id}", status_code=204)
    async def remove_rule(rule_id: int, request: Request) -> None:
        s = S(request)
        await s.db.write(s.store.remove_rule, rule_id)


    @router.put("/api/telegram/app", status_code=204)
    async def telegram_app(body: TelegramApp, request: Request) -> None:
        """Save the API ID/hash from my.telegram.org and reconnect with them."""
        from .transport import TelethonTransport

        get_settings().ensure_data_dir()
        get_settings().save_config(telegram_api_id=body.api_id, telegram_api_hash=body.api_hash)
        set_settings(replace(get_settings(), telegram_api_id=body.api_id, telegram_api_hash=body.api_hash))
        await S(request).bridge.set_transport(TelethonTransport(get_settings()))
        live_reads.forget()  # groups, members, Q&A read as the account before


    def _login_transport(request: Request):
        t = S(request).bridge.transport
        if t is None or not hasattr(t, "sign_in"):
            raise ApiError(409, "telegram_not_configured")
        return t


    @router.post("/api/telegram/code", status_code=204)
    async def telegram_code(body: TelegramPhone, request: Request) -> None:
        await _login_transport(request).send_code(body.phone.replace(" ", ""))


    @router.post("/api/telegram/sign-in")
    async def telegram_sign_in(body: TelegramSignIn, request: Request) -> TelegramSignInResult:
        if not await _login_transport(request).sign_in(body.code, body.password):
            return TelegramSignInResult(password_required=True)
        session = Path(f"{get_settings().session_path}.session")
        if session.exists():
            session.chmod(0o600)
        await S(request).bridge.start()  # the run loop stopped at login_required
        return TelegramSignInResult(password_required=False)


    return router
