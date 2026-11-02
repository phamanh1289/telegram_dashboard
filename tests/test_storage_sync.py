import asyncio

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


def test_old_history_does_not_resurrect_deleted(env):
    env.track(A)
    env.store.apply_message(msg(A, 1, "secret"))
    env.store.apply_deletion(A, ["1"])
    gen = env.store.history_checkpoint(A)[1]
    env.store.apply_history_batch(A, gen, [msg(A, 1, "secret"), msg(A, 2, "secret2")], 2)
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


async def test_history_live_overlap(env):
    env.track(A)
    env.fake.history[A] = [msg(A, i) for i in range(1, 61)]
    await env.bridge.on_message(msg(A, 60))  # live arrives before initial load
    await env.bridge.sync_chat(A)
    items, _, _ = env.store.query_messages(A, limit=100)
    assert [int(m.message_id) for m in items] == list(range(11, 61))  # 50 newest, no dupes
    assert env.store.history_checkpoint(A)[0] == 60


async def test_recovery_more_than_one_page(env):
    env.track(A)
    await env.bridge.sync_chat(A)  # empty chat initialises checkpoint 0
    env.fake.history[A] = [msg(A, i) for i in range(1, 251)]
    await env.bridge.sync_chat(A)
    items, _, _ = env.store.query_messages(A, after=0, limit=100)
    assert len(items) == 100
    assert env.store.get_message(A, 250) is not None
    assert env.store.history_checkpoint(A)[0] == 250


async def test_live_event_does_not_skip_history_gap(env):
    env.track(A)
    await env.bridge.sync_chat(A)
    await env.bridge.on_message(msg(A, 200))
    assert env.store.history_checkpoint(A)[0] == 0
    env.fake.history[A] = [msg(A, i) for i in (150, 200)]
    await env.bridge.sync_chat(A)
    assert env.store.get_message(A, 150) is not None


async def test_failed_batch_does_not_advance_checkpoint(env):
    env.track(A)
    await env.bridge.sync_chat(A)
    env.fake.history[A] = [msg(A, i) for i in range(1, 11)]
    env.fake.fail_fetch_after = 1
    env.bridge.schedule_sync(A)
    await asyncio.sleep(0)
    assert env.store.history_checkpoint(A)[0] == 0
    await env.settle()
    assert env.store.history_checkpoint(A)[0] == 10
    assert env.bridge.sync_state.get(A) is None


def test_purge_clears_outbox_content_and_blocks_late_callback(env):
    env.track(A)
    env.store.apply_message(msg(A, 1))
    gen = env.store.history_checkpoint(A)[1]
    env.store.outbox_create("r1", A, 1, "my reply", 42)
    env.store.purge_chat(A)
    assert env.store.get_message(A, 1) is None
    assert env.store.outbox_get("r1").status == "failed"
    assert env.store.outbox_claim("r1") is None  # no content left to resend
    env.store.set_tracking(A, True)
    assert env.store.apply_history_batch(A, gen, [msg(A, 1, "late")], 1) is False
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
    env.store.track_mention(A, "Team", "supergroup")
    env.store.apply_message(msg(A, 10, "@me pls", sender="7"))
    mine = msg(A, 11, "on it", sender="1", outgoing=True)
    mine.reply_to_id = 10
    await env.bridge.on_my_reply(mine)
    assert env.store.get_message(A, 10).handled
    assert [m.message_id for m in env.store.query_messages(A, pending=True)[0]] == []
    assert env.store.set_handled(A, 10, False)  # manual undo emits a change
    assert not env.store.set_handled(A, 10, False)  # no-op when unchanged
    assert [m.message_id for m in env.store.query_messages(A, pending=True)[0]] == ["10"]


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
