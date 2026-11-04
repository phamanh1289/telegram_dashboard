"""Update this checkout from GitHub: fetch, fast-forward pull, reinstall deps whose lock changed,
rebuild the UI, then restart the server in place (`__main__._serve` re-execs after a clean shutdown)."""

import asyncio
import logging
import shutil
import signal
from pathlib import Path

from fastapi import APIRouter, Request

from .config import _read_json
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.updater")
AUTO_EVERY = 6 * 3600  # seconds between auto-update checks
restart_requested = False  # read by __main__._serve after uvicorn returns
_lock = asyncio.Lock()


async def _run(root: Path, *cmd: str, timeout: float = 600) -> str:
    exe = shutil.which(cmd[0])  # Windows: npm is npm.cmd
    if not exe:
        raise ApiError(503, "update_failed", detail=f"Không tìm thấy {cmd[0]}")
    proc = await asyncio.create_subprocess_exec(
        exe, *cmd[1:], cwd=root, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )  # fmt: skip
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        raise ApiError(504, "update_failed", detail=f"{' '.join(cmd)}: quá thời gian") from None
    text = out.decode(errors="replace").strip()
    if proc.returncode:
        raise ApiError(502, "update_failed", detail=f"{' '.join(cmd)}: {text[-800:]}")
    return text


async def check(root: Path) -> dict:
    """Fetch the upstream branch and say how far behind this checkout is."""
    try:
        upstream = await _run(root, "git", "rev-parse", "--abbrev-ref", "@{u}")
    except ApiError:
        raise ApiError(409, "no_upstream", detail="Thư mục này không phải bản git có nhánh theo dõi trên GitHub.") from None
    await _run(root, "git", "fetch", "--quiet", timeout=60)
    log_ = await _run(root, "git", "log", "--format=%h\x1f%s\x1f%cr", "-n", "30", "HEAD..@{u}")
    commits = [dict(zip(("sha", "subject", "when"), ln.split("\x1f"), strict=False)) for ln in log_.splitlines()]
    return {
        "branch": upstream,
        "current": await _run(root, "git", "rev-parse", "--short", "HEAD"),
        "behind": int(await _run(root, "git", "rev-list", "--count", "HEAD..@{u}")),
        "dirty": bool(await _run(root, "git", "status", "--porcelain", "--untracked-files=no")),
        "commits": commits,
    }


async def apply(root: Path) -> dict:
    """Pull and rebuild; the caller then restarts. Refuses on local edits (pull could clash)."""
    async with _lock:
        info = await check(root)
        if info["dirty"]:
            raise ApiError(409, "local_changes", detail="Có file đã sửa trong thư mục app; cập nhật tay bằng git.")
        if not info["behind"]:
            return {**info, "updated": False}
        before = await _run(root, "git", "rev-parse", "HEAD")
        await _run(root, "git", "pull", "--ff-only", "--quiet", timeout=120)
        changed = (await _run(root, "git", "diff", "--name-only", before, "HEAD")).splitlines()
        if any(f in ("uv.lock", "pyproject.toml") for f in changed):
            await _run(root, "uv", "sync", "--locked")
        if any(f.endswith(("package-lock.json", "package.json")) for f in changed):
            await _run(root, "npm", "ci")
        if any(f.startswith("web/") or f == "package-lock.json" for f in changed):
            await _run(root, "npm", "run", "build")
        return {**info, "updated": True}


def restart() -> None:
    """Graceful uvicorn shutdown (as Ctrl+C), then __main__ re-execs the server."""
    global restart_requested
    restart_requested = True
    asyncio.get_running_loop().call_later(0.5, signal.raise_signal, signal.SIGINT)


def auto_enabled(root: Path) -> bool:
    return bool(_read_json(root / "data" / "config.json").get("auto_update", False))


async def auto_loop(settings, agent) -> None:
    """When on in Settings: check every AUTO_EVERY, update + restart if no AI Agent task is running."""
    await asyncio.sleep(60)
    while True:
        if auto_enabled(settings.root) and not agent.procs:
            try:
                if (await apply(settings.root))["updated"]:
                    log.info("auto-update applied, restarting")
                    restart()
                    return
            except ApiError as e:
                log.warning("auto-update skipped: %s %s", e.code, e.detail)
        await asyncio.sleep(AUTO_EVERY)


def build_router(settings) -> APIRouter:
    r = APIRouter(prefix="/api/update")

    @r.get("")
    async def get_update() -> dict:
        return {**await check(settings.root), "auto": auto_enabled(settings.root)}

    @r.post("")
    async def post_update(request: Request) -> dict:
        if request.app.state.agent.procs:
            raise ApiError(409, "agent_running", detail="Đang có task AI Agent chạy; đợi xong rồi cập nhật.")
        res = await apply(settings.root)
        if res["updated"]:
            restart()
        return res

    @r.put("/auto", status_code=204)
    async def put_auto(body: dict) -> None:
        settings.ensure_data_dir()
        settings.save_config(auto_update=bool(body.get("on")))

    return r
