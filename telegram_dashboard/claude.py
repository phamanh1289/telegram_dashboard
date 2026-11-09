"""Claude account: the CLI's own login (what a run uses when Claude is the picked AI), and the run log.

The CLI owns the OAuth flow and the token (Keychain). The dashboard only reads the token to
show the account's profile and quota; it never refreshes, stores or sends it to the browser.
"""

import asyncio
import contextlib
import json
import logging
import os
import re
import shlex
import shutil
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from .config import _read_json, child_env, run_cli, write_private_json
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.claude")

_login: dict = {"proc": None, "url": None}
_login_lock = asyncio.Lock()  # two clicks must not start two `claude auth login`
OAUTH_API = "https://api.anthropic.com/api/oauth"


def flags_for(model: str, effort: str) -> list[str]:
    return [*(["--model", model] if model else []), *(["--effort", effort] if effort else [])]


async def _oauth_creds() -> dict:
    """The CLI's claude.ai login (token, expiry, plan tier), expired or not: Keychain on macOS, else
    .credentials.json; {} when there is none."""
    raw = ""
    if sys.platform == "darwin":
        got = await run_cli(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"], timeout=5)
        raw = got[1].decode(errors="replace") if got else ""
    if not raw:
        home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
        raw = json.dumps(_read_json(home / ".credentials.json"))
    try:
        o = json.loads(raw)["claudeAiOauth"]
    except (ValueError, KeyError, TypeError):
        return {}
    return o if isinstance(o, dict) else {}


async def _oauth_token() -> str | None:
    """The current access token; None once expired (the CLI refreshes it only when it runs)."""
    o = await _oauth_creds()
    return o.get("accessToken") if o.get("expiresAt", 0) > time.time() * 1000 else None


# An expired token stays expired until the CLI runs: one tiny Haiku answer wakes it, at most every WAKE_EVERY s.
WAKE_EVERY = 900.0
_wake: dict = {"at": 0.0}


async def _wake_cli(settings) -> None:
    if time.monotonic() - _wake["at"] < WAKE_EVERY:
        return
    _wake["at"] = time.monotonic()
    await run_cli([_claude_exe(settings), "-p", "Reply with exactly: OK", "--model", "haiku"], timeout=60)


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


def _usage_data(settings) -> dict:
    if _usage["data"] is None:
        _usage["data"] = _read_json(settings.data_dir / "claude_usage.json")
    return _usage["data"]


def quota_now(settings) -> dict[str, float]:
    """Last known % used per window ("5h": 42.0), leaving out windows that have reset since."""
    now, out = datetime.now(UTC), {}
    for key, label in USAGE_WINDOWS.items():
        w = _usage_data(settings).get(key)
        if isinstance(w, dict) and isinstance(w.get("utilization"), int | float) and not _was_reset(w, now):
            out[label] = w["utilization"]
    return out


def _was_reset(w: dict, now: datetime) -> bool:
    """A cached window whose reset time has passed: its reading no longer holds."""
    try:
        return bool(w.get("resets_at")) and datetime.fromisoformat(w["resets_at"]) <= now
    except (TypeError, ValueError):
        return False


def refresh_usage() -> bool:
    """Ask Anthropic again on the next read; not within 30 s of the last ask (it answers 429)."""
    if time.monotonic() - _usage["at"] < 30:
        return False
    _account_changed()
    _wake["at"] = 0.0  # an expired token: wake the CLI now, not WAKE_EVERY after the last try
    return True


async def _claude_details(settings) -> dict:
    """Profile + quota from Anthropic's account API. With no live token: the last reading on disk, the plan
    tier from the CLI's login, and `usage_error` saying the numbers are not live."""
    creds = await _oauth_creds()
    token = await _oauth_token()
    if not token and creds:
        await _wake_cli(settings)
        token = await _oauth_token()
    cache = settings.data_dir / "claude_usage.json"
    _usage_data(settings)
    if token:
        async with httpx.AsyncClient(timeout=10) as c:
            if time.monotonic() - _profile["at"] >= USAGE_EVERY:
                _profile["at"] = time.monotonic()
                _profile["data"] = await _oauth_get(c, token, "profile") or _profile["data"]
            if time.monotonic() - _usage["at"] >= USAGE_EVERY:
                _usage["at"] = time.monotonic()
                if fresh := await _oauth_get(c, token, "usage"):
                    _usage["data"] = fresh | {"fetched_at": datetime.now(UTC).isoformat(timespec="seconds")}
                    settings.ensure_data_dir()
                    write_private_json(cache, _usage["data"])
    profile = _profile["data"]
    acc, org = profile.get("account") or {}, profile.get("organization") or {}
    usage, now = _usage["data"], datetime.now(UTC)
    windows = [
        {"label": label, "percent": w["utilization"], "resets_at": w.get("resets_at")}
        for key, label in USAGE_WINDOWS.items()
        if isinstance(w := usage.get(key), dict)
        and isinstance(w.get("utilization"), int | float)
        and not _was_reset(w, now)
    ]
    extra = usage.get("extra_usage")
    return {
        "name": acc.get("full_name") or acc.get("display_name"),
        "created_at": acc.get("created_at"),
        "org_type": org.get("organization_type"),
        "rate_tier": org.get("rate_limit_tier") or creds.get("rateLimitTier"),
        "subscription_status": org.get("subscription_status"),
        "extra_usage": extra.get("is_enabled") if isinstance(extra, dict) else None,
        "usage": windows,
        "usage_at": usage.get("fetched_at"),
        "usage_error": None if token else "no_token",
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
    exe = _claude_exe(settings)
    got = await run_cli([exe, "auth", "status", "--json"], timeout=15)
    if got is None and shutil.which(exe):  # installed but silent: e.g. a Keychain prompt waiting
        raise ApiError(504, "claude_cli_timeout")
    try:
        data = json.loads(got[1]) if got else None
    except ValueError:
        data = None
    if not isinstance(data, dict):
        raise ApiError(502, "claude_cli_unavailable")
    if data.get("loggedIn") and data.get("authMethod") == "claude.ai":
        try:
            data |= await _claude_details(settings)
        except Exception:  # plan / usage are extras: the account itself is still known
            log.warning("claude account details failed", exc_info=True)
            data["usage_error"] = "fetch_failed"
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
        last = [""]

        async def read_url() -> None:
            async for line in proc.stdout:
                last[0] = line.decode(errors="replace").strip() or last[0]
                if m := _LOGIN_URL.search(last[0]):
                    _login["url"] = m.group(0)
                    return

        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(read_url(), 10)
        if not _login["url"]:
            await login_failed(proc, last[0], "claude_login_failed")
        # ponytail: an abandoned login keeps the CLI waiting until the next login/logout kills it.
        spawn(proc.wait())  # reap it when it finishes
        return _login["url"]


async def login_failed(proc, last: str, code: str) -> None:
    """A login CLI that quit with an error before giving a URL: say why, instead of the click doing nothing."""
    with contextlib.suppress(TimeoutError):
        if await asyncio.wait_for(proc.wait(), 0.5):
            raise ApiError(502, code, detail=last[-300:] or None)


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
    if await run_cli([_claude_exe(settings), "auth", "logout"], timeout=15) is None:
        raise ApiError(502, "claude_cli_unavailable")


# ---- run log: one JSON line per claude run, for the Claude page's history and report ----
_bg: set[asyncio.Task] = set()


def _runs_path(settings) -> Path:
    return settings.data_dir / "claude_runs.jsonl"


def spawn(coro) -> None:
    """Run in the background, referenced until done (asyncio keeps only weak refs to tasks)."""
    t = asyncio.get_running_loop().create_task(coro)
    _bg.add(t)
    t.add_done_callback(_bg.discard)


def note_run(settings, feature: str, choice, final: dict | None, seconds: float, error: str | None) -> None:
    """Log one AI run (`final`: its Claude-shaped result event) without holding up the caller."""
    spawn(_note_run(settings, feature, choice, final, seconds, error))


async def _note_run(settings, feature, choice, final, seconds, error) -> None:
    with contextlib.suppress(Exception):  # the quota after the run is best effort
        if time.monotonic() - _usage["at"] >= USAGE_EVERY:
            await _claude_details(settings)
    f = final if isinstance(final, dict) else {}
    u = f.get("usage") if isinstance(f.get("usage"), dict) else {}
    mu = f.get("modelUsage") if isinstance(f.get("modelUsage"), dict) else {}
    model, effort, fell = choice
    if mu:  # the model that did most of the work, as the CLI resolved it
        top = max(mu, key=lambda k: (mu[k] or {}).get("costUSD") or 0)
        model = (mu[top] or {}).get("canonicalModel") or top
    n = lambda k: u.get(k) if isinstance(u.get(k), int) else 0  # noqa: E731
    row = {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "feature": feature, "model": model or "mặc định", "effort": effort, "fallback": fell,
        "ok": error is None and bool(f) and not f.get("is_error"),
        "error": error or ("claude_error" if f.get("is_error") else None),
        "ms": f.get("duration_ms") if isinstance(f.get("duration_ms"), int) else round(seconds * 1000),
        "cost": f.get("total_cost_usd") if isinstance(f.get("total_cost_usd"), int | float) else None,
        "input_tokens": n("input_tokens"), "output_tokens": n("output_tokens"),
        "cache_read": n("cache_read_input_tokens"), "cache_write": n("cache_creation_input_tokens"),
        "turns": f.get("num_turns") if isinstance(f.get("num_turns"), int) else 0,
        # Claude's windows only
        "quota": {} if str(model).startswith(("codex", "antigravity")) else quota_now(settings),
    }  # fmt: skip
    try:
        settings.ensure_data_dir()
        fd = os.open(_runs_path(settings), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError as e:  # the run itself is fine; only Settings › AI's history misses it
        log.warning("run log not written: %s", type(e).__name__)


def claude_runs(settings, days: int) -> list[dict]:
    """Runs logged in the last `days` days, newest first."""
    # ponytail: reads the whole file each time; rotate it if it ever grows past ~100k runs.
    since = (datetime.now(UTC) - timedelta(days=days)).isoformat(timespec="seconds")
    rows = []
    with contextlib.suppress(OSError), open(_runs_path(settings)) as fh:
        for line in fh:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if isinstance(r, dict) and str(r.get("at", "")) >= since:
                rows.append(r)
    return sorted(rows, key=lambda r: str(r["at"]), reverse=True)
