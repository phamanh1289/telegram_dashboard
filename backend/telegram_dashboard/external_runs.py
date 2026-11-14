"""AI runs made outside this app (Claude Code CLI / Desktop, Codex CLI / Desktop), read back from the CLIs' own
transcripts for the AI page's History and Usage: one row per prompt the user sent, its API calls summed.
Only usage metadata is read (time, model, tokens, folder), never the prompt or the answer."""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

# The dashboard's own CLI runs are logged live (claude.note_run): skip their transcripts so nothing counts twice.
OWN_CLAUDE = ("sdk-",)  # `claude -p` (entrypoint sdk-cli / sdk-ts / sdk-py)
OWN_CODEX = {"codex_exec"}  # `codex exec`
CODEX_LINES = ('"session_meta"', '"turn_context"', '"task_started"', '"token_count"', '"task_complete"')
CLAUDE_SOURCES = {"claude-desktop": "Claude Desktop", "cli": "Claude CLI", "claude-vscode": "Claude VS Code"}

# path -> ((mtime, size), rows): a transcript is parsed again only when it changed.
# ponytail: in-memory only, so the first History load after a restart reads every recent transcript (~seconds per GB).
_cache: dict[Path, tuple[tuple[float, int], list[dict]]] = {}


def run_provider(model: str) -> str:
    """The CLI behind a logged model id ("codex/gpt-…", "antigravity/gemini-…", "gemini"; anything else is Claude's)."""
    if model.startswith("codex"):
        return "codex"
    return "antigravity" if model.startswith(("antigravity", "gemini")) else "claude"


def _project(cwd) -> str:
    """The folder a session ran in, by name; none for a temp folder (a chat outside any project)."""
    p = os.path.realpath(str(cwd or ""))
    temp = (os.path.realpath(tempfile.gettempdir()), "/private/var/folders", "/private/tmp")
    return "" if not cwd or p.startswith(temp) else Path(p).name


def _iso(ts) -> str | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(UTC).isoformat(timespec="milliseconds")
    except ValueError:
        return None


def _ms(a: str, b: str) -> int:
    return max(0, round((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() * 1000))


def _row(feature: str, project: str, t: dict) -> dict:
    return {
        "provider": "codex" if feature.startswith("Codex") else "claude",
        "at": t["at"], "feature": feature, "project": project, "model": t["model"] or "mặc định", "effort": t["effort"],
        "ok": True, "ms": _ms(t["at"], t["end"]), "input_tokens": t["in"], "output_tokens": t["out"],
        "cache_read": t["cr"], "cache_write": t["cw"], "turns": t["calls"], "external": True,
    }  # fmt: skip


def _turn(at: str) -> dict:
    return {"at": at, "end": at, "model": "", "effort": "", "in": 0, "out": 0, "cr": 0, "cw": 0, "calls": 0}


def _int(d: dict, k: str) -> int:
    v = d.get(k)
    return v if isinstance(v, int) else 0


def _is_result(x) -> bool:
    return isinstance(x, dict) and x.get("type") == "tool_result"


def parse_claude(path: Path) -> list[dict]:
    """A Claude Code transcript: a turn starts at each prompt the user typed (not tool results, not meta lines)."""
    turns: list[dict] = []
    seen: set[str] = set()  # one API response spans several lines (one per content block), same usage on each
    feature, project, cur = "Claude Code", "", None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if '"type":"user"' not in line and '"type":"assistant"' not in line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if not isinstance(r, dict):
                continue
            entry = str(r.get("entrypoint") or "")
            if entry.startswith(OWN_CLAUDE):
                return []
            feature = CLAUDE_SOURCES.get(entry, feature)
            project = project or _project(r.get("cwd"))  # where the session started
            msg = r.get("message") if isinstance(r.get("message"), dict) else {}
            at = _iso(r.get("timestamp"))
            if not at:
                continue
            if r.get("type") == "user":
                c = msg.get("content")
                tools = isinstance(c, list) and c and all(_is_result(x) for x in c)
                if not (r.get("isMeta") or r.get("isCompactSummary") or tools):
                    cur = _turn(at)
                    turns.append(cur)
                continue
            u = msg.get("usage")
            mid = str(msg.get("id") or r.get("requestId") or r.get("uuid"))
            if cur is None or not isinstance(u, dict) or msg.get("model") == "<synthetic>" or mid in seen:
                continue
            seen.add(mid)
            cur.update(end=at, model=msg.get("model") or cur["model"], effort=str(r.get("effort") or cur["effort"]))
            cur["in"] += _int(u, "input_tokens")
            cur["out"] += _int(u, "output_tokens")
            cur["cr"] += _int(u, "cache_read_input_tokens")
            cur["cw"] += _int(u, "cache_creation_input_tokens")
            cur["calls"] += 1
    return [_row(feature, project, t) for t in turns if t["calls"]]


def parse_codex(path: Path) -> list[dict]:
    """A Codex rollout: a turn runs from task_started to task_complete; each token_count is one API call."""
    turns: list[dict] = []
    feature, project, model, effort, cur = "Codex", "", "", "", None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not any(k in line for k in CODEX_LINES):
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            p = r.get("payload") if isinstance(r, dict) and isinstance(r.get("payload"), dict) else {}
            at = _iso(r.get("timestamp"))
            kind = r.get("type") if r.get("type") != "event_msg" else p.get("type")
            if kind == "session_meta":
                origin = str(p.get("originator") or "")
                if origin in OWN_CODEX:
                    return []
                feature = "Codex Desktop" if "desktop" in origin.lower() else "Codex CLI"
                project = _project(p.get("cwd"))
                bi = p.get("base_instructions") if isinstance(p.get("base_instructions"), dict) else {}
                prov = bi.get("provenance") if isinstance(bi.get("provenance"), dict) else {}
                model = str(p.get("model") or prov.get("model") or model)  # rollouts with no turn_context name it here
            elif kind == "turn_context":
                model, effort = str(p.get("model") or model), str(p.get("effort") or effort)
            elif kind == "task_started" and at:
                cur = _turn(at)
                turns.append(cur)
            elif cur is not None and at and kind in ("token_count", "task_complete"):
                cur.update(end=at, model=model, effort=effort)
                info = p.get("info") if isinstance(p.get("info"), dict) else {}
                u = info.get("last_token_usage")
                if kind == "token_count" and isinstance(u, dict) and _int(u, "total_tokens"):  # 0: a warm-up, no call
                    cached = _int(u, "cached_input_tokens")
                    cur["in"] += max(0, _int(u, "input_tokens") - cached)  # Codex counts cached input inside input
                    cur["cr"] += cached
                    cur["cw"] += _int(u, "cache_write_input_tokens")
                    cur["out"] += _int(u, "output_tokens")
                    if not (_int(u, "input_tokens") or _int(u, "output_tokens")):  # some sessions give only the total
                        cur["in"] += _int(u, "total_tokens")
                    cur["calls"] += 1
    # Codex Desktop replays a thread's context size when it reopens it: a "turn" done within a second made no real call.
    return [_row(feature, project, t) for t in turns if t["calls"] and _ms(t["at"], t["end"]) >= 1000]


def _homes() -> list[tuple[Path, str, object]]:
    claude = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    codex = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions"
    return [(claude, "*.jsonl", parse_claude), (codex, "rollout-*.jsonl", parse_codex)]


def external_runs(days: int) -> list[dict]:
    """Every outside run started in the last `days` days (unsorted); a transcript that cannot be read is skipped."""
    since_ts = time.time() - days * 86_400
    since = datetime.fromtimestamp(since_ts, UTC).isoformat(timespec="seconds")
    rows: list[dict] = []
    for root, pattern, parse in _homes():
        if not root.is_dir():
            continue
        for path in root.rglob(pattern):  # Claude: subagents' transcripts sit in <session>/subagents/
            with contextlib.suppress(OSError):
                st = path.stat()
                if st.st_mtime < since_ts:  # last written before the period: nothing in it
                    continue
                key = (st.st_mtime, st.st_size)
                hit = _cache.get(path)
                if not hit or hit[0] != key:
                    hit = _cache[path] = (key, parse(path))
                rows += [r for r in hit[1] if r["at"] >= since]
    return rows
