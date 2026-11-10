import json

from telegram_dashboard import external_runs as ext


def _write(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n")


def _claude(entry, t, kind, **kw):
    return {"type": kind, "entrypoint": entry, "cwd": "/w/proj", "timestamp": f"2099-01-01T00:00:{t:02d}Z", **kw}


def test_outside_runs_one_row_per_prompt_skipping_own(tmp_path, monkeypatch):
    usage = {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 7}
    reply = lambda t, mid: _claude("claude-desktop", t, "assistant", effort="high",  # noqa: E731
                                   message={"id": mid, "model": "claude-x", "usage": usage})
    _write(tmp_path / ".claude/projects/p/s.jsonl", [
        _claude("claude-desktop", 0, "user", message={"content": "hi"}),
        reply(2, "m1"), reply(2, "m1"),  # one response over two lines: counted once
        _claude("claude-desktop", 3, "user", message={"content": [{"type": "tool_result"}]}),  # same turn
        reply(9, "m2"),
        _claude("claude-desktop", 20, "user", message={"content": "next"}),
        reply(21, "m3"),
    ])
    own = [_claude("sdk-cli", 0, "user", message={"content": "x"}), reply(1, "z")]
    _write(tmp_path / ".claude/projects/p/own.jsonl", own)
    def ev(t, typ, **p):
        return {"type": "event_msg", "timestamp": f"2099-01-01T00:01:{t:02d}Z", "payload": {"type": typ, **p}}

    tok = {"last_token_usage": {"input_tokens": 50, "cached_input_tokens": 40, "output_tokens": 3, "total_tokens": 53}}
    idle = {"last_token_usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}}
    _write(tmp_path / ".codex/sessions/2099/rollout-a.jsonl", [
        {"type": "session_meta", "payload": {"originator": "Codex Desktop", "cwd": "/w/app"}},
        {"type": "turn_context", "payload": {"model": "gpt-x", "effort": "high"}},
        ev(0, "task_started"), ev(1, "token_count", info=tok), ev(2, "token_count", info=tok), ev(4, "task_complete"),
        # Codex Desktop's empty warm-up turn
        ev(5, "task_started"), ev(6, "token_count", info=idle), ev(7, "task_complete"),
    ])
    _write(tmp_path / ".codex/sessions/2099/rollout-own.jsonl", [
        {"type": "session_meta", "payload": {"originator": "codex_exec"}},
        ev(0, "task_started"), ev(1, "token_count", info=tok),
    ])
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / ".claude"))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / ".codex"))

    rows = sorted(ext.external_runs(1), key=lambda r: r["at"])
    assert [(r["feature"], r["project"], r["turns"]) for r in rows] == [
        ("Claude Desktop", "proj", 2), ("Claude Desktop", "proj", 1), ("Codex Desktop", "app", 2)]
    first, _, codex = rows
    assert (first["input_tokens"], first["cache_read"], first["ms"], first["effort"]) == (20, 200, 9000, "high")
    assert (codex["input_tokens"], codex["cache_read"], codex["output_tokens"], codex["ms"]) == (20, 80, 6, 4000)
