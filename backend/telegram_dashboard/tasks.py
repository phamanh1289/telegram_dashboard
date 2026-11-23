"""AI Agent task routes: headless `claude -p` (or Codex/Antigravity) sessions per project (see agent.py)."""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Request

from . import gitops
from .agent import delete_task_files, read_task_prompt, read_task_result, task_active_at
from .ai import at_usernames, role_tags
from .ai_prompts import session_rules, task_state
from .errors import ApiError, int_or_404
from .links import expand, has_links, links_dir
from .models import AboutMe, HandledRequest, PrRequest, StoredMessage, TaskAi, TaskDTO, TaskMessage, TaskRequest
from .providers import split_session
from .storage import CHAIN_MAX
from .telegram.qa import chain_code, chain_walk, names_code
from .telegram.qa import codes as qa_codes

log = logging.getLogger("telegram_dashboard.tasks")


def new_task_id() -> str:
    return f"{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"


async def _ref_qa(s, chat_id: str, mid: int) -> str:
    """The "#QA…" of the thread a message sits in (up its reply chain; kept copies first, else live), "" if none.
    Read now, while the message was just shown: a BE answer is often never stored, so Done could not find it later."""

    async def fetch(ids: list[int]):
        kept, _ = await s.db.read(s.store.get_messages_by_ids, chat_id, ids)
        return kept or await s.bridge.fetch_ids(chat_id, ids)

    try:
        return await chain_code(fetch, mid) or ""
    except Exception as e:  # the turn already runs: a failed lookup only loses the Q&A link, never fails the send
        log.warning("Q&A code of %s/%s not read: %r", chat_id, mid, e)
        return ""


async def close_in_done_qa(s, msgs: list[StoredMessage]) -> None:
    """New tags (first seen) inside a Q&A thread already marked Xong: Done too, quietly, as Xong did for the tags it
    found then (else one stays hidden by Q&A yet counted as waiting). In the thread: up its reply chain (kept copies
    first, else live) a message naming its code, or one the thread had when marked Xong (qa_members: the question
    someone asked that I answered with Q&A too). Its new answers still show as "trả lời mới".
    Per batch: one done_qa per group, each message read once; live reads under the scans' cap (live_reads.scan)."""
    marks: dict[str, tuple[set[str], set[int]]] = {}
    got: dict[tuple[str, int], StoredMessage] = {}

    async def fetch(cid: str, ids: list[int]) -> list[StoredMessage]:
        if miss := [i for i in ids if (cid, i) not in got]:
            kept, _ = await s.db.read(s.store.get_messages_by_ids, cid, miss)
            found = kept or await s.live_reads.scan(s.bridge.fetch_ids(cid, miss))
            got.update(((cid, x.message_id), x) for x in found)
        return [got[(cid, i)] for i in ids if (cid, i) in got]

    for m in msgs:
        if m.outgoing or (m.reply_to_id is None and not names_code(m.text)):
            continue
        try:
            if m.chat_id not in marks:
                marks[m.chat_id] = await s.db.read(s.store.done_qa, m.chat_id)
            done, members = marks[m.chat_id]
            if not done:
                continue
            async for x in chain_walk(lambda ids, cid=m.chat_id: fetch(cid, ids), m.message_id, CHAIN_MAX):
                if x.message_id in members or qa_codes(x.text) & done:
                    await s.db.write(s.store.set_handled, m.chat_id, m.message_id, True, "quiet")
                    break
        except Exception as e:  # a background hook: the tag just stays open
            log.warning("tag %s/%s not checked against Xong Q&A: %r", m.chat_id, m.message_id, e)


async def add_refs(s, task_id: str, refs, *, ask: bool = True) -> None:
    """Attach messages ((chat_id, message id) pairs) to a session: its Done / reopen moves them and their Q&A; its
    asks reply to the last one (`ask`)."""
    rows = [(cid, int(mid)) for cid, mid in refs if str(mid).isdigit()]
    await s.db.write(s.store.add_task_refs, task_id, [(cid, mid, await _ref_qa(s, cid, mid)) for cid, mid in rows],
                     ask=ask)  # fmt: skip


ATTACH_HEAD = "Tin nhắn đính kèm:"  # web/src/lib/attach.ts: the quoted attached messages under a typed turn


def assist_history(items: list[dict]) -> list[dict]:
    """A Trợ lý AI session's last answered turns (from its log) for its next one: what was typed, what the AI said."""
    out, ask = [], None
    for i in items:
        if i.get("kind") == "user":
            text = i.get("text") or ""
            ask = "" if text.startswith(f"{ATTACH_HEAD}\n") else text.split(f"\n\n{ATTACH_HEAD}\n")[0]
        elif i.get("kind") == "result" and ask is not None:
            if not i.get("error"):
                out.append({"ask": ask[:500], "answer": (i.get("text") or "")[:2000]})
            ask = None
    return out[-4:]  # ponytail: last 4 turns, cut; a summary of older ones if long sessions need them


async def follow_task(s, task_id: str, handled: bool, react: bool) -> None:
    """A session's Done / reopen (on it, or on its tag): every kept message attached to it and the Q&A they (or an
    Đối chiếu BE prompt) name follow."""
    for rc, mids in (await s.db.write(s.store.mark_task_refs, task_id, handled, "me" if react else "quiet")).items():
        if react:
            s.bridge.react(rc, mids, handled)
    await s.db.write(s.store.mark_task_qa, task_id, handled)


async def mark_tags(s, chat_id: str, ids: list[int], handled: bool, react: bool) -> None:
    """After tags were marked done / reopened (one, or "Đã xử lý tất cả"): the Q&A they name, and the sessions on
    them, follow. Done also closes every session still in Doing that they were attached to (its own messages and Q&A
    follow it); reopening one attached message leaves such a session as it is."""
    await s.db.write(s.store.mark_tag_qa, chat_id, ids, handled)
    for task_id in await s.db.read(s.store.tasks_on, chat_id, ids):
        await follow_task(s, task_id, handled, react)
    if handled:  # each one leaves Doing before its own cascade runs, so a cycle of attachments ends
        for task_id in await s.db.read(s.store.doing_tasks_citing, chat_id, ids):
            if row := await s.db.read(s.store.get_task, task_id):
                await set_task_handled(s, row, True, react)


async def set_task_handled(s, row: dict, handled: bool, react: bool) -> None:
    """A session's Done / reopen: on its kept tag when the message is one, else on the session itself; and on every
    kept message attached to its turns."""
    task_id, cid, mid = row["id"], row["chat_id"], row["message_id"]
    msg = None if mid is None else await s.db.read(s.store.get_message, cid, mid)
    kept = msg is not None and not msg.deleted  # a tag deleted on Telegram: Done goes on the session
    if kept:
        by = "me" if react else "quiet"
        changed = await s.db.write(s.store.set_handled, cid, mid, handled, by) or (
            handled and await s.db.write(s.store.claim_handled, cid, mid, by)
        )  # a reply had handled it
    else:
        changed = await s.db.write(s.store.set_task_done, task_id, handled)
    if changed and react and mid is not None:
        s.bridge.react(cid, [mid], handled)
    if kept:  # the tag's own #QA code, and every session on it (this one included), as Done from the list
        await mark_tags(s, cid, [mid], handled, react)
    else:
        await follow_task(s, task_id, handled, react)


async def start_task(
    s, task_id: str, chat_id: str | None, message_id: int | None, project: str, prompt: str, mode: str,
    kind: str = "task", title: str | None = None, *, about, refs=(), ask_refs: bool = True, mcp: bool = False,
) -> asyncio.Task:  # fmt: skip
    """Save the task, then start its first turn in the background and return that run: the page gets the id at once
    and follows the session, already running, while the turn's links are read and the CLI spawned (seconds; Đối chiếu
    BE's scene used to wait for all of it). A start that fails or is stopped keeps the row, its log ending with why
    (agent.start); awaiting the run raises it. `refs`: messages it is about (Đối chiếu BE's cited ones); `ask_refs`:
    its asks reply to the last of them. `mcp`: its first turn may use the user's own MCP servers / plugins."""
    if s.settings.forbids_project(project):  # before git runs there (snapshot)
        raise ApiError(422, "project_forbidden")
    session = s.agent.new_session()
    try:  # the tree before the AI touches it: Thay đổi shows this session's edits only
        base = await gitops.snapshot(project)
    except ApiError as e:  # git too slow / failing: Thay đổi falls back to the whole working tree
        log.warning("git snapshot of %s failed: %s", project, e)
        base = None
    await s.db.write(s.store.add_task, task_id, chat_id, message_id, project, prompt,
                     mode=mode, session_id=session, kind=kind, title=title, git_base=base)  # fmt: skip
    rules = await _rules(s, mode, about)

    async def text() -> str:
        return await expand(s, at_usernames(prompt), task_id, chat_id=chat_id) + f"\n\n{rules}"

    async def first() -> None:
        named = await s.agent.start(task_id, project, text, mode, session, False, mcp=mcp)
        await _first_ran(s, task_id, session, named, chat_id, message_id)
        await add_refs(s, task_id, refs, ask=ask_refs)

    # eager: start() reserves the run before its first await, so the session shows running before the id goes out
    run = asyncio.create_task(first(), eager_start=True)
    _starts.add(run)
    run.add_done_callback(lambda t: _started(task_id, t))
    return run


async def _rules(s, mode: str, about) -> str:
    """One frame for every session (Giao AI Agent, Đối chiếu BE): who the user is, rules, answer sections, questions."""
    tags = role_tags(await s.db.read(s.store.list_rules))
    return session_rules(mode, about.role, about.platform, about.intro, tags=tags)


async def _first_ran(s, task_id: str, session: str, named: str, chat_id: str | None, message_id) -> None:
    """Once a session's first turn runs: the id its CLI gave it, and the tag it is about."""
    if named != session:  # Codex / Antigravity name their session once it runs
        await s.db.write(s.store.set_task_session, task_id, named)
    if message_id is not None:  # the tag itself, with its Q&A code: a later answer in that thread finds it
        await add_refs(s, task_id, [(chat_id, message_id)], ask=False)  # (open_task_by_qa); asks keep their target


_starts: set[asyncio.Task] = set()  # the loop holds tasks weakly: a first turn must not be collected while it starts


def _started(task_id: str, t: asyncio.Task) -> None:
    _starts.discard(t)
    if not t.cancelled() and (e := t.exception()):  # its log already says why (agent.start); id and error name only
        log.warning("task %s did not start: %s", task_id, e.code if isinstance(e, ApiError) else type(e).__name__)


async def remove_task(s, task_id: str) -> bool:
    """Delete a session for good: its run stopped first (so nothing writes back), then its row, refs, log, result and
    saved links. One path for the session's own Xóa, Cài đặt › Dữ liệu and Xóa dữ liệu nhóm. False: no such session."""
    await s.agent.stop(task_id)
    if not await s.db.write(s.store.delete_task, task_id):
        return False
    await asyncio.to_thread(delete_task_files, s.settings, task_id)
    return True


RELAY_EFFORT = "medium"  # a turn Vòng BE sends on its own: the session's model, at most this effort


async def send_turn(
    s, row: dict, typed: str, refs, edit: bool, *, auto: bool = False, mcp: bool = False, model: str | None = None,
    about: AboutMe | None = None,
) -> None:  # fmt: skip
    """A follow-up turn of a session (resumes it): typed text (+ its attached messages, `refs`), allowed to edit files
    when `edit` (per turn, so a plan can be approved). The composer and autobe's relayed answers (`auto`: nobody
    asked for that turn, so it runs at RELAY_EFFORT unless the session's own effort is lower). `mcp`: the user let this
    turn use their own MCP servers / plugins (an edit turn only). `model`: this turn alone runs on it, not on the
    session's (Vòng BE sparing quota). `about`: who the user is, for a session whose first turn never ran (it starts
    over with the frame start_task gives; Vòng BE passes none: the defaults)."""
    task_id = row["id"]

    # made in start(), once reserved: a double send must not rewrite the files a turn reads
    async def text() -> str:
        if has_links(row["prompt"] or "") and not links_dir(s.settings, task_id).is_dir():
            log.info("task %s: saved link content gone, fetching it again", task_id)
            await expand(s, row["prompt"], task_id, summarize=False, chat_id=row["chat_id"])  # re-saves earlier files
        return await expand(s, at_usernames(typed), task_id, chat_id=row["chat_id"])

    mode = "edit" if edit else row["mode"]
    effort = row["effort"]
    if auto and effort not in ("low", RELAY_EFFORT):
        effort = RELAY_EFFORT
    ai = (model or row["model"], effort)
    if not await asyncio.to_thread(s.agent.ran, task_id):  # its first turn never reached the CLI: nothing to resume,
        rules = await _rules(s, mode, about or AboutMe())  # so it starts again, the session's job then this turn's text
        job = "\n\n".join(x for x in (row["prompt"] or read_task_prompt(s.settings, task_id), typed) if x)

        async def first() -> str:
            return await expand(s, at_usernames(job), task_id, chat_id=row["chat_id"]) + f"\n\n{rules}"

        session = s.agent.new_session(split_session(row["session_id"])[0])
        named = await s.agent.start(task_id, row["project"], first, mode, session, False, ai, auto=auto, mcp=mcp)
        await _first_ran(s, task_id, session, named, row["chat_id"], row["message_id"])
        if named == session:  # Claude: the row still names the session that never ran
            await s.db.write(s.store.set_task_session, task_id, session)
    else:
        await s.agent.start(task_id, row["project"], text, mode, row["session_id"], True, ai, auto=auto, mcp=mcp)
    await add_refs(s, task_id, refs)


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
        await start_task(s, task_id, body.chat_id, mid, body.project, body.prompt, body.mode, about=body,
                         mcp=body.mcp)  # fmt: skip
        return {"id": task_id}

    @r.get("")
    async def tasks(request: Request, chat_id: str | None = None) -> list[TaskDTO]:
        s = request.app.state
        rows = await s.db.read(s.store.list_tasks, chat_id)
        files = await asyncio.to_thread(
            lambda: [(read_task_result(settings, r["id"]), r["prompt"] or read_task_prompt(settings, r["id"]),
                      task_active_at(settings, r["id"])) for r in rows]
        )  # fmt: skip
        return [
            TaskDTO(
                id=r["id"], chat_id=r["chat_id"],
                message_id=None if r["message_id"] is None else str(r["message_id"]),
                project=r["project"], created_at=r["created_at"], active_at=active, result=result, prompt=prompt,
                mode=r["mode"], running=s.agent.running(r["id"]),
                chat_title=r["chat_title"], sender_name=r["sender_name"],
                message_text=r["message_text"], handled=bool(r["handled"]),
                kind=r["kind"], title=r["title"], model=r["model"], effort=r["effort"],
                provider=split_session(r["session_id"] or "")[0],
                ask_to=json.loads(r["ask_to"]) if r["ask_to"] else None, state=task_state(result),
            )
            for r, (result, prompt, active) in zip(rows, files, strict=True)
        ]  # fmt: skip

    @r.get("/sent")
    async def sent(request: Request) -> dict[str, list[str]]:
        """Which messages were sent along to which sessions (Q&A's "Đã gửi AI")."""
        s = request.app.state
        return await s.db.read(s.store.sent_refs)

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
        text = lambda: expand(s, row["prompt"], task_id, chat_id=row["chat_id"])  # noqa: E731
        session = await s.agent.start(task_id, row["project"], text, row["mode"], fresh, False, ai)
        await s.db.write(s.store.set_task_session, task_id, session)

    @r.get("/{task_id}/events")
    async def task_events(task_id: str, request: Request, after: int = 0) -> dict:
        """Conversation log of a headless task; poll with the returned `next`."""
        s = request.app.state
        await _task(s, task_id)
        # A turn finishing during the read may append its result after this snapshot: keep one final poll.
        running = s.agent.running(task_id)
        items, total = await asyncio.to_thread(s.agent.read, task_id, after)
        running = running or s.agent.running(task_id)
        return {"items": items, "next": total, "total": total, "running": running}

    @r.post("/{task_id}/message", status_code=204)
    async def task_message(task_id: str, body: TaskMessage, request: Request) -> None:
        """Follow-up turn in a headless task (resumes the same session; starts it over if it never ran)."""
        s = request.app.state
        row = await _task(s, task_id, headless=True)
        if not row["session_id"]:
            raise ApiError(404, "task_not_found")
        await send_turn(s, row, body.text, [(x.chat_id, x.message_id) for x in body.refs], body.edit,
                        mcp=body.mcp, about=body)  # fmt: skip

    @r.put("/{task_id}/ai", status_code=204)
    async def task_ai(task_id: str, body: TaskAi, request: Request) -> None:
        """Model/effort for this session's next turns."""
        s = request.app.state
        if not await s.db.write(s.store.set_task_ai, task_id, body.model, body.effort):
            raise ApiError(404, "task_not_found")

    @r.put("/{task_id}/handled", status_code=204)
    async def task_handled(task_id: str, body: HandledRequest, request: Request) -> None:
        """Done / reopen (see set_task_handled)."""
        s = request.app.state
        await set_task_handled(s, await _task(s, task_id), body.handled, body.react)

    @r.get("/{task_id}/changes")
    async def task_changes(task_id: str, request: Request) -> dict:
        """What the project changed since the session started (old sessions: working tree vs HEAD): files and patch."""
        row = await _task(request.app.state, task_id)
        return await gitops.changes(row["project"], row["git_base"])

    @r.post("/{task_id}/pr")
    async def task_pr(task_id: str, body: PrRequest, request: Request) -> dict:
        """Commit the changes (secret-looking files left out) on a branch, push it and open a PR; noted in the log."""
        s = request.app.state
        row = await _task(s, task_id)
        if s.agent.running(task_id):
            raise ApiError(409, "task_busy")
        title, text = body.title.strip(), body.body.strip()
        base = row["git_base"]
        res = await gitops.open_pr(row["project"], f"ai/{task_id}", title, text, base, mixed_ok=body.mixed_ok)
        # what went into the PR is no longer this session's open change. Checked again: a turn that started while this
        # pushed (a queued prompt, Vòng BE) may have edited files since, and a new base would hide those edits
        if row["git_base"] and not s.agent.running(task_id):
            await s.db.write(s.store.set_task_base, task_id, await gitops.snapshot(row["project"]))
        pushed = f"Đã đẩy nhánh `{res['branch']}`. {res['note'] or ''}"
        s.agent.note(task_id, f"Đã mở PR: {res['url']}" if res["url"] else pushed)
        return res

    @r.post("/{task_id}/stop", status_code=204)
    async def task_stop(task_id: str, request: Request) -> None:
        await request.app.state.agent.stop(task_id)

    @r.delete("/{task_id}", status_code=204)
    async def delete_task(task_id: str, request: Request) -> None:
        if not await remove_task(request.app.state, task_id):
            raise ApiError(404, "task_not_found")

    return r
