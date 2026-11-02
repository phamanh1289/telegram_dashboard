"""SQLite store. Sync methods; callers run them off the event loop via `Db`."""

import asyncio
import hashlib
import json
import logging
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

SCHEMA_VERSION = 1
INITIAL_HISTORY_LIMIT = 50

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  tracking INTEGER NOT NULL DEFAULT 0,
  tracked_at INTEGER,
  generation INTEGER NOT NULL DEFAULT 0,
  history_checkpoint INTEGER,  -- NULL until the initial history batch is stored
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


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._init()

    @contextmanager
    def _conn(self, write: bool = False):
        conn = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
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
            c.execute("PRAGMA journal_mode=WAL")
        finally:
            c.close()
        with self._conn(write=True) as c:
            for stmt in SCHEMA.split(";"):
                if stmt.strip():
                    c.execute(stmt)
            c.execute(
                "INSERT OR IGNORE INTO metadata VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
            c.execute("INSERT OR IGNORE INTO metadata VALUES ('db_epoch', ?)", (str(uuid.uuid4()),))
            cols = {r["name"] for r in c.execute("PRAGMA table_info(messages)")}
            if "handled" not in cols:  # databases created before the flag existed
                c.execute("ALTER TABLE messages ADD COLUMN handled INTEGER NOT NULL DEFAULT 0")
            if "links" not in cols:
                c.execute("ALTER TABLE messages ADD COLUMN links TEXT NOT NULL DEFAULT '[]'")
            if "snoozed_until" not in cols:
                c.execute("ALTER TABLE messages ADD COLUMN snoozed_until INTEGER")
            if "prompt" not in {r["name"] for r in c.execute("PRAGMA table_info(tasks)")}:
                c.execute("ALTER TABLE tasks ADD COLUMN prompt TEXT")
            tcols = {r["name"] for r in c.execute("PRAGMA table_info(tasks)")}
            if "mode" not in tcols:
                c.execute("ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'terminal'")
            if "session_id" not in tcols:
                c.execute("ALTER TABLE tasks ADD COLUMN session_id TEXT")
            if "tty" not in {r["name"] for r in c.execute("PRAGMA table_info(tasks)")}:
                c.execute("ALTER TABLE tasks ADD COLUMN tty TEXT")
            if "pinned" not in cols:
                c.execute("ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
            ocols = {r["name"] for r in c.execute("PRAGMA table_info(outbox)")}
            for col, ddl in (
                ("code", "TEXT"),
                ("sent_text", "TEXT NOT NULL DEFAULT ''"),
                ("sent_at", "INTEGER"),
            ):
                if col not in ocols:
                    c.execute(f"ALTER TABLE outbox ADD COLUMN {col} {ddl}")
            for r in c.execute("SELECT request_id FROM outbox WHERE code IS NULL").fetchall():
                c.execute(
                    "UPDATE outbox SET code=? WHERE request_id=?",
                    (reply_code(r["request_id"]), r["request_id"]),
                )
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS outbox_code ON outbox(code)")
            c.execute("UPDATE outbox SET sent_text='' WHERE sent_text!=''")  # no longer kept
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
                        "UPDATE chats SET tracking=1, tracked_at=?, history_checkpoint=NULL, "
                        "title=COALESCE(?,title) WHERE chat_id=?",
                        (now_ts(), title, chat_id),
                    )
                    self._record(c, chat_id, None, "tracking", row["generation"])
                return row["generation"]
            gen = row["generation"]
            if row["tracking"]:
                gen += 1
                c.execute(
                    "UPDATE chats SET tracking=0, generation=? WHERE chat_id=?", (gen, chat_id)
                )
                c.execute(
                    "UPDATE outbox SET status='failed', error_code='untracked', text='', "
                    "updated_at=? WHERE chat_id=? AND status='pending'",
                    (now_ts(), chat_id),
                )
                self._record(c, chat_id, None, "untrack", gen)
            return gen

    def track_mention(self, chat_id: str, title: str, kind: str) -> None:
        """A chat exists here only because it tagged us; checkpoint 0 means no history backfill."""
        self.set_tracking(chat_id, True, title, kind)
        with self._conn(write=True) as c:
            c.execute(
                "UPDATE chats SET history_checkpoint=0, title=? "
                "WHERE chat_id=? AND history_checkpoint IS NULL",
                (title, chat_id),
            )

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
                "UPDATE chats SET tracking=0, generation=?, history_checkpoint=NULL, "
                "tracked_at=NULL WHERE chat_id=?",
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

    def chat_generation(self, chat_id: str) -> int | None:
        row = self.get_chat(chat_id)
        return None if row is None else row["generation"]

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
                "AND m.outgoing=0 AND m.handled=0 AND m.deleted=0 "
                "AND COALESCE(m.snoozed_until,0)<=?2 "
                "AND (?1 IS NULL OR m.date>=?1) AND (?3 IS NULL OR m.date<?3)) AS pending "
                "FROM chats WHERE (?1 IS NULL AND ?3 IS NULL) OR EXISTS (SELECT 1 FROM messages m "
                "WHERE m.chat_id=chats.chat_id AND m.deleted=0 "
                "AND (?1 IS NULL OR m.date>=?1) AND (?3 IS NULL OR m.date<?3)) "
                "ORDER BY pending=0, title COLLATE NOCASE",
                (_ts(since), now_ts(), _ts(until)),
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
        existing = c.execute(
            "SELECT * FROM messages WHERE chat_id=? AND message_id=?", (m.chat_id, m.message_id)
        ).fetchone()
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

    def apply_message(self, m: StoredMessage, generation: int | None = None) -> bool:
        with self._conn(write=True) as c:
            chat = self._chat(c, m.chat_id)
            if chat is None or not chat["tracking"]:
                return False
            if generation is not None and generation != chat["generation"]:
                return False
            return self._upsert_message(c, m, chat)

    def apply_history_batch(
        self, chat_id: str, generation: int, messages: list[StoredMessage], checkpoint: int
    ) -> bool:
        """Store a history batch and advance the checkpoint in one transaction."""
        with self._conn(write=True) as c:
            chat = self._chat(c, chat_id)
            if chat is None or not chat["tracking"] or chat["generation"] != generation:
                return False
            for m in messages:
                if m.chat_id == chat_id:
                    self._upsert_message(c, m, chat)
            if chat["history_checkpoint"] is None or checkpoint > chat["history_checkpoint"]:
                c.execute(
                    "UPDATE chats SET history_checkpoint=? WHERE chat_id=?", (checkpoint, chat_id)
                )
            return True

    def history_checkpoint(self, chat_id: str) -> tuple[int | None, int] | None:
        """(checkpoint or None if uninitialized, generation) when tracked, else None."""
        row = self.get_chat(chat_id)
        if not row or not row["tracking"]:
            return None
        return row["history_checkpoint"], row["generation"]

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
                existing = c.execute(
                    "SELECT deleted FROM messages WHERE chat_id=? AND message_id=?", (cid, mid)
                ).fetchone()
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
            return self._set_handled(c, chat_id, message_id, handled)

    def set_snooze(self, chat_id: str, message_id: int, until: datetime | None) -> bool:
        with self._conn(write=True) as c:
            chat = self._chat(c, chat_id)
            cur = c.execute(
                "UPDATE messages SET snoozed_until=? "
                "WHERE chat_id=? AND message_id=? AND deleted=0",
                (_ts(until), chat_id, message_id),
            )
            if cur.rowcount and chat is not None:
                self._record(c, chat_id, message_id, "edit", chat["generation"])
            return bool(cur.rowcount)

    def set_pinned(self, chat_id: str, message_id: int, pinned: bool) -> bool:
        with self._conn(write=True) as c:
            chat = self._chat(c, chat_id)
            cur = c.execute(
                "UPDATE messages SET pinned=? WHERE chat_id=? AND message_id=? AND deleted=0",
                (int(pinned), chat_id, message_id),
            )
            if cur.rowcount and chat is not None:
                self._record(c, chat_id, message_id, "edit", chat["generation"])
            return bool(cur.rowcount)

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
                "WHERE c.tracking=1 AND m.outgoing=0 AND m.handled=0 AND m.deleted=0 "
                "AND COALESCE(m.snoozed_until,0)<=?1 AND (?2 IS NULL OR m.date>=?2) "
                "AND (?3 IS NULL OR m.date<?3) ORDER BY m.pinned DESC, m.date LIMIT ?4",
                (now_ts(), _ts(since), _ts(until), limit),
            ).fetchall()
        return [(r["chat_title"], to_dto(_row_to_message(r))) for r in rows]

    def mark_all_handled(
        self, chat_id: str, since: datetime | None = None, until: datetime | None = None
    ) -> int:
        """Mark every pending tag in a chat (within [since, until)) handled; returns how many."""
        with self._conn(write=True) as c:
            ids = [r[0] for r in c.execute(
                "SELECT message_id FROM messages WHERE chat_id=?1 AND outgoing=0 AND handled=0 "
                "AND deleted=0 AND (?2 IS NULL OR date>=?2) AND (?3 IS NULL OR date<?3)",
                (chat_id, _ts(since), _ts(until)),
            )]  # fmt: skip
            return sum(self._set_handled(c, chat_id, i, True) for i in ids)

    def _set_handled(self, c: sqlite3.Connection, chat_id: str, message_id: int, handled: bool):
        chat = self._chat(c, chat_id)
        cur = c.execute(
            "UPDATE messages SET handled=? WHERE chat_id=? AND message_id=? AND handled<>? "
            "AND deleted=0",
            (int(handled), chat_id, message_id, int(handled)),
        )
        if cur.rowcount and chat is not None:
            self._record(c, chat_id, message_id, "edit", chat["generation"])
        return bool(cur.rowcount)

    def get_message(self, chat_id: str, message_id: int) -> StoredMessage | None:
        with self._conn() as c:
            r = c.execute(
                "SELECT * FROM messages WHERE chat_id=? AND message_id=?", (chat_id, message_id)
            ).fetchone()
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
            esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            args.append(f"%{esc}%")
        if pending:
            where.append("deleted=0 AND outgoing=0 AND handled=0 AND COALESCE(snoozed_until,0)<=?")
            args.append(now_ts())
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
            f"SELECT * FROM messages WHERE {' AND '.join(where)} "
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
            epoch, head = self._epoch(c), self._rev(c)
            if parsed is None or parsed[0] != epoch or parsed[1] > head:
                return [], format_cursor(epoch, head), False, True
            rows = c.execute(
                "SELECT * FROM changes WHERE revision>? ORDER BY revision LIMIT ?",
                (parsed[1], limit + 1),
            ).fetchall()
            has_more = len(rows) > limit
            rows = rows[:limit]
            items = []
            for r in rows:
                msg = None
                if (
                    with_messages
                    and r["message_id"] is not None
                    and r["kind"] in ("new", "edit", "delete")
                ):
                    mr = c.execute(
                        "SELECT * FROM messages WHERE chat_id=? AND message_id=?",
                        (r["chat_id"], r["message_id"]),
                    ).fetchone()
                    msg = None if mr is None else to_dto(_row_to_message(mr))
                items.append(
                    ChangeItem(
                        cursor=format_cursor(epoch, r["revision"]),
                        chat_id=r["chat_id"],
                        message_id=None if r["message_id"] is None else str(r["message_id"]),
                        kind=r["kind"],
                        generation=r["generation"],
                        message=msg,
                    )
                )
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
            target = c.execute(
                "SELECT deleted FROM messages WHERE chat_id=? AND message_id=?", (chat_id, reply_to)
            ).fetchone()
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
            topic = c.execute(
                "SELECT topic_id FROM messages WHERE chat_id=? AND message_id=?",
                (r["chat_id"], r["reply_to_message_id"]),
            ).fetchone()
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
            c.execute(
                "UPDATE outbox SET status=?, message_id=?, error_code=?, retry_after=?, "
                "updated_at=?, text=CASE WHEN ?='sent' THEN '' ELSE text END, "
                "sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE request_id=?",
                (status, message_id, error_code, retry_after, now_ts(), status, status,
                 now_ts(), request_id),
            )
            if sent is not None and r is not None:
                chat = self._chat(c, sent.chat_id)
                if chat is not None and chat["tracking"]:
                    self._upsert_message(c, sent, chat)
            if status == "sent" and r is not None:  # replying from the dashboard handles the tag
                self._set_handled(c, r["chat_id"], r["reply_to_message_id"], True)
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
    @staticmethod
    def _rule_dict(r: sqlite3.Row) -> dict:
        return {"id": r["id"], "kind": r["kind"], "value": r["value"], "label": r["label"]}

    def list_rules(self) -> list[dict]:
        with self._conn() as c:
            return [self._rule_dict(r) for r in c.execute("SELECT * FROM rules WHERE kind = 'keyword' ORDER BY id")]

    def add_rule(self, kind: str, value: str, label: str = "") -> tuple[dict, int]:
        """Save a rule and clear the pending tags it already matches."""
        value = value.strip() if kind == "sender" else value.strip().lower()
        with self._conn(write=True) as c:
            c.execute(
                "INSERT INTO rules (kind,value,label) VALUES (?,?,?) "
                "ON CONFLICT(kind,value) DO UPDATE SET label=excluded.label",
                (kind, value, label),
            )
            rule = self._rule_dict(
                c.execute("SELECT * FROM rules WHERE kind=? AND value=?", (kind, value)).fetchone()
            )
            rows = c.execute(
                "SELECT * FROM messages WHERE outgoing=0 AND handled=0 AND deleted=0"
            ).fetchall()
            n = sum(
                self._set_handled(c, r["chat_id"], r["message_id"], True)
                for r in rows
                if _rule_matches([rule], _row_to_message(r))
            )
        return rule, n

    def remove_rule(self, rule_id: int) -> None:
        with self._conn(write=True) as c:
            c.execute("DELETE FROM rules WHERE id=?", (rule_id,))

    def auto_handle(self, chat_id: str, message_id: int) -> bool:
        """Mark a just-stored tag handled when a rule matches it."""
        with self._conn(write=True) as c:
            r = c.execute(
                "SELECT * FROM messages WHERE chat_id=? AND message_id=?", (chat_id, message_id)
            ).fetchone()
            if r is None or r["handled"] or r["outgoing"]:
                return False
            rules = [self._rule_dict(x) for x in c.execute("SELECT * FROM rules")]
            if not _rule_matches(rules, _row_to_message(r)):
                return False
            return self._set_handled(c, chat_id, message_id, True)

    # ---- tasks ---------------------------------------------------------
    def add_task(
        self, task_id: str, chat_id: str | None, message_id: int | None, project: str,
        prompt: str, tty: str | None = None, mode: str = "terminal", session_id: str | None = None,
    ):  # fmt: skip
        with self._conn(write=True) as c:
            c.execute(
                "INSERT INTO tasks (id, chat_id, message_id, project, created_at, prompt, tty, "
                "mode, session_id) VALUES (?,?,?,?,?,?,?,?,?)",
                (task_id, chat_id, message_id, project, now_ts(), prompt, tty, mode, session_id),
            )

    def set_task_session(self, task_id: str, session_id: str) -> None:
        with self._conn(write=True) as c:
            c.execute("UPDATE tasks SET session_id=? WHERE id=?", (session_id, task_id))

    def set_task_tty(self, task_id: str, tty: str | None) -> None:
        with self._conn(write=True) as c:
            c.execute("UPDATE tasks SET tty=? WHERE id=?", (tty, task_id))

    def list_tasks(self, chat_id: str | None = None) -> list[dict]:
        """Newest first, with a peek at the tagged message so the task list stands alone."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT t.*, c.title AS chat_title, m.sender_name, m.text AS message_text "
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
            m = c.execute(
                "SELECT * FROM messages WHERE chat_id=? AND message_id=?", (chat_id, message_id)
            ).fetchone()
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
