import asyncio
import json
import shlex
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from ai_test_helpers import expect
from conftest import A, msg
from telegram_dashboard.ai import AiService
from telegram_dashboard.config import Settings
from telegram_dashboard.errors import ApiError
from telegram_dashboard.models import ReplyRequest

STREAM_CLAUDE = """#!/bin/sh
cat > "$0.prompt"
echo "$@" > "$0.args"
echo '{"type":"stream_event","event":{"type":"message_start"}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Xin "}}}'
echo 'not json'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"chào"}}}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/p/A.kt"}}]}}'
echo '{"type":"user","message":{"content":[{"type":"tool_result","content":"class A"}]}}'
echo '{"type":"result","is_error":false,"result":"Xin chào","session_id":"s-123"}'
"""


async def test_provider_timeout_keeps_manual_reply_available(env, tmp_path, monkeypatch):
    monkeypatch.setattr("telegram_dashboard.ai_run.AGENT_TIMEOUT", 0.2)
    env.track(A)
    env.store.apply_message(msg(A, 1, "hello", sender="7"))
    s = Settings(root=tmp_path, ai_agent_command="sleep 5", ai_model="", ai_effort="")
    await expect("ai_timeout", AiService(s, env.store, env.db).run("draft", A, ["1"], ""))
    rec = await env.bridge.submit_reply(
        ReplyRequest(request_id=uuid.uuid4(), chat_id=A, reply_to_message_id="1", text="manual")
    )
    assert rec.status == "sent"


async def test_cancelled_request_kills_the_claude_run(env, tmp_path):
    from telegram_dashboard.ai_run import client_gone

    env.track(A)
    env.store.apply_message(msg(A, 1, "hello", sender="7"))
    s = Settings(
        root=tmp_path, ai_agent_command="sleep 30", ai_model="", ai_effort=""
    )

    async def gone():
        return True

    client_gone.set(gone)
    t0 = time.monotonic()
    await expect("ai_cancelled", AiService(s, env.store, env.db).run("draft", A, ["1"], ""))
    assert time.monotonic() - t0 < 5


async def test_agent_command_gets_prompt_on_stdin(env, tmp_path):
    env.track(A)
    env.store.apply_message(msg(A, 1, "hello", sender="7"))
    s = Settings(root=tmp_path, ai_agent_command="cat", ai_model="", ai_effort="")
    r = await AiService(s, env.store, env.db).run("draft", A, ["1"], "be brief")
    assert "hello" in r.text and "be brief" in r.text


async def test_agent_command_failure_is_provider_error(env, tmp_path):
    env.track(A)
    env.store.apply_message(msg(A, 1, "hello", sender="7"))
    s = Settings(root=tmp_path, ai_agent_command="false", ai_model="", ai_effort="")
    with pytest.raises(ApiError) as e:
        await AiService(s, env.store, env.db).run("draft", A, ["1"])
    assert e.value.code == "ai_provider_error"


async def test_ask_streams_pieces_and_returns_the_final_answer(tmp_path):
    exe = tmp_path / "claude"
    exe.write_text(STREAM_CLAUDE)
    exe.chmod(0o755)
    s = Settings(root=tmp_path, ai_agent_command=shlex.quote(str(exe)), ai_model="", ai_effort="",
                 ai_task_model="sonnet", ai_task_effort="")  # fmt: skip
    svc = AiService(s, None, None)
    parts = []
    assert await svc.ask("hỏi", on_text=parts.append, heavy=True, ref="YT-abc123") == "Xin chào"
    steps = [p for p in parts if isinstance(p, dict)]
    assert [p for p in parts if not isinstance(p, dict)] == [None, "Xin ", "chào"]
    # the working steps go to the page too (YouTrack AI shows them like AI Agent)
    assert [(p["kind"], p["text"]) for p in steps] == [("tool", "Read  /p/A.kt"), ("tool_result", "class A")]
    assert all(isinstance(p["at"], float) for p in steps)
    args = (tmp_path / "claude.args").read_text()
    assert "--include-partial-messages" in args and "--model sonnet" in args  # heavy: task model
    assert (tmp_path / "claude.prompt").read_text().endswith("hỏi")
    from telegram_dashboard import claude

    await asyncio.gather(*claude._bg)
    [run] = claude.claude_runs(s, 1)
    assert run["feature"] == "ai" and run["model"] == "sonnet" and run["ok"]
    # a bug report's session code finds the run, and Claude's session id its transcript
    assert run["ref"] == "YT-abc123" and run["sid"] == "s-123"


def test_startup_prunes_old_runs_and_photos(tmp_path):
    import os

    from telegram_dashboard import claude
    from telegram_dashboard.telegram.routes import MEDIA_DAYS, prune_media

    s = Settings(root=tmp_path)
    s.ensure_data_dir()
    old = (datetime.now(UTC) - timedelta(days=claude.RUNS_DAYS + 1)).isoformat(timespec="seconds")
    new = datetime.now(UTC).isoformat(timespec="seconds")
    runs = s.data_dir / "claude_runs.jsonl"
    runs.write_text(f'{{"at": "{old}"}}\nnot json\n{{"at": "{new}", "feature": "ai"}}\n')
    claude.prune_runs(s)
    assert claude.claude_runs(s, claude.RUNS_DAYS) == [{"at": new, "feature": "ai"}]
    assert len(runs.read_text().splitlines()) == 1 and runs.stat().st_mode & 0o777 == 0o600

    media = s.data_dir / "media"
    media.mkdir()
    for name in ("100123_1.jpg", "100123_2.jpg", "1001234_3.jpg", "555_4.jpg"):
        (media / name).write_bytes(b"x")
    stale = time.time() - (MEDIA_DAYS + 1) * 86_400
    os.utime(media / "555_4.jpg", (stale, stale))
    prune_media(s)  # startup: only the stale one
    assert sorted(p.name for p in media.iterdir()) == ["1001234_3.jpg", "100123_1.jpg", "100123_2.jpg"]
    prune_media(s, "-100123")  # Xóa dữ liệu nhóm: that group's photos, not a longer id sharing its prefix
    assert [p.name for p in media.iterdir()] == ["1001234_3.jpg"]


async def test_cli_quitting_before_reading_a_big_prompt_says_why(tmp_path):
    exe = tmp_path / "claude"  # quits at once (not logged in): a >64 KiB prompt hits a closed pipe
    exe.write_text('#!/bin/sh\necho \'{"type":"result","is_error":true,"result":"Not logged in"}\'\nexit 1\n')
    exe.chmod(0o755)
    s = Settings(root=tmp_path, ai_agent_command=shlex.quote(str(exe)), ai_model="", ai_effort="")
    with pytest.raises(ApiError) as e:
        await AiService(s, None, None).ask("x" * 300_000)
    assert (e.value.code, e.value.detail) == ("ai_provider_error", "Not logged in")


async def test_a_background_ai_run_outlives_its_reader_and_is_read_again_from_the_start():

    from telegram_dashboard.ai_jobs import AiJobs

    jobs, gate = AiJobs(), asyncio.Event()

    async def work(on_text):
        on_text("Xin ")
        await gate.wait()
        on_text("chào")
        return {"text": "Xin chào"}

    lines = jobs.start("job-12345678", work).body_iterator
    assert json.loads(await anext(lines)) == {"delta": "Xin "}
    await lines.aclose()  # the page left
    assert jobs.status() == {"job-12345678": "running"} and not jobs.free("job-12345678") and not jobs.free("BAD")
    gate.set()
    await jobs._jobs["job-12345678"].task
    got = [json.loads(x) async for x in jobs.attach("job-12345678").body_iterator]
    assert got == [{"delta": "Xin "}, {"delta": "chào"}, {"done": {"text": "Xin chào"}}]

    jobs.start("job-87654321", lambda on_text: asyncio.Event().wait())
    jobs.stop("job-87654321")
    await asyncio.gather(jobs._jobs["job-87654321"].task, return_exceptions=True)
    assert jobs.status()["job-87654321"] == "error" and jobs.attach("nope-0000") is None


async def test_a_quiet_ai_run_keeps_its_stream_alive_and_a_new_run_of_the_same_key_stops_the_old(monkeypatch):
    import telegram_dashboard.ai_jobs as ai_jobs

    monkeypatch.setattr(ai_jobs, "HEARTBEAT", 0.01)
    jobs = ai_jobs.AiJobs()
    lines = jobs.start("old-12345678", lambda on_text: asyncio.Event().wait(), key="flow:VA-1").body_iterator
    assert await anext(lines) == "\n"  # nothing to say yet: a blank line, so no proxy cuts the stream
    await lines.aclose()
    jobs.start("other-1234567", lambda on_text: asyncio.Event().wait(), key="flow:VA-2")
    jobs.start("new-12345678", lambda on_text: asyncio.Event().wait(), key="flow:VA-1")
    await asyncio.gather(jobs._jobs["old-12345678"].task, return_exceptions=True)
    assert jobs.status() == {"old-12345678": "error", "other-1234567": "running", "new-12345678": "running"}
    for k in ("other-1234567", "new-12345678"):
        jobs.stop(k)
    await asyncio.gather(*(j.task for j in jobs._jobs.values()), return_exceptions=True)


async def test_overloaded_provider_is_tried_once_more(tmp_path):
    exe, count = tmp_path / "claude", tmp_path / "n"  # first run: overloaded; second: the answer
    exe.write_text(f'#!/bin/sh\ncat >/dev/null\nif [ -f {count} ]; then\n'
                   'echo \'{"type":"result","is_error":false,"result":"ok"}\'\nelse\n'
                   f'touch {count}\necho \'{{"type":"result","is_error":true,"result":"API Error: 529 Overloaded"}}\''
                   '\nexit 1\nfi\n')
    exe.chmod(0o755)
    s = Settings(root=tmp_path, ai_agent_command=shlex.quote(str(exe)), ai_model="", ai_effort="")
    assert await AiService(s, None, None).ask("hi") == "ok"
    count.unlink()  # a login error is not retried
    exe.write_text('#!/bin/sh\ncat >/dev/null\n'
                   'echo \'{"type":"result","is_error":true,"result":"Not logged in"}\'\nexit 1\n')
    with pytest.raises(ApiError):
        await AiService(s, None, None).ask("hi")
    assert not count.exists()
