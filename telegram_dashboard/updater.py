"""Two update sources, same API/UI:
- git checkout: fetch, fast-forward pull, reinstall deps whose lock changed, rebuild the UI, then
  restart in place (`__main__._serve` re-execs after a clean shutdown).
- packaged install (launcher sets TD_HOME): download the newest GitHub Release zip for this platform
  into versions/<ver>, point `current` at it, exit RESTART_CODE; the launcher starts the new version.
  Nothing in use is overwritten (Windows locks running files), data/ is outside versions/."""

import asyncio
import hashlib
import logging
import os
import platform
import re
import shutil
import signal
import sys
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Request

from .config import _read_json, run_cli
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.updater")
CHECK_EVERY = 3600  # seconds between background checks (badge; auto-update when on)
restart_requested = False  # read by __main__._serve after uvicorn returns
behind = 0  # last background/manual check, for the badge on the Settings button
_lock = asyncio.Lock()
REPO = "phamanh1289/telegram_dashboard"
RESTART_CODE = 75  # launcher loop: start versions/<current> again


def home() -> Path | None:
    h = os.environ.get("TD_HOME")
    return Path(h) if h else None


def platform_tag() -> str:
    if sys.platform == "win32":
        return "windows-x64"
    return "macos-arm64" if platform.machine() == "arm64" else "macos-x64"


def _ver(tag: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", tag)[:3])


def version(root: Path) -> str:
    f = root / "VERSION"
    return f.read_text().strip() if f.is_file() else ""


async def _releases() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
            r = await c.get(f"https://api.github.com/repos/{REPO}/releases?per_page=30",
                            headers={"Accept": "application/vnd.github+json"})  # fmt: skip
            r.raise_for_status()
    except httpx.HTTPError as e:
        raise ApiError(502, "update_failed", detail=f"Không đọc được GitHub Releases: {e}") from None
    return [x for x in r.json() if not x.get("draft") and not x.get("prerelease")]


async def _check_release(root: Path) -> dict:
    global behind
    current = version(root)
    newer = sorted((x for x in await _releases() if _ver(x["tag_name"]) > _ver(current)),
                   key=lambda x: _ver(x["tag_name"]), reverse=True)  # fmt: skip
    behind = len(newer)
    return {
        "branch": "GitHub Releases",
        "current": f"v{current}",
        "behind": behind,
        "dirty": False,
        "commits": [{"sha": x["tag_name"], "subject": x.get("name") or x["tag_name"],
                     "when": (x.get("published_at") or "")[:10]} for x in newer],  # fmt: skip
        "newer": newer,  # popped before replying
    }


def _extract(zip_path: Path, name: str, dest: Path) -> None:
    """Unpack `<top>/versions/<name>/…` of a release zip into dest (exec bits kept), atomically."""
    marker = f"versions/{name}/"
    part = dest.with_name(f".{name}.part")
    shutil.rmtree(part, ignore_errors=True)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            _, sep, rel = info.filename.partition(marker)
            if not sep or not rel or info.is_dir():
                continue
            out = part / rel  # ".." or a Windows root-relative name must not land outside `part`
            if ".." in Path(rel).parts or not out.resolve().is_relative_to(part.resolve()):
                raise ApiError(502, "update_failed", detail=f"Đường dẫn lạ trong gói: {info.filename}")
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(out, "wb") as f:
                shutil.copyfileobj(src, f, 1 << 20)
            if mode := (info.external_attr >> 16) & 0o777:
                out.chmod(mode)
    if not (part / "app" / "VERSION").is_file():
        shutil.rmtree(part, ignore_errors=True)
        raise ApiError(502, "update_failed", detail="Gói tải về không có bản cho máy này.")
    shutil.rmtree(dest, ignore_errors=True)
    part.rename(dest)


async def _apply_release(root: Path, h: Path) -> dict:
    info = await _check_release(root)
    newer = info.pop("newer")
    if not newer:
        return {**info, "updated": False}
    want = f"-{platform_tag()}.zip"
    # newest release that has a package for this machine (one may lack it: failed upload)
    latest, asset = next(
        ((r, a) for r in newer for a in r.get("assets", []) if a["name"].endswith(want)), (newer[0], None)
    )
    if not asset:
        raise ApiError(409, "update_failed", detail=f"Bản {latest['tag_name']} chưa có gói {platform_tag()}.")
    name = latest["tag_name"].removeprefix("v")
    versions = h / "versions"
    versions.mkdir(exist_ok=True)
    tmp = versions / f".{name}.zip"
    sha = hashlib.sha256()
    try:
        async with (
            httpx.AsyncClient(timeout=httpx.Timeout(60, read=120), follow_redirects=True) as c,
            c.stream("GET", asset["browser_download_url"]) as r,
        ):
            r.raise_for_status()
            with open(tmp, "wb") as f:
                async for chunk in r.aiter_bytes(1 << 20):
                    sha.update(chunk)
                    f.write(chunk)
    except httpx.HTTPError as e:
        tmp.unlink(missing_ok=True)
        raise ApiError(502, "update_failed", detail=f"Tải gói lỗi: {e}") from None
    digest = asset.get("digest") or ""  # GitHub: "sha256:<hex>"; none = unverifiable, not installed
    if not digest.startswith("sha256:") or digest[7:] != sha.hexdigest():
        tmp.unlink(missing_ok=True)
        raise ApiError(502, "update_failed", detail="Gói tải về sai checksum.")
    try:
        await asyncio.to_thread(_extract, tmp, name, versions / name)
    finally:
        tmp.unlink(missing_ok=True)
    (h / "current").write_text(name)
    return {**info, "updated": True}


def prune_versions() -> None:
    """At startup of a packaged install: drop versions other than `current` (and leftovers)."""
    h = home()
    if not h or not (h / "current").is_file():
        return
    keep = (h / "current").read_text().strip()
    for p in (h / "versions").iterdir():
        if p.name != keep:
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)


async def _run(root: Path, *cmd: str, timeout: float = 600) -> str:
    exe = shutil.which(cmd[0])  # Windows: npm is npm.cmd
    if not exe:
        raise ApiError(503, "update_failed", detail=f"Không tìm thấy {cmd[0]}")
    got = await run_cli([exe, *cmd[1:]], timeout=timeout, cwd=root, merge=True)
    if got is None:  # timed out (killed and reaped), or did not start
        raise ApiError(504, "update_failed", detail=f"{' '.join(cmd)}: quá thời gian / không chạy được")
    text = got[1].decode(errors="replace").strip()
    if got[0]:
        raise ApiError(502, "update_failed", detail=f"{' '.join(cmd)}: {text[-800:]}")
    return text


async def check(root: Path) -> dict:
    """Fetch the upstream branch (or the release list) and say how far behind this install is."""
    global behind
    if home():
        info = await _check_release(root)
        info.pop("newer")
        return info
    try:
        upstream = await _run(root, "git", "rev-parse", "--abbrev-ref", "@{u}")
    except ApiError:
        detail = "Thư mục này không phải bản git có nhánh theo dõi trên GitHub."
        raise ApiError(409, "no_upstream", detail=detail) from None
    await _run(root, "git", "fetch", "--quiet", timeout=60)
    log_ = await _run(root, "git", "log", "--format=%h\x1f%s\x1f%cr", "-n", "30", "HEAD..@{u}")
    commits = [dict(zip(("sha", "subject", "when"), ln.split("\x1f"), strict=False)) for ln in log_.splitlines()]
    behind = int(await _run(root, "git", "rev-list", "--count", "HEAD..@{u}"))
    return {
        "branch": upstream,
        "current": await _run(root, "git", "rev-parse", "--short", "HEAD"),
        "behind": behind,
        "dirty": bool(await _run(root, "git", "status", "--porcelain", "--untracked-files=no")),
        "commits": commits,
    }


async def apply(root: Path) -> dict:
    """Pull and rebuild; the caller then restarts. Refuses on local edits (pull could clash)."""
    async with _lock:
        if h := home():
            return await _apply_release(root, h)
        info = await check(root)
        if info["dirty"]:
            raise ApiError(409, "local_changes", detail="Có file đã sửa trong thư mục app; cập nhật tay bằng git.")
        if not info["behind"]:
            return {**info, "updated": False}
        before = await _run(root, "git", "rev-parse", "HEAD")
        await _run(root, "git", "pull", "--ff-only", "--quiet", timeout=120)
        try:
            changed = (await _run(root, "git", "diff", "--name-only", before, "HEAD")).splitlines()
            if any(f in ("uv.lock", "pyproject.toml") for f in changed):
                await _run(root, "uv", "sync", "--locked")
            if any(f.endswith(("package-lock.json", "package.json")) for f in changed):
                await _run(root, "npm", "ci")
            if any(f.startswith("web/") or f == "package-lock.json" for f in changed):
                await _run(root, "npm", "run", "build")
        except ApiError as e:  # the code is new, its deps / UI are not: say what to rerun
            detail = f"Đã pull code mới nhưng chưa xong, cần chạy lại: {e.detail}"
            raise ApiError(e.status, e.code, detail=detail) from None
        return {**info, "updated": True}


def restart() -> None:
    """Graceful uvicorn shutdown (as Ctrl+C), then __main__ re-execs the server."""
    global restart_requested
    restart_requested = True
    asyncio.get_running_loop().call_later(0.5, signal.raise_signal, signal.SIGINT)


def auto_enabled(settings) -> bool:
    return bool(_read_json(settings.config_path).get("auto_update", False))


async def auto_loop(settings, agent) -> None:
    """Check every CHECK_EVERY (feeds the badge). When auto-update is on in Settings and no AI Agent
    task is running: pull, rebuild, restart; open pages reload when /api/update/state's version changes."""
    await asyncio.sleep(60)
    while True:
        try:
            await check(settings.root)
            if (behind and auto_enabled(settings) and not agent.procs
                    and (await apply(settings.root))["updated"]):
                log.info("auto-update applied, restarting")
                restart()
                return
        except ApiError as e:
            log.warning("update check skipped: %s %s", e.code, e.detail)
        except Exception:  # a bad zip, a full disk, GitHub's HTML error page: try again next time
            log.warning("update check failed", exc_info=True)
        await asyncio.sleep(CHECK_EVERY)


def build_router(settings) -> APIRouter:
    r = APIRouter(prefix="/api/update")

    @r.get("")
    async def get_update() -> dict:
        return {**await check(settings.root), "auto": auto_enabled(settings)}

    @r.get("/state")
    async def get_state() -> dict:
        """Cheap (no network): the running version and the last known count of new commits."""
        ver = version(settings.root)
        if not ver:
            try:
                ver = await _run(settings.root, "git", "rev-parse", "--short", "HEAD")
            except ApiError:
                ver = ""
        return {"version": ver, "behind": behind}

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
