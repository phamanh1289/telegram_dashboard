"""Shared SQL fragments and row/time helpers of the store."""

import hashlib
import json
import sqlite3
import unicodedata
import uuid
from datetime import UTC, datetime

from ..models import StoredMessage

# A tag still waiting for the user (messages aliased `m`); snoozed ones come back on their own.
PENDING = "m.outgoing=0 AND m.handled=0 AND m.deleted=0 AND COALESCE(m.snoozed_until,0)<=unixepoch()"
# A session is Done (tasks `t`, its tag `m`): a kept tag's Done, else its own. A reply (on Telegram, or the session's
# asks) handles the tag but leaves the session in Doing.
_TASK_DONE = "(CASE WHEN m.deleted=0 THEN m.handled AND m.handled_by NOT IN ('reply', 'dashboard') ELSE t.done END)"

# Old enough to clear (Settings › Dữ liệu): handled tags and our replies, not pinned, not used by an AI session
# (its turns or its tag) or by an open Báo lại item. Alias `m`, one parameter: the cutoff.
# NOT IN lists (read once each), not NOT EXISTS: those lookups have no index and ran once per message (75 s at
# 190k messages against 0.4 s).
_OLD_MSG = (
    "m.deleted=0 AND m.pinned=0 AND (m.handled=1 OR m.outgoing=1) AND m.date<? "
    "AND (m.chat_id, m.message_id) NOT IN (SELECT chat_id, message_id FROM task_refs) "
    "AND (m.chat_id, m.message_id) NOT IN "
    "(SELECT chat_id, message_id FROM tasks WHERE chat_id IS NOT NULL AND message_id IS NOT NULL) "
    "AND (m.chat_id, m.message_id) NOT IN (SELECT chat_id, message_id FROM loop_back WHERE done=0)"
)
# ponytail: a stored message's size, estimated from its text columns plus a fixed row overhead
_ROW_BYTES = (
    "COALESCE(SUM(LENGTH(m.text) + LENGTH(m.text_fold) + LENGTH(m.links) "
    "+ LENGTH(COALESCE(m.sender_name, '')) + 64), 0)"
)


def now_ts() -> int:
    return int(datetime.now(UTC).timestamp())


def _dt(ts: int | None) -> datetime | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC)


def _ts(dt: datetime | None) -> int | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp())


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def reply_code(request_id: str) -> str:
    """Stable short code for an outbox row, derived so retries keep the same code."""
    return "R-" + hashlib.sha256(request_id.encode()).hexdigest()[:8].upper()


def format_cursor(epoch: str, revision: int) -> str:
    return f"{epoch}:{revision}"


def parse_cursor(value: str | None) -> tuple[str, int] | None:
    if not value:
        return None
    epoch, sep, rev = value.rpartition(":")
    if not sep or not rev.isdecimal() or len(rev) > 18:
        return None
    try:
        uuid.UUID(epoch)
    except ValueError:
        return None
    return epoch, int(rev)


def _row_to_message(r: sqlite3.Row) -> StoredMessage:
    return StoredMessage(
        chat_id=r["chat_id"],
        message_id=r["message_id"],
        sender_id=r["sender_id"],
        sender_name=r["sender_name"],
        text=r["text"],
        date=_dt(r["date"]),
        edit_date=_dt(r["edit_date"]),
        reply_to_id=r["reply_to_id"],
        topic_id=r["topic_id"],
        outgoing=bool(r["outgoing"]),
        media_kind=r["media_kind"],
        deleted=bool(r["deleted"]),
        handled=bool(r["handled"]),
        handled_by=r["handled_by"],
        handled_at=_dt(r["handled_at"]),
        snoozed_until=_dt(r["snoozed_until"]),
        snooze_on=r["snooze_on"] if "snooze_on" in r.keys() else None,  # noqa: SIM118 (sqlite3.Row)
        pinned=bool(r["pinned"]),
        priority=bool(r["priority"]),
        links=json.loads(r["links"]),
    )


def _is_basic_group(chat_id: str) -> bool:
    return not chat_id.startswith("-100")


def _rule_matches(rules: list[dict], m: StoredMessage) -> bool:
    text = m.text.lower()
    return any(
        r["value"] in text if r["kind"] == "keyword" else r["kind"] == "sender" and r["value"] == m.sender_id
        for r in rules
    )


def fold(text: str | None) -> str:
    """Lower case without Vietnamese accents ("Luận" -> "luan"), as the page's `fold` (web/src/lib/inbox.ts):
    a search finds the same tags in a group as in Việc cần xử lý."""
    s = unicodedata.normalize("NFD", text or "")
    return "".join(ch for ch in s if not unicodedata.combining(ch)).replace("đ", "d").replace("Đ", "d").lower()


def _like(text: str) -> str:
    """`%text%` for LIKE ... ESCAPE '\\'."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

