"""The AI CLIs (Claude, Codex, Antigravity): which one runs, its model/effort, and its output as items.
Command lines and sandbox: provider_cmds.py; Codex / Antigravity logins and quota: provider_accounts.py.

Each kind of run (drafts, Briefing, tasks / AI Agent, YouTrack light / heavy) runs on the CLI of the
model picked for it (`use`), so one model list holds every CLI's models; each CLI keeps its own
model/effort picks, so switching away and back finds them again. `catalog` is what each CLI offers, read in one place.
Like Claude, each CLI owns its login and its token; the dashboard only starts a login, reads who
is signed in, and turns the CLI's JSON events into the same items a Claude run gives.
A task's session id carries its CLI ("codex:<thread>", "antigravity:<conversation>"; bare = Claude), so a
follow-up resumes in the CLI that started it, with that CLI's picks, whatever is picked now.
"""

import asyncio
import contextlib
import json
import os
import re
import shlex
import shutil
import tomllib
import uuid
from pathlib import Path

from .claude import quota_now
from .config import _read_json, write_private_json

PROVIDERS = ("claude", "codex", "antigravity")
OTHERS = ("codex", "antigravity")
NAMES = {"claude": "Claude", "codex": "Codex", "antigravity": "Antigravity"}
INSTALL = {
    "claude": "npm i -g @anthropic-ai/claude-code",
    "codex": "npm i -g @openai/codex",
    "antigravity": "curl -fsSL https://antigravity.google/cli/install.sh | bash",
}
EFFORTS = ("low", "medium", "high", "xhigh", "max")  # Claude's
CODEX_EFFORTS = (*EFFORTS, "ultra")  # what Codex's catalog may list per model
PICKS = ("model", "effort", "task_model", "task_effort", "brief_model", "brief_effort",
         "yt_model", "yt_effort", "yt_task_model", "yt_task_effort", "guide_model", "guide_effort")  # fmt: skip
# Each kind of run, the kind its "" picks fall back to, and its model / effort keys in a CLI's picks.
BASE = {"chat": "chat", "brief": "chat", "task": "task", "yt": "chat", "yt_task": "task", "guide": "chat"}
KEYS = {k: ("model", "effort") if k == "chat" else (f"{k}_model", f"{k}_effort") for k in BASE}
# An alias or id, never a flag; "provider/model": a model a local proxy (opencodex) routes for Codex.
MODEL_RE = re.compile(r"^[A-Za-z][\w.\-\[\]]*(/[\w.\-\[\]]+)?$")
# Codex's base URL when the user routes it through a local proxy (opencodex: http://127.0.0.1:10100/v1).
LOOPBACK = re.compile(r"^http://(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}(/[\w.\-/]*)?$")
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
# A Zeplin link (zpl.io short link too) in a session: the user's own zeplin MCP server (Claude / Codex config, or
# Antigravity's own) with its read-only tools, in every turn, read-only ones too, so the design is read, not guessed.
# download_layer_asset (writes files) only comes with "Dùng MCP / plugin".
ZEPLIN = re.compile(r"https?://(?:zpl\.io|app\.zeplin\.io|scene\.zeplin\.io)/\S+")


# ---- prefs: which CLI, and each CLI's model/effort ----


def prefs(settings) -> dict:
    """The CLI each kind of run uses and every CLI's model/effort ("" = that CLI's default) over the
    .env defaults (Claude's). A file from before per-CLI picks holds Claude's picks at the top level;
    one from before per-kind CLIs has one `provider` for all."""
    saved = _read_json(settings.claude_prefs_path)
    old = saved.get("by")
    by_saved = old if isinstance(old, dict) else {"claude": saved}
    env = dict.fromkeys(PICKS, "") | {
        "model": settings.ai_model, "effort": settings.ai_effort,
        "task_model": settings.ai_task_model, "task_effort": settings.ai_task_effort,
    }  # fmt: skip
    by = {}
    for p in PROVIDERS:
        got = by_saved.get(p) if isinstance(by_saved.get(p), dict) else {}
        base = env if p == "claude" else dict.fromkeys(PICKS, "")
        by[p] = {k: got[k] if isinstance(got.get(k), str) else base[k] for k in PICKS}
    for k in (k for k in PICKS if k.endswith("model")):  # full ids (claude-haiku-5-5) -> the alias the CLI knows
        by["claude"][k] = re.sub(r"^claude-(haiku|sonnet|opus|fable)\b.*", r"\1", by["claude"][k])
    at = saved.get("fallback_at")
    # Gemini CLI's Google login is gone: its pick moves to Antigravity
    old = "antigravity" if saved.get("provider") == "gemini" else saved.get("provider")
    old = old if old in PROVIDERS else "claude"
    got = saved.get("use") if isinstance(saved.get("use"), dict) else {}
    use = {k: got[k] if got.get(k) in PROVIDERS else old if BASE[k] == k else "" for k in BASE}
    return {
        "use": use,
        "by": by,
        "fallback": saved.get("fallback") is True,
        "fallback_at": at if isinstance(at, int) and not isinstance(at, bool) else 90,
    }


def save_prefs(settings, p: dict) -> None:
    settings.ensure_data_dir()
    write_private_json(settings.claude_prefs_path, p)


def _kind(task: bool, brief: bool, yt: bool, guide: bool = False) -> str:
    if guide:
        return "guide"
    return ("yt_task" if task else "yt") if yt else "task" if task else "brief" if brief else "chat"


def _on(p: dict, kind: str) -> str:
    return p["use"][kind] or p["use"][BASE[kind]]


def chosen(settings, *, task: bool = False, brief: bool = False, yt: bool = False, guide: bool = False) -> str:
    """The CLI a kind of run uses: drafts (default), `brief`, `task` / AI Agent, `yt` (a resumed task
    keeps the CLI that started it), `guide` (the know-it-all bot)."""
    return _on(prefs(settings), _kind(task, brief, yt, guide))


def run_choice(
    settings,
    task: bool = False,
    provider: str | None = None,
    brief: bool = False,
    yt: bool = False,
    *,
    guide: bool = False,
) -> tuple[str, str, bool]:
    """Model, effort and whether the model was stepped down, for `provider` (default: the CLI of the
    kind's pick): drafts/summaries, Briefing/Digest (`brief`), or tasks/AI Agent (`task`); `yt`: a
    YouTrack run (yt_* light, yt_task_* heavy); `guide`: the know-it-all bot. A Briefing / YouTrack / bot ""
    pick is its base kind's (drafts; YouTrack heavy: tasks): the model on the same CLI, the effort on any.
    Claude only: with fallback on, a window at or past `fallback_at`% runs the cheap model."""
    p = prefs(settings)
    kind = _kind(task, brief, yt, guide)
    base, provider = BASE[kind], provider or _on(p, kind)
    c = p["by"][provider]
    (m, e), (bm, be) = KEYS[kind], KEYS[base]
    model, effort = c[m], c[e]
    if kind != base:
        on = _on(p, base)
        model, effort = model or (c[bm] if provider == on else ""), effort or p["by"][on][be]
    if provider != "claude":  # Antigravity's models carry their level; each Codex model lists its own
        return model, effort if provider == "codex" and effort in _codex_levels(model) else "", False
    effort = effort if effort in EFFORTS else ""  # a Codex-only level ("ultra") picked for the base kind
    cheap = "sonnet" if task else "haiku"
    if (
        p["fallback"]
        and TIERS.get(model, 9) > TIERS[cheap]  # "" (CLI default) or an id: assume costlier
        and max(quota_now(settings).values(), default=0) >= p["fallback_at"]
    ):
        return cheap, effort, True
    return model, effort, False


def fast_choice(provider: str) -> tuple[str, str, bool]:
    """The quickest model / effort of a CLI, for a small run that should not wait on deep reasoning (AI mascot)."""
    if provider == "codex":
        return "", "low" if "low" in _codex_levels("") else "", False
    return {"claude": "haiku", "antigravity": AGY_MODELS[0][0]}.get(provider, ""), "", False


def _options(rows) -> list[dict]:
    return [{"value": "", "label": "Mặc định", "hint": "Model mặc định của CLI"},
            *({"value": v, "label": label, "hint": hint} for v, label, hint in rows)]  # fmt: skip


def _codex_config() -> dict:
    """The user's Codex config.toml; runs here ignore it, but read the proxy and catalog it names."""
    with contextlib.suppress(OSError, tomllib.TOMLDecodeError):
        return tomllib.loads((_codex_home() / "config.toml").read_text())
    return {}


def _codex_proxy(cfg: dict | None = None) -> str:
    """The loopback base URL the user's Codex goes through (opencodex), "" if none: routed "provider/model"
    ids run through it. Never a remote URL: config text is not trusted to redirect a run."""
    url = (_codex_config() if cfg is None else cfg).get("openai_base_url")
    return url if isinstance(url, str) and LOOPBACK.match(url) else ""


def _codex_catalog(cfg: dict) -> Path:
    """The model list Codex reads: the proxy's catalog file (opencodex writes one) or Codex's own cache."""
    got = cfg.get("model_catalog_json")
    p = Path(got).expanduser() if isinstance(got, str) and got else None
    return p if p and p.is_file() and p.is_relative_to(_codex_home()) else _codex_home() / "models_cache.json"


def _codex_models() -> tuple[list[dict], list[str]]:
    """The models Codex lists (shown ones only) with each one's efforts, and every effort any takes.
    Routed ids ("AgentAPI/agentgw-opus-5.5", "combo/gemini": opencodex) only when a local proxy routes them,
    grouped by their provider like the proxy's own model page."""
    cfg = _codex_config()
    data = _read_json(_codex_catalog(cfg)).get("models")
    proxy = bool(_codex_proxy(cfg))
    rows, union = [], set()
    for m in data if isinstance(data, list) else []:
        if not isinstance(m, dict) or m.get("visibility") != "list":
            continue
        slug = m.get("slug")
        if not isinstance(slug, str) or len(slug) > 80 or not MODEL_RE.match(slug) or ("/" in slug and not proxy):
            continue
        levels = m.get("supported_reasoning_levels")
        got = {lv.get("effort") for lv in levels if isinstance(lv, dict)} if isinstance(levels, list) else set()
        efforts = [e for e in CODEX_EFFORTS if e in got]
        union |= set(efforts)
        group, _, name = slug.rpartition("/")
        label = str(m.get("display_name") or slug).rpartition("/")[2] if group else str(m.get("display_name") or slug)
        hint = f"Qua opencodex → {group}" if group else str(m.get("description") or "")
        rows.append(
            {
                "value": slug,
                "label": label or name,
                "hint": hint,
                "group": group,
                "efforts": ["", *efforts] if efforts else [],
            }
        )
    return rows, [e for e in CODEX_EFFORTS if e in union] or ["low", "medium", "high", "xhigh"]


def _codex_levels(model: str) -> list[str]:
    """The efforts a Codex model takes ("" or an unlisted id: any Codex lists)."""
    rows, union = _codex_models()
    return next((r["efforts"] for r in rows if r["value"] == model), union)


def catalog(settings) -> list[dict]:
    """What each CLI offers: models and efforts ("" = its default, listed first; no efforts: the
    CLI takes none), whether it has a quota and model fallback (Claude), and how to install it."""
    codex, codex_efforts = _codex_models()
    rows = {"claude": (_options(CLAUDE_MODELS), EFFORTS), "codex": ([*_options([])[:1], *codex], codex_efforts),
            "antigravity": (_options(AGY_MODELS), ())}  # fmt: skip
    return [
        {
            "id": p,
            "name": NAMES[p],
            "models": rows[p][0],
            "efforts": ["", *rows[p][1]] if rows[p][1] else [],
            "quota": p == "claude",
            "install": INSTALL[p],
        }  # fmt: skip
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


def new_session(settings, provider: str | None = None) -> str:
    """Session id for a new task on `provider` (default: the CLI of the task pick); Codex and
    Antigravity name theirs once it starts."""
    p = provider or chosen(settings, task=True)
    return {"claude": str(uuid.uuid4()), "codex": "codex:", "antigravity": "antigravity:"}[p]


def split_session(session_id: str) -> tuple[str, str]:
    p, sep, rest = session_id.partition(":")
    return (p, rest) if sep and p in OTHERS else ("claude", session_id)


def stdin(p: str, text: str) -> bytes:
    """The prompt as the CLI reads it on stdin: Antigravity takes one NDJSON message per turn."""
    if p == "antigravity":
        return (json.dumps({"event": "user", "message": {"content": text}}, ensure_ascii=False) + "\n").encode()
    return text.encode()


def is_claude(cmd: list[str]) -> bool:
    """Is the AI command the claude CLI (JSON events), not another command that prints its answer?"""
    return bool(cmd) and os.path.basename(cmd[0]) == "claude"


def keeps_session(settings, p: str, tools: bool) -> bool:
    """Whether an `ask_cmd` run can be carried on by a later one (its `session`): Claude's own CLI only."""
    if p != "claude":
        return False
    try:
        return is_claude(shlex.split(settings.ai_agent_project_command if tools else settings.ai_agent_command))
    except ValueError:
        return False


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
            "description",  # Claude's Task tool
            "prompt",
        ):
            if isinstance(inp.get(key), str):
                return inp[key][:160]
    return json.dumps(inp, ensure_ascii=False)[:120]


def _usage(u, cached: str) -> dict:
    """A CLI's token counts in the shape of a Claude result's usage (input without the cached part)."""
    u = u if isinstance(u, dict) else {}
    n = lambda k: u.get(k) if isinstance(u.get(k), int) else 0  # noqa: E731
    return {"input_tokens": max(0, n("input_tokens") - n(cached)), "output_tokens": n("output_tokens"),
            "cache_read_input_tokens": n(cached)}  # fmt: skip


def _claude_items(ev: dict, st: dict) -> list[dict]:
    kind = ev.get("type")
    msg = ev.get("message")  # some events (system/hook notices) carry a plain-string message
    blocks = msg.get("content") if isinstance(msg, dict) else None
    blocks = [b for b in blocks if isinstance(b, dict)] if isinstance(blocks, list) else []
    out: list[dict] = []
    if kind == "stream_event":  # --include-partial-messages: the answer as it is written
        e = ev.get("event") if isinstance(ev.get("event"), dict) else {}
        d = e.get("delta") if isinstance(e.get("delta"), dict) else {}
        if e.get("type") == "message_start":
            out.append({"kind": "reset"})
        elif d.get("type") == "text_delta":
            out.append({"kind": "delta", "text": str(d.get("text") or "")})
    elif kind == "assistant":
        for b in blocks:
            if b.get("type") == "text" and str(b.get("text", "")).strip():
                out.append({"kind": "assistant", "text": b["text"]})
            elif b.get("type") == "tool_use":
                out.append({"kind": "tool", "text": f"{b.get('name', '?')}  {_short(b.get('input'))}"})
    elif kind == "user":
        for b in blocks:
            if b.get("type") == "tool_result":
                c = b.get("content")
                text = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c or [] if isinstance(x, dict))
                out.append({"kind": "tool_result", "text": text.strip()[:400], "error": bool(b.get("is_error"))})
    elif kind == "result" and (ev.get("num_turns") != 0 or ev.get("result") or ev.get("is_error")):
        # a resumed session can open with an empty 0-turn result before the real turn: not an end
        out.append({"kind": "result", "text": str(ev.get("result") or ""), "error": bool(ev.get("is_error")),
                    "final": ev})  # fmt: skip
    return out


def _codex_items(ev: dict, st: dict) -> list[dict]:
    kind = ev.get("type")
    it = ev.get("item") if isinstance(ev.get("item"), dict) else {}
    t = it.get("type") if kind == "item.completed" else None
    if kind == "thread.started":
        return [{"kind": "session", "id": str(ev.get("thread_id") or "")}]
    if t == "agent_message" and str(it.get("text", "")).strip():
        st["text"] = it["text"]
        return [{"kind": "reset"}, {"kind": "delta", "text": it["text"]}, {"kind": "assistant", "text": it["text"]}]
    if t == "command_execution":
        return [{"kind": "tool", "text": f"Shell  {str(it.get('command', ''))[:160]}"},
                {"kind": "tool_result", "text": str(it.get("aggregated_output") or "").strip()[:400],
                 "error": it.get("exit_code") not in (0, None)}]  # fmt: skip
    if t == "file_change":
        paths = ", ".join(str(c.get("path", "")) for c in it.get("changes") or [] if isinstance(c, dict))
        return [{"kind": "tool", "text": f"Edit  {paths[:160]}"}]
    if t in ("mcp_tool_call", "web_search"):
        return [{"kind": "tool", "text": f"{t}  {_short(it)}"}]
    if kind == "turn.completed":
        final = {"usage": _usage(ev.get("usage"), "cached_input_tokens"), "num_turns": 1, "is_error": False}
        return [{"kind": "result", "text": st.get("text", ""), "error": False, "final": final}]
    if kind == "turn.failed" or (kind == "error" and ev.get("message")):
        err = ev.get("error") if isinstance(ev.get("error"), dict) else {}
        text = str(err.get("message") or ev.get("message") or "Codex lỗi")
        if kind == "error":  # also sent while it retries: a note, the turn may still finish
            return [{"kind": "tool_result", "text": text[:400], "error": True}]
        return [{"kind": "result", "text": text, "error": True, "final": {"is_error": True}}]
    return []


def _agy_items(ev: dict, st: dict) -> list[dict]:
    """{"event": kind, kind: {...}}; the answer streams as text deltas of its steps."""
    kind = ev.get("event")
    b = ev.get(kind) if isinstance(ev.get(kind), dict) else {}
    out: list[dict] = []
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
            call = f"{b.get('tool_name', '?')}  {_short(info.get('parameters'))}"
            out += [{"kind": "reset"}, {"kind": "tool", "text": call}]
        if b.get("state") in ("DONE", "ERROR"):
            err = info.get("error") if isinstance(info.get("error"), dict) else {}
            text = str(err.get("message") or info.get("output") or "").strip()[:400]
            out.append({"kind": "tool_result", "text": text, "error": b["state"] == "ERROR"})
    elif kind == "result":
        bad = b.get("status") != "SUCCESS"
        text = str(b.get("error") or "Antigravity lỗi") if bad else str(b.get("response") or st.get("text", ""))
        if not bad and text.strip():
            out.append({"kind": "assistant", "text": text})
        secs, turns = b.get("duration_seconds"), b.get("num_turns")
        final = {"usage": _usage(b.get("usage"), "cache_read_tokens"), "is_error": bad,
                 "num_turns": turns if isinstance(turns, int) else 1,
                 **({"duration_ms": round(secs * 1000)} if isinstance(secs, int | float) else {})}  # fmt: skip
        out.append({"kind": "result", "text": text, "error": bad, "final": final})
    return out


_ITEMS = {"claude": _claude_items, "codex": _codex_items, "antigravity": _agy_items}


def items(p: str, ev: dict, st: dict) -> list[dict]:
    """One JSON event of CLI `p` -> items: assistant / tool / tool_result / result as agent.py logs them,
    plus "session" (the CLI's id), "reset" and "delta" (answer text as it streams). `st` keeps the
    answer so far and the model between events of one run; a result carries `final`, its usage in
    the shape of a Claude result event, for the run log."""
    return _ITEMS[p](ev, st)


def run_model(p: str, seen: str | None, model: str) -> str:
    """The model a run log names: Claude's pick (its result names the real one), else the model the
    CLI reported, else "<cli>/<pick>" ("<cli>" for its default)."""
    if p == "claude":
        return model
    return seen or (f"{p}/{model}" if model else p)


async def events(stream, idle=lambda: None):
    """The JSON objects a CLI prints, one per line; other lines, and any over the stream's limit, are
    skipped. Ends at EOF; raises TimeoutError when no line comes within idle() seconds (None: wait)."""
    while True:
        try:
            raw = await asyncio.wait_for(stream.readline(), idle())
        except ValueError:  # a line over the limit: dropped, the rest of the stream still reads
            continue
        if not raw:
            return
        try:
            ev = json.loads(raw)
        except ValueError:
            continue
        if isinstance(ev, dict):
            yield ev


def _agy_home() -> Path:
    return Path.home() / ".gemini" / "antigravity-cli"


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
