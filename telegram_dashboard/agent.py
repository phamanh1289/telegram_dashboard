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
import shlex
import time
from pathlib import Path

from . import providers
from .claude import flags_for, note_run
from .config import child_env, on_path
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.agent")

PERMISSION = {"plan": "plan", "edit": "acceptEdits"}
# Enforced here, not left to ~/.claude settings: no shell or web, no MCP servers, and no edits to
# files that run code later (hooks, git hooks, CI). An Edit(path) rule also covers Write.
DENY = ("Bash,WebFetch,WebSearch,Edit(.claude/**),Edit(.git/**),Edit(.github/**),"
        # files that run code later (on folder open, commit, cd) or load tools into the next session
        "Edit(.vscode/**),Edit(.idea/**),Edit(.husky/**),Edit(.envrc),Edit(.mcp.json)")
STREAM_LIMIT = 32 * 1024 * 1024  # one stream-json line can carry a whole file read
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


def _short(inp: dict) -> str:
    for key in ("command", "file_path", "pattern", "path", "url", "description", "prompt"):
        if isinstance(inp.get(key), str):
            return inp[key][:160]
    return json.dumps(inp, ensure_ascii=False)[:120]


def _items(ev: dict) -> list[dict]:
    """One stream-json event -> display items (text / tool call / tool output / final result)."""
    kind = ev.get("type")
    blocks = (ev.get("message") or {}).get("content")
    out: list[dict] = []
    if kind == "assistant" and isinstance(blocks, list):
        for b in blocks:
            if b.get("type") == "text" and b.get("text", "").strip():
                out.append({"kind": "assistant", "text": b["text"]})
            elif b.get("type") == "tool_use":
                out.append({"kind": "tool", "text": f"{b.get('name', '?')}  {_short(b.get('input') or {})}"})
    elif kind == "user" and isinstance(blocks, list):
        for b in blocks:
            if b.get("type") != "tool_result":
                continue
            c = b.get("content")
            text = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c or [] if isinstance(x, dict))
            out.append({"kind": "tool_result", "text": text.strip()[:400], "error": bool(b.get("is_error"))})
    elif kind == "result":
        out.append({"kind": "result", "text": ev.get("result") or "", "error": bool(ev.get("is_error"))})
    return out


class AgentRunner:
    def __init__(self, settings):
        self.settings = settings
        self.procs: dict[str, asyncio.subprocess.Process] = {}
        self.pumps: dict[str, asyncio.Task] = {}
        self._starting: set[str] = set()  # reserved before the first await: no double turn

    @property
    def executable(self) -> list[str]:
        return shlex.split(self.settings.ai_task_command)

    @property
    def available(self) -> bool:
        p = providers.chosen(self.settings)
        return on_path(self.settings.ai_task_command) if p == "claude" else providers.installed(self.settings, p)

    def log_path(self, task_id: str) -> Path:
        return tasks_dir(self.settings) / f"{task_id}.log.jsonl"

    def running(self, task_id: str) -> bool:
        return task_id in self.procs or task_id in self._starting

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
        with self.log_path(task_id).open("a") as f:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    async def start(self, task_id: str, project: str, text: str, mode: str, session_id: str, resume: bool) -> str:
        """Run one turn. Returns once the process has the prompt; output streams into the log.
        A new session (not `resume`) replaces the old log and result, once it is running.
        Returns the session id to keep: Codex and Antigravity name a new one ("codex:" in, "codex:<id>" out)."""
        if self.running(task_id):
            raise ApiError(409, "task_busy")
        self._starting.add(task_id)
        provider, sid = providers.split_session(session_id)
        try:
            tasks_dir(self.settings).mkdir(mode=0o700, exist_ok=True)
            choice = providers.run_choice(self.settings, task=True, provider=provider)  # the session's CLI
            if provider == "claude":
                flag = ["--resume", sid] if resume else ["--session-id", sid]
                cmd = [*self.executable, "-p", *flags_for(*choice[:2]),
                       "--output-format", "stream-json", "--verbose",
                       "--permission-mode", PERMISSION[mode], "--strict-mcp-config",
                       "--disallowedTools", DENY, *flag]  # fmt: skip
            else:
                cmd = providers.task_cmd(self.settings, provider, mode, sid, resume, *choice[:2])
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd, cwd=project, stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    limit=STREAM_LIMIT, env=child_env(),
                )  # fmt: skip
            except OSError as e:
                log.warning("agent for task %s not started: %s", task_id, e)
                raise ApiError(502, "task_launch_failed", detail=type(e).__name__) from None
            try:
                proc.stdin.write(providers.stdin(provider, text))
                await proc.stdin.drain()
                proc.stdin.close()
            except OSError:  # the CLI quit at once (bad flag, unknown session): stderr says why
                if proc.returncode is None:
                    proc.kill()
                err = (await proc.communicate())[1].decode(errors="replace")[-300:]
                log.warning("agent for task %s exited: %s", task_id, err)
                raise ApiError(502, "task_launch_failed") from None
            if provider in providers.OTHERS and not resume:  # its first event names the new session
                session_id = await self._new_thread(task_id, proc, provider)
            self.procs[task_id] = proc
        finally:
            self._starting.discard(task_id)
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
            async for raw in proc.stdout:
                with contextlib.suppress(ValueError):
                    ev = json.loads(raw)
                    for i in providers.items(provider, ev if isinstance(ev, dict) else {}, {}):
                        if i["kind"] == "session" and i["id"]:
                            return i["id"]
            return ""

        try:
            thread = await asyncio.wait_for(first(), 30)
        except TimeoutError:
            thread = ""
        if not thread:
            if proc.returncode is None:
                proc.kill()
            err = (await proc.communicate())[1].decode(errors="replace")[-300:]
            log.warning("%s for task %s gave no session: %s", provider, task_id, err)
            raise ApiError(502, "task_launch_failed")
        return f"{provider}:{thread}"

    async def _pump(self, task_id: str, proc: asyncio.subprocess.Process, choice=("", "", False), provider="claude") -> None:
        got_result, t0, st = False, time.monotonic(), {}
        err = asyncio.create_task(proc.stderr.read())
        try:
            while True:
                try:  # once a result is in, a CLI that stays alive but silent is done, not "running"
                    raw = await asyncio.wait_for(proc.stdout.readline(), AFTER_RESULT_IDLE if got_result else None)
                except TimeoutError:
                    log.info("task %s: no output %ss after its result, ending the run", task_id, AFTER_RESULT_IDLE)
                    proc.kill()
                    break
                if not raw:
                    break
                try:
                    ev = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(ev, dict):
                    continue
                if provider == "claude":
                    found = _items(ev)
                    if ev.get("type") == "result":
                        note_run(self.settings, "agent", choice, ev, time.monotonic() - t0, None)
                else:
                    found = [i for i in providers.items(provider, ev, st) if i["kind"] not in ("session", "reset", "delta")]
                    for i in found:
                        if i["kind"] == "result":
                            run = (st.get("model") or provider, *choice[1:])
                            note_run(self.settings, "agent", run, i.pop("final"), time.monotonic() - t0, None)
                for item in found:
                    self._append(task_id, item)
                    if item["kind"] == "result":
                        got_result = True
                        if not item["error"]:  # a failed turn is not a result
                            task_result_path(self.settings, task_id).write_text(item["text"])
            code = await proc.wait()
            if not got_result:
                note_run(self.settings, "agent", choice, None, time.monotonic() - t0, f"exit_{code}")
                tail = (await err).decode(errors="replace").strip()[-400:]
                self._append(task_id, {"kind": "result", "error": True,
                                       "text": tail or f"Tiến trình dừng (mã {code})."})  # fmt: skip
        except Exception as e:
            log.warning("agent output of task %s failed: %r", task_id, e)
            self._append(task_id, {"kind": "result", "error": True,
                                   "text": f"Lỗi đọc output: {e!r}"})  # fmt: skip
        finally:
            if proc.returncode is None:  # nobody reads its output any more: never leave it running
                proc.kill()
                await proc.wait()
            err.cancel()
            if self.procs.get(task_id) is proc:
                del self.procs[task_id]
            if self.pumps.get(task_id) is asyncio.current_task():
                del self.pumps[task_id]

    async def stop(self, task_id: str) -> None:
        """Stop the run and wait until its pump is done, so nothing writes to the log after."""
        proc = self.procs.get(task_id)
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except TimeoutError:
                proc.kill()
        if pump := self.pumps.get(task_id):
            await asyncio.gather(pump, return_exceptions=True)

    async def stop_all(self) -> None:
        await asyncio.gather(*(self.stop(t) for t in list(self.procs)))

    def new_session(self) -> str:
        return providers.new_session(self.settings)
