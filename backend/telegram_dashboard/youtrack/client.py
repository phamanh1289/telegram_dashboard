"""YouTrack REST client with a short TTL cache, attachments and the ticket's UI flow file.

Reuses YOUTRACK_URL / YOUTRACK_TOKEN. Without a token the endpoints answer empty so the UI can
explain what to configure. Also `whoami` (check a pasted token before it is saved).
"""

import asyncio
import hashlib
import os
import re
import time
from collections import OrderedDict
from urllib.parse import quote, urljoin, urlsplit

import httpx
from fastapi import Response

from .. import zeplin
from ..errors import ApiError
from . import flow as uiflow

MAX_FILE = 25 << 20  # ponytail: proxied whole in memory; stream it if videos ever need to play here
TTL = 50.0  # shorter than the UI refresh (60s) so each refresh sees fresh data
FIELDS = (
    "idReadable,summary,created,updated,resolved,reporter(login,fullName),"
    "customFields(name,value(name,login,fullName,minutes,presentation))"
)
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]*-\d+$")
FLOW_COMMENT_GRACE_MS = 120_000  # a save comments right after the file: that update is not "the ticket changed"
TIMEOUT = 20.0


class YtError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class YtUnreachable(YtError):
    """No answer from YouTrack (network / timeout): a write may or may not have happened."""

    def __init__(self):
        super().__init__(502, "Không kết nối được YouTrack")


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
    f, sprints, login, qc = {}, [], None, None
    for c in i.get("customFields") or []:
        name, val = c.get("name"), c.get("value")
        f[name] = _label(val)
        if name == "Sprints":
            sprints = [s["name"] for s in (val if isinstance(val, list) else [val]) if s and s.get("name")]
        if name == "Assignee" and isinstance(val, dict):
            login = val.get("login")
        if name == "QC" and isinstance(val, dict):
            qc = val.get("login")
    rep = i.get("reporter") or {}
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
        "qcLogin": qc,
        "reporter": rep.get("fullName") or rep.get("login"),
        "due": f.get("Due Date"),
        "estimate": f.get("Estimation"),
        "sprints": sprints,
    }


def _rel(x: dict) -> str:
    """A link's name as read from this ticket's side ("is required for", "relates to")."""
    t = x.get("linkType") or {}
    side = t.get("targetToSource") if x.get("direction") == "INWARD" else t.get("sourceToTarget")
    return side or t.get("name") or "liên kết"


def _who_clause(who: list[str] | None) -> str:
    if not who:
        return ""
    parts = [
        "Assignee: me" if k == "me" else "has: -Assignee" if k == "unassigned" else f"Assignee: {{{k}}}" for k in who
    ]
    return " and (" + " or ".join(parts) + ")"


class YtClient:
    """HTTP, the TTL cache and attachments; one per app (YouTrackDashboard adds reads, settings, watch)."""

    def __init__(self, settings):
        env = os.environ
        self.touched: dict[str, float] = {}  # ticket -> monotonic time of my last write from here (not news)
        self.base = (settings.youtrack_url or "").rstrip("/")
        self.token = settings.youtrack_token or ""
        self.mock = not (self.base and self.token)
        self.hist = 0 if env.get("YT_HISTORY_DAYS") == "0" else int(env.get("YT_HISTORY_DAYS") or 120)
        self._client: httpx.AsyncClient | None = None
        self._retired: list[httpx.AsyncClient] = []
        self._flow_auth = 0  # attachment rights generation; unrelated writes keep parsed flows warm
        self._auth = 0  # bumped by set_auth: answers fetched with an older token are not cached
        self._cache: dict[str, tuple[float, object]] = {}
        self._inflight: dict[str, asyncio.Future] = {}
        self.shots = zeplin.Shots(scope=self.flow_scope)
        self._flow_cache: OrderedDict[tuple, uiflow.Flow | None] = OrderedDict()
        self._flow_seed: dict[tuple, tuple[int, uiflow.Flow]] = {}
        self._since: dict[str, int] = {}
        self._trans_until: dict[str, int] = {}  # "p:days" -> ms the last read covers (0: cut at TRANS_PAGES)

    def flow_scope(self):
        url = urlsplit(self.base)
        server = url._replace(scheme=url.scheme.lower(), netloc=url.netloc.lower()).geturl()
        return hashlib.sha256((server + "\0" + self.token).encode()).hexdigest()

    def set_auth(self, base: str, token: str) -> None:
        """New URL/token from Settings: next call opens a fresh client, nothing cached survives.
        Requests in flight finish on the old client."""
        if self._client:  # ponytail: kept open till shutdown; token changes are rare
            self._retired.append(self._client)
        self._client = None
        self._flow_auth += 1
        self._auth += 1
        self.base, self.token = base.rstrip("/"), token
        self.mock = not (self.base and self.token)
        self._cache.clear()
        self._flow_cache.clear()
        self._flow_seed.clear()
        self._inflight.clear()
        self._since.clear()
        self._trans_until.clear()

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base,
                timeout=30.0,
                headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"},
            )
        return self._client

    async def _call(self, method: str, path: str, **kw) -> httpx.Response:
        """One REST call; network and HTTP errors become a YtError the UI can show."""
        try:
            r = await self._http().request(method, path, **kw)
        except httpx.HTTPError:
            raise YtUnreachable from None
        if r.status_code >= 400:
            msg = {
                401: "Token YouTrack hết hạn hoặc sai — dán token mới trong Cài đặt",
                403: "Token YouTrack không có quyền cho thao tác này",
                404: "ticket not found" if path.startswith("/api/issues/") else f"Không thấy trên YouTrack: {path}",
            }.get(r.status_code, f"YouTrack {r.status_code}: {r.text[:200]}")
            raise YtError(r.status_code if r.status_code in (400, 401, 403, 404) else 502, msg)
        return r

    @staticmethod
    def _json(r: httpx.Response):
        try:
            return r.json()
        except ValueError:  # a redirect / SSO login page: the URL is wrong, not the ticket
            raise YtError(502, "YouTrack trả về không phải JSON — kiểm tra URL YouTrack trong Cài đặt") from None

    async def yt(self, path: str, *, post: dict | None = None, **params):
        return self._json(await self._call("POST" if post is not None else "GET", path, params=params, json=post))

    async def upload(self, issue: str, name: str, data: bytes, *, mime: str) -> tuple[str, str]:
        """Add one file to a ticket's attachments; (its new id, the name YouTrack stored it under)."""
        path = f"/api/issues/{issue}/attachments"
        kw = {"params": {"fields": "id,name"}, "files": {"upload": (name, data, mime)}}
        d = self._json(await self._call("POST", path, **kw))
        try:
            a = d[0] if isinstance(d, list) else d  # YouTrack answers the list of files it added
            return a["id"], a.get("name") or ""
        except LookupError, TypeError:
            raise YtError(502, "YouTrack không trả id tệp vừa tải lên") from None

    async def attach(self, issue: str, path) -> None:
        """Upload one photo to a ticket's attachments."""
        await self.upload(issue, path.name, path.read_bytes(), mime="image/jpeg")

    async def detach(self, issue: str, att: str) -> None:
        await self._call("DELETE", f"/api/issues/{issue}/attachments/{att}")

    async def comment(self, issue: str, text: str) -> None:
        await self.yt(f"/api/issues/{issue}/comments", post={"text": text}, fields="id")

    async def flow_file(self, issue: str) -> tuple[str, uiflow.Flow | None, bool] | None:
        """(attachment id, flow, ticket newer) of the ticket's newest uiflow-<issue>.html; flow None when it is not
        ours / broken; `ticket newer`: the ticket changed after the file was written (its own save comment aside).
        None when the ticket has no such file."""
        auth = self._flow_auth
        d = await self.yt(f"/api/issues/{issue}", fields="updated,attachments(id,name,created,removed,size,url)")
        name = uiflow.NAME.format(issue=issue)
        mine = [a for a in d.get("attachments") or [] if a.get("name") == name and not a.get("removed")]
        if not mine:
            return None
        a = max(mine, key=lambda a: a.get("created") or 0)  # no id tiebreak: "1-9" sorts above "1-10" as a string
        key = (auth, issue, *(a.get(k) for k in ("id", "created", "size", "url")))
        if key in self._flow_cache:
            self._flow_cache.move_to_end(key)
            flow = self._flow_cache[key]
        else:
            seed = self._flow_seed.pop((auth, issue, a["id"]), None)
            try:
                flow = seed[1] if seed and seed[0] == a.get("size") else uiflow.extract(
                    (await self._bytes(a)).decode("utf-8", "replace")
                )
            except uiflow.TooNew as e:  # not cached: rare, and an app update must see it afresh
                raise YtError(422, str(e)) from None
            if auth == self._flow_auth:
                self._flow_cache[key] = flow.model_copy(deep=True) if flow else None
                while len(self._flow_cache) > 128:
                    self._flow_cache.popitem(last=False)
        newer = (d.get("updated") or 0) > (a.get("created") or 0) + FLOW_COMMENT_GRACE_MS
        return a["id"], flow.model_copy(deep=True) if flow else None, newer

    def seed_flow(self, issue: str, att: str, size: int, flow: uiflow.Flow, *, auth: int) -> None:
        if auth == self._flow_auth:
            self._flow_seed[(auth, issue, att)] = (size, flow.model_copy(deep=True))
            while len(self._flow_seed) > 128:
                self._flow_seed.pop(next(iter(self._flow_seed)))

    def need_token(self) -> None:
        """A write / detail read without a token: say where to paste one (lists just come back empty)."""
        if self.mock:
            raise YtError(503, "Chưa có token YouTrack — dán token trong Cài đặt")

    def stale(self, issue: str | None = None) -> None:
        """After a write: ticket lists (and that ticket) are stale; sprints, people, fields stay cached.
        The bump keeps a list fetch already in flight from caching what it saw before the write."""
        self._auth += 1
        if issue:
            self.touched[issue] = time.monotonic()

        def drop(k: str) -> bool:
            return k.startswith("issues:") or k == f"issue:{issue}"

        self._cache = {k: e for k, e in self._cache.items() if not drop(k)}
        for k in [k for k in self._inflight if drop(k)]:
            self._inflight.pop(k)

    def fresh(self, key: str):
        """The cached value of `key` while it is fresh, else None."""
        hit = self._cache.get(key)
        return hit[1] if hit and time.monotonic() - hit[0] < TTL else None

    async def cached(self, key: str, fn):
        if (hit := self.fresh(key)) is not None:
            return hit
        auth = self._auth
        task = self._inflight.get(key)  # concurrent identical requests share one YouTrack call
        if task is None:
            task = self._inflight[key] = asyncio.ensure_future(fn())
            task.add_done_callback(  # only our own entry: set_auth may have replaced it
                lambda t: self._inflight.get(key) is t and self._inflight.pop(key)
            )
        value = await asyncio.shield(task)
        if auth != self._auth:
            return value  # token changed meanwhile: don't cache what the old one saw
        if len(self._cache) > 200:
            now = time.monotonic()
            self._cache = {k: e for k, e in self._cache.items() if now - e[0] < TTL}
        self._cache[key] = (time.monotonic(), value)
        return value

    async def file(self, issue_id: str, att: str) -> Response:
        """One attachment's bytes, fetched with the token (the browser has none)."""
        path = f"/api/issues/{issue_id}/attachments/{att}"
        a = await self.yt(path, fields="url,mimeType,name,size")
        content = await self._bytes(a)
        mime = a.get("mimeType") or "application/octet-stream"
        show = mime.startswith("image/") and mime != "image/svg+xml"  # svg may hold script
        name = quote(a.get("name") or "file")
        return Response(content, media_type=mime, headers={
            "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Content-Disposition": f"{'inline' if show else 'attachment'}; filename*=UTF-8''{name}",
        })  # fmt: skip

    async def _bytes(self, a: dict) -> bytes:
        """An attachment's content from its {url, size}: only on the YouTrack host, at most MAX_FILE."""
        if (a.get("size") or 0) > MAX_FILE:
            raise YtError(413, "Tệp quá lớn để xem trong dashboard — mở trên YouTrack")
        url = urljoin(self.base + "/", a.get("url") or "")  # a path from the host root
        if urlsplit(url).netloc != urlsplit(self.base).netloc:
            raise YtError(502, "YouTrack trả về link tệp lạ")
        try:
            r = await self._http().get(url, headers={"Accept": "*/*"})
        except httpx.HTTPError:
            raise YtUnreachable from None
        if r.status_code >= 400:
            raise YtError(502, f"YouTrack {r.status_code} khi tải tệp")
        return r.content


async def _projects(svc: YtClient):
    a = await svc.yt("/api/admin/projects", fields="id,shortName,name,archived", **{"$top": 200})
    return [p for p in a if not p.get("archived")]


async def _fields(svc: YtClient, project: str) -> dict[str, list[str]]:
    a = await svc.yt(
        f"/api/admin/projects/{project}/customFields",
        fields="field(name),bundle(values(name,archived))", **{"$top": 100},
    )  # fmt: skip
    return {
        f["field"]["name"]: [v["name"] for v in f["bundle"]["values"] if not v.get("archived")]
        for f in a
        if f["field"]["name"] in ("State", "Priority", "Type") and f.get("bundle")
    }


async def _me(svc: YtClient):
    u = await svc.yt("/api/users/me", fields="login,fullName")
    return {"login": u.get("login"), "name": u.get("fullName") or u.get("login")}


# ---- token check (routes.py's /api/youtrack/*, ApiError codes) ----------------
async def whoami(url: str, token: str) -> dict:
    """Check a URL + token pair before saving it: {login, name} or ApiError."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{url}/api/users/me",
                params={"fields": "login,fullName"},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
        if r.status_code in (401, 403):
            raise ApiError(400, "youtrack_unauthorized")
        r.raise_for_status()
        u = r.json()
        return {"login": u["login"], "name": u.get("fullName") or u["login"]}
    except httpx.HTTPError:
        raise ApiError(502, "youtrack_unreachable") from None
    except KeyError, ValueError, TypeError:
        raise ApiError(502, "youtrack_unreachable") from None  # not a YouTrack answer
