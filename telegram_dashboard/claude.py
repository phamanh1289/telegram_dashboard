"""Claude account: the CLI's own login (what a run uses when Claude is the picked AI), and the run log.

The CLI owns the OAuth flow and the token (Keychain). The dashboard only reads the token to
show the account's profile and quota; it never refreshes, stores or sends it to the browser.
"""

import asyncio
import contextlib
import json
import os
import re
import shlex
import sqlite3
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from .config import _read_json, child_env, write_private_json
from .errors import ApiError

_login: dict = {"proc": None, "url": None}
_login_lock = asyncio.Lock()  # two clicks must not start two `claude auth login`
OAUTH_API = "https://api.anthropic.com/api/oauth"


def flags_for(model: str, effort: str) -> list[str]:
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


def _usage_data(settings) -> dict:
    if _usage["data"] is None:
        _usage["data"] = _read_json(settings.data_dir / "claude_usage.json")
    return _usage["data"]


def quota_now(settings) -> dict[str, float]:
    """Last known % used per window ("5h": 42.0), leaving out windows that have reset since."""
    now, out = datetime.now(UTC), {}
    for key, label in USAGE_WINDOWS.items():
        w = _usage_data(settings).get(key)
        if not isinstance(w, dict) or not isinstance(w.get("utilization"), int | float):
            continue
        try:
            if w.get("resets_at") and datetime.fromisoformat(w["resets_at"]) <= now:
                continue
        except (TypeError, ValueError):
            pass
        out[label] = w["utilization"]
    return out


def refresh_usage() -> bool:
    """Ask Anthropic again on the next read; not within 30 s of the last ask (it answers 429)."""
    if time.monotonic() - _usage["at"] < 30:
        return False
    _account_changed()
    return True


async def _claude_details(settings) -> dict:
    """Profile + quota from Anthropic's account API; {} when the token or the API is unavailable."""
    token = await _oauth_token()
    if not token:
        return {}
    cache = settings.data_dir / "claude_usage.json"
    _usage_data(settings)
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
        "usage_at": usage.get("fetched_at"),
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


# ---- run log: one JSON line per claude run, for the Claude page's history and report ----
_bg: set[asyncio.Task] = set()


def _runs_path(settings) -> Path:
    return settings.data_dir / "claude_runs.jsonl"


def note_run(settings, feature: str, choice, final: dict | None, seconds: float, error: str | None) -> None:
    """Log one claude run (`final`: its result event) without holding up the caller."""
    t = asyncio.get_running_loop().create_task(_note_run(settings, feature, choice, final, seconds, error))
    _bg.add(t)
    t.add_done_callback(_bg.discard)


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
        "quota": {} if str(model).startswith(("codex", "antigravity")) else quota_now(settings),  # Claude's windows only
    }  # fmt: skip
    try:
        settings.ensure_data_dir()
        fd = os.open(_runs_path(settings), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:
        pass


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
    return sorted(rows, key=lambda r: str(r["at"]), reverse=True)  # imported runs land out of order


# Prompt markers -> feature, for runs read back from the CLI's own transcripts.
_TELEGRAM = "You help a user read and answer a Telegram group"
_YOUTRACK = "You help a developer work through YouTrack tickets"
_TASKS = (("First summarize the tagged <messages>", "draft"), ("Turn the tagged <messages>", "ticket"),
          ("Analyze the group conversation", "digest"), ("Summarize these messages briefly", "summary"),
          ("Reply with exactly", "test"))  # fmt: skip


def _utc(ts: str) -> str:
    return datetime.fromisoformat(ts).astimezone(UTC).isoformat(timespec="seconds")


def import_transcripts(settings, projects: Path | None = None) -> int:
    """Backfill the run log from the claude CLI's transcripts (~/.claude/projects), for runs made
    before the log existed: dashboard prompts and AI Agent sessions only. Runs from when the live
    log starts, or already imported, are skipped; the quota at the time is not recoverable.
    Returns how many runs were added."""
    home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    projects = projects or home / "projects"
    old = claude_runs(settings, 3650)
    live = [r["at"] for r in old if not r.get("imported")]
    cutoff = min(live) if live else "9999"
    seen = {r.get("source") for r in old}
    agent_sessions: set[str] = set()
    with contextlib.suppress(sqlite3.Error):
        db = sqlite3.connect(f"file:{settings.db_path}?mode=ro", uri=True)
        agent_sessions = {s for (s,) in db.execute("SELECT session_id FROM tasks WHERE session_id IS NOT NULL")}
        db.close()
    rows = []
    for f in sorted(projects.glob("*/*.jsonl")):
        rows += _transcript_runs(f, agent_sessions)
    added = [r for r in rows if r["at"] < cutoff and r["source"] not in seen]
    if added:
        settings.ensure_data_dir()
        fd = os.open(_runs_path(settings), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a") as fh:
            fh.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in added)
    return len(added)


def _transcript_runs(path: Path, agent_sessions: set[str]) -> list[dict]:
    """One run per `claude -p` call in a transcript (a resumed session holds several); the
    session's real cost (its last cost-state) is split over its runs by weighted tokens."""
    runs, cost, headless = [], None, False
    msgs: dict[str, dict] = {}  # message id -> its last line (a message is logged once per block)
    try:
        lines = path.open(encoding="utf-8")
    except OSError:
        return []
    with lines:
        for line in lines:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            t = d.get("type")
            headless |= d.get("entrypoint") == "sdk-cli"
            if t == "queue-operation" and d.get("operation") == "enqueue" and d.get("timestamp"):
                runs.append({"at": d["timestamp"], "prompt": str(d.get("content") or ""), "ids": [], "end": d["timestamp"]})
            elif t == "assistant" and runs and isinstance(d.get("message"), dict):
                m = d["message"]
                key = m.get("id") or d.get("uuid")
                if key not in msgs:
                    runs[-1]["ids"].append(key)
                msgs[key] = d
                runs[-1]["end"] = d.get("timestamp") or runs[-1]["end"]
            elif t == "cost-state" and isinstance(d.get("totalCostUSD"), int | float):
                cost = max(cost or 0.0, d["totalCostUSD"])
    if not headless or not runs:
        return []
    session = path.stem
    first = runs[0]["prompt"]
    if session in agent_sessions:
        feature = "agent"
    elif _TELEGRAM in first:
        feature = next((f for marker, f in _TASKS if marker in first), "ai")
    elif _YOUTRACK in first:
        feature = "youtrack"
    else:
        return []  # someone else's `claude -p`, not the dashboard's
    out = []
    for r in runs:
        ms = [msgs[k] for k in r["ids"]]
        if not ms:
            continue  # stopped before Claude answered: nothing to count
        n = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        by_model: dict[str, int] = {}
        for d in ms:
            u = d["message"].get("usage") or {}
            for k in n:
                n[k] += u.get(k) if isinstance(u.get(k), int) else 0
            model = d["message"].get("model") or ""
            if model and not model.startswith("<"):
                by_model[model] = by_model.get(model, 0) + (u.get("output_tokens") or 0)
        try:
            ms_run = round((datetime.fromisoformat(r["end"]) - datetime.fromisoformat(r["at"])).total_seconds() * 1000)
            at = _utc(r["at"])
        except (TypeError, ValueError):
            continue
        out.append({
            "at": at, "feature": feature,
            "model": max(by_model, key=by_model.get) if by_model else "mặc định",
            "effort": "", "fallback": False,
            "ok": any(not d.get("isApiErrorMessage") for d in ms),
            "error": None if any(not d.get("isApiErrorMessage") for d in ms) else "claude_error",
            "ms": max(0, ms_run), "cost": None,
            "input_tokens": n["input_tokens"], "output_tokens": n["output_tokens"],
            "cache_read": n["cache_read_input_tokens"], "cache_write": n["cache_creation_input_tokens"],
            "turns": len(ms), "quota": {}, "imported": True, "source": f"{session}@{r['at']}",
        })  # fmt: skip
    # API price ratios: output 5x input, cache write 1.25x, cache read 0.1x.
    weight = lambda r: r["input_tokens"] + 5 * r["output_tokens"] + 1.25 * r["cache_write"] + 0.1 * r["cache_read"]  # noqa: E731
    total = sum(map(weight, out))
    if cost is not None and total:
        for r in out:
            r["cost"] = round(cost * weight(r) / total, 6)
    return out
