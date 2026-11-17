"""Chats, kept messages (tags, snoozes, pins, Báo lại) and the change feed."""

import itertools
import json
import logging
import re
import sqlite3
from collections.abc import Sequence
from datetime import datetime

from ..errors import ApiError
from ..models import ChangeItem, ChatDTO, MessageDTO, StoredMessage, to_dto
from .common import (
    PENDING,
    _dt,
    _is_basic_group,
    _like,
    _row_to_message,
    _rule_matches,
    _ts,
    fold,
    format_cursor,
    now_ts,
    parse_cursor,
)

log = logging.getLogger("telegram_dashboard.storage")

# Tags snoozed until a reply that a message answering ?2 wakes: ?2 itself, or the tag my reply ?2 answered.
_REPLY_SNOOZED = (
    "SELECT message_id FROM messages WHERE chat_id=?1 AND snooze_on='reply' AND (message_id=?2 OR "
    "message_id=(SELECT reply_to_id FROM messages WHERE chat_id=?1 AND message_id=?2 AND outgoing=1))"
)


class Messages:
    # ---- chats ---------------------------------------------------------
    def upsert_chat_info(self, chat_id: str, title: str, kind: str) -> None:
        with self._conn(write=True) as c:
            c.execute(
                "INSERT INTO chats (chat_id,title,kind) VALUES (?,?,?) "
                "ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title, kind=excluded.kind",
                (chat_id, title, kind),
            )

    def set_tracking(self, chat_id: str, enabled: bool, title: str | None = None, kind: str | None = None) -> int:
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
            c.execute("INSERT INTO chats (chat_id,title,kind) VALUES (?,?,?)", (chat_id, title, kind))
            row = self._chat(c, chat_id)
        if enabled:
            if row["migrated_to"]:
                raise ApiError(409, "chat_migrated")
            if not row["tracking"]:
                c.execute(
                    "UPDATE chats SET tracking=1, tracked_at=?, title=COALESCE(?,title) WHERE chat_id=?",
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
            c.execute("DELETE FROM auto_pending WHERE chat_id=?", (chat_id,))
            c.execute("DELETE FROM messages WHERE chat_id=?", (chat_id,))
            self._record(c, chat_id, None, "purge", gen)

    def get_chat(self, chat_id: str) -> dict | None:
        with self._conn() as c:
            r = self._chat(c, chat_id)
            return None if r is None else dict(r)

    def is_tracking(self, chat_id: str) -> bool:
        row = self.get_chat(chat_id)
        return bool(row and row["tracking"])

    def list_chats(self, since: datetime | None = None, until: datetime | None = None) -> tuple[list[ChatDTO], str]:
        """With a range, only chats that have a kept message in [since, until). Groups with a tag waiting first, the
        one waiting longest on top (what needs you first), then by title."""
        # INDEXED BY: with no ANALYZE statistics the planner takes messages_chat_date and walks every message of
        # each group (125 ms at 190k messages; 0.6 ms on the partial index). The index is made by _pending_indexes.
        mine = (f"FROM messages m INDEXED BY messages_pending WHERE m.chat_id=chats.chat_id AND {PENDING} "
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
                "topic_id,outgoing,media_kind,links,text_fold,chat_id,message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (*values, fold(m.text), m.chat_id, m.message_id),
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
            "topic_id=?,outgoing=?,media_kind=?,links=?,text_fold=? WHERE chat_id=? AND message_id=?",
            (*values, fold(m.text), m.chat_id, m.message_id),
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
                        "INSERT INTO messages (chat_id,message_id,text,date,deleted) VALUES (?,?,'',0,1)",
                        (cid, mid),
                    )
                else:
                    c.execute(
                        "UPDATE messages SET text='', text_fold='', sender_name=NULL, sender_id=NULL, "
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
            if cur.rowcount:
                self._edited(c, chat_id, message_id)
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
            self._wake(c, chat_id, mid)

    def wake_ticket(self, ticket: str) -> int:
        """Wake every tag snoozed until `ticket` is done. Returns how many woke."""
        with self._conn(write=True) as c:
            rows = c.execute("SELECT chat_id, message_id FROM messages WHERE snooze_on=?",
                             (f"ticket:{ticket}",)).fetchall()  # fmt: skip
            for chat_id, mid in rows:
                self._wake(c, chat_id, mid)
            return len(rows)

    def _wake(self, c: sqlite3.Connection, chat_id: str, message_id: int) -> None:
        c.execute("UPDATE messages SET snooze_on=NULL WHERE chat_id=? AND message_id=?", (chat_id, message_id))
        self._set_col(c, chat_id, message_id, "snoozed_until", None)

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
            return [
                r[0][7:]
                for r in c.execute(
                    "SELECT DISTINCT snooze_on FROM messages "
                    "WHERE snooze_on LIKE 'ticket:%' AND snoozed_until>unixepoch()"
                )
            ]

    def remind(
        self, chat_id: str, message_id: int, until: datetime | None, *, restore: str | None = None
    ) -> str | None:
        """ "Nhắc lại sau": reopen a kept tag and hide it until `until` (None: back now), in one write, so it comes
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
                f"SELECT * FROM messages WHERE chat_id=? AND message_id IN ({q}) ORDER BY message_id",
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
            where.append("deleted=0 AND text_fold LIKE ? ESCAPE '\\'")  # native scan: no Python call per row
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
        sql = f"SELECT * FROM messages m WHERE {' AND '.join(where)} ORDER BY message_id {order} LIMIT ?"
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
