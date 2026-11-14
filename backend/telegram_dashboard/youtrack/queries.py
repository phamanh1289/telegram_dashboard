"""YouTrack reads: ticket lists, details, State history, people, sprints; a ticket as JSON for the AI."""

import asyncio
import time
from datetime import UTC, datetime, timedelta

from ..ai import data_json
from ..errors import ApiError
from ..telegram.digest import VN
from .client import FIELDS, ID_RE, YtClient, YtError, _label, _me, _normalize, _projects, _rel, _who_clause

WAVE = 4  # issue pages fetched concurrently
PAGE = 500
TRANS_PAGES = 20  # activity pages of 1000 for /transitions
SINCE_DAYS = 30  # /statesince reads the project's State changes over this window in one paged read


def _day(ms) -> str | None:
    return datetime.fromtimestamp(ms / 1000, VN).date().isoformat() if ms else None


def _ticket_json(d: dict, desc: int = 8000, ncom: int = 30, clen: int = 1500, **extra) -> str:
    """Ticket detail as compact JSON for the AI: dates as days, long texts cut."""
    keys = ("id", "summary", "type", "state", "priority", "assignee", "qc", "reporter", "sprints",
            "estimate")  # fmt: skip
    return data_json(
        {
            **{k: d.get(k) for k in keys},
            **{k: _day(d.get(k)) for k in ("created", "updated", "resolved", "due")},
            "description": d["description"][:desc],
            "links": [
                f"{x['rel']}: "
                + ", ".join(i["id"] + (" (xong)" if i["resolved"] else "") for i in x["issues"])  # fmt: skip
                for x in d["links"]
            ],
            "comments": [
                {"author": c["author"], "date": _day(c["created"]), "text": (c["text"] or "")[:clen]}
                for c in d["comments"][-ncom:]  # fmt: skip
            ],
            **extra,
        }
    )


class YtQueries(YtClient):
    def issue_detail(self, i: str):
        """Ticket `i`'s detail through the cache (key "issue:<id>", dropped by stale)."""
        return self.cached(f"issue:{i}", lambda: self.detail(i))

    async def yt_flow(self, project: str, states: list[str]) -> dict:
        """The arrows YouTrack's own state machine allows: one ticket per state, its possibleEvents.
        A state no ticket is in yet can't be asked (listed in `unknown`)."""
        ev = "customFields(name,possibleEvents(presentation))"

        async def one(st: str):
            q = f"project: {{{project}}} State: {{{st}}}"
            a = await self.yt("/api/issues", query=q, fields=ev, **{"$top": 1})
            if not a:
                return st, None
            sf = next((f for f in a[0].get("customFields") or [] if f["name"] == "State"), {})
            return st, [e["presentation"] for e in sf.get("possibleEvents") or []]

        got = await asyncio.gather(*(one(s) for s in states))
        edges = [(s, t) for s, ts in got if ts for t in ts if t in states and t != s]
        return {"edges": edges, "unknown": [s for s, ts in got if ts is None]}

    async def issues(self, project: str, who: list[str] | None, hist: int | None = None):
        hist = self.hist if hist is None else hist
        if hist:
            since = (datetime.now(UTC) - timedelta(days=hist)).date().isoformat()
            sc = f" and (#Unresolved or resolved date: {since} .. Today)"
        else:
            sc = ""
        out = await self._all(f"project: {{{project}}}{sc}{_who_clause(who)}")
        if who and "me" in who:  # "My task" also covers tickets the user tests (QC)
            try:
                qc = await self._all(f"project: {{{project}}}{sc} and QC: me")
            except YtError as e:
                if e.status != 400:  # 400: this project has no QC user field
                    raise
            else:
                ids = {i["id"] for i in out}
                out += [i for i in qc if i["id"] not in ids]
        return out

    async def _all(self, query: str) -> list[dict]:
        def page(skip: int):
            return self.yt("/api/issues", query=query, fields=FIELDS, **{"$top": PAGE, "$skip": skip})

        out: list[dict] = []
        pages, skip = [await page(0)], PAGE  # most projects fit one page: no wave for them
        while True:
            for p in pages:
                out += map(_normalize, p)
            if any(len(p) < PAGE for p in pages) or skip >= 50000:
                return out
            pages = await asyncio.gather(*(page(skip + k * PAGE) for k in range(WAVE)))
            skip += PAGE * WAVE

    async def issues_or_whole(self, project, who):
        try:
            return await self.issues(project, who)
        except YtError as e:  # query syntax refused: fall back to the whole project
            if e.status == 400 and self.hist:
                return await self.issues(project, who, 0)
            raise

    async def who_filter(self, rows: list[dict], who: list[str]) -> list[dict]:
        """`who`'s tickets out of the whole project's, as the YouTrack query would pick them
        ("me" also covers the tickets the user tests as QC)."""
        me = (await self.cached("me", lambda: _me(self)))["login"] if "me" in who else None
        logins = {k for k in who if k not in ("me", "unassigned")} | ({me} if me else set())

        def pick(i: dict) -> bool:
            return (i["assigneeLogin"] in logins or (me is not None and i.get("qcLogin") == me)
                    or ("unassigned" in who and not i["assignee"]))  # fmt: skip

        return [i for i in rows if pick(i)]

    async def create_issue(self, summary: str, description: str, project: str, markdown: bool = True):
        """A ticket from a tagged message: (idReadable, browser URL); ApiError codes for app.py."""
        try:
            projects = await self.cached("projects", lambda: _projects(self))
            pid = next((p["id"] for p in projects if p["shortName"] == project), None)
            if pid is None:
                raise ApiError(422, "youtrack_project_not_found")
            post = {"project": {"id": pid}, "summary": summary, "description": description, "usesMarkdown": markdown}
            issue_id = (await self.yt("/api/issues", post=post, fields="idReadable"))["idReadable"]
        except YtError as e:
            code = "youtrack_unauthorized" if e.status in (401, 403) else "youtrack_error"
            raise ApiError(502, code) from None
        except KeyError, TypeError, ValueError:
            raise ApiError(502, "youtrack_error") from None
        return issue_id, f"{self.base}/issue/{issue_id}"

    async def brief(self, ids: list[str]) -> str:
        """Tickets as short JSON for a Telegram answer's progress ("Trả lời từ code"); "" with no token. A ticket gone
        (404) or a bad id is skipped; a token / network failure is an ApiError the page shows."""
        keys = list(dict.fromkeys(i.upper() for i in ids if ID_RE.match(i)))
        if self.mock or not keys:
            return ""

        async def one(i: str) -> str | None:
            try:
                return _ticket_json(await self.issue_detail(i), 600, 3, 300)
            except YtError as e:
                if e.status == 404:
                    return None
                raise ApiError(502, "youtrack_unauthorized" if e.status in (401, 403) else "youtrack_error") from None

        got = [t for t in await asyncio.gather(*map(one, keys)) if t]
        return f"[{','.join(got)}]" if got else ""

    async def detail(self, issue_id: str):
        d = await self.yt(
            f"/api/issues/{issue_id}",
            fields=FIELDS + ",description,comments(id,text,created,author(fullName,login)),"
            "attachments(id,name,mimeType,size,removed,comment(id)),"
            "links(direction,linkType(name,sourceToTarget,targetToSource),"
            "issues(idReadable,summary,resolved))",
        )

        def link(x):
            return {
                "rel": _rel(x),
                "issues": [
                    {
                        "id": i["idReadable"],
                        "summary": i.get("summary"),
                        "resolved": i.get("resolved") or None,
                    }
                    for i in x.get("issues") or []
                ],
            }

        return {
            **_normalize(d),
            "description": d.get("description") or "",
            "comments": [
                {
                    "id": c.get("id"),
                    "text": c.get("text"),
                    "created": c.get("created"),
                    "author": (c.get("author") or {}).get("fullName") or (c.get("author") or {}).get("login"),
                }
                for c in d.get("comments") or []
            ],
            "links": [x for x in map(link, d.get("links") or []) if x["issues"]],
            # the text names them: ![](image.png); the UI loads them through /attachment
            "attachments": [
                {
                    "id": a["id"],
                    "name": a.get("name") or "",
                    "mime": a.get("mimeType") or "",
                    "size": a.get("size") or 0,
                    "comment": (a.get("comment") or {}).get("id"),
                }
                for a in d.get("attachments") or []
                if a.get("id") and not a.get("removed")
            ],  # fmt: skip
        }

    async def trace(self, ids: list[str]) -> dict:
        """For the release report, per ticket: the start of its description, its links (the linked
        tickets with their state, type, assignee) and its latest comment. One search per 100 tickets."""
        fields = (
            "idReadable,description,comments(text,created,author(fullName,login)),"
            f"links(direction,linkType(name,sourceToTarget,targetToSource),issues({FIELDS}))"
        )  # ponytail: every comment comes back to pick the last one; fine for a release's ~100-300 tickets

        async def chunk(part: list[str]):
            q = "issue id: " + ", ".join(part)
            return await self.yt("/api/issues", query=q, fields=fields, **{"$top": len(part)})

        out = {}
        for rows in await asyncio.gather(*(chunk(ids[n : n + 100]) for n in range(0, len(ids), 100))):
            for d in rows:
                last = max(d.get("comments") or [], key=lambda c: c.get("created") or 0, default=None)
                a = (last or {}).get("author") or {}
                out[d["idReadable"]] = {
                    "desc": (d.get("description") or "")[:600],
                    "links": [
                        {"rel": _rel(x), "issues": [_normalize(i) for i in x.get("issues") or []]}
                        for x in d.get("links") or [] if x.get("issues")
                    ],
                    "last": last and {"text": (last.get("text") or "")[:600], "created": last.get("created"),
                                      "author": a.get("fullName") or a.get("login")},
                }  # fmt: skip
        return out

    async def state_since(self, issue_id: str, updated: str) -> int:
        """Latest State change in the activity log (0 = never changed). Cached per id@updated."""
        k = f"{issue_id}@{updated}"
        if k in self._since:
            return self._since[k]
        auth = self._auth
        acts = await self.yt(
            f"/api/issues/{issue_id}/activities",
            categories="CustomFieldCategory",
            fields="timestamp,field(name)",
            reverse="true",  # newest first: tickets with >200 field changes keep their latest State
            **{"$top": 200},
        )
        v = max(
            (a["timestamp"] for a in acts if (a.get("field") or {}).get("name") == "State"),
            default=0,
        )
        if auth == self._auth:
            if len(self._since) > 5000:
                self._since.clear()
            self._since[k] = v
        return v

    async def transitions(self, project: str, days: int) -> list[dict]:
        """Every State change in the project over the last `days`, oldest first: the page works out
        QC pass / fail / reopen from them. One paged activity read for the whole project."""
        read_at = int(time.time() * 1000)
        start = int((time.time() - days * 86400) * 1000)
        day = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()
        params = {
            "categories": "CustomFieldCategory",
            "issueQuery": f"project: {{{project}}} updated: {day} .. Today",
            "start": start,
            "fields": "activities(timestamp,author(fullName,login),target(idReadable),field(name),"
            "added(name),removed(name)),afterCursor,hasAfter",
            "$top": 1000,
        }
        out: list[dict] = []
        for _ in range(TRANS_PAGES):  # ponytail: page cap; raise it if busy projects get cut short
            page = await self.yt("/api/activitiesPage", **params)
            for a in page.get("activities") or []:
                tid = (a.get("target") or {}).get("idReadable")
                if tid and (a.get("field") or {}).get("name") == "State":
                    by = a.get("author") or {}
                    out.append({
                        "id": tid, "at": a.get("timestamp"), "by": by.get("fullName") or by.get("login"),
                        "from": _label(a.get("removed")), "to": _label(a.get("added")),
                    })  # fmt: skip
            cur = page.get("afterCursor")
            if not page.get("hasAfter") or not cur or cur == params.get("cursor"):  # a repeated cursor: done
                self._trans_until[f"{project}:{days}"] = read_at
                break
            params["cursor"] = cur
        else:  # cut short: the newest changes are missing, so statesince can't trust it
            # ponytail: oldest-first; reading newest-first (activitiesPage `reverse`) needs a check on a live YouTrack
            self._trans_until[f"{project}:{days}"] = 0
        return out

    async def since_all(self, items: list[str]) -> dict[str, int]:
        """Latest State change per "ID@updated": from the project's State changes over SINCE_DAYS (one
        cached read for all its tickets) when that read covers the ticket's last update and holds a
        change of it; else from the ticket's own activity log (one request each)."""
        sem, out, rest = asyncio.Semaphore(8), {}, []
        by_project: dict[str, list[str]] = {}
        for it in items:
            by_project.setdefault(it.split("-", 1)[0], []).append(it)
        for p, its in by_project.items():
            try:
                trans = await self.cached(f"trans:{p}:{SINCE_DAYS}", lambda p=p: self.transitions(p, SINCE_DAYS))
            except YtError as e:
                if e.status in (401, 403):
                    raise
                trans = []
            until, last = self._trans_until.get(f"{p}:{SINCE_DAYS}", 0), {}
            for t in trans:
                last[t["id"]] = max(last.get(t["id"], 0), t["at"] or 0)
            for it in its:
                issue_id, updated = it.split("@")
                if issue_id in last and int(updated) <= until:
                    out[issue_id] = last[issue_id]
                else:  # no State change in the window (or changed since the read): its own log
                    rest.append(it)

        async def one(it: str):
            issue_id, updated = it.split("@")
            async with sem:
                try:
                    out[issue_id] = await self.state_since(issue_id, updated)
                except YtError as e:  # skipped: the UI keeps its last known value
                    if e.status in (401, 403):  # but a bad token must show, not look like "no data"
                        raise

        await asyncio.gather(*map(one, rest))
        return out

    async def people(self, project: str):
        try:
            # The team is a UserGroup object; its members are under "users".
            group = await self.yt(f"/api/admin/projects/{project}/team", fields="users(login,fullName)")
            team = group.get("users") if isinstance(group, dict) else None
            if team:
                return [{"login": u["login"], "name": u.get("fullName") or u["login"]} for u in team]
        except YtError:
            pass
        seen = {
            i["assigneeLogin"]: i["assignee"]
            for i in await self._all(f"project: {{{project}}} #Unresolved")
            if i["assigneeLogin"]
        }
        return [{"login": k, "name": v} for k, v in seen.items()]

    async def sprints(self, project: str):
        boards = await self.yt("/api/agiles", fields="projects(shortName),sprints(name,start,finish)", **{"$top": 200})
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
