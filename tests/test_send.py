import asyncio
import uuid

import pytest
from conftest import A, B, msg
from pydantic import ValidationError

from telegram_dashboard.errors import ApiError
from telegram_dashboard.models import ReplyRequest, SentMessage
from telegram_dashboard.telegram import SendRejected


def req(chat=A, reply="5", text="ok", rid=None, retry=False):
    return ReplyRequest(request_id=rid or uuid.uuid4(), chat_id=chat, reply_to_message_id=reply,
                        text=text, retry_unknown=retry)  # fmt: skip


@pytest.fixture
def ready(env):
    env.track(A)
    env.track(B)
    env.store.apply_message(msg(A, 5))
    return env


async def test_reply_to_other_chat_rejected(ready):
    with pytest.raises(ApiError) as e:
        await ready.bridge.submit_reply(req(chat=B))
    assert e.value.code == "reply_not_found"
    assert ready.fake.send_calls == []


async def test_concurrent_same_uuid_one_rpc(ready):
    async def slow(call):
        await asyncio.sleep(0.05)
        return SentMessage(message_id=99)

    ready.fake.send_impl = slow
    r = req()
    a, b = await asyncio.gather(ready.bridge.submit_reply(r), ready.bridge.submit_reply(r))
    assert len(ready.fake.send_calls) == 1
    assert {a.status, b.status} == {"sent", "sending"}
    assert (await ready.bridge.submit_reply(r)).status == "sent"
    assert len(ready.fake.send_calls) == 1


async def test_same_uuid_changed_payload_conflicts(ready):
    rid = uuid.uuid4()
    await ready.bridge.submit_reply(req(rid=rid))
    with pytest.raises(ApiError) as e:
        await ready.bridge.submit_reply(req(rid=rid, text="different"))
    assert e.value.status == 409


async def test_timeout_retry_reuses_random_id(ready):
    async def timeout(call):
        raise TimeoutError

    ready.fake.send_impl = timeout
    rid = uuid.uuid4()
    assert (await ready.bridge.submit_reply(req(rid=rid))).status == "unknown"
    # same request without explicit retry: no new RPC
    assert (await ready.bridge.submit_reply(req(rid=rid))).status == "unknown"
    assert len(ready.fake.send_calls) == 1
    ready.fake.send_impl = None
    assert (await ready.bridge.submit_reply(req(rid=rid, retry=True))).status == "sent"
    first, second = ready.fake.send_calls
    assert first["random_id"] == second["random_id"]


def test_restart_marks_inflight_unknown(ready):
    ready.store.outbox_create("r1", A, 5, "x", 1)
    assert ready.store.outbox_claim("r1") is not None
    ready.store.outbox_recover()
    assert ready.store.outbox_get("r1").status == "unknown"


def test_restart_marks_unclaimed_pending_failed(ready):
    ready.store.outbox_create("r2", A, 5, "x", 1)
    ready.store.outbox_recover()
    assert ready.store.outbox_get("r2").status == "failed"
    assert ready.store.outbox_claim("r2")["random_id"] == 1  # user retry keeps random_id


async def test_random_id_duplicate_without_mapping_stays_unknown(ready):
    async def dup(call):
        raise RuntimeError("RANDOM_ID_DUPLICATE")

    ready.fake.send_impl = dup
    rec = await ready.bridge.submit_reply(req())
    assert rec.status == "unknown" and rec.message_id is None


async def test_flood_wait_does_not_auto_send(ready):
    async def flood(call):
        raise SendRejected("retry_after", 1)

    ready.fake.send_impl = flood
    rec = await ready.bridge.submit_reply(req())
    assert rec.status == "failed" and rec.retry_after == 1
    await asyncio.sleep(1.2)
    assert len(ready.fake.send_calls) == 1


def test_telethon_client_never_sleeps_or_retries(tmp_path):
    from telegram_dashboard.config import Settings
    from telegram_dashboard.telegram import TelethonTransport

    settings = Settings(root=tmp_path, telegram_api_id=1, telegram_api_hash="x")
    settings.ensure_data_dir()
    t = TelethonTransport(settings)
    assert t.client.flood_sleep_threshold == 0
    assert t.client._request_retries == 0


async def test_outgoing_event_and_response_deduplicate(ready):
    async def echo(call):
        sent = msg(A, 77, call["text"], outgoing=True)
        await ready.bridge.on_message(sent)  # update arrives before the RPC returns
        return SentMessage(message_id=77, message=sent)

    ready.fake.send_impl = echo
    await ready.bridge.submit_reply(req(text="hello"))
    items, *_ = ready.store.changes_since(f"{ready.store.db_epoch()}:0")
    assert [i.kind for i in items if i.message_id == "77"] == ["new"]


def test_utf16_limit_with_emoji():
    req(text="😀" * 2048)  # 4096 UTF-16 units
    with pytest.raises(ValidationError):
        req(text="😀" * 2049)
    with pytest.raises(ValidationError):
        req(text="")


async def test_topic_reply_preserves_target(ready):
    ready.store.apply_message(msg(A, 6, topic=77))
    await ready.bridge.submit_reply(req(reply="6"))
    call = ready.fake.send_calls[0]
    assert (call["chat_id"], call["reply_to"], call["topic_id"]) == (A, 6, 77)


def test_change_feed_contains_edits_and_deletions(ready):
    start = ready.store.current_cursor()
    ready.store.apply_message(msg(A, 5, "edited", edit=100))
    ready.store.apply_deletion(A, ["5"])
    items, nxt, has_more, reset = ready.store.changes_since(start)
    assert [(i.kind, i.message_id) for i in items] == [("edit", "5"), ("delete", "5")]
    assert items[-1].message.deleted and items[-1].message.text == ""
    assert nxt == items[-1].cursor and not has_more and not reset
