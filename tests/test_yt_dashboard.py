import asyncio
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi import FastAPI
from telegram_dashboard.youtrack.api import build_router
from telegram_dashboard.youtrack.client import YtError
from yt_test_helpers import issue, make


async def test_issues_paginate_and_normalize():
    seen = []

    def handler(req):
        q = parse_qs(req.url.query.decode())
        skip = int(q["$skip"][0])
        seen.append((skip, "QC: me" in q["query"][0]))
        return httpx.Response(200, json=[issue(skip + i) for i in range(500)] if skip < 1000 else [])

    svc = make(handler)
    out = await svc.issues("VA", ["me"])
    assert sorted(k for k, qc in seen if not qc) == [0, 500, 1000, 1500, 2000]  # page 0, a wave
    assert any(qc for _, qc in seen)  # "me" also fetches the tickets the user tests
    assert len(out) == 1000  # QC rows already listed are not added twice
    assert (out[0]["state"], out[0]["assigneeLogin"], out[0]["sprints"]) == ("Open", "a", ["S1"])


async def test_cache_dedupes_concurrent_calls():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        return httpx.Response(200, json=[])

    svc = make(handler)
    app = FastAPI()
    app.include_router(build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        rs = await asyncio.gather(*(c.get("/api/yt/projects") for _ in range(5)))
    assert all(r.status_code == 200 for r in rs)
    assert len(calls) == 1


async def test_upstream_401_maps_to_message():
    svc = make(lambda req: httpx.Response(401, text="no"))
    try:
        await svc.yt("/api/users/me")
    except YtError as e:
        assert e.status == 401 and "Cài đặt" in e.message
    else:
        raise AssertionError("expected YtError")


async def test_qc_query_failure_other_than_400_is_not_hidden():
    def handler(req):
        if "QC: me" in parse_qs(req.url.query.decode())["query"][0]:
            return httpx.Response(401, text="no")
        return httpx.Response(200, json=[issue(1)])

    try:
        await make(handler).issues("VA", ["me"])
    except YtError as e:
        assert e.status == 401
    else:
        raise AssertionError("expected YtError")


async def test_answer_fetched_before_set_auth_is_not_cached():
    gate = asyncio.Event()

    async def slow():
        await gate.wait()
        return "old"

    svc = make(lambda req: httpx.Response(200, json=[]))
    task = asyncio.create_task(svc.cached("me", slow))
    await asyncio.sleep(0)
    svc.set_auth("http://yt2", "t2")
    gate.set()
    assert await task == "old"
    assert "me" not in svc._cache and "me" not in svc._inflight
    await svc.aclose()


async def test_transitions_keep_state_changes_across_pages():
    seen = []

    def act(n, field="State", frm="Ready for test", to="In Progress"):
        return {"timestamp": n, "target": {"idReadable": f"VA-{n}"}, "field": {"name": field},
                "removed": [{"name": frm}], "added": [{"name": to}],
                "author": {"fullName": "Q"}}  # fmt: skip

    def handler(req):
        q = parse_qs(req.url.query.decode())
        seen.append(q.get("cursor", [None])[0])
        assert "project: {VA}" in q["issueQuery"][0]
        if "cursor" not in q:
            page = {"activities": [act(1), act(2, "Priority")], "hasAfter": True, "afterCursor": "c1"}
            return httpx.Response(200, json=page)
        return httpx.Response(200, json={"activities": [act(3, to="Done")], "hasAfter": False})

    svc = make(handler)
    out = await svc.transitions("VA", 14)
    assert seen == [None, "c1"]  # the second page follows the cursor
    assert [(t["id"], t["from"], t["to"], t["by"]) for t in out] == [
        ("VA-1", "Ready for test", "In Progress", "Q"), ("VA-3", "Ready for test", "Done", "Q"),
    ]  # only State changes, oldest first  # fmt: skip
    assert svc._trans_until["VA:14"] > 0  # read to the end: not cut

    assert "VA:14" not in svc.trans_cut

    n = iter(range(100))  # a project busier than TRANS_PAGES: read newest first, so only the window's far end is cut
    busy = lambda req: httpx.Response(200, json={  # noqa: E731
        "activities": [act(100 - next(n))], "hasAfter": True, "afterCursor": f"c{next(n)}"})
    svc = make(busy)
    out = await svc.transitions("VA", 14)
    assert [t["at"] for t in out] == sorted(t["at"] for t in out)  # still handed oldest first
    assert svc.trans_cut["VA:14"] == min(t["at"] for t in out) and svc._trans_until["VA:14"] > 0  # statesince trusts it


async def test_who_lists_come_from_the_cached_whole_project():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        if req.url.path == "/api/users/me":
            return httpx.Response(200, json={"login": "a", "fullName": "A"})
        return httpx.Response(200, json=[issue(1), {**issue(2), "customFields": []}])

    svc = make(handler)
    app = FastAPI()
    app.include_router(build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert len((await c.get("/api/yt/issues", params={"project": "VA"})).json()) == 2
        mine = (await c.get("/api/yt/issues", params={"project": "VA", "who": "me"})).json()
        none = (await c.get("/api/yt/issues", params={"project": "VA", "who": "unassigned"})).json()
    assert [i["id"] for i in mine] == ["VA-1"] and [i["id"] for i in none] == ["VA-2"]
    assert calls.count("/api/issues") == 1  # one pull of the project, the rest filtered from it


async def test_statesince_reads_project_transitions_once_then_falls_back_per_ticket():
    calls = []

    def handler(req):
        path = req.url.path
        calls.append(path)
        if path == "/api/activitiesPage":
            acts = [{"timestamp": t, "target": {"idReadable": i}, "field": {"name": "State"},
                     "removed": [{"name": "Open"}], "added": [{"name": "Fixed"}], "author": {}}
                    for i, t in (("VA-1", 100), ("VA-1", 300), ("VA-2", 200))]  # fmt: skip
            return httpx.Response(200, json={"activities": acts, "hasAfter": False})
        assert path == "/api/issues/VA-3/activities"  # only the ticket the window doesn't cover
        return httpx.Response(200, json=[{"timestamp": 50, "field": {"name": "State"}}])

    svc = make(handler)
    out = await svc.since_all(["VA-1@400", "VA-2@250", "VA-3@60"])
    assert out == {"VA-1": 300, "VA-2": 200, "VA-3": 50}  # the latest change per ticket
    assert calls.count("/api/activitiesPage") == 1
    await svc.since_all(["VA-1@400", "VA-2@250"])
    assert calls.count("/api/activitiesPage") == 1  # cached: no second project read


async def test_statesince_shows_youtrack_down_instead_of_no_data():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        return httpx.Response(503 if req.url.path == "/api/activitiesPage" else 200, json=[])

    svc = make(handler)
    with pytest.raises(YtError) as e:
        await svc.since_all(["VA-1@400", "VA-2@250"])
    assert e.value.status == 502
    assert calls == ["/api/activitiesPage"]  # no per-ticket fallback against a server that is down


async def test_a_write_that_timed_out_is_unknown_and_no_cached_ticket_is_trusted():
    def slow(req):
        if req.method == "POST":
            raise httpx.ReadTimeout("slow")  # sent: YouTrack may have applied it
        return httpx.Response(200, json=issue(1))

    svc = make(slow)
    await svc.issue_detail("VA-1")
    assert svc.fresh("issue:VA-1") is not None
    try:
        await svc.comment("VA-1", "hi")
    except YtError as e:
        assert e.status == 502 and "Không rõ YouTrack đã ghi chưa" in e.message  # look before sending again
    else:
        raise AssertionError("expected YtError")
    assert svc.fresh("issue:VA-1") is None
    await svc.aclose()


async def test_admin_lists_are_paged_not_cut_at_one_page(monkeypatch):
    from telegram_dashboard.youtrack import client as yt_client

    monkeypatch.setattr(yt_client, "LIST_PAGE", 2)
    rows = [{"id": str(n), "shortName": f"P{n}", "name": f"P{n}"} for n in range(5)]

    def handler(req):
        q = parse_qs(req.url.query.decode())
        skip, top = int(q["$skip"][0]), int(q["$top"][0])
        return httpx.Response(200, json=rows[skip : skip + top])

    svc = make(handler)
    assert [p["shortName"] for p in await yt_client._projects(svc)] == ["P0", "P1", "P2", "P3", "P4"]
    await svc.aclose()


async def test_a_read_begun_before_forget_does_not_cache_the_old_ticket():
    gate, n = asyncio.Event(), iter(range(10))

    async def slow(i):
        k = next(n)
        if k == 0:
            await gate.wait()  # the older read lands last
        return {"id": i, "v": k}

    svc = make(lambda req: httpx.Response(200, json={}))
    svc.detail = slow
    old = asyncio.ensure_future(svc.issue_detail("VA-1"))
    await asyncio.sleep(0)
    svc.forget("VA-1")
    assert (await svc.issue_detail("VA-1"))["v"] == 1  # read fresh
    gate.set()
    assert (await old)["v"] == 0
    assert svc.fresh("issue:VA-1")["v"] == 1  # the older answer did not overwrite it
    await svc.aclose()
