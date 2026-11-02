import asyncio
import dataclasses
from urllib.parse import parse_qs

import httpx
from fastapi import FastAPI

from telegram_dashboard.config import Settings
from telegram_dashboard.yt_dashboard import YouTrackDashboard, YtError, build_router


def issue(n, state="Open"):
    return {
        "idReadable": f"VA-{n}", "summary": f"t{n}", "created": 1, "updated": 2,
        "customFields": [
            {"name": "State", "value": {"name": state}},
            {"name": "Assignee", "value": {"login": "a", "fullName": "A"}},
            {"name": "Sprints", "value": [{"name": "S1"}]},
        ],
    }  # fmt: skip


def make(handler):
    s = dataclasses.replace(Settings.from_env(), youtrack_url="http://yt", youtrack_token="t")
    svc = YouTrackDashboard(s)
    svc._client = httpx.AsyncClient(base_url="http://yt", transport=httpx.MockTransport(handler))
    return svc


async def test_issues_paginate_and_normalize():
    seen = []

    def handler(req):
        skip = int(parse_qs(req.url.query.decode())["$skip"][0])
        seen.append(skip)
        return httpx.Response(
            200, json=[issue(skip + i) for i in range(500)] if skip < 1000 else []
        )

    svc = make(handler)
    out = await svc.issues("VA", "active", ["me"])
    assert sorted(seen) == [0, 500, 1000, 1500]  # one wave of 4 pages
    assert len(out) == 1000
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
