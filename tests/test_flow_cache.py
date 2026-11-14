import asyncio
from types import SimpleNamespace

import httpx
import pytest
from telegram_dashboard import zeplin
from telegram_dashboard.youtrack import flow as uiflow
from telegram_dashboard.youtrack.service import YouTrackDashboard

URL = "https://app.zeplin.io/project/" + "a" * 24 + "/screen/" + "b" * 24


@pytest.fixture
def shots(monkeypatch):
    monkeypatch.setattr(zeplin, "token", lambda: "one")
    monkeypatch.setattr(zeplin.provider_cmds, "zeplin_server", lambda: {"name": "zeplin"})
    return zeplin.Shots()


async def test_shared_reads_dedup_and_cancel_isolation(shots, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    reads = 0

    async def read(client, url):
        nonlocal reads
        reads += 1
        started.set()
        await release.wait()
        return {"src": url}

    monkeypatch.setattr(shots, "_read", read)
    callers = [asyncio.create_task(shots.get([URL + ("?x=1" if n % 2 else "")])) for n in range(10)]
    await started.wait()
    callers[0].cancel()
    with pytest.raises(asyncio.CancelledError):
        await callers[0]
    release.set()
    result = await asyncio.gather(*callers[1:])
    assert reads == 1 and all(r[0] for r in result)
    await shots.aclose()


async def test_global_read_limit_across_batches(shots, monkeypatch):
    active = peak = 0

    async def read(client, url):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return {"src": url}

    monkeypatch.setattr(shots, "_read", read)
    await asyncio.gather(*(shots.get([URL[:-24] + f"{n:024x}"]) for n in range(12)))
    assert peak == 4
    await shots.aclose()


async def test_auth_drift_cannot_seed_old_cache(shots, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    reads = 0

    async def read(client, url):
        nonlocal reads
        reads += 1
        if reads == 1:
            started.set()
            await release.wait()
        return {"src": client.headers["Authorization"]}

    monkeypatch.setattr(shots, "_read", read)
    old = asyncio.create_task(shots.get([URL]))
    await started.wait()
    monkeypatch.setattr(zeplin, "token", lambda: "two")
    assert (await shots.get([URL]))[0][URL]["src"] == "Bearer two"
    release.set()
    await old
    assert (await shots.get([URL]))[0][URL]["src"] == "Bearer two"
    assert reads == 2
    await shots.aclose()


async def test_close_cancels_orphaned_reads(shots, monkeypatch):
    started, stopped = asyncio.Event(), asyncio.Event()

    async def read(client, url):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(shots, "_read", read)
    caller = asyncio.create_task(shots.get([URL]))
    await started.wait()
    caller.cancel()
    await asyncio.gather(caller, return_exceptions=True)
    await shots.aclose()
    assert stopped.is_set() and not shots._inflight


async def test_attachment_cache_checks_metadata_and_auth(tmp_path, monkeypatch):
    svc = YouTrackDashboard(SimpleNamespace(data_dir=tmp_path, youtrack_url="https://yt.test", youtrack_token="a"))
    att = {"id": "1", "name": uiflow.NAME.format(issue="VA-1"), "created": 1, "size": 123, "url": "/a"}
    metadata_reads = html_reads = 0

    async def yt(*args, **kw):
        nonlocal metadata_reads
        metadata_reads += 1
        return {"attachments": [dict(att)]}

    async def content(a):
        nonlocal html_reads
        html_reads += 1
        return b"html"

    flow = uiflow.clean({"screens": [{"id": "a", "title": "A", "items": []}], "links": []}, "VA-1")
    monkeypatch.setattr(svc, "yt", yt)
    monkeypatch.setattr(svc, "_bytes", content)
    monkeypatch.setattr(uiflow, "extract", lambda s: flow)
    await svc.flow_file("VA-1")
    result = await svc.flow_file("VA-1")
    assert metadata_reads == 2 and html_reads == 1
    result[1].rev = 99
    assert (await svc.flow_file("VA-1"))[1].rev != 99
    att["id"] = "2"
    await svc.flow_file("VA-1")
    assert html_reads == 2
    att["url"] = "/changed"
    await svc.flow_file("VA-1")
    assert html_reads == 3
    svc.set_auth("https://yt.test", "b")
    await svc.flow_file("VA-1")
    assert html_reads == 4
    svc.seed_flow("VA-1", "2", 123, flow, auth=svc._flow_auth)
    svc._flow_cache.clear()
    svc.stale("VA-1")
    await svc.flow_file("VA-1")
    assert html_reads == 4
    await svc.aclose()


class ImageStream(httpx.AsyncByteStream):
    def __init__(self, *, block=False):
        self.chunks = 0
        self.closed = False
        self.block = block
        self.started = asyncio.Event()

    async def __aiter__(self):
        for _ in range(20):
            self.chunks += 1
            self.started.set()
            if self.block:
                await asyncio.Event().wait()
            yield b"x" * (64 << 10)

    async def aclose(self):
        self.closed = True


@pytest.mark.parametrize("length", [None, "1"])
async def test_image_stream_cap_and_cleanup(monkeypatch, length):
    stream = ImageStream()
    clients = []
    original = httpx.AsyncClient

    def make_client(**kw):
        headers = {"content-type": "image/png"}
        if length:
            headers["content-length"] = length
        client = original(
            transport=httpx.MockTransport(lambda req: httpx.Response(200, headers=headers, stream=stream))
        )
        clients.append(client)
        return client

    monkeypatch.setattr(zeplin.httpx, "AsyncClient", make_client)
    monkeypatch.setattr(zeplin, "MAX_IMAGE", 128 << 10)
    with pytest.raises(zeplin.ZeplinError, match="quá lớn"):
        await zeplin.image("https://img.zeplin.io/a")
    assert stream.chunks == 3 and stream.closed and clients[0].is_closed


async def test_image_cancel_closes_stream_and_client(monkeypatch):
    stream = ImageStream(block=True)
    original = httpx.AsyncClient
    client = original(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(200, headers={"content-type": "image/png"}, stream=stream)
        )
    )
    monkeypatch.setattr(zeplin.httpx, "AsyncClient", lambda **kw: client)
    task = asyncio.create_task(zeplin.image("https://img.zeplin.io/a"))
    await stream.started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert stream.closed and client.is_closed


async def test_cache_ttl_bound_scope_and_config(shots, monkeypatch):
    reads = 0
    clock = 100.0
    account = "first"
    config = {"name": "first"}

    async def read(client, url):
        nonlocal reads
        reads += 1
        return {"src": url}

    monkeypatch.setattr(shots, "_read", read)
    monkeypatch.setattr(shots, "_scope", lambda: account)
    monkeypatch.setattr(zeplin.provider_cmds, "zeplin_server", lambda: config)
    monkeypatch.setattr(zeplin.time, "monotonic", lambda: clock)
    await shots.get([URL])
    await shots.get([URL])
    assert reads == 1
    account = "second"
    await shots.get([URL])
    assert reads == 2
    config = {"name": "second"}
    await shots.get([URL])
    assert reads == 3
    clock += zeplin.TTL + 1
    await shots.get([URL])
    assert reads == 4
    await shots.get([URL[:-24] + f"{n:024x}" for n in range(513)])
    assert len(shots._cache) == 512
    await shots.aclose()


async def test_image_redirect_cannot_read_another_host(monkeypatch):
    original = httpx.AsyncClient
    requested = []

    def handle(request):
        requested.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://evil.test/image.png"})

    client = original(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(zeplin.httpx, "AsyncClient", lambda **kw: client)
    with pytest.raises(zeplin.ZeplinError, match="Không phải ảnh"):
        await zeplin.image("https://img.zeplin.io/a")
    assert requested == ["https://img.zeplin.io/a"] and client.is_closed


async def test_save_route_seeds_next_fresh_get_without_html(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from telegram_dashboard.youtrack.api import build_router

    svc = YouTrackDashboard(SimpleNamespace(data_dir=tmp_path, youtrack_url="https://yt.test", youtrack_token="a"))
    attachments = []
    metadata_reads = 0

    async def yt(*args, **kw):
        nonlocal metadata_reads
        metadata_reads += 1
        return {"attachments": attachments}

    async def upload(issue, name, body, **kw):
        attachments.append({"id": "new", "name": name, "size": len(body), "created": 1, "url": "/new"})
        return "new", name

    async def comment(*args):
        pass

    async def content(a):
        pytest.fail("Save seed must avoid reading uploaded HTML")

    monkeypatch.setattr(svc, "yt", yt)
    monkeypatch.setattr(svc, "upload", upload)
    monkeypatch.setattr(svc, "comment", comment)
    monkeypatch.setattr(svc, "_bytes", content)
    (tmp_path / "uiflow.js").write_text("/* test */")
    app = FastAPI()
    app.include_router(build_router(svc))
    app.state.settings = SimpleNamespace(static_dir=tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        saved = await client.post(
            "/api/yt/flow",
            json={
                "id": "VA-1",
                "flow": {"screens": [{"id": "a", "title": "A", "items": []}], "links": []},
            },
        )
        assert saved.status_code == 200, saved.text
        opened = await client.get("/api/yt/flow", params={"issue": "VA-1"})
        assert opened.status_code == 200 and opened.json()["att"] == "new"
        assert opened.json()["flow"]["rev"] == 1
    assert metadata_reads == 2  # conflict check and fresh open both inspect current attachments
    await svc.aclose()
