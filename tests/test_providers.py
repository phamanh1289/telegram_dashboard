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
    assert f"read_file({s.data_dir.resolve()})" in gp
    r = task_cmd(s, "antigravity", "plan", "c1", True, "", "")
    assert r[-2:] == ["--conversation", "c1"] and "--model" not in r and "--mode" not in r
    perms = r[r.index("--settings") + 1]
    assert '"write_file(*)"' in perms and '"mcp(*)"' in perms and '"command(*)"' in perms
    agent = (tmp_path / ".gemini/antigravity-cli/agents/telegram-dashboard-edit.md").read_text()
    assert "run_command" not in agent and "write_to_file" in agent


def test_claude_edit_turns_run_bash_in_the_sandbox_and_plan_turns_have_read_tools_only(tmp_path, monkeypatch):
    import json

    monkeypatch.setenv("HOME", str(tmp_path))  # agy's agent files and saved grants, Codex's config
    s = Settings(root=tmp_path)
    e = task_cmd(s, "claude", "edit", "sid", False, "", "")
    box = json.loads(e[e.index("--settings") + 1])["sandbox"]
    assert box["enabled"] and box["allowUnsandboxedCommands"] is False and box["network"]["strictAllowlist"]
    assert "--tools" not in e and "Gradle" in e[e.index("--append-system-prompt") + 1]
    p = task_cmd(s, "claude", "plan", "sid", False, "", "")
    assert p[p.index("--tools") + 1] == "Read,Grep,Glob,Skill" and "--settings" not in p
    deny = p[p.index("--disallowedTools") + 2]
    assert f"Read(/{s.data_dir.resolve().as_posix()}/**)" in deny and "Read(~/.ssh/**)" in deny
    assert "--mcp-config" not in p  # no index: no MCP server at all
    # an indexed project: its codegraph MCP, one read-only tool, no shell, telemetry off
    i = task_cmd(s, "claude", "plan", "sid", False, "", "", index=True)
    server = json.loads(i[i.index("--mcp-config") + 1])["mcpServers"]["codegraph"]
    assert server["args"] == ["serve", "--mcp"] and server["env"] == {"DO_NOT_TRACK": "1"}
    assert i[i.index("--allowedTools") + 1] == "Read,Grep,Glob,Skill,mcp__codegraph__codegraph_explore"
    assert "--strict-mcp-config" in i and i[i.index("--tools") + 1] == "Read,Grep,Glob,Skill"
    # the user's own MCP servers / plugins: only an edit turn they ticked it for; Bash stays sandboxed
    m = task_cmd(s, "claude", "edit", "sid", True, "", "", mcp=True)
    assert "--strict-mcp-config" not in m and m[m.index("--allowedTools") + 1].endswith(",mcp__*") and "--settings" in m
    assert "--strict-mcp-config" in task_cmd(s, "claude", "plan", "sid", True, "", "", mcp=True)
    # a Zeplin link: the user's zeplin server only, its read-only tools, read-only turns too
    zs = {"type": "stdio", "command": "npx", "args": ["-y", "@zeplin/mcp-server"], "env": {"ZEPLIN_ACCESS_TOKEN": "x"}}
    z = task_cmd(s, "claude", "plan", "sid", True, "", "", index=True, zeplin=zs)
    assert set(json.loads(z[z.index("--mcp-config") + 1])["mcpServers"]) == {"codegraph", "zeplin"}
    assert z[z.index("--allowedTools") + 1].endswith(",mcp__zeplin__get_design_tokens") and "--strict-mcp-config" in z
    assert "download_layer_asset" not in z[z.index("--allowedTools") + 1]
    assert "mcp__zeplin__download_layer_asset" in z[z.index("--disallowedTools") :]  # past a user's allow rule
    assert z[z.index("--permission-mode") + 1] == "default" and z[z.index("--tools") + 1] == "Read,Grep,Glob,Skill"
    assert "ZEPLIN_ACCESS_TOKEN" in z[z.index("--mcp-config") + 1] and '"x"' not in " ".join(z)  # by ${NAME} only
    # Codex: read-only zeplin tools approved ahead, token from the env; with MCP on, the user's config
    c = task_cmd(s, "codex", "plan", "codex:", False, "", "", zeplin=zs)
    assert "--ignore-user-config" in c and 'mcp_servers.zeplin.env_vars=["ZEPLIN_ACCESS_TOKEN"]' in c
    assert 'mcp_servers.zeplin.default_tools_approval_mode="approve"' in c and '"x"' not in " ".join(c)
    assert "--ignore-user-config" not in task_cmd(s, "codex", "edit", "codex:", False, "", "", mcp=True)
    assert "--ignore-user-config" in task_cmd(s, "codex", "plan", "codex:", False, "", "", mcp=True)
    # Antigravity: an agent with the user's MCP servers, only the allowed tools; never a shell
    (tmp_path / ".gemini" / "config").mkdir(parents=True)
    grants = '{"allow": ["mcp(context_mode/ctx_execute)", "mcp(zeplin/get_screen)"]}'
    (tmp_path / ".gemini" / "config" / "config.json").write_text(grants)
    a = task_cmd(s, "antigravity", "plan", "agy:", False, "", "", zeplin=zs)
    perms = json.loads(a[a.index("--settings") + 1])["permissions"]
    assert perms["allow"] == ["mcp(zeplin/get_screen)", "mcp(zeplin/get_component)", "mcp(zeplin/get_design_tokens)"]
    assert (
        "mcp(*)" not in perms["deny"] and "command(*)" in perms["deny"] and a[a.index("--agent") + 1].endswith("-mcp")
    )
    # the user's saved "always allow" grants would run too (a deny wins): denied, all but the read tools
    assert "mcp(context_mode/ctx_execute)" in perms["deny"] and "mcp(zeplin/download_layer_asset)" in perms["deny"]
    assert "mcp(zeplin/get_screen)" not in perms["deny"]
    e = task_cmd(s, "antigravity", "edit", "agy:", False, "", "", mcp=True)
    perms = json.loads(e[e.index("--settings") + 1])["permissions"]
    assert perms["allow"] == ["mcp(*)"] and "command(*)" in perms["deny"]
    n = task_cmd(s, "antigravity", "plan", "agy:", False, "", "")  # no link, no MCP: none at all
    assert "mcp(*)" in json.loads(n[n.index("--settings") + 1])["permissions"]["deny"]


def test_an_answer_runs_commands_only_in_the_sandbox_and_never_edits(tmp_path, monkeypatch):
    import json

    from telegram_dashboard.providers import ask_cmd

    monkeypatch.setenv("HOME", str(tmp_path))
    s = Settings(root=tmp_path)
    c = ask_cmd(s, "claude", tools=True, read_dir=None, model="", effort="", shell=True)
    assert c[c.index("--tools") + 1] == "Read,Grep,Glob,Skill,Bash" and "Edit" not in c[c.index("--allowedTools") + 1]
    box = json.loads(c[c.index("--settings") + 1])["sandbox"]
    assert box["enabled"] and box["allowUnsandboxedCommands"] is False and box["network"]["strictAllowlist"]
    assert "Bash(curl:*)" in c[c.index("--disallowedTools") + 1] and "--strict-mcp-config" in c
    assert "Bash" not in " ".join(ask_cmd(s, "claude", tools=False, read_dir=None, model="", effort="", shell=True))
    new = ask_cmd(s, "claude", tools=False, read_dir=None, model="", effort="", session=("sid", False))
    more = ask_cmd(s, "claude", tools=False, read_dir=None, model="", effort="", session=("sid", True))
    assert new[-2:] == ["--session-id", "sid"] and more[-2:] == ["--resume", "sid"]  # the bot's follow-ups
    assert 'sandbox_mode="workspace-write"' in ask_cmd(s, "codex", tools=True, read_dir=None, model="", effort="",
                                                       shell=True)  # fmt: skip
    c = ask_cmd(s, "codex", tools=True, read_dir=None, model="", effort="")
    assert 'sandbox_mode="read-only"' in c and "-s" not in c  # the flag would win over the secrets profile


def test_codex_reads_no_secrets_and_windows_claude_gets_no_shell(tmp_path, monkeypatch):
    from telegram_dashboard import providers
    from telegram_dashboard.providers import ask_cmd, task_cmd

    monkeypatch.setenv("HOME", str(tmp_path))
    s = Settings(root=tmp_path)
    # Codex: a profile over the legacy mode hides the data dir, the app's .env and ~/.ssh; writes only when it may
    for c, write in ((ask_cmd(s, "codex", tools=True, read_dir=None, model="", effort=""), False),
                     (task_cmd(s, "codex", "plan", "", False, "", ""), False),
                     (task_cmd(s, "codex", "edit", "", False, "", ""), True)):  # fmt: skip
        fs = next(a for a in c if a.startswith("permissions.td.filesystem="))
        assert 'default_permissions="td"' in c and '":root"="read"' in fs
        for hidden in (s.data_dir.resolve(), tmp_path.resolve() / ".env", tmp_path / ".ssh"):
            assert f'"{hidden}"="none"' in fs
        assert ('":workspace_roots"={"."="write"}' in fs) is write
    # Claude where it has no sandbox (Windows): an edit turn edits files but gets no Bash, sandboxed or not
    monkeypatch.setattr(providers, "SHELL_OK", False)
    c = task_cmd(s, "claude", "edit", "sid", False, "", "")
    assert "Bash" not in c[c.index("--allowedTools") + 1] and c[c.index("--disallowedTools") + 1].endswith(",Bash")
    assert "--settings" not in c and c[c.index("--permission-mode") + 1] == "acceptEdits"
    c = ask_cmd(s, "claude", tools=True, read_dir=None, model="", effort="", shell=True)
    assert "--settings" not in c and "Bash" not in c[c.index("--allowedTools") + 1]


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
    got = asyncio.run(providers._agy_quota(Settings(root=tmp_path)))["usage"]
    assert got == [{"label": "5h · Gemini", "percent": 25.0, "resets_at": "2026-11-03T10:19:36Z"},
                   {"label": "1w · Gemini", "percent": 2.0, "resets_at": "2026-11-05T02:19:33Z"}]  # fmt: skip


ZEP = {"command": "npx", "args": ["zeplin-mcp"], "env": {"ZEPLIN_TOKEN": "s3cret"}}


def test_ask_cmd_with_zeplin_allows_only_its_read_tools(settings):
    from telegram_dashboard import providers

    cmd = providers.ask_cmd(settings, "claude", tools=False, read_dir=None, model="m", effort="low", zeplin=ZEP)
    assert "--strict-mcp-config" in cmd and "--mcp-config" in cmd
    assert cmd[cmd.index("--allowedTools") + 1] == providers.ZEPLIN_TOOLS
    assert cmd[cmd.index("--tools") + 1] == "" and cmd[cmd.index("--permission-mode") + 1] == "default"
    assert "s3cret" not in " ".join(cmd)  # token only in the env
    assert cmd[cmd.index("--disallowedTools") + 1] == providers.ZEPLIN_DENY  # denied, never allowed
    assert "download_layer_asset" not in cmd[cmd.index("--allowedTools") + 1]
    # the project read command keeps its own tools, Zeplin's are added to them
    p = providers.ask_cmd(settings, "claude", tools=True, read_dir=None, model="m", effort="low", zeplin=ZEP)
    assert p[p.index("--allowedTools") + 1] == f"Read,Grep,Glob,Skill,{providers.ZEPLIN_TOOLS}"
    assert p.count("--disallowedTools") == 1 and providers.ZEPLIN_DENY in " ".join(p)


def test_ask_cmd_without_zeplin_is_unchanged(settings):
    from telegram_dashboard import providers

    a = providers.ask_cmd(settings, "claude", tools=False, read_dir=None, model="m", effort="low")
    b = providers.ask_cmd(settings, "claude", tools=False, read_dir=None, model="m", effort="low", zeplin=None)
    assert a == b and "--mcp-config" not in a


def test_ask_cmd_zeplin_for_codex_and_antigravity(settings, tmp_path, monkeypatch):
    from telegram_dashboard import providers

    monkeypatch.setenv("HOME", str(tmp_path))
    c = providers.ask_cmd(settings, "codex", tools=False, read_dir=None, model="m", effort="low", zeplin=ZEP)
    assert any("mcp_servers.zeplin.command" in x for x in c) and "s3cret" not in " ".join(c)
    assert "shell_tool" in c  # still no shell
    g = providers.ask_cmd(settings, "antigravity", tools=False, read_dir=None, model="m", effort="low", zeplin=ZEP)
    assert "mcp(zeplin/get_screen)" in " ".join(g)
    deny = json.loads(g[g.index("--settings") + 1])["permissions"]["deny"]
    assert "read_file(*)" in deny and "command(*)" in deny and "mcp(zeplin/download_layer_asset)" in deny
