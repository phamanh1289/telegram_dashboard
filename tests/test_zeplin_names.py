"""Zeplin screens by name (Tài liệu's Zeplin links): pages read, names matched loosely, read once, errors as codes."""

import httpx
import pytest
from telegram_dashboard import zeplin, zeplin_names
from telegram_dashboard.zeplin_names import ScreenNames
from test_docs_api import _origin  # noqa: F401 (the autouse fixture)

IMG = "https://img.zeplin.io/s.png"


def screen(i: int, name: str, src: str = IMG) -> dict:
    return {"id": f"s{i}", "name": name, "image": {"width": 375, "height": 812, "thumbnails": {"large": src}}}


def fake(monkeypatch, handler):
    calls: list[str] = []
    original = httpx.AsyncClient

    def client(**kw):
        def handle(req):
            calls.append(f"{req.url.path}?{req.url.query.decode()}")
            return handler(req)

        return original(base_url=kw["base_url"], transport=httpx.MockTransport(handle))

    monkeypatch.setattr(zeplin_names.httpx, "AsyncClient", client)
    monkeypatch.setattr(zeplin, "token", lambda: "tok")
    return calls


def web_and_mobile(req):
    path, offset = req.url.path, int(req.url.params.get("offset", 0))
    if path.endswith("/projects"):
        return httpx.Response(200, json=[{"id": "p1", "name": "Bán Web", "platform": "web"},
                                         {"id": "p2", "name": "Bán Mobile", "platform": "ios"},
                                         {"id": "p3", "name": "Cũ", "status": "deleted"}])  # fmt: skip
    if path.endswith("/p1/screens"):  # two pages: 100 fillers, then the ones sought
        rows = [screen(i, f"Khác {i}") for i in range(100)] if offset == 0 else [
            screen(200, "Banv2-CNY 23 A1"), screen(201, "Banv2-CNY 23 A10"), screen(202, "Banv2-CNY 23", "https://evil.test/x.png")]
        return httpx.Response(200, json=rows)
    return httpx.Response(200, json=[screen(300, "banv2 – cny 23 a1")])  # p2: same name, other spelling


async def test_find_reads_every_page_matches_loosely_same_name_first(monkeypatch):
    calls = fake(monkeypatch, web_and_mobile)
    names = ScreenNames()
    got = await names.find("Banv2-CNY 23 A1")
    assert [(r["project_name"], r["name"]) for r in got] == [
        ("Bán Web", "Banv2-CNY 23 A1"), ("Bán Mobile", "banv2 – cny 23 a1"), ("Bán Web", "Banv2-CNY 23 A10")]
    assert not any("p3" in c for c in calls)  # a deleted project is not read
    n = len(calls)
    assert [r["name"] for r in await names.find("cny 23")][0] == "Banv2-CNY 23"  # read once: from memory
    assert len(calls) == n
    assert next(r for r in await names.find("Banv2-CNY 23") if r["id"] == "s202")["image"] == ""  # not a Zeplin host


async def test_errors_come_back_as_codes(monkeypatch):
    fake(monkeypatch, lambda req: httpx.Response(401))
    with pytest.raises(zeplin.ZeplinError, match="token_refused"):
        await ScreenNames().find("x")
    monkeypatch.setattr(zeplin, "token", lambda: "")
    with pytest.raises(zeplin.ZeplinError, match="no_token"):
        await ScreenNames().find("x")


def test_route_says_why_and_links_the_screen(client, monkeypatch):
    async def found(name):
        return [{**zeplin_names._row({"id": "p1", "name": "Bán Web", "platform": "web"}, screen(1, name))}]

    monkeypatch.setattr(zeplin_names.NAMES, "find", found)
    got = client.get("/api/docs/zeplin", params={"name": "Banv2-00"}).json()
    assert got[0]["url"] == "https://app.zeplin.io/project/p1/screen/s1" and got[0]["image"] == IMG

    async def no_token(name):
        raise zeplin.ZeplinError("no_token")

    monkeypatch.setattr(zeplin_names.NAMES, "find", no_token)
    r = client.get("/api/docs/zeplin", params={"name": "x"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "doc_zeplin_no_token"
