"""Build the end-user package for THIS OS: standalone Python + deps + app + prebuilt UI, zipped.

    uv run --no-project --python 3.14 scripts/package.py v1.2.3      (after `npm run build`)

Output: dist/TelegramDashboard-<ver>-<platform>.zip whose top folder "Telegram Dashboard/" holds
the launcher, `current` (active version), and versions/<ver>/{python,app}. data/ is created at first
run next to them, so in-app updates (new versions/<ver>, then `current`) never touch user data.
Windows: CI also wraps dist/stage/ into a Setup.exe (packaging/windows/setup.iss).
"""

import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
TOP = "Telegram Dashboard"


def plat() -> str:
    if sys.platform == "win32":
        return "windows-x64"
    if sys.platform == "darwin":
        return "macos-arm64" if platform.machine() == "arm64" else "macos-x64"
    sys.exit("Chỉ đóng gói cho macOS / Windows")


def run(*cmd: str) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=ROOT)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    ver = sys.argv[1].removeprefix("v")
    if not (ROOT / "web/out/index.html").is_file():
        sys.exit("Thiếu web/out — chạy `npm run build` trước.")
    shutil.rmtree(DIST, ignore_errors=True)
    stage = DIST / "stage" / TOP
    vdir = stage / "versions" / ver

    # Standalone CPython (python-build-standalone via uv): relocatable, no system Python needed.
    pydl = DIST / "python-dl"
    run("uv", "python", "install", "3.14", "--install-dir", str(pydl), "--no-bin")
    src = next(p for p in pydl.glob("cpython-3.14*") if p.is_dir())
    shutil.copytree(src, vdir / "python", symlinks=False)
    shutil.rmtree(vdir / "python/lib/python3.14/test", ignore_errors=True)
    py = vdir / ("python/python.exe" if sys.platform == "win32" else "python/bin/python3")

    req = DIST / "requirements.txt"
    run("uv", "export", "--frozen", "--no-dev", "--no-emit-project", "-o", str(req))
    run("uv", "pip", "install", "--python", str(py), "--break-system-packages", "--no-cache", "-r", str(req))

    app = vdir / "app"
    shutil.copytree(ROOT / "telegram_dashboard", app / "telegram_dashboard",
                    ignore=shutil.ignore_patterns("__pycache__"))  # fmt: skip
    shutil.copytree(ROOT / "web/out", app / "web/out")
    (app / "VERSION").write_text(ver)
    (stage / "current").write_text(ver)
    launcher = "Start Dashboard Telegram.bat" if sys.platform == "win32" else "Start Dashboard Telegram.command"
    sub = "windows" if sys.platform == "win32" else "macos"
    shutil.copy2(ROOT / "packaging" / sub / launcher, stage / launcher)
    if sub == "macos":  # install.sh puts it in Telegram Dashboard.app
        shutil.copy2(ROOT / "packaging/macos/AppIcon.icns", stage / "AppIcon.icns")

    out = DIST / f"TelegramDashboard-{ver}-{plat()}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dirpath, _, files in os.walk(stage):
            for f in files:
                p = Path(dirpath) / f
                # from_file keeps the unix mode (exec bits) in external_attr; symlinks were resolved.
                z.write(p, p.relative_to(stage.parent))
    print(f"OK {out} ({out.stat().st_size >> 20} MB)")


if __name__ == "__main__":
    main()
