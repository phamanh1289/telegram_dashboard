"""Auto-handle rules, AI Agent sessions, projects and Q&A marks."""

import json
import sqlite3

from ..errors import ApiError
from ..models import StoredMessage
from .common import _TASK_DONE, _dt, _row_to_message, _rule_matches, now_ts
from .threads import _code_roots, _mark_qa, _qa_text, _session_answers, _session_qa, _tags_under


class Tasks:
    # ---- auto-handle rules ---------------------------------------------
    def known_senders(self, limit: int = 500) -> list[dict]:
        """People who wrote messages saved here (tags, threads), latest first, each with their newest name: the
        "Người gửi bỏ qua" picker in Settings. Local only, no Telegram read."""
        with self._conn() as c:
            rows = c.execute(  # SQLite: a bare column next to MAX() comes from the row holding the max
                "SELECT sender_id, sender_name, MAX(date) FROM messages WHERE outgoing=0 AND sender_id IS NOT NULL "
                "AND sender_id != '' GROUP BY sender_id ORDER BY MAX(date) DESC LIMIT ?", (limit,))
            return [{"user_id": r[0], "name": r[1] or f"#{r[0]}"} for r in rows]

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
            rule = dict(c.execute("SELECT * FROM rules WHERE kind=? AND value=?", (kind, value)).fetchone())
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
            self._edited(c, r["chat_id"], r["message_id"])

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
            c.execute("DELETE FROM auto_pending WHERE task_id=?", (task_id,))
            return bool(c.execute("DELETE FROM tasks WHERE id=?", (task_id,)).rowcount)

    def chat_tasks(self, chat_id: str) -> list[str]:
        """Sessions holding that group's text: opened on one of its messages or with one attached (Xóa dữ liệu nhóm)."""
        with self._conn() as c:
            return [r[0] for r in c.execute(
                "SELECT id FROM tasks WHERE chat_id=?1 UNION SELECT task_id FROM task_refs WHERE chat_id=?1", (chat_id,)
            )]  # fmt: skip

    def auto_pending_add(self, task_id: str, refs: list[tuple[str, int]]) -> None:
        with self._conn(write=True) as c:
            c.executemany("INSERT OR IGNORE INTO auto_pending VALUES (?,?,?)", [(task_id, *r) for r in refs])

    def auto_pending_drop(self, task_id: str, refs: list[tuple[str, int]] | None = None) -> None:
        """The answers a turn took (or gave up on); `refs` None: everything waiting for that session."""
        with self._conn(write=True) as c:
            if refs is None:
                c.execute("DELETE FROM auto_pending WHERE task_id=?", (task_id,))
            else:
                c.executemany("DELETE FROM auto_pending WHERE task_id=? AND chat_id=? AND message_id=?",
                              [(task_id, *r) for r in refs])  # fmt: skip

    def auto_pending(self) -> dict[str, list[StoredMessage]]:
        """Session -> the answers still waiting for it, oldest first (read once at start). Rows whose message or
        session is gone (deleted, cleared in Cài đặt › Dữ liệu) are dropped here."""
        out: dict[str, list[StoredMessage]] = {}
        with self._conn(write=True) as c:
            c.execute(
                "DELETE FROM auto_pending WHERE task_id NOT IN (SELECT id FROM tasks) OR NOT EXISTS (SELECT 1 FROM "
                "messages m WHERE m.chat_id=auto_pending.chat_id AND m.message_id=auto_pending.message_id AND "
                "m.deleted=0)"
            )
            for r in c.execute("SELECT p.task_id, m.* FROM auto_pending p JOIN messages m USING (chat_id, message_id) "
                               "ORDER BY m.message_id"):  # fmt: skip
                out.setdefault(r["task_id"], []).append(_row_to_message(r))
        return out

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
        """ "chat_id:message_id" -> the sessions it went to, newest first: attached to a sent turn, cited by Đối chiếu
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
