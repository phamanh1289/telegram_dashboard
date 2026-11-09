"""AI Agent task routes: headless `claude -p` (or Codex/Antigravity) sessions per project (see agent.py)."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Request

from .agent import delete_task_files, read_task_prompt, read_task_result
from .ai import ASK_STYLE
from .errors import ApiError, int_or_404
from .links import delete_links, expand, has_links, links_dir
from .models import HandledRequest, TaskAi, TaskDTO, TaskMessage, TaskRequest
from .providers import split_session

log = logging.getLogger("telegram_dashboard.tasks")


def new_task_id() -> str:
    return f"{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"


async def start_task(
    s, task_id: str, chat_id: str | None, message_id: int | None, project: str, prompt: str, mode: str,
    kind: str = "task", title: str | None = None,
) -> None:  # fmt: skip
    """Save the task, then start its first turn: a run is never without its row (a failed start
    takes the row back)."""
    session = s.agent.new_session()
    await s.db.write(s.store.add_task, task_id, chat_id, message_id, project, prompt,
                     mode=mode, session_id=session, kind=kind, title=title)  # fmt: skip
    try:
        # its questions to BE / PO / QC follow the same role style as every other AI text (CLAUDE.md)
        text = await expand(s, prompt, task_id, chat_id=chat_id) + f"\n\n{ASK_STYLE.strip()}"
        named = await s.agent.start(task_id, project, text, mode, session, False)
    except BaseException:
        await s.db.write(s.store.delete_task, task_id)
        await asyncio.to_thread(delete_links, s.settings, task_id)  # link text saved by expand()
        raise
    if named != session:  # Codex / Antigravity name their session once it runs
        await s.db.write(s.store.set_task_session, task_id, named)


def build_router(settings) -> APIRouter:
    r = APIRouter(prefix="/api/tasks")

    async def _task(s, task_id: str, headless: bool = False) -> dict:
        row = await s.db.read(s.store.get_task, task_id)
        if row is None:
            raise ApiError(404, "task_not_found")
        if headless and row["mode"] == "terminal":  # Terminal tasks are gone; old rows only list
            raise ApiError(409, "terminal_task_unsupported")
        return row

    @r.post("")
    async def task(body: TaskRequest, request: Request) -> dict:
        s = request.app.state
        if not await s.db.read(s.store.has_project, body.project):
            raise ApiError(404, "project_not_found")
        if not s.agent.available:
            raise ApiError(422, "ai_agent_missing")
        mid = None if body.message_id is None else int_or_404(body.message_id, "message_not_found")
        task_id = new_task_id()
        await start_task(s, task_id, body.chat_id, mid, body.project, body.prompt, body.mode)
        return {"id": task_id}

    @r.get("")
    async def tasks(request: Request, chat_id: str | None = None) -> list[TaskDTO]:
        s = request.app.state
        rows = await s.db.read(s.store.list_tasks, chat_id)
        files = await asyncio.to_thread(
            lambda: [(read_task_result(settings, r["id"]),
                      r["prompt"] or read_task_prompt(settings, r["id"])) for r in rows]
        )  # fmt: skip
        return [
            TaskDTO(
                id=r["id"], chat_id=r["chat_id"],
                message_id=None if r["message_id"] is None else str(r["message_id"]),
                project=r["project"], created_at=r["created_at"], result=result, prompt=prompt,
                mode=r["mode"], running=s.agent.running(r["id"]),
                chat_title=r["chat_title"], sender_name=r["sender_name"],
                message_text=r["message_text"], handled=bool(r["handled"]),
                kind=r["kind"], title=r["title"], model=r["model"], effort=r["effort"],
                provider=split_session(r["session_id"] or "")[0],
            )
            for r, (result, prompt) in zip(rows, files, strict=True)
        ]  # fmt: skip

    @r.post("/{task_id}/reopen", status_code=204)
    async def reopen_task(task_id: str, request: Request) -> None:
        """Run the same task again in a fresh session on the CLI that ran it (its model/effort picks
        belong to that CLI); the old result goes once it runs."""
        s = request.app.state
        row = await _task(s, task_id, headless=True)
        if not row["prompt"]:
            raise ApiError(404, "task_not_found")
        await s.agent.stop(task_id)
        ai = (row["model"], row["effort"])
        fresh = s.agent.new_session(split_session(row["session_id"] or "")[0])
        text = await expand(s, row["prompt"], task_id, chat_id=row["chat_id"])
        session = await s.agent.start(task_id, row["project"], text, row["mode"], fresh, False, ai)
        await s.db.write(s.store.set_task_session, task_id, session)

    @r.get("/{task_id}/events")
    async def task_events(task_id: str, request: Request, after: int = 0) -> dict:
        """Conversation log of a headless task; poll with the returned `next`."""
        s = request.app.state
        await _task(s, task_id)
        items, total = await asyncio.to_thread(s.agent.read, task_id, after)
        return {"items": items, "next": total, "total": total, "running": s.agent.running(task_id)}

    @r.post("/{task_id}/message", status_code=204)
    async def task_message(task_id: str, body: TaskMessage, request: Request) -> None:
        """Follow-up turn in a headless task (resumes the same session)."""
        s = request.app.state
        row = await _task(s, task_id, headless=True)
        if not row["session_id"]:
            raise ApiError(404, "task_not_found")
        mode = "edit" if body.edit else row["mode"]  # per turn, so a plan can be approved
        if s.agent.running(task_id):  # before expand(): a double send must not rewrite the files a turn reads
            raise ApiError(409, "task_busy")  # (start() also reserves the task before its first await)
        if has_links(row["prompt"] or "") and not links_dir(settings, task_id).is_dir():
            log.info("task %s: saved link content gone, fetching it again", task_id)
            await expand(s, row["prompt"], task_id, summarize=False, chat_id=row["chat_id"])  # re-saves earlier files
        ai = (row["model"], row["effort"])
        text = await expand(s, body.text, task_id, chat_id=row["chat_id"])
        await s.agent.start(task_id, row["project"], text, mode, row["session_id"], True, ai)
        refs = [(x.chat_id, int(x.message_id)) for x in body.refs if x.message_id.isdigit()]
        if refs:
            await s.db.write(s.store.add_task_refs, task_id, refs)

    @r.put("/{task_id}/ai", status_code=204)
    async def task_ai(task_id: str, body: TaskAi, request: Request) -> None:
        """Model/effort for this session's next turns."""
        s = request.app.state
        if not await s.db.write(s.store.set_task_ai, task_id, body.model, body.effort):
            raise ApiError(404, "task_not_found")

    @r.put("/{task_id}/handled", status_code=204)
    async def task_handled(task_id: str, body: HandledRequest, request: Request) -> None:
        """Done / reopen: on the kept tag when the message is one, else on the session itself; and on every
        kept message attached to its turns."""
        s = request.app.state
        row = await _task(s, task_id)
        cid, mid = row["chat_id"], row["message_id"]
        msg = None if mid is None else await s.db.read(s.store.get_message, cid, mid)
        kept = msg is not None and not msg.deleted  # a tag deleted on Telegram: Done goes on the session
        if kept:
            changed = await s.db.write(s.store.set_handled, cid, mid, body.handled, "me" if body.react else "quiet")
        else:
            changed = await s.db.write(s.store.set_task_done, task_id, body.handled)
        if changed and body.react and mid is not None:
            s.bridge.react(cid, [mid], body.handled)
        by = "me" if body.react else "quiet"
        for rc, mids in (await s.db.write(s.store.mark_task_refs, task_id, body.handled, by)).items():
            if body.react:
                s.bridge.react(rc, mids, body.handled)

    @r.post("/{task_id}/stop", status_code=204)
    async def task_stop(task_id: str, request: Request) -> None:
        await request.app.state.agent.stop(task_id)

    @r.delete("/{task_id}", status_code=204)
    async def delete_task(task_id: str, request: Request) -> None:
        s = request.app.state
        await s.agent.stop(task_id)
        if not await s.db.write(s.store.delete_task, task_id):
            raise ApiError(404, "task_not_found")
        await asyncio.to_thread(delete_task_files, settings, task_id)

    return r
