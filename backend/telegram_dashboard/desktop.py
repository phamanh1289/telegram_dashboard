"""Native dialogs on this machine (macOS osascript, Windows PowerShell): the project folder picker, Terminal."""

import logging
import sys

from .config import run_cli
from .errors import ApiError

log = logging.getLogger("telegram_dashboard.ai")


def applescript_str(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


async def osascript(script: str, timeout: float = 15) -> tuple[int, str]:
    """(exit code, stdout, or stderr when it failed); -1 when osascript did not run."""
    got = await run_cli(["osascript", "-e", script], timeout=timeout)
    if got is None:
        return -1, ""
    code, out, err = got
    return code, (err if code else out).decode(errors="replace").strip()


# osascript shows the dialog itself (no Finder automation permission); `activate` brings it front.
PICK_FOLDER_SCRIPT = """activate
POSIX path of (choose folder with prompt "Chọn thư mục dự án cho Radar")"""


# Windows: WinForms dialog owned by a TopMost form so it opens above the browser.
PICK_FOLDER_PS = """[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Chọn thư mục dự án cho Radar'
if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }"""


async def _pick_folder_windows() -> str | None:
    got = await run_cli(["powershell", "-NoProfile", "-STA", "-Command", PICK_FOLDER_PS], timeout=600)
    if got is None:
        raise ApiError(502, "picker_failed")
    code, out, err = got
    if code:
        raise ApiError(502, "picker_failed", detail=err.decode(errors="replace")[-200:] or None)
    return out.decode("utf-8", errors="replace").strip() or None  # empty = cancelled


async def pick_folder() -> str | None:
    """Native folder dialog on this machine (macOS / Windows); None when the user cancels."""
    if sys.platform == "win32":
        return await _pick_folder_windows()
    code, out = await osascript(PICK_FOLDER_SCRIPT, 600)
    if code == 0:
        return out or None
    if "(-128)" in out:  # "User canceled."
        return None
    log.warning("folder picker failed: %s", out[-200:])
    raise ApiError(502, "picker_failed", detail=out[-200:] or None)
