import json
from datetime import UTC, datetime, timedelta


def test_ai_prefs_keep_each_clis_picks(client, settings):
    from conftest import ORIGIN
    from telegram_dashboard.claude import flags_for
    from telegram_dashboard.providers import chosen, run_choice

    H = {"Origin": ORIGIN}
    flags = lambda task=False: flags_for(*run_choice(settings, task)[:2])  # noqa: E731

    assert flags() == ["--model", "haiku", "--effort", "medium"]  # .env defaults
    assert flags(True) == ["--model", "sonnet", "--effort", "medium"]
    settings.claude_prefs_path.parent.mkdir(parents=True, exist_ok=True)
    settings.claude_prefs_path.write_text('{"model": "claude-haiku-5-5"}')  # a file from before per-CLI picks
    assert flags()[:2] == ["--model", "haiku"]  # full id -> the CLI's alias
    settings.claude_prefs_path.write_text('{"provider": "codex", "by": {}}')  # from before per-kind CLIs
    assert chosen(settings) == chosen(settings, task=True) == chosen(settings, brief=True) == "codex"
    none = dict.fromkeys(("model", "effort", "task_model", "task_effort", "brief_model", "brief_effort",
                         "yt_model", "yt_effort", "yt_task_model", "yt_task_effort", "guide_model", "guide_effort"),
                        "")  # fmt: skip
    use = {"chat": "claude", "brief": "", "task": "claude", "yt": "", "yt_task": "", "guide": ""}
    body = {"use": use, "fallback": False, "fallback_at": 90, "by": {
        "claude": {**none, "model": "opus", "effort": "high", "task_effort": "max", "brief_model": "sonnet"},
        "codex": {**none, "model": "gpt-6.1-sol", "effort": "low"},
        "antigravity": {**none, "model": "gemini-3.8-flash-low", "effort": "high"}}}
    assert client.put("/api/ai/prefs", json=body, headers=H).json() == body
    assert client.get("/api/ai/prefs", headers=H).json() == body
    assert flags() == ["--model", "opus", "--effort", "high"]
    assert flags(True) == ["--effort", "max"]
    assert run_choice(settings, brief=True)[:2] == ("sonnet", "high")  # Briefing: own model, effort inherited
    assert run_choice(settings, guide=True)[:2] == ("opus", "high")  # the bot: "" = the drafts' picks
    # Switching CLI keeps every CLI's picks; Antigravity takes no effort.
    client.put("/api/ai/prefs", json={**body, "use": {**use, "chat": "antigravity"}}, headers=H)
    assert run_choice(settings) == ("gemini-3.8-flash-low", "", False)
    assert run_choice(settings, provider="codex") == ("gpt-6.1-sol", "low", False)
    # Each kind runs on the CLI of its own pick: Briefing on Codex, the rest untouched.
    client.put("/api/ai/prefs", json={**body, "use": {**use, "brief": "codex"}}, headers=H)
    assert chosen(settings, brief=True) == "codex" and chosen(settings) == chosen(settings, task=True) == "claude"
    assert run_choice(settings, brief=True) == ("", "high", False)  # Codex default model, the drafts' effort
    assert chosen(settings, yt=True) == "claude"  # "" = its base kind's CLI
    assert client.get("/api/ai/prefs", headers=H).json()["by"]["claude"]["model"] == "opus"
    assert settings.claude_prefs_path.stat().st_mode & 0o777 == 0o600
    bad_by = lambda picks: {**body, "by": {**body["by"], "codex": {**none, **picks}}}  # noqa: E731
    for bad in (bad_by({"model": "--dangerously-skip-permissions"}), bad_by({"effort": "huge"}),
                {**body, "fallback_at": 10}, {**body, "use": {**use, "chat": "gpt"}},
                {**body, "use": {**use, "task": ""}}):  # fmt: skip
        assert client.put("/api/ai/prefs", json=bad, headers=H).status_code == 422
    cat = {c["id"]: c for c in client.get("/api/ai/catalog", headers=H).json()}
    assert cat["antigravity"]["efforts"] == [] and cat["claude"]["efforts"][0] == ""
    assert {"", "opus"} <= {m["value"] for m in cat["claude"]["models"]} and cat["claude"]["quota"]


def test_fallback_steps_down_the_model_near_the_quota(settings, monkeypatch):
    import telegram_dashboard.claude as mod
    from telegram_dashboard.providers import run_choice

    later = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    over = {"five_hour": {"utilization": 95, "resets_at": later}}
    monkeypatch.setattr(mod, "_usage", {"at": 0.0, "data": over})
    settings.claude_prefs_path.parent.mkdir(parents=True, exist_ok=True)
    settings.claude_prefs_path.write_text('{"model": "opus", "task_model": "fable", "fallback": true}')
    assert run_choice(settings)[::2] == ("haiku", True)
    assert run_choice(settings, task=True)[::2] == ("sonnet", True)
    over["five_hour"]["resets_at"] = "2000-01-01T00:00:00+00:00"  # window already reset
    assert run_choice(settings)[::2] == ("opus", False)


def test_youtrack_runs_have_their_own_picks(settings):
    from telegram_dashboard import providers

    p = providers.prefs(settings)
    c = p["by"]["claude"]
    c.update(model="haiku", effort="low", task_model="sonnet", task_effort="high")
    providers.save_prefs(settings, p)
    pick = lambda **kw: providers.run_choice(settings, provider="claude", **kw)[:2]  # noqa: E731
    assert pick(yt=True) == ("haiku", "low")  # "" = the Telegram pick
    assert pick(yt=True, task=True) == ("sonnet", "high")
    c.update(yt_model="opus", yt_task_effort="max")
    providers.save_prefs(settings, p)
    assert pick(yt=True) == ("opus", "low") and pick(yt=True, task=True) == ("sonnet", "max")
    assert pick() == ("haiku", "low") and pick(task=True) == ("sonnet", "high")  # Telegram runs untouched


def test_codex_lists_models_a_local_proxy_routes(settings, monkeypatch, tmp_path):

    from telegram_dashboard import provider_cmds, providers

    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    lv = lambda *es: [{"effort": e} for e in es]  # noqa: E731
    models = [
        {"slug": "gpt-6.1-sol", "display_name": "GPT-6.1-Sol", "visibility": "list",
         "supported_reasoning_levels": lv("low", "ultra")},
        {"slug": "combo/gemini", "display_name": "combo/gemini", "visibility": "list",
         "supported_reasoning_levels": lv("low", "high")},
        {"slug": "combo/hidden", "visibility": "hide"},
    ]
    (tmp_path / "ocx.json").write_text(json.dumps({"models": models}))
    cfg = tmp_path / "config.toml"
    cfg.write_text(f'openai_base_url = "http://127.0.0.1:10100/v1"\nmodel_catalog_json = "{tmp_path / "ocx.json"}"\n')
    codex = {m["value"]: m for m in providers.catalog(settings)[1]["models"]}
    assert set(codex) == {"", "gpt-6.1-sol", "combo/gemini"}
    assert codex["combo/gemini"]["group"] == "combo" and codex["combo/gemini"]["efforts"] == ["", "low", "high"]
    routed = provider_cmds._codex_base(settings, "combo/gemini", "high")
    assert 'openai_base_url="http://127.0.0.1:10100/v1"' in routed and "--ignore-user-config" in routed
    assert "features.apps=false" in routed  # codex_apps (web_run, upload from URL) is built in: off for every run
    assert not any("openai_base_url" in a for a in provider_cmds._codex_base(settings, "gpt-6.1-sol", "low"))
    # Each model's own levels: "ultra" runs on the model that lists it, not on one that doesn't.
    p = providers.prefs(settings)
    p["use"]["chat"] = "codex"
    p["by"]["codex"].update(model="combo/gemini", effort="ultra")
    providers.save_prefs(settings, p)
    assert providers.run_choice(settings)[:2] == ("combo/gemini", "")
    p["by"]["codex"]["model"] = "gpt-6.1-sol"
    providers.save_prefs(settings, p)
    assert providers.run_choice(settings)[:2] == ("gpt-6.1-sol", "ultra")
    # A remote base URL is never followed: routed models drop out.
    cfg.write_text('openai_base_url = "https://evil.example/v1"\n')
    assert "combo/gemini" not in {m["value"] for m in providers.catalog(settings)[1]["models"]}
    assert not any("openai_base_url" in a for a in provider_cmds._codex_base(settings, "combo/gemini", ""))


def test_fast_choice_is_each_clis_quickest_model():
    from telegram_dashboard import providers

    assert providers.fast_choice("claude")[0] == "haiku"
    assert providers.fast_choice("antigravity")[0].endswith("-low")
