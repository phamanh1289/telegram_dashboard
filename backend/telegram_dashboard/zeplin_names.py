"""Zeplin screens by name (Tài liệu: a screen named in a document, "Banv2-CNY 23 A1", opens its design): every project
the token's account sees and its screens' names and images, read once an hour, with the token of the user's own zeplin
MCP server (zeplin.token). No AI. Errors are ZeplinError with a code: no_token / token_refused / unreachable."""

import asyncio
import hashlib
import re
import time
import unicodedata

import httpx

from . import zeplin

PAGE = 100  # Zeplin's largest page
MAX_PROJECTS = 60  # ponytail: an account with more reads its first 60; a project filter when someone has that many
MATCHES = 12


def _norm(s: str) -> str:
    """A name as compared: accent-less, case-less, spaces and dashes evened ("Banv2 – CNY  23" = "banv2-cny 23")."""
    s = unicodedata.normalize("NFD", s.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\s*[-–—]\s*", "-", s)  # "Banv2 – CNY" = "banv2-cny"
    return " ".join(s.split())


async def _pages(c: httpx.AsyncClient, path: str) -> list[dict]:
    out: list[dict] = []
    while True:
        r = await c.get(path, params={"limit": PAGE, "offset": len(out)})
        if r.status_code == 401:
            raise zeplin.ZeplinError("token_refused")
        if r.status_code in (403, 404):
            return out  # a project not shared any more: no screens
        if r.status_code >= 400:
            raise zeplin.ZeplinError("unreachable")
        rows = r.json()
        out += rows if isinstance(rows, list) else []
        if not isinstance(rows, list) or len(rows) < PAGE:
            return out


def _row(p: dict, s: dict) -> dict:
    img = s.get("image") or {}
    thumbs = img.get("thumbnails") or {}
    src = thumbs.get("large") or thumbs.get("medium") or img.get("original_url") or ""
    return {
        "project": str(p.get("id") or ""), "project_name": str(p.get("name") or ""),
        "platform": str(p.get("platform") or ""), "id": str(s.get("id") or ""), "name": str(s.get("name") or ""),
        "image": src if zeplin._image_host(src) else "",  # only Zeplin's own image hosts reach the page
        "w": img.get("width") or 0, "h": img.get("height") or 0,
    }  # fmt: skip


class ScreenNames:
    def __init__(self) -> None:
        self._rows: list[dict] = []
        self._key, self._at = "", 0.0
        self._lock = asyncio.Lock()

    async def _load(self, tok: str) -> list[dict]:
        headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
        sem = asyncio.Semaphore(zeplin.PARALLEL)  # Zeplin allows ~200 calls a minute
        try:
            async with httpx.AsyncClient(base_url=zeplin.API, headers=headers, timeout=20.0) as c:
                projects = [p for p in await _pages(c, "/projects") if p.get("status") != "deleted"][:MAX_PROJECTS]

                async def screens(p: dict) -> list[dict]:
                    async with sem:
                        return [_row(p, s) for s in await _pages(c, f"/projects/{p.get('id')}/screens")]

                return [r for rows in await asyncio.gather(*(screens(p) for p in projects)) for r in rows]
        except httpx.HTTPError as e:
            raise zeplin.ZeplinError("unreachable") from e

    async def rows(self) -> list[dict]:
        tok = zeplin.token()
        if not tok:
            raise zeplin.ZeplinError("no_token")
        key = hashlib.sha256(tok.encode()).hexdigest()  # another account: read again
        async with self._lock:  # one read at a time; the others wait for it
            if key != self._key or time.monotonic() - self._at > zeplin.TTL:
                self._rows, self._key, self._at = await self._load(tok), key, time.monotonic()
            return self._rows

    async def find(self, name: str) -> list[dict]:
        """The screens named `name`: the same name first, then names holding it, shortest first."""
        q = _norm(name)
        if not q:
            return []
        hits = [(_norm(r["name"]), r) for r in await self.rows()]
        same = [r for n, r in hits if n == q]
        near = sorted((r for n, r in hits if n != q and q in n), key=lambda r: len(r["name"]))
        return (same + near)[:MATCHES]


NAMES = ScreenNames()
