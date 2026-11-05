"""The AI CLIs (Claude, Codex, Antigravity): which one runs, its model/effort, logins, commands and output.

One pick in Settings › AI runs every AI feature; each CLI keeps its own model/effort picks, so
switching away and back finds them again. `catalog` is what each CLI offers, read in one place.
Like Claude, each CLI owns its login and its token; the dashboard only starts a login, reads who
is signed in, and turns the CLI's JSON events into the same items a Claude run gives.
A task's session id carries its CLI ("codex:<thread>", "antigravity:<conversation>"; bare = Claude), so a
follow-up resumes in the CLI that started it, with that CLI's picks, whatever is picked now.
"""

import asyncio
import base64
import contextlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from .claude import USAGE_EVERY, quota_now
from .config import _read_json, child_env, write_private_json
from .errors import ApiError

PROVIDERS = ("claude", "codex", "antigravity")
OTHERS = ("codex", "antigravity")
NAMES = {"claude": "Claude", "codex": "Codex", "antigravity": "Antigravity"}
INSTALL = {
    "claude": "npm i -g @anthropic-ai/claude-code",
    "codex": "npm i -g @openai/codex",
    "antigravity": "curl -fsSL https://antigravity.google/cli/install.sh | bash",
}
EFFORTS = ("low", "medium", "high", "xhigh", "max")
PICKS = ("model", "effort", "task_model", "task_effort")
MODEL_RE = re.compile(r"^[A-Za-z][\w.\-\[\]]*$")  # an alias or id, never a flag
CLAUDE_MODELS = [
    ("haiku", "Haiku", "Nhanh, tiết kiệm hạn mức"),
    ("sonnet", "Sonnet", "Cân bằng tốc độ và chất lượng"),
    ("opus", "Opus", "Suy luận sâu, chậm hơn"),
    ("fable", "Fable", "Mạnh nhất, tốn hạn mức nhất"),
]
# ponytail: `agy models` (a network call) as of 1.4.12; read it at run time if the list churns.
AGY_MODELS = [
    ("gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)", "Nhanh nhất"),
    ("gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)", "Cân bằng"),
    ("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)", "Suy luận sâu hơn"),
    ("claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)", "Qua hạn mức Antigravity"),
    ("claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)", "Mạnh nhất, chậm nhất"),
    ("gpt-oss-120b-medium", "GPT-OSS 120B (Medium)", "Model mở"),
]
TIERS = {"haiku": 0, "sonnet": 1, "opus": 2, "fable": 3}
# Antigravity runs as a custom agent with only these built-in tools (no web or browser; shell only in
# task sessions), none of the user's skills/plugins, and deny rules over the user's own allow rules.
AGY_TOOLS = {"read": ["view_file", "list_dir", "grep_search", "find_by_name"]}
AGY_TOOLS["edit"] = [*AGY_TOOLS["read"], "write_to_file", "replace_file_content", "multi_replace_file_content"]
AGY_SHELL = ["run_command", "command_status", "send_command_input"]
_AGY_DENY = ["mcp(*)", "read_url(*)", "execute_url(*)"]


# ---- prefs: which CLI, and each CLI's model/effort ----


def prefs(settings) -> dict:
    """The picked CLI and every CLI's model/effort ("" = that CLI's default) over the .env
    defaults (Claude's). A file from before per-CLI picks holds Claude's picks at the top level."""
    saved = _read_json(settings.claude_prefs_path)
    old = saved.get("by")
    by_saved = old if isinstance(old, dict) else {"claude": saved}
    env = {"model": settings.ai_model, "effort": settings.ai_effort,
           "task_model": settings.ai_task_model, "task_effort": settings.ai_task_effort}  # fmt: skip
    by = {}
    for p in PROVIDERS:
        got = by_saved.get(p) if isinstance(by_saved.get(p), dict) else {}
        base = env if p == "claude" else dict.fromkeys(PICKS, "")
        by[p] = {k: got[k] if isinstance(got.get(k), str) else base[k] for k in PICKS}
    for k in ("model", "task_model"):  # full ids (claude-haiku-5-5) -> the alias the CLI knows
        by["claude"][k] = re.sub(r"^claude-(haiku|sonnet|opus|fable)\b.*", r"\1", by["claude"][k])
    at = saved.get("fallback_at")
    picked = "antigravity" if saved.get("provider") == "gemini" else saved.get("provider")  # Gemini CLI's Google login is gone
    return {
        "provider": picked if picked in PROVIDERS else "claude",
        "by": by,
        "fallback": saved.get("fallback") is True,
        "fallback_at": at if isinstance(at, int) and not isinstance(at, bool) else 90,
    }


def save_prefs(settings, p: dict) -> None:
    settings.ensure_data_dir()
    write_private_json(settings.claude_prefs_path, p)


def chosen(settings) -> str:
    """The CLI that runs every AI feature (a resumed task keeps the CLI that started it)."""
    return prefs(settings)["provider"]


def run_choice(settings, task: bool = False, provider: str | None = None) -> tuple[str, str, bool]:
    """Model, effort and whether the model was stepped down, for `provider` (default: the picked
    CLI): drafts/summaries/digests, or tasks/AI Agent. Claude only: with fallback on, a window at or
    past `fallback_at`% runs the cheap model."""
    p = prefs(settings)
    provider = provider or p["provider"]
    c = p["by"][provider]
    model, effort = (c["task_model"], c["task_effort"]) if task else (c["model"], c["effort"])
    if provider != "claude":
        return model, effort if provider == "codex" else "", False  # Antigravity's models carry their level
    cheap = "sonnet" if task else "haiku"
    if (
        p["fallback"]
        and TIERS.get(model, 9) > TIERS[cheap]  # "" (CLI default) or an id: assume costlier
        and max(quota_now(settings).values(), default=0) >= p["fallback_at"]
    ):
        return cheap, effort, True
    return model, effort, False


def _options(rows) -> list[dict]:
    return [{"value": "", "label": "Mặc định", "hint": "Model mặc định của CLI"},
            *({"value": v, "label": label, "hint": hint} for v, label, hint in rows)]  # fmt: skip


def _codex_models() -> tuple[list, list[str]]:
    """The models Codex lists (its own cache of the account's models) and the efforts they take.
    A routed id ("Provider/model") needs the user's own config, which a run here ignores."""
    data = _read_json(_codex_home() / "models_cache.json").get("models")
    rows, efforts = [], set()
    for m in data if isinstance(data, list) else []:
        if not isinstance(m, dict) or m.get("visibility") != "list":
            continue
        slug = m.get("slug")
        if not isinstance(slug, str) or len(slug) > 80 or not MODEL_RE.match(slug):
            continue
        rows.append((slug, str(m.get("display_name") or slug), str(m.get("description") or "")))
        levels = m.get("supported_reasoning_levels")
        for lv in levels if isinstance(levels, list) else []:
            if isinstance(lv, dict):
                efforts.add(lv.get("effort"))
    return rows, [e for e in EFFORTS if e in efforts] or ["low", "medium", "high", "xhigh"]


def catalog(settings) -> list[dict]:
    """What each CLI offers: models and efforts ("" = its default, listed first; no efforts: the
    CLI takes none), whether it has a quota and model fallback (Claude), and how to install it."""
    codex, codex_efforts = _codex_models()
    rows = {"claude": (CLAUDE_MODELS, EFFORTS), "codex": (codex, codex_efforts), "antigravity": (AGY_MODELS, ())}
    return [
        {"id": p, "name": NAMES[p], "models": _options(rows[p][0]),
         "efforts": ["", *rows[p][1]] if rows[p][1] else [], "quota": p == "claude", "install": INSTALL[p]}  # fmt: skip
        for p in PROVIDERS
    ]


def exe(settings, p: str) -> list[str]:
    cmd = {
        "claude": settings.ai_task_command,
        "codex": settings.codex_command,
        "antigravity": settings.antigravity_command,
    }[p]
    try:
        return shlex.split(cmd)
    except ValueError:
        return []


def installed(settings, p: str) -> bool:
    e = exe(settings, p)
    return bool(e) and shutil.which(e[0]) is not None


def new_session(settings) -> str:
    """Session id for a new task on the picked CLI; Codex and Antigravity name theirs once it starts."""
    p = chosen(settings)
    return {"claude": str(uuid.uuid4()), "codex": "codex:", "antigravity": "antigravity:"}[p]


def split_session(session_id: str) -> tuple[str, str]:
    p, sep, rest = session_id.partition(":")
    return (p, rest) if sep and p in OTHERS else ("claude", session_id)


# ---- commands ----


def _codex_base(settings, model: str, effort: str) -> list[str]:
    return ["--json", "--skip-git-repo-check", "--ignore-user-config", "-c", 'web_search="disabled"',
            *(["-m", model] if model else []),
            *(["-c", f'model_reasoning_effort="{effort}"'] if effort in EFFORTS else [])]  # fmt: skip


def _agy_agent(kind: str, shell: bool) -> str:
    """The custom agent a run uses, written where agy looks agents up by name: `read` or `edit` (+ shell)."""
    name = f"telegram-dashboard-{kind}{'-shell' if shell else ''}"
    path = _agy_home() / "agents" / f"{name}.md"
    tools = [*AGY_TOOLS[kind], *(AGY_SHELL if shell else [])]
    text = (f"---\nname: {name}\ndescription: Telegram Dashboard run ({kind})\n"
            f"tools: [{', '.join(tools)}]\ninheritCustomizations: false\n---\n"
            f"Work only through the tools you have; you cannot {'browse' if shell else 'run commands or browse'}.\n")  # fmt: skip
    if not path.is_file() or path.read_text() != text:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return name


def _agy_base(settings, kind: str, model: str, shell: bool = False) -> list[str]:
    deny = [*_AGY_DENY, *(["write_file(*)"] if kind == "read" else []), *([] if shell else ["command(*)"])]
    # headless agy auto-denies what it would prompt for: shell needs an explicit allow
    perms = {"deny": deny, **({"allow": ["command(*)"]} if shell else {})}
    return [*exe(settings, "antigravity"), "-p", "", "--input-format", "stream-json", "--output-format", "stream-json",
            "--disable-slash-commands", "--agent", _agy_agent(kind, shell),
            "--settings", json.dumps({"permissions": perms}), *(["--model", model] if model else [])]  # fmt: skip


def stdin(p: str, text: str) -> bytes:
    """The prompt as the CLI reads it on stdin: Antigravity takes one NDJSON message per turn."""
    if p == "antigravity":
        return (json.dumps({"event": "user", "message": {"content": text}}, ensure_ascii=False) + "\n").encode()
    return text.encode()


def ask_cmd(settings, p: str, *, tools: bool, read_dir: str | None, model: str, effort: str) -> list[str]:
    """One read-only answer (prompt on stdin). `tools`: may read the project (cwd); else none."""
    if p == "codex":
        off = [] if tools else ["--disable", "shell_tool", "--disable", "unified_exec"]
        return [
            *exe(settings, p),
            "exec",
            *_codex_base(settings, model, effort),
            "--ephemeral",
            "-s",
            "read-only",
            *off,
            "-",
        ]
    return [*_agy_base(settings, "read", model), *(["--add-dir", read_dir] if read_dir else [])]


def task_cmd(settings, p: str, mode: str, sid: str, resume: bool, model: str, effort: str) -> list[str]:
    """One task turn (prompt on stdin): `plan` reads files, `edit` may edit them; both may run shell commands."""
    if p == "codex":
        sandbox = ["-c", f'sandbox_mode="{"read-only" if mode == "plan" else "workspace-write"}"']
        head = [*exe(settings, p), "exec", *(["resume"] if resume else [])]
        return [*head, *_codex_base(settings, model, effort), *sandbox, *([sid] if resume else []), "-"]
    edit = ["--mode", "accept-edits"] if mode != "plan" else []
    return [*_agy_base(settings, "read" if mode == "plan" else "edit", model, shell=True), *edit,
            *(["--conversation", sid] if resume else [])]  # fmt: skip


# ---- output: JSON events -> display items ----


def _short(inp) -> str:
    if isinstance(inp, dict):
        for key in (
            "command",
            "file_path",
            "absolute_path",
            "pattern",
            "dir_path",
            "path",
            "url",
            "query",
            "AbsolutePath",  # Antigravity's tool parameters
            "TargetFile",
            "Path",
            "SearchDirectory",
            "Query",
        ):
            if isinstance(inp.get(key), str):
                return inp[key][:160]
    return json.dumps(inp, ensure_ascii=False)[:120]


def items(p: str, ev: dict, st: dict) -> list[dict]:
    """One JSON event -> items: assistant / tool / tool_result / result as agent.py logs them, plus
    "session" (the CLI's id), "reset" and "delta" (answer text as it streams). `st` keeps the
    answer so far and the model between events of one run; a result carries `final`, its usage
    in the shape of a Claude result event, for the run log."""
    out: list[dict] = []
    kind = ev.get("type")
    if p == "codex":
        it = ev.get("item") if isinstance(ev.get("item"), dict) else {}
        if kind == "thread.started":
            out.append({"kind": "session", "id": str(ev.get("thread_id") or "")})
        elif (
            kind == "item.completed"
            and it.get("type") == "agent_message"
            and str(it.get("text", "")).strip()
        ):
            st["text"] = it["text"]
            out += [
                {"kind": "reset"},
                {"kind": "delta", "text": it["text"]},
                {"kind": "assistant", "text": it["text"]},
            ]
        elif kind == "item.completed" and it.get("type") == "command_execution":
            code = it.get("exit_code")
            out += [{"kind": "tool", "text": f"Shell  {str(it.get('command', ''))[:160]}"},
                    {"kind": "tool_result", "text": str(it.get("aggregated_output") or "").strip()[:400],
                     "error": code not in (0, None)}]  # fmt: skip
        elif kind == "item.completed" and it.get("type") == "file_change":
            paths = ", ".join(
                str(c.get("path", "")) for c in it.get("changes") or [] if isinstance(c, dict)
            )
            out.append({"kind": "tool", "text": f"Edit  {paths[:160]}"})
        elif kind == "item.completed" and it.get("type") in ("mcp_tool_call", "web_search"):
            out.append({"kind": "tool", "text": f"{it['type']}  {_short(it)}"})
        elif kind == "turn.completed":
            u = ev.get("usage") if isinstance(ev.get("usage"), dict) else {}
            n = lambda k: u.get(k) if isinstance(u.get(k), int) else 0  # noqa: E731
            usage = {"input_tokens": n("input_tokens") - n("cached_input_tokens"), "output_tokens": n("output_tokens"),
                     "cache_read_input_tokens": n("cached_input_tokens")}  # fmt: skip
            out.append({"kind": "result", "text": st.get("text", ""), "error": False,
                        "final": {"usage": usage, "num_turns": 1, "is_error": False}})  # fmt: skip
        elif kind == "turn.failed" or (kind == "error" and ev.get("message")):
            err = ev.get("error") if isinstance(ev.get("error"), dict) else {}
            text = str(err.get("message") or ev.get("message") or "Codex lỗi")
            if kind == "error":  # also sent while it retries: a note, the turn may still finish
                out.append({"kind": "tool_result", "text": text[:400], "error": True})
            else:
                out.append(
                    {"kind": "result", "text": text, "error": True, "final": {"is_error": True}}
                )
    else:  # antigravity: {"event": kind, kind: {...}}, the answer streams as text deltas of its steps
        kind = ev.get("event")
        b = ev.get(kind) if isinstance(ev.get(kind), dict) else {}
        if kind == "init":
            st["model"] = f"antigravity/{b['model']}" if b.get("model") else None
            out.append({"kind": "session", "id": str(ev.get("conversation_id") or "")})
        elif kind == "step_update" and b.get("step_type") == "agent_response" and b.get("text_delta"):
            piece = str(b["text_delta"])
            st["text"] = st.get("text", "") + piece
            out.append({"kind": "delta", "text": piece})
        elif kind == "step_update" and b.get("step_type") == "tool":
            info = b.get("tool_info") if isinstance(b.get("tool_info"), dict) else {}
            seen = st.setdefault("tools", set())
            if b.get("step_index") not in seen:  # its first update: the call
                seen.add(b.get("step_index"))
                if st.get("text", "").strip():  # the text before a tool call is a message of its own
                    out.append({"kind": "assistant", "text": st["text"]})
                st["text"] = ""
                out += [{"kind": "reset"}, {"kind": "tool", "text": f"{b.get('tool_name', '?')}  {_short(info.get('parameters'))}"}]
            if b.get("state") in ("DONE", "ERROR"):
                err = info.get("error") if isinstance(info.get("error"), dict) else {}
                out.append({"kind": "tool_result", "text": str(err.get("message") or info.get("output") or "").strip()[:400],
                            "error": b["state"] == "ERROR"})  # fmt: skip
        elif kind == "result":
            bad = b.get("status") != "SUCCESS"
            u = b.get("usage") if isinstance(b.get("usage"), dict) else {}
            n = lambda k: u.get(k) if isinstance(u.get(k), int) else 0  # noqa: E731
            text = str(b.get("error") or "Antigravity lỗi") if bad else str(b.get("response") or st.get("text", ""))
            if not bad and text.strip():
                out.append({"kind": "assistant", "text": text})
            usage = {"input_tokens": max(0, n("input_tokens") - n("cache_read_tokens")), "output_tokens": n("output_tokens"),
                     "cache_read_input_tokens": n("cache_read_tokens")}  # fmt: skip
            secs = b.get("duration_seconds")
            out.append({"kind": "result", "text": text, "error": bad,
                        "final": {"usage": usage, "num_turns": b.get("num_turns") if isinstance(b.get("num_turns"), int) else 1, "is_error": bad,
                                  **({"duration_ms": round(secs * 1000)} if isinstance(secs, int | float) else {})}})  # fmt: skip
    return out


# ---- accounts ----

_login: dict = {"proc": None, "url": None}  # a dashboard-started `codex login`
_quota: dict = {}  # provider -> (monotonic time read, windows, ISO time read)
_quota_lock: dict[str, asyncio.Lock] = {}
_CODEX_URL = re.compile(r"https://auth\.openai\.com/\S+")


def _agy_home() -> Path:
    return Path.home() / ".gemini" / "antigravity-cli"


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


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


async def _cli_out(cmd: list[str], stdin: bytes | None = None, timeout: float = 30) -> bytes:
    """stdout of a short CLI call ("" when it fails), run outside any project."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=tempfile.gettempdir(), env=child_env(), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )  # fmt: skip
    except OSError:
        return b""
    try:
        return (await asyncio.wait_for(proc.communicate(stdin), timeout))[0]
    except TimeoutError:
        proc.kill()
        await proc.wait()
        return b""


async def _codex_quota(settings) -> list[dict]:
    """The ChatGPT plan's windows, from `codex app-server` (read only: no model call)."""
    msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {"name": "telegram-dashboard", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "initialized"}, {"jsonrpc": "2.0", "id": 2, "method": "account/rateLimits/read"}]  # fmt: skip
    cmd = [*exe(settings, "codex"), "app-server"]
    proc = None
    with contextlib.suppress(OSError):
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=tempfile.gettempdir(), env=child_env(), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=1 << 22,
        )  # fmt: skip
    if proc is None:
        return []

    async def answer() -> dict:  # the server stays up while stdin is open: read until our reply
        proc.stdin.write("".join(json.dumps(m) + "\n" for m in msgs).encode())
        await proc.stdin.drain()
        async for raw in proc.stdout:
            with contextlib.suppress(ValueError):
                ev = json.loads(raw)
                if isinstance(ev, dict) and ev.get("id") == 2:
                    return ev.get("result") or {}
        return {}

    try:
        res = await asyncio.wait_for(answer(), 20)
    except (TimeoutError, OSError):
        res = {}
    finally:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
    rl = res.get("rateLimits") if isinstance(res.get("rateLimits"), dict) else {}
    out = []
    for w in (rl.get("primary"), rl.get("secondary")):
        if isinstance(w, dict) and isinstance(w.get("usedPercent"), int | float):
            mins = w.get("windowDurationMins")
            at = w.get("resetsAt")
            out.append({"label": "5h" if mins == 300 else "1w" if mins == 10080 else f"{mins} phút",
                        "percent": w["usedPercent"],
                        "resets_at": datetime.fromtimestamp(at, UTC).isoformat() if isinstance(at, int) else None})  # fmt: skip
    return out


async def _agy_quota(settings) -> list[dict]:
    """Remaining share of each model group's 5-hour and weekly limit, from `agy -p /usage`."""
    raw = await _cli_out([*exe(settings, "antigravity"), "-p", "/usage", "--output-format", "json"])
    try:
        data = json.loads(raw)["command"]["data"]
    except (ValueError, KeyError, TypeError):
        return []
    out = []
    for g in data.get("groups") or [] if isinstance(data, dict) else []:
        name = str(g.get("name") or "").removesuffix(" Models").removesuffix(" models").replace(" and ", " & ")
        buckets = [b for b in g.get("buckets") or [] if isinstance(b, dict)]
        for b in sorted(buckets, key=lambda b: b.get("window") != "5h"):  # 5 hours, then the week
            left = b.get("remaining_fraction")
            if isinstance(left, int | float) and b.get("window") in ("5h", "weekly"):
                out.append({"label": f"{'5h' if b['window'] == '5h' else '1w'} · {name}",
                            "percent": round((1 - left) * 100, 1), "resets_at": b.get("reset_time")})  # fmt: skip
    return out


async def quota(settings, p: str, fresh: bool = False) -> tuple[list[dict], str | None]:
    """A signed-in CLI's plan windows ({label, percent used, resets_at}) and when they were read;
    read at most every USAGE_EVERY seconds (the account card polls), unless `fresh`."""
    async with _quota_lock.setdefault(p, asyncio.Lock()):  # polls that overlap share one read
        got = _quota.get(p)
        if fresh or got is None or time.monotonic() - got[0] >= USAGE_EVERY:
            windows = await (_codex_quota if p == "codex" else _agy_quota)(settings)
            got = (time.monotonic(), windows, datetime.now(UTC).isoformat(timespec="seconds"))
            if windows or p not in _quota:  # a failed read keeps the last good one
                _quota[p] = got
            got = _quota[p]
    return got[1], got[2] if got[1] else None


async def account(settings, p: str, fresh: bool = False) -> dict:
    out = {
        "provider": p,
        "installed": installed(settings, p),
        "loggedIn": False,
        "install": INSTALL[p],
    }
    if p == "codex":
        if out["installed"]:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *exe(settings, p), "login", "status", env=child_env(),
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )  # fmt: skip
                text = (await asyncio.wait_for(proc.communicate(), 15))[0].decode(errors="replace")
                out["loggedIn"] = proc.returncode == 0 and "Logged in" in text
                out["method"] = (
                    "ChatGPT" if "ChatGPT" in text else "API key" if out["loggedIn"] else None
                )
            except OSError, TimeoutError:
                raise ApiError(502, "ai_cli_unavailable") from None
        if out["loggedIn"]:
            tokens = _read_json(_codex_home() / "auth.json").get("tokens") or {}
            c = _jwt_claims(tokens.get("id_token") if isinstance(tokens, dict) else None)
            auth = (
                c.get("https://api.openai.com/auth")
                if isinstance(c.get("https://api.openai.com/auth"), dict)
                else {}
            )
            out["email"] = c.get("email")
            out["plan"] = auth.get("chatgpt_plan_type")
        pending = _login_pending()
        out |= {"login_pending": pending, "login_url": _login["url"] if pending else None}
    else:  # antigravity: the login lives in the macOS keychain; agy notes when its sign-in finished
        done = _read_json(_agy_home() / "cache" / "onboarding.json").get("onboardingComplete") is True
        out |= {"loggedIn": out["installed"] and done, "method": "Google"}
    if out["loggedIn"]:
        out["usage"], out["usage_at"] = await quota(settings, p, fresh)
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
        from .ai import _applescript_str, _osascript  # ai imports this module

        cmd = shlex.join(exe(settings, p))
        code, out = await _osascript(
            f'tell application "Terminal"\nactivate\ndo script {_applescript_str(cmd)}\nend tell'
        )
        if code != 0:
            raise ApiError(502, "terminal_failed", detail=out[-200:] or None)
        return None
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

    async def read_url() -> None:
        async for line in proc.stdout:
            if m := _CODEX_URL.search(line.decode(errors="replace")):
                _login["url"] = m.group(0)
                return

    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(read_url(), 10)
    # ponytail: an abandoned login keeps its local callback server up until the next login/logout.
    asyncio.get_running_loop().create_task(proc.communicate())  # drain and reap it when it finishes
    return _login["url"]


async def logout(settings, p: str) -> None:
    if p != "codex":  # agy has no logout command: /logout inside agy signs out
        raise ApiError(422, "ai_logout_unsupported")
    if _login_pending():
        _login["proc"].kill()
    try:
        proc = await asyncio.create_subprocess_exec(
            *exe(settings, p), "logout", env=child_env(),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )  # fmt: skip
        await asyncio.wait_for(proc.wait(), 15)
    except OSError, TimeoutError:
        raise ApiError(502, "ai_cli_unavailable") from None
