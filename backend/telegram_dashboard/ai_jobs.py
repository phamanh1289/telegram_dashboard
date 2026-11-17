"""AI answers streamed to the page as NDJSON: one request (stream_answer) or a run that outlives its page (AiJobs)."""

import asyncio
import json
import logging
import re
import time

from fastapi.responses import StreamingResponse

from .ai_run import client_gone
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.ai")


async def answer_items(work, put) -> None:
    """Run `work(on_text)` to the NDJSON items of `stream_answer`, each handed to `put`."""
    item = lambda t: {"reset": True} if t is None else {"step": t} if isinstance(t, dict) else {"delta": t}  # noqa: E731
    try:
        put({"done": await work(lambda t: put(item(t)))})
    except ApiError as e:
        put({"error": {"status": e.status, "code": e.code, "detail": e.detail}})
    except Exception as e:
        message = getattr(e, "message", None)  # YtError: already a sentence for the user
        if message is None:
            log.warning("AI stream failed: %r", e)
        put({"error": {"status": getattr(e, "status", 500), "code": "ai_failed",
                       "detail": message or "Lỗi máy chủ khi chạy AI"}})  # fmt: skip


JOB_ID = re.compile(r"^[a-z0-9-]{8,64}$")
JOB_KEEP = 3600.0  # an ended run waits this long for its page to come back for the answer
JOB_MAX = 50  # ended runs kept at most; the oldest go first
# a blank line this often while a run is quiet (the AI thinking for minutes): a proxy cuts a silent stream (`next dev`'s
# rewrite: 30 s), the page then saw an error while the run went on. Readers skip blank lines.
HEARTBEAT = 15.0


class _Job:
    def __init__(self, key: str = "") -> None:
        self.key = key
        self.items: list[dict] = []
        self.changed = asyncio.Event()
        self.task: asyncio.Task | None = None
        self.ended: float | None = None

    def put(self, item: dict) -> None:
        if self.ended is not None:
            return
        self.items.append(item)
        if "done" in item or "error" in item:
            self.ended = time.monotonic()
        self.changed.set()
        self.changed = asyncio.Event()

    def stream(self) -> StreamingResponse:
        """NDJSON of every item from the first, then each one added, to the done / error item."""

        async def lines():
            i = 0
            while True:
                ev = self.changed  # taken before reading: an item added meanwhile sets it
                while i < len(self.items):
                    item = self.items[i]
                    i += 1
                    yield json.dumps(item, ensure_ascii=False) + "\n"
                    if "done" in item or "error" in item:
                        return
                try:
                    await asyncio.wait_for(ev.wait(), HEARTBEAT)
                except TimeoutError:
                    yield "\n"

        return StreamingResponse(lines(), media_type="application/x-ndjson")


class AiJobs:
    """AI runs that outlive their page (YouTrack): closing the view, a reload or a lost connection leaves the run going,
    and the page reads it again by its id, from the start. The page picks the id (it saves it with the session before
    the answer). In memory: a server restart ends them. ponytail: no cap on runs going at once (each is one CLI)."""

    def __init__(self) -> None:
        self._jobs: dict[str, _Job] = {}

    def free(self, job_id: str) -> bool:
        return bool(JOB_ID.match(job_id)) and job_id not in self._jobs

    def start(self, job_id: str, work, key: str = "") -> StreamingResponse:
        """`work(on_text)` in the background (check `free` first); the response streams it like `stream_answer`.
        `key`: one run at a time for it (a ticket's UI flow): an older run still going is stopped, its CLI killed."""
        self._prune()
        for k, j in self._jobs.items():
            if key and j.key == key and j.ended is None:
                self.stop(k)
        job = self._jobs[job_id] = _Job(key)

        async def run():
            client_gone.set(None)  # this task's own context: a page that left doesn't stop it, only `stop`
            await answer_items(work, job.put)

        job.task = asyncio.create_task(run())
        # stopped (even before it ran): readers get an end; a no-op once it has one
        job.task.add_done_callback(lambda _: job.put({"error": {"status": 499, "code": "ai_cancelled",
                                                                "detail": "Đã dừng lượt AI"}}))  # fmt: skip
        return job.stream()

    def attach(self, job_id: str) -> StreamingResponse | None:
        job = self._jobs.get(job_id)
        return job.stream() if job else None

    def stop(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if job and job.task:
            job.task.cancel()

    def status(self) -> dict[str, str]:
        """running / done / error per run kept."""
        return {k: "running" if j.ended is None else "error" if "error" in j.items[-1] else "done"
                for k, j in self._jobs.items()}  # fmt: skip

    async def stop_all(self) -> None:
        tasks = [j.task for j in self._jobs.values() if j.task and not j.task.done()]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)  # the CLIs killed before the server goes

    def _prune(self) -> None:
        now = time.monotonic()
        ended = sorted((j.ended, k) for k, j in self._jobs.items() if j.ended is not None)
        for n, (at, k) in enumerate(ended):
            if now - at > JOB_KEEP or n < len(ended) - JOB_MAX:
                del self._jobs[k]


def stream_answer(work) -> StreamingResponse:
    """NDJSON while Claude writes: {"delta": text} / {"reset": true} / {"step": tool call or output} lines, then
    {"done": result} or {"error": {status, code, detail}}. `work(on_text)` returns the result. Leaving the page
    cancels it, and with it the claude run."""
    q: asyncio.Queue[dict] = asyncio.Queue()

    async def run():
        await answer_items(work, q.put_nowait)

    async def lines():
        task = asyncio.create_task(run())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), HEARTBEAT)
                except TimeoutError:
                    yield "\n"  # see HEARTBEAT
                    continue
                yield json.dumps(item, ensure_ascii=False) + "\n"
                if "done" in item or "error" in item:
                    break
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    return StreamingResponse(lines(), media_type="application/x-ndjson")
