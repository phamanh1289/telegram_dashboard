"""A document's mentions, at its foot like YouTrack's "Items mentioned here" / "Inward mentions".

Out: the tickets (`tickets` column, kept to the server's projects: "UTF-8" is no ticket) and Knowledge Base articles its
text names, titled from the library, else YouTrack. In (Knowledge Base articles only): the tickets naming it (YQL
`mentions: REF`) and the articles whose text holds its ID (article search `"REF"`, the article itself dropped).
Read on each open of the foot (no cache of our own: the client's TTL cache covers the projects)."""

import asyncio
import re

from ..youtrack.client import YtError, _projects, pages
from .models import DocMention, DocMentions

ARTICLE = re.compile(r"(?<![\w-])([A-Z][A-Z0-9]*-A-\d+)(?!\w)")
ISSUE = "idReadable,summary,resolved"
CHUNK = 100  # tickets a search
MAX = 200  # of each kind: a changelog naming thousands is cut, never a hundred searches
AT_ONCE = 8  # article reads in flight for one foot (up to MAX of them)


def _issue(a: dict) -> DocMention:
    return DocMention(ref=a["idReadable"], title=a.get("summary") or "", kind="issue", resolved=bool(a.get("resolved")))


async def _issues(yt, ids: list[str]) -> list[DocMention]:
    async def chunk(part: list[str]) -> list[dict]:
        return await yt.yt("/api/issues", query="issue id: " + ", ".join(part), fields=ISSUE, **{"$top": len(part)})

    got = {a["idReadable"]: a for rows in await asyncio.gather(*(chunk(ids[n : n + CHUNK])
                                                                   for n in range(0, len(ids), CHUNK)))
           for a in rows if a.get("idReadable")}  # fmt: skip
    # one deleted / hidden stays, untitled: the text still names it
    return [_issue(got[i]) if i in got else DocMention(ref=i, title="", kind="issue") for i in ids]


async def _articles(s, refs: list[str]) -> list[DocMention]:
    gate = asyncio.Semaphore(AT_ONCE)

    async def one(ref: str) -> DocMention:
        d = await s.db.read(s.store.doc_find, "yt_article", ref)
        if d:
            return DocMention(ref=ref, title=d["title"], kind="article", doc=d["id"])
        try:
            async with gate:
                a = await s.yt.yt(f"/api/articles/{ref}", fields="idReadable,summary")
        except YtError as e:
            if e.status != 404:  # 401 / 403 / network: the whole foot says so
                raise
            a = {}
        return DocMention(ref=ref, title=a.get("summary") or "", kind="article")

    return list(await asyncio.gather(*(one(r) for r in refs)))


async def mentions(s, d: dict) -> DocMentions:
    yt, ref = s.yt, d["ref"]
    known = {p["shortName"] for p in await yt.cached("projects", lambda: _projects(yt))}
    tickets = [t for t in d["tickets"] if t.split("-")[0] in known][:MAX]
    text = "\n".join(f"{p['heading']}\n{p['body']}" for p in await s.db.read(s.store.doc_parts, d["id"]))
    arts = [a for a in dict.fromkeys(ARTICLE.findall(text)) if a != ref and a.split("-A-")[0] in known][:MAX]
    out = [*await _articles(s, arts), *(await _issues(yt, tickets) if tickets else [])]
    if d["source"] != "yt_article":
        return DocMentions(out=out, inward=None)
    named = await pages(yt, "/api/issues", query=f"mentions: {ref}", fields=ISSUE)
    found = await pages(yt, "/api/articles", query=f'"{ref}"', fields="idReadable,summary")
    by = await _articles(s, [a["idReadable"] for a in found if a.get("idReadable") not in (None, ref)][:MAX])
    return DocMentions(out=out, inward=[*by, *(_issue(a) for a in named[:MAX] if a.get("idReadable"))])
