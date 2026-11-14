import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from telegram_dashboard.telegram import live_reads as live_reads
from telegram_dashboard.telegram.live_reads import TelegramReads


@pytest.mark.parametrize("kind", ["members", "qa"])
async def test_parallel_pages_share_read_and_keep_ttl(kind):
    reads = TelegramReads()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def fetch(*args):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return []

    bridge = SimpleNamespace(members=fetch, fetch_range=fetch)

    async def request():
        return await reads.members(bridge, "a") if kind == "members" else await reads.qa(bridge, "a", 7)

    first = asyncio.create_task(request())
    second = asyncio.create_task(request())
    await entered.wait()
    release.set()
    assert await asyncio.gather(first, second) == [[], []]
    assert await request() == []
    assert calls == 1
    await reads.aclose()


async def test_cancelled_page_does_not_cancel_shared_telegram_read():
    reads = TelegramReads()
    entered, release = asyncio.Event(), asyncio.Event()

    async def fetch(*args):
        entered.set()
        await release.wait()
        return []

    bridge = SimpleNamespace(members=fetch)
    first = asyncio.create_task(reads.members(bridge, "a"))
    await entered.wait()
    second = asyncio.create_task(reads.members(bridge, "a"))
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert await second == []
    await reads.aclose()


async def test_post_invalidation_does_not_cache_older_read():
    reads = TelegramReads()
    entered, release = asyncio.Event(), asyncio.Event()
    old, new = [SimpleNamespace(reply_to_id=None, message_id=1)], []
    calls = 0

    async def fetch(*args):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            await release.wait()
            return old
        return new

    bridge = SimpleNamespace(fetch_range=fetch)
    previous = asyncio.create_task(reads.qa(bridge, "a", 7))
    await entered.wait()
    reads.invalidate_qa("a")
    assert await reads.qa(bridge, "a", 7) is new
    release.set()
    assert await previous is old
    assert await reads.qa(bridge, "a", 7) is new
    assert calls == 2
    await reads.aclose()


async def test_failed_read_propagates_and_can_be_retried():
    reads = TelegramReads()
    bridge = SimpleNamespace(members=AsyncMock(side_effect=[RuntimeError("offline"), []]))
    with pytest.raises(RuntimeError, match="offline"):
        await reads.members(bridge, "a")
    assert await reads.members(bridge, "a") == []
    assert bridge.members.await_count == 2
    await reads.aclose()


async def test_ttl_expiry_and_independent_chat_keys(monkeypatch):
    reads = TelegramReads()
    bridge = SimpleNamespace(members=AsyncMock(return_value=[]))
    now = 1000.0
    monkeypatch.setattr(live_reads, "monotonic", lambda: now)
    await reads.members(bridge, "a")
    await reads.members(bridge, "b")
    await reads.members(bridge, "a")
    now += live_reads.MEMBERS_TTL
    await reads.members(bridge, "a")
    assert bridge.members.await_count == 3
    await reads.aclose()


async def test_shutdown_cancels_even_invalidated_inflight_reads():
    reads = TelegramReads()
    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def fetch(*args):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    bridge = SimpleNamespace(fetch_range=fetch)
    request = asyncio.create_task(reads.qa(bridge, "a", 7))
    await entered.wait()
    reads.invalidate_qa("a")
    await reads.aclose()
    with pytest.raises(asyncio.CancelledError):
        await request
    assert cancelled.is_set()


async def test_qa_and_members_have_separate_concurrency_lanes():
    reads = TelegramReads()
    release = asyncio.Event()
    full = asyncio.Event()
    active = peak = 0

    async def fetch(*args):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == live_reads.LIVE_READS:
            full.set()
        await release.wait()
        active -= 1
        return []

    bridge = SimpleNamespace(fetch_range=fetch, members=AsyncMock(return_value=[]))
    requests = [asyncio.create_task(reads.qa(bridge, str(i), 7)) for i in range(8)]
    await full.wait()
    assert await reads.members(bridge, "a") == []
    release.set()
    await asyncio.gather(*requests)
    assert peak == live_reads.LIVE_READS
    await reads.aclose()
