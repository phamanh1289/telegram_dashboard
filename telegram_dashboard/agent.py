"""Headless Claude Code (or Codex/Antigravity, see providers.py) sessions for tasks: no Terminal, driven
and shown from the dashboard.

Each turn is one `claude -p` process (the prompt goes in via stdin); follow-ups resume the same
session id. Output is normalized to a small JSONL log the UI polls. Nothing needs approval here,
so a task runs with a fixed permission mode: `plan` (read-only) or `acceptEdits`.
"""

import asyncio
import contextlib
import json
import logging
import time
from pathlib import Path

from . import providers
from .ai import cli_reason
from .claude import note_run
from .config import child_env, kill_tree, on_path
from .errors import ApiError
from .links import delete_links, links_dir

log = logging.getLogger("telegram_dashboard.agent")

STREAM_LIMIT = 32 * 1024 * 1024  # one stream-json line can carry a whole file read
EXIT_GRACE = 10  # seconds after the CLI exits before what it left holding its pipes is killed
# After a result the CLI can linger (background agents, hooks): quiet this long = the turn is over.
AFTER_RESULT_IDLE = 20.0


def tasks_dir(settings) -> Path:
    return settings.data_dir / "tasks"


def task_result_path(settings, task_id: str) -> Path:
    return tasks_dir(settings) / f"{task_id}.result.md"


def read_task_result(settings, task_id: str) -> str | None:
    p = task_result_path(settings, task_id)
    return p.read_text(errors="replace")[:20000] if p.is_file() else None


def read_task_prompt(settings, task_id: str) -> str:
    """Prompt of a task older than prompts in the DB (its seed file minus the footer)."""
    p = tasks_dir(settings) / f"{task_id}.md"
    return p.read_text(errors="replace").split("\n\n---\nKhi xong,")[0] if p.is_file() else ""


def delete_task_files(settings, task_id: str) -> None:
    for suffix in (".md", ".result.md", ".log.jsonl"):
        (tasks_dir(settings) / f"{task_id}{suffix}").unlink(missing_ok=True)
    delete_links(settings, task_id)


class AgentRunner:
    def __init__(self, settings):
        self.settings = settings
        self.procs: dict[str, asyncio.subprocess.Process] = {}
        self.pumps: dict[str, asyncio.Task] = {}
        # Reserved before the first await (no double turn), with its process once spawned.
        self._starting: dict[str, asyncio.subprocess.Process | None] = {}
        self._cancel: set[str] = set()  # stopped while starting: never registered
        self._why: dict[str, str] = {}  # stopped on purpose: what the log says instead of the exit code

    @property
    def available(self) -> bool:
        p = providers.chosen(self.settings)
        return on_path(self.settings.ai_task_command) if p == "claude" else providers.installed(self.settings, p)

    def log_path(self, task_id: str) -> Path:
        return tasks_dir(self.settings) / f"{task_id}.log.jsonl"

    def running(self, task_id: str) -> bool:
        return task_id in self.procs or task_id in self._starting

    @property
    def busy(self) -> bool:
        """Any task running or still starting (an update must not restart under it)."""
        return bool(self.procs or self._starting)

    def read(self, task_id: str, after: int = 0) -> tuple[list[dict], int]:
        """(items after line `after`, total lines). Only whole lines: the pump may be mid-write."""
        p = self.log_path(task_id)
        text = p.read_text() if p.is_file() else ""
        lines = [ln for ln in text[: text.rfind("\n") + 1].splitlines() if ln.strip()]
        items = []
        for ln in lines[after:]:
            try:
                items.append(json.loads(ln))
            except ValueError:
                log.warning("task %s: unreadable log line skipped", task_id)
        return items, len(lines)

    def _append(self, task_id: str, item: dict) -> None:
        """`at` (epoch seconds) lets the page show how long each step and turn took."""
        with self.log_path(task_id).open("a") as f:
            f.write(json.dumps(item | {"at": round(time.time(), 1)}, ensure_ascii=False) + "\n")

    async def start(
        self, task_id: str, project: str, text: str, mode: str, session_id: str, resume: bool,
        ai: tuple[str | None, str | None] = (None, None),
    ) -> str:  # fmt: skip
        """Run one turn. Returns once the process has the prompt; output streams into the log.
        A new session (not `resume`) replaces the old log and result, once it is running.
        `ai`: the session's own model/effort (None: the task picks in AI settings).
        Returns the session id to keep: Codex and Antigravity name a new one ("codex:" in, "codex:<id>" out).
        Stopped while starting: the process is killed and 409 task_cancelled."""
        if self.running(task_id):
            raise ApiError(409, "task_busy")
        self._starting[task_id] = proc = None
        provider, sid = providers.split_session(session_id)
        try:
            tasks_dir(self.settings).mkdir(mode=0o700, exist_ok=True)
            choice = providers.run_choice(self.settings, task=True, provider=provider)  # the session's CLI
            if ai[0] is not None:  # picked for this session: used as is, no step-down
                choice = (ai[0], ai[1] or "", False)
            links = links_dir(self.settings, task_id)  # long link content saved for this task (links.py)
            read_dir = str(links) if links.is_dir() else None
            cmd = providers.task_cmd(self.settings, provider, mode, sid, resume, *choice[:2], read_dir)
            try:  # its own process group: a kill also reaches the shell commands it started
                proc = await asyncio.create_subprocess_exec(
                    *cmd, cwd=project, stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    limit=STREAM_LIMIT, env=child_env(), start_new_session=True,
                )  # fmt: skip
            except OSError as e:
                log.warning("agent for task %s not started: %s", task_id, e)
                raise ApiError(502, "task_launch_failed", detail=type(e).__name__) from None
            self._starting[task_id] = proc
            try:
                proc.stdin.write(providers.stdin(provider, text))
                await proc.stdin.drain()
                proc.stdin.close()
            except OSError:  # the CLI quit at once (bad flag, unknown session): stderr says why
                kill_tree(proc)
                err = (await proc.communicate())[1]
                log.warning("agent for task %s exited: %s", task_id, err.decode(errors="replace")[-300:])
                raise ApiError(502, "task_launch_failed", detail=cli_reason(None, err)) from None
            if provider in providers.OTHERS and not resume:  # its first event names the new session
                session_id = await self._new_thread(task_id, proc, provider)
            if task_id in self._cancel:
                raise ApiError(409, "task_cancelled")
            self.procs[task_id] = proc
        except BaseException as e:
            if proc is not None and proc.returncode is None:
                kill_tree(proc)
                await proc.wait()
            if isinstance(e, ApiError) and task_id in self._cancel:
                raise ApiError(409, "task_cancelled") from None
            raise
        finally:
            self._starting.pop(task_id, None)
            self._cancel.discard(task_id)
        # The pump owns the process from here; it first runs after these sync lines.
        self.pumps[task_id] = asyncio.create_task(self._pump(task_id, proc, choice, provider))
        if not resume:
            task_result_path(self.settings, task_id).unlink(missing_ok=True)
            self.log_path(task_id).unlink(missing_ok=True)
        self._append(task_id, {"kind": "user", "text": text})
        return session_id

    @staticmethod
    async def _new_thread(task_id: str, proc, provider: str) -> str:
        async def first() -> str:
            async for ev in providers.events(proc.stdout):
                for i in providers.items(provider, ev, {}):
                    if i["kind"] == "session" and i["id"]:
                        return i["id"]
            return ""

        try:
            thread = await asyncio.wait_for(first(), 30)
        except TimeoutError:
            thread = ""
        if not thread:
            kill_tree(proc)
            err = (await proc.communicate())[1]
            log.warning("%s for task %s gave no session: %s", provider, task_id, err.decode(errors="replace")[-300:])
            raise ApiError(502, "task_launch_failed", detail=cli_reason(None, err))
        return f"{provider}:{thread}"

    def _items(self, task_id: str, provider: str, ev: dict, st: dict) -> list[dict]:
        """Display items of one event; a CLI update can add event shapes: one we can't read is
        skipped, never the end of the run."""
        try:
            return [i for i in providers.items(provider, ev, st) if i["kind"] not in ("session", "reset", "delta")]
        except Exception:
            log.warning("task %s: skipped unreadable %r event", task_id, ev.get("type"), exc_info=True)
            return []

    async def _pump(self, task_id: str, proc: asyncio.subprocess.Process, choice=("", "", False),
                    provider="claude") -> None:  # fmt: skip
        got_result, t0, st = False, time.monotonic(), {}
        err = asyncio.create_task(proc.stderr.read())
        reap = asyncio.create_task(self._reap_after_exit(proc))
        try:
            # once a result is in, a CLI that stays alive but silent is done, not "running"
            idle = lambda: AFTER_RESULT_IDLE if got_result else None  # noqa: B023, E731 (reads it live)
            try:
                async for ev in providers.events(proc.stdout, idle):
                    for item in self._items(task_id, provider, ev, st):
                        # work after a result means the turn goes on: only a result that stays last ends it
                        got_result = item["kind"] == "result"
                        if got_result:
                            run = (providers.run_model(provider, st.get("model"), choice[0]), *choice[1:])
                            note_run(self.settings, "agent", run, item.pop("final"), time.monotonic() - t0, None)
                            if not item["error"]:  # a failed turn is not a result
                                task_result_path(self.settings, task_id).write_text(item["text"])
                        self._append(task_id, item)
            except TimeoutError:
                log.info("task %s: no output %ss after its result, ending the run", task_id, AFTER_RESULT_IDLE)
                kill_tree(proc)
            code = await proc.wait()
            if not got_result:
                note_run(self.settings, "agent", choice, None, time.monotonic() - t0, f"exit_{code}")
                tail = (await err).decode(errors="replace").strip()[-400:]
                text = self._why.get(task_id) or tail or f"Tiến trình dừng (mã {code})."
                self._append(task_id, {"kind": "result", "error": True, "text": text})
        except Exception as e:
            log.warning("agent output of task %s failed: %r", task_id, e, exc_info=True)
            self._append(task_id, {"kind": "result", "error": True,
                                   "text": f"Lỗi đọc output: {e!r}"})  # fmt: skip
        finally:
            kill_tree(proc)  # nobody reads its output any more: it, or what it left behind, stops now
            self._why.pop(task_id, None)
            if proc.returncode is None:
                await proc.wait()
            err.cancel()
            reap.cancel()
            if self.procs.get(task_id) is proc:
                del self.procs[task_id]
            if self.pumps.get(task_id) is asyncio.current_task():
                del self.pumps[task_id]

    @staticmethod
    async def _reap_after_exit(proc) -> None:
        """The CLI exited but a command it started still holds stdout/stderr: the pump would wait on
        the pipe forever (task stuck "running"). Kill what's left after a grace period."""
        await proc.wait()
        await asyncio.sleep(EXIT_GRACE)
        kill_tree(proc)

    async def stop(self, task_id: str, why: str = "Đã dừng.") -> None:
        """Stop the run (and what it started) and wait until its pump is done, so nothing writes to
        the log after. A turn still starting is cancelled: start() kills it and never registers it."""
        if task_id in self._starting:
            self._cancel.add(task_id)
            if (starting := self._starting[task_id]) is not None:
                kill_tree(starting)
        proc = self.procs.get(task_id)
        if proc:
            self._why[task_id] = why
            if proc.returncode is None:
                kill_tree(proc, term=True)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(proc.wait(), 5)
            kill_tree(proc)  # also what it left behind holding the output pipe (the pump waits on it)
        if pump := self.pumps.get(task_id):
            await asyncio.gather(pump, return_exceptions=True)

    async def stop_all(self) -> None:
        why = "Server khởi động lại nên lượt này dừng giữa chừng. Gửi tin (vd \"tiếp tục\") để chạy tiếp."
        await asyncio.gather(*(self.stop(t, why) for t in {*self.procs, *self._starting}))

    def new_session(self, provider: str | None = None) -> str:
        return providers.new_session(self.settings, provider)
