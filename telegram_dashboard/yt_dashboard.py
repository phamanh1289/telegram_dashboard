"""YouTrack dashboard API (/api/yt/*): a thin proxy with a short TTL cache.

Reuses YOUTRACK_URL / YOUTRACK_TOKEN. Without a token the endpoints answer empty so the UI can
explain what to configure. Writes: only the assignee of one ticket.
"""

import asyncio
import contextlib
import os
import re
import time
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel

TTL = 50.0  # shorter than the UI refresh (60s) so each refresh sees fresh data
WAVE = 4  # issue pages fetched concurrently
PAGE = 500
FIELDS = (
    "idReadable,summary,created,updated,resolved,reporter(login,fullName),"
    "customFields(name,value(name,login,fullName,minutes,presentation))"
)
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]*-\d+$")
LOGIN_RE = re.compile(r"^[\w.@-]+$")
SINCE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]*-\d+@\d+$")


class YtError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class Assignee(BaseModel):
    id: str
    login: str | None


def _label(v):
    if v is None:
        return None
    if not isinstance(v, dict | list):
        return v  # simple fields (Due Date, numbers) come as plain values
    if isinstance(v, list):
        return ", ".join(str(x) for x in map(_label, v) if x) or None
    if v.get("minutes") is not None:
        return v["minutes"]
    return v.get("name") or v.get("fullName") or v.get("login") or v.get("presentation")


def _normalize(i: dict) -> dict:
    f, sprints, login = {}, [], None
    for c in i.get("customFields") or []:
        name, val = c.get("name"), c.get("value")
        f[name] = _label(val)
        if name == "Sprints":
            sprints = [
                s["name"] for s in (val if isinstance(val, list) else [val]) if s and s.get("name")
            ]
        if name == "Assignee" and isinstance(val, dict):
            login = val.get("login")
    return {
        "id": i["idReadable"],
        "summary": i.get("summary"),
        "created": i.get("created"),
        "updated": i.get("updated"),
        "resolved": i.get("resolved") or None,
        "type": f.get("Type"),
        "state": f.get("State"),
        "priority": f.get("Priority"),
        "assignee": f.get("Assignee"),
        "assigneeLogin": login,
        "qc": f.get("QC"),
        "due": f.get("Due Date"),
        "estimate": f.get("Estimation"),
        "sprints": sprints,
    }


def _who_clause(who: list[str] | None) -> str:
    if not who:
        return ""
    parts = [
        "Assignee: me"
        if k == "me"
        else "has: -Assignee"
        if k == "unassigned"
        else f"Assignee: {{{k}}}"
        for k in who
    ]
    return " and (" + " or ".join(parts) + ")"


class YouTrackDashboard:
    def __init__(self, settings):
        env = os.environ
        self.base = (settings.youtrack_url or "").rstrip("/")
        self.token = settings.youtrack_token or ""
        self.mock = not (self.base and self.token)
        self.hist = (
            0 if env.get("YT_HISTORY_DAYS") == "0" else int(env.get("YT_HISTORY_DAYS") or 120)
        )
        self.thresholds = {
            k: int(env.get(f"YT_{k.upper()}") or d)
            for k, d in (("wip", 4), ("stale", 7), ("dead", 30))
        }
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, object]] = {}
        self._inflight: dict[str, asyncio.Future] = {}
        self._since: dict[str, int] = {}

    def set_auth(self, base: str, token: str) -> None:
        """New URL/token from Settings: next call opens a fresh client, nothing cached survives."""
        old, self._client = self._client, None
        if old:
            asyncio.ensure_future(old.aclose())
        self.base, self.token = base.rstrip("/"), token
        self.mock = not (self.base and self.token)
        self._cache.clear()
        self._since.clear()

    async def aclose(self) -> None:
        if self._client:
            await self._client.aclose()

    async def yt(self, path: str, *, post: dict | None = None, **params):
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base,
                timeout=30.0,
                headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"},
            )
        try:
            r = await self._client.request(
                "POST" if post is not None else "GET", path, params=params, json=post
            )
        except httpx.HTTPError:
            raise YtError(502, "Không kết nối được YouTrack") from None
        if r.status_code >= 400:
            msg = {
                401: "Token YouTrack hết hạn hoặc sai — dán token mới trong Cài đặt",
                403: "Token YouTrack không có quyền cho thao tác này",
                404: "ticket not found",
            }.get(r.status_code, f"YouTrack {r.status_code}: {r.text[:200]}")
            raise YtError(r.status_code if r.status_code in (400, 401, 403, 404) else 502, msg)
        return r.json()

    async def cached(self, key: str, fn):
        hit = self._cache.get(key)
        if hit and time.monotonic() - hit[0] < TTL:
            return hit[1]
        task = self._inflight.get(key)  # concurrent identical requests share one YouTrack call
        if task is None:
            task = self._inflight[key] = asyncio.ensure_future(fn())
            task.add_done_callback(lambda _: self._inflight.pop(key, None))
        value = await asyncio.shield(task)
        if len(self._cache) > 200:
            now = time.monotonic()
            self._cache = {k: e for k, e in self._cache.items() if now - e[0] < TTL}
        self._cache[key] = (time.monotonic(), value)
        return value

    async def issues(
        self, project: str, scope: str, who: list[str] | None, hist: int | None = None
    ):
        hist = self.hist if hist is None else hist
        if scope == "active":
            sc = " and #Unresolved"
        elif hist:
            since = (datetime.now(UTC) - timedelta(days=hist)).date().isoformat()
            sc = f" and (#Unresolved or resolved date: {since} .. Today)"
        else:
            sc = ""
        query = f"project: {{{project}}}{sc}{_who_clause(who)}"
        out: list[dict] = []
        for skip in range(0, 50000, PAGE * WAVE):
            pages = await asyncio.gather(
                *(
                    self.yt(
                        "/api/issues",
                        query=query,
                        fields=FIELDS,
                        **{"$top": PAGE, "$skip": skip + k * PAGE},
                    )
                    for k in range(WAVE)
                )
            )
            for p in pages:
                out += map(_normalize, p)
            if any(len(p) < PAGE for p in pages):
                break
        return out

    async def issues_or_whole(self, project, scope, who):
        try:
            return await self.issues(project, scope, who)
        except YtError as e:  # query syntax refused: fall back to the whole project
            if e.status == 400 and scope == "all" and self.hist:
                return await self.issues(project, scope, who, 0)
            raise

    async def detail(self, issue_id: str):
        d = await self.yt(
            f"/api/issues/{issue_id}",
            fields=FIELDS + ",description,comments(text,created,author(fullName,login)),"
            "links(direction,linkType(name,sourceToTarget,targetToSource),"
            "issues(idReadable,summary,resolved))",
        )

        def link(x):
            t = x.get("linkType") or {}
            rel = (
                (
                    t.get("targetToSource")
                    if x.get("direction") == "INWARD"
                    else t.get("sourceToTarget")
                )
                or t.get("name")
                or "liên kết"
            )
            return {
                "rel": rel,
                "issues": [
                    {
                        "id": i["idReadable"],
                        "summary": i.get("summary"),
                        "resolved": i.get("resolved") or None,
                    }
                    for i in x.get("issues") or []
                ],
            }

        rep = d.get("reporter") or {}
        return {
            **_normalize(d),
            "description": d.get("description") or "",
            "reporter": rep.get("fullName") or rep.get("login"),
            "comments": [
                {
                    "text": c.get("text"),
                    "created": c.get("created"),
                    "author": (c.get("author") or {}).get("fullName")
                    or (c.get("author") or {}).get("login"),
                }
                for c in d.get("comments") or []
            ],
            "links": [x for x in map(link, d.get("links") or []) if x["issues"]],
        }

    async def state_since(self, issue_id: str, updated: str) -> int:
        """Latest State change in the activity log (0 = never changed). Cached per id@updated."""
        k = f"{issue_id}@{updated}"
        if k not in self._since:
            acts = await self.yt(
                f"/api/issues/{issue_id}/activities",
                categories="CustomFieldCategory",
                fields="timestamp,field(name)",
                **{"$top": 200},
            )
            if len(self._since) > 5000:
                self._since.clear()
            self._since[k] = max(
                (a["timestamp"] for a in acts if (a.get("field") or {}).get("name") == "State"),
                default=0,
            )
        return self._since[k]

    async def since_all(self, items: list[str]) -> dict[str, int]:
        sem, out = asyncio.Semaphore(8), {}

        async def one(it: str):
            issue_id, updated = it.split("@")
            async with sem:
                with contextlib.suppress(YtError):  # skipped: the UI keeps its last known value
                    out[issue_id] = await self.state_since(issue_id, updated)

        await asyncio.gather(*map(one, items))
        return out

    async def people(self, project: str):
        try:
            # The team is a UserGroup object; its members are under "users".
            group = await self.yt(
                f"/api/admin/projects/{project}/team", fields="users(login,fullName)"
            )
            team = group.get("users") if isinstance(group, dict) else None
            if team:
                return [
                    {"login": u["login"], "name": u.get("fullName") or u["login"]} for u in team
                ]
        except YtError:
            pass
        seen = {
            i["assigneeLogin"]: i["assignee"]
            for i in await self.issues(project, "active", None)
            if i["assigneeLogin"]
        }
        return [{"login": k, "name": v} for k, v in seen.items()]

    async def sprints(self, project: str):
        boards = await self.yt(
            "/api/agiles", fields="projects(shortName),sprints(name,start,finish)", **{"$top": 200}
        )
        seen = {}
        for b in boards:
            if not b.get("projects") or any(p["shortName"] == project for p in b["projects"]):
                for s in b.get("sprints") or []:
                    if s.get("name") and s.get("start") and s.get("finish"):
                        seen[s["name"]] = {
                            "name": s["name"],
                            "start": s["start"],
                            "finish": s["finish"],
                        }
        return list(seen.values())


def _project(p: str) -> str:
    p = re.sub(r"[^\w-]", "", p)
    if not p:
        raise YtError(400, "project required")
    return p


def _issue_id(i: str) -> str:
    if not ID_RE.match(i):
        raise YtError(400, "bad id")
    return i


def build_router(svc: YouTrackDashboard) -> APIRouter:
    r = APIRouter(prefix="/api/yt")

    @r.get("/config")
    async def config() -> dict:
        return {
            "base": svc.base,
            "mock": svc.mock,
            "t": svc.thresholds,
            "hist": 0 if svc.mock else svc.hist,
        }

    @r.get("/projects")
    async def projects():
        if svc.mock:
            return [{"shortName": "VA", "name": "VA"}]
        return await svc.cached("projects", lambda: _projects(svc))

    @r.get("/issues")
    async def issues(project: str, scope: str = "all", who: str | None = None):
        p = _project(project)
        scope = "active" if scope == "active" else "all"
        keys = None
        if who is not None:
            keys = sorted(
                k for k in who.split(",") if k in ("me", "unassigned") or LOGIN_RE.match(k)
            )
            if not keys:
                return []
        if svc.mock:
            return []
        return await svc.cached(
            f"issues:{p}:{scope}:{','.join(keys) if keys else '*'}",
            lambda: svc.issues_or_whole(p, scope, keys),
        )

    @r.get("/statesince")
    async def statesince(items: str = ""):
        keys = [s for s in items.split(",") if SINCE_RE.match(s)][:300]
        return {} if svc.mock else await svc.since_all(keys)

    @r.get("/sprints")
    async def sprints(project: str = ""):
        p = re.sub(r"[^\w-]", "", project)
        return [] if svc.mock else await svc.cached(f"sprints:{p}", lambda: svc.sprints(p))

    @r.get("/me")
    async def me():
        if svc.mock:
            return {"login": None, "name": None}
        return await svc.cached("me", lambda: _me(svc))

    @r.get("/people")
    async def people(project: str):
        p = _project(project)
        return [] if svc.mock else await svc.cached(f"people:{p}", lambda: svc.people(p))

    @r.get("/issue")
    async def issue(id: str = Query()):
        i = _issue_id(id)
        if svc.mock:
            raise YtError(404, "ticket not found")
        return await svc.cached(f"issue:{i}", lambda: svc.detail(i))

    @r.post("/issue/assignee")
    async def set_assignee(body: Assignee):
        i = _issue_id(body.id)
        if body.login is not None and not re.match(r"^[\w.@-]{1,100}$", body.login):
            raise YtError(400, "bad login")
        if svc.mock:
            raise YtError(503, "Chưa có token YouTrack — dán token trong Cài đặt")
        field = {
            "name": "Assignee",
            "$type": "SingleUserIssueCustomField",
            "value": {"login": body.login} if body.login else None,
        }
        d = await svc.yt(f"/api/issues/{i}", post={"customFields": [field]}, fields=FIELDS)
        svc._cache.clear()  # lists and details are stale now
        return _normalize(d)

    return r


async def _projects(svc: YouTrackDashboard):
    a = await svc.yt("/api/admin/projects", fields="shortName,name,archived", **{"$top": 200})
    return [p for p in a if not p.get("archived")]


async def _me(svc: YouTrackDashboard):
    u = await svc.yt("/api/users/me", fields="login,fullName")
    return {"login": u["login"], "name": u.get("fullName") or u["login"]}
