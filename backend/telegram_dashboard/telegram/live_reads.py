"""App-scoped Telegram reads: bounded TTL reuse and shared concurrent requests."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from time import monotonic

from ..models import GroupInfo, Member, StoredMessage
from .bridge import TelegramBridge
from .qa import names_code

LIVE_READS = 4
QA_TTL = 30.0
QA_SCAN = 600
MEMBERS_TTL = 300.0
LATEST_TTL = 30.0  # Briefing's "is there news" per group: every page showing it shares one read
GROUPS_TTL = 60.0  # the account's group list (a full dialog scan): Briefing's "add a group", a chat not known yet


class _Memo[K, V]:
    def __init__(self, ttl: float, capacity: int):
        self.ttl, self.capacity = ttl, capacity
        self.values: dict[K, tuple[float, V]] = {}
        self.pending: dict[K, asyncio.Task[V]] = {}
        self.tasks: set[asyncio.Task[V]] = set()

    async def get(self, key: K, read: Callable[[], Awaitable[V]]) -> V:
        if (hit := self.values.get(key)) and monotonic() - hit[0] < self.ttl:
            return hit[1]
        task = self.pending.get(key)
        if task is None:
            async def load() -> V:
                value = await read()
                # A write may invalidate this read while Telegram is still answering.
                if self.pending.get(key) is asyncio.current_task():
                    self.values.pop(key, None)
                    if len(self.values) >= self.capacity:
                        self.values.pop(next(iter(self.values)))
                    self.values[key] = (monotonic(), value)
                return value

            task = asyncio.create_task(load())
            self.pending[key] = task
            self.tasks.add(task)

            def finished(done: asyncio.Task[V]) -> None:
                self.tasks.discard(done)
                if self.pending.get(key) is done:
                    self.pending.pop(key)
                if not done.cancelled():
                    done.exception()  # observe failure even if every HTTP waiter disconnected

            task.add_done_callback(finished)
        # One disconnected page must not cancel a read another page is awaiting.
        return await asyncio.shield(task)

    def invalidate(self, matches: Callable[[K], bool]) -> None:
        for mapping in (self.values, self.pending):
            for key in list(mapping):
                if matches(key):
                    mapping.pop(key)

    async def aclose(self) -> None:
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.values.clear()
        self.pending.clear()


class TelegramReads:
    def __init__(self):
        # Two lanes, LIVE_READS each: scans (Q&A, Briefing, digests, a history range) and what a click waits for (the
        # @ popup, a message's context, one page of the group), so a long scan never holds a click back.
        self.live = asyncio.Semaphore(LIVE_READS)
        self.quick = asyncio.Semaphore(LIVE_READS)
        self._members = _Memo[str, list[Member]](MEMBERS_TTL, 50)
        self._qa = _Memo[tuple[str, int], tuple[list[StoredMessage], bool]](QA_TTL, 100)
        self._latest = _Memo[str, int](LATEST_TTL, 200)
        self._groups = _Memo[str, list[GroupInfo]](GROUPS_TTL, 1)

    async def members(self, bridge: TelegramBridge, chat_id: str) -> list[Member]:
        async def read():
            async with self.quick:
                return await bridge.members(chat_id)

        return await self._members.get(chat_id, read)

    async def qa(self, bridge: TelegramBridge, chat_id: str, days: int) -> list[StoredMessage]:
        return (await self.qa_scan(bridge, chat_id, days))[0]

    async def qa_scan(self, bridge: TelegramBridge, chat_id: str, days: int) -> tuple[list[StoredMessage], bool]:
        """The group's last `days` (its newest QA_SCAN messages at most), and whether that cap cut the range short:
        older threads are then missing, which the Q&A page says instead of showing "none"."""
        async def read():
            async with self.live:
                until = datetime.now(UTC)
                msgs = await bridge.fetch_range(chat_id, until - timedelta(days=days), until, QA_SCAN + 1)
                if cut := len(msgs) > QA_SCAN:
                    msgs = msgs[-QA_SCAN:]
                older = {m.reply_to_id for m in msgs if m.reply_to_id and names_code(m.text)}
                older -= {m.message_id for m in msgs}
                if older:
                    msgs += await bridge.fetch_ids(chat_id, sorted(older)[-20:])
                return msgs, cut

        return await self._qa.get((chat_id, days), read)

    async def groups(self, bridge: TelegramBridge) -> list[GroupInfo]:
        async def read():
            async with self.live:
                return await bridge.list_groups()

        return await self._groups.get("", read)

    async def scan(self, read: Awaitable):
        """One live read that walks a range (history, the messages a digest item cites), under the scans' cap."""
        async with self.live:
            return await read

    async def click(self, read: Awaitable):
        """One live read a click waits for (a page of the group, a message and its context), under its own cap."""
        async with self.quick:
            return await read

    def forget(self) -> None:
        """Another account logged in: nothing read as the old one is served again."""
        for memo in (self._members, self._qa, self._latest, self._groups):
            memo.invalidate(lambda _key: True)

    async def latest_id(self, bridge: TelegramBridge, chat_id: str) -> int:
        async def read():
            async with self.live:
                return await bridge.ensure_connected().latest_id(chat_id)

        return await self._latest.get(chat_id, read)

    def invalidate_qa(self, chat_id: str) -> None:
        self._qa.invalidate(lambda key: key[0] == chat_id)

    async def aclose(self) -> None:
        await asyncio.gather(*(m.aclose() for m in (self._members, self._qa, self._latest, self._groups)))
