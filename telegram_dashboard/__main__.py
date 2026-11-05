import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from .config import Settings


def _login(settings: Settings) -> int:
    if not settings.telegram_configured:
        print("Thiếu TELEGRAM_API_ID/TELEGRAM_API_HASH trong .env", file=sys.stderr)
        return 2
    from telethon import TelegramClient

    settings.ensure_data_dir()

    async def run() -> None:
        client = TelegramClient(
            str(settings.session_path), settings.telegram_api_id, settings.telegram_api_hash
        )
        await client.start()  # interactive: phone, code, 2FA typed in this terminal only
        me = await client.get_me()
        print(f"Đã đăng nhập: {getattr(me, 'first_name', '') or 'OK'}")
        await client.disconnect()

    asyncio.run(run())
    session = Path(str(settings.session_path) + ".session")
    if session.exists():
        session.chmod(0o600)
    return 0


def _no_quickedit() -> None:
    """Windows console: a click starts a QuickEdit selection that pauses the server until Esc."""
    import ctypes

    k = ctypes.windll.kernel32
    h = k.GetStdHandle(-10)  # STD_INPUT_HANDLE
    mode = ctypes.c_uint32()
    if k.GetConsoleMode(h, ctypes.byref(mode)):
        k.SetConsoleMode(h, (mode.value & ~0x0040) | 0x0080)  # -QUICK_EDIT_MODE +EXTENDED_FLAGS


_lock = None  # ~/.telegram_dashboard/server.lock, held while this server runs


def _claim(settings: Settings) -> Settings | None:
    """One server per machine (installed build and dev checkout alike): if one already runs,
    open it and return None. Else take PORT, or the next free one when another app holds it."""
    import dataclasses
    import socket
    import time
    import webbrowser

    global _lock
    settings.ensure_data_dir()
    run_dir = Path.home() / ".telegram_dashboard"  # outside every install's data/
    run_dir.mkdir(mode=0o700, exist_ok=True)
    port_file = run_dir / "server.port"
    _lock = open(run_dir / "server.lock", "a")  # noqa: SIM115 (held until exit)
    for _ in range(25):  # a restarting server may still be exiting
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(_lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError:
            time.sleep(0.2)
    else:
        port = port_file.read_text().strip() if port_file.is_file() else str(settings.port)
        url = f"http://{settings.host}:{port}"
        print(f"Dashboard đã chạy ở {url} — mở trình duyệt tới đó.", flush=True)
        webbrowser.open(url)
        return None
    if not os.environ.get("APP_ORIGIN"):  # dev sets it: Next proxies /api to the fixed port
        for port in range(settings.port, settings.port + 20):
            with socket.socket() as s:
                if sys.platform != "win32":  # as uvicorn: TIME_WAIT from a restart is not "in use"
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    s.bind((settings.host, port))
                except OSError:
                    continue
            if port != settings.port:
                print(f"Port {settings.port} đang bận, dùng {port}.", flush=True)
                settings = dataclasses.replace(
                    settings, port=port, app_origin=f"http://{settings.host}:{port}"
                )
            break
    port_file.write_text(str(settings.port))
    return settings


def _serve(settings: Settings) -> int:
    import uvicorn

    from .app import create_app

    claimed = _claim(settings)
    if claimed is None:
        return 0
    settings = claimed
    if os.environ.get("TD_OPEN"):  # packaged launcher, first start: open the page once it serves
        import threading
        import webbrowser

        threading.Timer(2, webbrowser.open, [settings.app_origin]).start()
    if not settings.static_dir.is_dir():
        print("Chưa có web/out — chạy `npm run build` (UI sẽ trả 503).", file=sys.stderr)
    print(f"Mở {settings.app_origin}", flush=True)
    from . import updater

    updater.prune_versions()
    if sys.platform == "win32":
        _no_quickedit()
    app = create_app(settings)
    # SSE streams never finish on their own; bound the graceful wait so Ctrl+C cannot hang.
    uvicorn.run(
        app, host=settings.host, port=settings.port, workers=1, access_log=False,
        timeout_graceful_shutdown=3,
    )  # fmt: skip
    if updater.restart_requested and updater.home():  # packaged: launcher starts versions/<current>
        return updater.RESTART_CODE
    if updater.restart_requested:  # Settings → Cập nhật pulled new code: start it in place (same PID)
        argv = [sys.executable, "-m", "telegram_dashboard", "serve"]
        if sys.platform == "win32":  # execv doesn't quote paths with spaces on Windows
            import subprocess

            subprocess.Popen(argv)
            return 0
        os.execv(sys.executable, argv)
    return 0


def _export_openapi(settings: Settings, output: str) -> int:
    from .app import create_app

    app = create_app(settings)  # no lifespan => no Telegram/DB access
    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="telegram_dashboard")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    sub.add_parser("serve")
    ex = sub.add_parser("export-openapi")
    ex.add_argument("--output", default="work/openapi.json")
    sub.add_parser("import-claude-runs", help="backfill the Claude run log from the CLI's transcripts")
    args = p.parse_args(argv)
    settings = Settings.from_env()
    if args.cmd == "import-claude-runs":
        from .claude import import_transcripts

        print(f"Đã nhập {import_transcripts(settings)} lần chạy.")
        return 0
    if args.cmd == "login":
        return _login(settings)
    if args.cmd == "serve":
        return _serve(settings)
    return _export_openapi(settings, args.output)


if __name__ == "__main__":
    sys.exit(main())
