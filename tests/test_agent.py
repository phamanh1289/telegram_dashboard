import asyncio
import dataclasses

import pytest

from telegram_dashboard.agent import AgentRunner, read_task_result
from telegram_dashboard.config import Settings
from telegram_dashboard.errors import ApiError
from telegram_dashboard.providers import ALLOW, DENY

# Stand-ins for `claude -p`: one answers with a single >64 KiB stream-json line that echoes its
# CLI args; the other keeps the turn running.
LONG = """#!/bin/sh
cat >/dev/null
args=$(printf '%s' "$*" | sed 's/"/\\\\"/g')
printf '{"type":"result","result":"%s %s"}\\n' "$(head -c 100000 /dev/zero | tr '\\0' x)" "$args"
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
    assert f"--permission-mode acceptEdits --strict-mcp-config --allowedTools {ALLOW['edit']} " in text
    assert f"--disallowedTools {DENY}" in text
    assert '--settings {"sandbox": {"enabled": true' in text  # edit turns: Bash in the sandbox


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
    assert items[1]["text"] == "Đã dừng."  # not "mã 143": say who stopped it
    await r.start("t1", str(tmp_path), "again", "plan", "s1", True)
    await r.stop_all()  # server shutdown / restart
    assert r.read("t1")[0][-1]["text"].startswith("Server khởi động lại")


async def test_failed_spawn_and_corrupt_log(tmp_path):
    r = runner(tmp_path, SLOW)
    with pytest.raises(ApiError) as e:
        await r.start("t1", str(tmp_path / "moved"), "hi", "plan", "s1", False)
    assert e.value.code == "task_launch_failed" and not r.running("t1")
    r.log_path("t2").write_text('{"kind":"user","text":"a"}\n{broken\n{"kind":"res')
    assert r.read("t2") == ([{"kind": "user", "text": "a"}], 2)  # half-written tail not counted


async def test_cli_lingering_after_its_result_ends_the_run(tmp_path, monkeypatch):
    monkeypatch.setattr("telegram_dashboard.agent.AFTER_RESULT_IDLE", 0.2)
    r = runner(tmp_path, '#!/bin/sh\ncat >/dev/null\n'
                         'echo \'{"type":"result","result":"ok","total_cost_usd":0.123456}\'\nexec sleep 30\n')
    await r.start("t1", str(tmp_path), "hi", "plan", "s1", False)
    await asyncio.wait_for(r.pumps["t1"], 5)
    items, _ = r.read("t1")
    assert [i["kind"] for i in items] == ["user", "result"] and not items[1]["error"]
    assert items[1]["cost"] == 0.1235  # the session page sums its turns' cost
    assert not r.running("t1") and read_task_result(r.settings, "t1") == "ok"


async def test_empty_zero_turn_result_on_resume_does_not_end_the_turn(tmp_path, monkeypatch):
    monkeypatch.setattr("telegram_dashboard.agent.AFTER_RESULT_IDLE", 0.2)  # AI-7182ea: killed mid-turn
    r = runner(tmp_path, "#!/bin/sh\ncat >/dev/null\necho '{\"type\":\"result\",\"result\":\"\",\"num_turns\":0}'\n"
               "sleep 0.5\necho '{\"type\":\"result\",\"result\":\"ok\",\"num_turns\":3}'\n")  # fmt: skip
    await r.start("t1", str(tmp_path), "hi", "plan", "s1", True)
    await asyncio.wait_for(r.pumps["t1"], 5)
    assert [(i["kind"], i.get("text")) for i in r.read("t1")[0]] == [("user", "hi"), ("result", "ok")]


async def test_stop_while_starting_cancels_the_launch(tmp_path):
    r = runner(tmp_path, SLOW)  # as Codex: it never names its session, so start() waits for it
    r.settings = dataclasses.replace(r.settings, codex_command=r.settings.ai_task_command)
    start = asyncio.ensure_future(r.start("t1", str(tmp_path), "hi", "plan", "codex:", False))
    while r._starting.get("t1") is None:
        await asyncio.sleep(0.01)
    await r.stop("t1")
    with pytest.raises(ApiError) as e:
        await asyncio.wait_for(start, 5)
    assert e.value.code == "task_cancelled" and not r.running("t1") and r.procs == {}
    assert not r.log_path("t1").exists()


async def test_running_while_the_prompt_is_made(tmp_path):
    r, gate = runner(tmp_path, LONG), asyncio.Event()

    async def text() -> str:  # reading links: seconds the page must show running, not stopped
        await gate.wait()
        return "hi"

    start = asyncio.ensure_future(r.start("t1", str(tmp_path), text, "plan", "s1", False))
    await asyncio.sleep(0.05)
    assert r.running("t1")
    with pytest.raises(ApiError) as e:  # a second send meanwhile
        await r.start("t1", str(tmp_path), "again", "plan", "s1", True)
    assert e.value.code == "task_busy"
    gate.set()
    await asyncio.wait_for(start, 5)
    await r.pumps["t1"]
    assert r.read("t1")[0][0]["text"] == "hi"


async def test_session_model_and_effort_override_the_task_picks(tmp_path):
    r = runner(tmp_path, LONG)
    await r.start("t1", str(tmp_path), "hi", "plan", "s1", False, ("sonnet", "low"))
    await r.pumps["t1"]
    assert "--model sonnet --effort low" in r.read("t1")[0][1]["text"]


async def test_git_changes_and_pr_leave_secrets_out(tmp_path, monkeypatch):
    import subprocess

    from telegram_dashboard import gitops

    for k in ("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"):
        monkeypatch.setenv(k, "t")
    for k in ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"):
        monkeypatch.setenv(k, "t@t")
    remote, repo = tmp_path / "remote.git", tmp_path / "repo"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    g = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True)  # noqa: E731
    (repo / "a.txt").write_text("1\n")
    g("add", ".")
    g("commit", "-qm", "init")
    g("remote", "add", "origin", str(remote))
    (repo / "a.txt").write_text("2\n")
    (repo / ".env").write_text("TOKEN=x\n")
    c = await gitops.changes(str(repo))
    assert c["branch"] == "main" and {f["path"]: f["secret"] for f in c["files"]} == {"a.txt": False, ".env": True}
    assert "+2" in c["diff"]
    monkeypatch.setenv("PATH", "/usr/bin:/bin")  # no gh here: the branch is pushed, the PR left to the user
    r = await gitops.open_pr(str(repo), "ai/x", "Sửa a", "")
    assert r["branch"] == "ai/x" and r["skipped"] == [".env"] and r["url"] is None
    shown = subprocess.run(["git", "-C", str(remote), "show", "--name-only", "--format=", "ai/x"],
                           capture_output=True, text=True).stdout
    assert shown.split() == ["a.txt"]


def test_prime_codegraph_leaves_the_wal_files_a_read_only_sandbox_needs(tmp_path):
    import sqlite3

    from telegram_dashboard.agent import prime_codegraph

    (tmp_path / ".codegraph").mkdir()
    db = tmp_path / ".codegraph" / "codegraph.db"
    c = sqlite3.connect(db)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE t (x)")
    c.close()  # the last writer: -wal / -shm deleted, as with no codegraph daemon running
    assert not (tmp_path / ".codegraph" / "codegraph.db-shm").exists()
    prime_codegraph(str(tmp_path))
    assert (tmp_path / ".codegraph" / "codegraph.db-shm").exists()
    prime_codegraph(str(tmp_path / "no-index"))  # no index: nothing to do
