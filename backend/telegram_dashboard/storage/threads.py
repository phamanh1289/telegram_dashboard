"""Reply-chain and Q&A lookups shared by the session and outbox queries."""

import sqlite3
from collections.abc import Iterable

from ..telegram.qa import codes as qa_codes
from .common import now_ts

CHAIN_MAX = 12  # as the web's reply-chain walk (message-item.tsx)


def _mark_qa(c: sqlite3.Connection, rows: Iterable, handled: bool) -> None:
    """Done / reopen the Q&A threads whose #QA code these (chat_id, text) rows name. Done never overwrites a removed
    thread; reopen clears only a 'done' mark."""
    for cid, text in rows:
        for code in qa_codes(text):
            if handled:
                c.execute("INSERT INTO qa_marks VALUES (?,?,'done',?) ON CONFLICT DO NOTHING", (cid, code, now_ts()))
            else:
                c.execute("DELETE FROM qa_marks WHERE chat_id=? AND code=? AND state='done'", (cid, code))


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
    def batches(keys):
        chats: dict[str, set[int]] = {}
        for cid, mid in keys:
            chats.setdefault(cid, set()).add(mid)
        for cid, ids in chats.items():
            values = list(ids)
            for offset in range(0, len(values), 500):  # stay below SQLite's legacy 999-variable limit
                chunk = values[offset:offset + 500]
                yield cid, chunk, ",".join("?" for _ in chunk)

    seen, level = set(roots), set(roots)
    for _ in range(CHAIN_MAX):
        children = {(cid, r[0]) for cid, ids, marks in batches(level)
                    for r in c.execute(f"SELECT message_id FROM messages WHERE chat_id=? AND reply_to_id IN ({marks})",
                                       (cid, *ids))}  # fmt: skip
        level = children - seen
        if not level:
            break
        seen.update(level)
    return [(cid, r[0]) for cid, ids, marks in batches(seen)
            for r in c.execute(f"SELECT message_id FROM messages WHERE chat_id=? AND message_id IN ({marks}) "
                               "AND outgoing=0 AND deleted=0", (cid, *ids))]  # fmt: skip


def _qa_text(c: sqlite3.Connection, cid: str, mid: int | None) -> tuple:
    """(chat_id, text) of the nearest stored message naming a #QA code: this one or one up its reply chain (a BE
    answer replies to the copied ask that carries the code); ("", "") when none."""
    for _ in range(CHAIN_MAX):
        r = (
            None
            if mid is None
            else c.execute(
                "SELECT text, reply_to_id FROM messages WHERE chat_id=? AND message_id=?", (cid, mid)
            ).fetchone()
        )
        if r is None:
            break
        if qa_codes(r[0]):
            return cid, r[0]
        mid = r[1]
    return "", ""
