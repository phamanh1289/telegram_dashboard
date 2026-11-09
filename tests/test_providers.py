import json

from telegram_dashboard.config import Settings
from telegram_dashboard.providers import items, split_session, task_cmd


def run(p, events):
    st: dict = {}
    return [i for ev in events for i in items(p, ev, st)], st


def test_codex_events_become_the_claude_items():
    out, _ = run("codex", [
        {"type": "thread.started", "thread_id": "th1"},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "Looking."}},
        {"type": "item.completed",
         "item": {"type": "command_execution", "command": "ls", "aggregated_output": "a.py\n", "exit_code": 0}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "One file."}},
        {"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 5}},
    ])  # fmt: skip
    assert out[0] == {"kind": "session", "id": "th1"}
    assert {"kind": "tool", "text": "Shell  ls"} in out
    result = out[-1]
    assert result["text"] == "One file." and not result["error"]  # the last message is the answer
    assert result["final"]["usage"] == {"input_tokens": 60, "output_tokens": 5, "cache_read_input_tokens": 40}


def test_antigravity_answer_is_the_text_after_the_last_tool():
    step = lambda **b: {"event": "step_update", "step_update": {"conversation_id": "c1", **b}}  # noqa: E731
    out, st = run("antigravity", [
        {"event": "init", "conversation_id": "c1", "init": {"model": "gemini-x"}},
        step(step_index=0, state="DONE", step_type="user_input"),
        step(step_index=1, state="ACTIVE", step_type="agent_response", text_delta="Let me "),
        step(step_index=1, state="DONE", step_type="agent_response", text_delta="look."),
        step(step_index=2, state="ACTIVE", step_type="tool", tool_name="view_file",
             tool_info={"parameters": {"AbsolutePath": "/p/a.py"}}),
        step(step_index=2, state="DONE", step_type="tool", tool_name="view_file", tool_info={"output": "x"}),
        step(step_index=3, state="ACTIVE", step_type="agent_response", text_delta="Done."),
        {"event": "result", "result": {"status": "SUCCESS", "response": "Done.\n", "num_turns": 1,
                                       "duration_seconds": 1.5,
                                       "usage": {"input_tokens": 10, "output_tokens": 2, "cache_read_tokens": 4}}},
    ])  # fmt: skip
    kinds = [i["kind"] for i in out if i["kind"] not in ("delta", "session")]
    assert kinds == ["assistant", "reset", "tool", "tool_result", "assistant", "result"]
    assert out[0] == {"kind": "session", "id": "c1"} and out[-1]["text"] == "Done.\n"
    assert out[-1]["final"]["usage"]["input_tokens"] == 6 and out[-1]["final"]["duration_ms"] == 1500
    assert st["model"] == "antigravity/gemini-x"
    bad, _ = run("antigravity", [{"event": "result", "result": {"status": "ERROR", "error": "quota"}}])
    assert bad[-1]["error"] and bad[-1]["text"] == "quota"


def test_sessions_resume_in_the_cli_that_started_them(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))  # agy's agent files
    s = Settings(root=tmp_path)
    assert split_session("codex:th1") == ("codex", "th1")
    assert split_session("1234-uuid") == ("claude", "1234-uuid")
    cmd = task_cmd(s, "codex", "plan", "th1", True, "gpt-6.1-sol", "max")
    assert cmd[:3] == ["codex", "exec", "resume"] and cmd[-2:] == ["th1", "-"]
    assert 'sandbox_mode="read-only"' in cmd and 'model_reasoning_effort="max"' in cmd
    assert cmd[cmd.index("-m") + 1] == "gpt-6.1-sol"
    g = task_cmd(s, "antigravity", "edit", "c1", False, "gemini-x", "")
    assert "--conversation" not in g and g[g.index("--model") + 1] == "gemini-x"
    assert g[g.index("--mode") + 1] == "accept-edits" and g[g.index("--agent") + 1] == "telegram-dashboard-edit"
    gp = g[g.index("--settings") + 1]
    assert '"write_file(*)"' not in gp and '"command(*)"' in gp and '"allow"' not in gp  # agy: no sandbox, no shell
    assert f'read_file({s.data_dir.resolve()})' in gp
    r = task_cmd(s, "antigravity", "plan", "c1", True, "", "")
    assert r[-2:] == ["--conversation", "c1"] and "--model" not in r and "--mode" not in r
    perms = r[r.index("--settings") + 1]
    assert '"write_file(*)"' in perms and '"mcp(*)"' in perms and '"command(*)"' in perms
    agent = (tmp_path / ".gemini/antigravity-cli/agents/telegram-dashboard-edit.md").read_text()
    assert "run_command" not in agent and "write_to_file" in agent


def test_claude_edit_turns_run_bash_in_the_sandbox_and_plan_turns_have_read_tools_only(tmp_path):
    import json

    s = Settings(root=tmp_path)
    e = task_cmd(s, "claude", "edit", "sid", False, "", "")
    box = json.loads(e[e.index("--settings") + 1])["sandbox"]
    assert box["enabled"] and box["allowUnsandboxedCommands"] is False and box["network"]["strictAllowlist"]
    assert "--tools" not in e
    p = task_cmd(s, "claude", "plan", "sid", False, "", "")
    assert p[p.index("--tools") + 1] == "Read,Grep,Glob" and "--settings" not in p
    deny = p[p.index("--disallowedTools") + 2]
    assert f"Read(/{s.data_dir.resolve().as_posix()}/**)" in deny and "Read(~/.ssh/**)" in deny


def test_antigravity_no_tool_answers_get_no_tools(tmp_path, monkeypatch):
    from telegram_dashboard.providers import ask_cmd

    monkeypatch.setenv("HOME", str(tmp_path))
    s = Settings(root=tmp_path)
    c = ask_cmd(s, "antigravity", tools=False, read_dir=None, model="", effort="")
    assert c[c.index("--agent") + 1] == "telegram-dashboard-none" and "read_file(*)" in c[c.index("--settings") + 1]
    assert "tools: []" in (tmp_path / ".gemini/antigravity-cli/agents/telegram-dashboard-none.md").read_text()


def test_a_failed_run_says_why_in_the_clis_words():
    from telegram_dashboard.ai import cli_reason

    gemini = (b"Warning: 256-color support not detected.\n"
              b"An unexpected critical error occurred:IneligibleTierError: This client is no longer supported\n"
              b"    at _doSetupUser (file:///x/chunk.js:1:2)\n")  # fmt: skip
    assert cli_reason(None, gemini) == "IneligibleTierError: This client is no longer supported"
    assert cli_reason({"is_error": True, "result": "quota exceeded"}, b"noise error") == "quota exceeded"
    assert cli_reason(None, b"all fine\n") is None


def test_antigravity_quota_is_the_used_share_of_each_groups_windows(tmp_path, monkeypatch):
    import asyncio

    from telegram_dashboard import providers

    data = {"groups": [{"name": "Gemini Models", "buckets": [
        {"window": "weekly", "remaining_fraction": 0.98, "reset_time": "2026-11-05T02:19:33Z"},
        {"window": "5h", "remaining_fraction": 0.75, "reset_time": "2026-11-03T10:19:36Z"}]}]}  # fmt: skip

    async def out(cmd, *a, **k):
        return 0, json.dumps({"command": {"name": "usage", "data": data}}).encode(), b""

    monkeypatch.setattr(providers, "run_cli", out)
    got = asyncio.run(providers._agy_quota(Settings(root=tmp_path)))
    assert got == [{"label": "5h · Gemini", "percent": 25.0, "resets_at": "2026-11-03T10:19:36Z"},
                   {"label": "1w · Gemini", "percent": 2.0, "resets_at": "2026-11-05T02:19:33Z"}]  # fmt: skip
