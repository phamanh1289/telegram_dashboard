"""AI Agent task routes: headless `claude -p` sessions per project (see agent.py)."""

import asyncio
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Request

from .agent import delete_task_files, read_task_prompt, read_task_result
from .errors import ApiError, int_or_404
from .models import TaskDTO, TaskMessage, TaskRequest


def build_router(settings) -> APIRouter:
    r = APIRouter(prefix="/api/tasks")

    async def _task(s, task_id: str, headless: bool = False) -> dict:
        row = await s.db.read(s.store.get_task, task_id)
        if row is None:
            raise ApiError(404, "task_not_found")
        if headless and row["mode"] == "terminal":  # Terminal tasks are gone; old rows only list
            raise ApiError(409, "terminal_task_unsupported")
        return row

    @r.post("", status_code=204)
    async def task(body: TaskRequest, request: Request) -> None:
        s = request.app.state
        if not await s.db.read(s.store.has_project, body.project):
            raise ApiError(404, "project_not_found")
        if not s.agent.available:
            raise ApiError(422, "ai_agent_missing")
        task_id = f"{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
        mid = None if body.message_id is None else int_or_404(body.message_id, "message_not_found")
        session = s.agent.new_session()
        await s.agent.start(task_id, body.project, body.prompt, body.mode, session, False)
        await s.db.write(
            s.store.add_task, task_id, body.chat_id, mid, body.project, body.prompt,
            mode=body.mode, session_id=session,
        )  # fmt: skip

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
            )
            for r, (result, prompt) in zip(rows, files, strict=True)
        ]  # fmt: skip

    @r.post("/{task_id}/reopen", status_code=204)
    async def reopen_task(task_id: str, request: Request) -> None:
        """Run the same task again in a fresh session; the old result goes once it runs."""
        s = request.app.state
        row = await _task(s, task_id, headless=True)
        if not row["prompt"]:
            raise ApiError(404, "task_not_found")
        await s.agent.stop(task_id)
        session = s.agent.new_session()
        await s.agent.start(task_id, row["project"], row["prompt"], row["mode"], session, False)
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
        # start() reserves the task before its first await: a double send gets 409 task_busy.
        await s.agent.start(task_id, row["project"], body.text, mode, row["session_id"], True)

    @r.post("/{task_id}/stop", status_code=204)
    async def task_stop(task_id: str, request: Request) -> None:
        await request.app.state.agent.stop(task_id)

    @r.delete("/{task_id}", status_code=204)
    async def delete_task(task_id: str, request: Request) -> None:
        s = request.app.state
        await s.agent.stop(task_id)
        if not await s.db.write(s.store.delete_task, task_id):
            raise ApiError(404, "task_not_found")
        delete_task_files(settings, task_id)

    return r
