"""Telethon transport: the only module that talks to Telegram (connect, login, ingest events, reads, send)."""

import logging
import os
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path

from .. import ai
from ..errors import ApiError
from ..models import GroupInfo, LinkSpan, Member, SentMessage, StoredMessage
from .bridge import LoginRequired, PartialBackfill, SendRejected, TelegramBridge, split_format

log = logging.getLogger("telegram_dashboard.telegram")


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
        ai.cached_username = self.cached_username
        c = self.client
        c.add_event_handler(self._on_new, events.NewMessage())
        c.add_event_handler(self._on_edit, events.MessageEdited())
        c.add_event_handler(self._on_deleted, events.MessageDeleted())

    def cached_username(self, user_id: str) -> str | None:
        """A user's @username from the session's entity cache (no network call): stored messages keep none."""
        if not self.client.is_connected():
            return None  # logged out: the session file may be gone, and a read would create an empty one
        try:  # ponytail: Telethon's private _execute; its public lookups return (id, hash) only
            row = self.client.session._execute("select username from entities where id = ?", int(user_id))
        except (AttributeError, ValueError, sqlite3.Error):
            return None
        return row[0] if row and row[0] else None

    async def _convert(self, msg) -> StoredMessage:
        from telethon import utils

        name = username = None
        try:  # the cached sender first: get_sender() is a network call when it is missing or "min"
            sender = msg.sender or await msg.get_sender()
            name = utils.get_display_name(sender) if sender else None
            username = getattr(sender, "username", None)
        except Exception as e:  # stored without a sender name
            log.debug("sender of message %s not resolved: %s", msg.id, type(e).__name__)
        return raw_to_stored(msg, str(msg.chat_id), name).model_copy(update={"sender_username": username})

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
        reply_to = getattr(msg.reply_to, "reply_to_msg_id", None) if msg.is_reply else None
        if getattr(msg, "out", False):
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
        elif not edit and reply_to:
            # someone answers a tag (or my reply to it) without tagging me: a "Tới khi có người trả lời" snooze wakes
            if await b.db.read(b.store.reply_snoozed, chat_id, reply_to):
                await b.db.write(b.store.wake_on_reply, chat_id, reply_to)

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
        name = utils.get_display_name(me)
        if self.bridge is not None:
            self.bridge.me_name = name
        return f"@{me.username}" if getattr(me, "username", None) else name

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
            raise PartialBackfill(out, e.seconds) from e
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

    async def members(self, chat_id: str) -> list[Member]:
        from telethon import errors, utils

        try:  # ponytail: first 1000 only; a bigger group would need a server-side search per typed name
            users = await self.client.get_participants(int(chat_id), limit=1000)
        except (errors.ChatAdminRequiredError, errors.ChannelPrivateError) as e:
            raise ApiError(403, "members_hidden") from e
        return [
            Member(user_id=str(u.id), name=utils.get_display_name(u) or str(u.id), username=u.username or None)
            for u in users
            if not (u.is_self or u.deleted)
        ]

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

    async def _entities(self, tags: list[tuple[int, int, int | str]]) -> list:
        from telethon import utils
        from telethon.tl import types

        out = []
        for off, length, uid in tags:
            if uid == "code":
                out.append(types.MessageEntityCode(off, length))
                continue
            if uid == "pre":
                out.append(types.MessageEntityPre(off, length, ""))
                continue
            try:  # known from the members list (session cache); unknown: the name goes as plain text
                user = utils.get_input_user(await self.client.get_input_entity(uid))
            except (ValueError, TypeError):
                log.info("mention of %s sent as plain text: user not cached", uid)
                continue
            out.append(types.InputMessageEntityMentionName(off, length, user))
        return out

    async def send_reply(
        self, chat_id: str, reply_to: int | None, text: str, random_id: int, topic_id: int | None
    ) -> SentMessage:
        from telethon import errors
        from telethon.tl import functions, types

        text, tags = split_format(text)
        entities = await self._entities(tags)
        try:
            peer = await self.client.get_input_entity(int(chat_id))
            result = await self.client(
                functions.messages.SendMessageRequest(
                    peer=peer,
                    message=text,
                    random_id=random_id,
                    entities=entities or None,
                    # a new message in a forum topic still "replies" to the topic's top message
                    reply_to=types.InputReplyToMessage(reply_to_msg_id=reply_to, top_msg_id=topic_id)
                    if reply_to
                    else types.InputReplyToMessage(reply_to_msg_id=topic_id) if topic_id else None,
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
