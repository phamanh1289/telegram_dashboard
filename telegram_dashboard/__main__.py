import argparse
import asyncio
import json
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


def _serve(settings: Settings) -> int:
    import uvicorn

    from .app import create_app
    from .auth import LocalAuth

    if not settings.static_dir.is_dir():
        print("Chưa có web/out — chạy `npm run build` (UI sẽ trả 503).", file=sys.stderr)
    auth = LocalAuth()
    print(f"Mã mở khóa: {auth.code}", flush=True)
    print(f"Mở {settings.app_origin}", flush=True)
    app = create_app(settings, auth=auth)
    # SSE streams never finish on their own; bound the graceful wait so Ctrl+C cannot hang.
    uvicorn.run(
        app, host=settings.host, port=settings.port, workers=1, access_log=False,
        timeout_graceful_shutdown=3,
    )  # fmt: skip
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
    args = p.parse_args(argv)
    settings = Settings.from_env()
    if args.cmd == "login":
        return _login(settings)
    if args.cmd == "serve":
        return _serve(settings)
    return _export_openapi(settings, args.output)


if __name__ == "__main__":
    sys.exit(main())
