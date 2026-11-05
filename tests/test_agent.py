import asyncio

import pytest

from telegram_dashboard.agent import DENY, AgentRunner, read_task_result
from telegram_dashboard.config import Settings
from telegram_dashboard.errors import ApiError

# Stand-ins for `claude -p`: one answers with a single >64 KiB stream-json line that echoes its
# CLI args; the other keeps the turn running.
LONG = """#!/bin/sh
cat >/dev/null
printf '{"type":"result","result":"%s %s"}\\n' "$(head -c 100000 /dev/zero | tr '\\0' x)" "$*"
"""
SLOW = "#!/bin/sh\ncat >/dev/null\nexec sleep 30\n"


def runner(tmp_path, script: str) -> AgentRunner:
    exe = tmp_path / "claude"
    exe.write_text(script)
    exe.chmod(0o755)
    s = Settings(root=tmp_path, ai_task_command=str(exe), ai_task_model="", ai_task_effort="")
    s.ensure_data_dir()
    return AgentRunner(s)


async def test_long_output_line_and_locked_down_flags(tmp_path):
    r = runner(tmp_path, LONG)
    await r.start("t1", str(tmp_path), "hi", "edit", "s1", False)
    await r.pumps["t1"]
    items, total = r.read("t1")
    assert [i["kind"] for i in items] == ["user", "result"] and total == 2
    assert not items[1]["error"] and not r.running("t1")
    assert read_task_result(r.settings, "t1").startswith("x" * 1000)
    text = items[1]["text"]  # the line was over asyncio's default 64 KiB limit
    assert f"--permission-mode acceptEdits --strict-mcp-config --disallowedTools {DENY}" in text


async def test_one_turn_at_a_time_and_stop_waits_for_the_pump(tmp_path):
    r = runner(tmp_path, SLOW)
    first, second = await asyncio.gather(
        r.start("t1", str(tmp_path), "hi", "plan", "s1", False),
        r.start("t1", str(tmp_path), "again", "plan", "s1", True),
        return_exceptions=True,
    )
    assert first == "s1" and isinstance(second, ApiError) and second.code == "task_busy"
    await r.stop("t1")
    assert not r.running("t1") and r.pumps == {}  # nothing left to write into a reopened log
    items, _ = r.read("t1")
    assert [i["kind"] for i in items] == ["user", "result"] and items[1]["error"]


async def test_failed_spawn_and_corrupt_log(tmp_path):
    r = runner(tmp_path, SLOW)
    with pytest.raises(ApiError) as e:
        await r.start("t1", str(tmp_path / "moved"), "hi", "plan", "s1", False)
    assert e.value.code == "task_launch_failed" and not r.running("t1")
    r.log_path("t2").write_text('{"kind":"user","text":"a"}\n{broken\n{"kind":"res')
    assert r.read("t2") == ([{"kind": "user", "text": "a"}], 2)  # half-written tail not counted


async def test_cli_lingering_after_its_result_ends_the_run(tmp_path, monkeypatch):
    monkeypatch.setattr("telegram_dashboard.agent.AFTER_RESULT_IDLE", 0.2)
    r = runner(tmp_path, '#!/bin/sh\ncat >/dev/null\necho \'{"type":"result","result":"ok"}\'\nexec sleep 30\n')
    await r.start("t1", str(tmp_path), "hi", "plan", "s1", False)
    await asyncio.wait_for(r.pumps["t1"], 5)
    items, _ = r.read("t1")
    assert [i["kind"] for i in items] == ["user", "result"] and not items[1]["error"]
    assert not r.running("t1") and read_task_result(r.settings, "t1") == "ok"


async def test_session_model_and_effort_override_the_task_picks(tmp_path):
    r = runner(tmp_path, LONG)
    await r.start("t1", str(tmp_path), "hi", "plan", "s1", False, ("sonnet", "low"))
    await r.pumps["t1"]
    assert "--model sonnet --effort low" in r.read("t1")[0][1]["text"]
