import json
import types
from urllib.parse import parse_qs

import httpx
from conftest import FakeAgent
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from telegram_dashboard.youtrack.api import build_router
from telegram_dashboard.youtrack.client import YtError
from telegram_dashboard.youtrack.schemas import DEV_FLOW, Workflow
from yt_test_helpers import issue, make


async def test_set_field_sends_known_values_and_state_machine_events(tmp_path):
    cmds = []
    bundle = lambda n, vs: {"field": {"name": n}, "bundle": {"values": [{"name": v} for v in vs]}}  # noqa: E731
    events = [{"id": "pass test", "presentation": "DONE ON DEV"}]

    def handler(req):
        if req.url.path == "/api/admin/projects/VA/customFields":
            vals = [bundle("State", ["QC", "DONE ON DEV"]), bundle("Priority", ["High"])]
            return httpx.Response(200, json=vals)
        if req.method == "POST":
            cmds.append(json.loads(req.content)["query"])
            return httpx.Response(200, json={"id": "c"})
        if "possibleEvents" in req.url.query.decode():
            sf = {"name": "State", "value": {"name": "QC"}, "possibleEvents": events}
            return httpx.Response(200, json={"customFields": [sf]})
        return httpx.Response(200, json=issue(1, "DONE ON DEV"))

    svc = make(handler)
    svc.workflow_path = tmp_path / "yt_workflow.json"
    svc.save_workflow("VA", "dev", Workflow(edges=[("QC", "DONE ON DEV")]))  # the team's arrow out of QC
    app = FastAPI()
    app.add_exception_handler(YtError, lambda _, e: JSONResponse({}, status_code=e.status))
    app.include_router(build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:

        def post(name, value):
            return c.post("/api/yt/issue/field", json={"id": "VA-1", "name": name, "value": value})

        assert (await post("Priority", "High")).status_code == 200
        assert (await post("State", "DONE ON DEV")).json()["state"] == "DONE ON DEV"
        assert cmds == ["Priority High", "State pass test"]  # no {braces}: YouTrack rejects them
        assert (await post("State", "QC")).status_code == 400  # no event leads there
        assert (await post("Priority", "High Assignee me")).status_code == 400  # not a value
        assert len(cmds) == 2


async def test_team_workflow_blocks_moves_without_an_arrow_and_reads_youtrack_flow(tmp_path):
    cmds = []
    vals = [{"name": v} for v in ("Open", "Dev", "QC")]
    bundle = {"field": {"name": "State"}, "bundle": {"values": vals}}
    nxt = {"Open": ["Dev", "QC"], "Dev": ["QC"]}  # nobody is in QC yet

    def handler(req):
        q = parse_qs(req.url.query.decode())
        if req.url.path == "/api/admin/projects/VA/customFields":
            return httpx.Response(200, json=[bundle])
        if req.method == "POST":
            cmds.append(json.loads(req.content)["query"])
            return httpx.Response(200, json={"id": "c"})
        if req.url.path == "/api/issues":  # one ticket per state, for the YouTrack flow
            st = q["query"][0].split("State: {")[1].rstrip("}")
            evs = [{"presentation": t} for t in nxt.get(st, [])]
            hit = [{"customFields": [{"name": "State", "possibleEvents": evs}]}]
            return httpx.Response(200, json=hit if st in nxt else [])
        if "possibleEvents" in q.get("fields", [""])[0]:
            sf = {"name": "State", "value": {"name": "Open"}, "possibleEvents": None}
            return httpx.Response(200, json={"customFields": [sf]})
        return httpx.Response(200, json=issue(1))

    svc = make(handler)
    svc.workflow_path = tmp_path / "yt_workflow.json"
    app = FastAPI()
    app.add_exception_handler(YtError, lambda _, e: JSONResponse({}, status_code=e.status))
    app.include_router(build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        flow = (await c.get("/api/yt/workflow/youtrack?project=VA")).json()
        assert sorted(map(tuple, flow["edges"])) == [("Dev", "QC"), ("Open", "Dev"), ("Open", "QC")]
        assert flow["unknown"] == ["QC"]
        wf = {"pos": {"Open": [0, 0]}, "edges": [["Open", "Dev"]]}
        assert (await c.post("/api/yt/workflow?project=VA", json=wf)).status_code == 200
        got = (await c.get("/api/yt/workflow?project=VA")).json()
        assert (got["states"], got["edges"]) == (["Open", "Dev", "QC"], [["Open", "Dev"]])

        def post(v):
            return c.post("/api/yt/issue/field", json={"id": "VA-1", "name": "State", "value": v})

        assert (await post("QC")).status_code == 400  # no arrow Open → QC
        qa = {"X-Yt-Role": "qa"}  # each role keeps its own flow: QA has none, so no State change at all
        assert (await c.get("/api/yt/workflow?project=VA", headers=qa)).json()["edges"] == []
        body = {"id": "VA-1", "name": "State", "value": "QC"}
        assert (await c.post("/api/yt/issue/field", json=body, headers=qa)).status_code == 400
        assert (await post("Dev")).status_code == 200
        assert cmds == ["State Dev"]


def test_workflow_of_the_first_version_goes_to_every_role(tmp_path):
    svc = make(lambda req: httpx.Response(200, json=[]))
    svc.workflow_path = tmp_path / "yt_workflow.json"
    svc.workflow_path.write_text(json.dumps({"VA": {"on": True, "edges": [["A", "B"]]}}))  # an old file: `on` ignored
    assert svc.workflow("VA", "qa", []).edges == [("A", "B")]
    svc.save_workflow("VA", "po", Workflow())
    assert svc.workflow("VA", "dev", []).edges and not svc.workflow("VA", "po", []).edges


def test_dev_starts_with_the_built_in_flow_when_the_project_has_its_states(tmp_path):
    svc = make(lambda req: httpx.Response(200, json=[]))
    svc.workflow_path = tmp_path / "yt_workflow.json"
    states = [*DEV_FLOW["pos"], "QC - QA"]
    dev = svc.workflow("VA", "dev", states)
    assert len(dev.edges) == 9 and dev.hidden == ["QC - QA"]
    assert svc.workflow("VA", "qa", states) == Workflow()  # QA / PO start empty
    assert svc.workflow("X", "dev", ["Open", "Done"]) == Workflow()  # other states: no default
    svc.save_workflow("VA", "dev", Workflow())
    assert svc.workflow("VA", "dev", states) == Workflow()  # a saved flow wins


async def test_team_instructions_follow_the_role_header_but_not_the_filter(tmp_path):
    svc = make(lambda req: httpx.Response(200, json={"login": None, "fullName": None}))
    svc.notes_path = tmp_path / "yt_ai.json"
    agent = FakeAgent('{"q": ""}')
    app = FastAPI()
    app.include_router(build_router(svc))
    app.state.ai = types.SimpleNamespace(configured=True, ask=agent)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/yt/instructions")).json() == {"dev": "", "qa": "", "po": ""}
        await c.post("/api/yt/instructions", json={"qa": "Test case dạng bảng Given/When/Then"})
        weekly = {"kind": "weekly", "data": {}}
        await c.post("/api/yt/ai/data", json=weekly, headers={"X-Yt-Role": "qa"})
        assert '<team_instructions role="qa">\nTest case dạng bảng' in agent.calls[0]
        await c.post("/api/yt/ai/data", json=weekly, headers={"X-Yt-Role": "dev"})  # dev: empty
        await c.post("/api/yt/ai/data", json=weekly)  # no role: none
        await c.post("/api/yt/ai/filter", json={"text": "x", "options": {}}, headers={"X-Yt-Role": "qa"})
        assert not any("team_instructions" in p for p in agent.calls[1:])
        r = await c.post("/api/yt/instructions", json={"qa": "x" * 4001})
        assert r.status_code == 422


async def test_saved_prompts_round_trip(tmp_path):
    svc = make(lambda req: httpx.Response(200, json={}))
    svc.prompts_path = tmp_path / "yt_prompts.json"
    app = FastAPI()
    app.include_router(build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/yt/prompts")).json() == {"prompts": [], "shown": {}, "hidden": []}
        body = {
            "prompts": [{"name": "Rủi ro", "text": "Liệt kê rủi ro release"}],
            "shown": {"qa:one": ["Rủi ro"]},
            "hidden": ["Test case"],  # a deleted built-in
        }
        assert (await c.post("/api/yt/prompts", json=body)).json() == body
        assert (await c.get("/api/yt/prompts")).json() == body
        bad = {"prompts": [{"name": "", "text": "x"}]}
        assert (await c.post("/api/yt/prompts", json=bad)).status_code == 422
        six = {"prompts": [], "shown": {"dev:one": list("abcdef")}}  # at most 5 buttons
        assert (await c.post("/api/yt/prompts", json=six)).status_code == 422
        assert (await c.post("/api/yt/prompts", json={"shown": {"x": []}})).status_code == 422
    svc.prompts_path.write_text('{"prompts": [{"name": "a", "text": "b"}], "shown": ["a"]}')
    old = svc.prompts().model_dump()
    assert old == {"prompts": [{"name": "a", "text": "b"}], "shown": {}, "hidden": []}


async def test_assignee_endpoint_also_sets_qc():
    sent = []

    def handler(req):
        sent.append(json.loads(req.content)["customFields"][0])
        return httpx.Response(200, json=issue(1))

    app = FastAPI()
    app.add_exception_handler(YtError, lambda _, e: JSONResponse({}, status_code=e.status))
    app.include_router(build_router(make(handler)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.post("/api/yt/issue/qc", json={"id": "VA-1", "login": "q"})).status_code == 200
        assert (await c.post("/api/yt/issue/assignee", json={"id": "VA-1", "login": None})).status_code == 200
        assert (await c.post("/api/yt/issue/qc", json={"id": "VA-1", "login": "{x}"})).status_code == 400
    assert [(f["name"], f["value"]) for f in sent] == [("QC", {"login": "q"}), ("Assignee", None)]


async def test_a_ticket_with_no_state_may_take_any_state_on_the_workflow_and_a_broken_file_is_said(tmp_path):
    vals = [{"name": v} for v in ("Open", "Dev", "QC")]
    bundle = {"field": {"name": "State"}, "bundle": {"values": vals}}

    def handler(req):
        if req.url.path == "/api/admin/projects/VA/customFields":
            return httpx.Response(200, json=[bundle])
        if req.method == "POST":
            return httpx.Response(200, json={"id": "c"})
        if "possibleEvents" in req.url.query.decode():  # no State yet, no state machine
            sf = {"name": "State", "value": None, "possibleEvents": None}
            return httpx.Response(200, json={"customFields": [sf]})
        return httpx.Response(200, json=issue(1))

    svc = make(handler)
    svc.workflow_path = tmp_path / "yt_workflow.json"
    svc.save_workflow("VA", "dev", Workflow(edges=[("Open", "Dev")]))
    app = FastAPI()
    app.add_exception_handler(YtError, lambda _, e: JSONResponse({"detail": e.message}, status_code=e.status))
    app.include_router(build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:

        def post(v):
            return c.post("/api/yt/issue/field", json={"id": "VA-1", "name": "State", "value": v})

        assert (await post("Dev")).status_code == 200  # on the workflow
        assert (await post("QC")).status_code == 400  # not on it
        svc.workflow_path.write_text("{broken")
        r = await post("Dev")
        assert r.status_code == 500 and "file workflow" in r.json()["detail"]  # said, not "chưa có workflow"
        wf = {"pos": {}, "edges": [["Open", "Dev"]], "hidden": []}
        assert (await c.post("/api/yt/workflow?project=VA", json=wf)).status_code == 500
        assert svc.workflow_path.read_text() == "{broken"  # never overwritten (every other project's flows would go)
