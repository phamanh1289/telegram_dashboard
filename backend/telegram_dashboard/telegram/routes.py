import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse

from .. import local_data
from ..ai_jobs import stream_answer
from ..ai_run import client_gone
from ..config import Settings
from ..errors import ApiError, int_or_404
from ..models import (
    BeReply,
    BriefingAskRequest,
    BriefingItem,
    ChatsResponse,
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
    StoredMessage,
    TelegramApp,
    TelegramPhone,
    TelegramSignIn,
    TelegramSignInResult,
    WeekStats,
    to_dto,
)
from ..storage import _dt
from ..tasks import mark_tags, remove_task
from .digest import aware
from .live_reads import TelegramReads
from .qa import chain_code, find_threads, has_tag, qa_code

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
        await _known_chat(s, chat_id)
        mid = None if before is None else int_or_404(before, "invalid_cursor")
        msgs = await s.bridge.fetch_page(chat_id, mid, limit)
        ids = [m.message_id for m in msgs]
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids) if ids else ([], "")
        tags = {k.message_id for k in kept}
        items = [to_dto(m).model_copy(update={"kept": m.message_id in tags}) for m in msgs]
        return MessagesPage(items=items, snapshot_cursor="", has_more=len(msgs) == limit)


    @router.put("/api/chats/{chat_id}/messages/{message_id}/handled", status_code=204)
    async def handled(chat_id: str, message_id: str, body: HandledRequest, request: Request) -> None:
        s = S(request)
        mid = int_or_404(message_id, "message_not_found")
        if await s.db.read(s.store.get_message, chat_id, mid) is None:
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


    async def _known_chat(s, chat_id: str) -> None:
        """Tagged or not: any group the account is in may be digested. An untagged one is
        registered untracked, so it stays out of the inbox and its messages are never kept."""
        if await s.db.read(s.store.get_chat, chat_id) is not None:
            return
        g = next((g for g in await s.bridge.list_groups() if g.chat_id == chat_id), None)
        if g is None or g.migrated:
            raise ApiError(404, "chat_not_found")
        await s.db.write(s.store.upsert_chat_info, g.chat_id, g.title, g.kind)


    @router.get("/api/groups")
    async def groups(request: Request) -> list[GroupInfo]:
        """Every Telegram group the account is in, live: Briefing adds untagged ones from here."""
        return [g for g in await S(request).bridge.list_groups() if not g.migrated]


    async def _consent(s, chat_id: str) -> DigestConsent:
        exp = await s.db.read(s.store.get_digest_consent, chat_id)
        return DigestConsent(enabled=exp is not None, expires_at=_dt(exp))


    @router.get("/api/chats/{chat_id}/digest-consent")
    async def get_digest_consent(chat_id: str, request: Request) -> DigestConsent:
        s = S(request)
        await _known_chat(s, chat_id)
        return await _consent(s, chat_id)


    @router.put("/api/chats/{chat_id}/digest-consent")
    async def put_digest_consent(chat_id: str, body: DigestConsentRequest, request: Request) -> DigestConsent:
        s = S(request)
        await _known_chat(s, chat_id)
        exp = datetime.now(UTC) + timedelta(days=body.days) if body.enabled else None
        await s.db.write(s.store.set_digest_consent, chat_id, exp)
        return await _consent(s, chat_id)


    @router.get("/api/chats/{chat_id}/history")
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


    @router.get("/api/chats/{chat_id}/digest")
    async def saved_digest(chat_id: str, request: Request) -> SavedDigest | None:
        """Latest digest of this chat and how far digests have read (null when none)."""
        s = S(request)
        await _known_chat(s, chat_id)
        return _saved(await s.db.read(s.store.get_digest, chat_id))


    @router.get("/api/chats/{chat_id}/evidence")
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


    @router.get("/api/briefing")
    async def briefing(request: Request) -> list[BriefingItem]:
        """Tracked groups and digest-only ones, with their Digest state; latest_id tells
        whether there is news."""
        s = S(request)

        async def item(row: dict) -> BriefingItem:
            latest = None
            if row["consent"] and s.bridge.state == "connected":  # only groups the AI may read
                try:
                    async with live_reads.live:
                        latest = str(await s.bridge.transport.latest_id(row["chat_id"]))
                except Exception as e:  # one unreachable group must not hide the others
                    log.warning("briefing: latest id of %s unknown: %r", row["chat_id"], e)
            until = row["consent_until"]
            return BriefingItem(chat_id=row["chat_id"], title=row["title"], consent=row["consent"],
                                consent_until=None if until is None else datetime.fromtimestamp(until, UTC),
                                latest_id=latest, saved=_saved(row["digest"]))  # fmt: skip

        rows = await s.db.read(s.store.briefing_rows)
        return list(await asyncio.gather(*(item(r) for r in rows)))


    @router.get("/api/chats/{chat_id}/members")
    async def members(chat_id: str, request: Request) -> list[Member]:
        """The group's live member list, reused for the reply box's @ popup."""
        return await live_reads.members(S(request).bridge, chat_id)


    @router.get("/api/qa")
    async def qa(chat_id: str, request: Request, days: Annotated[int, Query(ge=1, le=30)] = 7) -> list[QaItem]:
        """Q&A threads of one group over the last `days`, live from Telegram (not stored, no AI), latest activity first.
        Tags we keep come as their stored copy (kept, with done / pin state), so the row offers its tag actions."""
        s = S(request)
        s.bridge.ensure_connected()  # offline: 503 not_connected, not "no Q&A"
        await _known_chat(s, chat_id)
        msgs = await live_reads.qa(s.bridge, chat_id, days)
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


    @router.put("/api/qa/mark", status_code=204)
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


    @router.post("/api/qa", status_code=201)
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
        live_reads.invalidate_qa(body.chat_id)
        if reply_to:
            await s.db.write(s.store.set_handled, body.chat_id, reply_to, True, "dashboard")
        return QaPosted(message_id=str(mid), code=joined or code, joined=bool(joined))


    @router.post(
        "/api/qa/summary", responses={200: {"description": "NDJSON: delta / reset lines, then {done: {text}}"}},
    )
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


    @router.post(
        "/api/briefing/ask", responses={200: {"description": "NDJSON: delta / reset lines, then {done: {text}}"}},
    )
    async def briefing_ask(body: BriefingAskRequest, request: Request) -> StreamingResponse:
        """Ask AI across every group's latest digest (no new Telegram reads)."""
        client_gone.set(request.is_disconnected)

        async def work(on_text):
            return {"text": await S(request).digest.ask(body.question, body.intro, on_text)}

        return stream_answer(work)


    @router.get("/api/briefing/answered")
    async def briefing_answered(request: Request) -> dict[str, list[str]]:
        """chat_id -> digest-cited message ids I have replied to since (Briefing ticks them off)."""
        return await S(request).digest.answered()


    @router.get("/api/briefing/be-replies")
    async def briefing_be_replies(request: Request) -> dict[str, list[BeReply]]:
        """chat_id -> replies from others to questions still open with BE, newer than the digest (Với BE shows them)."""
        return await S(request).digest.be_replies()


    @router.post("/api/briefing/saved", status_code=204)
    async def briefing_saved(body: SavedMessageRequest, request: Request) -> None:
        """Send the briefing (or an AI answer about it) to my own Saved Messages."""
        await S(request).bridge.send_saved(body.text)


    @router.post("/api/digest")
    async def digest(body: DigestRequest, request: Request) -> DigestResult:
        client_gone.set(request.is_disconnected)  # "Dừng" / leaving the page stops the claude run
        return await S(request).digest.run(body)


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
        # Cả nhóm: a plain message, not kept yet. Keep it (tracked groups only), so it comes back as a tag.
        live = next(iter(await s.bridge.fetch_ids(chat_id, [mid])), None) if body.until and 0 < mid < 2**31 else None
        if not (
            live
            and not live.deleted
            and await s.db.write(s.store.apply_message, live)
            and await s.db.write(s.store.set_snooze, chat_id, mid, body.until, on)
        ):
            raise ApiError(404, "message_not_found")


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
        if not await s.db.write(s.store.set_pinned, chat_id, mid, body.pinned):
            raise ApiError(404, "message_not_found")


    @router.get("/api/chats/{chat_id}/messages/{message_id}/context")
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


    @router.get("/api/chats/{chat_id}/messages/{message_id}")
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


    @router.get("/api/chats/{chat_id}/messages/{message_id}/before")
    async def before(chat_id: str, message_id: str, request: Request, reply_to: int | None = None) -> list[MessageDTO]:
        """Live, not stored: Deep thinking's question candidates for a BE answer (see fetch_before)."""
        s = S(request)
        await _known_chat(s, chat_id)
        mid = int_or_404(message_id, "message_not_found")
        return [to_dto(m) for m in await s.bridge.fetch_before(chat_id, mid, reply_to)]


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
