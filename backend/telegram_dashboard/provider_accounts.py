"""Codex / Antigravity accounts: login, logout, who is signed in and the plan's quota (Claude's: claude.py)."""

import asyncio
import base64
import contextlib
import json
import re
import shlex
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import UTC, datetime

from .claude import USAGE_EVERY, login_failed, spawn
from .config import _read_json, child_env, run_cli
from .desktop import applescript_str, osascript
from .errors import ApiError
from .providers import INSTALL, _agy_home, _codex_home, exe, installed

_login: dict = {"proc": None, "url": None}  # a dashboard-started `codex login`
_codex_login_lock = asyncio.Lock()
_quota: dict = {}  # provider -> (monotonic time read, {"usage": windows, …}, ISO time read)
_quota_lock: dict[str, asyncio.Lock] = {}
_CODEX_URL = re.compile(r"https://auth\.openai\.com/\S+")


def _jwt_claims(token) -> dict:
    """Payload of the id token the CLI saved: who is signed in. Read only, never verified or sent."""
    try:
        part = str(token).split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except IndexError, ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _login_pending() -> bool:
    p = _login["proc"]
    return p is not None and p.returncode is None


async def _codex_rpc(settings, method: str, params: dict | None = None) -> dict | None:
    """One request to `codex app-server` (JSON-RPC on stdio): its reply ({"result"} or {"error"}),
    None when the CLI didn't start or answer in time."""
    hello = {"clientInfo": {"name": "telegram-dashboard", "version": "0"}}
    msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": hello},
            {"jsonrpc": "2.0", "method": "initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": method, **({"params": params} if params else {})}]  # fmt: skip
    cmd = [*exe(settings, "codex"), "app-server"]
    proc = None
    with contextlib.suppress(OSError):
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=tempfile.gettempdir(), env=child_env(), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=1 << 22,
        )  # fmt: skip
    if proc is None:
        return None

    async def answer() -> dict | None:  # the server stays up while stdin is open: read until our reply
        proc.stdin.write("".join(json.dumps(m) + "\n" for m in msgs).encode())
        await proc.stdin.drain()
        async for raw in proc.stdout:
            with contextlib.suppress(ValueError):
                ev = json.loads(raw)
                if isinstance(ev, dict) and ev.get("id") == 2:
                    return ev
        return None

    try:
        return await asyncio.wait_for(answer(), 20)
    except TimeoutError, OSError:
        return None
    finally:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()


def _iso(at) -> str | None:
    return datetime.fromtimestamp(at, UTC).isoformat() if isinstance(at, int) else None


async def _codex_quota(settings) -> dict:
    """The ChatGPT plan's windows and its free rate-limit resets, from `codex app-server` (read only: no model call)."""
    res = (await _codex_rpc(settings, "account/rateLimits/read") or {}).get("result")
    res = res if isinstance(res, dict) else {}
    rl = res.get("rateLimits") if isinstance(res.get("rateLimits"), dict) else {}
    out = []
    for w in (rl.get("primary"), rl.get("secondary")):
        if isinstance(w, dict) and isinstance(w.get("usedPercent"), int | float):
            mins = w.get("windowDurationMins")
            out.append({"label": "5h" if mins == 300 else "1w" if mins == 10080 else f"{mins} phút",
                        "percent": w["usedPercent"], "resets_at": _iso(w.get("resetsAt"))})  # fmt: skip
    rc = res.get("rateLimitResetCredits") if isinstance(res.get("rateLimitResetCredits"), dict) else {}
    resets = [
        {
            "id": c["id"],
            "title": c.get("title"),
            "description": c.get("description"),
            "expires_at": _iso(c.get("expiresAt")),
        }  # fmt: skip
        for c in rc.get("credits") or []
        if isinstance(c, dict) and isinstance(c.get("id"), str) and c.get("status") == "available"
    ]
    n = rc.get("availableCount")
    return {"usage": out, "resets": resets, "resets_left": n if isinstance(n, int) else len(resets)}


async def codex_reset(settings, credit_id: str | None, *, request_id: str | None = None) -> str:
    """Redeem one free rate-limit reset (the next available one without `credit_id`), then read the quota
    again. No answer = it may have gone through: never retried here, the user looks at the quota first."""
    if not installed(settings, "codex"):
        raise ApiError(422, "ai_cli_missing")
    ask = {"idempotencyKey": request_id or str(uuid.uuid4()), "creditId": credit_id}
    got = await _codex_rpc(settings, "account/rateLimitResetCredit/consume", ask)
    with contextlib.suppress(Exception):  # the fresh quota is best effort; the outcome is what matters
        await quota(settings, "codex", fresh=True)
    if got is None:
        raise ApiError(504, "ai_reset_unknown")
    if not isinstance(got.get("result"), dict):
        err = got.get("error")
        raise ApiError(502, "ai_provider_error", detail=str(err.get("message") if isinstance(err, dict) else err)[:300])
    o = got["result"].get("outcome")
    return o if o in ("reset", "nothingToReset", "noCredit", "alreadyRedeemed") else "unknown"


async def _agy_quota(settings) -> dict:
    """Remaining share of each model group's 5-hour and weekly limit, from `agy -p /usage`."""
    got = await run_cli([*exe(settings, "antigravity"), "-p", "/usage", "--output-format", "json"])
    try:
        data = json.loads(got[1] if got else b"")["command"]["data"]
    except ValueError, KeyError, TypeError:
        return {"usage": []}
    out = []
    for g in data.get("groups") or [] if isinstance(data, dict) else []:
        name = str(g.get("name") or "").removesuffix(" Models").removesuffix(" models").replace(" and ", " & ")
        buckets = [b for b in g.get("buckets") or [] if isinstance(b, dict)]
        for b in sorted(buckets, key=lambda b: b.get("window") != "5h"):  # 5 hours, then the week
            left = b.get("remaining_fraction")
            if isinstance(left, int | float) and b.get("window") in ("5h", "weekly"):
                out.append({"label": f"{'5h' if b['window'] == '5h' else '1w'} · {name}",
                            "percent": round((1 - left) * 100, 1), "resets_at": b.get("reset_time")})  # fmt: skip
    return {"usage": out}


async def quota(settings, p: str, fresh: bool = False) -> tuple[dict, str | None]:
    """A signed-in CLI's plan windows ({"usage": [{label, percent used, resets_at}]}, Codex adds its free
    "resets") and when they were read; read at most every USAGE_EVERY seconds (the card polls), unless `fresh`."""
    async with _quota_lock.setdefault(p, asyncio.Lock()):  # polls that overlap share one read
        got = _quota.get(p)
        if fresh or got is None or time.monotonic() - got[0] >= USAGE_EVERY:
            q = await (_codex_quota if p == "codex" else _agy_quota)(settings)
            got = (time.monotonic(), q, datetime.now(UTC).isoformat(timespec="seconds"))
            if q["usage"] or p not in _quota:  # a failed read keeps the last good one
                _quota[p] = got
            got = _quota[p]
    return got[1], got[2] if got[1]["usage"] else None


async def account(settings, p: str, fresh: bool = False) -> dict:
    out = {
        "provider": p,
        "installed": installed(settings, p),
        "loggedIn": False,
        "install": INSTALL[p],
    }
    if p == "codex":
        if out["installed"]:
            got = await run_cli([*exe(settings, p), "login", "status"], timeout=15, merge=True)
            if got is None:
                raise ApiError(502, "ai_cli_unavailable")
            text = got[1].decode(errors="replace")
            out["loggedIn"] = got[0] == 0 and "Logged in" in text
            out["method"] = "ChatGPT" if "ChatGPT" in text else "API key" if out["loggedIn"] else None
        if out["loggedIn"]:
            tokens = _read_json(_codex_home() / "auth.json").get("tokens") or {}
            c = _jwt_claims(tokens.get("id_token") if isinstance(tokens, dict) else None)
            auth = (
                c.get("https://api.openai.com/auth") if isinstance(c.get("https://api.openai.com/auth"), dict) else {}
            )
            out["email"] = c.get("email")
            out["plan"] = auth.get("chatgpt_plan_type")
        pending = _login_pending()
        out |= {"login_pending": pending, "login_url": _login["url"] if pending else None}
    else:  # antigravity: the login lives in the macOS keychain; agy notes when its sign-in finished
        done = _read_json(_agy_home() / "cache" / "onboarding.json").get("onboardingComplete") is True
        out |= {"loggedIn": out["installed"] and done, "method": "Google"}
    if out["loggedIn"]:
        q, out["usage_at"] = await quota(settings, p, fresh)
        out |= q
    return out


async def login(settings, p: str) -> str | None:
    """Codex: start `codex login` (it opens the browser; returns the URL in case it can't).
    Antigravity: open Terminal on an interactive `agy`, which signs in with Google on first run."""
    if not installed(settings, p):
        raise ApiError(422, "ai_cli_missing")
    if p == "antigravity" and sys.platform == "win32":
        subprocess.Popen(["cmd", "/k", *exe(settings, p)], env=child_env(),
                         creationflags=subprocess.CREATE_NEW_CONSOLE)  # fmt: skip
        return None
    if p == "antigravity":
        cmd = shlex.join(exe(settings, p))
        code, out = await osascript(
            f'tell application "Terminal"\nactivate\ndo script {applescript_str(cmd)}\nend tell'
        )
        if code != 0:
            raise ApiError(502, "terminal_failed", detail=out[-200:] or None)
        return None
    async with _codex_login_lock:  # two clicks: one `codex login`, not two fighting over its callback port
        if _login_pending():
            return _login["url"]
        try:
            proc = await asyncio.create_subprocess_exec(
                *exe(settings, p), "login", env=child_env(),
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )  # fmt: skip
        except OSError:
            raise ApiError(502, "ai_cli_unavailable") from None
        _login.update(proc=proc, url=None)
        last = [""]

        async def read_url() -> None:
            async for line in proc.stdout:
                last[0] = line.decode(errors="replace").strip() or last[0]
                if m := _CODEX_URL.search(last[0]):
                    _login["url"] = m.group(0)
                    return

        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(read_url(), 10)
        if not _login["url"]:
            await login_failed(proc, last[0], "ai_login_failed")
        # ponytail: an abandoned login keeps its local callback server up until the next login/logout.
        spawn(proc.communicate())  # drain and reap it when it finishes
        return _login["url"]


async def logout(settings, p: str) -> None:
    if p != "codex":  # agy has no logout command: /logout inside agy signs out
        raise ApiError(422, "ai_logout_unsupported")
    if _login_pending():
        _login["proc"].kill()
    if await run_cli([*exe(settings, p), "logout"], timeout=15) is None:
        raise ApiError(502, "ai_cli_unavailable")
