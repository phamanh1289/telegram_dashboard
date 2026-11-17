"""Durable UI-flow jobs. Other AI sessions keep their existing in-memory lifecycle."""

import asyncio
import contextlib
import json

from fastapi.responses import StreamingResponse

from ..ai_jobs import HEARTBEAT, answer_items
from ..ai_run import client_gone

ACTIVE = {"queued", "running", "cancel_requested"}


class FlowJobs:
    def __init__(self, store):
        self.store = store
        self.tasks = {}
        self.changed = asyncio.Event()
        self.closing = False
        self.lifecycle = asyncio.Lock()

    async def call(self, method, *args, **kwargs):
        return await asyncio.to_thread(getattr(self.store, method), *args, **kwargs)

    async def get(self, scope, job):
        return await self.call("flow_job_get", scope, job)

    async def update(self, scope, job, **values):
        await self.call("flow_job_update", scope, job, **values)
        self.changed.set()
        self.changed = asyncio.Event()

    async def start(self, scope, job, issue, base, work, *, request=None):
        async with self.lifecycle:
            return await self._start(scope, job, issue, base, work, request=request)

    async def _start(self, scope, job, issue, base, work, *, request=None):
        if not await self.call("flow_job_create", scope, job, issue, base, request):
            existing = await self.get(scope, job)
            if existing["status"] == "cancelled":
                return self.stream(scope, job)
            return None
        for old in await self.call("flow_job_get", scope, issue=issue):
            if old["id"] != job and old["status"] in ACTIVE:
                await self._cancel(scope, old["id"])

        async def run():
            queue = asyncio.Queue()

            async def flush():
                while True:
                    item = await queue.get()
                    try:
                        if item is None:
                            return
                        async with self.lifecycle:
                            await self.call("flow_job_event", scope, job, item)
                        self.changed.set()
                        self.changed = asyncio.Event()
                    finally:
                        queue.task_done()

            writer = asyncio.create_task(flush())
            producer = None
            try:
                client_gone.set(None)
                async with self.lifecycle:
                    current = await self.get(scope, job)
                    if current["status"] != "queued":
                        return
                    await self.update(scope, job, status="running")
                producer = asyncio.create_task(answer_items(work, queue.put_nowait))
                done, _ = await asyncio.wait((producer, writer), return_when=asyncio.FIRST_COMPLETED)
                if writer in done:
                    await writer  # propagate a failed database write instead of waiting on queue.join forever
                await producer
                queue.put_nowait(None)
                await writer
            except asyncio.CancelledError:
                current = await self.get(scope, job)
                if current["status"] in ACTIVE:
                    await self.update(scope, job, status="interrupted" if self.closing else "cancelled")
                raise
            except Exception:
                await self.update(scope, job, status="failed", error={"status": 500, "code": "flow_storage_failed"})
            finally:
                for pending in (producer, writer):
                    if pending and not pending.done():
                        pending.cancel()
                await asyncio.gather(*(t for t in (producer, writer) if t), return_exceptions=True)

        task = asyncio.create_task(run())
        self.tasks[scope, job] = task
        def ended(task):
            self.tasks.pop((scope, job), None)
            if not task.cancelled():
                task.exception()  # persisted failure or unavailable database; no orphan exception warning
        task.add_done_callback(ended)
        return self.stream(scope, job)

    async def cancel(self, scope, job):
        async with self.lifecycle:
            return await self._cancel(scope, job)

    async def _cancel(self, scope, job):
        await self.call("flow_job_create", scope, job)
        current = await self.get(scope, job)
        if current["status"] in ACTIVE:
            await self.update(scope, job, status="cancel_requested")
            task = self.tasks.get((scope, job))
            if task and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await self.update(scope, job, status="cancelled")
        return await self.get(scope, job)

    def stream(self, scope, job, after=0):
        async def lines():
            nonlocal after
            while True:
                changed = self.changed
                events = await self.call("flow_job_events", scope, job, after)
                for item in events:
                    after = item["cursor"]
                    yield json.dumps(item, ensure_ascii=False) + "\n"
                    if "done" in item or "error" in item:
                        return
                current = await self.get(scope, job)
                if current and current["cursor"] > after:
                    continue  # terminal transaction committed between the events and metadata reads
                if not current or current["status"] not in ACTIVE:
                    if current and current["status"] == "succeeded":
                        # Recovery may complete a checkpoint before its terminal event was committed.
                        if not any("done" in e for e in events):
                            yield json.dumps({"done": current["result"], "cursor": after}, ensure_ascii=False) + "\n"
                    elif current and not any("error" in e for e in events):
                        yield json.dumps({"error": current["error"] or {"status": 499, "code":
                            "ai_interrupted" if current["status"] == "interrupted" else "ai_cancelled"},
                            "cursor": after}) + "\n"
                    return
                try:
                    await asyncio.wait_for(changed.wait(), HEARTBEAT)
                except TimeoutError:
                    yield "\n"
        return StreamingResponse(lines(), media_type="application/x-ndjson")

    async def close(self):
        self.closing = True
        tasks = [task for task in self.tasks.values() if not task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
