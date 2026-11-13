from datetime import timedelta

from conftest import G1, G2, A, B, msg

from telegram_dashboard.models import GroupInfo
from telegram_dashboard.telegram import LoginRequired


def kinds(store, cursor=None):
    items, *_ = store.changes_since(cursor or f"{store.db_epoch()}:0")
    return [(i.chat_id, i.message_id, i.kind) for i in items]


def test_untracked_chat_not_persisted(env):
    env.store.upsert_chat_info(A, "a", "supergroup")
    assert env.store.apply_message(msg(A, 1)) is False
    assert env.store.get_message(A, 1) is None


def test_same_message_id_in_two_chats(env):
    env.track(A)
    env.track(B)
    env.store.apply_message(msg(A, 5, "from A"))
    env.store.apply_message(msg(B, 5, "from B"))
    assert env.store.get_message(A, 5).text == "from A"
    assert env.store.get_message(B, 5).text == "from B"


def test_replay_is_idempotent(env):
    env.track(A)
    assert env.store.apply_message(msg(A, 1)) is True
    assert env.store.apply_message(msg(A, 1)) is False
    assert kinds(env.store).count((A, "1", "new")) == 1


def test_refetch_fills_in_entities_of_same_version(env):
    from telegram_dashboard.models import LinkSpan

    env.track(A)
    env.store.apply_message(msg(A, 1, "hi there"))
    m = msg(A, 1, "hi there")
    m.links = [LinkSpan(offset=0, length=2, kind="bold")]
    assert env.store.apply_message(m) is True
    assert env.store.get_message(A, 1).links[0].kind == "bold"
    assert env.store.apply_message(m) is False  # unchanged replay stays a no-op


def test_stale_edit_does_not_overwrite_newer(env):
    env.track(A)
    env.store.apply_message(msg(A, 1, "v2", edit=200))
    env.store.apply_message(msg(A, 1, "v1", edit=100))
    env.store.apply_message(msg(A, 1, "v0"))
    assert env.store.get_message(A, 1).text == "v2"


def test_refetch_does_not_resurrect_deleted(env):
    env.track(A)
    env.store.apply_message(msg(A, 1, "secret"))
    env.store.apply_deletion(A, ["1"])
    env.store.apply_message(msg(A, 1, "secret"))
    m = env.store.get_message(A, 1)
    assert m.deleted and m.text == ""
    # deletion seen before the message itself also leaves a tombstone
    env.store.apply_deletion(A, ["3"])
    env.store.apply_message(msg(A, 3, "late"))
    assert env.store.get_message(A, 3).deleted


def test_ambiguous_delete_does_not_touch_other_chat(env):
    env.track(G1, "group")
    env.track(G2, "group")
    env.track(A)
    env.store.apply_message(msg(G1, 9))
    env.store.apply_message(msg(G2, 9))
    env.store.apply_message(msg(A, 10))
    env.store.apply_deletion(None, ["9", "10"])
    assert not env.store.get_message(G1, 9).deleted
    assert not env.store.get_message(G2, 9).deleted
    assert not env.store.get_message(A, 10).deleted  # supergroups are never matched by bare id


def test_basic_group_and_channel_ids_do_not_collide(env):
    # raw id 123 as basic group (-123) and as supergroup (-100123) are different chats
    env.track("-123", "group")
    env.track("-100123")
    env.store.apply_message(msg("-123", 4, "basic"))
    env.store.apply_message(msg("-100123", 4, "super"))
    env.store.apply_deletion(None, ["4"])  # unique among basic groups => basic one only
    assert env.store.get_message("-123", 4).deleted
    assert env.store.get_message("-100123", 4).text == "super"


async def test_migrated_group_stops_ingest(env):
    env.track(G1, "group")
    await env.bridge.on_migrated(G1, "-1009")
    assert env.store.apply_message(msg(G1, 1)) is False
    chat = env.store.get_chat(G1)
    assert chat["migrated_to"] == "-1009" and not chat["tracking"]


def test_outbox_qa_mints_one_code_for_a_tagged_ask(env):
    env.track(A)
    env.store.apply_message(msg(A, 1))
    env.store.outbox_create("r1", A, 1, "@nam_be API trả field gì?", 1, quote=False, qa=True)
    sent = env.store.outbox_claim("r1")["text"]
    assert sent.startswith("@nam_be API trả field gì?\n#QA"), sent
    env.store.outbox_create("r1", A, 1, "@nam_be API trả field gì?", 1, quote=False, qa=True)  # retry: no 409
    env.store.outbox_create("r2", A, 1, "hỏi chung", 2, quote=False, qa=True)
    assert env.store.outbox_claim("r2")["text"] == "hỏi chung"  # tags nobody: plain message
    env.store.outbox_create("r3", A, 1, "@nam_be chốt status?", 3, quote=False, qa=True, qa_role="BE")
    assert "\n#QA_BE_" in env.store.outbox_claim("r3")["text"]  # who it asks, in the code


def test_purge_clears_outbox_content_and_blocks_late_callback(env):
    env.track(A)
    env.store.apply_message(msg(A, 1))
    env.store.outbox_create("r1", A, 1, "my reply", 42)
    env.store.purge_chat(A)
    assert env.store.get_message(A, 1) is None
    assert env.store.outbox_get("r1").status == "failed"
    assert env.store.outbox_claim("r1") is None  # no content left to resend
    assert env.store.apply_message(msg(A, 1, "late")) is False  # untracked by the purge
    assert env.store.get_message(A, 1) is None


async def test_revoked_session_becomes_login_required(env):
    async def revoked():
        raise LoginRequired()

    env.fake.connect_impl = revoked
    env.bridge.state = "stopped"
    await env.bridge.start()
    await env.bridge._main
    assert env.bridge.state == "login_required"


async def test_tracking_via_api_flow(env):
    env.fake.groups = [GroupInfo(chat_id=A, title="A", kind="supergroup")]
    env.store.upsert_chat_info(A, "A", "supergroup")
    env.store.set_tracking(A, True)
    env.store.set_tracking(A, False)
    assert env.store.apply_message(msg(A, 1)) is False
    assert [k for *_, k in kinds(env.store)] == ["tracking", "untrack"]


async def _async(v):
    return v


async def test_backfill_mentions_stores_only_tagged(env):
    tagged = [
        ("Team A", "supergroup", msg(A, 5, "@me hi", sender="7"), False),
        ("Team A", "supergroup", msg(A, 6, "@me done?", sender="7"), True),
    ]
    env.fake.fetch_mentions = lambda cutoff: _async(tagged)
    await env.bridge.backfill_mentions()
    assert env.store.is_tracking(A)
    assert env.store.get_message(A, 5).text == "@me hi"
    assert not env.store.get_message(A, 5).handled and env.store.get_message(A, 6).handled
    assert env.store.list_chats()[0][0].pending_count == 1
    assert not env.store.is_tracking(B)


def test_since_filters_messages_and_chats(env):
    from datetime import UTC, datetime

    env.track(A)
    env.track(B)
    old, new = msg(A, 1, "old", sender="7"), msg(A, 2, "new", sender="7")
    old.date = datetime(2026, 10, 1, tzinfo=UTC)
    new.date = datetime(2026, 10, 29, 9, tzinfo=UTC)
    env.store.apply_message(old)
    env.store.apply_message(new)
    env.store.apply_message(msg(B, 3, "b", sender="7"))  # msg() dates are older than `since`
    since = datetime(2026, 10, 29, 8, tzinfo=UTC)
    assert [m.message_id for m in env.store.query_messages(A, since=since)[0]] == ["2"]
    assert [c.chat_id for c in env.store.list_chats(since)[0]] == [A]
    assert len(env.store.list_chats()[0]) == 2


async def test_any_reply_from_us_handles_the_tag(env):
    env.store.set_tracking(A, True, "Team", "supergroup")
    env.store.apply_message(msg(A, 10, "@me pls", sender="7"))
    mine = msg(A, 11, "on it", sender="1", outgoing=True)
    mine.reply_to_id = 10
    await env.bridge.on_my_reply(mine)
    got = env.store.get_message(A, 10)
    assert got.handled and got.handled_by == "reply" and got.handled_at is not None  # the row says why
    assert [m.message_id for m in env.store.query_messages(A, pending=True)[0]] == []
    assert env.store.set_handled(A, 10, False)  # manual undo emits a change
    assert (env.store.get_message(A, 10).handled_by, env.store.get_message(A, 10).handled_at) == ("", None)
    assert not env.store.set_handled(A, 10, False)  # no-op when unchanged
    assert [m.message_id for m in env.store.query_messages(A, pending=True)[0]] == ["10"]


def test_handled_by_says_how_a_tag_was_done(env):
    env.store.set_tracking(A, True, "Team", "supergroup")
    for i in (1, 2, 3):
        env.store.apply_message(msg(A, i, f"@me {i}", sender="7"))
    env.store.set_handled(A, 1, True, "quiet")  # Shift+Xong: no reaction
    assert env.store.mark_all_handled(A) == [2, 3]  # "Xong tất cả" leaves no reaction either
    assert [env.store.get_message(A, i).handled_by for i in (1, 2, 3)] == ["quiet", "all", "all"]
    assert not env.store.set_handled(A, 1, True, "me")  # already done: the first reason stays
    assert env.store.get_message(A, 1).handled_by == "quiet"


def test_entity_spans_keep_links_mentions_and_code():
    from types import SimpleNamespace as NS

    from telegram_dashboard.telegram import _span

    class MessageEntityCode(NS): ...

    assert _span(NS(offset=0, length=3, url="https://x.y")).kind == "link"
    assert _span(NS(offset=4, length=4, user_id=42)).url == "tg://user?id=42"
    assert _span(MessageEntityCode(offset=9, length=3)).kind == "code"
    class MessageEntityBlockquote(NS): ...

    assert _span(MessageEntityBlockquote(offset=0, length=9)).kind == "blockquote"
    assert _span(NS(offset=0, length=1)) is None  # hashtag, cashtag… render as plain text


def test_find_mentions_matches_whole_ticket_id(env):
    env.track(A)
    for mid, text in ((1, "xem VA-12 nhé"), (2, "VA-123 lỗi"), (3, "XVA-12"), (4, "va-12, done")):
        env.store.apply_message(msg(A, mid, text, sender="7"))
    assert sorted(m["message_id"] for m in env.store.find_mentions("VA-12")) == [1, 4]
    # where "Báo lại" answers: your own mention points back at the tag it replied to
    mine = msg(A, 5, "đã tạo VA-12", outgoing=True)
    mine.reply_to_id = 1
    env.store.apply_message(mine)
    found = {m["message_id"]: (m["outgoing"], m["reply_to_id"]) for m in env.store.find_mentions("VA-12")}
    assert found[5] == (1, 1)


def test_store_mentions_reports_only_new_pending_tags(env):
    env.store.add_rule("keyword", "#tb")
    tags = [("A", "supergroup", msg(A, 1, "@me hi"), False),
            ("A", "supergroup", msg(A, 2, "@me #TB"), False),  # ignore rule
            ("A", "supergroup", msg(A, 3, "@me ok?"), True)]  # fmt: skip
    assert env.store.store_mentions(tags) == [1]
    edited = msg(A, 1, "@me hi!", edit=100)
    assert env.store.store_mentions([("A", "supergroup", edited, False)]) == []  # no 2nd notify
    assert env.store.get_message(A, 1).text == "@me hi!"
    assert [env.store.get_message(A, i).handled for i in (1, 2, 3)] == [False, True, True]


def test_mark_all_handled_matches_pending_count(env):
    from datetime import UTC, datetime, timedelta

    env.track(A)
    for i in (1, 2):
        env.store.apply_message(msg(A, i))
    env.store.set_snooze(A, 2, datetime.now(UTC) + timedelta(hours=1))
    assert env.store.mark_all_handled(A) == [1]  # the snoozed tag stays hidden and open
    assert not env.store.get_message(A, 2).handled
    env.store.set_tracking(A, False)
    env.store.set_snooze(A, 2, None)
    assert env.store.mark_all_handled(A) == []  # untracked chat


def test_pruned_change_log_resets_old_cursors(env, monkeypatch):
    from telegram_dashboard import storage

    env.track(A)
    old = env.store.current_cursor()
    for i in range(1, 6):
        env.store.apply_message(msg(A, i))
    recent = env.store.current_cursor()
    monkeypatch.setattr(storage, "KEEP_CHANGES", 2)
    store = storage.Store(env.store.path)  # prunes on startup
    assert store.changes_since(old)[3] is True  # its changes are gone: reset
    assert store.changes_since(recent)[3] is False


def test_old_database_is_migrated_once(tmp_path):
    import sqlite3

    from telegram_dashboard.storage import MIGRATIONS, Store

    path = tmp_path / "old.sqlite3"
    c = sqlite3.connect(path)
    c.executescript(
        "CREATE TABLE messages (chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, "
        "text TEXT NOT NULL DEFAULT '', date INTEGER NOT NULL, PRIMARY KEY (chat_id, message_id));"
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, chat_id TEXT, message_id INTEGER, "
        "project TEXT NOT NULL, created_at INTEGER NOT NULL);"
        "INSERT INTO messages (chat_id, message_id, text, date) VALUES ('-1001', 1, 'hi', 0);"
    )
    c.close()
    Store(path)
    Store(path)  # second start: nothing left to run
    c = sqlite3.connect(path)
    assert c.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
    cols = {r[1] for r in c.execute("PRAGMA table_info(messages)")}
    assert {"handled", "links", "snoozed_until", "pinned"} <= cols
    assert c.execute("SELECT handled, links FROM messages").fetchone() == (0, "[]")


def test_database_from_the_previous_version_gets_new_columns(tmp_path):
    """A live database already ran the earlier steps: new columns need a new step, not an edit of an old one."""
    import sqlite3

    from telegram_dashboard.storage import MIGRATIONS, Store, _priority

    path = tmp_path / "prev.sqlite3"
    Store(path).set_tracking(A, True, "Team", "supergroup")
    c = sqlite3.connect(path)
    c.executescript("ALTER TABLE messages DROP COLUMN priority;")  # _priority's column
    c.execute(f"PRAGMA user_version={MIGRATIONS.index(_priority)}")
    c.close()
    store = Store(path)
    store.apply_message(msg(A, 1, "@me hi", sender="7"))
    assert store.get_message(A, 1).priority is False
    store.outbox_create("r1", A, 1, "hỏi BE", 1, quote=False)
    assert store.outbox_claim("r1", False)["reply_to"] is None  # a new message, not a reply
    store.outbox_create("r2", A, 999, "hỏi BE", 2, quote=False)  # anchor read live, never stored: still posts
    assert store.outbox_claim("r2", False)["topic_id"] is None


def test_old_deep_batch_session_gets_an_anchor(tmp_path):
    """Đối chiếu BE of several topics made before sessions always sat on a message: anchored on the newest cited one."""
    import sqlite3

    from telegram_dashboard.ai import data_json
    from telegram_dashboard.storage import MIGRATIONS, Store, _deep_anchor

    path = tmp_path / "prev.sqlite3"
    store = Store(path)
    store.set_tracking(A, True, "Team", "supergroup")
    for i, text in [(1, "BE: field là <status>"), (2, "câu khác không dẫn"), (3, "BE chốt discount 5%")]:
        store.apply_message(msg(A, i, text, sender="7"))
    prompt = "Đối chiếu\n<items>\n" + data_json([{"messages": [{"text": "BE: field là <status>"}]}]) + "\n</items>"
    store.add_task("t1", A, None, "/p", prompt, kind="deep")
    store.add_task("t2", A, None, "/p", "không dẫn tin nào", kind="deep")
    c = sqlite3.connect(path)
    c.execute(f"PRAGMA user_version={MIGRATIONS.index(_deep_anchor)}")
    c.close()
    Store(path)
    c = sqlite3.connect(path)
    assert dict(c.execute("SELECT id, message_id FROM tasks").fetchall()) == {"t1": 1, "t2": None}
    c.close()


def test_my_replies_keeps_the_newest_oldest_first(env):
    env.track(A)
    for i in range(5):
        m = msg(A, 100 + i, f"r{i}", sender="1", outgoing=True)
        env.store.apply_message(m.model_copy(update={"date": m.date + timedelta(hours=i)}))
    got = env.store.my_replies(0, limit=3)
    assert [r["text"] for r in got] == ["r2", "r3", "r4"]


def test_backfill_neither_resurrects_a_purge_nor_recloses_a_reopened_tag(env):
    from datetime import UTC, datetime, timedelta

    old = [("Team", "supergroup", msg(A, 1, "@me hi"), False)]
    env.store.store_mentions(old)
    env.store.purge_chat(A)
    assert env.store.store_mentions(old) == [] and env.store.get_message(A, 1) is None  # stays forgotten
    assert not env.store.is_tracking(A)
    new = msg(A, 2, "@me again").model_copy(update={"date": datetime.now(UTC) + timedelta(seconds=5)})
    assert env.store.store_mentions([("Team", "supergroup", new, False)]) == [2]  # a new tag brings it back
    env.store.set_handled(A, 2, False)  # reopened after a reply: a later backfill must not close it
    env.store.store_mentions([("Team", "supergroup", new, True)])
    assert not env.store.get_message(A, 2).handled


def test_clearing_old_messages_keeps_what_is_still_used_and_never_brings_them_back(env, client):
    env.track(A)
    for i in range(1, 6):
        env.store.apply_message(msg(A, i, "x" * 500))
    for i in (1, 2, 3, 4):  # 1 and 4: cleared
        env.store.set_handled(A, i, True)
    env.store.set_pinned(A, 2, True)  # pinned: kept
    env.store.add_task("t1", A, 3, "/p", "do")  # an AI session's tag: kept
    # 5 is still pending: kept
    before = 2_000_000_000
    st = env.store.data_stats(before)
    assert st["messages"]["count"] == 2 and st["messages"]["bytes"] > 1000
    assert {t["name"] for t in st["tables"]} >= {"messages", "tasks", "outbox"}
    assert [c["rows"] for c in st["chats"]] == [5]
    assert env.store.prune_messages(before) == 2
    assert env.store.get_message(A, 1) is None and env.store.get_message(A, 2) is not None
    env.store.compact()
    # an edit or a backfill of the cleared tag does not store it again as a new one
    assert env.store.apply_message(msg(A, 1, "edited", edit=5)) is False
    assert env.store.store_mentions([("A", "supergroup", msg(A, 1), False)]) == []
    assert env.store.get_message(A, 1) is None

    # the Settings › Dữ liệu endpoints (their own app and database)
    r = client.get("/api/data")
    assert r.status_code == 200 and {i["id"] for i in r.json()["items"]} >= {"messages", "media", "logs", "login"}
    o = {"Origin": "http://127.0.0.1:8765"}
    assert client.delete("/api/data/logs", headers=o).status_code == 204
    assert client.delete("/api/data/messages", headers=o).status_code == 204
    assert client.delete("/api/data/nope", headers=o).status_code == 422
