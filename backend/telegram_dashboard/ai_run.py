"""One AI CLI run to its answer: the process, its streamed output, timeouts, cancel and the run log."""

import asyncio
import contextlib
import contextvars
import logging
import re
import tempfile
import time
from collections.abc import Awaitable, Callable

from . import providers
from .claude import note_run
from .config import child_env, kill_tree
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.ai")

# Set per request: an async "has the browser gone?" check; a gone caller kills its claude run.
client_gone: contextvars.ContextVar[Callable[[], Awaitable[bool]] | None] = contextvars.ContextVar(
    "client_gone", default=None
)
AGENT_TIMEOUT = 180.0
PROJECT_AGENT_TIMEOUT = 600.0  # reading a codebase takes longer
STREAM_LIMIT = 16 * 1024 * 1024  # one stream-json line carries the whole answer
no_retry = contextvars.ContextVar("ai_no_retry", default=False)
flow_metrics = contextvars.ContextVar("flow_metrics", default=None)


async def run(
    settings, cmd, cwd, prompt: bytes, long: bool, on_text, feature, choice, provider, ref="", env=None
) -> str:
    """Run one AI command to its answer. `provider`: whose JSON events it prints (None: plain
    text). `env`: the process's environment (default child_env()). `on_text` set: the answer streams to it.
    The process (and anything it started) never outlives the call: timeout, Hủy, a closed page or an error
    all kill it."""
    t0, final, error, proc = time.monotonic(), None, "ai_failed", None
    try:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd or tempfile.gettempdir(),  # never the repo root: .env and data/ live there
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env or child_env(),
                limit=STREAM_LIMIT,
                start_new_session=True,
            )
        except OSError as e:
            log.warning("AI agent not started: %s", type(e).__name__)
            raise ApiError(502, "ai_provider_error") from None
        read = asyncio.ensure_future(_read(proc, prompt, provider, on_text))
        watch = asyncio.ensure_future(_watch(client_gone.get()))
        try:
            limit = PROJECT_AGENT_TIMEOUT if long else AGENT_TIMEOUT
            done, _ = await asyncio.wait({read, watch}, timeout=limit, return_when=asyncio.FIRST_COMPLETED)
        finally:
            watch.cancel()
            read.cancel()  # a no-op once it is done
        if read not in done:  # the user pressed Hủy / left the page: stop burning quota
            raise ApiError(499, "ai_cancelled") if watch in done else ApiError(504, "ai_timeout")
        text, final, err = read.result()
        if provider:  # every JSON CLI ends in a result: answer, usage, cost
            ok = isinstance(final, dict) and not final.get("is_error")
            text = str(final.get("result") or "").strip() if ok else ""
        if proc.returncode != 0 or not text:
            tail = err.decode(errors="replace").strip()[-300:]
            log.warning("AI agent exit code %s: %s", proc.returncode, tail)
            raise ApiError(502, "ai_provider_error", detail=cli_reason(final, err))
        metrics = flow_metrics.get()
        if metrics is not None and isinstance(final, dict):
            metrics["usage"] = final.get("usage")
        error = None
        return text
    except ApiError as e:
        error = f"{e.code}: {e.detail}" if e.detail else e.code
        raise
    except asyncio.CancelledError:  # the page closed / moved on: not a failure of the AI
        error = "ai_cancelled"
        raise
    except Exception as e:
        error = f"ai_failed: {type(e).__name__}: {e}"[:300]
        raise
    finally:
        if proc is not None:
            kill_tree(proc)  # it, and anything it started
            if proc.returncode is None:
                await proc.wait()
        if provider:
            f = final if isinstance(final, dict) else {}
            picked = (providers.run_model(provider, f.get("model"), choice[0]), *choice[1:])
            note_run(settings, feature, picked, f or None, time.monotonic() - t0, error, ref=ref)


async def _watch(gone) -> None:
    """Returns once the caller has gone (it pressed Hủy or left the page); never without a check."""
    while gone is None or not await gone():
        await asyncio.sleep(1)


async def _read(proc, prompt: bytes, provider: str | None, on_text) -> tuple[str, dict | None, bytes]:
    """`communicate` for an AI CLI: (plain-text answer, result, stderr). A JSON CLI's answer text goes
    to `on_text` as it streams; its result is Claude-shaped ({"result", "is_error", "usage", "model"},
    None when none came) and the plain answer "" ."""
    err = asyncio.ensure_future(proc.stderr.read())
    try:
        # A CLI that quits early (not logged in, bad model) closes stdin: its stderr says why.
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            proc.stdin.write(prompt)
            await proc.stdin.drain()
        proc.stdin.close()
        if provider is None:
            out = await proc.stdout.read()
            await proc.wait()
            return out.decode(errors="replace").strip(), None, await err
        st: dict = {}
        final = None
        async for ev in providers.events(proc.stdout):
            for it in providers.items(provider, ev, st):
                if it["kind"] == "reset" and on_text:
                    on_text(None)
                elif it["kind"] == "delta" and on_text:
                    on_text(it["text"])
                elif it["kind"] in ("tool", "tool_result") and on_text:  # a working step (read a file, run a command)
                    on_text(
                        {k: v for k, v in it.items() if k in ("kind", "text", "error")} | {"at": round(time.time(), 1)}
                    )
                elif it["kind"] == "result":
                    final = {**it["final"], "result": it["text"], "model": st.get("model")}
        await proc.wait()
        return "", final, await err
    finally:
        err.cancel()


# worth one more try: the provider was busy or the connection dropped (not quota, login or a bad prompt)
TRANSIENT = re.compile(
    r"overloaded|\b(?:500|502|503|529)\b|econnreset|socket hang up|connection (?:reset|closed)|"
    r"network error|temporarily unavailable",
    re.I,
)
_REASON = re.compile(r"error|failed|denied|not supported|no longer|quota|unauthori[sz]ed|rate limit", re.I)


def retryable(e: ApiError) -> bool:
    """A provider hiccup (overloaded, dropped connection) worth one more try with the same prompt."""
    return not no_retry.get() and e.code == "ai_provider_error" and bool(TRANSIENT.search(e.detail or ""))


def cli_reason(final, err: bytes) -> str | None:
    """Why a run failed, in the CLI's own words, one line for the user: an error result's text,
    else the last stderr line that names an error (stack frames left out)."""
    text = str(final.get("result") or "").strip() if isinstance(final, dict) and final.get("is_error") else ""
    lines = text.splitlines() or [
        ln.strip() for ln in err.decode(errors="replace").splitlines()
        if _REASON.search(ln) and not ln.strip().startswith("at ")
    ]  # fmt: skip
    if not lines:
        return None
    return re.sub(r"^[^:]*error occurred:\s*", "", lines[-1], flags=re.I)[:300] or None
