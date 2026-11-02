"""Claude account: the CLI's own login (the same one every AI run uses), plus model/effort prefs.

The CLI owns the OAuth flow and the token (Keychain). The dashboard only reads the token to
show the account's profile and quota; it never refreshes, stores or sends it to the browser.
"""

import asyncio
import contextlib
import json
import os
import re
import shlex
import sys
import time
from pathlib import Path

import httpx

from .config import _read_json, child_env, write_private_json
from .errors import ApiError

_login: dict = {"proc": None, "url": None}
_login_lock = asyncio.Lock()  # two clicks must not start two `claude auth login`
EFFORTS = ("low", "medium", "high", "xhigh", "max")
OAUTH_API = "https://api.anthropic.com/api/oauth"


def claude_prefs(settings) -> dict:
    """Model/effort picked in the dashboard, over the .env defaults ("" = the CLI default)."""
    saved = _read_json(settings.claude_prefs_path)
    defaults = {
        "model": settings.ai_model, "effort": settings.ai_effort,
        "task_model": settings.ai_task_model, "task_effort": settings.ai_task_effort,
    }  # fmt: skip
    p = {k: saved[k] if isinstance(saved.get(k), str) else v for k, v in defaults.items()}
    for k in ("model", "task_model"):  # full ids (claude-haiku-5-5) -> the alias the CLI knows
        p[k] = re.sub(r"^claude-(haiku|sonnet|opus|fable)\b.*", r"\1", p[k])
    return p


def save_claude_prefs(settings, prefs: dict) -> None:
    settings.ensure_data_dir()
    write_private_json(settings.claude_prefs_path, prefs)


def model_flags(settings, task: bool = False) -> list[str]:
    """`--model/--effort` for a claude run: drafts/summaries/digests, or tasks/AI Agent."""
    p = claude_prefs(settings)
    model, effort = (p["task_model"], p["task_effort"]) if task else (p["model"], p["effort"])
    return [*(["--model", model] if model else []), *(["--effort", effort] if effort else [])]


async def _oauth_token() -> str | None:
    """The CLI's current claude.ai access token: Keychain on macOS, else .credentials.json."""
    raw = ""
    if sys.platform == "darwin":
        try:
            proc = await asyncio.create_subprocess_exec(
                "security", "find-generic-password", "-s", "Claude Code-credentials", "-w",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )  # fmt: skip
            raw = (await asyncio.wait_for(proc.communicate(), 5))[0].decode()
        except (OSError, TimeoutError):
            pass
    if not raw:
        home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
        raw = json.dumps(_read_json(home / ".credentials.json"))
    try:
        o = json.loads(raw)["claudeAiOauth"]
    except (ValueError, KeyError, TypeError):
        return None
    if not isinstance(o, dict) or o.get("expiresAt", 0) <= time.time() * 1000:
        return None  # expired: the CLI refreshes it on its next run
    return o.get("accessToken")


async def _oauth_get(client: httpx.AsyncClient, token: str, path: str) -> dict:
    try:
        r = await client.get(
            f"{OAUTH_API}/{path}",
            # Without a Claude Code user agent the usage API answers 429 to every call.
            headers={
                "Authorization": f"Bearer {token}",
                "anthropic-beta": "oauth-2025-04-20",
                "User-Agent": "claude-code/1.0.0",
            },
        )
        data = r.json() if r.is_success else {}
    except (httpx.HTTPError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


USAGE_WINDOWS = {
    "five_hour": "5h", "seven_day": "1w",
    "seven_day_opus": "1w · Opus", "seven_day_sonnet": "1w · Sonnet",
}  # fmt: skip
# The usage API rate-limits hard (429) when polled often: ask at most every USAGE_EVERY seconds
# (also after a failure) and serve the last good reading, kept on disk so a restart keeps it.
# The profile follows the same rule (memory only); a login/logout asks again at once.
USAGE_EVERY = 180.0
_usage: dict = {"at": 0.0, "data": None}
_profile: dict = {"at": 0.0, "data": {}}


async def _claude_details(settings) -> dict:
    """Profile + quota from Anthropic's account API; {} when the token or the API is unavailable."""
    token = await _oauth_token()
    if not token:
        return {}
    cache = settings.data_dir / "claude_usage.json"
    if _usage["data"] is None:
        _usage["data"] = _read_json(cache)
    async with httpx.AsyncClient(timeout=10) as c:
        if time.monotonic() - _profile["at"] >= USAGE_EVERY:
            _profile["at"] = time.monotonic()
            _profile["data"] = await _oauth_get(c, token, "profile") or _profile["data"]
        if time.monotonic() - _usage["at"] >= USAGE_EVERY:
            _usage["at"] = time.monotonic()
            if fresh := await _oauth_get(c, token, "usage"):
                _usage["data"] = fresh
                settings.ensure_data_dir()
                write_private_json(cache, fresh)
    profile = _profile["data"]
    acc, org = profile.get("account") or {}, profile.get("organization") or {}
    usage = _usage["data"]
    windows = [
        {"label": label, "percent": w["utilization"], "resets_at": w.get("resets_at")}
        for key, label in USAGE_WINDOWS.items()
        if isinstance(w := usage.get(key), dict) and isinstance(w.get("utilization"), int | float)
    ]
    extra = usage.get("extra_usage")
    return {
        "name": acc.get("full_name") or acc.get("display_name"),
        "created_at": acc.get("created_at"),
        "org_type": org.get("organization_type"),
        "rate_tier": org.get("rate_limit_tier"),
        "subscription_status": org.get("subscription_status"),
        "extra_usage": extra.get("is_enabled") if isinstance(extra, dict) else None,
        "usage": windows,
    }


_LOGIN_URL = re.compile(r"https://\S+/oauth/authorize\S+")


def _claude_exe(settings) -> str:
    try:
        return shlex.split(settings.ai_agent_command)[0]
    except (ValueError, IndexError):
        return "claude"


def _login_pending() -> bool:
    p = _login["proc"]
    return p is not None and p.returncode is None


def _account_changed() -> None:
    _profile["at"] = _usage["at"] = 0.0


async def claude_account(settings) -> dict:
    """`claude auth status --json` plus whether a dashboard-started login is still waiting."""
    try:
        proc = await asyncio.create_subprocess_exec(
            _claude_exe(settings), "auth", "status", "--json", env=child_env(),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )  # fmt: skip
        out, _ = await asyncio.wait_for(proc.communicate(), 15)
        data = json.loads(out)
    except (OSError, TimeoutError, ValueError):
        raise ApiError(502, "claude_cli_unavailable") from None
    if data.get("loggedIn") and data.get("authMethod") == "claude.ai":
        data |= await _claude_details(settings)
    pending = _login_pending()
    return {**data, "login_pending": pending, "login_url": _login["url"] if pending else None}


async def claude_login(settings) -> str | None:
    """Start `claude auth login` (it opens the browser itself); returns the fallback URL.

    The browser normally finishes on its own; if it can't, the page shows a code that
    `claude_login_code` types into the waiting CLI.
    """
    async with _login_lock:
        if _login_pending():
            return _login["url"]
        try:
            proc = await asyncio.create_subprocess_exec(
                _claude_exe(settings), "auth", "login", env=child_env(),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )  # fmt: skip
        except OSError:
            raise ApiError(502, "claude_cli_unavailable") from None
        _login.update(proc=proc, url=None)

        async def read_url() -> None:
            async for line in proc.stdout:
                if m := _LOGIN_URL.search(line.decode(errors="replace")):
                    _login["url"] = m.group(0)
                    return

        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(read_url(), 10)
        # ponytail: an abandoned login keeps the CLI waiting until the next login/logout kills it.
        asyncio.get_running_loop().create_task(proc.wait())  # reap it when it finishes
        return _login["url"]


async def claude_login_code(code: str) -> None:
    """Paste the code shown by Anthropic's page into the waiting `claude auth login`."""
    proc = _login["proc"]
    if not _login_pending():
        raise ApiError(409, "claude_login_not_started")
    proc.stdin.write(code.strip().encode() + b"\n")
    await proc.stdin.drain()
    try:
        await asyncio.wait_for(proc.wait(), 30)
    except TimeoutError:
        raise ApiError(504, "claude_login_timeout") from None
    if proc.returncode != 0:
        raise ApiError(422, "claude_login_failed")
    _account_changed()


async def claude_logout(settings) -> None:
    if _login_pending():
        _login["proc"].kill()
    _account_changed()
    try:
        proc = await asyncio.create_subprocess_exec(
            _claude_exe(settings), "auth", "logout", env=child_env(),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )  # fmt: skip
        await asyncio.wait_for(proc.wait(), 15)
    except (OSError, TimeoutError):
        raise ApiError(502, "claude_cli_unavailable") from None
