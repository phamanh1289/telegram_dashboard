"""Cài đặt › Cập nhật › Gỡ bỏ ứng dụng (packaged install only; a git checkout is the user's own folder): log the
Telegram session out, stop the server, then a detached OS shell deletes the install (data/ included), the data folder
it was moved to, ~/.telegram_dashboard and the app's launchers once this process is gone: a running python.exe cannot
delete itself on Windows. The launcher stops on exit code 0, so nothing starts the deleted app again."""

import asyncio
import logging
import os
import shlex
import signal
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Request

from . import updater
from .config import RUN_DIR
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.uninstall")
LOGOUT_TIMEOUT = 15


def _ours(path: Path, h: Path) -> bool:
    """A launcher the installer wrote for this install (it names the install folder), not one of the user's files."""
    try:
        return str(h) in path.read_text(errors="replace")
    except OSError:
        return False


def targets(settings, h: Path) -> list[Path]:
    """Everything the installer and the app put on this machine, as README › Gỡ cài đặt lists it. `h`: TD_HOME as
    the launcher set it, the spelling install.sh wrote into the launchers (not resolved: ~ may be a symlink)."""
    home = Path.home()
    out = [h, RUN_DIR]
    data = settings.data_dir.resolve()
    if not data.is_relative_to(h.resolve()):  # moved in Cài đặt › Dữ liệu: its data/, not the folder picked
        out.append(data)
    out += sorted((home / ".gemini" / "antigravity-cli" / "agents").glob("telegram-dashboard-*.md"))
    if sys.platform != "win32":
        if _ours(app := h.parent / "Radar.app" / "Contents" / "MacOS" / "launch", h):
            out.append(app.parents[2])
        out += [p for n in ("myradar", "mydashboard") if _ours(p := home / ".local" / "bin" / n, h)]
    return out


def _ps(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def _spawn(h: Path, paths: list[Path]) -> None:
    """Wait for this process to exit, then delete. Windows: the Setup.exe uninstaller first (Apps list, shortcuts)."""
    pid = os.getpid()
    if sys.platform == "win32":
        unins = h / "unins000.exe"  # none: the zip build, nothing registered
        u = _ps(str(unins))
        # the uninstaller runs a copy of itself from %TEMP% and deletes unins000.exe last: wait for that
        run = (f"Start-Process -FilePath {u} -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART';"
               f"for($i=0;$i -lt 120 -and (Test-Path -LiteralPath {u});$i++){{Start-Sleep 1}};"
               if unins.is_file() else "")  # fmt: skip
        rm = "Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue;Start-Sleep 1"
        script = (f"Wait-Process -Id {pid} -ErrorAction SilentlyContinue;Start-Sleep 2;{run}"
                  f"foreach($p in @({','.join(_ps(str(p)) for p in paths)})){{"
                  f"for($i=0;$i -lt 30 -and (Test-Path -LiteralPath $p);$i++){{{rm}}}}}")  # fmt: skip
        cmd = ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script]
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        subprocess.Popen(cmd, cwd=Path.home(), creationflags=flags, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip
        return
    script = (f"while kill -0 {pid} 2>/dev/null; do sleep 0.3; done; sleep 1; "
              f"rm -rf -- {' '.join(shlex.quote(str(p)) for p in paths)}")  # fmt: skip
    subprocess.Popen(["/bin/sh", "-c", script], cwd="/", start_new_session=True, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip


async def _log_out(bridge) -> bool:
    """End this session on Telegram's side (Settings › Devices no longer lists it). False: not signed in / offline."""
    tr = getattr(bridge, "transport", None)
    if tr is None or getattr(bridge, "state", "") != "connected":
        return False
    try:
        return bool(await asyncio.wait_for(tr.log_out(), LOGOUT_TIMEOUT))
    except Exception:  # network, flood wait: the files go anyway, the page says to end the session by hand
        log.warning("Telegram log out failed before uninstall", exc_info=True)
        return False


def build_router(settings) -> APIRouter:
    r = APIRouter(prefix="/api/uninstall")

    @r.post("")
    async def post_uninstall(request: Request, body: dict) -> dict:
        if body.get("confirm") != "uninstall":
            raise ApiError(400, "confirm_required")
        h = updater.home()
        if not h or not (h / "current").is_file() or not (h / "versions").is_dir():
            raise ApiError(409, "not_packaged", detail="Bản chạy từ source: xóa thư mục bằng tay.")
        if h.resolve() in (Path.home().resolve(), Path(h.resolve().anchor)):
            raise ApiError(409, "not_packaged", detail="Thư mục cài không hợp lệ.")
        agent = request.app.state.agent
        if agent.busy:
            raise ApiError(409, "agent_running", detail="Đang có task AI Agent chạy; đợi xong rồi gỡ.")
        paths = targets(settings, h)
        try:  # first: a failed start leaves everything as it was, Telegram session included
            _spawn(h, paths)  # it waits for this process to exit
        except OSError as e:
            raise ApiError(500, "uninstall_failed", detail=f"Không chạy được lệnh gỡ: {e}") from None
        telegram = await _log_out(getattr(request.app.state, "bridge", None))
        log.info("uninstalling: %s", ", ".join(map(str, paths)))
        asyncio.get_running_loop().call_later(0.5, signal.raise_signal, signal.SIGINT)  # exit 0: launcher stops
        return {"telegram": telegram, "paths": [str(p) for p in paths]}

    return r
