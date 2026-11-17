"""SQLite store. Sync methods; callers run them off the event loop via `Db`.

`Store` is assembled here from one class per domain (messages, outbox, tasks, data, flow jobs); schema and
migrations live in `schema.py`."""

import asyncio
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

from .common import _dt, fold, format_cursor, now_ts, parse_cursor
from .data import Data
from .flow import FlowJobs
from .messages import Messages
from .outbox import Outbox
from .schema import MIGRATIONS, SCHEMA
from .tasks import Tasks
from .threads import CHAIN_MAX

__all__ = ["CHAIN_MAX", "MIGRATIONS", "Db", "Store", "_dt", "parse_cursor"]

KEEP_CHANGES = 50_000  # change-log rows kept on startup; older cursors get a reset


class Store(Messages, Outbox, Tasks, Data, FlowJobs):
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
        # WAL: NORMAL syncs at checkpoints, not on every commit (4x faster commits here, far more on slow disks).
        # An app crash loses nothing; a power cut may drop the last commits, never corrupt (a send caught
        # mid-way comes back as "unknown", as outbox_recover already does).
        conn.execute("PRAGMA synchronous=NORMAL")
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
            c.execute("PRAGMA journal_size_limit=8388608")  # a WAL grown by a burst shrinks back at the next checkpoint
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
        return c.execute("SELECT * FROM messages WHERE chat_id=? AND message_id=?", (chat_id, message_id)).fetchone()

    def _cursor(self, c: sqlite3.Connection) -> str:
        return format_cursor(self._epoch(c), self._rev(c))

    @staticmethod
    def _record(c: sqlite3.Connection, chat_id: str, message_id: int | None, kind: str, generation: int) -> None:
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
        if cur.rowcount:
            self._edited(c, chat_id, message_id)
        return bool(cur.rowcount)

    def _edited(self, c: sqlite3.Connection, chat_id: str, message_id: int) -> None:
        """Emit an edit change for a kept message (of a chat still known)."""
        if (chat := self._chat(c, chat_id)) is not None:
            self._record(c, chat_id, message_id, "edit", chat["generation"])

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
        if cur.rowcount:
            self._edited(c, chat_id, message_id)
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
