import asyncio
import json
import shlex
from datetime import UTC, datetime

import pytest
from telegram_dashboard.config import Settings
from telegram_dashboard.errors import ApiError

FAKE_CLAUDE = """#!/bin/sh
# Stand-in `claude auth ...`: login prints the fallback URL, then waits for a pasted code.
case "$2" in
  status) echo '{"loggedIn": true, "authMethod": "claude.ai", "email": "me@x.io", "subscriptionType": "max"}' ;;
  login) echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=s"
         read code; [ "$code" = "good-code#s" ] ;;
  logout) exit 0 ;;
esac
"""


def test_claude_account_login_with_pasted_code(tmp_path, monkeypatch):

    from telegram_dashboard import claude as mod

    async def no_token():
        return None

    monkeypatch.setattr(mod, "_oauth_token", no_token)  # never the real Keychain
    exe = tmp_path / "claude"
    exe.write_text(FAKE_CLAUDE)
    exe.chmod(0o755)
    s = Settings(root=tmp_path, ai_agent_command=shlex.quote(str(exe)))

    async def flow():
        acc = await mod.claude_account(s)
        assert acc["email"] == "me@x.io" and acc["subscriptionType"] == "max"
        assert not acc["login_pending"]
        with pytest.raises(ApiError, match="claude_login_not_started"):
            await mod.claude_login_code("good-code#s")
        url = await mod.claude_login(s)
        assert url == "https://claude.com/cai/oauth/authorize?code=true&state=s"
        assert (await mod.claude_account(s))["login_url"] == url
        assert await mod.claude_login(s) == url  # a second click reuses the waiting login
        await mod.claude_login_code("good-code#s")
        assert not (await mod.claude_account(s))["login_pending"]
        await mod.claude_login(s)
        with pytest.raises(ApiError, match="claude_login_failed"):
            await mod.claude_login_code("bad-code#s")
        await mod.claude_logout(s)

    asyncio.run(flow())


def test_claude_account_details_from_oauth_api(tmp_path, monkeypatch):

    from telegram_dashboard import claude as mod

    exe = tmp_path / "claude"
    exe.write_text(FAKE_CLAUDE)
    exe.chmod(0o755)

    async def token():
        return "tok"

    async def get(_client, tok, path, ua):
        assert tok == "tok" and ua
        return {
            "profile": {"account": {"full_name": "Me", "created_at": "2025-01-01"},
                        "organization": {"rate_limit_tier": "default_claude_max_5x"}},
            "usage": {"five_hour": {"utilization": 2.0, "resets_at": "r1"},
                      "seven_day": {"utilization": 50, "resets_at": "r2"},
                      "seven_day_opus": None, "extra_usage": {"is_enabled": True},
                      "cedar_ember": {"eligible": False, "ineligible_reason": "cli_version"}},
        }[path.split("?")[0]]  # fmt: skip

    monkeypatch.setattr(mod, "_oauth_token", token)
    monkeypatch.setattr(mod, "_oauth_get", get)
    monkeypatch.setattr(mod, "_usage", {"at": 0.0, "data": None})
    monkeypatch.setattr(mod, "_profile", {"at": 0.0, "data": {}})
    monkeypatch.setattr(mod, "_ua", {"ua": None})
    s = Settings(root=tmp_path, ai_agent_command=shlex.quote(str(exe)))
    acc = asyncio.run(mod.claude_account(s))
    assert acc["name"] == "Me" and acc["rate_tier"] == "default_claude_max_5x" and acc["extra_usage"]
    assert acc["resets_blocked"] == "cli_version"  # the reset grants ride on the same usage call
    assert acc["usage"] == [
        {"label": "5h", "percent": 2.0, "resets_at": "r1"},
        {"label": "1w", "percent": 50, "resets_at": "r2"},
    ]

    calls = []

    async def limited(_client, _tok, path, ua):  # usage API answers 429 -> _oauth_get gives {}
        calls.append(path.split("?")[0])
        return {} if path.startswith("usage") else await get(_client, "tok", path, ua)

    monkeypatch.setattr(mod, "_oauth_get", limited)
    assert asyncio.run(mod.claude_account(s))["usage"] == acc["usage"]
    assert calls == []  # polled again within USAGE_EVERY: no profile/usage call
    monkeypatch.setattr(mod, "_usage", {"at": 0.0, "data": None})  # restart, interval over
    assert asyncio.run(mod.claude_account(s))["usage"] == acc["usage"]  # 429: reading from disk
    assert "usage" in calls


def test_claude_account_expired_token_keeps_last_reading(tmp_path, monkeypatch):
    import json

    from telegram_dashboard import claude as mod

    exe = tmp_path / "claude"
    exe.write_text(FAKE_CLAUDE)
    exe.chmod(0o755)
    s = Settings(root=tmp_path, ai_agent_command=shlex.quote(str(exe)))
    s.ensure_data_dir()
    (s.data_dir / "claude_usage.json").write_text(json.dumps({
        "five_hour": {"utilization": 49.0, "resets_at": "2000-01-01T00:00:00+00:00"},  # reset since: dropped
        "seven_day": {"utilization": 54.0, "resets_at": "2999-01-01T00:00:00+00:00"},
        "fetched_at": "2026-11-05T10:00:00+00:00",
    }))  # fmt: skip
    woke = []

    async def creds():
        return {"accessToken": "old", "expiresAt": 0, "rateLimitTier": "default_claude_max_5x"}

    async def wake(_s):
        woke.append(1)

    monkeypatch.undo()  # the real _oauth_token (conftest stubs it), reading the fake login below
    monkeypatch.setattr(mod, "_oauth_creds", creds)
    monkeypatch.setattr(mod, "_wake_cli", wake)
    monkeypatch.setattr(mod, "_usage", {"at": 0.0, "data": None})
    monkeypatch.setattr(mod, "_profile", {"at": 0.0, "data": {}})
    acc = asyncio.run(mod.claude_account(s))
    assert woke == [1]  # the CLI was asked to run once, to refresh its own token
    assert acc["usage_error"] == "no_token" and acc["rate_tier"] == "default_claude_max_5x"
    assert acc["usage"] == [{"label": "1w", "percent": 54.0, "resets_at": "2999-01-01T00:00:00+00:00"}]
    assert acc["usage_at"] == "2026-11-05T10:00:00+00:00"


async def test_codex_reset_credits_listed_and_redeemed(settings, monkeypatch):
    """The free rate-limit resets come with the quota; using one reads the quota again, no answer is never a failure."""
    from telegram_dashboard import provider_accounts

    credit = {"id": "C1", "status": "available", "title": "Full reset", "expiresAt": 1796070311}
    read = {"rateLimits": {"primary": {"usedPercent": 20, "windowDurationMins": 300, "resetsAt": 1794405052}},
            "rateLimitResetCredits": {"availableCount": 2,
                                      "credits": [credit, {**credit, "id": "C2", "status": "redeemed"}]}}  # fmt: skip
    calls = []

    async def rpc(_s, method, params=None):
        calls.append((method, params))
        return {"result": {"outcome": "reset"} if method.endswith("consume") else read}

    monkeypatch.setattr(provider_accounts, "_codex_rpc", rpc)
    monkeypatch.setattr(provider_accounts, "installed", lambda *_: True)
    monkeypatch.setattr(provider_accounts, "_quota", {})
    q, at = await provider_accounts.quota(settings, "codex")
    assert q["resets_left"] == 2 and [r["id"] for r in q["resets"]] == ["C1"] and q["usage"][0]["label"] == "5h" and at
    assert await provider_accounts.codex_reset(settings, "C1") == "reset"
    method, params = calls[1]
    assert method == "account/rateLimitResetCredit/consume" and params["creditId"] == "C1" and params["idempotencyKey"]
    assert calls[2][0] == "account/rateLimits/read"  # the quota after the reset, not the cached one

    async def silent(*_a, **_k):
        return None

    monkeypatch.setattr(provider_accounts, "_codex_rpc", silent)
    with pytest.raises(ApiError) as e:
        await provider_accounts.codex_reset(settings, None)
    assert e.value.code == "ai_reset_unknown"


async def test_claude_reset_grants_listed_and_claimed(settings, monkeypatch):
    """Anthropic's `cedar_ember` grants: usable ones offered, a too-old CLI said so; the claim files the grant
    against the org, maps the answer, and a lost answer is "unknown", never a failure to retry."""
    import httpx
    from telegram_dashboard import claude

    now = datetime.now(UTC)
    grant = {"id": "full-reset-2611", "label": "One full limit reset", "resets_total": 1, "resets_left": 1,
             "ends_at": "2026-12-10T22:00:00+00:00", "paused": False, "usable_now": True, "use_requires_limit": False}
    ce = {"eligible": True, "at_limit": False, "grants": [grant,
                                                         {**grant, "id": "needs-limit", "use_requires_limit": True},
                                                         {**grant, "id": "spent", "resets_left": 0}]}  # fmt: skip
    got = claude._grants({"cedar_ember": ce}, now)
    assert got["resets_left"] == 2 and [(r["id"], r["usable"]) for r in got["resets"]] == [
        ("full-reset-2611", True), ("needs-limit", False)]  # fmt: skip
    assert claude._grants({"cedar_ember": {"eligible": False, "ineligible_reason": "cli_version"}}, now) == {
        "resets_blocked": "cli_version"}  # fmt: skip
    assert claude._grants({}, now) == {}

    posts = []

    def handler(req: httpx.Request) -> httpx.Response:
        posts.append((str(req.url), json.loads(req.content)))
        return httpx.Response(200, json={"result": "reset", "resets_left": 0})

    real = httpx.AsyncClient
    monkeypatch.setattr(claude.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))

    async def token():
        return "tok"

    async def ua(_s):
        return "claude-cli/2.1.322 (external, cli)"

    async def details(_s):
        return {}

    monkeypatch.setattr(claude, "_oauth_token", token)
    monkeypatch.setattr(claude, "_user_agent", ua)
    monkeypatch.setattr(claude, "_claude_details", details)
    org = {"organization": {"uuid": "0f8fad5b-d9cb-469f-a165-70867728950e"}}
    monkeypatch.setattr(claude, "_profile", {"at": 0.0, "data": org})
    monkeypatch.setattr(claude, "_usage", {"at": 0.0, "data": {"cedar_ember": {"next_grant_id": "full-reset-2611"}}})
    assert await claude.claude_reset(settings, None) == "reset"
    url, body = posts[0]
    assert url.endswith("/api/organizations/0f8fad5b-d9cb-469f-a165-70867728950e/reset_rate_limits")
    assert body["program"] == "cedar_ember" and body["grant_id"] == "full-reset-2611" and body["request_id"]
    await claude.claude_reset(settings, None, request_id="retry-key-1")  # a retry resends the page's key
    assert posts[1][1]["request_id"] == "retry-key-1"

    def refused(_req):
        return httpx.Response(400, text="grant expired")

    monkeypatch.setattr(claude.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(refused), **kw))
    with pytest.raises(ApiError) as e:  # refused = nothing spent: an error, never "may have gone through"
        await claude.claude_reset(settings, "full-reset-2611")
    assert e.value.code == "ai_provider_error"

    def lost(_req):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(claude.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(lost), **kw))
    with pytest.raises(ApiError) as e:
        await claude.claude_reset(settings, "full-reset-2611")
    assert e.value.code == "ai_reset_unknown"
