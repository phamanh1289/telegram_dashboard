"""Digests, "Tuần của tôi" stats and local data upkeep (Settings › Dữ liệu)."""

import math
import sqlite3
import statistics
from datetime import UTC, datetime

from .common import _OLD_MSG, _ROW_BYTES, _ts, now_ts


class Data:
    def week_stats(self, now: datetime | None = None) -> dict:
        """ "Tuần của tôi": tags received in the last 7 days and the 7 before, how they got handled and how fast
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
                    "SELECT COALESCE(s.tbl_name, d.name), SUM(d.pgsize) FROM dbstat('main', 1) d "
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
