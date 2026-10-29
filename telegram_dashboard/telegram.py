"""Telegram bridge: owns ingest, recovery and reply sending. Transport hides Telethon."""

import asyncio
import logging
import secrets
from datetime import UTC, datetime
from typing import Protocol

from .errors import ApiError
from .models import GroupInfo, OutboxDTO, ReplyRequest, SentMessage, StoredMessage
from .storage import INITIAL_HISTORY_LIMIT, Db, Store

log = logging.getLogger("telegram_dashboard.telegram")

RECOVERY_BATCH = 100
SEND_TIMEOUT = 30.0
RETRY_DELAY = 5.0
WATCH_INTERVAL = 20.0


class LoginRequired(Exception):
    """Session missing, expired or revoked."""


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
    async def latest_id(self, chat_id: str) -> int: ...
    async def fetch_latest(self, chat_id: str, limit: int) -> list[StoredMessage]: ...
    async def fetch_after(self, chat_id: str, after_id: int, limit: int) -> list[StoredMessage]: ...
    async def send_reply(
        self, chat_id: str, reply_to: int, text: str, random_id: int, topic_id: int | None
    ) -> SentMessage: ...


class TelegramBridge:
    def __init__(
        self, store: Store, db: Db, transport: Transport | None, *, retry_delay=RETRY_DELAY
    ):
        self.store = store
        self.db = db
        self.transport = transport
        self.retry_delay = retry_delay
        self.state = "setup_required" if transport is None else "stopped"
        self.detail: str | None = None
        self.sync_state: dict[str, str] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._main: asyncio.Task | None = None
        self._send_lock = asyncio.Lock()
        if transport is not None:
            transport.attach(self)

    # ---- lifecycle -----------------------------------------------------
    def _set_state(self, state: str, detail: str | None = None) -> None:
        if (state, detail) != (self.state, self.detail):
            self.state, self.detail = state, detail
            self.db.hub.notify()

    async def start(self) -> None:
        if self.transport is not None and self._main is None:
            self._main = asyncio.create_task(self._run())

    async def stop(self) -> None:
        tasks = [t for t in [self._main, *self._tasks.values()] if t]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._main = None
        if self.transport is not None:
            try:
                await self.transport.disconnect()
            except Exception:
                log.warning("disconnect failed", exc_info=False)
        if self.state != "setup_required":
            self._set_state("stopped")

    async def _run(self) -> None:
        assert self.transport is not None
        self._set_state("connecting")
        while True:
            try:
                if not await self.transport.connect():
                    self._set_state("login_required")
                    return
                await self.transport.list_groups()  # warms the entity cache for tracked ids
                break
            except LoginRequired:
                self._set_state("login_required")
                return
            except Exception as e:
                self._set_state("degraded", type(e).__name__)
                await asyncio.sleep(self.retry_delay)
        self._set_state("connected")
        await self.recover_all()
        # ponytail: liveness polling; Telethon 1.x exposes no reconnect event.
        was_connected = True
        while True:
            await asyncio.sleep(WATCH_INTERVAL)
            now_connected = self.transport.is_connected()
            if not now_connected:
                self._set_state("degraded", "disconnected")
                try:
                    now_connected = await self.transport.connect()
                except LoginRequired:
                    self._set_state("login_required")
                    return
                except Exception:
                    now_connected = False
            if now_connected and not was_connected:
                self._set_state("connected")
                await self.recover_all()
            was_connected = now_connected

    def ensure_connected(self) -> Transport:
        if self.transport is None or self.state != "connected":
            raise ApiError(503, "not_connected", detail=self.state)
        return self.transport

    # ---- groups / tracking --------------------------------------------
    async def list_groups(self) -> list[GroupInfo]:
        return await self.ensure_connected().list_groups()

    async def recover_all(self) -> None:
        for chat_id in await self.db.read(self.store.tracked_chat_ids):
            self.schedule_sync(chat_id)

    def schedule_sync(self, chat_id: str, delay: float = 0) -> None:
        task = self._tasks.get(chat_id)
        if task is not None and not task.done():
            return
        self._tasks[chat_id] = asyncio.create_task(self._sync_loop(chat_id, delay))

    async def _sync_loop(self, chat_id: str, delay: float) -> None:
        if delay:
            await asyncio.sleep(delay)
        self.sync_state[chat_id] = "syncing"
        self.db.hub.notify()
        while True:
            try:
                await self.sync_chat(chat_id)
                self.sync_state.pop(chat_id, None)
                self.db.hub.notify()
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("sync failed for a tracked chat: %s", type(e).__name__)
                self.sync_state[chat_id] = "degraded"
                self.db.hub.notify()
                await asyncio.sleep(self.retry_delay)

    async def sync_chat(self, chat_id: str) -> None:
        """Initial (<=50) load, then ascending recovery from the history checkpoint."""
        transport = self.ensure_connected()
        state = await self.db.read(self.store.history_checkpoint, chat_id)
        if state is None:
            return
        checkpoint, gen = state
        if checkpoint is None:
            latest = await transport.fetch_latest(chat_id, INITIAL_HISTORY_LIMIT)
            top = max((m.message_id for m in latest), default=0)
            if not await self.db.write(self.store.apply_history_batch, chat_id, gen, latest, top):
                return
            return
        upper = await transport.latest_id(chat_id)  # bound captured before scanning
        while checkpoint < upper:
            batch = await transport.fetch_after(chat_id, checkpoint, RECOVERY_BATCH)
            batch = [m for m in batch if checkpoint < m.message_id <= upper]
            nxt = batch[-1].message_id if batch else upper
            if not await self.db.write(self.store.apply_history_batch, chat_id, gen, batch, nxt):
                return
            checkpoint = nxt

    # ---- live updates (called by transport) ----------------------------
    async def on_message(self, m: StoredMessage) -> None:
        try:
            await self.db.write(self.store.apply_message, m)
        except Exception as e:
            log.warning("live message not stored: %s", type(e).__name__)
            self.schedule_sync(m.chat_id, self.retry_delay)

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
    )


class TelethonTransport:
    def __init__(self, settings):
        from telethon import TelegramClient

        self.client = TelegramClient(
            str(settings.session_path),
            settings.telegram_api_id,
            settings.telegram_api_hash,
            flood_sleep_threshold=0,
            request_retries=0,
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
        try:
            sender = await msg.get_sender()
            name = utils.get_display_name(sender) if sender else None
        except Exception:
            pass
        return raw_to_stored(msg, str(msg.chat_id), name)

    async def _on_new(self, event) -> None:
        from telethon import utils
        from telethon.tl import types

        assert self.bridge is not None
        msg = event.message
        if isinstance(getattr(msg, "action", None), types.MessageActionChatMigrateTo):
            new_id = utils.get_peer_id(types.PeerChannel(msg.action.channel_id))
            await self.bridge.on_migrated(str(event.chat_id), str(new_id))
            return
        if not await asyncio.to_thread(self.bridge.store.is_tracking, str(event.chat_id)):
            return  # never fetch sender/convert for untracked chats
        await self.bridge.on_message(await self._convert(msg))

    _on_edit = _on_new

    async def _on_deleted(self, event) -> None:
        assert self.bridge is not None
        chat_id = None if event.chat_id is None else str(event.chat_id)
        await self.bridge.on_deleted(chat_id, list(event.deleted_ids))

    async def connect(self) -> bool:
        from telethon import errors

        try:
            if not self.client.is_connected():
                await self.client.connect()
            return await self.client.is_user_authorized()
        except (
            errors.AuthKeyError,
            errors.AuthKeyUnregisteredError,
            errors.SessionRevokedError,
            errors.UserDeactivatedError,
            errors.UserDeactivatedBanError,
        ) as e:
            raise LoginRequired() from e

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

    async def latest_id(self, chat_id: str) -> int:
        msgs = await self.client.get_messages(int(chat_id), limit=1)
        return msgs[0].id if msgs else 0

    async def fetch_latest(self, chat_id: str, limit: int) -> list[StoredMessage]:
        out = [
            await self._convert(m)
            async for m in self.client.iter_messages(int(chat_id), limit=limit)
        ]
        out.reverse()
        return out

    async def fetch_after(self, chat_id: str, after_id: int, limit: int) -> list[StoredMessage]:
        it = self.client.iter_messages(int(chat_id), min_id=after_id, reverse=True, limit=limit)
        return [await self._convert(m) async for m in it]

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
