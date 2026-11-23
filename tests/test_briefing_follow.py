import json
import types
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI
from telegram_dashboard.models import StoredMessage
from telegram_dashboard.telegram import follow


async def test_follow_changes_merge_on_the_server_and_are_capped(tmp_path, monkeypatch):
    settings = types.SimpleNamespace(data_dir=tmp_path, ensure_data_dir=lambda: None)
    monkeypatch.setattr(follow, "STORIED_MAX", 2)
    monkeypatch.setattr(follow, "WAITS_MAX", 2)
    app = FastAPI()
    app.include_router(follow.build_router(settings, None))
    wait = {"key": "a", "chat_id": "-1", "on": "bu", "text": "Hoàn tiền?", "who": "Tùng (BU)", "at": 5}
    storied = {f"k{i}": {"id": "VA-1", "at": i} for i in range(3)}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        post = lambda **body: c.post("/api/briefing/follow", json=body)  # noqa: E731
        assert (await c.get("/api/briefing/follow")).json() == {"waits": [], "storied": {}}  # no file yet
        r = await post(add=[wait], storied=storied)
        assert list(r.json()["storied"]) == ["k1", "k2"]  # the oldest mark dropped
        await post(add=[{**wait, "key": "b", "at": 6}])  # another tab: merged, the first wait stays
        got = (await c.get("/api/briefing/follow")).json()
        assert [w["key"] for w in got["waits"]] == ["a", "b"] and got["waits"][0]["tickets"] == []
        assert got["waits"][0]["state"] == "" and got["waits"][0]["who"] == "Tùng (BU)"  # who "Nhắc" tags
        assert list(got["storied"]) == ["k1", "k2"]
        r = await post(add=[{**wait, "on": "fix", "state": "Open", "at": 7}])  # the same key: replaced, not doubled
        assert [(w["key"], w["on"]) for w in r.json()["waits"]] == [("b", "bu"), ("a", "fix")]
        r = await post(add=[{**wait, "key": "c", "at": 8}])
        assert [w["key"] for w in r.json()["waits"]] == ["a", "c"]  # past WAITS_MAX: the oldest dropped
        assert [w["key"] for w in (await post(drop=["a", "gone"])).json()["waits"]] == ["c"]
        assert (await post(add=[{**wait, "on": "x"}])).status_code == 422
        own = {**wait, "key": "d", "on": "other", "label": "Chờ khách hàng", "at": 9}  # a reason of one's own
        r = await post(add=[own])
        assert r.json()["waits"][-1]["label"] == "Chờ khách hàng"


async def test_an_unreadable_item_is_left_out_and_the_old_file_kept(tmp_path):
    settings = types.SimpleNamespace(data_dir=tmp_path, ensure_data_dir=lambda: None)
    app = FastAPI()
    app.include_router(follow.build_router(settings, None))
    good = {"key": "a", "chat_id": "-1", "on": "bu", "text": "x", "at": 5}
    old = json.dumps({"waits": [good, {**good, "key": "b", "on": "newer"}], "storied": {"k": {"id": "VA-1"}}})
    (tmp_path / "briefing_follow.json").write_text(old)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        got = (await c.get("/api/briefing/follow")).json()
        assert [w["key"] for w in got["waits"]] == ["a"] and got["storied"] == {}  # the rest stays readable
        await c.post("/api/briefing/follow", json={"drop": []})
    assert (tmp_path / "briefing_follow.bad.json").read_text() == old  # what the write dropped is not lost
    (tmp_path / "briefing_follow.json").write_text('{"waits": "bad"}')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/briefing/follow")).json() == {"waits": [], "storied": {}}


async def test_done_ticks_merge_on_the_server(tmp_path, monkeypatch):
    settings = types.SimpleNamespace(data_dir=tmp_path, ensure_data_dir=lambda: None)
    monkeypatch.setattr(follow, "DONE_MAX", 3)
    app = FastAPI()
    app.include_router(follow.build_router(settings, None))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/briefing/done")).json() == []
        await c.post("/api/briefing/done", json={"keys": ["a", "b"], "on": True})
        await c.post("/api/briefing/done", json={"keys": ["c"], "on": True})  # another tab: merged, not replaced
        assert (await c.post("/api/briefing/done", json={"keys": ["a"], "on": False})).json() == ["b", "c"]
        assert (await c.post("/api/briefing/done", json={"keys": ["d", "e"], "on": True})).json() == ["c", "d", "e"]
        assert (await c.get("/api/briefing/done")).json() == ["c", "d", "e"]


async def test_wait_replies_are_others_answers_after_the_wait():
    def m(mid, reply_to, at, outgoing=False):
        return StoredMessage(chat_id="-1", message_id=mid, sender_name="BE", text=f"m{mid}", reply_to_id=reply_to,
                             date=datetime.fromtimestamp(at, UTC), outgoing=outgoing)

    class Reads:
        async def qa(self, bridge, chat_id, days):
            if chat_id == "-2":
                raise RuntimeError("gone")
            return [m(11, 7, 50), m(12, 7, 200), m(13, 7, 300, outgoing=True), m(14, 8, 300)]

    app = FastAPI()
    app.include_router(follow.build_router(types.SimpleNamespace(), Reads()))
    app.state.bridge = types.SimpleNamespace(state="connected")
    body = {"items": [{"key": "k", "chat_id": "-1", "message_ids": ["7"], "at": 100_000},
                      {"key": "x", "chat_id": "-2", "message_ids": ["1"], "at": 0}]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = (await c.post("/api/briefing/follow/replies", json=body)).json()
    assert [x["message_id"] for x in r["replies"]["k"]] == ["12"]  # before the wait, mine and other threads left out
    assert r["failed"] == ["-2"]  # said, not shown as "no reply"
    app.state.bridge.state = "connecting"  # Telegram not connected: every group is unread, not "no reply"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = (await c.post("/api/briefing/follow/replies", json=body)).json()
    assert r == {"replies": {}, "failed": ["-1", "-2"]}
