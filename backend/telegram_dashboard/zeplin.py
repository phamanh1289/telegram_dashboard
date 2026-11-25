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
from collections import Counter, OrderedDict
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
PHONE_DP, PHONE_SLACK = 375, 0.2  # a phone design's width at @1x, give or take: 300-450 (360, 375, 390, 414, 430)
PHONE, WINDOW, TALL = 844 / 390, 800 / 1280, 1.1  # a frame's height per width: = FRAMES / TALL in constants.js
LIST_MIN, LIST_TOL = 3, 4  # items that make a list; design units two of them may differ by


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


def _lines(content: str) -> list[str]:
    """Each line of a multi-line text ("Căn hộ\nXác minh nhanh…": a card's title over its subtitle) as read; [] for
    one line."""
    out = [t for ln in content.splitlines() if (t := _text(ln))]
    return out if len(out) > 1 else []


def _rect(layer: dict) -> list[float]:
    r = layer.get("rect") or {}
    a = r.get("absolute") or {}
    return [round(v, 1) for v in (a.get("x", 0), a.get("y", 0), r.get("width", 0), r.get("height", 0))]


def _layers(layers: list, chain: tuple = ()):
    """Every layer, depth first: (layer, its box, the boxes of the groups it sits in, outermost first)."""
    for layer in layers:
        if isinstance(layer, dict):
            r = _rect(layer)
            yield layer, r, chain
            yield from _layers(layer.get("layers") or [], (*chain, r))


def _tap(r: list[float], chain: tuple, width: float) -> list[float]:
    """A text's tap area: the tallest ancestor group up to TAP_H that really holds it (Sketch exports leave stale
    group frames, a row's group far below its own text), else the text itself."""
    tap = r
    for a in reversed(chain):
        if a[3] > TAP_H or a[2] >= width:
            break
        if a[0] <= r[0] + 1 and a[1] <= r[1] + 1 and a[0] + a[2] >= r[0] + r[2] - 1 and a[1] + a[3] >= r[1] + r[3] - 1:
            tap = a
    return tap


def _once(rows: list[list]) -> list[list]:
    """Each row once, in order, at most MAX_HITS."""
    seen: set[tuple] = set()
    out = []
    for h in rows:
        if (k := tuple(h)) not in seen:
            seen.add(k)
            out.append(h)
    return out[:MAX_HITS]


def hits(layers: list, width: float) -> list[list]:
    """[label, x, y, w, h] in design units: texts inside a button-sized group first (their tap area: _tap, so "Tìm
    căn hộ" covers its whole button), then bare texts (a title), then small named groups (designers name buttons:
    "Back_Nav"); each in reading order. The page matches a button's label against these, first match wins: the
    button beats a nav title of the same words. Also the design's signature (flow.design_of): what lines() adds
    stays out of it."""
    texts: list[list] = []
    groups: list[list] = []
    for layer, r, chain in _layers(layers):
        if layer.get("type") == "text" and (label := _text(layer.get("content") or layer.get("name") or "")):
            tap = _tap(r, chain, width)
            texts.append([label, *tap, tap is r])
        elif layer.get("type") == "group" and 0 < r[3] <= TAP_H and (label := _text(layer.get("name") or "")):
            groups.append([label, *r])
    ordered = [t[:5] for t in sorted(texts, key=lambda h: (h[5], h[2], h[1]))]
    return _once(ordered + sorted(groups, key=lambda h: (h[2], h[1])))


def lines(layers: list, width: float) -> list[list]:
    """[line, x, y, w, h]: each line of a multi-line text over its tap area, in reading order. A card's title over
    its subtitle in one layer ("Căn hộ\nXác minh nhanh…") is too long as a whole to match the button named by its
    title. Matched after hits(), so a wrapped label ("Giá trung\nbình") is still found whole."""
    out = [[ln, *_tap(r, chain, width)] for layer, r, chain in _layers(layers) if layer.get("type") == "text"
           for ln in _lines(str(layer.get("content") or ""))]  # fmt: skip
    return _once(sorted(out, key=lambda h: (h[2], h[1])))


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("đ", "d")
    return " ".join(re.sub(r"[\W_]+", " ", s).split())


def unplaced(labels: list[str], hits: list[list]) -> list[int]:
    """Indexes of the labels the page finds no hit for (`hits`: a shot's hits, then its lines). The same tiers as
    hotspots() in web/src/features/youtrack/flow-engine/shots.js (each hit used once): change both together."""
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
    where the MCP's get_screen returns 100-200 KB of layers). A multi-line text gives its first line: a card's
    title, not its subtitle (the button's name; lines() finds it on the design)."""
    found: list[tuple[float, float, str]] = []
    for layer, _, _ in _layers(layers):
        content = layer.get("content") or ""
        if layer.get("type") == "text" and (label := (_lines(content) or [_text(content)])[0]):
            a = (layer.get("rect") or {}).get("absolute") or {}
            found.append((a.get("y", 0), a.get("x", 0), label))
    return list(dict.fromkeys(t for *_, t in sorted(found)))[:MAX_HITS]


def phone_wide(shot: dict) -> bool:
    """A screen as wide as a phone, whatever its project is set to: Zeplin projects marked "web" hold phone designs
    ("[Agent] Bán [Mo]": 375 wide, platform web). `dp` is the width at @1x; a read kept before it has only `w`."""
    return abs((shot.get("dp") or shot.get("w") or 0) - PHONE_DP) <= PHONE_DP * PHONE_SLACK


def column(layers: list, width: float) -> list[tuple[float, float]]:
    """The longest list on the screen, as (y, height) of its items top to bottom ([]: none): LIST_MIN or more sibling
    groups one under another, same left edge and width (half the screen's or more), evenly spaced, built alike.
    By geometry, never by name: designers leave "Card 1 Copy 7". ponytail: a list whose rows are not groups of
    their own (flattened) is not seen; neither is a grid's second column."""
    best: list[tuple[float, float]] = []

    def box(layer: dict) -> tuple[float, float, float, float]:
        r = layer.get("rect") or {}
        a = r.get("absolute") or {}
        return a.get("x", 0), a.get("y", 0), r.get("width", 0), r.get("height", 0)

    def kinds(layer: dict) -> Counter:  # what it is built of: the texts differ from item to item, the build does not
        out: Counter = Counter()
        for k in layer.get("layers") or []:
            if isinstance(k, dict):
                out[k.get("type")] += 1
                out += kinds(k)
        return out

    def walk(ls: list) -> None:
        nonlocal best
        kids = [k for k in ls if isinstance(k, dict)]
        items = sorted(((box(k), kinds(k)) for k in kids if k.get("type") == "group" and k.get("layers")),
                       key=lambda it: it[0][1])  # fmt: skip
        run: list = []
        for it in [*(i for i in items if i[0][2] >= width / 2), None]:
            if it and run:
                (x, y, w, _), (px, py, pw, ph) = it[0], run[-1][0]
                gap = y - py - ph
                alike = sum((it[1] & run[-1][1]).values()) >= 0.8 * max(1, sum((it[1] | run[-1][1]).values()))
                even = len(run) < 2 or abs(gap - (run[1][0][1] - run[0][0][1] - run[0][0][3])) <= LIST_TOL
                if abs(x - px) <= LIST_TOL and abs(w - pw) <= LIST_TOL and gap >= -LIST_TOL and alike and even:
                    run.append(it)
                    continue
            if len(run) >= LIST_MIN and (not best or run[-1][0][1] - run[0][0][1] > best[-1][0] - best[0][0]):
                best = [(r[1], r[3]) for r, _ in run]
            run = [it]
        for k in kids:
            walk(k.get("layers") or [])

    walk(layers)
    return best


def fold_at(items: list[tuple[float, float]], w: float, h: float, phone: bool) -> float:
    """Where to fold a long list (`items`: column()) on the map, as the part of the design shown (0..1; 0: no list,
    or little to cut): after the items that fit one screenful (at least one), half-way to the next. The rest repeats
    them."""
    page = w * (PHONE if phone else WINDOW)
    fit = sum(1 for y, ih in items if y + ih <= page * TALL) or 1
    if fit >= len(items):
        return 0.0
    (y, ih), below = items[fit - 1], items[fit][0]
    cut = y + ih + max(0.0, below - y - ih) / 2
    return round(cut / h, 4) if h - cut >= page / 2 else 0.0  # hiding less than half a screenful is not worth a fold


def shot(version: dict, name: str = "", platform: str = "") -> dict:
    """A screen version as the page draws it (image URL, design size, hits) and its texts for the AI. `name`: the
    screen's own (a version carries none), what "+ Từ Zeplin" names the new screen. `platform`: its project's, as
    Zeplin has it (web / ios / android / macos; "" when unread), and `dp`: its width at @1x (a 1125 px design at @3x
    is 375): which screens a mobile / web render leaves out. `cut`: where a long list folds (fold_at); `list`: its
    items (0: none), which the AI is told (flow_prompt.build)."""
    w, h = float(version.get("width") or 0), float(version.get("height") or 0)
    dp = w / (float(version.get("density_scale") or 0) or 1)
    thumbs = version.get("thumbnails") or {}
    layers = version.get("layers") or []
    items = column(layers, w)
    return {
        "title": str(name or "")[:200], "ver": str(version.get("id") or "")[:40],
        "src": thumbs.get("medium") or version.get("image_url") or "", "w": w,
        "h": h, "hits": hits(layers, w), "lines": lines(layers, w), "texts": texts(layers),
        "platform": platform, "dp": dp, "cut": fold_at(items, w, h, phone_wide({"dp": dp})), "list": len(items),
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
        self._at: dict[str, float] = {}  # url -> when it was read (wall clock: outlives a restart, unlike the cache)
        self._cache: OrderedDict[str, tuple[float, dict | None]] = OrderedDict()
        self._platforms: dict[str, str] = {}  # project id -> its platform: read once per project, not per screen
        self._inflight: dict[tuple, asyncio.Task] = {}
        self._sem = asyncio.Semaphore(PARALLEL)
        # one connection pool per token, not a TLS handshake per screen; an old token's stays open for its reads
        # still in flight. ponytail: closed only in aclose(), a token change is rare
        self._clients: dict[str, httpx.AsyncClient] = {}

    async def aclose(self) -> None:
        tasks = list(self._inflight.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._inflight.clear()
        self._cache.clear()
        self._platforms.clear()
        clients, self._clients = list(self._clients.values()), {}
        await asyncio.gather(*(c.aclose() for c in clients), return_exceptions=True)

    def _client(self, tok: str) -> httpx.AsyncClient:
        if (c := self._clients.get(tok)) is None or c.is_closed:
            headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
            c = self._clients[tok] = httpx.AsyncClient(base_url=API, headers=headers, timeout=20.0)
        return c

    def _identify(self, tok: str) -> tuple:
        identity = (self._scope(), repr(provider_cmds.zeplin_server()), tok)
        if identity != self._identity:
            self._identity = identity
            self._cache.clear()
            self._platforms.clear()
        return identity

    async def _last(self, identity: tuple) -> dict[str, dict]:
        """The kept reads of this account (the file names its owner by a hash: never the token)."""
        owner = hashlib.sha256(repr(identity).encode()).hexdigest()[:16]
        if self._kept is None or owner != self._owner:
            shots, at = None, {}
            if path := self._path():
                try:
                    data = json.loads(await asyncio.to_thread(path.read_text))
                    shots = data["shots"] if data["owner"] == owner else None
                    at = data.get("at") if shots is not None and isinstance(data.get("at"), dict) else {}
                except OSError, ValueError, KeyError, TypeError, AttributeError:  # no file yet, or not ours
                    shots = None
            self._owner, self._kept = owner, shots if isinstance(shots, dict) else {}
            self._at = {u: t for u, t in at.items() if isinstance(t, int | float) and u in self._kept}
            # a read kept less than TTL ago is as good as one in memory: a restart (an update, a reload) does not
            # make every screen of an opened flow be read from Zeplin again. Kept by an older version (no `cut`):
            # read again, as last() says
            mono, wall = time.monotonic(), time.time()
            if identity == self._identity:
                for u, t in self._at.items():
                    v = self._kept[u]
                    if 0 <= wall - t <= TTL and isinstance(v, dict) and "cut" in v and u not in self._cache:
                        self._cache[u] = (mono - (wall - t), v)
        return self._kept

    async def last(self, urls: list[str]) -> dict[str, dict] | None:
        """Every one of `urls` as it was last read, with no call to Zeplin. None when there is nothing older to
        show first: all of them are fresh in memory (get() answers at once), one was never read, or no token, or one
        was kept by an older version (no `cut` / `dp` / `platform`: the page waits for the live read rather than fold
        and sort by a read that lacks them)."""
        tok = token()
        if not tok:
            return None
        identity = self._identify(tok)
        wanted = {u: canonical(u) for u in urls}
        kept = await self._last(identity)  # first: it brings the reads kept less than TTL ago back into the cache
        now = time.monotonic()
        if all((c := self._cache.get(k)) and now - c[0] <= TTL for k in wanted.values()):
            return None
        have = {u: (self._cache.get(k) or (0, None))[1] or kept.get(k) for u, k in wanted.items()}
        return have if all(v and "cut" in v for v in have.values()) else None

    async def _keep(self, identity: tuple, read: dict[str, dict | None]) -> None:
        path = self._path()
        if not path or identity != self._identity:
            return
        kept, wall = await self._last(identity), time.time()
        owner = self._owner
        for url, value in read.items():
            kept.pop(url, None)  # read again: newest last; a screen that is gone leaves the file
            self._at.pop(url, None)
            if value:
                kept[url], self._at[url] = value, wall
        while len(kept) > 512:
            self._at.pop(gone := next(iter(kept)), None)
            kept.pop(gone)
        try:
            async with self._write:
                if identity != self._identity or kept is not self._kept or owner != self._owner:
                    return  # the account changed while waiting: these are the old account's reads
                # a copy taken here, in the loop: the thread encodes it while another _keep may change the dicts
                data = {"owner": owner, "shots": dict(kept), "at": dict(self._at)}
                await asyncio.to_thread(write_private_json, path, data)
        except OSError as e:  # disk full, no permission: the read itself is fine, only the next cold open is slower
            log.warning("Zeplin shots not kept: %s", type(e).__name__)

    async def get(self, urls: list[str], *, done=None) -> tuple[dict[str, dict], list[str]]:
        """Read canonical screens once across callers; cancelling a reader leaves other readers intact."""
        tok = token()
        identity = self._identify(tok)
        if not tok:
            raise ZeplinError("Chưa cấu hình Zeplin MCP (cần ZEPLIN_ACCESS_TOKEN) — UI flow vẽ khung đơn giản")
        wanted = list(dict.fromkeys(canonical(u) for u in urls))
        await self._last(identity)  # reads kept less than TTL ago (before a restart) count as warm
        now = time.monotonic()
        warm = {u: c[1] for u in wanted if (c := self._cache.get(u)) and now - c[0] <= TTL}
        from .ai_run import flow_metrics
        metrics = flow_metrics.get()
        if metrics is not None:
            metrics["cache_hits"] = len(warm)
            metrics["cache_misses"] = len(wanted) - len(warm)

        async def read(url: str):
            async with self._sem:
                value = await self._read(self._client(tok), url)
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

    async def _read(self, c: httpx.AsyncClient, url: str) -> dict | None:
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
            calls = [c.get(f"{path}/versions/latest"), c.get(path)]
            if m[1] not in self._platforms:  # ponytail: the first PARALLEL screens of a project may each ask
                calls.append(c.get(f"/projects/{m[1]}"))
            r, named, *project = await asyncio.gather(*calls, return_exceptions=True)
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
        # so is the platform: unread, the render tells web from mobile by the design size (flow_prompt.risks)
        if project and isinstance(project[0], httpx.Response) and measured(project[0]).status_code == 200:
            with contextlib.suppress(ValueError, AttributeError):
                self._platforms[m[1]] = str(project[0].json().get("platform") or "")[:20]
        return shot(r.json(), name, self._platforms.get(m[1], ""))


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
