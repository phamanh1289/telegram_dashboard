"""Zeplin screens for the UI flow: each screen's image and where its texts / buttons sit, read with the token of the
user's own zeplin MCP server (providers.zeplin_server). No AI: one REST call per screen, cached."""

import asyncio
import re
import time
import unicodedata
from urllib.parse import urlsplit

import httpx

from . import providers

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
    return providers.mcp_env(providers.zeplin_server()).get("ZEPLIN_ACCESS_TOKEN", "")


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


def shot(version: dict) -> dict:
    """A screen version as the page draws it (image URL, design size, hits) and its texts for the AI."""
    w = float(version.get("width") or 0)
    thumbs = version.get("thumbnails") or {}
    layers = version.get("layers") or []
    return {"src": thumbs.get("medium") or version.get("image_url") or "", "w": w,
            "h": float(version.get("height") or 0), "hits": hits(layers, w), "texts": texts(layers)}  # fmt: skip


def canonical(url: str) -> str:
    """A Zeplin link as written in a ticket (markdown / JSON leave ")" or "\\n" on it): its screen URL, or the link."""
    if m := SCREEN.search(url):
        return f"https://app.zeplin.io/project/{m[1]}/screen/{m[2]}"
    m = re.match(r"https?://[A-Za-z0-9._~:/?#@!$&*+=%-]+", url)
    return m[0].rstrip(".,:;") if m else url


class Shots:
    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, dict | None]] = {}  # url -> (when, shot | None: no such screen)

    async def get(self, urls: list[str], *, done=None) -> tuple[dict[str, dict], list[str]]:
        """({url: shot}, urls with no screen behind them). ZeplinError when nothing can be read at all.
        `done(k)` as screens are ready: the cached ones at once, then each one read from Zeplin."""
        tok = token()
        if not tok:
            raise ZeplinError("Chưa cấu hình Zeplin MCP (cần ZEPLIN_ACCESS_TOKEN) — UI flow vẽ khung đơn giản")
        now = time.monotonic()
        wanted = list(dict.fromkeys(urls))
        todo = [u for u in wanted if not (c := self._cache.get(u)) or now - c[0] > TTL]
        if done and len(wanted) > len(todo):
            done(len(wanted) - len(todo))
        if todo:
            sem = asyncio.Semaphore(PARALLEL)
            headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
            async with httpx.AsyncClient(base_url=API, headers=headers, timeout=20.0) as c:

                async def one(url: str) -> None:
                    async with sem:
                        self._cache[url] = (time.monotonic(), await self._read(c, url))
                    if done:
                        done(1)

                try:  # the first error stops the other reads before the client closes under them
                    async with asyncio.TaskGroup() as g:
                        for u in todo:
                            g.create_task(one(u))
                except ExceptionGroup as eg:
                    raise eg.exceptions[0] from None
        got = {u: self._cache[u][1] for u in urls if u in self._cache}
        return {u: s for u, s in got.items() if s}, [u for u in wanted if not got.get(u)]

    @staticmethod
    async def _read(c: httpx.AsyncClient, url: str) -> dict | None:
        try:
            m = SCREEN.search(url)
            if not m and "zpl.io/" in url:  # a short link: where it points
                loc = (await c.get(url, follow_redirects=False)).headers.get("location") or ""
                m = SCREEN.search(loc)
            if not m:
                return None  # a component / styleguide link: no screen to draw
            r = await c.get(f"/projects/{m[1]}/screens/{m[2]}/versions/latest")
        except httpx.HTTPError as e:
            raise ZeplinError("Không kết nối được Zeplin") from e
        if r.status_code == 401:
            raise ZeplinError("Token Zeplin bị từ chối (hết hạn?) — cập nhật ZEPLIN_ACCESS_TOKEN của Zeplin MCP")
        if r.status_code in (403, 404):
            return None  # not shared with this account, or deleted
        if r.status_code >= 400:
            raise ZeplinError(f"Zeplin trả lỗi {r.status_code}")
        return shot(r.json())


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
                r = await c.get(url)
                if r.is_redirect and _image_host(url := str(r.next_request.url if r.next_request else "")):
                    continue
                break
    except httpx.HTTPError as e:
        raise ZeplinError("Không tải được ảnh Zeplin") from e
    kind = r.headers.get("content-type", "")
    if r.status_code != 200 or not kind.startswith("image/") or len(r.content) > MAX_IMAGE:
        raise ZeplinError(f"Ảnh Zeplin không tải được ({r.status_code})")
    return r.content, kind
