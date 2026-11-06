"""Telegram bridge: owns ingest, recovery and reply sending. Transport hides Telethon."""

import asyncio
import logging
import os
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

from .ai import _applescript_str
from .config import run_cli
from .errors import ApiError
from .models import GroupInfo, LinkSpan, OutboxDTO, ReplyRequest, SentMessage, StoredMessage
from .storage import Db, Store

log = logging.getLogger("telegram_dashboard.telegram")

SEND_TIMEOUT = 30.0
RETRY_DELAY = 5.0
WATCH_INTERVAL = 20.0
# ponytail: fixed look-back for tags on connect; make it a setting if 14 days is not enough.
BACKFILL_DAYS = 14
BACKFILL_MARGIN = timedelta(hours=1)  # a reconnect looks back from the last full backfill, minus this


class LoginRequired(Exception):
    """Session missing, expired or revoked."""


class PartialBackfill(Exception):
    """The mention scan stopped early (flood wait): `found` is what it read before."""

    def __init__(self, found: list):
        super().__init__(len(found))
        self.found = found


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
        self, chat_id: str, reply_to: int, text: str, random_id: int, topic_id: int | None
    ) -> SentMessage: ...
    # Add `emoji` unless we already reacted; None takes back only the bridge's own reaction.
    # Raises SendRejected("retry_after") on a flood wait.
    async def send_reaction(self, chat_id: str, message_id: int, emoji: str | None) -> None: ...
    async def send_saved(self, text: str) -> None: ...  # to my own Saved Messages, in ≤4000-char parts


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
        self._bg: set[asyncio.Task] = set()  # reactions, notifications
        self.me = ""  # logged-in account (@username or name), set by the transport on connect
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
                    await self.backfill_mentions()  # its dialog scan also warms the entity cache
            # ponytail: liveness polling; Telethon 1.x exposes no reconnect event.
            await asyncio.sleep(WATCH_INTERVAL if up else self.retry_delay)

    def ensure_connected(self) -> Transport:
        if self.transport is None or self.state != "connected":
            raise ApiError(503, "not_connected", detail=self.state)
        return self.transport

    # ---- groups / tracking --------------------------------------------
    async def list_groups(self) -> list[GroupInfo]:
        return await self.ensure_connected().list_groups()

    # ---- live updates (called by transport) ----------------------------
    async def on_message(self, m: StoredMessage) -> None:
        try:
            await self.db.write(self.store.apply_message, m)
        except Exception as e:
            log.warning("live message not stored (chat %s, message %s): %s", m.chat_id,
                        m.message_id, type(e).__name__)  # fmt: skip

    async def backfill_mentions(self) -> None:
        """Pull recent tags/replies to us (read or unread); nothing else is fetched. A reconnect
        looks back only to the last complete backfill (Telethon's catch-up replays the rest)."""
        started = datetime.now(UTC)
        cutoff = max(started - timedelta(days=BACKFILL_DAYS), self._backfilled_at - BACKFILL_MARGIN)
        try:
            try:
                found, complete = await self.ensure_connected().fetch_mentions(cutoff), True
            except PartialBackfill as e:  # keep what it read; the next connect looks back as far again
                log.warning("mention backfill cut short after %d tags", len(e.found))
                found, complete = e.found, False
            await self.db.write(self.store.store_mentions, found)
            if complete:
                self._backfilled_at = started
        except Exception as e:
            log.warning("mention backfill failed: %s: %s", type(e).__name__, e)

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
        if fresh and self.notify:
            self._spawn(notify_mac(f"Tag mới · {title}", m.sender_name or "", m.text))

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
            self.store.outbox_create, rid, req.chat_id, reply_to, req.text, secrets.randbits(63)
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
            text=job["text"],
            date=datetime.now(UTC),
            reply_to_id=job["reply_to"],
            topic_id=job["topic_id"],
            outgoing=True,
        )
        return await self.db.write(
            self.store.outbox_finish, rid, "sent", message_id=sent.message_id, sent=msg
        )


# ---- Telethon -------------------------------------------------------------


def _media_kind(msg) -> str | None:
    if not getattr(msg, "media", None):
        return None
    for attr in ("sticker", "voice", "video_note", "gif", "video", "audio", "photo", "document"):
        if getattr(msg, attr, None):
            return attr
    return "media"


def _reply_fields(reply_to) -> tuple[int | None, int | None]:
    if reply_to is None:
        return None, None
    reply_id = getattr(reply_to, "reply_to_msg_id", None)
    topic = None
    if getattr(reply_to, "forum_topic", False):
        topic = getattr(reply_to, "reply_to_top_id", None) or reply_id
    return reply_id, topic


def raw_to_stored(msg, chat_id: str, sender_name: str | None = None) -> StoredMessage:
    reply_id, topic = _reply_fields(getattr(msg, "reply_to", None))
    sender_id = getattr(msg, "sender_id", None)
    if sender_id is None and getattr(msg, "from_id", None) is not None:
        from telethon import utils

        sender_id = utils.get_peer_id(msg.from_id)
    return StoredMessage(
        chat_id=chat_id,
        message_id=msg.id,
        sender_id=None if sender_id is None else str(sender_id),
        sender_name=sender_name,
        text=getattr(msg, "message", None) or "",
        date=msg.date,
        edit_date=getattr(msg, "edit_date", None),
        reply_to_id=reply_id,
        topic_id=topic,
        outgoing=bool(getattr(msg, "out", False)),
        media_kind=_media_kind(msg),
        links=[s for e in getattr(msg, "entities", None) or [] if (s := _span(e))],
    )


def _span(e) -> LinkSpan | None:
    """Entities the UI renders: hidden links, name mentions, code and text formatting."""
    at = {"offset": e.offset, "length": e.length}
    if getattr(e, "url", None):  # MessageEntityTextUrl
        return LinkSpan(**at, url=e.url)
    if isinstance(getattr(e, "user_id", None), int):  # MessageEntityMentionName
        return LinkSpan(**at, url=f"tg://user?id={e.user_id}", kind="mention")
    if kind := _STYLE.get(type(e).__name__):
        return LinkSpan(**at, kind=kind)
    return None


_STYLE = {
    "MessageEntityCode": "code", "MessageEntityPre": "pre", "MessageEntityBold": "bold",
    "MessageEntityItalic": "italic", "MessageEntityUnderline": "underline", "MessageEntityStrike": "strike",
    "MessageEntitySpoiler": "spoiler", "MessageEntityBlockquote": "blockquote",
}  # fmt: skip


class TelethonTransport:
    def __init__(self, settings):
        from telethon import TelegramClient

        self.client = TelegramClient(
            str(settings.session_path),
            settings.telegram_api_id,
            settings.telegram_api_hash,
            flood_sleep_threshold=0,
            request_retries=0,
            connection_retries=1,  # blocked network: degraded after ~20s, not ~70s; the bridge retries
            catch_up=True,
        )
        self.bridge: TelegramBridge | None = None

    def attach(self, bridge: TelegramBridge) -> None:
        from telethon import events

        self.bridge = bridge
        c = self.client
        c.add_event_handler(self._on_new, events.NewMessage())
        c.add_event_handler(self._on_edit, events.MessageEdited())
        c.add_event_handler(self._on_deleted, events.MessageDeleted())

    async def _convert(self, msg) -> StoredMessage:
        from telethon import utils

        name = None
        try:  # the cached sender first: get_sender() is a network call when it is missing or "min"
            sender = msg.sender or await msg.get_sender()
            name = utils.get_display_name(sender) if sender else None
        except Exception as e:  # stored without a sender name
            log.debug("sender of message %s not resolved: %s", msg.id, type(e).__name__)
        return raw_to_stored(msg, str(msg.chat_id), name)

    async def _on_new(self, event, edit: bool = False) -> None:
        from telethon import utils
        from telethon.tl import types

        assert self.bridge is not None
        msg = event.message
        if isinstance(getattr(msg, "action", None), types.MessageActionChatMigrateTo):
            new_id = utils.get_peer_id(types.PeerChannel(msg.action.channel_id))
            await self.bridge.on_migrated(str(event.chat_id), str(new_id))
            return
        chat_id = str(event.chat_id)
        if not event.is_group:
            return
        b = self.bridge
        if getattr(msg, "out", False):
            reply_to = getattr(msg.reply_to, "reply_to_msg_id", None) if msg.is_reply else None
            if reply_to and await b.db.read(b.store.get_message, chat_id, reply_to):
                m = await self._convert(msg)
                # Editing an old reply only updates it: it never re-closes a tag the user reopened.
                await (b.on_message(m) if edit else b.on_my_reply(m))
            return
        if msg.mentioned:  # @username, text mention or a reply to us (Telegram flags all three)
            chat = await event.get_chat()
            title = getattr(chat, "title", None) or chat_id
            kind = "supergroup" if event.is_channel else "group"
            await b.on_mention(await self._convert(msg), title, kind)
        elif await b.db.read(b.store.get_message, chat_id, msg.id):  # edit of a kept message
            await b.on_message(await self._convert(msg))

    async def _on_edit(self, event) -> None:
        await self._on_new(event, edit=True)  # on_mention notifies only for tags it has not seen before

    async def _on_deleted(self, event) -> None:
        assert self.bridge is not None
        chat_id = None if event.chat_id is None else str(event.chat_id)
        await self.bridge.on_deleted(chat_id, list(event.deleted_ids))

    async def connect(self) -> bool:
        from telethon import errors

        try:
            if not self.client.is_connected():
                await self.client.connect()
            ok = await self.client.is_user_authorized()
            if ok and self.bridge is not None and not self.bridge.me:
                self.bridge.me = await self._whoami()
            return ok
        except (
            errors.AuthKeyError,
            errors.AuthKeyUnregisteredError,
            errors.SessionRevokedError,
            errors.UserDeactivatedError,
            errors.UserDeactivatedBanError,
        ) as e:
            raise LoginRequired() from e

    async def _whoami(self) -> str:
        from telethon import utils

        try:
            me = await self.client.get_me()
        except Exception as e:  # drafts just miss the hint
            log.debug("get_me failed: %s", type(e).__name__)
            return ""
        return f"@{me.username}" if getattr(me, "username", None) else utils.get_display_name(me)

    # ---- login from the dashboard (Settings) --------------------------------
    async def send_code(self, phone: str) -> None:
        from telethon import errors

        try:
            if not self.client.is_connected():
                await self.client.connect()
            self._phone = phone
            try:
                sent = await self.client.send_code_request(phone)
            except ValueError:  # request_retries=0: PHONE_MIGRATE only switched DC; ask again
                sent = await self.client.send_code_request(phone)
            self._code_hash = sent.phone_code_hash
        except errors.FloodWaitError as e:
            raise ApiError(429, "flood_wait", retry_after=e.seconds) from e
        except (errors.PhoneNumberInvalidError, errors.PhoneNumberBannedError) as e:
            raise ApiError(422, "phone_invalid") from e
        except errors.ApiIdInvalidError as e:
            raise ApiError(422, "api_invalid") from e

    async def sign_in(self, code: str | None, password: str | None) -> bool:
        """True when logged in; False when the account has 2FA and the password is still needed."""
        from telethon import errors

        try:
            if password:
                await self.client.sign_in(password=password)
            elif getattr(self, "_code_hash", None) and code:
                await self.client.sign_in(self._phone, code, phone_code_hash=self._code_hash)
            else:
                raise ApiError(409, "code_not_sent")
        except errors.SessionPasswordNeededError:
            return False
        except errors.FloodWaitError as e:
            raise ApiError(429, "flood_wait", retry_after=e.seconds) from e
        except (errors.PhoneCodeInvalidError, errors.PhoneCodeEmptyError) as e:
            raise ApiError(422, "code_invalid") from e
        except errors.PhoneCodeExpiredError as e:
            raise ApiError(422, "code_expired") from e
        except errors.PasswordHashInvalidError as e:
            raise ApiError(422, "password_invalid") from e
        self._code_hash = None
        return True

    async def disconnect(self) -> None:
        await self.client.disconnect()

    def is_connected(self) -> bool:
        return self.client.is_connected()

    async def list_groups(self) -> list[GroupInfo]:
        out = []
        async for d in self.client.iter_dialogs():
            if not d.is_group:
                continue
            e = d.entity
            if getattr(e, "deactivated", False):
                continue
            out.append(
                GroupInfo(
                    chat_id=str(d.id),
                    title=d.name or str(d.id),
                    kind="supergroup" if d.is_channel else "group",
                    migrated=getattr(e, "migrated_to", None) is not None,
                )
            )
        return out

    async def fetch_mentions(
        self, cutoff: datetime
    ) -> list[tuple[str, str, StoredMessage, bool]]:
        from telethon import errors
        from telethon.tl.types import InputMessagesFilterMyMentions

        out = []
        try:
            async for d in self.client.iter_dialogs():
                if not d.is_group or (d.date and d.date < cutoff):
                    continue  # dialogs come newest-activity first, but pinned ones break the order
                tags = []
                it = self.client.iter_messages(d.id, filter=InputMessagesFilterMyMentions)
                async for m in it:
                    if m.date < cutoff:
                        break  # newest first
                    tags.append(m)
                if not tags:
                    continue
                # Which tags we already answered: our own replies to them since the oldest.
                oldest = min(m.date for m in tags)
                replied: set[int] = set()
                async for m in self.client.iter_messages(d.id, from_user="me"):
                    if m.date < oldest:
                        break
                    if (rid := getattr(m.reply_to, "reply_to_msg_id", None)) is not None:
                        replied.add(rid)
                title, kind = d.name or str(d.id), "supergroup" if d.is_channel else "group"
                out += [(title, kind, await self._convert(m), m.id in replied) for m in tags]
        except errors.FloodWaitError as e:  # keep what we have; the next connect tries again
            log.warning("mention backfill cut short by a %ss flood wait", e.seconds)
            raise PartialBackfill(out) from e
        return out

    async def fetch_context(
        self, chat_id: str, message_id: int, before: int, after: int
    ) -> list[StoredMessage]:
        peer = int(chat_id)
        # offset_id is exclusive: +1 brings the message itself with the `before` older ones, one request
        older = [m async for m in self.client.iter_messages(peer, offset_id=message_id + 1, limit=before + 1)]
        if older and older[0].id != message_id:  # the message itself is gone
            older = older[:before]
        newer = []
        if after:
            newer = [m async for m in self.client.iter_messages(peer, min_id=message_id, reverse=True, limit=after)]
        return [await self._convert(m) for m in [*reversed(older), *newer]]

    async def fetch_older(self, chat_id: str, before: int | None, limit: int) -> list[StoredMessage]:
        it = self.client.iter_messages(int(chat_id), offset_id=before or 0, limit=limit)
        return [await self._convert(m) for m in reversed([m async for m in it])]

    async def download_photo(self, chat_id: str, message_id: int, dest: Path) -> bool:
        msg = await self.client.get_messages(int(chat_id), ids=message_id)
        if msg is None or not getattr(msg, "photo", None):
            return False
        # a private temp name, then rename: a failed or concurrent download never leaves a broken "cached" photo
        tmp = dest.with_name(f".{dest.stem}.{secrets.token_hex(4)}.jpg")
        try:
            if await self.client.download_media(msg, file=str(tmp)) is None:
                return False
            os.replace(tmp, dest)
            return True
        finally:
            tmp.unlink(missing_ok=True)

    async def latest_id(self, chat_id: str) -> int:
        msgs = await self.client.get_messages(int(chat_id), limit=1)
        return msgs[0].id if msgs else 0

    async def fetch_range(
        self, chat_id: str, since: datetime, until: datetime, limit: int
    ) -> list[StoredMessage]:
        out = []
        # wait_time=0: no 1s pause per 100-message chunk (the loop stops itself at `since`/limit)
        it = self.client.iter_messages(int(chat_id), offset_date=until, wait_time=0)
        async for m in it:
            if m.date < since or len(out) >= limit:
                break
            if not getattr(m, "action", None):  # skip service messages (joins, pins…)
                out.append(await self._convert(m))
        out.reverse()
        return out

    async def fetch_ids(self, chat_id: str, ids: list[int]) -> list[StoredMessage]:
        msgs = await self.client.get_messages(int(chat_id), ids=ids, wait_time=0)  # ≤4 chunks
        keep = [m for m in msgs if m is not None and not getattr(m, "action", None)]
        return [await self._convert(m) for m in keep]

    async def send_reaction(self, chat_id: str, message_id: int, emoji: str | None) -> None:
        from telethon import errors
        from telethon.tl import functions, types

        assert self.bridge is not None
        ours = types.ReactionEmoji(emoticon=emoji or self.bridge.reaction)
        try:
            peer = await self.client.get_input_entity(int(chat_id))
            # SendReaction replaces our whole set: read what we picked so the user's own stays.
            msg = await self.client.get_messages(peer, ids=message_id)
            if msg is None:
                return
            results = getattr(msg.reactions, "results", None) or []
            chosen = [r.reaction for r in sorted(
                (r for r in results if r.chosen_order is not None), key=lambda r: r.chosen_order
            )]  # fmt: skip
            if emoji:
                if chosen:
                    return  # already reacted (ours or the user's): leave it
                new = [ours]
            elif ours in chosen:
                new = [r for r in chosen if r != ours]
            else:
                return  # nothing of ours to take back
            await self.client(
                functions.messages.SendReactionRequest(peer=peer, msg_id=message_id, reaction=new)
            )
        except (errors.FloodWaitError, errors.SlowModeWaitError) as e:
            raise SendRejected("retry_after", int(e.seconds)) from e

    async def send_saved(self, text: str) -> None:
        from telethon import errors

        try:
            for part in chunks(text):
                await self.client.send_message("me", part, parse_mode="md", link_preview=False)
        except errors.FloodWaitError as e:
            raise SendRejected("retry_after", int(e.seconds)) from e

    async def send_reply(
        self, chat_id: str, reply_to: int, text: str, random_id: int, topic_id: int | None
    ) -> SentMessage:
        from telethon import errors
        from telethon.tl import functions, types

        try:
            peer = await self.client.get_input_entity(int(chat_id))
            result = await self.client(
                functions.messages.SendMessageRequest(
                    peer=peer,
                    message=text,
                    random_id=random_id,
                    reply_to=types.InputReplyToMessage(
                        reply_to_msg_id=reply_to, top_msg_id=topic_id
                    ),
                )
            )
        except (errors.FloodWaitError, errors.SlowModeWaitError) as e:
            raise SendRejected("retry_after", int(e.seconds)) from e
        except (
            errors.ChatWriteForbiddenError,
            errors.ChatAdminRequiredError,
            errors.UserBannedInChannelError,
            errors.ChannelPrivateError,
        ) as e:
            raise SendRejected("forbidden") from e
        except errors.MessageIdInvalidError as e:
            raise SendRejected("reply_not_found") from e
        # Unknown errors (incl. RANDOM_ID_DUPLICATE) propagate => outbox status unknown.

        if isinstance(result, types.UpdateShortSentMessage):
            return SentMessage(message_id=result.id)
        updates = getattr(result, "updates", [])
        msg_id = next(
            (
                u.id
                for u in updates
                if isinstance(u, types.UpdateMessageID) and u.random_id == random_id
            ),
            None,
        )
        for u in updates:
            if isinstance(u, (types.UpdateNewMessage, types.UpdateNewChannelMessage)) and (
                msg_id is None or u.message.id == msg_id
            ):
                return SentMessage(
                    message_id=u.message.id, message=raw_to_stored(u.message, chat_id)
                )
        if msg_id is not None:
            return SentMessage(message_id=msg_id)
        raise RuntimeError("send result without message id")


def chunks(text: str, size: int = 4000) -> list[str]:
    """Split at line breaks (a longer line is cut) so each part fits one Telegram message."""
    out, cur = [], ""
    for line in text.splitlines(keepends=True):
        for piece in [line[i : i + size] for i in range(0, len(line), size)]:
            if cur and len(cur) + len(piece) > size:
                out.append(cur)
                cur = ""
            cur += piece
    out.append(cur)
    return [p for p in out if p.strip()]


async def notify_mac(title: str, subtitle: str, body: str) -> None:
    """Best-effort macOS banner; failures (other OS, no permission) are ignored."""
    q = _applescript_str
    script = (
        f"display notification {q(body[:200])} with title {q(title[:80])} "
        f'subtitle {q(subtitle[:80])} sound name "Glass"'
    )
    await run_cli(["osascript", "-e", script], timeout=10)
