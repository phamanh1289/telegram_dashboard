"""/api/docs: the document library (list, search, read, sources, sync) and its AI turns (Hỏi / Tóm tắt)."""

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import StreamingResponse

from .. import desktop, zeplin
from ..ai_jobs import stream_answer
from ..ai_run import client_gone
from ..errors import ApiError
from ..youtrack.client import YtError, YtUnreachable
from ..zeplin_names import NAMES
from . import sync
from .ask import answer, docs_of, find, pack, scope
from .library import ARTICLE_ID, PROJECT, folder_prefix
from .models import (
    SESSION,
    DocAiSession,
    DocAiTurn,
    DocAnswer,
    DocAskBody,
    DocDetail,
    DocDTO,
    DocHit,
    DocMsgHit,
    DocPart,
    DocRev,
    DocSearch,
    DocSourceError,
    DocSources,
    DocSourcesBody,
    DocSummary,
    DocTgBody,
    DocZeplinScreen,
    KbNode,
    Source,
)
from .parts import snippet

SYNC_STALE = 600  # seconds: opening the screen again within this keeps the last sync (refresh passes force)
_API = {"yt_article": "youtrack"}  # docs.source -> API source


def _dt(ts: float | None) -> datetime | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC)


def _yt_error(e: YtError, what: str) -> ApiError:
    """`what`: kb (the KB tree, Nguồn) / article (one article downloaded again)."""
    code = "yt_unreachable" if isinstance(e, YtUnreachable) else f"yt_{e.status}"
    return ApiError(502, f"doc_{what}_{code}", detail=e.message)


def doc_dto(s, d: dict, folders: dict[str, str] | None = None) -> DocDTO:
    """`folders`: {resolved prefix: folder as chosen}, to place a file under its source folder (the list's tree). A
    Telegram file sits under a "Telegram" folder; its `parent` column is the message it came from (`origin`)."""
    yt, tg = d["source"] == "yt_article", d["source"] == "tg_file"
    base = getattr(s.yt, "base", "")
    home = next(((p, f) for p, f in (folders or {}).items() if not yt and d["ref"].startswith(p)), None)
    if tg:
        home = ("", "Telegram")
    return DocDTO(
        id=d["id"], source="youtrack" if yt else "telegram" if tg else "file", ref=d["ref"], title=d["title"],
        chars=d["chars"], updated_at=_dt(d["updated_at"] / 1000) if d["updated_at"] else None, tickets=d["tickets"],
        url=f"{base}/articles/{d['ref']}" if yt and base else None, has_summary=bool(d["has_summary"]),
        parent=None if tg else d["parent"], folder=home and home[1], rel=home and d["ref"][len(home[0]):],
        size=d["size"], origin=d["parent"] if tg else None,
    )  # fmt: skip


async def _sources(lib) -> DocSources:
    errors = [DocSourceError(**{**e, "source": _API.get(e["source"], e["source"])}) for e in lib.errors]
    return DocSources(**lib.sources(), synced_at=_dt(lib.synced_at), errors=errors, cached=len(await lib.cached()))


async def _save_sources(lib, projects: list[str], folders: list[str], articles: list[str] | None = None) -> None:
    folders = list(dict.fromkeys(str(Path(f)) for f in folders))  # the picker's trailing "/" is the same folder
    for f in folders:
        if not await asyncio.to_thread(Path(f).is_dir):
            raise ApiError(422, "doc_folder_not_a_directory", detail=f)
        if (p := Path(f).resolve()).parent == p:  # "/" or "C:\\": the whole disk, and its prefix would match nothing
            raise ApiError(422, "doc_folder_is_root", detail=f)
    try:
        await lib.set_sources(list(dict.fromkeys(projects)), folders,
                              articles=None if articles is None else list(dict.fromkeys(articles)))  # fmt: skip
    except ValueError as e:  # bad_project / bad_article / bad_folder (not absolute)
        raise ApiError(422, f"doc_{e.args[0]}") from None


async def _doc(s, doc_id: int) -> dict:
    d = await s.db.read(s.store.doc_get, doc_id)
    if not d:
        raise ApiError(404, "doc_not_found")
    return d


async def _summary(s, doc_id: int, session: str | None, on_text) -> dict:
    lib = s.docs
    try:
        text, cached = await lib.summary(doc_id, on_text=on_text)
    except LookupError:
        raise ApiError(404, "doc_not_found") from None
    except ValueError as e:  # read_text's code (not_text, bad_docx…) or "outside"
        code = e.args[0] if e.args else "unreadable"
        raise ApiError(403 if code == "outside" else 422, f"doc_{code}") from None
    except OSError as e:  # the file went away since the last sync
        raise ApiError(409, "doc_unreadable", detail=type(e).__name__) from None
    if session and text and not cached:  # an AI run: kept in the history (a cached one is the doc's own summary)
        await lib.write(s.store.doc_ai_add, session, "summary", doc_id=doc_id, question="", text=text, cites=[])
    return DocSummary(text=text, cached=cached).model_dump()


def build_router(settings) -> APIRouter:  # settings: the routers' shape; state is read from the app
    r = APIRouter(prefix="/api/docs")

    @r.get("")
    async def docs(request: Request, source: Source | None = None, ticket: str | None = None) -> list[DocDTO]:
        s = request.app.state
        rows = await s.db.read(s.store.doc_list, ticket=ticket or None, **scope(s, source))
        folders = await asyncio.to_thread(lambda: {folder_prefix(f): f for f in s.docs.sources()["folders"]})
        return [doc_dto(s, d, folders) for d in rows]

    @r.get("/search")
    async def search(
        request: Request, q: str = "", source: Source | None = None, ticket: str | None = None, doc: int | None = None
    ) -> DocSearch:
        """Matching parts (best first) and tracked-chat messages, with how much of it Hỏi AI would send."""
        s = request.app.state
        parts, msgs = await find(s, DocAskBody(question="", q=q, source=source, ticket=ticket or None, doc=doc))
        items, chars = pack(parts, msgs)
        docs = await docs_of(s, [p["doc_id"] for p in parts])
        hits = [
            DocHit(doc=doc_dto(s, docs[p["doc_id"]]), part=p["part"], line=p["line"], heading=p["heading"],
                   text=text, marks=marks)
            for p in parts if p["doc_id"] in docs  # dropped by a sync meanwhile
            for text, marks in [snippet(p["body"], q)]
        ]  # fmt: skip
        messages = [
            DocMsgHit(chat_id=m["chat_id"], message_id=m["message_id"], chat_title=m["title"] or "",
                      sender_name=m["sender_name"], date=_dt(m["date"]), text=text, marks=marks)
            for m in msgs
            for text, marks in [snippet(m["text"] or "", q)]
        ]  # fmt: skip
        return DocSearch(hits=hits, messages=messages, ask_parts=len(items), ask_chars=chars)

    @r.get("/sources")
    async def sources(request: Request) -> DocSources:
        return await _sources(request.app.state.docs)

    @r.post("/sources")
    async def set_sources(body: DocSourcesBody, request: Request) -> DocSources:
        lib = request.app.state.docs
        await _save_sources(lib, body.projects, body.folders, body.articles)
        return await _sources(lib)

    @r.get("/kb-tree")
    async def kb_tree(request: Request, project: str) -> list[KbNode]:
        """A project's Knowledge Base articles with their parents, to pick branches in Nguồn."""
        if not PROJECT.fullmatch(project):
            raise ApiError(422, "doc_bad_project")
        try:
            rows = await sync.listed(request.app.state.yt, project, {})
        except YtError as e:
            raise _yt_error(e, "kb") from None
        return [KbNode(id=a["idReadable"], title=a.get("summary") or "", parent=sync.parent_of(a))
                for a in rows if a.get("idReadable")]  # fmt: skip

    @r.post("/sources/pick", responses={204: {"description": "Cancelled"}})
    async def pick_source(request: Request, response: Response) -> DocSources | None:
        lib = request.app.state.docs
        folder = await desktop.pick_folder(prompt="Chọn thư mục tài liệu để thêm vào Tài liệu")
        if folder is None:
            response.status_code = 204
            return None
        src = lib.sources()
        await _save_sources(lib, src["projects"], [*src["folders"], folder])
        return await _sources(lib)

    @r.post("/sync")
    async def sync_now(request: Request, force: bool = False) -> DocSources:
        """Errors come back per source in `errors`; a failed source keeps its docs."""
        s = request.app.state
        await sync.run(s.docs, s.yt, max_age=0 if force else SYNC_STALE)
        return await _sources(s.docs)

    @r.delete("/cache")
    async def drop_cache(request: Request) -> DocSources:
        """Drop the Agent's cache (articles of projects not in the sources); the chosen ones stay."""
        lib = request.app.state.docs
        try:
            await lib.drop_cache()
        except OSError as e:  # a file that would not go: rows and the rest stay
            raise ApiError(500, "doc_cache_clear_failed", detail=type(e).__name__) from None
        return await _sources(lib)

    @r.post(
        "/ask",
        responses={200: {"model": DocAnswer, "description": "NDJSON: delta / reset lines, then {done: DocAnswer}"}},
    )
    async def ask(body: DocAskBody, request: Request) -> StreamingResponse:
        client_gone.set(request.is_disconnected)
        s = request.app.state

        async def work(on_text):
            return (await answer(s, body, on_text)).model_dump(mode="json")  # saved_at: a datetime

        return stream_answer(work)

    # Việc cần xử lý: a KB article named in a message downloaded again now, a message's file into the library (removing
    # one: below, after /ai, which "/{doc_id}" would catch). Whether either is in the library is read from the list.

    @r.post("/kb/{ref}/refresh")
    async def kb_refresh(ref: str, request: Request) -> DocDTO:
        """Download the article again now (instead of waiting for the next sync); what changed is recorded."""
        s = request.app.state
        if not ARTICLE_ID.fullmatch(ref):
            raise ApiError(422, "doc_bad_article")
        try:
            await s.docs.fetch(s.yt, ref)
        except YtError as e:
            raise _yt_error(e, "article") from None
        d = await s.db.read(s.store.doc_find, "yt_article", ref)
        if not d:  # fetched but not saved (disk full / a symlink in the way)
            raise ApiError(500, "doc_not_saved")
        return doc_dto(s, d)

    @r.post("/telegram")
    async def add_telegram(body: DocTgBody, request: Request) -> DocDTO:
        """The document of a kept message into the library: added, or the one of the same name updated."""
        s = request.app.state
        m = await s.db.read(s.store.get_message, body.chat_id, body.message_id)
        if m is None or m.deleted or m.media_kind != "document":  # kept messages only, never any chat the account sees
            raise ApiError(404, "doc_tg_no_file")
        if s.bridge.state != "connected":
            raise ApiError(503, "doc_tg_offline")
        try:
            doc_id = await s.docs.add_tg_file(s.bridge, m)
        except LookupError:
            raise ApiError(404, "doc_tg_no_file") from None
        except ValueError as e:  # unsupported / too_big / read_text's codes
            raise ApiError(422, f"doc_{e.args[0] if e.args else 'unreadable'}") from None
        except OSError as e:
            raise ApiError(500, "doc_not_saved", detail=type(e).__name__) from None
        return doc_dto(s, await _doc(s, doc_id))

    # the AI history (before /{doc_id}: "ai" is not an id)
    @r.get("/ai")
    async def ai_sessions(request: Request, doc: int | None = None) -> list[DocAiSession]:
        """The AI popup's conversations, newest first; `doc`: those with a turn on that document."""
        s = request.app.state
        rows = await s.db.read(s.store.doc_ai_sessions, doc)
        return [DocAiSession(**{**r, "doc": r["doc_id"], "at": _dt(r["at"])}) for r in rows]

    @r.get("/ai/{session}")
    async def ai_turns(session: str, request: Request) -> list[DocAiTurn]:
        s = request.app.state
        rows = await s.db.read(s.store.doc_ai_turns, session)
        return [DocAiTurn(**{**r, "doc": r["doc_id"], "at": _dt(r["at"])}) for r in rows]

    @r.delete("/ai", status_code=204)
    async def ai_delete(request: Request, session: Annotated[list[str], Query(max_length=500)]) -> None:
        s = request.app.state
        await s.docs.write(s.store.doc_ai_delete, session)

    @r.get("/zeplin")
    async def zeplin_screens(name: Annotated[str, Query(min_length=1, max_length=120)]) -> list[DocZeplinScreen]:
        """The Zeplin screens named `name` (a screen name written in a document), read with the zeplin MCP's token."""
        try:
            rows = await NAMES.find(name)
        except zeplin.ZeplinError as e:
            code = str(e) if str(e) in ("no_token", "token_refused") else "unreachable"
            raise ApiError(409 if code == "no_token" else 502, f"doc_zeplin_{code}") from None
        web = "https://app.zeplin.io/project/{project}/screen/{id}"
        return [DocZeplinScreen(**r, url=web.format(**r)) for r in rows]

    @r.get("/{doc_id}")
    async def detail(doc_id: int, request: Request) -> DocDetail:
        s = request.app.state
        d = await _doc(s, doc_id)
        parts = await s.db.read(s.store.doc_parts, doc_id)
        revs = [DocRev(**{**r, "at": _dt(r["at"] / 1000)}) for r in await s.db.read(s.store.doc_revs, doc_id)]
        return DocDetail(
            doc=doc_dto(s, d), parts=[DocPart(**p) for p in parts], summary=await s.docs.saved_summary(d), revs=revs,
            added_at=_dt(d.get("added_at")),
        )

    @r.post(
        "/{doc_id}/summary",
        responses={200: {"model": DocSummary, "description": "NDJSON: delta / reset lines, then {done: DocSummary}"}},
    )
    async def summary(
        doc_id: int, request: Request, session: Annotated[str | None, Query(pattern=SESSION)] = None
    ) -> StreamingResponse:
        """A stored summary still matching the text comes back at once, without an AI run; a new one is kept in
        `session`'s history."""
        client_gone.set(request.is_disconnected)
        s = request.app.state
        await _doc(s, doc_id)  # an unknown doc is a plain 404, not a stream
        return stream_answer(lambda on_text: _summary(s, doc_id, session, on_text))

    @r.delete("/{doc_id}", status_code=204)
    async def remove(doc_id: int, request: Request) -> None:
        """Drop a Telegram file from the library (the others leave with their source)."""
        s = request.app.state
        d = await _doc(s, doc_id)
        if d["source"] != "tg_file":
            raise ApiError(409, "doc_not_removable")
        try:
            await s.docs.drop_tg_file(d)
        except OSError as e:
            raise ApiError(500, "doc_not_removed", detail=type(e).__name__) from None

    @r.post("/{doc_id}/reveal", status_code=204)
    async def reveal(doc_id: int, request: Request) -> None:
        """Show the file in Finder / Explorer: the stored path of a `file` doc only."""
        d = await _doc(request.app.state, doc_id)
        if d["source"] != "file":
            raise ApiError(409, "doc_not_a_file")
        await desktop.reveal(d["path"])

    return r
