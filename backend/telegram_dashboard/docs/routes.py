"""/api/docs: the document library (list, search, read, sources, sync) and its AI turns (Hỏi / Tóm tắt)."""

import asyncio
import time
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse

from .. import desktop
from ..ai_jobs import stream_answer
from ..ai_run import client_gone
from ..errors import ApiError
from . import sync
from .ask import STORED, answer, docs_of, find, pack
from .models import (
    DocAnswer,
    DocAskBody,
    DocDetail,
    DocDTO,
    DocHit,
    DocMsgHit,
    DocPart,
    DocSearch,
    DocSourceError,
    DocSources,
    DocSourcesBody,
    DocSummary,
    Source,
)
from .parts import snippet

SYNC_STALE = 600  # seconds: opening the screen again within this keeps the last sync (refresh passes force)
_API = {"yt_article": "youtrack"}  # docs.source -> API source


def _dt(ts: float | None) -> datetime | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC)


def doc_dto(s, d: dict) -> DocDTO:
    yt = d["source"] == "yt_article"
    base = getattr(s.yt, "base", "")
    return DocDTO(
        id=d["id"], source="youtrack" if yt else "file", ref=d["ref"], title=d["title"], chars=d["chars"],
        updated_at=_dt(d["updated_at"] / 1000) if d["updated_at"] else None, tickets=d["tickets"],
        url=f"{base}/articles/{d['ref']}" if yt and base else None, has_summary=bool(d["summary"]),
    )  # fmt: skip


def _sources(lib) -> DocSources:
    errors = [DocSourceError(**{**e, "source": _API.get(e["source"], e["source"])}) for e in lib.errors]
    return DocSources(**lib.sources(), synced_at=_dt(lib.synced_at), errors=errors)


async def _save_sources(lib, projects: list[str], folders: list[str]) -> None:
    folders = list(dict.fromkeys(str(Path(f)) for f in folders))  # the picker's trailing "/" is the same folder
    for f in folders:
        if not await asyncio.to_thread(Path(f).is_dir):
            raise ApiError(422, "doc_folder_not_a_directory", detail=f)
        if (p := Path(f).resolve()).parent == p:  # "/" or "C:\\": the whole disk, and its prefix would match nothing
            raise ApiError(422, "doc_folder_is_root", detail=f)
    try:
        await lib.set_sources(list(dict.fromkeys(projects)), folders)
    except ValueError as e:  # bad_project / bad_folder (not absolute)
        raise ApiError(422, f"doc_{e.args[0]}") from None


async def _doc(s, doc_id: int) -> dict:
    d = await s.db.read(s.store.doc_get, doc_id)
    if not d:
        raise ApiError(404, "doc_not_found")
    return d


async def _summary(lib, doc_id: int, on_text) -> dict:
    try:
        text, cached = await lib.summary(doc_id, on_text=on_text)
    except LookupError:
        raise ApiError(404, "doc_not_found") from None
    except ValueError as e:  # read_text's code (not_text, bad_docx…) or "outside"
        code = e.args[0] if e.args else "unreadable"
        raise ApiError(403 if code == "outside" else 422, f"doc_{code}") from None
    except OSError as e:  # the file went away since the last sync
        raise ApiError(409, "doc_unreadable", detail=type(e).__name__) from None
    return DocSummary(text=text, cached=cached).model_dump()


def build_router(settings) -> APIRouter:  # settings: the routers' shape; state is read from the app
    r = APIRouter(prefix="/api/docs")

    @r.get("")
    async def docs(request: Request, source: Source | None = None, ticket: str | None = None) -> list[DocDTO]:
        s = request.app.state
        if source == "telegram":  # messages are found by search only
            return []
        rows = await s.db.read(s.store.doc_list, source=STORED.get(source), ticket=ticket or None)
        return [doc_dto(s, d) for d in rows]

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
        return _sources(request.app.state.docs)

    @r.post("/sources")
    async def set_sources(body: DocSourcesBody, request: Request) -> DocSources:
        lib = request.app.state.docs
        await _save_sources(lib, body.projects, body.folders)
        return _sources(lib)

    @r.post("/sources/pick", responses={204: {"description": "Cancelled"}})
    async def pick_source(request: Request, response: Response) -> DocSources | None:
        lib = request.app.state.docs
        folder = await desktop.pick_folder(prompt="Chọn thư mục tài liệu để thêm vào Tài liệu")
        if folder is None:
            response.status_code = 204
            return None
        src = lib.sources()
        await _save_sources(lib, src["projects"], [*src["folders"], folder])
        return _sources(lib)

    @r.post("/sync")
    async def sync_now(request: Request, force: bool = False) -> DocSources:
        """Errors come back per source in `errors`; a failed source keeps its docs."""
        s = request.app.state
        if force or s.docs.synced_at is None or time.time() - s.docs.synced_at > SYNC_STALE:
            await sync.run(s.docs, s.yt)
        return _sources(s.docs)

    @r.post(
        "/ask",
        responses={200: {"model": DocAnswer, "description": "NDJSON: delta / reset lines, then {done: DocAnswer}"}},
    )
    async def ask(body: DocAskBody, request: Request) -> StreamingResponse:
        client_gone.set(request.is_disconnected)
        s = request.app.state

        async def work(on_text):
            return (await answer(s, body, on_text)).model_dump()

        return stream_answer(work)

    @r.get("/{doc_id}")
    async def detail(doc_id: int, request: Request) -> DocDetail:
        s = request.app.state
        d = await _doc(s, doc_id)
        parts = await s.db.read(s.store.doc_parts, doc_id)
        return DocDetail(doc=doc_dto(s, d), parts=[DocPart(**p) for p in parts], summary=await s.docs.saved_summary(d))

    @r.post(
        "/{doc_id}/summary",
        responses={200: {"model": DocSummary, "description": "NDJSON: delta / reset lines, then {done: DocSummary}"}},
    )
    async def summary(doc_id: int, request: Request) -> StreamingResponse:
        """A stored summary still matching the text comes back at once, without an AI run."""
        client_gone.set(request.is_disconnected)
        s = request.app.state
        await _doc(s, doc_id)  # an unknown doc is a plain 404, not a stream
        return stream_answer(lambda on_text: _summary(s.docs, doc_id, on_text))

    @r.post("/{doc_id}/reveal", status_code=204)
    async def reveal(doc_id: int, request: Request) -> None:
        """Show the file in Finder / Explorer: the stored path of a `file` doc only."""
        d = await _doc(request.app.state, doc_id)
        if d["source"] != "file":
            raise ApiError(409, "doc_not_a_file")
        await desktop.reveal(d["path"])

    return r
