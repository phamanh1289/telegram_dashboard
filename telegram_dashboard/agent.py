"""Headless Claude Code sessions for tasks: no Terminal, driven and shown from the dashboard.

Each turn is one `claude -p` process (the prompt goes in via stdin); follow-ups resume the same
session id. Output is normalized to a small JSONL log the UI polls. Nothing needs approval here,
so a task runs with a fixed permission mode: `plan` (read-only) or `acceptEdits`.
"""

import asyncio
import json
import shlex
import shutil
import uuid
from pathlib import Path

from .ai import model_flags, task_result_path

PERMISSION = {"plan": "plan", "edit": "acceptEdits"}


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
        self._pumps: set[asyncio.Task] = set()

    @property
    def executable(self) -> list[str]:
        return shlex.split(self.settings.ai_task_command)

    @property
    def available(self) -> bool:
        exe = self.executable
        return bool(exe) and shutil.which(exe[0]) is not None

    def log_path(self, task_id: str) -> Path:
        return self.settings.data_dir / "tasks" / f"{task_id}.log.jsonl"

    def running(self, task_id: str) -> bool:
        return task_id in self.procs

    def read(self, task_id: str, after: int = 0) -> tuple[list[dict], int]:
        """(items after line `after`, total lines)."""
        p = self.log_path(task_id)
        lines = [ln for ln in p.read_text().splitlines() if ln.strip()] if p.is_file() else []
        return [json.loads(ln) for ln in lines[after:]], len(lines)

    def _append(self, task_id: str, item: dict) -> None:
        with self.log_path(task_id).open("a") as f:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    async def start(self, task_id: str, project: str, text: str, mode: str, session_id: str, resume: bool):
        """Run one turn. Returns once the process is spawned; output streams into the log."""
        (self.settings.data_dir / "tasks").mkdir(mode=0o700, exist_ok=True)
        flag = ["--resume", session_id] if resume else ["--session-id", session_id]
        cmd = [*self.executable, "-p", *model_flags(self.settings, task=True), "--output-format", "stream-json", "--verbose",
               "--permission-mode", PERMISSION[mode], *flag]  # fmt: skip
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=project, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )  # fmt: skip
        self.procs[task_id] = proc
        self._append(task_id, {"kind": "user", "text": text})
        proc.stdin.write(text.encode())
        await proc.stdin.drain()
        proc.stdin.close()
        pump = asyncio.create_task(self._pump(task_id, proc))
        self._pumps.add(pump)
        pump.add_done_callback(self._pumps.discard)

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
        finally:
            self.procs.pop(task_id, None)

    async def stop(self, task_id: str) -> None:
        proc = self.procs.get(task_id)
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except TimeoutError:
                proc.kill()

    async def stop_all(self) -> None:
        for task_id in list(self.procs):
            await self.stop(task_id)

    @staticmethod
    def new_session() -> str:
        return str(uuid.uuid4())
