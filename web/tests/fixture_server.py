"""Standalone e2e backend: real app + fake Telegram on :E2E_PORT (8766), test control API on :E2E_CONTROL (8799).

Never part of the live app (which owns :8765). Data lives in a temp dir; nothing touches Telegram or a real AI.
"""

import asyncio
import json
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

control = {"send": "ok", "sent": 0, "slow_chat": None, "slow_ms": 0, "fail_changes": 0,
           "yt": False, "flow": "file", "flow_save": "ok", "flow_posts": [], "ai_ms": 0, "ai_calls": 0, "att": "1-1",
           "save_ms": 0}

# UI flow (ticket VA-1, YouTrack in mock mode): the ticket, its uiflow file and the AI run, faked here.
# `yt`: off until a spec asks for it, so the other specs keep the real (token-less) YouTrack routes.
# `flow`: what GET /api/yt/flow answers (file / none / broken / fail); `flow_save`: POST /api/yt/flow (ok / 409 / 502);
# `flow_posts`: the bodies POST /api/yt/flow got; `ai_ms`: how long the AI run takes; `save_ms`: the save.
FLOW = {
    "v": 1, "ticket": "VA-1", "rev": 1, "device": "mobile",
    "screens": [
        {"id": "login", "title": "Đăng nhập", "kind": "screen", "parent": None, "items": [{"id": "otp", "label": "Gửi OTP"}]},
        {"id": "code", "title": "Nhập OTP", "kind": "screen", "parent": None,
         "items": [{"id": "ok", "label": "Xác nhận"}, {"id": "later", "label": "Để sau"}]},
        {"id": "err", "title": "Sai mã", "kind": "popup", "parent": "code", "items": []},
        {"id": "home", "title": "Trang chủ", "kind": "screen", "parent": None, "items": [{"id": "out", "label": "Đăng xuất"}]},
    ],
    "links": [
        {"src": "login.otp", "to": "code", "act": "navigate", "when": "", "ac": "AC-1"},
        {"src": "code.ok", "to": "err", "act": "open", "when": "Mã sai", "ac": "AC-2"},
        {"src": "code.later", "to": "home", "act": "navigate", "when": "", "ac": "AC-3"},
        {"src": "code", "to": "login", "act": "back", "when": "", "ac": ""},
    ],
}
FLOW0 = json.loads(json.dumps(FLOW))  # what /set puts back: a save rewrites FLOW and ISSUE, tests share one backend
ISSUE: dict = {
    "id": "VA-1", "summary": "Đăng nhập bằng OTP", "created": 1_700_000_000_000, "updated": 1_700_000_000_000,
    "resolved": None, "type": "Feature", "state": "Open", "priority": "Normal", "assignee": None, "assigneeLogin": None,
    "qc": None, "reporter": "PO", "due": None, "estimate": None, "sprints": [],
    "description": "AC-1: gửi OTP. AC-2: sai mã báo lỗi. AC-3: để sau về trang chủ.", "comments": [], "links": [],
    "attachments": [{"id": "1-1", "name": "uiflow-VA-1.html", "mime": "text/html", "size": 2048, "comment": None}],
}


ISSUE0 = json.loads(json.dumps(ISSUE))


async def answer(send, status: int, body) -> None:
    await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": json.dumps(body).encode()})


async def body_of(receive) -> dict:
    data = b""
    while True:
        m = await receive()
        data += m.get("body", b"")
        if not m.get("more_body"):
            return json.loads(data or b"{}")


# A YouTrack connection, so the YouTrack tab opens instead of sending the user to Cài đặt (no token here, so the real
# routes answer empty lists; the ones the UI flow dialog reads are faked below).
CONFIG = {"base": "https://youtrack.example.test", "mock": False, "t": {"wip": 3, "stale": 7, "dead": 14}, "hist": 0, "ai": True}


async def fake_yt(scope, receive, send) -> bool:
    """The YouTrack routes the UI flow dialog reads, in place of the real (mock-mode) ones. True when answered."""
    path, post, q = scope["path"], scope["method"] == "POST", scope["query_string"].decode()
    if path == "/api/yt/config":
        await answer(send, 200, CONFIG)
    elif path == "/api/yt/issue" and q == "id=VA-1":
        await answer(send, 200, ISSUE)
    elif path == "/api/yt/flow" and not post:
        mode = control["flow"]
        if mode == "fail":
            await answer(send, 502, {"error": "YouTrack 502 khi tải tệp"})
        else:
            got = {"file": (control["att"], FLOW, False), "none": (None, None, False), "broken": ("1-1", None, True)}[mode]
            await answer(send, 200, dict(zip(("att", "flow", "broken"), got)))
    elif path == "/api/yt/flow":
        b = await body_of(receive)
        control["flow_posts"].append(b)
        await asyncio.sleep(control["save_ms"] / 1000)
        mode = control["flow_save"]
        if mode == "409":
            await answer(send, 409, {"error": "UI flow vừa được người khác cập nhật — mở lại để xem bản mới"})
        elif mode == "502":
            await answer(send, 502, {"error": "Không rõ đã lưu chưa — mở lại UI flow để kiểm tra trước khi lưu lại"})
        else:  # stored: a later GET serves what was saved, as YouTrack would
            rev = (b["flow"].get("rev") or 0) + 1
            FLOW.clear()
            FLOW.update({**b["flow"], "rev": rev})
            control["flow"], control["att"] = "file", "1-2"
            changes = ["thêm màn Trang chủ", "Để sau: Nhập OTP → Trang chủ"]
            ISSUE["attachments"] = [{**ISSUE["attachments"][0], "id": "1-2"}]
            ISSUE["comments"] = [*ISSUE["comments"], {  # as yt_dashboard writes it: the file named in plain text
                "id": f"c{rev}", "author": "Tôi", "created": 1_700_000_100_000,
                "text": f"UI flow cập nhật (rev {rev}) — tệp đính kèm uiflow-VA-1.html\n" + "\n".join(f"- {c}" for c in changes),
            }]
            await answer(send, 200, {"att": "1-2", "rev": rev, "changes": changes, "warn": ""})
    elif path == "/api/yt/ai/flow":
        await body_of(receive)
        control["ai_calls"] += 1
        await asyncio.sleep(control["ai_ms"] / 1000)
        await answer(send, 200, {"flow": {**FLOW, "rev": 0}})
    else:
        return False
    return True


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
            if control["yt"] and path.startswith("/api/yt/") and await fake_yt(scope, receive, send):
                return
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
    b = await request.json()
    if "flow" in b:  # a UI flow test: start from the pristine ticket and file
        FLOW.clear()
        FLOW.update(json.loads(json.dumps(FLOW0)))
        ISSUE.clear()
        ISSUE.update(json.loads(json.dumps(ISSUE0)))
        control["att"] = "1-1"
    control.update(b)
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
