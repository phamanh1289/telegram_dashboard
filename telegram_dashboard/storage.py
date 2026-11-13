"""SQLite store. Sync methods; callers run them off the event loop via `Db`."""

import asyncio
import hashlib
import itertools
import json
import logging
import math
import re
import sqlite3
import statistics
import threading
import unicodedata
import uuid
from collections.abc import Iterable, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .errors import ApiError
from .models import (
    ChangeItem,
    ChatDTO,
    MessageDTO,
    OutboxDTO,
    StoredMessage,
    to_dto,
)
from .qa import codes as qa_codes
from .qa import has_tag, qa_code

log = logging.getLogger("telegram_dashboard.storage")

KEEP_CHANGES = 50_000  # change-log rows kept on startup; older cursors get a reset
# A tag still waiting for the user (messages aliased `m`); snoozed ones come back on their own.
PENDING = (
    "m.outgoing=0 AND m.handled=0 AND m.deleted=0 AND COALESCE(m.snoozed_until,0)<=unixepoch()"
)
# A session is Done (tasks `t`, its tag `m`): a kept tag's Done, else its own. A reply (on Telegram, or the session's
# asks) handles the tag but leaves the session in Doing.
_TASK_DONE = (
    "(CASE WHEN m.deleted=0 THEN m.handled AND m.handled_by NOT IN ('reply', 'dashboard') ELSE t.done END)"
)

# Old enough to clear (Settings › Dữ liệu): handled tags and our replies, not pinned, not used by an AI session
# (its turns or its tag) or by an open Báo lại item. Alias `m`, one parameter: the cutoff.
_OLD_MSG = (
    "m.deleted=0 AND m.pinned=0 AND (m.handled=1 OR m.outgoing=1) AND m.date<? "
    "AND NOT EXISTS (SELECT 1 FROM task_refs r WHERE r.chat_id=m.chat_id AND r.message_id=m.message_id) "
    "AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.chat_id=m.chat_id AND t.message_id=m.message_id) "
    "AND NOT EXISTS (SELECT 1 FROM loop_back l WHERE l.chat_id=m.chat_id AND l.message_id=m.message_id AND l.done=0)"
)
# ponytail: a stored message's size, estimated from its text columns plus a fixed row overhead
_ROW_BYTES = "COALESCE(SUM(LENGTH(m.text) + LENGTH(m.links) + LENGTH(COALESCE(m.sender_name, '')) + 64), 0)"

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  tracking INTEGER NOT NULL DEFAULT 0,
  tracked_at INTEGER,
  generation INTEGER NOT NULL DEFAULT 0,
  migrated_to TEXT,
  purged_at INTEGER  -- "Xóa dữ liệu nhóm": tags up to then are never stored again
);
CREATE TABLE IF NOT EXISTS messages (
  chat_id TEXT NOT NULL REFERENCES chats(chat_id),
  message_id INTEGER NOT NULL,
  sender_id TEXT, sender_name TEXT,
  text TEXT NOT NULL DEFAULT '',
  date INTEGER NOT NULL,
  edit_date INTEGER,
  reply_to_id INTEGER, topic_id INTEGER,
  outgoing INTEGER NOT NULL DEFAULT 0,
  media_kind TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  handled INTEGER NOT NULL DEFAULT 0,
  snoozed_until INTEGER, snooze_on TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  links TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS messages_mid ON messages(message_id);  -- deletions without a chat id
CREATE TABLE IF NOT EXISTS outbox (
  request_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  reply_to_message_id INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  text_hash TEXT NOT NULL,
  random_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  message_id INTEGER,
  error_code TEXT,
  retry_after INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  code TEXT,                       -- short trace code shown to the user, e.g. R-1A2B3C4D
  sent_text TEXT NOT NULL DEFAULT '',  -- no longer written, cleared on startup
  sent_at INTEGER,
  quote INTEGER NOT NULL DEFAULT 1  -- 0: a new message in the tag's group / topic, not a reply to it
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,   -- keyword (value: lowercase text) | sender / priority / relay / agent (value: sender id)
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  UNIQUE (kind, value)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  message_id INTEGER,
  project TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  prompt TEXT,
  tty TEXT,
  mode TEXT NOT NULL DEFAULT 'terminal',
  session_id TEXT,
  kind TEXT NOT NULL DEFAULT 'task',
  title TEXT,
  model TEXT,
  effort TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  git_base TEXT  -- the project's working tree (git tree id) when the session started: Thay đổi diffs from it
);
CREATE TABLE IF NOT EXISTS task_refs (  -- messages attached to a session's turns: Done on the session ticks them too
  task_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  qa TEXT NOT NULL DEFAULT '',  -- "#QA…" of the thread it answers (up its reply chain, read live if not kept)
  ask INTEGER NOT NULL DEFAULT 1,  -- asks reply to the session's latest such ref (0: many-topic Đối chiếu BE)
  PRIMARY KEY (task_id, chat_id, message_id)
);
CREATE TABLE IF NOT EXISTS projects (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS changes (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  kind TEXT NOT NULL,
  generation INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS digest_consents (
  chat_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS digests (
  chat_id TEXT PRIMARY KEY,
  last_message_id INTEGER NOT NULL,  -- newest message any digest covered, only moves forward
  last_date INTEGER NOT NULL,
  result TEXT NOT NULL,              -- latest DigestResult JSON (dropped with the consent)
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS qa_marks (  -- a Q&A thread (live from Telegram, never stored) you closed or removed
  chat_id TEXT NOT NULL,
  code TEXT NOT NULL,                  -- "#QA27012345"
  state TEXT NOT NULL CHECK (state IN ('done', 'deleted')),
  at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, code)
);
CREATE TABLE IF NOT EXISTS loop_back (  -- "Báo lại": my ticket reached Fixed / Done, a stored message asked about it
  ticket TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,          -- the message to answer
  state TEXT NOT NULL,                  -- the state it reached
  created_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,      -- answered or dismissed: kept so a later round never queues it again
  PRIMARY KEY (ticket, chat_id, message_id)
);
"""


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


# Tags snoozed until a reply that a message answering ?2 wakes: ?2 itself, or the tag my reply ?2 answered.
_REPLY_SNOOZED = ("SELECT message_id FROM messages WHERE chat_id=?1 AND snooze_on='reply' AND (message_id=?2 OR "
                  "message_id=(SELECT reply_to_id FROM messages WHERE chat_id=?1 AND message_id=?2 AND outgoing=1))")


def _like(text: str) -> str:
    """`%text%` for LIKE ... ESCAPE '\\'."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _mark_qa(c: sqlite3.Connection, rows: Iterable, handled: bool) -> None:
    """Done / reopen the Q&A threads whose #QA code these (chat_id, text) rows name. Done never overwrites a removed
    thread; reopen clears only a 'done' mark."""
    for cid, text in rows:
        for code in qa_codes(text):
            if handled:
                c.execute("INSERT INTO qa_marks VALUES (?,?,'done',?) ON CONFLICT DO NOTHING", (cid, code, now_ts()))
            else:
                c.execute("DELETE FROM qa_marks WHERE chat_id=? AND code=? AND state='done'", (cid, code))


CHAIN_MAX = 12  # as the web's reply-chain walk (message-item.tsx)


def _session_asks(c: sqlite3.Connection, task_id: str) -> list[sqlite3.Row]:
    """Kept messages naming the session ("#REF-…", or the old "#AI-…"): the asks it posted, the answers quoting it."""
    tail = task_id[-6:]  # sessionId() on the web
    return c.execute(  # ponytail: a LIKE scan of kept messages, once per Done
        "SELECT chat_id, message_id, text FROM messages WHERE deleted=0 AND (text LIKE ? OR text LIKE ?)",
        (f"%#REF-{tail}%", f"%#AI-{tail}%"),
    ).fetchall()


def _session_qa(c: sqlite3.Connection, task_id: str) -> list[tuple[str, str]]:
    """(chat_id, text) rows naming the session's Q&A codes: its tag and attached messages (or, nearest, a message up
    their reply chain; for an attached one, the code found when it was attached), its asks, and the Q&A an Đối chiếu
    BE prompt cites (messages read live, never stored)."""
    keys = c.execute(
        "SELECT chat_id, message_id FROM tasks WHERE id=? UNION ALL SELECT chat_id, message_id FROM task_refs "
        "WHERE task_id=?",
        (task_id, task_id),
    ).fetchall()
    deep = c.execute("SELECT chat_id, prompt FROM tasks WHERE id=? AND kind='deep'", (task_id,)).fetchall()
    found = c.execute("SELECT chat_id, qa FROM task_refs WHERE task_id=? AND qa<>''", (task_id,)).fetchall()
    asks = [(r["chat_id"], r["text"]) for r in _session_asks(c, task_id)]
    return [_qa_text(c, cid, mid) for cid, mid in keys] + [(r[0], r[1] or "") for r in deep + found] + asks


def _attached(c: sqlite3.Connection, chat_id: str, message_id: int) -> bool:
    """Attached to a session: real though maybe never kept (a BE answer, any Q&A group), so an ask may reply to it,
    in that group even untracked."""
    sql = "SELECT 1 FROM task_refs WHERE chat_id=? AND message_id=?"
    return c.execute(sql, (chat_id, message_id)).fetchone() is not None


def _code_roots(c: sqlite3.Connection, chat_id: str, code: str) -> set[tuple[str, int]]:
    """Kept messages of a group naming a Q&A code, and (as qa.find_threads) the message the first of them replies to:
    the question someone asked that I answered with Q&A."""
    rows = c.execute("SELECT message_id, text, reply_to_id FROM messages WHERE chat_id=? AND deleted=0 AND text LIKE ? "
                     "ORDER BY message_id", (chat_id, f"%{code}%")).fetchall()  # fmt: skip
    named = [r for r in rows if code in qa_codes(r[1])]  # #QA12 must not match #QA123
    first = [named[0][2]] if named and named[0][2] else []
    return {(chat_id, mid) for mid in [r[0] for r in named] + first}


def _session_answers(c: sqlite3.Connection, task_id: str) -> list[tuple[str, int]]:
    """Kept tags (not mine) answering the session: down the reply chains under its asks and its Q&A questions."""
    roots = {(r["chat_id"], r["message_id"]) for r in _session_asks(c, task_id)}
    for cid, code in {(cid, code) for cid, text in _session_qa(c, task_id) for code in qa_codes(text)}:
        roots |= _code_roots(c, cid, code)
    return _tags_under(c, roots)


def _tags_under(c: sqlite3.Connection, roots: set[tuple[str, int]]) -> list[tuple[str, int]]:
    """Kept tags (not mine) among these messages and down the reply chains under them."""
    seen, level = set(roots), list(roots)
    for _ in range(CHAIN_MAX):  # ponytail: one query per message per level; Done is rare and threads are short
        level = [(cid, r[0]) for cid, mid in level
                 for r in c.execute("SELECT message_id FROM messages WHERE chat_id=? AND reply_to_id=?", (cid, mid))
                 if (cid, r[0]) not in seen]  # fmt: skip
        if not level:
            break
        seen.update(level)
    return [(cid, mid) for cid, mid in seen
            if c.execute("SELECT 1 FROM messages WHERE chat_id=? AND message_id=? AND outgoing=0 AND deleted=0",
                         (cid, mid)).fetchone()]  # fmt: skip


def _qa_text(c: sqlite3.Connection, cid: str, mid: int | None) -> tuple:
    """(chat_id, text) of the nearest stored message naming a #QA code: this one or one up its reply chain (a BE
    answer replies to the copied ask that carries the code); ("", "") when none."""
    for _ in range(CHAIN_MAX):
        r = None if mid is None else c.execute(
            "SELECT text, reply_to_id FROM messages WHERE chat_id=? AND message_id=?", (cid, mid)).fetchone()
        if r is None:
            break
        if qa_codes(r[0]):
            return cid, r[0]
        mid = r[1]
    return "", ""


def _add_cols(c: sqlite3.Connection, table: str, cols: dict[str, str]) -> None:
    """ALTER TABLE ADD COLUMN for each column the table lacks (new databases have them already)."""
    have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
    for col, ddl in cols.items():
        if col not in have:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")


def _add_missing_columns(c: sqlite3.Connection) -> None:
    """Databases from before versioning may lack these columns; a no-op on new ones."""
    _add_cols(c, "messages", {"handled": "INTEGER NOT NULL DEFAULT 0", "links": "TEXT NOT NULL DEFAULT '[]'",
                              "snoozed_until": "INTEGER", "pinned": "INTEGER NOT NULL DEFAULT 0",
                              "snooze_on": "TEXT"})  # fmt: skip
    _add_cols(c, "tasks", {"prompt": "TEXT", "mode": "TEXT NOT NULL DEFAULT 'terminal'", "session_id": "TEXT",
                           "tty": "TEXT"})  # fmt: skip
    _add_cols(c, "outbox", {"code": "TEXT", "sent_text": "TEXT NOT NULL DEFAULT ''", "sent_at": "INTEGER"})
    for (rid,) in c.execute("SELECT request_id FROM outbox WHERE code IS NULL").fetchall():
        c.execute("UPDATE outbox SET code=? WHERE request_id=?", (reply_code(rid), rid))
    c.execute("DROP INDEX IF EXISTS outbox_code")  # display-only code: a 32-bit collision must not fail a send
    c.execute("UPDATE outbox SET sent_text='' WHERE sent_text!=''")  # no longer kept


# Run once each, in order; PRAGMA user_version = how many ran. Append only, never edit.
def _task_kind(c: sqlite3.Connection) -> None:
    """Deep thinking sessions live with the AI Agent tasks."""
    _add_cols(c, "tasks", {"kind": "TEXT NOT NULL DEFAULT 'task'", "title": "TEXT"})


def _task_ai(c: sqlite3.Connection) -> None:
    """Model/effort picked for one AI Agent session (NULL: the task picks in AI settings)."""
    _add_cols(c, "tasks", {"model": "TEXT", "effort": "TEXT"})


def _task_done(c: sqlite3.Connection) -> None:
    """Done for a session whose message is not a kept tag (e.g. Đối chiếu BE on any BE reply)."""
    _add_cols(c, "tasks", {"done": "INTEGER NOT NULL DEFAULT 0"})


def _chat_purged(c: sqlite3.Connection) -> None:
    """A purged chat remembers when, so the mention backfill does not bring its old tags back."""
    _add_cols(c, "chats", {"purged_at": "INTEGER"})


def _pending_indexes(c: sqlite3.Connection) -> None:
    """The pending counts and date ranges (chat list, inbox) without a scan of every message."""
    if {"outgoing", "handled", "deleted"} <= {r["name"] for r in c.execute("PRAGMA table_info(messages)")}:
        c.execute("CREATE INDEX IF NOT EXISTS messages_pending ON messages(chat_id, date) "
                  "WHERE outgoing=0 AND handled=0 AND deleted=0")  # fmt: skip
    c.execute("CREATE INDEX IF NOT EXISTS messages_chat_date ON messages(chat_id, date)")


def _drop_grants(c: sqlite3.Connection) -> None:
    """Per-message AI grants are gone: consent mode now just keeps the AI off Telegram text."""
    c.execute("DROP TABLE IF EXISTS ai_permissions")


def _handled_by(c: sqlite3.Connection) -> None:
    """How and when a tag got handled ("Đã xử lý" says why; only Xong leaves a reaction)."""
    _add_cols(c, "messages", {"handled_by": "TEXT NOT NULL DEFAULT ''", "handled_at": "INTEGER"})


def _outbox_quote(c: sqlite3.Connection) -> None:
    """A send can be a new message next to the tag (AI Agent asks) instead of a reply to it."""
    _add_cols(c, "outbox", {"quote": "INTEGER NOT NULL DEFAULT 1"})


def _priority(c: sqlite3.Connection) -> None:
    """A tag from a "Luôn ưu tiên" sender (rules kind 'priority'): sorts first in the to-do list. Kept on the row
    (set on insert and when the rule changes) so every read, the change feed included, carries it."""
    _add_cols(c, "messages", {"priority": "INTEGER NOT NULL DEFAULT 0"})


def _deep_anchor(c: sqlite3.Connection) -> None:
    """Every AI Agent session sits on a message now (its asks post into that group / topic); Đối chiếu BE of several
    topics used to sit on none. Anchor it on the newest stored message its prompt cites (as ai.data_json wrote it)."""
    rows = c.execute("SELECT id, chat_id, prompt FROM tasks WHERE kind='deep' AND message_id IS NULL "
                     "AND chat_id IS NOT NULL AND prompt IS NOT NULL").fetchall()  # fmt: skip
    for t in rows:
        # ponytail: a text match on the stored copies; a topic whose messages were never stored stays without one
        for m in c.execute("SELECT message_id, text FROM messages WHERE chat_id=? AND deleted=0 AND length(text)>=8 "
                           "ORDER BY message_id DESC LIMIT 5000", (t["chat_id"],)):  # fmt: skip
            if json.dumps(m["text"], ensure_ascii=False)[1:-1].replace("<", "\\u003c") in t["prompt"]:
                c.execute("UPDATE tasks SET message_id=? WHERE id=?", (m["message_id"], t["id"]))
                break


def _task_git_base(c: sqlite3.Connection) -> None:
    """Thay đổi shows what this session changed, not every edit in the project folder (NULL: whole-tree view)."""
    _add_cols(c, "tasks", {"git_base": "TEXT"})


def _task_ref_qa(c: sqlite3.Connection) -> None:
    """An attached message's Q&A follows the session's Done even when the message was never stored."""
    _add_cols(c, "task_refs", {"qa": "TEXT NOT NULL DEFAULT ''"})


def _task_ref_ask(c: sqlite3.Connection) -> None:
    """A session's asks reply to the message last attached to it."""
    _add_cols(c, "task_refs", {"ask": "INTEGER NOT NULL DEFAULT 1"})


def _snooze_on(c: sqlite3.Connection) -> None:
    """snooze_on landed in _add_missing_columns, which databases past version 1 never run again."""
    _add_cols(c, "messages", {"snooze_on": "TEXT"})


def _rule_extra(c: sqlite3.Connection) -> None:
    """An "agent" rule keeps its project and who the user is (JSON): the sessions it opens need them."""
    _add_cols(c, "rules", {"extra": "TEXT NOT NULL DEFAULT ''"})


MIGRATIONS = [
    _add_missing_columns, _task_kind, _task_ai, _task_done, _chat_purged, _pending_indexes, _drop_grants,
    _handled_by, _outbox_quote, _priority, _deep_anchor, _task_git_base, _task_ref_qa, _snooze_on,
    _task_ref_ask, _rule_extra,
]  # fmt: skip


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._local = threading.local()  # one connection per thread, reused (Db runs calls in a pool)
        self.loop_rev = 0  # bumped when the Báo lại list changes: the SSE status tells the page to read it again
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.create_function("fold", 1, fold, deterministic=True)
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def _conn(self, write: bool = False):
        """One transaction on this thread's connection. A nested call gets a connection of its own;
        one left inside a transaction (a failed COMMIT/ROLLBACK) is closed, never reused."""
        conn = getattr(self._local, "conn", None)
        nested = conn is not None and conn.in_transaction
        if conn is None or nested:
            conn = self._connect()
            if not nested:
                self._local.conn = conn
        try:
            conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            else:
                conn.execute("COMMIT")
        finally:
            if nested or conn.in_transaction:
                conn.close()
                if not nested:
                    self._local.conn = None

    def _init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(self.path, isolation_level=None)
        try:
            c.execute("PRAGMA journal_mode=WAL")  # persistent: set once here
            c.executescript(SCHEMA)  # idempotent CREATE ... IF NOT EXISTS
        finally:
            c.close()
        with self._conn(write=True) as c:
            done = c.execute("PRAGMA user_version").fetchone()[0]
            for n, step in enumerate(MIGRATIONS[done:], done + 1):
                step(c)
                c.execute(f"PRAGMA user_version={n}")
            c.execute("INSERT OR IGNORE INTO metadata VALUES ('db_epoch', ?)", (str(uuid.uuid4()),))
            c.execute("DELETE FROM changes WHERE revision<=?", (self._rev(c) - KEEP_CHANGES,))
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(self.path) + suffix)
            if p.exists():
                p.chmod(0o600)

    # ---- helpers -------------------------------------------------------
    @staticmethod
    def _epoch(c: sqlite3.Connection) -> str:
        return c.execute("SELECT value FROM metadata WHERE key='db_epoch'").fetchone()[0]

    @staticmethod
    def _rev(c: sqlite3.Connection) -> int:
        return c.execute("SELECT COALESCE(MAX(revision),0) FROM changes").fetchone()[0] or 0

    @staticmethod
    def _msg(c: sqlite3.Connection, chat_id: str, message_id: int) -> sqlite3.Row | None:
        return c.execute(
            "SELECT * FROM messages WHERE chat_id=? AND message_id=?", (chat_id, message_id)
        ).fetchone()

    def _cursor(self, c: sqlite3.Connection) -> str:
        return format_cursor(self._epoch(c), self._rev(c))

    @staticmethod
    def _record(
        c: sqlite3.Connection, chat_id: str, message_id: int | None, kind: str, generation: int
    ) -> None:
        c.execute(
            "INSERT INTO changes (chat_id, message_id, kind, generation) VALUES (?,?,?,?)",
            (chat_id, message_id, kind, generation),
        )

    @staticmethod
    def _chat(c: sqlite3.Connection, chat_id: str) -> sqlite3.Row | None:
        return c.execute("SELECT * FROM chats WHERE chat_id=?", (chat_id,)).fetchone()

    def _set_col(
        self, c: sqlite3.Connection, chat_id: str, message_id: int, col: str, value,
        only_change: bool = False,
    ) -> bool:  # fmt: skip
        """Set one column of a kept message and emit an edit change. True when the message
        exists (with only_change: when the value actually changed)."""
        sql = f"UPDATE messages SET {col}=?1 WHERE chat_id=?2 AND message_id=?3 AND deleted=0"
        cur = c.execute(sql + (f" AND {col} IS NOT ?1" if only_change else ""),
                        (value, chat_id, message_id))  # fmt: skip
        if cur.rowcount and (chat := self._chat(c, chat_id)) is not None:
            self._record(c, chat_id, message_id, "edit", chat["generation"])
        return bool(cur.rowcount)

    def _mark(self, c: sqlite3.Connection, chat_id: str, message_id: int, handled: bool, by: str) -> bool:
        """Handled or not, with how (HANDLED_BY) and when, so the row can say why it is done; reopening clears
        both. Emits an edit change; True only when it flipped."""
        if handled and by in ("reply", "dashboard"):  # my reply (any device) answers its Báo lại items
            self._loop_done(c, chat_id, message_id)
        cur = c.execute(
            "UPDATE messages SET handled=?1, handled_by=?2, handled_at=?3 "
            "WHERE chat_id=?4 AND message_id=?5 AND deleted=0 AND handled IS NOT ?1",
            (int(handled), by if handled else "", now_ts() if handled else None, chat_id, message_id),
        )
        if cur.rowcount and not handled:  # reopened: a snooze left from before would hide it from every list
            c.execute("UPDATE messages SET snoozed_until=NULL, snooze_on=NULL WHERE chat_id=? AND message_id=?",
                      (chat_id, message_id))  # fmt: skip
        if cur.rowcount and (chat := self._chat(c, chat_id)) is not None:
            self._record(c, chat_id, message_id, "edit", chat["generation"])
        return bool(cur.rowcount)

    @staticmethod
    def _clear_outbox_text(c: sqlite3.Connection, chat_id: str, reply_ids: list[int] | None):
        if reply_ids is None:
            # purge = user asked to forget the chat: drop the trace copy too
            c.execute("UPDATE outbox SET text='', sent_text='' WHERE chat_id=?", (chat_id,))
        else:
            c.executemany(
                "UPDATE outbox SET text='' WHERE chat_id=? AND reply_to_message_id=?",
                [(chat_id, m) for m in reply_ids],
            )

    # ---- meta ----------------------------------------------------------
    def db_epoch(self) -> str:
        with self._conn() as c:
            return self._epoch(c)

    def current_cursor(self) -> str:
        with self._conn() as c:
            return self._cursor(c)

    # ---- chats ---------------------------------------------------------
    def upsert_chat_info(self, chat_id: str, title: str, kind: str) -> None:
        with self._conn(write=True) as c:
            c.execute(
                "INSERT INTO chats (chat_id,title,kind) VALUES (?,?,?) "
                "ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title, kind=excluded.kind",
                (chat_id, title, kind),
            )

    def set_tracking(
        self, chat_id: str, enabled: bool, title: str | None = None, kind: str | None = None
    ) -> int:
        """Returns the chat's current generation. Disabling bumps it so late work is dropped."""
        with self._conn(write=True) as c:
            return self._set_tracking(c, chat_id, enabled, title, kind)

    def _set_tracking(
        self, c: sqlite3.Connection, chat_id: str, enabled: bool, title: str | None,
        kind: str | None,
    ) -> int:  # fmt: skip
        row = self._chat(c, chat_id)
        if row is None:
            if title is None or kind is None:
                raise ApiError(404, "unknown_chat")
            c.execute(
                "INSERT INTO chats (chat_id,title,kind) VALUES (?,?,?)", (chat_id, title, kind)
            )
            row = self._chat(c, chat_id)
        if enabled:
            if row["migrated_to"]:
                raise ApiError(409, "chat_migrated")
            if not row["tracking"]:
                c.execute(
                    "UPDATE chats SET tracking=1, tracked_at=?, title=COALESCE(?,title) "
                    "WHERE chat_id=?",
                    (now_ts(), title, chat_id),
                )
                self._record(c, chat_id, None, "tracking", row["generation"])
            return row["generation"]
        gen = row["generation"]
        if row["tracking"]:
            gen += 1
            c.execute("UPDATE chats SET tracking=0, generation=? WHERE chat_id=?", (gen, chat_id))
            c.execute(
                "UPDATE outbox SET status='failed', error_code='untracked', text='', "
                "updated_at=? WHERE chat_id=? AND status='pending'",
                (now_ts(), chat_id),
            )
            self._record(c, chat_id, None, "untrack", gen)
        return gen

    def mark_migrated(self, old_chat_id: str, new_chat_id: str) -> None:
        with self._conn(write=True) as c:
            row = self._chat(c, old_chat_id)
            if row is None or row["migrated_to"]:
                return
            gen = row["generation"] + 1
            c.execute(
                "UPDATE chats SET tracking=0, generation=?, migrated_to=? WHERE chat_id=?",
                (gen, new_chat_id, old_chat_id),
            )
            self._record(c, old_chat_id, None, "migrated", gen)

    def purge_chat(self, chat_id: str) -> None:
        with self._conn(write=True) as c:
            row = self._chat(c, chat_id)
            if row is None:
                raise ApiError(404, "unknown_chat")
            gen = row["generation"] + 1
            c.execute(
                "UPDATE chats SET tracking=0, generation=?, tracked_at=NULL, purged_at=? WHERE chat_id=?",
                (gen, now_ts(), chat_id),
            )
            c.execute(
                "UPDATE outbox SET status='failed', error_code='purged', updated_at=? "
                "WHERE chat_id=? AND status='pending'",
                (now_ts(), chat_id),
            )
            self._clear_outbox_text(c, chat_id, None)
            c.execute("DELETE FROM digest_consents WHERE chat_id=?", (chat_id,))
            c.execute("DELETE FROM digests WHERE chat_id=?", (chat_id,))
            if c.execute("DELETE FROM loop_back WHERE chat_id=?", (chat_id,)).rowcount:
                self.loop_rev += 1
            c.execute("DELETE FROM messages WHERE chat_id=?", (chat_id,))
            self._record(c, chat_id, None, "purge", gen)

    def get_chat(self, chat_id: str) -> dict | None:
        with self._conn() as c:
            r = self._chat(c, chat_id)
            return None if r is None else dict(r)

    def is_tracking(self, chat_id: str) -> bool:
        row = self.get_chat(chat_id)
        return bool(row and row["tracking"])

    def list_chats(
        self, since: datetime | None = None, until: datetime | None = None
    ) -> tuple[list[ChatDTO], str]:
        """With a range, only chats that have a kept message in [since, until). Groups with a tag waiting first, the
        one waiting longest on top (what needs you first), then by title."""
        mine = (f"FROM messages m WHERE m.chat_id=chats.chat_id AND {PENDING} "
                "AND (?1 IS NULL OR m.date>=?1) AND (?2 IS NULL OR m.date<?2)")  # fmt: skip
        with self._conn() as c:
            rows = c.execute(
                f"SELECT *, (SELECT COUNT(*) {mine}) AS pending, (SELECT MIN(m.date) {mine}) AS oldest "
                "FROM chats WHERE (?1 IS NULL AND ?2 IS NULL) OR EXISTS (SELECT 1 "
                "FROM messages m WHERE m.chat_id=chats.chat_id AND m.deleted=0 "
                "AND (?1 IS NULL OR m.date>=?1) AND (?2 IS NULL OR m.date<?2)) "
                "ORDER BY pending=0, oldest, title COLLATE NOCASE",
                (_ts(since), _ts(until)),
            ).fetchall()
            cursor = self._cursor(c)
        return [
            ChatDTO(
                chat_id=r["chat_id"],
                title=r["title"],
                kind=r["kind"],
                tracking=bool(r["tracking"]),
                migrated=bool(r["migrated_to"]),
                migrated_to=r["migrated_to"],
                tracked_at=_dt(r["tracked_at"]),
                generation=r["generation"],
                pending_count=r["pending"],
                oldest_pending=_dt(r["oldest"]),
            )
            for r in rows
        ], cursor

    # ---- messages ------------------------------------------------------
    def _upsert_message(self, c: sqlite3.Connection, m: StoredMessage, chat: sqlite3.Row) -> bool:
        existing = self._msg(c, m.chat_id, m.message_id)
        values = (
            m.sender_id, m.sender_name, m.text, _ts(m.date), _ts(m.edit_date), m.reply_to_id,
            m.topic_id, int(m.outgoing), m.media_kind, json.dumps([x.model_dump() for x in m.links]),
        )  # fmt: skip
        if existing is None:
            if (_ts(m.date) or 0) < self._pruned_before(c):
                return False  # cleared in Settings › Dữ liệu: an old message edited or backfilled is not a new tag
            c.execute(
                "INSERT INTO messages (sender_id,sender_name,text,date,edit_date,reply_to_id,"
                "topic_id,outgoing,media_kind,links,chat_id,message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (*values, m.chat_id, m.message_id),
            )
            c.execute("UPDATE messages SET priority=1 WHERE chat_id=? AND message_id=? AND sender_id IN "
                      "(SELECT value FROM rules WHERE kind='priority')", (m.chat_id, m.message_id))  # fmt: skip
            self._record(c, m.chat_id, m.message_id, "new", chat["generation"])
            if m.reply_to_id and not m.outgoing:
                self._wake_on_reply(c, m.chat_id, m.reply_to_id)
            return True
        if existing["deleted"]:
            return False  # tombstones are never resurrected
        if (_ts(m.edit_date) or 0) <= (existing["edit_date"] or 0):
            # Same version refetched (e.g. mention backfill): pick up entities stored before we kept them all.
            if m.text != existing["text"] or values[-1] == existing["links"]:
                return False  # replay or stale version
            c.execute(
                "UPDATE messages SET links=? WHERE chat_id=? AND message_id=?",
                (values[-1], m.chat_id, m.message_id),
            )
            self._record(c, m.chat_id, m.message_id, "edit", chat["generation"])
            return True
        c.execute(
            "UPDATE messages SET sender_id=?,sender_name=?,text=?,date=?,edit_date=?,reply_to_id=?,"
            "topic_id=?,outgoing=?,media_kind=?,links=? WHERE chat_id=? AND message_id=?",
            (*values, m.chat_id, m.message_id),
        )
        self._record(c, m.chat_id, m.message_id, "edit", chat["generation"])
        return True

    def apply_message(self, m: StoredMessage) -> bool:
        with self._conn(write=True) as c:
            chat = self._chat(c, m.chat_id)
            if chat is None or not chat["tracking"]:
                return False
            return self._upsert_message(c, m, chat)

    def store_mentions(self, found: list[tuple[str, str, StoredMessage, bool]]) -> list[int]:
        """Keep tags/replies to us, (title, kind, message, we_replied) each, in one transaction:
        track the chat, store the message, and for a tag seen for the first time apply the rules
        and mark it handled when answered (a kept tag the user reopened stays open). Tags of a
        purged chat up to its purge are skipped. Returns ids of tags seen for the first time and
        still pending (to notify about)."""
        fresh = []
        with self._conn(write=True) as c:
            rules = [dict(r) for r in c.execute("SELECT * FROM rules")]
            for title, kind, m, replied in found:
                chat = self._chat(c, m.chat_id)
                if chat is not None and chat["purged_at"] and (_ts(m.date) or 0) <= chat["purged_at"]:
                    continue
                try:
                    self._set_tracking(c, m.chat_id, True, title, kind)
                except ApiError:
                    continue  # migrated chat
                new = self._msg(c, m.chat_id, m.message_id) is None
                if not self._upsert_message(c, m, self._chat(c, m.chat_id)) and new:
                    continue  # older than a clear (pruned_before)
                if not new:
                    continue
                if replied or _rule_matches(rules, m):
                    self._mark(c, m.chat_id, m.message_id, True, "reply" if replied else "rule")
                else:
                    fresh.append(m.message_id)
        return fresh

    def apply_deletion(self, chat_id: str | None, message_ids: list[str]) -> list[str]:
        """Returns chat ids that changed. chat_id None => ambiguous basic-group deletion."""
        ids = [int(i) for i in message_ids]
        touched: list[str] = []
        with self._conn(write=True) as c:
            if chat_id is not None:
                chat = self._chat(c, chat_id)
                if chat is None or not chat["tracking"]:
                    return []
                targets = [(chat, i) for i in ids]
            else:
                targets = []
                for i in ids:
                    rows = c.execute(
                        "SELECT c.* FROM messages m JOIN chats c ON c.chat_id=m.chat_id "
                        "WHERE m.message_id=? AND c.tracking=1 AND m.deleted=0",
                        (i,),
                    ).fetchall()
                    rows = [r for r in rows if _is_basic_group(r["chat_id"])]
                    if len(rows) == 1:
                        targets.append((rows[0], i))
                    else:
                        log.warning("ambiguous delete skipped (matches=%d)", len(rows))
            for chat, mid in targets:
                cid = chat["chat_id"]
                existing = self._msg(c, cid, mid)
                if existing is not None and existing["deleted"]:
                    continue
                if existing is None:
                    c.execute(
                        "INSERT INTO messages (chat_id,message_id,text,date,deleted) "
                        "VALUES (?,?,'',0,1)",
                        (cid, mid),
                    )
                else:
                    c.execute(
                        "UPDATE messages SET text='', sender_name=NULL, sender_id=NULL, "
                        "media_kind=NULL, deleted=1 WHERE chat_id=? AND message_id=?",
                        (cid, mid),
                    )
                self._clear_outbox_text(c, cid, [mid])
                self._record(c, cid, mid, "delete", chat["generation"])
                touched.append(cid)
        return touched

    def set_handled(self, chat_id: str, message_id: int, handled: bool, by: str = "me") -> bool:
        """Mark a kept message handled or not (`by`: one of HANDLED_BY); emits an edit change when it flips."""
        with self._conn(write=True) as c:
            return self._mark(c, chat_id, message_id, handled, by)

    def claim_handled(self, chat_id: str, message_id: int, by: str) -> bool:
        """A tag a reply handled, now ticked Done on purpose (its session's Xong): say so, so the session follows."""
        with self._conn(write=True) as c:
            cur = c.execute(
                "UPDATE messages SET handled_by=? WHERE chat_id=? AND message_id=? AND deleted=0 AND handled=1 "
                "AND handled_by IN ('reply', 'dashboard')", (by, chat_id, message_id),
            )  # fmt: skip
            if cur.rowcount and (chat := self._chat(c, chat_id)) is not None:
                self._record(c, chat_id, message_id, "edit", chat["generation"])
            return bool(cur.rowcount)

    def set_snooze(self, chat_id: str, message_id: int, until: datetime | None, on: str | None = None) -> bool:
        """Hide a tag until `until`; `on` ("reply" or "ticket:<ID>") wakes it sooner, when someone answers it (or my
        reply to it) or that ticket is done. `until` stays the backstop, so an event that never comes loses nothing."""
        with self._conn(write=True) as c:
            c.execute("UPDATE messages SET snooze_on=? WHERE chat_id=? AND message_id=?", (on, chat_id, message_id))
            return self._set_col(c, chat_id, message_id, "snoozed_until", _ts(until))

    def reply_snoozed(self, chat_id: str, reply_to: int) -> bool:
        """A tag snoozed until a reply waits on `reply_to` (itself, or my reply to it): read before waking, so the
        many replies that wake nothing never take the write lock or ping the page."""
        with self._conn() as c:
            return c.execute(_REPLY_SNOOZED + " LIMIT 1", (chat_id, reply_to)).fetchone() is not None

    def wake_on_reply(self, chat_id: str, reply_to: int) -> None:
        """A message not kept (it tags nobody) answers `reply_to`: wake the tags snoozed until a reply to it."""
        with self._conn(write=True) as c:
            self._wake_on_reply(c, chat_id, reply_to)

    def _wake_on_reply(self, c: sqlite3.Connection, chat_id: str, reply_to: int) -> None:
        """A new message answers `reply_to`: wake tags snoozed "until a reply" that it answers, directly or through
        my own reply to them."""
        rows = c.execute(_REPLY_SNOOZED, (chat_id, reply_to)).fetchall()
        for (mid,) in rows:
            c.execute("UPDATE messages SET snooze_on=NULL WHERE chat_id=? AND message_id=?", (chat_id, mid))
            self._set_col(c, chat_id, mid, "snoozed_until", None)

    def wake_ticket(self, ticket: str) -> int:
        """Wake every tag snoozed until `ticket` is done. Returns how many woke."""
        with self._conn(write=True) as c:
            rows = c.execute("SELECT chat_id, message_id FROM messages WHERE snooze_on=?",
                             (f"ticket:{ticket}",)).fetchall()  # fmt: skip
            for chat_id, mid in rows:
                c.execute("UPDATE messages SET snooze_on=NULL WHERE chat_id=? AND message_id=?", (chat_id, mid))
                self._set_col(c, chat_id, mid, "snoozed_until", None)
            return len(rows)

    # ---- Báo lại ---------------------------------------------------------
    def add_loop_items(self, items: list[tuple[str, str, str, int]]) -> int:
        """(ticket, state, chat_id, message_id) each; one already queued, answered or dismissed is skipped.
        Returns how many were added."""
        with self._conn(write=True) as c:
            n = sum(c.execute(
                "INSERT OR IGNORE INTO loop_back (ticket, state, chat_id, message_id, created_at) VALUES (?,?,?,?,?)",
                (ticket, state, chat_id, mid, now_ts()),
            ).rowcount for ticket, state, chat_id, mid in items)  # fmt: skip
            self.loop_rev += bool(n)
            return n

    def loop_items(self, limit: int = 30) -> list[dict]:
        """Open Báo lại items, newest first."""
        with self._conn() as c:
            return [dict(r) for r in c.execute(
                "SELECT ticket, state, chat_id, message_id FROM loop_back WHERE done=0 "
                "ORDER BY created_at DESC, ticket LIMIT ?", (limit,))]  # fmt: skip

    def done_loop(self, chat_id: str, message_id: int, ticket: str | None = None) -> int:
        """Answered or dismissed: one ticket's item for the message, or every item for it."""
        with self._conn(write=True) as c:
            return self._loop_done(c, chat_id, message_id, ticket)

    def _loop_done(self, c: sqlite3.Connection, chat_id: str, message_id: int, ticket: str | None = None) -> int:
        n = c.execute(
            "UPDATE loop_back SET done=1 WHERE chat_id=? AND message_id=? AND done=0 AND (?3 IS NULL OR ticket=?3)",
            (chat_id, message_id, ticket),
        ).rowcount
        self.loop_rev += bool(n)
        return n

    def ticket_snoozes(self) -> list[str]:
        """Tickets some snoozed tag waits on (still hidden)."""
        with self._conn() as c:
            return [r[0][7:] for r in c.execute(
                "SELECT DISTINCT snooze_on FROM messages "
                "WHERE snooze_on LIKE 'ticket:%' AND snoozed_until>unixepoch()")]

    def remind(
        self, chat_id: str, message_id: int, until: datetime | None, *, restore: str | None = None
    ) -> str | None:
        """"Nhắc lại sau": reopen a kept tag and hide it until `until` (None: back now), in one write, so it comes
        back to the to-do list then. `restore` (its Undo): done again as before, by that HANDLED_BY. Returns how it
        was handled before ("" while open), None when the message is not kept (or deleted)."""
        with self._conn(write=True) as c:
            if (row := self._msg(c, chat_id, message_id)) is None or row["deleted"]:
                return None
            was = (row["handled_by"] or "me") if row["handled"] else ""  # done before handled_by existed: "me"
            if restore:
                self._set_col(c, chat_id, message_id, "snoozed_until", None)
                self._mark(c, chat_id, message_id, True, restore)
                return was
            self._mark(c, chat_id, message_id, False, "")
            self._set_col(c, chat_id, message_id, "snoozed_until", _ts(until))
            return was

    def set_pinned(self, chat_id: str, message_id: int, pinned: bool) -> bool:
        with self._conn(write=True) as c:
            return self._set_col(c, chat_id, message_id, "pinned", int(pinned))

    def list_pinned(self, limit: int = 300) -> list[tuple[str, MessageDTO]]:
        """Every pinned message, handled or not, newest first: (chat title, message)."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT m.*, c.title AS chat_title FROM messages m JOIN chats c USING (chat_id) "
                "WHERE m.pinned=1 AND m.deleted=0 ORDER BY m.date DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [(r["chat_title"], to_dto(_row_to_message(r))) for r in rows]

    def list_snoozed(self, limit: int = 100) -> list[tuple[str, MessageDTO]]:
        """Open tags hidden for now (snoozed, or "nhắc lại sau"), the soonest back first: (chat title, message)."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT m.*, c.title AS chat_title FROM messages m JOIN chats c USING (chat_id) WHERE m.outgoing=0 "
                "AND m.handled=0 AND m.deleted=0 AND m.snoozed_until>unixepoch() ORDER BY m.snoozed_until LIMIT ?",
                (limit,),
            ).fetchall()  # fmt: skip
        return [(r["chat_title"], to_dto(_row_to_message(r))) for r in rows]

    def list_pending(
        self, since: datetime | None = None, until: datetime | None = None, limit: int = 300
    ) -> list[tuple[str, MessageDTO]]:
        """Pending tags across all chats, pinned first, then priority senders, then oldest: (chat title, message)."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT m.*, c.title AS chat_title FROM messages m JOIN chats c USING (chat_id) "
                f"WHERE c.tracking=1 AND {PENDING} AND (?1 IS NULL OR m.date>=?1) "
                "AND (?2 IS NULL OR m.date<?2) ORDER BY m.pinned DESC, m.priority DESC, m.date LIMIT ?3",
                (_ts(since), _ts(until), limit),
            ).fetchall()
        return [(r["chat_title"], to_dto(_row_to_message(r))) for r in rows]

    def mark_all_handled(
        self, chat_id: str, since: datetime | None = None, until: datetime | None = None, *, skip: Sequence[int] = ()
    ) -> list[int]:
        """Mark every pending tag of a tracked chat (within [since, until)) handled, the same
        ones the pending count shows, except `skip` (tags the list leaves to Q&A); returns their ids."""
        with self._conn(write=True) as c:
            chat = self._chat(c, chat_id)
            if chat is None or not chat["tracking"]:
                return []
            ids = sorted(r[0] for r in c.execute(
                f"UPDATE messages AS m SET handled=1, handled_by='all', handled_at=?4 WHERE m.chat_id=?1 AND {PENDING} "
                "AND (?2 IS NULL OR m.date>=?2) AND (?3 IS NULL OR m.date<?3) "
                "AND m.message_id NOT IN (SELECT value FROM json_each(?5)) RETURNING message_id",
                (chat_id, _ts(since), _ts(until), now_ts(), json.dumps(list(skip))),
            ).fetchall())  # fmt: skip
            for i in ids:
                self._record(c, chat_id, i, "edit", chat["generation"])
            return ids

    def get_message(self, chat_id: str, message_id: int) -> StoredMessage | None:
        with self._conn() as c:
            r = self._msg(c, chat_id, message_id)
            return None if r is None else _row_to_message(r)

    def get_messages_by_ids(self, chat_id: str, ids: list[int]) -> tuple[list[StoredMessage], str]:
        with self._conn() as c:
            q = ",".join("?" * len(ids))
            rows = c.execute(
                f"SELECT * FROM messages WHERE chat_id=? AND message_id IN ({q}) "
                "ORDER BY message_id",
                (chat_id, *ids),
            ).fetchall()
            return [_row_to_message(r) for r in rows], self._cursor(c)

    def query_messages(
        self,
        chat_id: str,
        *,
        before: int | None = None,
        after: int | None = None,
        limit: int = 50,
        q: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        pending: bool = False,
        handled: bool = False,
    ) -> tuple[list[MessageDTO], str, bool]:
        limit = max(1, min(limit, 100))
        where, args = ["chat_id=?"], [chat_id]
        if q:
            where.append("deleted=0 AND fold(text) LIKE ? ESCAPE '\\'")
            args.append(_like(fold(q)))
        if pending:
            where.append(PENDING)
        if handled:
            where.append("m.outgoing=0 AND m.handled=1 AND m.deleted=0")
        if since is not None:
            where.append("deleted=0 AND date>=?")
            args.append(_ts(since))
        if until is not None:
            where.append("deleted=0 AND date<?")
            args.append(_ts(until))
        if before is not None:
            where.append("message_id<?")
            args.append(before)
        if after is not None:
            where.append("message_id>?")
            args.append(after)
        order = "ASC" if after is not None else "DESC"
        sql = (
            f"SELECT * FROM messages m WHERE {' AND '.join(where)} "
            f"ORDER BY message_id {order} LIMIT ?"
        )
        with self._conn() as c:
            chat = self._chat(c, chat_id)
            if chat is None or not chat["tracking"]:
                raise ApiError(409, "not_tracking")
            rows = c.execute(sql, (*args, limit + 1)).fetchall()
            cursor = self._cursor(c)
        has_more = len(rows) > limit
        rows = rows[:limit]
        msgs = [to_dto(_row_to_message(r)) for r in rows]
        if order == "DESC":
            msgs.reverse()
        return msgs, cursor, has_more

    # ---- changes -------------------------------------------------------
    def changes_since(
        self, cursor: str | None, limit: int = 200, with_messages: bool = True
    ) -> tuple[list[ChangeItem], str, bool, bool]:
        """(items, next_cursor, has_more, reset)."""
        limit = max(1, min(limit, 500))
        parsed = parse_cursor(cursor)
        with self._conn() as c:
            epoch = self._epoch(c)
            first, head = c.execute(
                "SELECT COALESCE(MIN(revision),1), COALESCE(MAX(revision),0) FROM changes"
            ).fetchone()
            # Unusable: other database, from the future, or older than the pruned log.
            if parsed is None or parsed[0] != epoch or not first - 1 <= parsed[1] <= head:
                return [], format_cursor(epoch, head), False, True
            rows = c.execute(
                "SELECT ch.revision, ch.chat_id AS ch_chat, ch.message_id AS ch_mid, "
                "ch.kind AS ch_kind, ch.generation AS ch_gen, m.* FROM changes ch "
                "LEFT JOIN messages m ON ?3 AND ch.kind IN ('new','edit','delete') "
                "AND m.chat_id=ch.chat_id AND m.message_id=ch.message_id "
                "WHERE ch.revision>?1 ORDER BY ch.revision LIMIT ?2",
                (parsed[1], limit + 1, with_messages),
            ).fetchall()
            has_more = len(rows) > limit
            items = [
                ChangeItem(
                    cursor=format_cursor(epoch, r["revision"]),
                    chat_id=r["ch_chat"],
                    message_id=None if r["ch_mid"] is None else str(r["ch_mid"]),
                    kind=r["ch_kind"],
                    generation=r["ch_gen"],
                    message=None if r["message_id"] is None else to_dto(_row_to_message(r)),
                )
                for r in rows[:limit]
            ]
            nxt = items[-1].cursor if items else format_cursor(epoch, parsed[1])
            return items, nxt, has_more, False

    # ---- outbox --------------------------------------------------------
    @staticmethod
    def _outbox_dto(r: sqlite3.Row) -> OutboxDTO:
        return OutboxDTO(
            request_id=r["request_id"],
            code=r["code"],
            chat_id=r["chat_id"],
            reply_to_message_id=str(r["reply_to_message_id"]),
            status=r["status"],
            message_id=None if r["message_id"] is None else str(r["message_id"]),
            error_code=r["error_code"],
            retry_after=r["retry_after"],
        )

    def outbox_create(
        self, request_id: str, chat_id: str, reply_to: int, text: str, random_id: int, quote: bool = True,
        *, qa: bool = False, qa_role: str | None = None,
    ) -> tuple[OutboxDTO, bool]:
        """Returns (record, created). Same id with different payload => 409. `qa`: a "#QA…" line under a text that
        tags someone, minted once here (the hash is over the text as typed), so a retry sends the same code; `qa_role`
        (BE / PO / QC) goes in it: "#QA_BE_…"."""
        qa_key = f"\nqa{qa_role or ''}" if qa else ""
        h = content_hash(f"{chat_id}\n{reply_to}\n{text}" + ("" if quote else "\nnew") + qa_key)
        with self._conn(write=True) as c:
            row = c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()
            if row is not None:
                if row["text_hash"] != h:
                    raise ApiError(409, "request_payload_mismatch")
                return self._outbox_dto(row), False
            chat = self._chat(c, chat_id)
            # A new message (not quote) only borrows the target's topic: it may be a message read live and never
            # stored (Đối chiếu BE from Với BE / Briefing).
            # ponytail: unstored => General topic, fetch it if forums need it.
            target = self._msg(c, chat_id, reply_to)
            attached = target is None and _attached(c, chat_id, reply_to)
            if chat is None or not (chat["tracking"] or attached):
                raise ApiError(409, "not_tracking")
            if quote and (target["deleted"] if target is not None else not attached):
                raise ApiError(404, "reply_not_found")
            ts = now_ts()
            if qa and has_tag(text):
                text = f"{text.strip()}\n{qa_code(datetime.now(UTC), role=qa_role)}"
            c.execute(
                "INSERT INTO outbox (request_id,chat_id,reply_to_message_id,text,text_hash,"
                "random_id,status,created_at,updated_at,code,quote) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)",
                (request_id, chat_id, reply_to, text, h, random_id, ts, ts, reply_code(request_id), int(quote)),
            )
            return self._outbox_dto(
                c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()
            ), True

    def outbox_get(self, request_id: str) -> OutboxDTO | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()
            return None if r is None else self._outbox_dto(r)

    def outbox_claim(self, request_id: str, allow_unknown: bool = False) -> dict | None:
        """Atomically move pending/failed (and unknown on explicit retry) to sending.

        Returns send parameters, or None when another caller owns it / nothing to send.
        """
        allowed = ("pending", "failed") + (("unknown",) if allow_unknown else ())
        with self._conn(write=True) as c:
            r = c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()
            if r is None or r["status"] not in allowed or not r["text"]:
                return None
            chat = self._chat(c, r["chat_id"])
            if chat is None or not (chat["tracking"] or _attached(c, r["chat_id"], r["reply_to_message_id"])):
                return None
            c.execute(
                "UPDATE outbox SET status='sending', error_code=NULL, retry_after=NULL, "
                "updated_at=? WHERE request_id=?",
                (now_ts(), request_id),
            )
            topic = self._msg(c, r["chat_id"], r["reply_to_message_id"])
            return {
                "chat_id": r["chat_id"],
                "reply_to": r["reply_to_message_id"] if r["quote"] else None,  # None: a new message
                "text": r["text"],
                "random_id": r["random_id"],
                "topic_id": None if topic is None else topic["topic_id"],
            }

    def outbox_finish(
        self,
        request_id: str,
        status: str,
        *,
        message_id: int | None = None,
        error_code: str | None = None,
        retry_after: int | None = None,
        sent: StoredMessage | None = None,
    ) -> OutboxDTO:
        """Record the result; a sent message is upserted in the same transaction."""
        with self._conn(write=True) as c:
            r = c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()
            if r is None:
                raise ApiError(404, "request_not_found")
            c.execute(
                "UPDATE outbox SET status=?, message_id=?, error_code=?, retry_after=?, "
                "updated_at=?, text=CASE WHEN ?='sent' THEN '' ELSE text END, "
                "sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE request_id=?",
                (status, message_id, error_code, retry_after, now_ts(), status, status,
                 now_ts(), request_id),
            )
            if sent is not None:
                chat = self._chat(c, sent.chat_id)
                if chat is not None and chat["tracking"]:
                    self._upsert_message(c, sent, chat)
            if status == "sent" and r["quote"]:  # replying from the dashboard handles the tag
                self._mark(c, r["chat_id"], r["reply_to_message_id"], True, "dashboard")
            return self._outbox_dto(
                c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()
            )

    def outbox_recover(self) -> None:
        """After restart: unclaimed pending is certainly unsent; sending is unknown."""
        with self._conn(write=True) as c:
            ts = now_ts()
            c.execute(
                "UPDATE outbox SET status='failed', error_code='restart', updated_at=? "
                "WHERE status='pending'",
                (ts,),
            )
            c.execute(
                "UPDATE outbox SET status='unknown', error_code='restart', updated_at=? "
                "WHERE status='sending'",
                (ts,),
            )

    # ---- auto-handle rules ---------------------------------------------
    def list_rules(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM rules ORDER BY id")  # every kind RuleKind knows
            return [{**dict(r), "project": json.loads(r["extra"] or "{}").get("project", "")} for r in rows]

    def auto_rules(self) -> dict[str, dict[str, dict]]:
        """Sender id -> {"relay" / "agent": the rule's extra (agent: project, role, platform, intro)}."""
        out: dict[str, dict[str, dict]] = {}
        with self._conn() as c:
            for r in c.execute("SELECT kind, value, extra FROM rules WHERE kind IN ('relay','agent')"):
                out.setdefault(r["value"], {})[r["kind"]] = json.loads(r["extra"] or "{}")
        return out

    def add_rule(self, kind: str, value: str, label: str = "", extra: str = "") -> tuple[dict, list[tuple[str, int]]]:
        """Save a rule (keyword: text in the tag, any case; sender: a sender id) and clear the
        pending tags it already matches; returns the rule and the (chat_id, message_id) it cleared.
        `priority` (a sender id) clears nothing: that sender's tags sort first from now on; nor do `relay` / `agent`."""
        value = value.strip().lower() if kind == "keyword" else value.strip()
        if not value:  # "" is in every text: it would clear every tag
            raise ApiError(422, "rule_value_empty")
        with self._conn(write=True) as c:
            # one sender is either ignored or prioritised, never both: the new rule replaces the other
            if kind == "priority":
                c.execute("DELETE FROM rules WHERE kind='sender' AND value=?", (value,))
            elif kind == "sender":
                c.execute("DELETE FROM rules WHERE kind='priority' AND value=?", (value,))
                self._set_priority(c, value, False)
            c.execute(
                "INSERT INTO rules (kind,value,label,extra) VALUES (?,?,?,?) "
                "ON CONFLICT(kind,value) DO UPDATE SET label=excluded.label, extra=excluded.extra",
                (kind, value, label, extra),
            )
            rule = dict(
                c.execute("SELECT * FROM rules WHERE kind=? AND value=?", (kind, value)).fetchone()
            )
            rule["project"] = json.loads(rule.pop("extra") or "{}").get("project", "")
            if kind == "priority":
                self._set_priority(c, value, True)
            if kind in ("priority", "relay", "agent"):
                return rule, []
            rows = c.execute("SELECT * FROM messages WHERE outgoing=0 AND handled=0 AND deleted=0").fetchall()
            cleared = []
            for r in rows:  # a matching tag is cleared here, then listed for the Undo
                if _rule_matches([rule], _row_to_message(r)) and self._mark(
                    c, r["chat_id"], r["message_id"], True, "rule"
                ):
                    cleared.append((r["chat_id"], r["message_id"]))
        return rule, cleared

    def remove_rule(self, rule_id: int) -> None:
        with self._conn(write=True) as c:
            r = c.execute("DELETE FROM rules WHERE id=? RETURNING kind, value", (rule_id,)).fetchone()
            if r and r["kind"] == "priority":
                self._set_priority(c, r["value"], False)

    def _set_priority(self, c: sqlite3.Connection, sender_id: str, on: bool) -> None:
        """Flag (or unflag) a sender's kept messages; an edit change each, so open lists re-sort."""
        rows = c.execute(
            "UPDATE messages SET priority=?1 WHERE sender_id=?2 AND deleted=0 AND priority IS NOT ?1 "
            "RETURNING chat_id, message_id", (int(on), sender_id),
        ).fetchall()  # fmt: skip
        for r in rows:
            if (chat := self._chat(c, r["chat_id"])) is not None:
                self._record(c, r["chat_id"], r["message_id"], "edit", chat["generation"])

    # ---- tasks ---------------------------------------------------------
    def add_task(
        self, task_id: str, chat_id: str | None, message_id: int | None, project: str,
        prompt: str, mode: str = "plan", session_id: str | None = None, kind: str = "task", title: str | None = None,
        git_base: str | None = None,
    ):  # fmt: skip
        with self._conn(write=True) as c:
            c.execute(
                "INSERT INTO tasks (id, chat_id, message_id, project, created_at, prompt, "
                "mode, session_id, kind, title, git_base) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (task_id, chat_id, message_id, project, now_ts(), prompt, mode, session_id, kind, title, git_base),
            )

    def assist_task(self, task_id: str, chat_id: str, message_id: int) -> str:
        """The tag's Trợ lý AI session (one per tag): made as `task_id` on its first ask, no project, no CLI session."""
        with self._conn(write=True) as c:
            r = c.execute("SELECT id FROM tasks WHERE kind='assist' AND chat_id=? AND message_id=?",
                          (chat_id, message_id)).fetchone()  # fmt: skip
            if r:
                return r[0]
            c.execute(
                "INSERT INTO tasks (id, chat_id, message_id, project, created_at, prompt, mode, kind) "
                "VALUES (?,?,?,'',?,'','plan','assist')",
                (task_id, chat_id, message_id, now_ts()),
            )
            return task_id

    def set_task_base(self, task_id: str, git_base: str | None) -> None:
        with self._conn(write=True) as c:
            c.execute("UPDATE tasks SET git_base=? WHERE id=?", (git_base, task_id))

    def set_task_session(self, task_id: str, session_id: str) -> None:
        with self._conn(write=True) as c:
            c.execute("UPDATE tasks SET session_id=? WHERE id=?", (session_id, task_id))

    def set_task_ai(self, task_id: str, model: str, effort: str) -> bool:
        with self._conn(write=True) as c:
            sql = "UPDATE tasks SET model=?, effort=? WHERE id=?"
            return bool(c.execute(sql, (model, effort, task_id)).rowcount)

    def set_task_done(self, task_id: str, done: bool) -> bool:
        with self._conn(write=True) as c:
            sql = "UPDATE tasks SET done=? WHERE id=?"
            return bool(c.execute(sql, (int(done), task_id)).rowcount)

    def list_tasks(self, chat_id: str | None = None) -> list[dict]:
        """Newest first, with a peek at the tagged message so the task list stands alone."""
        with self._conn() as c:
            rows = c.execute(
                f"SELECT t.*, c.title AS chat_title, m.sender_name, m.text AS message_text, {_TASK_DONE} AS handled, "
                # where its asks go: a reply to the message last attached (ponytail: rowid order, a re-attach keeps
                # its old place; an `at` column if that matters)
                "(SELECT json_object('chat_id', r.chat_id, 'message_id', CAST(r.message_id AS TEXT), 'qa', r.qa) "
                "FROM task_refs r WHERE r.task_id=t.id AND r.ask=1 ORDER BY r.rowid DESC LIMIT 1) AS ask_to "
                "FROM tasks t LEFT JOIN chats c ON c.chat_id=t.chat_id "
                "LEFT JOIN messages m ON m.chat_id=t.chat_id AND m.message_id=t.message_id "
                "WHERE ?1 IS NULL OR t.chat_id=?1 ORDER BY t.created_at DESC LIMIT 200",
                (chat_id,),
            ).fetchall()
        return [dict(r) | {"created_at": _dt(r["created_at"])} for r in rows]

    def open_task_by_ref(self, tail: str) -> str | None:
        """The AI Agent session a "#REF-<tail>" names, unless it is Done (Trợ lý AI ones have no CLI session)."""
        return self._open_task(c_where="t.id LIKE ?", arg=f"%-{tail}")

    def open_task_by_qa(self, code: str) -> str | None:
        """The newest session not Done holding a message of that Q&A thread."""
        return self._open_task(c_where="t.id IN (SELECT task_id FROM task_refs WHERE qa=?)", arg=code)

    def _open_task(self, c_where: str, arg: str) -> str | None:
        with self._conn() as c:
            r = c.execute(  # c-sec-ignore: c_where is one of the two fixed clauses above, the value is a parameter
                "SELECT t.id FROM tasks t LEFT JOIN messages m ON m.chat_id=t.chat_id AND m.message_id=t.message_id "
                f"WHERE {c_where} AND t.kind<>'assist' AND t.mode<>'terminal' AND t.session_id IS NOT NULL "
                f"AND NOT {_TASK_DONE} ORDER BY t.created_at DESC LIMIT 1",
                (arg,),
            ).fetchone()
        return r[0] if r else None

    def get_task(self, task_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(r) if r else None

    def delete_task(self, task_id: str) -> bool:
        with self._conn(write=True) as c:
            c.execute("DELETE FROM task_refs WHERE task_id=?", (task_id,))
            return bool(c.execute("DELETE FROM tasks WHERE id=?", (task_id,)).rowcount)

    def add_task_refs(self, task_id: str, refs: list[tuple[str, int, str]], *, ask: bool = True) -> None:
        """(chat_id, message_id, "#QA…" or ""): attaching again fills a code missed before, never clears one.
        `ask`: the session's asks may reply to them (the last one inserted)."""
        with self._conn(write=True) as c:
            c.executemany(
                "INSERT INTO task_refs (task_id, chat_id, message_id, qa, ask) VALUES (?,?,?,?,?) "
                "ON CONFLICT DO UPDATE SET qa=CASE WHEN excluded.qa<>'' THEN excluded.qa ELSE qa END, "
                "ask=MAX(ask, excluded.ask)",
                [(task_id, cid, mid, qa, int(ask)) for cid, mid, qa in refs],
            )

    def sent_refs(self) -> dict[str, list[str]]:
        """"chat_id:message_id" -> the sessions it went to, newest first: attached to a sent turn, cited by Đối chiếu
        BE, or the tag a session was started on (rows are written only once the turn started)."""
        # ponytail: every group, all time, full scan (~3k rows a year: a few ms); grown slow -> ?chat_id= + an index on
        # task_refs(chat_id, message_id), and the query key per group.
        with self._conn() as c:
            rows = c.execute(
                "SELECT chat_id, message_id, task_id FROM task_refs UNION SELECT chat_id, message_id, id FROM tasks "
                "WHERE chat_id IS NOT NULL AND message_id IS NOT NULL ORDER BY 3 DESC"
            ).fetchall()  # task ids start with their time: newest first
        out: dict[str, list[str]] = {}
        for cid, mid, tid in rows:
            out.setdefault(f"{cid}:{mid}", []).append(tid)
        return out

    def mark_task_refs(self, task_id: str, handled: bool, by: str) -> dict[str, list[int]]:
        """Done / reopen every kept message attached to the session, and the kept tags answering it (under its asks
        and its Q&A questions); the ones that flipped, per chat."""
        out: dict[str, list[int]] = {}
        with self._conn(write=True) as c:
            refs = c.execute("SELECT chat_id, message_id FROM task_refs WHERE task_id=?", (task_id,)).fetchall()
            for cid, mid in dict.fromkeys([tuple(r) for r in refs] + _session_answers(c, task_id)):
                if self._mark(c, cid, mid, handled, by):
                    out.setdefault(cid, []).append(mid)
        return out

    def mark_task_qa(self, task_id: str, handled: bool) -> None:
        """Done / reopen the session's Q&A threads (see _session_qa)."""
        with self._conn(write=True) as c:
            _mark_qa(c, _session_qa(c, task_id), handled)

    def mark_tag_qa(self, chat_id: str, message_ids: list[int], handled: bool) -> None:
        """Done / reopen on tags: the #QA code each names (or, nearest, a message up its reply chain) follows."""
        with self._conn(write=True) as c:
            _mark_qa(c, [_qa_text(c, chat_id, mid) for mid in message_ids], handled)

    def doing_tasks_citing(self, chat_id: str, message_ids: list[int]) -> list[str]:
        """The sessions still in Doing that these messages were attached to (sent along, cited by Đối chiếu BE)."""
        with self._conn() as c:
            return [r[0] for r in c.execute(
                "SELECT DISTINCT t.id FROM task_refs r JOIN tasks t ON t.id=r.task_id "
                "LEFT JOIN messages m ON m.chat_id=t.chat_id AND m.message_id=t.message_id "
                f"WHERE r.chat_id=? AND r.message_id IN (SELECT value FROM json_each(?)) AND NOT {_TASK_DONE}",
                (chat_id, json.dumps(message_ids)),
            ).fetchall()]  # fmt: skip

    def tasks_on(self, chat_id: str, message_ids: list[int]) -> list[str]:
        """The sessions sitting on these messages."""
        with self._conn() as c:
            return [r[0] for r in c.execute(
                "SELECT id FROM tasks WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))",
                (chat_id, json.dumps(message_ids)),
            ).fetchall()]  # fmt: skip

    # ---- projects ------------------------------------------------------
    def find_mentions(self, needle: str, limit: int = 20) -> list[dict]:
        """Stored messages of tracked chats that mention `needle` (a ticket ID), newest first."""
        word = re.compile(rf"(?<![\w-]){re.escape(needle)}(?!\d)", re.I)  # VA-12 must not match VA-123
        with self._conn() as c:
            rows = c.execute(  # no SQL LIMIT: VA-10..VA-1999 must not crowd out VA-1's real mentions
                "SELECT m.chat_id, m.message_id, m.sender_name, m.text, m.date, m.outgoing, m.reply_to_id, c.title "
                "FROM messages m JOIN chats c USING(chat_id) WHERE m.deleted=0 AND c.tracking=1 "
                "AND m.text LIKE ? ESCAPE '\\' ORDER BY m.date DESC",
                (_like(needle),),
            )
            return [dict(r) for r in itertools.islice((r for r in rows if word.search(r["text"])), limit)]

    def week_stats(self, now: datetime | None = None) -> dict:
        """"Tuần của tôi": tags received in the last 7 days and the 7 before, how they got handled and how fast
        (handled_at - date; rule auto-handles and rows from before handled_at was kept are left out of the timing),
        and this week's slowest groups by median time to handle (2+ timed tags)."""
        end = _ts(now or datetime.now(UTC))
        week = 7 * 86400
        with self._conn() as c:
            rows = c.execute(
                "SELECT m.chat_id, c.title, m.date, m.handled, m.handled_by, m.handled_at FROM messages m "
                "JOIN chats c USING (chat_id) WHERE m.outgoing=0 AND m.deleted=0 AND m.date>=? AND m.date<?",
                (end - 2 * week, end),
            ).fetchall()

        def mins(rs) -> list[float]:
            return sorted((r["handled_at"] - r["date"]) / 60 for r in rs
                          if r["handled"] and r["handled_at"] and r["handled_by"] not in ("", "rule"))  # fmt: skip

        def numbers(rs) -> dict:
            how = [r["handled_by"] for r in rs if r["handled"]]
            t = mins(rs)
            return {
                "received": len(rs), "handled": sum(h != "rule" for h in how), "auto": how.count("rule"),
                "replied": sum(h in ("reply", "dashboard") for h in how),
                "marked": sum(h in ("me", "quiet", "all") for h in how),
                "median_min": statistics.median(t) if t else None,
                "p90_min": t[math.ceil(0.9 * len(t)) - 1] if t else None,  # nearest rank
            }  # fmt: skip

        cur = [r for r in rows if r["date"] >= end - week]
        by: dict[str, list] = {}
        for r in cur:
            by.setdefault(r["chat_id"], []).append(r)
        slow = [{"chat_id": cid, "title": rs[0]["title"], "handled": len(t), "median_min": statistics.median(t)}
                for cid, rs in by.items() if len(t := mins(rs)) >= 2]  # fmt: skip
        slow.sort(key=lambda g: -g["median_min"])
        return {"cur": numbers(cur), "prev": numbers([r for r in rows if r["date"] < end - week]), "slow": slow[:5]}

    def my_replies(self, since: int, limit: int = 40, chat_id: str | None = None) -> list[dict]:
        """What the user sent in tracked groups (or one group) since a unix time, oldest first:
        a standup, the promises list, the drafts' tone."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT c.title, m.text, m.date FROM messages m JOIN chats c USING(chat_id) "
                "WHERE m.outgoing=1 AND m.deleted=0 AND c.tracking=1 AND m.date>=? "
                "AND m.text!='' AND (? IS NULL OR m.chat_id=?) "
                "ORDER BY m.date DESC LIMIT ?",  # the newest ones when there are more
                (since, chat_id, chat_id, limit),
            ).fetchall()
        return [dict(r) for r in reversed(rows)]

    def list_projects(self) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute("SELECT * FROM projects ORDER BY name")]

    def add_project(self, path: str, name: str) -> None:
        with self._conn(write=True) as c:
            c.execute("INSERT OR REPLACE INTO projects VALUES (?,?)", (path, name))

    def remove_project(self, path: str) -> None:
        with self._conn(write=True) as c:
            c.execute("DELETE FROM projects WHERE path=?", (path,))

    def qa_marks(self, chat_id: str) -> dict[str, str]:
        """Thread code -> 'done' / 'deleted' for one group."""
        with self._conn() as c:
            rows = c.execute("SELECT code, state FROM qa_marks WHERE chat_id=?", (chat_id,))
            return {r["code"]: r["state"] for r in rows}

    def set_qa_mark(self, chat_id: str, code: str, state: str | None) -> str | None:
        """The state it had before."""
        with self._conn(write=True) as c:
            r = c.execute("SELECT state FROM qa_marks WHERE chat_id=? AND code=?", (chat_id, code)).fetchone()
            if state:
                c.execute("INSERT OR REPLACE INTO qa_marks VALUES (?,?,?,?)", (chat_id, code, state, now_ts()))
            else:
                c.execute("DELETE FROM qa_marks WHERE chat_id=? AND code=?", (chat_id, code))
            return r[0] if r else None

    def mark_qa_thread(self, chat_id: str, code: str, handled: bool) -> list[int]:
        """Done / reopen (no reaction) the kept tags (not mine) of a Q&A thread: its question and the replies under
        it; the ones that flipped."""
        with self._conn(write=True) as c:
            tags = _tags_under(c, _code_roots(c, chat_id, code))
            return [mid for cid, mid in tags if self._mark(c, cid, mid, handled, "quiet")]

    def has_project(self, path: str) -> bool:
        with self._conn() as c:
            return c.execute("SELECT 1 FROM projects WHERE path=?", (path,)).fetchone() is not None

    # ---- digests -------------------------------------------------------
    def briefing_rows(self) -> list[dict]:
        """Tracked chats plus untagged ones opened to Digest (any consent row, even expired), each
        with its title, whether the consent is live (and until when: past = expired), and its saved digest (None when
        none)."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT c.chat_id, c.title, dc.expires_at>unixepoch() AS consent, dc.expires_at, d.chat_id AS d_chat, "
                "d.last_message_id, d.last_date, d.result, d.created_at FROM chats c "
                "LEFT JOIN digest_consents dc USING (chat_id) LEFT JOIN digests d USING (chat_id) "
                "WHERE c.tracking=1 OR dc.chat_id IS NOT NULL"
            ).fetchall()  # fmt: skip
        keys = ("chat_id", "last_message_id", "last_date", "result", "created_at")
        return [{"chat_id": r["chat_id"], "title": r["title"], "consent": bool(r["consent"]),
                 "consent_until": r["expires_at"],
                 "digest": dict(zip(keys, (r["d_chat"], *(r[k] for k in keys[1:])), strict=True))
                 if r["d_chat"] else None} for r in rows]  # fmt: skip

    def get_digest_consent(self, chat_id: str) -> int | None:
        """Expiry (epoch seconds) of the chat-wide Digest consent, or None when absent/expired."""
        with self._conn() as c:
            r = c.execute(
                "SELECT expires_at FROM digest_consents WHERE chat_id=? AND expires_at>?",
                (chat_id, now_ts()),
            ).fetchone()
            return None if r is None else r["expires_at"]

    def set_digest_consent(self, chat_id: str, expires_at: datetime | None) -> None:
        """None revokes."""
        with self._conn(write=True) as c:
            if expires_at is None:
                c.execute("DELETE FROM digest_consents WHERE chat_id=?", (chat_id,))
                c.execute("DELETE FROM digests WHERE chat_id=?", (chat_id,))
            else:
                c.execute(
                    "INSERT OR REPLACE INTO digest_consents VALUES (?,?,?)",
                    (chat_id, _ts(expires_at), now_ts()),
                )

    def save_consented_digest(self, chat_id: str, last_id: int, last_date: datetime, result: str) -> bool:
        """Save a digest only while the chat's consent still holds, checked in the same transaction (a revoke
        during the AI run drops the result). False: not saved."""
        with self._conn(write=True) as c:
            if c.execute("SELECT 1 FROM digest_consents WHERE chat_id=? AND expires_at>?",
                         (chat_id, now_ts())).fetchone() is None:  # fmt: skip
                return False
            self._save_digest(c, chat_id, last_id, last_date, result)
            return True

    def save_digest(self, chat_id: str, last_id: int, last_date: datetime, result: str) -> None:
        with self._conn(write=True) as c:
            self._save_digest(c, chat_id, last_id, last_date, result)

    @staticmethod
    def _save_digest(c: sqlite3.Connection, chat_id: str, last_id: int, last_date: datetime, result: str) -> None:
        old = c.execute("SELECT last_message_id, last_date FROM digests WHERE chat_id=?", (chat_id,)).fetchone()
        last_ts = _ts(last_date)
        if old and old["last_message_id"] > last_id:  # an older stretch: keep the cursor
            last_id, last_ts = old["last_message_id"], old["last_date"]
        c.execute("INSERT OR REPLACE INTO digests VALUES (?,?,?,?,?)", (chat_id, last_id, last_ts, result, now_ts()))

    def get_digest(self, chat_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM digests WHERE chat_id=?", (chat_id,)).fetchone()
            return None if r is None else dict(r)

    # ---- local data (Settings › Dữ liệu) ---------------------------------
    def data_stats(self, before: int) -> dict:
        """Bytes and rows per table (indexes counted in their table), per group, and what each clear would drop."""
        with self._conn() as c:
            try:  # dbstat: compiled into the bundled SQLite; elsewhere sizes fall back to row counts only
                size = dict(c.execute(
                    "SELECT COALESCE(s.tbl_name, d.name), SUM(d.pgsize) FROM dbstat d "
                    "LEFT JOIN sqlite_schema s ON s.name=d.name GROUP BY 1"
                ).fetchall())  # fmt: skip
            except sqlite3.Error:
                size = {}
            names = c.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            count = lambda n: c.execute(f'SELECT COUNT(*) FROM "{n}"').fetchone()[0]  # noqa: E731
            tables = [{"name": n, "rows": count(n), "bytes": size.get(n, 0)} for (n,) in names.fetchall()]
            chats = [dict(r) for r in c.execute(
                f"SELECT m.chat_id, COALESCE(c.title, m.chat_id) AS title, COUNT(*) AS rows, {_ROW_BYTES} AS bytes "
                "FROM messages m LEFT JOIN chats c USING (chat_id) WHERE m.deleted=0 "
                "GROUP BY m.chat_id ORDER BY bytes DESC"
            )]  # fmt: skip
            old = c.execute(
                f"SELECT COUNT(*), {_ROW_BYTES}, MIN(date) FROM messages m WHERE {_OLD_MSG}", (before,)
            ).fetchone()
            dig = c.execute("SELECT COUNT(*), SUM(LENGTH(result)), MIN(created_at) FROM digests").fetchone()
            sent = c.execute(  # ponytail: ~120 bytes a row (the text is dropped once sent)
                "SELECT COUNT(*), COUNT(*) * 120, MIN(created_at) FROM outbox WHERE status='sent' AND created_at<?",
                (before,),
            ).fetchone()
            page = c.execute("PRAGMA page_size").fetchone()[0]
            free = c.execute("PRAGMA freelist_count").fetchone()[0] * page
        item = lambda r: {"count": r[0], "bytes": r[1] or 0, "oldest": r[2]}  # noqa: E731
        return {"tables": tables, "chats": chats, "free": free,
                "messages": item(old), "digests": item(dig), "outbox": item(sent)}  # fmt: skip

    def prune_messages(self, before: int) -> int:
        """Handled tags and our replies older than `before`, unless an AI session, a Báo lại item or a pin still
        uses them. Tombstones stay (they keep a deleted message from coming back); `pruned_before` keeps a later
        edit or backfill from storing them again as new tags."""
        with self._conn(write=True) as c:
            n = c.execute(f"DELETE FROM messages AS m WHERE {_OLD_MSG}", (before,)).rowcount
            c.execute("INSERT OR REPLACE INTO metadata VALUES ('pruned_before', ?)",
                      (str(max(before, self._pruned_before(c))),))  # fmt: skip
        return n

    def clear_digests(self) -> int:
        with self._conn(write=True) as c:
            return c.execute("DELETE FROM digests").rowcount

    def clear_sent(self, before: int) -> int:
        with self._conn(write=True) as c:
            return c.execute("DELETE FROM outbox WHERE status='sent' AND created_at<?", (before,)).rowcount

    @staticmethod
    def _pruned_before(c: sqlite3.Connection) -> int:
        r = c.execute("SELECT value FROM metadata WHERE key='pruned_before'").fetchone()
        return int(r[0]) if r else 0

    def compact(self) -> None:
        """Give the space of deleted rows back to the disk (SQLite keeps it as free pages otherwise)."""
        c = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        try:
            c.execute("VACUUM")
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            c.close()


class Db:
    """Runs Store calls off the event loop and wakes SSE subscribers after commits."""

    def __init__(self, store: Store, hub):
        self.store = store
        self.hub = hub

    async def read(self, fn, *args, **kwargs):
        return await asyncio.to_thread(fn, *args, **kwargs)

    async def write(self, fn, *args, **kwargs):
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        finally:
            self.hub.notify()
