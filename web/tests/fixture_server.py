"""Standalone e2e backend: real app + fake Telegram on :8765, test control API on :8799.

Never part of the live app. Data lives in a temp dir; nothing touches Telegram or a real AI.
"""

import asyncio
import json
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT))

from conftest import FakeTransport, msg  # noqa: E402

from telegram_dashboard.app import create_app  # noqa: E402
from telegram_dashboard.config import Settings  # noqa: E402
from telegram_dashboard.models import GroupInfo, SentMessage  # noqa: E402
from telegram_dashboard.telegram import SendRejected  # noqa: E402

A, B = "-1001", "-1002"
CONTROL = "http://127.0.0.1:8799"

tmp = Path(tempfile.mkdtemp(prefix="td-e2e-"))
(tmp / "web").mkdir()
(tmp / "web" / "out").symlink_to(ROOT / "web" / "out")
settings = Settings(root=tmp, ai_base_url=f"{CONTROL}/v1", ai_model="fake", ai_api_key="fake-key")

fake = FakeTransport(
    groups=[
        GroupInfo(chat_id=A, title="Nhóm Dự án", kind="supergroup"),
        GroupInfo(chat_id=B, title="Nhóm Bạn bè", kind="supergroup"),
    ]
)
fake.history[A] = [msg(A, i, f"Tin A số {i}", sender="7") for i in range(1, 121)]
XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'
fake.history[A][-1] = msg(A, 120, XSS)
fake.history[B] = [msg(B, i, f"Tin B số {i}", sender="8") for i in range(1, 6)]

control = {"send": "ok", "sent": 0, "slow_chat": None, "slow_ms": 0, "fail_changes": 0}


async def send_impl(call):
    mode = control["send"]
    if mode == "slow":
        await asyncio.sleep(1.5)
    if mode == "flood":
        raise SendRejected("retry_after", 30)
    if mode == "unknown":
        raise TimeoutError
    control["sent"] += 1
    mid = 10_000 + control["sent"]
    m = msg(call["chat_id"], mid, call["text"], outgoing=True)
    return SentMessage(message_id=mid, message=m)


fake.send_impl = send_impl
app = create_app(settings, transport=fake)


class Faults:
    """Slow message pages / failing change drains, only in this fixture."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope["path"]
            if control["slow_chat"] and path == f"/api/chats/{control['slow_chat']}/messages":
                await asyncio.sleep(control["slow_ms"] / 1000)
            if path == "/api/changes" and control["fail_changes"] > 0:
                control["fail_changes"] -= 1
                await send({"type": "http.response.start", "status": 500, "headers": []})
                await send({"type": "http.response.body", "body": b""})
                return
        await self.inner(scope, receive, send)


ctl = FastAPI()


@ctl.post("/set")
async def set_(request: Request):
    control.update(await request.json())
    return control


@ctl.get("/state")
async def state():
    return {**control, "send_calls": len(fake.send_calls)}


@ctl.post("/message")
async def message(request: Request):
    b = await request.json()
    m = msg(b["chat"], b["id"], b["text"], edit=b.get("edit"), sender=b.get("sender", "7"))
    await app.state.bridge.on_message(m)
    return {"ok": True}


@ctl.post("/delete")
async def delete(request: Request):
    b = await request.json()
    await app.state.bridge.on_deleted(b["chat"], [b["id"]])
    return {"ok": True}


@ctl.post("/v1/chat/completions")
async def completions(request: Request):
    body = await request.json()
    control["ai_calls"] = control.get("ai_calls", 0) + 1
    control["ai_last"] = json.dumps(body)[:2000]
    return {"choices": [{"message": {"content": "Bản nháp AI: cảm ơn mọi người!"}}]}


async def main():
    async def seed():
        while not hasattr(app.state, "store") or app.state.bridge.state != "connected":
            await asyncio.sleep(0.05)
        s = app.state.store
        for chat in (A, B):
            s.upsert_chat_info(chat, "x", "supergroup")
        await app.state.db.write(s.set_tracking, A, True)
        await app.state.db.write(s.set_tracking, B, True)
        # Seed 120 messages for A (more than the 50-message initial limit, to test paging).
        gen = s.history_checkpoint(A)[1]
        await app.state.db.write(s.apply_history_batch, A, gen, fake.history[A], 120)
        await app.state.bridge.sync_chat(B)
        until = datetime.now(UTC) + timedelta(days=1)
        for i in (118, 119):
            s.put_grant(A, i, "draft,summary", until, {"7": "consent-ref-7"})

    main_srv = uvicorn.Server(
        uvicorn.Config(Faults(app), host="127.0.0.1", port=8765, log_level="warning")
    )
    ctl_srv = uvicorn.Server(uvicorn.Config(ctl, host="127.0.0.1", port=8799, log_level="warning"))
    await asyncio.gather(main_srv.serve(), ctl_srv.serve(), seed())


if __name__ == "__main__":
    asyncio.run(main())
