import asyncio
import json

from telegram_dashboard.flow_jobs import FlowJobs
from telegram_dashboard.storage import Store
from telegram_dashboard.uiflow import clean

FLOW = clean({"screens": [{"id": "a", "title": "A", "items": []}], "links": []}, "VA-1").model_dump()


async def items(response):
    return [json.loads(line) async for line in response.body_iterator if line.strip()]


async def test_result_persists_restart_scope_cursor_and_processed_retention(tmp_path):
    store = Store(tmp_path / "test.db")
    jobs = FlowJobs(store)

    async def work(on_text):
        on_text({"kind": "stage", "stage": "check"})
        await jobs.update("account-a", "job-0001", checkpoint=FLOW)
        return {"flow": FLOW}

    result = await items(await jobs.start("account-a", "job-0001", "VA-1", "file-1", work))
    assert result[-1]["done"]["flow"] == FLOW
    restarted = Store(store.path)
    restarted.flow_jobs_recover()
    kept = restarted.flow_job_get("account-a", "job-0001")
    assert kept["status"] == "succeeded" and kept["base"] == "file-1"
    assert restarted.flow_job_get("account-b", "job-0001") is None
    assert restarted.flow_job_events("account-a", "job-0001", result[0]["cursor"]) == result[1:]
    with restarted._conn(write=True) as c:
        c.execute("UPDATE flow_jobs SET updated_at=0")
    restarted.flow_jobs_recover()
    assert restarted.flow_job_get("account-a", "job-0001")  # unresolved never expires
    restarted.flow_job_update("account-a", "job-0001", processed=True)
    with restarted._conn(write=True) as c:
        c.execute("UPDATE flow_jobs SET updated_at=0")
    restarted.flow_jobs_recover()
    assert restarted.flow_job_get("account-a", "job-0001") is None


async def test_restart_safe_checkpoint_recovery_never_calls_ai(tmp_path):
    original = Store(tmp_path / "test.db")
    for job in ("complete", "partial", "cancelled", "invalid"):
        original.flow_job_create("scope", job, "VA-1")
        original.flow_job_update("scope", job, status="running")
    original.flow_job_update("scope", "complete", checkpoint=FLOW)
    original.flow_job_update("scope", "invalid", checkpoint={"bad": True})
    original.flow_job_update("scope", "cancelled", status="cancel_requested", checkpoint=FLOW)
    restarted = Store(original.path)
    restarted.flow_jobs_recover()
    assert restarted.flow_job_get("scope", "complete")["result"] == {"flow": FLOW}
    assert restarted.flow_job_get("scope", "partial")["needs_ai_retry"]
    assert restarted.flow_job_get("scope", "invalid")["status"] == "interrupted"
    assert restarted.flow_job_get("scope", "cancelled")["status"] == "cancelled"
    replay = await items(FlowJobs(restarted).stream("scope", "complete"))
    assert replay[-1]["done"] == {"flow": FLOW}


async def test_cancel_before_start_and_running_is_idempotent(tmp_path):
    jobs = FlowJobs(Store(tmp_path / "test.db"))
    invoked = []

    async def work(on_text):
        invoked.append(True)
        await asyncio.Event().wait()

    assert (await jobs.cancel("scope", "job-0001"))["status"] == "cancelled"
    assert (await jobs.cancel("scope", "job-0001"))["status"] == "cancelled"
    response = await jobs.start("scope", "job-0001", "VA-1", None, work)
    assert (await items(response))[-1]["error"]["code"] == "ai_cancelled"
    assert not invoked
    response = await jobs.start("scope", "job-0002", "VA-1", None, work)
    await asyncio.sleep(0.02)
    assert (await jobs.cancel("scope", "job-0002"))["status"] == "cancelled"
    assert (await items(response))[-1]["error"]["code"] == "ai_cancelled"
    await jobs.close()


async def test_storage_event_failure_stops_producer_and_reports_error(tmp_path, monkeypatch):
    jobs = FlowJobs(Store(tmp_path / "test.db"))
    stopped = asyncio.Event()

    def broken(*args):
        raise OSError("disk full")

    monkeypatch.setattr(jobs.store, "flow_job_event", broken)

    async def work(on_text):
        try:
            on_text({"stage": "ticket"})
            await asyncio.Event().wait()
        finally:
            stopped.set()

    response = await jobs.start("scope", "job-0001", "VA-1", None, work)
    result = await asyncio.wait_for(items(response), 1)
    assert result[-1]["error"]["code"] == "flow_storage_failed"
    assert stopped.is_set()
    assert (await jobs.get("scope", "job-0001"))["status"] == "failed"
    await asyncio.sleep(0)
    assert not jobs.tasks


async def test_flow_context_disables_automatic_provider_retry(tmp_path, monkeypatch):
    import pytest

    from telegram_dashboard.ai import AiService, no_retry
    from telegram_dashboard.config import Settings
    from telegram_dashboard.errors import ApiError

    service = AiService(Settings(root=tmp_path, ai_agent_command="cat", ai_model="", ai_effort=""), None, None)
    attempts = []

    async def overloaded(*args):
        attempts.append(True)
        raise ApiError(502, "ai_provider_error", detail="529 Overloaded")

    monkeypatch.setattr(service, "_run", overloaded)
    token = no_retry.set(True)
    try:
        with pytest.raises(ApiError):
            await service.ask("hi")
    finally:
        no_retry.reset(token)
    assert len(attempts) == 1


async def test_http_flow_job_checkpoint_cursor_and_scope_restart(tmp_path, monkeypatch):
    import httpx
    from fastapi import FastAPI

    from telegram_dashboard import yt_dashboard as yt
    from telegram_dashboard.config import Settings

    async def ai(*args, **kwargs):
        return json.dumps(FLOW)

    async def detail(*args):
        return {"id": "VA-1", "description": "ticket data", "summary": "Ticket", "comments": [], "links": []}

    monkeypatch.setattr(yt.YouTrackDashboard, "detail", detail)
    monkeypatch.setattr(yt, "_ai", ai)
    settings = Settings(root=tmp_path, youtrack_url="http://yt", youtrack_token="secret")
    store = Store(tmp_path / "test.db")
    svc = yt.YouTrackDashboard(settings)
    await svc.start_flow_jobs(store)
    app = FastAPI()
    app.include_router(yt.build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/yt/ai/flow", json={"id": "VA-1", "base": "file-1", "note": "keep this"},
                                     headers={"X-Ai-Job": "job-http-1"})
        assert response.status_code == 200
        events = [json.loads(line) for line in response.text.splitlines() if line]
        assert events[-1]["done"]["flow"] == FLOW
        status = (await client.get("/api/yt/flow/jobs/job-http-1")).json()
        assert status["status"] == "succeeded" and status["request"] == {"note": "keep this", "deep": False}
        assert status["base"] == "file-1"
        cursor = events[0]["cursor"]
        replay = await client.get(f"/api/yt/flow/jobs/job-http-1/events?after={cursor}")
        assert [json.loads(line) for line in replay.text.splitlines() if line] == events[1:]
        await svc.aclose()
        svc = yt.YouTrackDashboard(settings)
        await svc.start_flow_jobs(Store(store.path))
        assert (await svc.flow_jobs.get(svc.flow_scope(), "job-http-1"))["result"]["flow"] == FLOW
        original_scope = svc.flow_scope()
        svc.token = "different-account"
        assert svc.flow_scope() != original_scope
        assert await svc.flow_jobs.get(svc.flow_scope(), "job-http-1") is None
        await svc.aclose()


async def test_cancel_waits_for_registration_and_never_resurrects_work(tmp_path, monkeypatch):
    jobs = FlowJobs(Store(tmp_path / "test.db"))
    created, release = asyncio.Event(), asyncio.Event()
    original = jobs.call
    invoked = []

    async def paused(method, *args, **kwargs):
        result = await original(method, *args, **kwargs)
        if method == "flow_job_create" and not created.is_set():
            created.set()
            await release.wait()
        return result

    monkeypatch.setattr(jobs, "call", paused)

    async def work(on_text):
        invoked.append(True)
        await asyncio.Event().wait()

    starting = asyncio.create_task(jobs.start("scope", "job-0001", "VA-1", None, work))
    await created.wait()
    stopping = asyncio.create_task(jobs.cancel("scope", "job-0001"))
    await asyncio.sleep(0)
    assert not stopping.done()
    release.set()
    response = await starting
    assert (await stopping)["status"] == "cancelled"
    assert not invoked
    assert (await items(response))[-1]["error"]["code"] == "ai_cancelled"


async def test_simultaneous_same_ticket_starts_keep_only_latest_active(tmp_path):
    jobs = FlowJobs(Store(tmp_path / "test.db"))

    async def work(on_text):
        await asyncio.Event().wait()

    await asyncio.gather(jobs.start("scope", "job-first", "VA-1", None, work),
                         jobs.start("scope", "job-second", "VA-1", None, work))
    assert (await jobs.get("scope", "job-first"))["status"] == "cancelled"
    assert (await jobs.get("scope", "job-second"))["status"] in {"queued", "running"}
    await jobs.cancel("scope", "job-second")


async def test_terminal_event_and_metadata_commit_together_before_cancel(tmp_path):
    jobs = FlowJobs(Store(tmp_path / "test.db"))

    async def work(on_text):
        return {"flow": FLOW}

    response = await jobs.start("scope", "job-0001", "VA-1", None, work)
    result = await items(response)
    assert result[-1]["done"] == {"flow": FLOW}
    cancelled = await jobs.cancel("scope", "job-0001")
    assert cancelled["status"] == "succeeded" and cancelled["result"] == {"flow": FLOW}
    assert cancelled["cursor"] == result[-1]["cursor"]
    # A delayed callback cannot append successful output to an already cancelled job.
    await jobs.cancel("scope", "job-0002")
    assert await jobs.call("flow_job_event", "scope", "job-0002", {"done": {"flow": FLOW}}) is None
    assert (await jobs.get("scope", "job-0002"))["status"] == "cancelled"


def test_old_processed_active_job_is_recovered_not_pruned(tmp_path):
    store = Store(tmp_path / "test.db")
    store.flow_job_create("scope", "job-0001", "VA-1")
    store.flow_job_update("scope", "job-0001", status="running", processed=True)
    with store._conn(write=True) as c:
        c.execute("UPDATE flow_jobs SET updated_at=0")
    store.flow_jobs_recover()
    assert store.flow_job_get("scope", "job-0001")["status"] == "interrupted"


async def test_http_flow_render_keeps_the_notes_of_the_flow_on_screen(tmp_path, monkeypatch):
    import httpx
    from fastapi import FastAPI

    from telegram_dashboard import yt_dashboard as yt
    from telegram_dashboard.config import Settings

    async def ai(*args, **kwargs):
        return json.dumps(FLOW)

    async def detail(*args):
        return {"id": "VA-1", "description": "ticket data", "summary": "Ticket", "comments": [], "links": []}

    monkeypatch.setattr(yt.YouTrackDashboard, "detail", detail)
    monkeypatch.setattr(yt, "_ai", ai)
    svc = yt.YouTrackDashboard(Settings(root=tmp_path, youtrack_url="http://yt", youtrack_token="secret"))
    app = FastAPI()
    app.include_router(yt.build_router(svc))
    keep = {**FLOW, "start": "a", "screens": [{**FLOW["screens"][0], "note": "giữ lại"}]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/yt/ai/flow", json={"id": "VA-1", "base": "file-1", "keep": keep})
    body = r.json()
    assert body["flow"]["screens"][0]["note"] == "giữ lại" and body["flow"]["start"] == "a"
    assert body["manifest"]["kept"]["notes"] == 1
    await svc.aclose()
