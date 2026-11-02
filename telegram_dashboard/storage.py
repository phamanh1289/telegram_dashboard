"""SQLite store. Sync methods; callers run them off the event loop via `Db`."""

import asyncio
import hashlib
import json
import logging
import re
import sqlite3
import uuid
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

log = logging.getLogger("telegram_dashboard.storage")

KEEP_CHANGES = 50_000  # change-log rows kept on startup; older cursors get a reset
# A tag still waiting for the user (messages aliased `m`); snoozed ones come back on their own.
PENDING = (
    "m.outgoing=0 AND m.handled=0 AND m.deleted=0 AND COALESCE(m.snoozed_until,0)<=unixepoch()"
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  tracking INTEGER NOT NULL DEFAULT 0,
  tracked_at INTEGER,
  generation INTEGER NOT NULL DEFAULT 0,
  migrated_to TEXT
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
  snoozed_until INTEGER,
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
  sent_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_permissions (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  participants TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,   -- keyword
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
  session_id TEXT
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
        snoozed_until=_dt(r["snoozed_until"]),
        pinned=bool(r["pinned"]),
        links=json.loads(r["links"]),
    )


def _is_basic_group(chat_id: str) -> bool:
    return not chat_id.startswith("-100")


def _rule_matches(rules: list[dict], m: StoredMessage) -> bool:
    text = m.text.lower()
    return any(r["kind"] == "keyword" and r["value"] in text for r in rules)


def _like(text: str) -> str:
    """`%text%` for LIKE ... ESCAPE '\\'."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _add_missing_columns(c: sqlite3.Connection) -> None:
    """Databases from before versioning may lack these columns; a no-op on new ones."""
    for table, col, ddl in (
        ("messages", "handled", "INTEGER NOT NULL DEFAULT 0"),
        ("messages", "links", "TEXT NOT NULL DEFAULT '[]'"),
        ("messages", "snoozed_until", "INTEGER"),
        ("messages", "pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("tasks", "prompt", "TEXT"),
        ("tasks", "mode", "TEXT NOT NULL DEFAULT 'terminal'"),
        ("tasks", "session_id", "TEXT"),
        ("tasks", "tty", "TEXT"),
        ("outbox", "code", "TEXT"),
        ("outbox", "sent_text", "TEXT NOT NULL DEFAULT ''"),
        ("outbox", "sent_at", "INTEGER"),
    ):
        if col not in {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    for (rid,) in c.execute("SELECT request_id FROM outbox WHERE code IS NULL").fetchall():
        c.execute("UPDATE outbox SET code=? WHERE request_id=?", (reply_code(rid), rid))
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS outbox_code ON outbox(code)")
    c.execute("UPDATE outbox SET sent_text='' WHERE sent_text!=''")  # no longer kept


# Run once each, in order; PRAGMA user_version = how many ran. Append only, never edit.
MIGRATIONS = [_add_missing_columns]


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._init()

    @contextmanager
    def _conn(self, write: bool = False):
        conn = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
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
            conn.close()

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

    @staticmethod
    def _revoke_grants(c: sqlite3.Connection, chat_id: str, message_ids: list[int] | None = None):
        if message_ids is None:
            c.execute("UPDATE ai_permissions SET revoked=1 WHERE chat_id=?", (chat_id,))
        else:
            c.executemany(
                "UPDATE ai_permissions SET revoked=1 WHERE chat_id=? AND message_id=?",
                [(chat_id, m) for m in message_ids],
            )

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

    def track_mention(self, chat_id: str, title: str, kind: str) -> None:
        """A chat exists here only because it tagged us."""
        self.set_tracking(chat_id, True, title, kind)

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
                "UPDATE chats SET tracking=0, generation=?, tracked_at=NULL WHERE chat_id=?",
                (gen, chat_id),
            )
            c.execute(
                "UPDATE outbox SET status='failed', error_code='purged', updated_at=? "
                "WHERE chat_id=? AND status='pending'",
                (now_ts(), chat_id),
            )
            self._clear_outbox_text(c, chat_id, None)
            self._revoke_grants(c, chat_id)
            c.execute("DELETE FROM digest_consents WHERE chat_id=?", (chat_id,))
            c.execute("DELETE FROM digests WHERE chat_id=?", (chat_id,))
            c.execute("DELETE FROM messages WHERE chat_id=?", (chat_id,))
            self._record(c, chat_id, None, "purge", gen)

    def get_chat(self, chat_id: str) -> dict | None:
        with self._conn() as c:
            r = self._chat(c, chat_id)
            return None if r is None else dict(r)

    def is_tracking(self, chat_id: str) -> bool:
        row = self.get_chat(chat_id)
        return bool(row and row["tracking"])

    def briefing_chat_ids(self) -> list[str]:
        """Tracked chats plus untagged ones opened to Digest (any consent row, even expired)."""
        with self._conn() as c:
            return [r[0] for r in c.execute(
                "SELECT chat_id FROM chats WHERE tracking=1 "
                "OR chat_id IN (SELECT chat_id FROM digest_consents)"
            )]  # fmt: skip

    def list_chats(
        self, since: datetime | None = None, until: datetime | None = None
    ) -> tuple[list[ChatDTO], str]:
        """With a range, only chats that have a kept message in [since, until)."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT *, (SELECT COUNT(*) FROM messages m WHERE m.chat_id=chats.chat_id "
                f"AND {PENDING} AND (?1 IS NULL OR m.date>=?1) AND (?2 IS NULL OR m.date<?2)) "
                "AS pending FROM chats WHERE (?1 IS NULL AND ?2 IS NULL) OR EXISTS (SELECT 1 "
                "FROM messages m WHERE m.chat_id=chats.chat_id AND m.deleted=0 "
                "AND (?1 IS NULL OR m.date>=?1) AND (?2 IS NULL OR m.date<?2)) "
                "ORDER BY pending=0, title COLLATE NOCASE",
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
            c.execute(
                "INSERT INTO messages (sender_id,sender_name,text,date,edit_date,reply_to_id,"
                "topic_id,outgoing,media_kind,links,chat_id,message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (*values, m.chat_id, m.message_id),
            )
            self._record(c, m.chat_id, m.message_id, "new", chat["generation"])
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
        self._revoke_grants(c, m.chat_id, [m.message_id])
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
        track the chat, store the message, apply ignore rules, mark answered ones handled.
        Returns ids of tags seen for the first time and still pending (to notify about)."""
        fresh = []
        with self._conn(write=True) as c:
            rules = [dict(r) for r in c.execute("SELECT * FROM rules")]
            for title, kind, m, replied in found:
                try:
                    self._set_tracking(c, m.chat_id, True, title, kind)
                except ApiError:
                    continue  # migrated chat
                new = self._msg(c, m.chat_id, m.message_id) is None
                self._upsert_message(c, m, self._chat(c, m.chat_id))
                if replied or _rule_matches(rules, m):
                    self._set_col(c, m.chat_id, m.message_id, "handled", 1, only_change=True)
                elif new:
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
                self._revoke_grants(c, cid, [mid])
                self._record(c, cid, mid, "delete", chat["generation"])
                touched.append(cid)
        return touched

    def set_handled(self, chat_id: str, message_id: int, handled: bool) -> bool:
        """Mark a kept message handled or not; emits an edit change when it flips."""
        with self._conn(write=True) as c:
            return self._set_col(c, chat_id, message_id, "handled", int(handled), only_change=True)

    def set_snooze(self, chat_id: str, message_id: int, until: datetime | None) -> bool:
        with self._conn(write=True) as c:
            return self._set_col(c, chat_id, message_id, "snoozed_until", _ts(until))

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

    def list_pending(
        self, since: datetime | None = None, until: datetime | None = None, limit: int = 300
    ) -> list[tuple[str, MessageDTO]]:
        """Pending tags across all chats, pinned first then oldest: (chat title, message)."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT m.*, c.title AS chat_title FROM messages m JOIN chats c USING (chat_id) "
                f"WHERE c.tracking=1 AND {PENDING} AND (?1 IS NULL OR m.date>=?1) "
                "AND (?2 IS NULL OR m.date<?2) ORDER BY m.pinned DESC, m.date LIMIT ?3",
                (_ts(since), _ts(until), limit),
            ).fetchall()
        return [(r["chat_title"], to_dto(_row_to_message(r))) for r in rows]

    def mark_all_handled(
        self, chat_id: str, since: datetime | None = None, until: datetime | None = None
    ) -> list[int]:
        """Mark every pending tag of a tracked chat (within [since, until)) handled, the same
        ones the pending count shows; returns their ids."""
        with self._conn(write=True) as c:
            chat = self._chat(c, chat_id)
            if chat is None or not chat["tracking"]:
                return []
            ids = sorted(r[0] for r in c.execute(
                f"UPDATE messages AS m SET handled=1 WHERE m.chat_id=?1 AND {PENDING} "
                "AND (?2 IS NULL OR m.date>=?2) AND (?3 IS NULL OR m.date<?3) RETURNING message_id",
                (chat_id, _ts(since), _ts(until)),
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
    ) -> tuple[list[MessageDTO], str, bool]:
        limit = max(1, min(limit, 100))
        where, args = ["chat_id=?"], [chat_id]
        if q:
            where.append("deleted=0 AND text LIKE ? ESCAPE '\\'")
            args.append(_like(q))
        if pending:
            where.append(PENDING)
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
        self, request_id: str, chat_id: str, reply_to: int, text: str, random_id: int
    ) -> tuple[OutboxDTO, bool]:
        """Returns (record, created). Same id with different payload => 409."""
        h = content_hash(f"{chat_id}\n{reply_to}\n{text}")
        with self._conn(write=True) as c:
            row = c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()
            if row is not None:
                if row["text_hash"] != h:
                    raise ApiError(409, "request_payload_mismatch")
                return self._outbox_dto(row), False
            chat = self._chat(c, chat_id)
            if chat is None or not chat["tracking"]:
                raise ApiError(409, "not_tracking")
            target = self._msg(c, chat_id, reply_to)
            if target is None or target["deleted"]:
                raise ApiError(404, "reply_not_found")
            ts = now_ts()
            c.execute(
                "INSERT INTO outbox (request_id,chat_id,reply_to_message_id,text,text_hash,"
                "random_id,status,created_at,updated_at,code) VALUES (?,?,?,?,?,?,'pending',?,?,?)",
                (request_id, chat_id, reply_to, text, h, random_id, ts, ts, reply_code(request_id)),
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
            if chat is None or not chat["tracking"]:
                return None
            c.execute(
                "UPDATE outbox SET status='sending', error_code=NULL, retry_after=NULL, "
                "updated_at=? WHERE request_id=?",
                (now_ts(), request_id),
            )
            topic = self._msg(c, r["chat_id"], r["reply_to_message_id"])
            return {
                "chat_id": r["chat_id"],
                "reply_to": r["reply_to_message_id"],
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
            if status == "sent":  # replying from the dashboard handles the tag
                self._set_col(c, r["chat_id"], r["reply_to_message_id"], "handled", 1, True)
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
            rows = c.execute("SELECT * FROM rules WHERE kind='keyword' ORDER BY id")
            return [dict(r) for r in rows]

    def add_rule(self, kind: str, value: str, label: str = "") -> tuple[dict, int]:
        """Save a rule and clear the pending tags it already matches."""
        value = value.strip().lower()
        with self._conn(write=True) as c:
            c.execute(
                "INSERT INTO rules (kind,value,label) VALUES (?,?,?) "
                "ON CONFLICT(kind,value) DO UPDATE SET label=excluded.label",
                (kind, value, label),
            )
            rule = dict(
                c.execute("SELECT * FROM rules WHERE kind=? AND value=?", (kind, value)).fetchone()
            )
            rows = c.execute(
                "SELECT * FROM messages WHERE outgoing=0 AND handled=0 AND deleted=0"
            ).fetchall()
            n = sum(
                self._set_col(c, r["chat_id"], r["message_id"], "handled", 1, True)
                for r in rows
                if _rule_matches([rule], _row_to_message(r))
            )
        return rule, n

    def remove_rule(self, rule_id: int) -> None:
        with self._conn(write=True) as c:
            c.execute("DELETE FROM rules WHERE id=?", (rule_id,))

    # ---- tasks ---------------------------------------------------------
    def add_task(
        self, task_id: str, chat_id: str | None, message_id: int | None, project: str,
        prompt: str, mode: str = "plan", session_id: str | None = None,
    ):  # fmt: skip
        with self._conn(write=True) as c:
            c.execute(
                "INSERT INTO tasks (id, chat_id, message_id, project, created_at, prompt, "
                "mode, session_id) VALUES (?,?,?,?,?,?,?,?)",
                (task_id, chat_id, message_id, project, now_ts(), prompt, mode, session_id),
            )

    def set_task_session(self, task_id: str, session_id: str) -> None:
        with self._conn(write=True) as c:
            c.execute("UPDATE tasks SET session_id=? WHERE id=?", (session_id, task_id))

    def list_tasks(self, chat_id: str | None = None) -> list[dict]:
        """Newest first, with a peek at the tagged message so the task list stands alone."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT t.*, c.title AS chat_title, m.sender_name, m.text AS message_text, "
                "COALESCE(m.handled, 0) AS handled "
                "FROM tasks t LEFT JOIN chats c ON c.chat_id=t.chat_id "
                "LEFT JOIN messages m ON m.chat_id=t.chat_id AND m.message_id=t.message_id "
                "WHERE ?1 IS NULL OR t.chat_id=?1 ORDER BY t.created_at DESC LIMIT 200",
                (chat_id,),
            ).fetchall()
        return [dict(r) | {"created_at": _dt(r["created_at"])} for r in rows]

    def get_task(self, task_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(r) if r else None

    def delete_task(self, task_id: str) -> bool:
        with self._conn(write=True) as c:
            return bool(c.execute("DELETE FROM tasks WHERE id=?", (task_id,)).rowcount)

    # ---- projects ------------------------------------------------------
    def find_mentions(self, needle: str, limit: int = 20) -> list[dict]:
        """Stored messages of tracked chats that mention `needle` (a ticket ID), newest first."""
        word = re.compile(rf"(?<![\w-]){re.escape(needle)}(?!\d)", re.I)  # VA-12 must not match VA-123
        with self._conn() as c:
            rows = c.execute(
                "SELECT m.chat_id, m.message_id, m.sender_name, m.text, m.date, c.title "
                "FROM messages m JOIN chats c USING(chat_id) WHERE m.deleted=0 AND c.tracking=1 "
                "AND m.text LIKE ? ESCAPE '\\' ORDER BY m.date DESC LIMIT ?",
                (_like(needle), limit * 3),
            ).fetchall()
        return [dict(r) for r in rows if word.search(r["text"])][:limit]

    def list_projects(self) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute("SELECT * FROM projects ORDER BY name")]

    def add_project(self, path: str, name: str) -> None:
        with self._conn(write=True) as c:
            c.execute("INSERT OR REPLACE INTO projects VALUES (?,?)", (path, name))

    def remove_project(self, path: str) -> None:
        with self._conn(write=True) as c:
            c.execute("DELETE FROM projects WHERE path=?", (path,))

    def has_project(self, path: str) -> bool:
        with self._conn() as c:
            return c.execute("SELECT 1 FROM projects WHERE path=?", (path,)).fetchone() is not None

    # ---- AI grants -----------------------------------------------------
    def put_grant(
        self, chat_id: str, message_id: int, scope: str, expires_at: datetime,
        participants: dict[str, str],
    ) -> None:  # fmt: skip
        with self._conn(write=True) as c:
            m = self._msg(c, chat_id, message_id)
            if m is None or m["deleted"]:
                raise ApiError(404, "message_not_found")
            c.execute(
                "INSERT OR REPLACE INTO ai_permissions VALUES (?,?,?,?,?,?,0,?)",
                (chat_id, message_id, content_hash(m["text"]), scope, _ts(expires_at),
                 json.dumps(participants, sort_keys=True), now_ts()),
            )  # fmt: skip

    def revoke_grants(self, chat_id: str, message_ids: list[int]) -> None:
        with self._conn(write=True) as c:
            self._revoke_grants(c, chat_id, message_ids)

    def get_grant(self, chat_id: str, message_id: int) -> dict | None:
        with self._conn() as c:
            r = c.execute(
                "SELECT * FROM ai_permissions WHERE chat_id=? AND message_id=?",
                (chat_id, message_id),
            ).fetchone()
            if r is None:
                return None
            d = dict(r)
            d["participants"] = json.loads(d["participants"])
            return d

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

    def save_digest(self, chat_id: str, last_id: int, last_date: datetime, result: str) -> None:
        with self._conn(write=True) as c:
            old = c.execute(
                "SELECT last_message_id, last_date FROM digests WHERE chat_id=?", (chat_id,)
            ).fetchone()
            last_ts = _ts(last_date)
            if old and old["last_message_id"] > last_id:  # an older stretch: keep the cursor
                last_id, last_ts = old["last_message_id"], old["last_date"]
            c.execute(
                "INSERT OR REPLACE INTO digests VALUES (?,?,?,?,?)",
                (chat_id, last_id, last_ts, result, now_ts()),
            )

    def get_digest(self, chat_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM digests WHERE chat_id=?", (chat_id,)).fetchone()
            return None if r is None else dict(r)


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
