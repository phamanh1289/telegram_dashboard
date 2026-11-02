"""Headless Claude Code sessions for tasks: no Terminal, driven and shown from the dashboard.

Each turn is one `claude -p` process (the prompt goes in via stdin); follow-ups resume the same
session id. Output is normalized to a small JSONL log the UI polls. Nothing needs approval here,
so a task runs with a fixed permission mode: `plan` (read-only) or `acceptEdits`.
"""

import asyncio
import json
import logging
import shlex
import uuid
from pathlib import Path

from .claude import model_flags
from .config import child_env, on_path
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.agent")

PERMISSION = {"plan": "plan", "edit": "acceptEdits"}
# Enforced here, not left to ~/.claude settings: no shell or web, no MCP servers, and no edits to
# files that run code later (hooks, git hooks, CI). An Edit(path) rule also covers Write.
DENY = "Bash,WebFetch,WebSearch,Edit(.claude/**),Edit(.git/**),Edit(.github/**)"
STREAM_LIMIT = 32 * 1024 * 1024  # one stream-json line can carry a whole file read


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
        return on_path(self.settings.ai_task_command)

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

    async def start(self, task_id: str, project: str, text: str, mode: str, session_id: str, resume: bool):
        """Run one turn. Returns once the process has the prompt; output streams into the log.
        A new session (not `resume`) replaces the old log and result, once it is running."""
        if self.running(task_id):
            raise ApiError(409, "task_busy")
        self._starting.add(task_id)
        try:
            tasks_dir(self.settings).mkdir(mode=0o700, exist_ok=True)
            flag = ["--resume", session_id] if resume else ["--session-id", session_id]
            cmd = [*self.executable, "-p", *model_flags(self.settings, task=True),
                   "--output-format", "stream-json", "--verbose",
                   "--permission-mode", PERMISSION[mode], "--strict-mcp-config",
                   "--disallowedTools", DENY, *flag]  # fmt: skip
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
                proc.stdin.write(text.encode())
                await proc.stdin.drain()
                proc.stdin.close()
            except OSError:  # the CLI quit at once (bad flag, unknown session): stderr says why
                if proc.returncode is None:
                    proc.kill()
                err = (await proc.communicate())[1].decode(errors="replace")[-300:]
                log.warning("agent for task %s exited: %s", task_id, err)
                raise ApiError(502, "task_launch_failed") from None
            self.procs[task_id] = proc
        finally:
            self._starting.discard(task_id)
        # The pump owns the process from here; it first runs after these sync lines.
        self.pumps[task_id] = asyncio.create_task(self._pump(task_id, proc))
        if not resume:
            task_result_path(self.settings, task_id).unlink(missing_ok=True)
            self.log_path(task_id).unlink(missing_ok=True)
        self._append(task_id, {"kind": "user", "text": text})

    async def _pump(self, task_id: str, proc: asyncio.subprocess.Process) -> None:
        got_result = False
        err = asyncio.create_task(proc.stderr.read())
        try:
            async for raw in proc.stdout:
                try:
                    ev = json.loads(raw)
                except ValueError:
                    continue
                for item in _items(ev):
                    self._append(task_id, item)
                    if item["kind"] == "result":
                        got_result = True
                        if not item["error"]:  # a failed turn is not a result
                            task_result_path(self.settings, task_id).write_text(item["text"])
            code = await proc.wait()
            if not got_result:
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

    @staticmethod
    def new_session() -> str:
        return str(uuid.uuid4())
