import asyncio
import json
import re
import types
from pathlib import Path

import httpx
from conftest import FakeAgent
from fastapi import FastAPI
from telegram_dashboard import provider_cmds, zeplin
from telegram_dashboard.youtrack import api_ai
from telegram_dashboard.youtrack.ai_prompts import AI_NO_TOOLS, AI_SYSTEM
from telegram_dashboard.youtrack.api import build_router
from telegram_dashboard.youtrack.client import YtError
from yt_test_helpers import issue, make

FLOW_RAW = """```json
{"rev": 9, "screens": [
 {"id": "login", "title": "Đăng nhập", "x": 5, "y": 6, "items": [{"id": "otp", "label": "Gửi OTP"}]},
 {"id": "code", "title": "Nhập OTP", "items": []}],
 "links": [{"src": "login.otp", "to": "code"}, {"src": "login", "to": "code"}, {"src": "x.y", "to": "ghost"}]}
```"""


async def _flow_post(
    reply, desc="Đăng nhập bằng OTP", note="Ghi chú thêm", links=(), others=None, job="", then=None
):
    """`others`: other tickets by id, a detail dict or an error status. `job`: sent as X-Ai-Job (a background run);
    `then(client, svc)`: more calls on the same app."""
    me = {"login": "anh", "fullName": "A"}

    def handler(req):
        if req.url.path == "/api/users/me":
            return httpx.Response(200, json=me)
        o = (others or {}).get(req.url.path.rsplit("/", 1)[1])
        if isinstance(o, int):
            return httpx.Response(o, json={"error": "x"})
        return httpx.Response(200, json=o or {**issue(1), "description": desc, "comments": [], "links": list(links)})

    svc = make(handler)
    agent = reply if callable(reply) else FakeAgent(reply)
    app = FastAPI()
    app.include_router(build_router(svc))
    app.state.ai = types.SimpleNamespace(configured=True, ask=agent)
    app.state.yt = svc  # link_block reads ticket links with it
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        if then:
            return await then(c, svc)
        return agent, await c.post("/api/yt/ai/flow", json={"id": "VA-1", "note": note},
                                   headers={"X-Ai-Job": job} if job else None)  # fmt: skip


def _zeplin_texts(monkeypatch, texts=("Gửi OTP",)):
    """Shots.get faked: the URLs it was asked for, each screen with `texts`."""
    asked = []

    async def get(_self, urls, **_):
        asked.extend(urls)
        return {u: {"src": "", "w": 375, "h": 812, "hits": [], "texts": list(texts)} for u in urls}, []

    monkeypatch.setattr(zeplin.Shots, "get", get)
    return asked


STORY_DESC = (  # > 8000 chars; the tree's tail and the Zeplin link past 8000
    "## AC1\n" + "Chi tiết AC. " * 800
    + '\nLuồng màn\n├─ "Gửi OTP" → Nhập OTP\nĐUÔI-STORY ([Nhập OTP](https://app.zeplin.io/project/p1/screen/s1))'
)  # fmt: skip


SUBTASK = "Làm theo AC1 đến AC4 của story [VA-2](http://yt/issue/VA-2) trên Android"


PARENT = {"direction": "INWARD", "issues": [{"idReadable": "VA-3", "summary": "story"}],
          "linkType": {"name": "Subtask", "sourceToTarget": "parent for", "targetToSource": "subtask of"}}  # fmt: skip


def story(n, desc=STORY_DESC):
    return {**issue(n), "description": desc, "comments": [], "links": []}


def _items(r):
    return [json.loads(x) for x in r.text.splitlines()]


async def test_ai_flow_returns_clean_flow_and_wraps_ticket_text():
    agent, r = await _flow_post(FLOW_RAW)
    flow = r.json()["flow"]
    assert flow["ticket"] == "VA-1" and flow["rev"] == 0 and len(flow["links"]) == 2  # broken link dropped
    assert all(s["x"] is None and s["y"] is None for s in flow["screens"])  # the AI's layout is ignored
    p = agent.calls[0]
    assert "<ticket>" in p and "Ghi chú thêm" in p.split("<ask>")[1] and "Ghi chú thêm" not in p.split("<ask>")[0]
    assert agent.kwargs["zeplin"] is None  # no Zeplin link in the ticket
    assert agent.kwargs["system"] == AI_SYSTEM and AI_NO_TOOLS in AI_SYSTEM  # unchanged: no tools on this run


async def test_ai_flow_gives_the_ai_the_zeplin_texts_not_the_mcp(monkeypatch):
    asked = _zeplin_texts(monkeypatch)
    monkeypatch.setattr(provider_cmds, "zeplin_server", lambda: {"command": "npx", "args": ["zeplin-mcp"]})
    agent, r = await _flow_post(FLOW_RAW, desc="Thiết kế https://zpl.io/abc).")
    p = agent.calls[0]
    assert r.json()["flow"] and asked == ["https://zpl.io/abc"]
    assert '<zeplin>{"https://zpl.io/abc": ["Gửi OTP"]}</zeplin>' in p and "get_screen" not in p
    assert agent.kwargs["zeplin"] is None and agent.kwargs["system"] == AI_SYSTEM  # a no-tools run, MCP or not


async def test_ai_flow_folds_a_new_screen_at_its_long_list(monkeypatch):
    async def get(_self, urls, **_):
        return {u: {"src": "", "w": 375, "h": 6936, "hits": [], "texts": [], "cut": 0.1114} for u in urls}, []

    monkeypatch.setattr(zeplin.Shots, "get", get)
    _, r = await _flow_post(FLOW_RAW, desc="Thiết kế https://zpl.io/abc).")
    screens = r.json()["flow"]["screens"]
    assert [s["fold"] for s in screens if s["zeplin"]] == [0.1114]
    assert all(not s["fold"] for s in screens if not s["zeplin"])


async def test_a_render_leaves_out_the_other_platform_itself_when_the_page_sent_no_skip(monkeypatch):
    """Render pressed while the pre-check still counts: the page has no skip yet. The server's own read decides."""
    link = "https://app.zeplin.io/project/{}/screen/{}".format
    web, app = link("a" * 24, "c" * 24), link("b" * 24, "d" * 24)

    async def get(_self, urls, **_):
        size = {web: {"w": 1280, "h": 900, "platform": "web"}, app: {"w": 375, "h": 812, "platform": "ios"}}
        return {u: {"src": "", "hits": [], "texts": [], **size[u]} for u in urls}, []

    monkeypatch.setattr(zeplin.Shots, "get", get)

    async def both(c, _svc):
        out = {}
        for target in ("mobile", "web"):
            r = await c.post("/api/yt/ai/flow", json={"id": "VA-1", "mode": "screens", "target": target})
            out[target] = [x["zeplin"] for x in r.json()["flow"]["screens"]]
        return out

    got = await _flow_post(FLOW_RAW, desc=f"[Trang chủ]({web}) [Đăng nhập]({app})", then=both)
    assert got == {"mobile": [app], "web": [web]}


async def test_ai_flow_reads_no_links_and_runs_on_the_users_heavy_picks(monkeypatch):
    async def never(*_, **__):
        raise AssertionError("the links block is not read for a UI flow")

    monkeypatch.setattr(api_ai, "link_block", never)
    agent, r = await _flow_post(
        FLOW_RAW, desc="Màn đăng nhập, xem thêm VA-9 và https://works.citics.vn/articles/VA-A-1"
    )
    assert r.json()["flow"] and agent.kwargs["heavy"] is True  # the model / effort the user picked in the box


async def test_ai_flow_on_a_story_reads_no_other_stories():
    story_text = "Luồng màn\n15 ├─ “Tìm” → 16\nXem thêm [VA-2](http://yt/issue/VA-2)"
    agent, _ = await _flow_post(FLOW_RAW, desc=story_text, links=[PARENT], others={"VA-2": story(2), "VA-3": story(3)})
    assert "</ticket>\n<zeplin>" in agent.calls[0] and "Luồng màn" in agent.calls[0]  # no <story> after the ticket


async def test_ai_flow_renders_without_zeplin_texts_when_zeplin_fails(monkeypatch):
    async def get(_self, _urls, **_):
        raise zeplin.ZeplinError("Chưa cấu hình Zeplin MCP")

    monkeypatch.setattr(zeplin.Shots, "get", get)
    agent, r = await _flow_post(FLOW_RAW, desc="Thiết kế https://zpl.io/abc")
    assert r.json()["flow"] and "<zeplin>{}</zeplin>" in agent.calls[0]
    assert r.json()["warnings"] == r.json()["manifest"]["warnings"]
    assert "Không đọc được thiết kế" in r.json()["warnings"][0]
    assert {"source": "zeplin", "kind": "unavailable_design", "count": 1} in r.json()["manifest"]["omitted"]


async def test_ai_flow_sends_the_linked_story_in_full(monkeypatch):
    asked = _zeplin_texts(monkeypatch)
    assert len(STORY_DESC) > 8000 and STORY_DESC.index("ĐUÔI-STORY") > 8000
    agent, r = await _flow_post(FLOW_RAW, desc=SUBTASK, others={"VA-2": story(2)})
    assert r.json()["flow"] and len(agent.calls) == 1  # no AI summary of the story as a link
    p = agent.calls[0]
    body = p.split("</ticket>\n<story>")[1].split("</story>")[0]
    assert "ĐUÔI-STORY" in body and "https://app.zeplin.io/project/p1/screen/s1" in body and "Luồng màn" in body
    assert "</story>" in p.split("</ticket>\n<story>")[1].split("<ask>")[0] and "Tóm tắt (AI tạo" not in p
    assert asked == ["https://app.zeplin.io/project/p1/screen/s1"]  # the story's link, read for its texts


async def test_ai_flow_reads_the_parent_known_only_as_subtask_of():
    agent, _ = await _flow_post(FLOW_RAW, links=[PARENT], others={"VA-3": story(3, "Story cha ĐUÔI-3")})
    assert "ĐUÔI-3" in agent.calls[0].split("</ticket>\n<story>")[1]


async def test_ai_flow_includes_two_stories_in_order():
    desc = "Theo [VA-2](http://yt/issue/VA-2) và [VA-3](http://yt/issue/VA-3)"
    others = {"VA-2": story(2, "STORY-HAI"), "VA-3": story(3, "STORY-BA")}
    p = (await _flow_post(FLOW_RAW, desc=desc, others=others))[0].calls[0]
    assert p.index("STORY-HAI") < p.index("STORY-BA")


async def test_ai_flow_skips_an_unreadable_story_but_not_a_401():
    others = {"VA-2": 404, "VA-3": story(3, "ĐUÔI-3")}
    agent, r = await _flow_post(FLOW_RAW, desc=SUBTASK, links=[PARENT], others=others)
    p = agent.calls[0]
    assert r.json()["flow"] and "VA-2: dashboard không đọc được ticket này" in p and "ĐUÔI-3" in p
    try:
        await _flow_post(FLOW_RAW, desc=SUBTASK, others={"VA-2": 401})
    except YtError as e:
        assert e.status == 401
    else:
        raise AssertionError("401 swallowed")


async def test_ai_flow_502_on_unreadable_answer():
    for reply in ("xin lỗi", '{"screens": []}', '{"screens": "x"}'):
        try:
            await _flow_post(reply)
        except YtError as e:
            assert e.status == 502, reply
        else:
            raise AssertionError(reply)


async def test_ai_flow_as_a_background_job_ends_with_the_cleaned_flow_read_again_by_id():
    async def then(c, svc):
        r = await c.post("/api/yt/ai/flow", json={"id": "VA-1", "note": ""}, headers={"X-Ai-Job": "flow-job-1"})
        flow = _items(r)[-1]["done"]["flow"]
        assert flow["ticket"] == "VA-1" and flow["rev"] == 0 and len(flow["links"]) == 2
        assert all(s["x"] is None and s["y"] is None for s in flow["screens"])
        again = await c.get("/api/yt/ai/job/flow-job-1")  # the dialog closed and opened again
        assert again.text == r.text and (await c.get("/api/yt/ai/jobs")).json() == {"flow-job-1": "done"}

    await _flow_post(FLOW_RAW, then=then)


async def test_ai_flow_job_streams_its_stages_and_each_screen_drawn(monkeypatch):
    _zeplin_texts(monkeypatch)

    async def agent(prompt, on_text=None, **_):
        body = FLOW_RAW.split("\n", 1)[1]
        on_text(None)  # Claude: every message starts with a reset, the first one too
        for i in range(0, len(body), 9):
            on_text(body[i : i + 9])
        return FLOW_RAW

    _, r = await _flow_post(agent, desc="Thiết kế https://zpl.io/abc", job="flow-job-4")
    every = [x["step"] for x in _items(r) if "step" in x]
    assert all(s["kind"] == "stage" and s["at"] for s in every)
    # metrics reach the page too (the dialog shows the prompt's tokens); the user-facing stages are checked below
    assert [s["phase"] for s in every if s["stage"] == "metrics"] == ["ticket", "zeplin", "prompt", "ai", "validate"]
    steps = [s for s in every if s["stage"] != "metrics"]
    stages = [s["stage"] for s in steps]
    assert stages[:2] == ["ticket", "ticket"] and steps[1]["done"] and stages[-1] == "check"
    zep = {"stage": "zeplin", "n": 1, "of": 1, "done": True, "texts": 1, "missing": 0}
    assert zep.items() <= steps[3].items()  # the fake reads no screen one by one
    assert [s["title"] for s in steps if s["stage"] == "draw"] == ["Đăng nhập", "Nhập OTP"]
    assert not any(s.get("again") for s in steps)  # the opening reset is no restart
    # next to the one designed screen (zpl.io/abc) the model's own two are not drawn (no design: left out on
    # purpose), and only the link to a screen nobody wrote ("ghost") counts as broken
    assert steps[-1] | {"at": 0} == {"kind": "stage", "at": 0, "stage": "check", "done": True, "screens": 1,
                                     "links": 0, "dropped": 1}
    assert "flow" in _items(r)[-1]["done"]


async def test_ai_flow_job_with_an_unreadable_answer_ends_with_an_error_item():
    _, r = await _flow_post("xin lỗi", job="flow-job-2")
    err = {"status": 502, "code": "ai_failed",
           "detail": "AI trả về không đọc được; thử lại hoặc chọn model / effort mạnh hơn"}
    assert _items(r)[-1] == {"error": err}


async def test_ai_flow_job_is_stopped_by_delete():
    gate = asyncio.Event()

    async def agent(prompt, **_):
        await gate.wait()
        return FLOW_RAW

    async def then(c, svc):
        post = asyncio.create_task(c.post("/api/yt/ai/flow", json={"id": "VA-1", "note": ""},
                                          headers={"X-Ai-Job": "flow-job-3"}))  # fmt: skip
        while svc.jobs.status().get("flow-job-3") != "running":
            await asyncio.sleep(0.01)
        assert (await c.delete("/api/yt/ai/job/flow-job-3")).status_code == 204
        assert _items(await post)[-1]["error"]["code"] == "ai_cancelled"
        assert svc.jobs.status() == {"flow-job-3": "error"}

    await _flow_post(agent, then=then)


async def test_ai_flow_asks_the_ai_to_place_a_button_zeplin_has_no_layer_for(monkeypatch):  # VA-12584 screen 44
    url = "https://app.zeplin.io/project/" + "a" * 24 + "/screen/" + "b" * 24

    async def get(_self, urls, **_):
        shot = {"title": "Đăng nhập", "src": "https://img.zeplin.io/a.png", "w": 375, "h": 812, "hits": [], "texts": []}
        return {u: shot for u in urls}, []

    async def image(_src):
        return b"png", "image/png"

    monkeypatch.setattr(zeplin.Shots, "get", get)
    monkeypatch.setattr(zeplin, "image", image)
    calls = []

    async def agent(prompt, *a, read_dir=None, **k):
        calls.append((prompt, read_dir))
        if read_dir is None:
            return json.dumps({"screens": [{"id": "login", "title": "Đăng nhập", "zeplin": url,
                                            "items": [{"id": "otp", "label": "Gửi OTP"}]}], "links": []})
        assert (Path(read_dir) / "screen-1.png").read_bytes() == b"png" and '"label": "Gửi OTP"' in prompt
        return json.dumps({"screen-1.png": {i: [100, 500, 800, 60] for i in re.findall(r'"id": "([^"]+)"', prompt)}})

    _, r = await _flow_post(agent, desc=f"Đăng nhập bằng OTP [Đăng nhập]({url})")
    items = [i for s in r.json()["flow"]["screens"] for i in s["items"]]
    assert len(calls) == 2 and [i["rect"] for i in items] == [{"x": 0.1, "y": 0.5, "w": 0.8, "h": 0.06}]
    assert not any("vẽ vùng bấm" in w for w in r.json()["warnings"])

    async def lost(prompt, *a, read_dir=None, **k):
        return await agent(prompt) if read_dir is None else "không thấy"

    _, r = await _flow_post(lost, desc=f"Đăng nhập bằng OTP [Đăng nhập]({url})")
    assert r.json()["flow"]["screens"] and any("1 nút không có layer" in w for w in r.json()["warnings"])
