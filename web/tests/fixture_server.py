"""Standalone e2e backend: real app + fake Telegram on :E2E_PORT (8766), test control API on :E2E_CONTROL (8799).

Never part of the live app (which owns :8765). Data lives in a temp dir; nothing touches Telegram or a real AI.
"""

import asyncio
import os
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
PORT = int(os.environ.get("E2E_PORT", "8766"))
CONTROL_PORT = int(os.environ.get("E2E_CONTROL", "8799"))

tmp = Path(tempfile.mkdtemp(prefix="td-e2e-"))
(tmp / "web").mkdir()
(tmp / "web" / "out").symlink_to(ROOT / "web" / "out")
AGENT = "sh -c \"cat >/dev/null; echo 'Bản nháp AI: cảm ơn mọi người!'\""  # fake claude CLI
# "Trả lời từ code": the fake reading agent answers in ANSWER_TASK's shape (never a real CLI on this machine), slowly
# enough to close the reply panel while it runs
AGENT_CODE = ("sh -c \"cat >/dev/null; sleep 4; printf '**Trả lời:** OTP hết hạn sau 120 giây.\\n**Căn cứ:**\\n"
              "- `auth/Otp.kt:verify` "
              "đếm lần sai\\n**Độ chắc:** Cao\\n===\\nDạ OTP dùng được 2 phút ạ.\\n---\\nMã OTP có hiệu lực 2 phút; "
              "nhập sai 5 lần sẽ bị khoá 15 phút.\\n'\"")
# Consent mode off: the inbox AI may read the seeded tags (the AI-draft test needs it).
settings = Settings(
    root=tmp, port=PORT, ai_agent_command=AGENT, ai_agent_project_command=AGENT_CODE, ai_model="",
    app_origin=os.environ.get("APP_ORIGIN", f"http://127.0.0.1:{PORT}"),  # web-fixture (next dev :3002) proxies here
)

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
    """A live tag (new or edited), as Telegram delivers one that mentions us."""
    b = await request.json()
    m = msg(b["chat"], b["id"], b["text"], edit=b.get("edit"), sender=b.get("sender", "7"))
    m.date = datetime.now(UTC)
    await app.state.bridge.on_mention(m, TITLES[b["chat"]], "supergroup")
    return {"ok": True}


@ctl.post("/delete")
async def delete(request: Request):
    b = await request.json()
    await app.state.bridge.on_deleted(b["chat"], [b["id"]])
    return {"ok": True}


TITLES = {A: "Nhóm Dự án", B: "Nhóm Bạn bè"}


async def main():
    async def seed():
        while not hasattr(app.state, "store") or app.state.bridge.state != "connected":
            await asyncio.sleep(0.05)
        # The app keeps only tags: A's last 10 and all of B's are tags (pending), the rest is live history.
        now = datetime.now(UTC)
        tags = [m for m in fake.history[A] if m.message_id > 110] + fake.history[B]
        for k, m in enumerate(tags):
            m.date = now - timedelta(minutes=len(tags) - k)
        found = [(TITLES[m.chat_id], "supergroup", m, False) for m in tags]
        await app.state.db.write(app.state.store.store_mentions, found)

    main_srv = uvicorn.Server(
        uvicorn.Config(Faults(app), host="127.0.0.1", port=PORT, log_level="warning")
    )
    ctl_srv = uvicorn.Server(uvicorn.Config(ctl, host="127.0.0.1", port=CONTROL_PORT, log_level="warning"))
    await asyncio.gather(main_srv.serve(), ctl_srv.serve(), seed())


if __name__ == "__main__":
    asyncio.run(main())
