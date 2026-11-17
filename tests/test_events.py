import asyncio
import contextlib
import socket
import threading
import time
import uuid

import httpx
import pytest
import uvicorn
from conftest import A, FakeTransport, msg
from telegram_dashboard.app import create_app
from telegram_dashboard.config import Settings
from telegram_dashboard.events import event_stream


async def collect(env, start, n, heartbeat=0.05, timeout=2.0):
    async def alive():
        return True

    out = []

    async def run():
        status = lambda: {"state": "connected"}  # noqa: E731
        async for ev in event_stream(
            env.store, env.hub, start, alive=alive, status=status, heartbeat=heartbeat
        ):
            if ev.event in ("change", "reset"):
                out.append(ev)
                if len(out) >= n:
                    return

    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(run(), timeout)
    return out


async def test_no_event_before_commit(env):
    env.track(A)
    start = env.store.current_cursor()
    with env.store._conn(write=True) as c:
        env.store._upsert_message(c, msg(A, 1), env.store._chat(c, A))
        assert await collect(env, start, 1, timeout=0.3) == []
    assert [e.data["message_id"] for e in await collect(env, start, 1)] == ["1"]


async def test_sse_replay_after_reconnect(env):
    env.track(A)
    env.store.apply_message(msg(A, 1))
    mid = env.store.current_cursor()
    env.store.apply_message(msg(A, 2))
    env.store.apply_message(msg(A, 3))
    evs = await collect(env, mid, 2)
    assert [e.data["message_id"] for e in evs] == ["2", "3"]
    assert evs[-1].id == env.store.current_cursor()


async def test_reset_cursor_rebuilds_snapshot(env):
    for bad in ("garbage", f"{env.store.db_epoch()}:999"):
        (ev,) = await collect(env, bad, 1)
        assert ev.event == "reset" and ev.id == env.store.current_cursor()


async def test_old_epoch_resets_even_when_revision_overlaps(env):
    env.track(A)
    env.store.apply_message(msg(A, 1))
    (ev,) = await collect(env, f"{uuid.uuid4()}:0", 1)
    assert ev.event == "reset"


async def test_heartbeat_recovers_missed_wakeup(env):
    env.track(A)
    start = env.store.current_cursor()

    async def later():
        await asyncio.sleep(0.1)
        await asyncio.to_thread(env.store.apply_message, msg(A, 1))  # no hub.notify()

    task = asyncio.create_task(later())
    evs = await collect(env, start, 1, heartbeat=0.1)
    await task
    assert [e.data["message_id"] for e in evs] == ["1"]


# ---- real server: streaming over HTTP ----------------------------------------


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(tmp_path):
    port = _free_port()
    settings = Settings(root=tmp_path, port=port, app_origin=f"http://127.0.0.1:{port}")
    app = create_app(settings, transport=FakeTransport())
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    th = threading.Thread(target=srv.run, daemon=True)
    th.start()
    while not srv.started:
        time.sleep(0.01)
    base = f"http://127.0.0.1:{port}"
    with httpx.Client(base_url=base, headers={"Origin": base}, timeout=5) as c:
        yield app, c
    srv.should_exit = True
    th.join(5)


def _read_events(resp, n):
    events, cur = [], {}
    for line in resp.iter_lines():
        if not line:
            if "event" in cur:
                events.append(cur)
                if len(events) >= n:
                    return events
            cur = {}
            continue
        key, _, val = line.partition(":")
        cur[key] = val.strip()
    return events


def test_last_event_id_precedes_query_cursor(server):
    app, c = server
    store = app.state.store
    store.set_tracking(A, True, title="A", kind="supergroup")
    first = store.current_cursor()
    store.apply_message(msg(A, 1))
    second = store.current_cursor()
    store.apply_message(msg(A, 2))
    with c.stream("GET", "/api/events", params={"cursor": first},
                  headers={"Last-Event-ID": second}) as r:  # fmt: skip
        assert r.headers["cache-control"] == "private, no-store, no-transform"
        ev = next(e for e in _read_events(r, 2) if e["event"] == "change")
    assert '"message_id":"2"' in ev["data"].replace(" ", "")


def test_disconnect_releases_subscriber(server):
    app, c = server
    hub = app.state.hub
    with c.stream("GET", "/api/events") as r:
        _read_events(r, 1)  # status event proves the stream is live
        assert hub.subscribers == 1
    deadline = time.time() + 3
    while hub.subscribers and time.time() < deadline:
        time.sleep(0.02)
    assert hub.subscribers == 0


async def test_one_wakeup_reaches_every_subscriber():
    from telegram_dashboard.events import Hub

    hub = Hub()
    a_seen = b_seen = hub.version
    a = asyncio.create_task(hub.wait(a_seen, 5))
    await asyncio.sleep(0)
    hub.notify()  # while B is still querying, not yet waiting
    await asyncio.wait_for(a, 1)
    await asyncio.wait_for(hub.wait(b_seen, 5), 1)  # B must not sleep through it
    c = asyncio.create_task(hub.wait(hub.version, 5))  # nothing new: C keeps waiting
    await asyncio.sleep(0.05)
    assert not c.done()
    hub.notify()
    await asyncio.wait_for(c, 1)
