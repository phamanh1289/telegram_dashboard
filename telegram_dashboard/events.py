"""SSE: metadata-only notifications; DB revisions are the source of truth."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi.sse import ServerSentEvent

from .storage import Store

HEARTBEAT_SECONDS = 15.0


class Hub:
    """Wakeup hint, always signalled from the event loop. Heartbeat re-checks the DB anyway."""

    def __init__(self) -> None:
        self.version = 0
        self.subscribers = 0
        self._event = asyncio.Event()

    def notify(self) -> None:
        self.version += 1
        self._event.set()

    async def wait(self, timeout: float) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._event.wait(), timeout)
        self._event.clear()


async def event_stream(
    store: Store,
    hub: Hub,
    start_cursor: str | None,
    *,
    alive: Callable[[], Awaitable[bool]],
    status: Callable[[], dict],
    heartbeat: float = HEARTBEAT_SECONDS,
    max_events: int | None = None,
) -> AsyncIterator[ServerSentEvent]:
    """Yield change notifications from start_cursor; `reset` when the cursor is unusable."""
    hub.subscribers += 1
    try:
        pos = start_cursor or await asyncio.to_thread(store.current_cursor)
        last_status = None
        sent = 0
        while await alive():
            items, nxt, has_more, reset = await asyncio.to_thread(
                store.changes_since, pos, 500, False
            )
            if reset:
                yield ServerSentEvent(event="reset", id=nxt, data={"cursor": nxt})
                pos = nxt
                sent += 1
            for it in items:
                yield ServerSentEvent(
                    event="change",
                    id=it.cursor,
                    data={
                        "chat_id": it.chat_id,
                        "message_id": it.message_id,
                        "kind": it.kind,
                        "generation": it.generation,
                    },
                )
                sent += 1
            if items:
                pos = nxt
            st = status()
            if st != last_status:
                last_status = st
                yield ServerSentEvent(event="status", data=st)
                sent += 1
            if max_events is not None and sent >= max_events:
                return
            if has_more:
                continue
            before = hub.version
            await hub.wait(heartbeat)
            if hub.version == before:
                yield ServerSentEvent(comment="keepalive")
    finally:
        hub.subscribers -= 1
