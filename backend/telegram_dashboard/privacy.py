"""Privacy switches in Settings: scrub phone numbers / e-mails from what goes to the AI (ai.REDACT), and show a
tag's text in its macOS banner (telegram.NOTIFY_PREVIEW). Kept in data/config.json; both default off.
ponytail: module-level switches, one app per process; move onto app.state if a process ever serves two."""

from fastapi import APIRouter
from pydantic import BaseModel

from . import ai
from .config import _read_json
from .telegram import bridge as telegram


class Privacy(BaseModel):
    redact: bool = False  # "Ẩn SĐT / email khi gửi AI"
    notify_preview: bool = False  # "Hiện nội dung tin trong thông báo"


def load(settings) -> Privacy:
    c = _read_json(settings.config_path)
    return Privacy(redact=c.get("ai_redact") is True, notify_preview=c.get("notify_preview") is True)


def _apply(p: Privacy) -> None:
    ai.REDACT, telegram.NOTIFY_PREVIEW = p.redact, p.notify_preview


def build_router(settings) -> APIRouter:
    _apply(load(settings))
    r = APIRouter(prefix="/api/privacy")

    @r.get("")
    async def get_privacy() -> Privacy:
        return load(settings)

    @r.put("")
    async def put_privacy(body: Privacy) -> Privacy:
        settings.ensure_data_dir()
        settings.save_config(ai_redact=body.redact, notify_preview=body.notify_preview)
        _apply(body)
        return body

    return r
