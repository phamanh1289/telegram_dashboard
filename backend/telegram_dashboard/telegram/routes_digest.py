"""HTTP for Digest / Briefing and Q&A: what the AI may read of a group, its summaries, and the question threads."""

import asyncio
import hashlib
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from ..ai_jobs import stream_answer
from ..ai_run import client_gone
from ..errors import int_or_404
from ..models import GroupInfo, MessageDTO, StoredMessage, to_dto
from ..storage import _dt
from ..tasks import mark_tags
from .digest import aware
from .live_reads import TelegramReads
from .models_digest import (
    BeReplies,
    BriefingAskRequest,
    BriefingItem,
    DigestConsent,
    DigestConsentRequest,
    DigestRequest,
    DigestResult,
    HistoryPage,
    QaAcceptRequest,
    QaItem,
    QaList,
    QaMarkRequest,
    QaPosted,
    QaPostRequest,
    QaSummaryRequest,
    SavedDigest,
    SavedMessageRequest,
)
from .qa import ack_only, chain_code, find_threads, has_tag, qa_code
from .routes import S, known_chat

log = logging.getLogger(__name__)


def build_router(live_reads: TelegramReads) -> APIRouter:
    router = APIRouter()

    @router.get("/api/groups")
    async def groups(request: Request) -> list[GroupInfo]:
        """Every Telegram group the account is in, live: Briefing adds untagged ones from here."""
        s = S(request)
        return [g for g in await live_reads.groups(s.bridge) if not g.migrated]


    async def _consent(s, chat_id: str) -> DigestConsent:
        exp = await s.db.read(s.store.get_digest_consent, chat_id)
        return DigestConsent(enabled=exp is not None, expires_at=_dt(exp))


    @router.get("/api/chats/{chat_id}/digest-consent")
    async def get_digest_consent(chat_id: str, request: Request) -> DigestConsent:
        s = S(request)
        await known_chat(s, live_reads, chat_id)
        return await _consent(s, chat_id)


    @router.put("/api/chats/{chat_id}/digest-consent")
    async def put_digest_consent(chat_id: str, body: DigestConsentRequest, request: Request) -> DigestConsent:
        s = S(request)
        await known_chat(s, live_reads, chat_id)
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
        await known_chat(s, live_reads, chat_id)
        msgs = await live_reads.scan(s.bridge.fetch_range(
            chat_id, aware(since), aware(until) if until else datetime.now(UTC), limit + 1
        ))
        return HistoryPage(items=[to_dto(m) for m in msgs[-limit:]], truncated=len(msgs) > limit)


    @router.get("/api/chats/{chat_id}/digest")
    async def saved_digest(chat_id: str, request: Request) -> SavedDigest | None:
        """Latest digest of this chat and how far digests have read (null when none)."""
        s = S(request)
        await known_chat(s, live_reads, chat_id)
        return _saved(await s.db.read(s.store.get_digest, chat_id))


    @router.get("/api/chats/{chat_id}/evidence")
    async def evidence(
        chat_id: str, request: Request, ids: Annotated[list[int], Query(min_length=1, max_length=40)]
    ) -> list[MessageDTO]:
        """Live, not stored: the messages a digest item cites plus the ones they reply to (Briefing's
        item detail shows them as the evidence behind it)."""
        s = S(request)
        await known_chat(s, live_reads, chat_id)
        want = {i for i in ids if 0 < i < 2**31}  # Telegram ids are int32
        msgs = await live_reads.scan(s.bridge.fetch_ids(chat_id, sorted(want))) if want else []
        parents = {m.reply_to_id for m in msgs if m.reply_to_id} - want
        if parents:
            msgs += await live_reads.scan(s.bridge.fetch_ids(chat_id, sorted(parents)[:20]))
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
            latest, unread = None, False
            if row["consent"] and s.bridge.state == "connected":  # only groups the AI may read
                try:
                    latest = str(await live_reads.latest_id(s.bridge, row["chat_id"]))
                except Exception as e:  # one unreachable group must not hide the others: it says so on its row
                    log.warning("briefing: latest id of %s unknown: %r", row["chat_id"], e)
                    unread = True
            until = row["consent_until"]
            return BriefingItem(chat_id=row["chat_id"], title=row["title"], consent=row["consent"],
                                consent_until=None if until is None else datetime.fromtimestamp(until, UTC),
                                latest_id=latest, unread=unread, saved=_saved(row["digest"]))  # fmt: skip

        rows = await s.db.read(s.store.briefing_rows)
        return list(await asyncio.gather(*(item(r) for r in rows)))


    @router.get("/api/qa")
    async def qa(chat_id: str, request: Request, days: Annotated[int, Query(ge=1, le=30)] = 7) -> QaList:
        """Q&A threads of one group over the last `days`, live from Telegram (not stored, no AI), latest activity first.
        Tags we keep come as their stored copy (kept, with done / pin state), so the row offers its tag actions."""
        s = S(request)
        s.bridge.ensure_connected()  # offline: 503 not_connected, not "no Q&A"
        await known_chat(s, live_reads, chat_id)
        msgs, cut = await live_reads.qa_scan(s.bridge, chat_id, days)
        ids = [m.message_id for m in msgs]
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids) if ids else ([], "")
        mine = {k.message_id: k for k in kept}
        title = (await s.db.read(s.store.get_chat, chat_id) or {}).get("title") or chat_id

        def dto(m: StoredMessage) -> MessageDTO:
            k = mine.get(m.message_id)  # the stored copy has no @username (never stored): the live one's
            return to_dto(k).model_copy(update={"kept": True, "sender_username": m.sender_username}) if k else to_dto(m)

        marks = await s.db.read(s.store.qa_marks, chat_id)
        chosen = await s.db.read(s.store.qa_answers, chat_id)
        threads = [QaItem(code=code, chat_title=title, question=dto(ms[0]), answers=[dto(m) for m in ms[1:]],
                          done=marks.get(code) == "done", holding=[str(m.message_id) for m in ms[1:] if ack_only(m)],
                          accepted=chosen.get(code))
                   for code, ms in find_threads(msgs) if marks.get(code) != "deleted"]  # fmt: skip
        threads.sort(key=lambda i: (i.answers or [i.question])[-1].date, reverse=True)
        return QaList(items=threads, truncated=cut)


    @router.put("/api/qa/accept", status_code=204)
    async def qa_accept(body: QaAcceptRequest, request: Request) -> None:
        """Chốt: the reply marked as a thread's answer (null: none), kept here so every browser shows it."""
        s = S(request)
        await known_chat(s, live_reads, body.chat_id)
        await s.db.write(s.store.set_qa_answer, body.chat_id, body.code, body.message_id)


    @router.put("/api/qa/mark", status_code=204)
    async def qa_mark(body: QaMarkRequest, request: Request) -> None:
        """Xong (no nudge, not waiting) or removed from the dashboard's Q&A (Telegram keeps the messages).
        null undoes. Xong / undoing it moves the thread's kept tags too, as Done on each from the list (no reaction)."""
        s = S(request)
        await known_chat(s, live_reads, body.chat_id)
        thread = [int_or_404(i, "message_not_found") for i in body.message_ids]
        prev = await s.db.write(s.store.set_qa_mark, body.chat_id, body.code, body.state)
        if body.state == "done" or (body.state is None and prev == "done"):
            on = body.state == "done"
            if ids := await s.db.write(s.store.mark_qa_thread, body.chat_id, body.code, on, ids=thread):
                await mark_tags(s, body.chat_id, ids, on, False)  # their sessions follow, as Done from the list


    @router.post("/api/qa", status_code=201)
    async def qa_post(body: QaPostRequest, request: Request) -> QaPosted:
        """Post a question to any group the account is in, the text then a "#QA…" line; with `reply_to`, a reply in
        its thread as typed, or (`start`) an answer to someone's question that opens a thread on it. Answering a tag
        we keep marks it done, like a reply from the reply panel. `start` on a message already in a thread (up its reply
        chain) answers in that thread as typed: no second code. A question / answer that tags nobody (@username) goes
        out as a plain message: no code, no Q&A."""
        s = S(request)
        await known_chat(s, live_reads, body.chat_id)
        reply_to = None if body.reply_to is None else int_or_404(body.reply_to, "reply_not_found")
        joined = None
        if reply_to is not None and body.start:
            joined = await chain_code(lambda ids: live_reads.click(s.bridge.fetch_ids(body.chat_id, ids)), reply_to)
        opens = (reply_to is None or body.start) and not joined and has_tag(body.text)
        code = qa_code(datetime.now(UTC)) if opens else None
        text = body.text.strip() + (f"\n{code}" if code else "")
        # the same submit sent twice (double click, a resend after "unknown") carries the same random_id
        rid = None
        if body.request_id is not None:
            rid = int.from_bytes(hashlib.sha256(f"{body.chat_id}:{body.request_id}".encode()).digest()[:8]) >> 1
        try:
            mid = await s.bridge.send_direct(body.chat_id, reply_to, text, random_id=rid)
        finally:  # also when the result is unknown: the list read next shows whether it landed
            live_reads.invalidate_qa(body.chat_id)
        if reply_to:
            try:
                await s.db.write(s.store.set_handled, body.chat_id, reply_to, True, "dashboard")
            except Exception as e:  # the message is out: never answer "failed" for it (the tag just stays open)
                log.warning("qa reply sent, tag %s/%s not marked done: %r", body.chat_id, reply_to, e)
        return QaPosted(message_id=str(mid), code=joined or code, joined=bool(joined))


    @router.post(
        "/api/qa/summary", responses={200: {"description": "NDJSON: delta / reset lines, then {done: {text}}"}},
    )
    async def qa_summary(body: QaSummaryRequest, request: Request) -> StreamingResponse:
        """AI conclusion of one Q&A thread (question, answer, what is still open), for a ticket or a recap."""
        client_gone.set(request.is_disconnected)
        s = S(request)
        await known_chat(s, live_reads, body.chat_id)
        ids = [int_or_404(i, "message_not_found") for i in body.message_ids]
        accepted = None if body.accepted_id is None else int_or_404(body.accepted_id, "message_not_found")
        fetch = None
        if s.bridge.state == "connected":
            def fetch(chat_id: str, ids: list[int]):
                return live_reads.scan(s.bridge.fetch_ids(chat_id, ids))

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
            return {"text": await S(request).digest.ask(
                body.question, body.intro, on_text, platform=body.platform, role=body.role
            )}

        return stream_answer(work)


    @router.get("/api/briefing/answered")
    async def briefing_answered(request: Request) -> dict[str, list[str]]:
        """chat_id -> digest-cited message ids I have replied to since (Briefing ticks them off)."""
        return await S(request).digest.answered()


    @router.get("/api/briefing/be-replies")
    async def briefing_be_replies(request: Request) -> BeReplies:
        """chat_id -> replies from others to questions still open with BE, newer than the digest (Với BE shows them)."""
        return await S(request).digest.be_replies()


    @router.post("/api/briefing/saved", status_code=204)
    async def briefing_saved(body: SavedMessageRequest, request: Request) -> None:
        """Send the briefing (or an AI answer about it) to my own Saved Messages."""
        await S(request).bridge.send_saved(body.text)


    @router.post("/api/digest")
    async def digest(body: DigestRequest, request: Request) -> DigestResult:
        client_gone.set(request.is_disconnected)  # "Dừng" (the page aborts the request) stops the AI run
        return await S(request).digest.run(body)


    return router
