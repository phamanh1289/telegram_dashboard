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


def _serve(settings: Settings) -> int:
    import uvicorn

    from .app import create_app

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
