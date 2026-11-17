"""Telegram bridge: owns ingest, recovery and reply sending. Transport hides Telethon (transport.py)."""

import asyncio
import logging
import re
import secrets
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

from ..config import run_cli
from ..desktop import applescript_str as _applescript_str
from ..errors import ApiError
from ..models import GroupInfo, Member, OutboxDTO, ReplyRequest, SentMessage, StoredMessage
from ..storage import Db, Store

log = logging.getLogger("telegram_dashboard.telegram")

SEND_TIMEOUT = 30.0
RETRY_DELAY = 5.0
WATCH_INTERVAL = 20.0
# ponytail: fixed look-back for tags on connect; make it a setting if 14 days is not enough.
BACKFILL_DAYS = 14
NOTIFY_PREVIEW = False  # message text in tag banners (Settings › Telegram; privacy.py sets it)
BACKFILL_RETRY = 300.0  # seconds before retrying a backfill that failed (a flood wait says its own)
BACKFILL_MARGIN = timedelta(hours=1)  # a reconnect looks back from the last full backfill, minus this


class LoginRequired(Exception):
    """Session missing, expired or revoked."""


class PartialBackfill(Exception):
    """The mention scan stopped early (flood wait): `found` is what it read before."""

    def __init__(self, found: list, wait: int = 0):
        super().__init__(len(found))
        self.found, self.wait = found, wait


class SendRejected(Exception):
    """Telegram definitely did not accept the message."""

    def __init__(self, code: str, retry_after: int | None = None):
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after


class Transport(Protocol):
    def attach(self, bridge: TelegramBridge) -> None: ...
    async def connect(self) -> bool: ...  # True when authorized
    async def disconnect(self) -> None: ...
    def is_connected(self) -> bool: ...
    async def list_groups(self) -> list[GroupInfo]: ...
    # (title, kind, message, we_replied) for tags/replies to us since `cutoff`, read or not;
    # raises PartialBackfill when cut short
    async def fetch_mentions(
        self, cutoff: datetime
    ) -> list[tuple[str, str, StoredMessage, bool]]: ...
    async def latest_id(self, chat_id: str) -> int: ...
    # `limit` messages older than `before` (None: the newest), oldest first, in one request
    async def fetch_older(self, chat_id: str, before: int | None, limit: int) -> list[StoredMessage]: ...
    async def fetch_context(
        self, chat_id: str, message_id: int, before: int, after: int
    ) -> list[StoredMessage]: ...
    async def download_photo(self, chat_id: str, message_id: int, dest: Path) -> bool: ...
    async def fetch_range(
        self, chat_id: str, since: datetime, until: datetime, limit: int
    ) -> list[StoredMessage]: ...  # newest `limit` in [since, until), oldest first
    async def fetch_ids(self, chat_id: str, ids: list[int]) -> list[StoredMessage]: ...
    async def send_reply(
        self, chat_id: str, reply_to: int | None, text: str, random_id: int, topic_id: int | None
    ) -> SentMessage: ...  # reply_to None: a new message (in topic_id, if any)
    # Add `emoji` unless we already reacted; None takes back only the bridge's own reaction.
    # Raises SendRejected("retry_after") on a flood wait.
    async def send_reaction(self, chat_id: str, message_id: int, emoji: str | None) -> None: ...
    async def send_saved(self, text: str) -> None: ...  # to my own Saved Messages, in ≤4000-char parts
    async def members(self, chat_id: str) -> list[Member]: ...  # people in the group, not me; 403 members_hidden


class TelegramBridge:
    def __init__(
        self, store: Store, db: Db, transport: Transport | None, *, retry_delay=RETRY_DELAY,
        notify: bool = False, reaction: str = "",
    ):
        self.store = store
        self.db = db
        self.transport = transport
        self.retry_delay = retry_delay
        self.notify = notify  # macOS notification for live tags
        self.state = "setup_required" if transport is None else "stopped"
        self.detail: str | None = None
        self._main: asyncio.Task | None = None
        self._send_lock = asyncio.Lock()
        self.reaction = reaction  # emoji mirrored on Telegram when a tag is marked done ("" = off)
        self._react_lock = asyncio.Lock()
        self._swap_lock = asyncio.Lock()  # two credential saves must not leave two clients on one session
        self._bg: set[asyncio.Task] = set()  # reactions, notifications
        self.me = ""  # logged-in account (@username or name), set by the transport on connect
        self.me_name = ""  # its display name (the know-it-all bot calls the user by it)
        self.on_tags = None  # async (new pending tags) -> None: autobe.AutoBe.on_tags, set by the app
        self._backfilled_at = datetime.fromtimestamp(0, UTC)  # last backfill that read everything
        if transport is not None:
            transport.attach(self)

    # ---- lifecycle -----------------------------------------------------
    def _set_state(self, state: str, detail: str | None = None) -> None:
        if (state, detail) != (self.state, self.detail):
            self.state, self.detail = state, detail
            self.db.hub.notify()

    async def start(self) -> None:
        if self.transport is not None and (self._main is None or self._main.done()):
            self._main = asyncio.create_task(self._run())

    async def set_transport(self, transport: Transport) -> None:
        """Swap in a transport built from new API credentials (Settings) and connect it."""
        async with self._swap_lock:
            await self.stop()
            self.transport = transport
            transport.attach(self)
            await self.start()

    async def stop(self) -> None:
        tasks = [t for t in [self._main, *self._bg] if t]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._main = None
        if self.transport is not None:
            try:
                await self.transport.disconnect()
            except Exception:
                log.warning("disconnect failed", exc_info=False)
        if self.state != "setup_required":
            self._set_state("stopped")

    def _spawn(self, coro) -> None:
        """Background work the bridge owns: kept referenced, cancelled by stop()."""
        task = asyncio.create_task(coro)
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)

    async def _run(self) -> None:
        assert self.transport is not None
        self._set_state("connecting")
        up = False  # connected and backfilled
        backfill_at = None  # monotonic time to retry a backfill that failed / was cut short
        while True:
            if up and not self.transport.is_connected():
                up = False
                self._set_state("degraded", "disconnected")
            if not up:
                try:
                    if not await self.transport.connect():
                        self._set_state("login_required")
                        return
                except LoginRequired:
                    self._set_state("login_required")
                    return
                except Exception as e:
                    log.warning("telegram connect failed: %s: %s", type(e).__name__, e)
                    self._set_state("degraded", type(e).__name__)
                else:
                    up = True
                    self._set_state("connected")
                    backfill_at = await self.backfill_mentions()  # its dialog scan also warms the entity cache
            elif backfill_at is not None and time.monotonic() >= backfill_at:
                backfill_at = await self.backfill_mentions()
            # ponytail: liveness polling; Telethon 1.x exposes no reconnect event.
            await asyncio.sleep(WATCH_INTERVAL if up else self.retry_delay)

    def ensure_connected(self) -> Transport:
        if self.transport is None or self.state != "connected":
            raise ApiError(503, "not_connected", detail=self.state)
        return self.transport

    # ---- groups / tracking --------------------------------------------
    async def list_groups(self) -> list[GroupInfo]:
        return await self.ensure_connected().list_groups()

    async def members(self, chat_id: str) -> list[Member]:
        return await self.ensure_connected().members(chat_id)

    # ---- live updates (called by transport) ----------------------------
    async def on_message(self, m: StoredMessage) -> None:
        try:
            await self.db.write(self.store.apply_message, m)
        except Exception as e:
            log.warning("live message not stored (chat %s, message %s): %s", m.chat_id,
                        m.message_id, type(e).__name__)  # fmt: skip

    async def backfill_mentions(self) -> float | None:
        """Pull recent tags/replies to us (read or unread); nothing else is fetched. A reconnect
        looks back only to the last complete backfill (Telethon's catch-up replays the rest).
        Cut short / failed: the monotonic time `_run` retries it at (status detail says so meanwhile)."""
        started = datetime.now(UTC)
        cutoff = max(started - timedelta(days=BACKFILL_DAYS), self._backfilled_at - BACKFILL_MARGIN)
        retry = None
        try:
            try:
                found = await self.ensure_connected().fetch_mentions(cutoff)
            except PartialBackfill as e:  # keep what it read; the retry looks back as far again
                log.warning("mention backfill cut short after %d tags", len(e.found))
                found, retry = e.found, e.wait + 5
            fresh = set(await self.db.write(self.store.store_mentions, found))
            # ponytail: ids only (store_mentions' shape); the same id fresh in two groups at once is not told apart
            if fresh and self.on_tags:
                self._spawn(self.on_tags([m for _, _, m, _ in found if m.message_id in fresh]))
            if retry is None:
                self._backfilled_at = started
        except Exception as e:
            log.warning("mention backfill failed: %s: %s", type(e).__name__, e)
            retry = BACKFILL_RETRY
        if self.state == "connected":
            self._set_state("connected", None if retry is None else "backfill_partial")
        return None if retry is None else time.monotonic() + retry

    async def on_my_reply(self, m: StoredMessage) -> None:
        """Our own reply (from any device) to a kept tag: keep it and mark the tag handled."""
        await self.on_message(m)
        if m.reply_to_id is not None:
            await self.db.write(self.store.set_handled, m.chat_id, m.reply_to_id, True, "reply")

    async def on_mention(self, m: StoredMessage, title: str, kind: str) -> None:
        """A live tag (new or edited). Notifies only for a tag not seen before and still pending."""
        try:
            fresh = await self.db.write(self.store.store_mentions, [(title, kind, m, False)])
        except Exception as e:
            log.warning(
                "live tag not stored (chat %s, message %s): %s", m.chat_id, m.message_id,
                type(e).__name__,
            )  # fmt: skip
            return
        if fresh and self.on_tags:
            self._spawn(self.on_tags([m]))
        if fresh and self.notify:
            # the text only when Settings allow it: banners show on the lock screen / Notification Center
            body = m.text if NOTIFY_PREVIEW else "Mở dashboard để xem nội dung"
            self._spawn(notify_mac(f"Tag mới · {title}", m.sender_name or "", body))

    # ---- live reads (not stored) ---------------------------------------
    async def fetch_context(self, chat_id: str, message_id: int) -> list[StoredMessage]:
        return await self.ensure_connected().fetch_context(chat_id, message_id, 10, 5)

    async def fetch_page(self, chat_id: str, before: int | None, limit: int) -> list[StoredMessage]:
        """`limit` messages older than `before` (None: the newest), oldest first."""
        return await self.ensure_connected().fetch_older(chat_id, before, limit)

    async def fetch_before(
        self, chat_id: str, message_id: int, reply_to: int | None = None, limit: int = 40
    ) -> list[StoredMessage]:
        """Where a message's question is: the one it replies to (however old) first, then the
        `limit` messages right before it, newest first."""
        t = self.ensure_connected()
        msgs = (await t.fetch_older(chat_id, message_id, limit))[::-1]
        if reply_to is not None:
            msgs = [m for m in msgs if m.message_id != reply_to]
            msgs = [m for m in await t.fetch_ids(chat_id, [reply_to]) if m.message_id == reply_to] + msgs
        return msgs

    async def download_photo(self, chat_id: str, message_id: int, dest: Path) -> bool:
        return await self.ensure_connected().download_photo(chat_id, message_id, dest)

    async def fetch_range(
        self, chat_id: str, since: datetime, until: datetime, limit: int
    ) -> list[StoredMessage]:
        return await self.ensure_connected().fetch_range(chat_id, since, until, limit)

    async def fetch_ids(self, chat_id: str, ids: list[int]) -> list[StoredMessage]:
        return await self.ensure_connected().fetch_ids(chat_id, ids)

    async def send_saved(self, text: str) -> None:
        try:
            await self.ensure_connected().send_saved(text)
        except SendRejected as e:
            raise ApiError(429, "flood_wait", retry_after=e.retry_after) from e

    async def send_direct(self, chat_id: str, reply_to: int | None, text: str) -> int:
        """Post to any group the account is in, tracked or not, outside the outbox (Q&A); the new message's id.
        ponytail: no retry bookkeeping like the outbox; a timeout surfaces as `delivery_unknown` (it may have
        posted) so the user checks the group before resending."""
        t = self.ensure_connected()
        try:
            async with self._send_lock:
                sent = await asyncio.wait_for(
                    t.send_reply(chat_id, reply_to, text, secrets.randbits(63), None), SEND_TIMEOUT
                )
        except SendRejected as e:
            code = "flood_wait" if e.code == "retry_after" else e.code
            raise ApiError({"retry_after": 429, "forbidden": 403, "reply_not_found": 404}.get(e.code, 502), code,
                           retry_after=e.retry_after) from e  # fmt: skip
        except Exception as e:  # timeout, connection loss: Telegram may have posted it already
            log.warning("direct send result unknown: %s", type(e).__name__)
            raise ApiError(504, "delivery_unknown") from e
        return sent.message_id

    def react(self, chat_id: str, message_ids: list[int], done: bool) -> None:
        """Mirror "done" on Telegram as a reaction (reopen removes it). Background, best effort:
        a group that forbids reactions or a dropped connection never fails the mark itself."""
        if not (self.reaction and message_ids and self.transport):
            return
        if self.state != "connected":
            log.info("reaction skipped while %s (chat %s, %d tags)", self.state, chat_id,
                     len(message_ids))  # fmt: skip
            return
        emoji = self.reaction if done else None
        self._spawn(self._react(self.transport, chat_id, message_ids, emoji))

    async def _react(
        self, t: Transport, chat_id: str, message_ids: list[int], emoji: str | None
    ) -> None:
        async with self._react_lock:  # in commit order, so a quick undo ends with no reaction
            for n, mid in enumerate(message_ids):
                try:
                    await asyncio.wait_for(t.send_reaction(chat_id, mid, emoji), SEND_TIMEOUT)
                except SendRejected as e:  # flood wait: every further call would fail too
                    left = len(message_ids) - n
                    log.warning("reactions stopped (chat %s): flood wait %ss, %d of %d not sent",
                                chat_id, e.retry_after, left, len(message_ids))  # fmt: skip
                    return
                except Exception as e:
                    log.warning("reaction not sent (chat %s, message %s): %s", chat_id, mid,
                                type(e).__name__)  # fmt: skip

    async def on_deleted(self, chat_id: str | None, message_ids: list[int]) -> None:
        try:
            await self.db.write(self.store.apply_deletion, chat_id, [str(i) for i in message_ids])
        except Exception as e:
            log.warning("deletion not stored: %s", type(e).__name__)

    async def on_migrated(self, old_chat_id: str, new_chat_id: str) -> None:
        await self.db.write(self.store.mark_migrated, old_chat_id, new_chat_id)

    # ---- sending -------------------------------------------------------
    async def submit_reply(self, req: ReplyRequest) -> OutboxDTO:
        rid = str(req.request_id)
        try:
            reply_to = int(req.reply_to_message_id)
        except ValueError:
            raise ApiError(404, "reply_not_found") from None
        rec, _ = await self.db.write(
            self.store.outbox_create, rid, req.chat_id, reply_to, req.text, secrets.randbits(63), req.quote,
            qa=req.qa, qa_role=req.qa_role,
        )
        if rec.status in ("sent", "sending") or (rec.status == "unknown" and not req.retry_unknown):
            return rec
        if self.transport is None or self.state != "connected":
            if rec.status == "pending":
                await self.db.write(
                    self.store.outbox_finish, rid, "failed", error_code="not_connected"
                )
            raise ApiError(503, "not_connected", detail=self.state)
        job = await self.db.write(self.store.outbox_claim, rid, req.retry_unknown)
        if job is None:  # another caller owns it, or it can no longer be sent
            return await self.db.read(self.store.outbox_get, rid)
        async with self._send_lock:  # one send in flight for the account
            return await self._send(rid, job)

    async def _send(self, rid: str, job: dict) -> OutboxDTO:
        assert self.transport is not None
        try:
            sent = await asyncio.wait_for(
                self.transport.send_reply(
                    job["chat_id"], job["reply_to"], job["text"], job["random_id"], job["topic_id"]
                ),
                SEND_TIMEOUT,
            )
        except SendRejected as e:
            return await self.db.write(
                self.store.outbox_finish, rid, "failed",
                error_code=e.code, retry_after=e.retry_after,
            )  # fmt: skip
        except Exception as e:  # timeout, connection loss, RANDOM_ID_DUPLICATE...
            log.warning("send result unknown: %s", type(e).__name__)
            return await self.db.write(
                self.store.outbox_finish, rid, "unknown", error_code="delivery_unknown"
            )
        msg = sent.message or StoredMessage(
            chat_id=job["chat_id"],
            message_id=sent.message_id,
            text=split_format(job["text"])[0],
            date=datetime.now(UTC),
            reply_to_id=job["reply_to"],
            topic_id=job["topic_id"],
            outgoing=True,
        )
        return await self.db.write(
            self.store.outbox_finish, rid, "sent", message_id=sent.message_id, sent=msg
        )


# ```block``` -> pre, `x` -> code, `[Name](tg://user?id=N)` (the reply box's tag of someone without a @username)
# -> mention; leftmost match wins, so a tag inside backticks stays code.
_FORMAT = re.compile(
    r"```(?:[^\n`]*\n)?([\s\S]+?)\n?```|`([^`\n]+)`|\[([^\[\]\n]{1,64})\]\(tg://user\?id=(\d{1,20})\)"
)


def _u16(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def split_format(text: str) -> tuple[str, list[tuple[int, int, int | str]]]:
    """Markdown code spans and name tags -> plain text plus (offset, length, user_id | "code" | "pre") per span,
    in UTF-16 units as Telegram entities count."""
    out, ents, at = [], [], 0
    for m in _FORMAT.finditer(text):
        out.append(text[at : m.start()])
        off = _u16("".join(out))
        body, kind = (m[1], "pre") if m[1] is not None else (m[2], "code") if m[2] is not None else (m[3], int(m[4]))
        out.append(body)
        ents.append((off, _u16(body), kind))
        at = m.end()
    out.append(text[at:])
    return "".join(out), ents

async def notify_mac(title: str, subtitle: str, body: str) -> None:
    """Best-effort macOS banner; failures (other OS, no permission) are ignored."""
    q = _applescript_str
    script = (
        f"display notification {q(body[:200])} with title {q(title[:80])} "
        f'subtitle {q(subtitle[:80])} sound name "Glass"'
    )
    await run_cli(["osascript", "-e", script], timeout=10)
