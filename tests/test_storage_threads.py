import sqlite3

from telegram_dashboard.storage.threads import CHAIN_MAX, _tags_under


def database(rows):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE messages(chat_id TEXT, message_id INTEGER, reply_to_id INTEGER, "
                 "outgoing INTEGER, deleted INTEGER, PRIMARY KEY(chat_id,message_id))")
    conn.executemany("INSERT INTO messages VALUES(?,?,?,?,?)", rows)
    return conn


def test_reply_tree_batches_wide_frontiers():
    rows = [("a", 1, None, 0, 0)]
    rows += [("a", i, 1 if i <= 21 else 2 + (i - 22) // 20, 0, 0) for i in range(2, 422)]
    with database(rows) as conn:
        queries = []
        conn.set_trace_callback(queries.append)
        assert set(_tags_under(conn, {("a", 1)})) == {("a", i) for i in range(1, 422)}
        assert len(queries) == 4  # three depth frontiers and one tag filter, formerly 842


def test_reply_tree_preserves_depth_cycles_chat_scope_and_hidden_ancestors():
    rows = [("a", i, i - 1, int(i == 2), int(i == 3)) for i in range(1, CHAIN_MAX + 3)]
    rows += [("b", 1, 2, 0, 0), ("b", 2, 1, 0, 0), ("other", 2, 1, 0, 0)]
    with database(rows) as conn:
        found = set(_tags_under(conn, {("a", 1), ("b", 1), ("missing", 1)}))
        assert found == {("a", i) for i in range(1, CHAIN_MAX + 2) if i not in (2, 3)} | {
            ("b", 1), ("b", 2),
        }
        assert _tags_under(conn, set()) == []


def test_reply_tree_chunks_frontiers_above_sqlite_variable_limit():
    rows = [("a", 1, None, 0, 0)] + [("a", i, 1, 0, 0) for i in range(2, 1203)]
    with database(rows) as conn:
        conn.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
        assert len(_tags_under(conn, {("a", 1)})) == len(rows)
