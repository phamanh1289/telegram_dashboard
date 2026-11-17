"""YouTrack dashboard API (/api/yt/*): a thin proxy over YouTrackDashboard's cache.

Writes: the assignee / QC / State of one ticket, a comment the user typed, a ticket's UI flow (api_flow.py).
AI (/api/yt/ai/*, api_ai.py): one CLI run per click, text back only; it never writes to YouTrack.
"""

import re

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ..config import write_private_json
from . import api_ai, api_flow
from .client import FIELDS, ID_RE, YtError, _fields, _me, _normalize, _projects
from .schemas import (
    AiNotes,
    Assignee,
    Comment,
    FieldSet,
    Mention,
    SavedPrompts,
    Workflow,
    _issue_id,
    _project,
    _role,
)
from .service import YouTrackDashboard

LOGIN_RE = re.compile(r"^[\w.@-]+$")
SINCE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]*-\d+@\d+$")


def build_router(svc: YouTrackDashboard) -> APIRouter:
    r = APIRouter(prefix="/api/yt")

    def fields_of(p: str):
        return svc.cached(f"fields:{p}", lambda: _fields(svc, p))

    @r.get("/instructions")
    async def get_notes() -> AiNotes:
        return svc.notes()

    @r.post("/instructions")
    async def set_notes(body: AiNotes) -> AiNotes:
        write_private_json(svc.notes_path, body.model_dump())
        return body

    @r.get("/prompts")
    async def get_prompts() -> SavedPrompts:
        return svc.prompts()

    @r.post("/prompts")
    async def set_prompts(body: SavedPrompts) -> SavedPrompts:
        write_private_json(svc.prompts_path, body.model_dump())
        return body

    @r.get("/config")
    async def config(request: Request) -> dict:
        return {
            "base": svc.base,
            "mock": svc.mock,
            # Never the token itself: its prefix and last 4 chars, enough to tell which one is saved.
            "hint": f"{svc.token[:5]}…{svc.token[-4:]}" if len(svc.token or "") > 12 else None,
            "t": svc.thresholds,
            "hist": 0 if svc.mock else svc.hist,
            "ai": request.app.state.ai.configured,
        }

    @r.get("/projects")
    async def projects():
        if svc.mock:
            return [{"shortName": "VA", "name": "VA"}]
        return await svc.cached("projects", lambda: _projects(svc))

    @r.get("/issues")
    async def issues(project: str, who: str | None = None):
        p = _project(project)
        keys = None
        if who is not None:
            keys = sorted(k for k in who.split(",") if k in ("me", "unassigned") or LOGIN_RE.match(k))
            if not keys:
                return []
        if svc.mock:
            return []
        whole = svc.fresh(f"issues:{p}:*")
        if keys and whole is not None:  # a subset of the whole project: no second YouTrack pull
            return JSONResponse(await svc.who_filter(whole, keys))
        # JSONResponse: a big cached list skips FastAPI's encoder (tens of ms on the event loop)
        return JSONResponse(await svc.cached(f"issues:{p}:{','.join(keys) if keys else '*'}",
                                             lambda: svc.issues_or_whole(p, keys)))  # fmt: skip

    @r.get("/statesince")
    async def statesince(items: str = ""):
        keys = [s for s in items.split(",") if SINCE_RE.match(s)][:300]
        return {} if svc.mock else await svc.since_all(keys)

    @r.get("/transitions")
    async def transitions(project: str, days: int = 14):
        p, n = _project(project), max(1, min(days, 90))
        return [] if svc.mock else JSONResponse(await svc.cached(f"trans:{p}:{n}", lambda: svc.transitions(p, n)))

    @r.get("/sprints")
    async def sprints(project: str = ""):
        p = re.sub(r"[^\w-]", "", project)
        return [] if svc.mock else JSONResponse(await svc.cached(f"sprints:{p}", lambda: svc.sprints(p)))

    @r.get("/me")
    async def me():
        if svc.mock:
            return {"login": None, "name": None}
        return await svc.cached("me", lambda: _me(svc))

    @r.get("/people")
    async def people(project: str):
        p = _project(project)
        return [] if svc.mock else JSONResponse(await svc.cached(f"people:{p}", lambda: svc.people(p)))

    @r.get("/issue")
    async def issue(id: str = Query()):
        i = _issue_id(id)
        if svc.mock:
            raise YtError(404, "ticket not found")
        return await svc.issue_detail(i)

    @r.get("/trace")
    async def trace(ids: str = ""):
        keys = sorted({i.upper() for i in ids.split(",") if ID_RE.match(i)})[:300]
        if svc.mock or not keys:
            return {}
        return JSONResponse(await svc.cached(f"trace:{','.join(keys)}", lambda: svc.trace(keys)))

    @r.get("/attachment")
    async def attachment(issue: str = Query(), id: str = Query()):
        i = _issue_id(issue)
        if not re.fullmatch(r"[\w.-]{1,40}", id):
            raise YtError(400, "bad attachment id")
        svc.need_token()
        return await svc.file(i, id)

    @r.post("/issue/assignee")
    async def set_assignee(body: Assignee):
        return await set_user(body, "Assignee")

    @r.post("/issue/qc")  # its own path: an older server answers 404 instead of changing the Assignee
    async def set_qc(body: Assignee):
        return await set_user(body, "QC")

    async def set_user(body: Assignee, name: str):
        i = _issue_id(body.id)
        if body.login is not None and not re.match(r"^[\w.@-]{1,100}$", body.login):
            raise YtError(400, "bad login")
        svc.need_token()
        field = {
            "name": name,
            "$type": "SingleUserIssueCustomField",
            "value": {"login": body.login} if body.login else None,
        }
        d = await svc.yt(f"/api/issues/{i}", post={"customFields": [field]}, fields=FIELDS)
        svc.stale(i)
        return _normalize(d)

    @r.post("/issue/comment")
    async def comment(body: Comment):
        i = _issue_id(body.id)
        svc.need_token()
        await svc.comment(i, body.text)
        svc.stale(i)
        return {"ok": True}

    @r.get("/fields")
    async def fields(project: str):
        """Values for the fields the sheet can change, in the project's bundle order."""
        p = _project(project)
        return {} if svc.mock else await fields_of(p)

    @r.get("/workflow")
    async def get_workflow(project: str, request: Request) -> dict:
        p = _project(project)
        fields = {} if svc.mock else await fields_of(p)
        states = fields.get("State", [])
        return {"states": states, **svc.workflow(p, _role(request), states).model_dump()}

    @r.post("/workflow")
    async def set_workflow(project: str, body: Workflow, request: Request) -> Workflow:
        svc.save_workflow(_project(project), _role(request), body)
        return body

    @r.get("/workflow/youtrack")
    async def youtrack_flow(project: str) -> dict:
        p = _project(project)
        svc.need_token()
        states = (await fields_of(p)).get("State", [])
        return await svc.yt_flow(p, states)

    @r.post("/issue/field")
    async def set_field(body: FieldSet, request: Request):
        """Through a command, so State follows the project's workflow (it is a state machine)."""
        i = _issue_id(body.id)
        svc.need_token()
        p = i.rsplit("-", 1)[0]
        # the value goes into the command unquoted (YouTrack rejects {braces}): only known values
        known = await fields_of(p)
        if body.value not in known.get(body.name, []):
            raise YtError(400, f"{body.name} không có giá trị {body.value}")
        value = body.value
        if body.name == "State":  # a state machine takes the event leading to a state, not its name
            ev = "customFields(name,value(name),possibleEvents(id,presentation))"
            d = await svc.yt(f"/api/issues/{i}", fields=ev)
            sf = next((f for f in d.get("customFields") or [] if f["name"] == "State"), {})
            cur = (sf.get("value") or {}).get("name")
            wf = svc.workflow(p, _role(request), known.get("State", []))
            if wf.on and cur != body.value and (cur, body.value) not in wf.edges:
                to = ", ".join(t for s, t in wf.edges if s == cur) or "không có"
                raise YtError(400, f"Workflow của team không cho {cur} → {body.value} — chỉ sang: {to}")
            if (events := sf.get("possibleEvents")) is not None:
                value = next((e["id"] for e in events if e["presentation"] == body.value), None)
                if value is None:
                    to = ", ".join(e["presentation"] for e in events) or "không có"
                    raise YtError(400, f"Không chuyển sang {body.value} được — chỉ sang: {to}")
        cmd = {"query": f"{body.name} {value}", "issues": [{"idReadable": i}]}
        await svc.yt("/api/commands", post=cmd, fields="id")
        svc.stale(i)
        return _normalize(await svc.yt(f"/api/issues/{i}", fields=FIELDS))

    @r.get("/mentions")
    async def mentions(request: Request, id: str = Query()) -> list[Mention]:
        """Telegram messages (tracked groups) that mention this ticket. `message_id` / `outgoing` /
        `reply_to_id`: where to answer when the ticket is done (your own mention: the tag it replied to)."""
        s = request.app.state
        rows = await s.db.read(s.store.find_mentions, _issue_id(id))
        return [
            Mention.model_validate({
                "chat_id": m["chat_id"], "chat": m["title"], "from": m["sender_name"],
                "text": m["text"][:400], "date": m["date"] * 1000, "message_id": str(m["message_id"]),
                "outgoing": bool(m["outgoing"]),
                "reply_to_id": None if m["reply_to_id"] is None else str(m["reply_to_id"])})
            for m in rows
        ]  # fmt: skip

    api_ai.register(r, svc)
    api_flow.register(r, svc)
    return r
