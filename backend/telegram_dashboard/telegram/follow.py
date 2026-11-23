"""Briefing follow-ups: Chờ bổ sung (items, or any group message, still waiting on someone else: a design / the BU for
the PO, BE / the PO for a Dev, a build / a fix for QC, or the user's own reasons) and the items the PO already put into
a story (Cập nhật story). Kept in data/ so every browser and machine sees the same list."""

import asyncio
import logging
import math
import shutil
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, ValidationError

from ..config import Settings, _read_json, write_private_json
from .live_reads import TelegramReads

log = logging.getLogger(__name__)
REPLY_DAYS_MAX = 30  # older waits are read over this window only
REPLIES_PER_ITEM = 3

WAITS_MAX = 500  # oldest waits drop off past this
STORIED_MAX = 500  # oldest "đã vào story" marks drop off past this
DONE_MAX = 2000  # oldest "đã xử lý" ticks drop off past this


class FollowWait(BaseModel):
    key: str = Field(max_length=4000)  # the digest item's key (todoKey)
    chat_id: str = Field(max_length=100)
    # PO: design / BU; Dev: BE / PO; QC: build / fix (defaults, Cài đặt changes them); "other": the user's own reason
    on: Literal["design", "bu", "be", "po", "build", "fix", "other"]
    label: str = Field("", max_length=60)  # "other": the reason as the user wrote it
    text: str = Field(max_length=4000)
    why: str = Field("", max_length=4000)
    who: str = Field("", max_length=200)  # who must answer / do it (the item's "who"): tagged by "Nhắc"
    tickets: list[str] = Field(default_factory=list, max_length=20)
    message_ids: list[str] = Field(default_factory=list, max_length=100)
    state: str = Field("", max_length=200)  # its first ticket's State when parked: "có vẻ xong" once it moved on
    at: int  # ms, when it was parked


class FollowStory(BaseModel):
    id: str = Field(max_length=40)  # the ticket whose description took it
    at: int


class Follow(BaseModel):
    waits: list[FollowWait] = Field(default_factory=list)  # oldest first
    storied: dict[str, FollowStory] = Field(default_factory=dict)  # item key -> where it went


class FollowChange(BaseModel):
    add: list[FollowWait] = Field(default_factory=list, max_length=100)  # parked; a wait of the same key is replaced
    drop: list[str] = Field(default_factory=list, max_length=500)  # wait keys no longer waiting
    storied: dict[str, FollowStory] = Field(default_factory=dict)  # item key -> the ticket that took it


class WaitRef(BaseModel):
    key: str = Field(max_length=4000)
    chat_id: str = Field(max_length=100)
    message_ids: list[str] = Field(max_length=100)
    at: int  # ms, when it was parked: only replies after it count


class WaitRefs(BaseModel):
    items: list[WaitRef] = Field(max_length=100)


class WaitReply(BaseModel):
    message_id: str
    sender: str
    text: str
    date: datetime


class WaitReplies(BaseModel):
    replies: dict[str, list[WaitReply]] = Field(default_factory=dict)  # wait key -> others' replies, oldest first
    failed: list[str] = Field(default_factory=list)  # groups that could not be read (said, not shown as "no reply")


class DoneChange(BaseModel):
    keys: list[str] = Field(max_length=500)
    on: bool  # ticked done, or open again


def build_router(settings: Settings, live_reads: TelegramReads) -> APIRouter:
    r = APIRouter(prefix="/api/briefing")
    lock = asyncio.Lock()  # one write at a time

    def path():
        return settings.data_dir / "briefing_follow.json"

    def read() -> tuple[Follow, int]:
        """What the file holds, and how many of its items this version cannot read (a hand edit, a newer version's
        file after a rollback): those are left out, the rest stays."""
        raw, waits, storied, bad = _read_json(path()), [], {}, 0
        for x in raw.get("waits") if isinstance(raw.get("waits"), list) else []:
            try:
                waits.append(FollowWait.model_validate(x))
            except ValidationError:
                bad += 1
        for k, v in (raw.get("storied") if isinstance(raw.get("storied"), dict) else {}).items():
            try:
                storied[k] = FollowStory.model_validate(v)
            except ValidationError:
                bad += 1
        return Follow(waits=waits, storied=storied), bad

    @r.get("/follow")
    async def get_follow() -> Follow:
        return (await asyncio.to_thread(read))[0]

    @r.post("/follow")
    async def change_follow(body: FollowChange) -> Follow:
        """One change, merged here (the page does not send the list back), so two tabs do not undo each other."""
        gone = {*body.drop, *(w.key for w in body.add)}
        async with lock:
            cur, bad = await asyncio.to_thread(read)
            waits = sorted([w for w in cur.waits if w.key not in gone] + body.add, key=lambda w: w.at)
            storied = sorted({**cur.storied, **body.storied}.items(), key=lambda kv: kv[1].at)
            out = Follow(waits=waits[-WAITS_MAX:], storied=dict(storied[-STORIED_MAX:]))
            settings.ensure_data_dir()
            if bad:  # the write drops what could not be read: the file as it was stays beside it
                log.warning("briefing follow: %d unreadable item(s) left out, the old file kept as .bad.json", bad)
                await asyncio.to_thread(shutil.copyfile, path(), path().with_suffix(".bad.json"))
            await asyncio.to_thread(write_private_json, path(), out.model_dump())
        return out

    @r.post("/follow/replies")
    async def wait_replies(body: WaitRefs, request: Request) -> WaitReplies:
        """Replies from others to the messages a wait cites, after it was parked: "có vẻ xong" for Chờ BE / PO / BU.
        Reads each group once through the Q&A memo (TTL + LIVE_READS)."""
        bridge = request.app.state.bridge
        out = WaitReplies()
        if not body.items:
            return out
        if bridge.state != "connected":  # nothing can be read: said, not shown as "no reply"
            out.failed = sorted({it.chat_id for it in body.items})
            return out
        now = datetime.now(UTC).timestamp() * 1000
        by_chat: dict[str, list[WaitRef]] = {}
        for it in body.items:
            by_chat.setdefault(it.chat_id, []).append(it)

        async def one(chat_id: str, items: list[WaitRef]):
            days = min(REPLY_DAYS_MAX, max(1, math.ceil((now - min(i.at for i in items)) / 864e5) + 1))
            try:
                msgs = await live_reads.qa(bridge, chat_id, days)
            except Exception as e:  # one unreachable group must not hide the others
                log.warning("wait replies: %s unread: %r", chat_id, e)
                out.failed.append(chat_id)
                return
            for it in items:
                ids = set(it.message_ids)
                hits = sorted(
                    (m for m in msgs if m.reply_to_id and str(m.reply_to_id) in ids and not m.outgoing
                     and not m.deleted and m.date.timestamp() * 1000 > it.at),
                    key=lambda m: m.date,
                )  # fmt: skip
                if hits:
                    out.replies[it.key] = [
                        WaitReply(message_id=str(m.message_id), sender=m.sender_name or "?", text=m.text[:300],
                                  date=m.date)  # fmt: skip
                        for m in hits[:REPLIES_PER_ITEM]
                    ]

        await asyncio.gather(*(one(c, its) for c, its in by_chat.items()))
        return out

    def done_path():
        return settings.data_dir / "briefing_done.json"

    def read_done() -> list[str]:
        v = _read_json(done_path()).get("keys")
        return [k for k in v if isinstance(k, str)] if isinstance(v, list) else []

    @r.get("/done")
    async def get_done() -> list[str]:
        """The Briefing items ticked done ("đã xử lý"), oldest first: the same on every browser / machine."""
        return await asyncio.to_thread(read_done)

    @r.post("/done")
    async def set_done(body: DoneChange) -> list[str]:
        """Ticks `keys` on or off, merged here (not the whole list sent back), so two tabs do not undo each other."""
        gone = set(body.keys)
        async with lock:
            keep = [k for k in await asyncio.to_thread(read_done) if k not in gone]
            if body.on:
                keep += [k[:4000] for k in dict.fromkeys(body.keys)]
            keep = keep[-DONE_MAX:]
            settings.ensure_data_dir()
            await asyncio.to_thread(write_private_json, done_path(), {"keys": keep})
        return keep

    return r
