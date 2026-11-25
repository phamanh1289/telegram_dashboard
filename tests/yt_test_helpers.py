import dataclasses
import json
import types

import httpx
from fastapi import FastAPI
from telegram_dashboard.config import Settings
from telegram_dashboard.youtrack import flow as uiflow
from telegram_dashboard.youtrack.api import build_router, yt_error_response
from telegram_dashboard.youtrack.client import YtError
from telegram_dashboard.youtrack.service import YouTrackDashboard


def issue(n, state="Open"):
    return {
        "idReadable": f"VA-{n}", "summary": f"t{n}", "created": 1, "updated": 2,
        "customFields": [
            {"name": "State", "value": {"name": state}},
            {"name": "Assignee", "value": {"login": "a", "fullName": "A"}},
            {"name": "Sprints", "value": [{"name": "S1"}]},
        ],
    }  # fmt: skip


def make(handler):
    s = dataclasses.replace(Settings.from_env(), youtrack_url="http://yt", youtrack_token="t")
    svc = YouTrackDashboard(s)
    svc._client = httpx.AsyncClient(base_url="http://yt", transport=httpx.MockTransport(handler))
    return svc


def done(r) -> dict:
    """The result line of an AI answer streamed as NDJSON."""
    lines = [json.loads(x) for x in r.text.splitlines()]
    assert "done" in lines[-1], lines
    return lines[-1]["done"]


FLOW = {"screens": [
    {"id": "login", "title": "Đăng nhập", "items": [{"id": "otp", "label": "Gửi OTP"}]},
    {"id": "code", "title": "Nhập OTP", "items": []},
    {"id": "home", "title": "Trang chủ", "items": []},
], "links": [{"src": "login.otp", "to": "code"}]}  # fmt: skip


def flow_html(rev: int, raw: dict = FLOW) -> str:
    f = uiflow.clean(raw, "VA-1")
    f.rev = rev
    return uiflow.build_html(f, "/*engine*/")


ME = {"id": "1-1", "login": "me", "fullName": "Tôi"}  # the token's user
OTHER = {"id": "1-2", "login": "an", "fullName": "An"}


class FakeYt:
    """One ticket VA-1 with `files` ({id, name, created, removed?, body}); records every write.
    `fail`: (method, path) -> HTTP status, or an exception to raise."""

    def __init__(self, files: list[dict], fail: dict | None = None):
        self.files, self.fail, self.writes = files, fail or {}, []
        self.upload = self.comment = None
        self.updated = 0  # the ticket's own "updated" (ms)

    def __call__(self, req):
        m, p = req.method, req.url.path
        if m != "GET":
            self.writes.append((m, p))
        if isinstance(f := self.fail.get((m, p)), Exception):
            raise f
        if f:
            return httpx.Response(f, text="no")
        if p == "/api/issues/VA-1":
            keep = ("id", "name", "created", "removed", "author")
            atts = [{k: f[k] for k in keep if k in f} | {"size": 9, "url": f"/files/{f['id']}"} for f in self.files]
            return httpx.Response(200, json={"updated": self.updated, "attachments": atts})
        if p == "/api/users/me":
            return httpx.Response(200, json=ME)
        if p.startswith("/files/"):
            return httpx.Response(200, text=next(f["body"] for f in self.files if f["id"] == p[7:]))
        if p == "/api/issues/VA-1/attachments":
            self.upload = req.content
            return httpx.Response(200, json=[{"id": "1-9", "name": "uiflow-VA-1.html"}])
        if p == "/api/issues/VA-1/comments":
            self.comment = json.loads(req.content)["text"]
            return httpx.Response(200, json={"id": "c"})
        return httpx.Response(200)  # DELETE


def flow_app(yt: FakeYt, tmp_path) -> tuple[httpx.AsyncClient, YouTrackDashboard]:
    (tmp_path / "uiflow.js").write_text("/*engine*/")
    svc = make(yt)
    app = FastAPI()
    app.include_router(build_router(svc))
    app.state.settings = types.SimpleNamespace(static_dir=tmp_path)
    app.exception_handler(YtError)(yt_error_response)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t"), svc


def moved(raw: dict = FLOW) -> dict:
    """The same flow with "Gửi OTP" now going to Trang chủ."""
    return {**raw, "links": [{"src": "login.otp", "to": "home"}]}


UPLOAD = ("POST", "/api/issues/VA-1/attachments")
