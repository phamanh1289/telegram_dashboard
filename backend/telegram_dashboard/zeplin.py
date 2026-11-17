"""Zeplin screens for the UI flow: each screen's image and where its texts / buttons sit, read with the token of the
user's own zeplin MCP server (provider_cmds.zeplin_server). No AI: one REST call per screen, cached."""

import asyncio
import contextlib
import hashlib
import json
import logging
import re
import time
import unicodedata
from collections import OrderedDict
from urllib.parse import urlsplit

import httpx

from . import provider_cmds
from .config import write_private_json

log = logging.getLogger(__name__)
API = "https://api.zeplin.dev/v1"
SCREEN = re.compile(r"/project/([0-9a-f]{24})/screen/([0-9a-f]{24})")
TTL = 3600.0  # the image URLs Zeplin signs stay valid for weeks; an hour keeps a redesign from lagging long
TAP_H = 88  # a text's tap area: its tallest ancestor group up to this height (a button, a row), else the text itself
MAX_HITS = 200
PARALLEL = 4  # Zeplin allows ~200 calls a minute


IMAGE_HOSTS = ("img.zeplin.io", "public-cdn.zeplin.dev")  # where Zeplin's signed image URLs live (and redirect to)
MAX_IMAGE = 10 << 20


class ZeplinError(Exception):
    """The whole batch failed (no token, token refused, Zeplin unreachable): the UI says so."""


def token() -> str:
    return provider_cmds.mcp_env(provider_cmds.zeplin_server()).get("ZEPLIN_ACCESS_TOKEN", "")


def _text(s: str) -> str:
    """Layer text as a person reads it: icon-font glyphs (private use) dropped, whitespace collapsed."""
    s = "".join(c for c in s if unicodedata.category(c) != "Co")
    return " ".join(s.split())[:80]


def hits(layers: list, width: float) -> list[list]:
    """[label, x, y, w, h] in design units: texts inside a button-sized group first (their tap area: the tallest
    ancestor group no taller than TAP_H, so "Tìm căn hộ" covers its whole button), then bare texts (a title), then
    small named groups (designers name buttons: "Back_Nav"); each in reading order. The page matches a button's
    label against these, first match wins: the button beats a nav title of the same words."""
    texts: list[list] = []
    groups: list[list] = []

    def rect(layer: dict) -> list[float]:
        r = layer.get("rect") or {}
        a = r.get("absolute") or {}
        return [round(v, 1) for v in (a.get("x", 0), a.get("y", 0), r.get("width", 0), r.get("height", 0))]

    def walk(ls: list, chain: list[list[float]]) -> None:
        for layer in ls:
            if not isinstance(layer, dict):
                continue
            r = rect(layer)
            if layer.get("type") == "text" and (label := _text(layer.get("content") or layer.get("name") or "")):
                tap = r
                for a in reversed(chain):
                    if a[3] > TAP_H or a[2] >= width:
                        break
                    # Sketch exports leave stale group frames (a row's group far below its own text): only a
                    # group that really holds the text is its tap area
                    if a[0] <= r[0] + 1 and a[1] <= r[1] + 1 and a[0] + a[2] >= r[0] + r[2] - 1 \
                            and a[1] + a[3] >= r[1] + r[3] - 1:
                        tap = a
                texts.append([label, *tap, tap is r])
            elif layer.get("type") == "group" and 0 < r[3] <= TAP_H and (label := _text(layer.get("name") or "")):
                groups.append([label, *r])
            walk(layer.get("layers") or [], [*chain, r])

    walk(layers, [])
    seen: set[tuple] = set()
    out = []
    for h in [t[:5] for t in sorted(texts, key=lambda h: (h[5], h[2], h[1]))] + sorted(
        groups, key=lambda h: (h[2], h[1])
    ):
        if (k := tuple(h)) not in seen:
            seen.add(k)
            out.append(h)
    return out[:MAX_HITS]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("đ", "d")
    return " ".join(re.sub(r"[\W_]+", " ", s).split())


def unplaced(labels: list[str], hits: list[list]) -> list[int]:
    """Indexes of the labels the page finds no hit for. The same tiers as hotspots() in
    web/src/features/youtrack/flow-engine/shots.js (each hit used once): change both together."""
    ns, used, out = [_norm(str(h[0])) for h in hits], set(), []
    tiers = (
        lambda x, n: x == n,
        lambda x, n: x.startswith(n + " ") and len(x) <= 3 * len(n),
        lambda x, n: n in x and len(x) <= 2 * len(n),
        lambda x, n: len(x) >= 3 and x in n,
    )
    for i, label in enumerate(labels):
        n = _norm(label)
        j = next((j for t, ok in enumerate(tiers) if n and (t == 0 or len(n) >= 3)
                  for j, x in enumerate(ns) if j not in used and ok(x, n)), None)  # fmt: skip
        if j is None:
            out.append(i)
        else:
            used.add(j)
    return out


def texts(layers: list) -> list[str]:
    """Every text shown on the screen, top to bottom, once each: what the AI names buttons from (a few hundred bytes,
    where the MCP's get_screen returns 100-200 KB of layers)."""
    found: list[tuple[float, float, str]] = []

    def walk(ls: list) -> None:
        for layer in ls:
            if not isinstance(layer, dict):
                continue
            if layer.get("type") == "text" and (label := _text(layer.get("content") or "")):
                a = (layer.get("rect") or {}).get("absolute") or {}
                found.append((a.get("y", 0), a.get("x", 0), label))
            walk(layer.get("layers") or [])

    walk(layers)
    return list(dict.fromkeys(t for *_, t in sorted(found)))[:MAX_HITS]


def shot(version: dict, name: str = "") -> dict:
    """A screen version as the page draws it (image URL, design size, hits) and its texts for the AI. `name`: the
    screen's own (a version carries none), what "+ Từ Zeplin" names the new screen."""
    w = float(version.get("width") or 0)
    thumbs = version.get("thumbnails") or {}
    layers = version.get("layers") or []
    return {
        "title": str(name or "")[:200], "ver": str(version.get("id") or "")[:40],
        "src": thumbs.get("medium") or version.get("image_url") or "", "w": w,
        "h": float(version.get("height") or 0), "hits": hits(layers, w), "texts": texts(layers),
    }


async def resolve(url: str) -> str:
    """Where a zpl.io short link points ("" when it is not one, or points nowhere). Its own plain request: zpl.io
    answers a JSON-accepting client with 200 {"url": ...} instead of the redirect, and it has no use for the token."""
    u = urlsplit(url)
    if u.scheme != "https" or u.hostname != "zpl.io":
        return ""
    async with httpx.AsyncClient(timeout=10.0) as c:
        r = await c.get(url, follow_redirects=False)
    loc = r.headers.get("location") or ""
    if not loc and r.headers.get("content-type", "").startswith("application/json"):
        try:
            loc = str(r.json().get("url") or "")
        except (ValueError, AttributeError):
            loc = ""
    return loc


def canonical(url: str) -> str:
    """A Zeplin link as written in a ticket (markdown / JSON leave ")" or "\\n" on it): its screen URL, or the link."""
    if m := SCREEN.search(url):
        return f"https://app.zeplin.io/project/{m[1]}/screen/{m[2]}"
    m = re.match(r"https?://[A-Za-z0-9._~:/?#@!$&*+=%-]+", url)
    return m[0].rstrip(".,:;") if m else url


class Shots:
    def __init__(self, *, scope=lambda: "", path=lambda: None) -> None:
        self._scope = scope
        self._identity = None
        # every screen as last read, kept in a file (path(): None = not kept): an opened flow draws from it at once
        # while the live read (6-7 s for 20 screens after a restart) goes on behind
        self._path, self._kept, self._owner, self._write = path, None, "", asyncio.Lock()
        self._cache: OrderedDict[str, tuple[float, dict | None]] = OrderedDict()
        self._inflight: dict[tuple, asyncio.Task] = {}
        self._sem = asyncio.Semaphore(PARALLEL)

    async def aclose(self) -> None:
        tasks = list(self._inflight.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._inflight.clear()
        self._cache.clear()

    def _identify(self, tok: str) -> tuple:
        identity = (self._scope(), repr(provider_cmds.zeplin_server()), tok)
        if identity != self._identity:
            self._identity = identity
            self._cache.clear()
        return identity

    async def _last(self, identity: tuple) -> dict[str, dict]:
        """The kept reads of this account (the file names its owner by a hash: never the token)."""
        owner = hashlib.sha256(repr(identity).encode()).hexdigest()[:16]
        if self._kept is None or owner != self._owner:
            shots = None
            if path := self._path():
                try:
                    data = json.loads(await asyncio.to_thread(path.read_text))
                    shots = data["shots"] if data["owner"] == owner else None
                except OSError, ValueError, KeyError, TypeError:  # no file yet, or not ours: nothing kept
                    shots = None
            self._owner, self._kept = owner, shots if isinstance(shots, dict) else {}
        return self._kept

    async def last(self, urls: list[str]) -> dict[str, dict] | None:
        """Every one of `urls` as it was last read, with no call to Zeplin. None when there is nothing older to
        show first: all of them are fresh in memory (get() answers at once), one was never read, or no token."""
        tok = token()
        if not tok:
            return None
        identity, now = self._identify(tok), time.monotonic()
        wanted = {u: canonical(u) for u in urls}
        if all((c := self._cache.get(k)) and now - c[0] <= TTL for k in wanted.values()):
            return None
        kept = await self._last(identity)
        have = {u: (self._cache.get(k) or (0, None))[1] or kept.get(k) for u, k in wanted.items()}
        return have if all(have.values()) else None

    async def _keep(self, identity: tuple, read: dict[str, dict | None]) -> None:
        path = self._path()
        if not path or identity != self._identity:
            return
        kept = await self._last(identity)
        for url, value in read.items():
            kept.pop(url, None)  # read again: newest last; a screen that is gone leaves the file
            if value:
                kept[url] = value
        while len(kept) > 512:
            kept.pop(next(iter(kept)))
        try:
            async with self._write:
                await asyncio.to_thread(write_private_json, path, {"owner": self._owner, "shots": kept})
        except OSError as e:  # disk full, no permission: the read itself is fine, only the next cold open is slower
            log.warning("Zeplin shots not kept: %s", type(e).__name__)

    async def get(self, urls: list[str], *, done=None) -> tuple[dict[str, dict], list[str]]:
        """Read canonical screens once across callers; cancelling a reader leaves other readers intact."""
        tok = token()
        identity = self._identify(tok)
        if not tok:
            raise ZeplinError("Chưa cấu hình Zeplin MCP (cần ZEPLIN_ACCESS_TOKEN) — UI flow vẽ khung đơn giản")
        wanted = list(dict.fromkeys(canonical(u) for u in urls))
        now = time.monotonic()
        warm = {u: c[1] for u in wanted if (c := self._cache.get(u)) and now - c[0] <= TTL}
        from .ai_run import flow_metrics
        metrics = flow_metrics.get()
        if metrics is not None:
            metrics["cache_hits"] = len(warm)
            metrics["cache_misses"] = len(wanted) - len(warm)

        async def read(url: str):
            async with self._sem:
                headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
                async with httpx.AsyncClient(base_url=API, headers=headers, timeout=20.0) as c:
                    value = await self._read(c, url)
            if self._identity == identity:
                self._cache[url] = (time.monotonic(), value)
                self._cache.move_to_end(url)
                while len(self._cache) > 512:
                    self._cache.popitem(last=False)
            return value

        async def one(url: str):
            if url in warm:
                value = warm[url]
                if identity == self._identity and url in self._cache:
                    self._cache.move_to_end(url)
            else:
                key = (identity, url)
                task = self._inflight.get(key)
                if task is None:
                    task = asyncio.create_task(read(url))
                    self._inflight[key] = task

                    def finished(task):
                        self._inflight.pop(key, None)
                        if not task.cancelled():
                            task.exception()  # consume errors even if every subscriber left

                    task.add_done_callback(finished)
                value = await asyncio.shield(task)
            if done:
                done(1)
            return url, value

        got = dict(await asyncio.gather(*(one(u) for u in wanted)))
        if len(warm) < len(wanted):
            await self._keep(identity, {u: v for u, v in got.items() if u not in warm})
        return {u: got[canonical(u)] for u in urls if got[canonical(u)]}, [u for u in urls if not got[canonical(u)]]

    @staticmethod
    async def _read(c: httpx.AsyncClient, url: str) -> dict | None:
        from .ai_run import flow_metrics
        metrics = flow_metrics.get()

        def measured(response):
            if metrics is not None:
                metrics["requests"] = metrics.get("requests", 0) + 1
                metrics["response_bytes"] = metrics.get("response_bytes", 0) + len(response.content)
            return response

        try:
            m = SCREEN.search(url) or SCREEN.search(await resolve(url))  # a short link: where it points
            if not m:
                return None  # a component / styleguide link: no screen to draw
            path = f"/projects/{m[1]}/screens/{m[2]}"
            r, named = await asyncio.gather(c.get(f"{path}/versions/latest"), c.get(path), return_exceptions=True)
            if isinstance(r, BaseException):
                raise r
            measured(r)
        except httpx.HTTPError as e:
            raise ZeplinError("Không kết nối được Zeplin") from e
        if r.status_code == 401:
            raise ZeplinError("Token Zeplin bị từ chối (hết hạn?) — cập nhật ZEPLIN_ACCESS_TOKEN của Zeplin MCP")
        if r.status_code in (403, 404):
            return None  # not shared with this account, or deleted
        if r.status_code >= 400:
            raise ZeplinError(f"Zeplin trả lỗi {r.status_code}")
        # the name is a nicety (the new screen's title): its read failing never fails the screen
        name = ""
        if isinstance(named, httpx.Response) and measured(named).status_code == 200:
            with contextlib.suppress(ValueError, AttributeError):
                name = str(named.json().get("name") or "")
        return shot(r.json(), name)


def _image_host(url: str) -> bool:
    u = urlsplit(url)
    return u.scheme == "https" and u.hostname in IMAGE_HOSTS


async def image(url: str) -> tuple[bytes, str]:
    """A screen image (a signed Zeplin URL), for the page to compress into the file: Zeplin's redirect answers
    without CORS, so the page cannot read it into a canvas itself. Only Zeplin's image hosts, redirects included."""
    if not _image_host(url):
        raise ZeplinError("Không phải ảnh Zeplin")
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            for _ in range(3):
                async with c.stream("GET", url) as r:
                    if r.is_redirect:
                        target = str(r.next_request.url if r.next_request else "")
                        if not _image_host(target):
                            raise ZeplinError("Không phải ảnh Zeplin")
                        url = target
                        continue
                    kind = r.headers.get("content-type", "")
                    if r.status_code != 200 or not kind.startswith("image/"):
                        raise ZeplinError(f"Ảnh Zeplin không tải được ({r.status_code})")
                    data = bytearray()
                    async for chunk in r.aiter_bytes(chunk_size=64 << 10):
                        if len(data) + len(chunk) > MAX_IMAGE:
                            raise ZeplinError("Ảnh Zeplin quá lớn")
                        data.extend(chunk)
                    return bytes(data), kind
            raise ZeplinError("Ảnh Zeplin chuyển hướng quá nhiều")
    except httpx.HTTPError as e:
        raise ZeplinError("Không tải được ảnh Zeplin") from e
