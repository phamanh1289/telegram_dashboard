"""Schema and the ordered migrations (PRAGMA user_version) of the SQLite store."""

import json
import sqlite3

from .common import reply_code

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
CREATE TABLE IF NOT EXISTS auto_pending (  -- Vòng BE tự chạy: answers waiting for their session's turn (autobe.py)
  task_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, chat_id, message_id)
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


def _text_fold(c: sqlite3.Connection) -> None:
    """The search's accent-less copy of `text`, kept by every write of it (_upsert_message, apply_deletion):
    `fold(text) LIKE` called Python once per stored message of the group (3.3 s at 110k messages, 90 ms on this)."""
    _add_cols(c, "messages", {"text_fold": "TEXT NOT NULL DEFAULT ''"})
    c.execute("UPDATE messages SET text_fold=fold(text) WHERE text<>''")


def _flag_indexes(c: sqlite3.Connection) -> None:
    """Pinned and snoozed tags are a handful among every stored message: without these, list_pinned and
    ticket_snoozes (read on every Inbox refresh / YouTrack round) scan the whole table."""
    if not {"pinned", "deleted", "snoozed_until"} <= {r["name"] for r in c.execute("PRAGMA table_info(messages)")}:
        return  # a database from before these columns (as _pending_indexes)
    c.execute("CREATE INDEX IF NOT EXISTS messages_pinned ON messages(date) WHERE pinned=1 AND deleted=0")
    c.execute("CREATE INDEX IF NOT EXISTS messages_snoozed ON messages(snoozed_until) WHERE snoozed_until IS NOT NULL")


def _flow_jobs(c):
    schema = """
CREATE TABLE IF NOT EXISTS flow_jobs (
 scope TEXT NOT NULL, id TEXT NOT NULL, issue TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT '', base TEXT,
 request TEXT, checkpoint TEXT, result TEXT, error TEXT, processed INTEGER NOT NULL DEFAULT 0,
 created_at REAL NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY(scope,id)
);
CREATE TABLE IF NOT EXISTS flow_job_events (
 scope TEXT NOT NULL, job TEXT NOT NULL, cursor INTEGER NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(scope,job,cursor), FOREIGN KEY(scope,job) REFERENCES flow_jobs(scope,id) ON DELETE CASCADE
);
"""
    for statement in schema.split(";"):
        if statement.strip():
            c.execute(statement)


def _docs(c):
    c.execute("""CREATE TABLE IF NOT EXISTS docs (
 id INTEGER PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL,
 hash TEXT NOT NULL, chars INTEGER NOT NULL, size INTEGER NOT NULL DEFAULT 0, updated_at INTEGER,
 fetched_at INTEGER NOT NULL, tickets TEXT NOT NULL DEFAULT '[]', summary TEXT, summary_hash TEXT,
 UNIQUE(source, ref))""")
    # heading/body: fold() text that is matched; title/text: the original heading/body shown back
    c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS doc_parts USING fts5("
              "heading, body, doc_id UNINDEXED, part UNINDEXED, line UNINDEXED, text UNINDEXED, title UNINDEXED)")


def _doc_parts_by_doc(c):
    """Parts move to a plain table keyed `doc_id << 20 | part` (a doc's parts are one id range: reading / dropping a doc
    no longer scans every part) and the match index becomes contentless (the folded copy is no longer stored)."""
    if c.execute("SELECT 1 FROM sqlite_master WHERE name='doc_fts'").fetchone():
        return  # moved already (the steps from an older version run again)
    c.execute("ALTER TABLE doc_parts RENAME TO doc_parts_old")
    c.execute("CREATE TABLE doc_parts (id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, part INTEGER NOT NULL, "
              "line INTEGER NOT NULL, heading TEXT NOT NULL, body TEXT NOT NULL)")  # original text, shown back
    # fold() text, matched only (contentless_delete: SQLite >= 3.43, CPython 3.14 bundles newer)
    c.execute("CREATE VIRTUAL TABLE doc_fts USING fts5(heading, body, content='', contentless_delete=1)")
    c.execute("INSERT INTO doc_parts SELECT (doc_id<<20)|part, doc_id, part, line, title, text FROM doc_parts_old")
    c.execute("INSERT INTO doc_fts(rowid, heading, body) SELECT (doc_id<<20)|part, heading, body FROM doc_parts_old")
    c.execute("DROP TABLE doc_parts_old")


def _doc_parent(c):
    """An article's parent article (Knowledge Base articles nest): a chosen article is the root of a branch."""
    _add_cols(c, "docs", {"parent": "TEXT"})
    c.execute("CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent)")


def _doc_revs(c):
    """What each update of a document changed (Tài liệu: hover its update date): `changes` as docs.parts.changes,
    `at` YouTrack's `updated` / the file's mtime (ms), `by` YouTrack's updatedBy."""
    c.execute("CREATE TABLE IF NOT EXISTS doc_revs (id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, "
              "at INTEGER NOT NULL, by TEXT, changes TEXT NOT NULL)")
    c.execute("CREATE INDEX IF NOT EXISTS doc_revs_doc ON doc_revs(doc_id, id)")


def _doc_ai(c):
    """Tài liệu's AI history: each Hỏi answer and each Tóm tắt the AI wrote (not a summary given back from the cache),
    by `session` (one conversation of the AI popup). `doc_hash`: docs.hash then, so an answer on a document changed
    since reads as old; `qkey`: the question folded, to give a saved answer back for the same question on the same
    version."""
    c.execute("CREATE TABLE IF NOT EXISTS doc_ai (id INTEGER PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL, "
              "doc_id INTEGER, doc_hash TEXT, doc_title TEXT NOT NULL DEFAULT '', question TEXT NOT NULL, "
              "qkey TEXT NOT NULL, text TEXT NOT NULL, cites TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL)")
    c.execute("CREATE INDEX IF NOT EXISTS doc_ai_session ON doc_ai(session, id)")
    c.execute("CREATE INDEX IF NOT EXISTS doc_ai_doc ON doc_ai(doc_id, qkey)")


MIGRATIONS = [
    _add_missing_columns, _task_kind, _task_ai, _task_done, _chat_purged, _pending_indexes, _drop_grants,
    _handled_by, _outbox_quote, _priority, _deep_anchor, _task_git_base, _task_ref_qa, _snooze_on,
    _task_ref_ask, _rule_extra, _flag_indexes, _text_fold, _flow_jobs, _docs,
    _doc_parts_by_doc, _doc_parent, _doc_revs, _doc_ai,
]  # fmt: skip
