import asyncio
import contextlib

import pytest
from telegram_dashboard.errors import ApiError


@pytest.mark.parametrize("outcome", ["success", "error", "cancel"])
def test_log_poll_keeps_running_when_turn_finishes_during_snapshot(client, monkeypatch, outcome):
    """A user-only snapshot must not stop polling when the final result lands during the read."""
    state = client.app.state
    task_id = "final-log-race"
    state.store.add_task(task_id, None, None, "", "ask", kind="assist")
    agent = state.agent

    async def start():
        gate = asyncio.Event()

        async def run():
            await gate.wait()
            if outcome == "error":
                raise ApiError(502, "ai_provider_error")
            return "final answer"

        task = agent.side_start(task_id, {"text": "ask"}, run, lambda result: result)
        return gate, task

    gate, turn = client.portal.call(start)
    original_read = agent.read

    def snapshot_then_finish(tid, after=0):
        snapshot = original_read(tid, after)

        async def finish():
            if outcome == "cancel":
                turn.cancel()
            else:
                gate.set()
            with contextlib.suppress(ApiError, asyncio.CancelledError):
                await turn
            assert not agent.running(tid)

        client.portal.call(finish)
        return snapshot

    monkeypatch.setattr(agent, "read", snapshot_then_finish)
    first = client.get(f"/api/tasks/{task_id}/events")
    assert first.status_code == 200
    first = first.json()
    assert [item["kind"] for item in first["items"]] == ["user"]
    assert first["running"] is True  # the result is newer than this snapshot: keep polling

    last = client.get(f"/api/tasks/{task_id}/events", params={"after": first["next"]})
    assert last.status_code == 200
    last = last.json()
    assert [item["kind"] for item in last["items"]] == ["result"]
    assert last["items"][0]["error"] is (outcome != "success")
    assert last["running"] is False
    assert last["next"] == last["total"] == 2
    if outcome == "success":
        assert last["items"][0]["text"] == "final answer"
