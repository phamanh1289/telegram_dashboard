import pathlib
import time

import httpx
from telegram_dashboard.youtrack import flow as uiflow
from telegram_dashboard.youtrack.client import YtError
from yt_test_helpers import FLOW, ME, OTHER, UPLOAD, FakeYt, flow_app, flow_html, make, moved


async def test_flow_save_uploads_then_deletes_old_then_comments(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2)}])
    c, svc = flow_app(yt, tmp_path)
    svc._cache["issue:VA-1"] = (time.monotonic(), {})
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
    out = r.json()
    assert r.status_code == 200, out
    assert yt.writes == [("POST", "/api/issues/VA-1/attachments"),
                         ("DELETE", "/api/issues/VA-1/attachments/1-1"),
                         ("POST", "/api/issues/VA-1/comments")]  # fmt: skip
    assert (out["att"], out["rev"], out["warn"]) == ("1-9", 3, "")
    assert yt.comment.startswith("UI flow cập nhật (rev 3) — tệp đính kèm uiflow-VA-1.html")
    assert out["changes"] == ['"Gửi OTP" (Đăng nhập): "Nhập OTP" → "Trang chủ"']
    assert '- "Gửi OTP" (Đăng nhập)' in yt.comment
    assert b'filename="uiflow-VA-1.html"' in yt.upload and b"Content-Type: text/html" in yt.upload
    assert uiflow.extract(yt.upload.decode()).rev == 3
    assert "issue:VA-1" not in svc._cache  # svc.stale after the write


async def test_flow_save_conflict_writes_nothing(tmp_path):
    yt = FakeYt([{"id": "1-2", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2)}])
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
        assert r.status_code == 409 and "người khác" in r.json()["error"] and yt.writes == []
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved()})  # opened before the file existed
        assert r.status_code == 409 and yt.writes == []


async def test_flow_save_first_time_has_no_delete(tmp_path):
    yt = FakeYt([{"id": "1-5", "name": "spec.html", "created": 9, "body": "x"}])
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": FLOW, "base": None})
    assert r.status_code == 200 and r.json()["rev"] == 1
    assert [m for m, _ in yt.writes] == ["POST", "POST"]
    assert yt.comment.startswith("UI flow mới (rev 1) — tệp đính kèm uiflow-VA-1.html\n- Tạo UI flow: 3 màn")


async def test_flow_save_keeps_new_file_when_delete_or_comment_fails(tmp_path):
    files = [{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2)}]
    yt = FakeYt(files, {("DELETE", "/api/issues/VA-1/attachments/1-1"): 403})
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
    assert r.status_code == 200 and "chưa xoá được file cũ" in r.json()["warn"]
    assert yt.writes[-1] == ("POST", "/api/issues/VA-1/comments")  # the comment still goes
    yt = FakeYt(files, {("POST", "/api/issues/VA-1/comments"): 500})
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
    assert r.status_code == 200 and "chưa post được comment" in r.json()["warn"]
    assert "xoá" not in r.json()["warn"]


async def test_flow_save_comment_lists_at_most_20_changes(tmp_path):
    many = {"screens": [{"id": f"s{i}", "title": f"M{i}", "items": []} for i in range(25)], "links": []}
    renamed = {**many, "screens": [{**s, "title": s["title"] + "x"} for s in many["screens"]]}
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(1, many)}])
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": renamed, "base": "1-1"})
    assert r.status_code == 200 and len(r.json()["changes"]) == 25
    lines = yt.comment.splitlines()
    assert len(lines) == 22 and lines[-1] == "- … và 5 thay đổi khác"


async def test_flow_get_tells_our_file_by_its_content_not_its_name(tmp_path):
    other = uiflow.clean(FLOW, "VA-2")  # another ticket's flow, attached here: not this ticket's file
    yt = FakeYt([{"id": "1-1", "name": "spec.html", "created": 9, "body": "<html>plain"},
                 {"id": "1-7", "name": "copy.html", "created": 8, "body": uiflow.build_html(other, "/*engine*/")},
                 {"id": "1-2", "name": "uiflow-VA-1.pdf", "created": 7, "body": flow_html(4)},
                 {"id": "1-3", "name": "Đăng nhập - VA-1.html", "created": 5,
                  "body": uiflow.MARK + "<html>broken"}])  # fmt: skip
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.get("/api/yt/flow", params={"issue": "VA-1"})
        assert r.json() == {"att": "1-3", "flow": None, "broken": True, "ticket_newer": False, "author": None,
                            "yours": True}  # fmt: skip
        yt.files = yt.files[:3]
        r = await c.get("/api/yt/flow", params={"issue": "VA-1"})
        assert r.json() == {"att": None, "flow": None, "broken": False}
        yt.files.append({"id": "1-8", "name": "renamed by hand.html", "created": 1, "body": flow_html(5)})
        r = await c.get("/api/yt/flow", params={"issue": "VA-1"})
        assert (r.json()["att"], r.json()["flow"]["rev"]) == ("1-8", 5)
        yt.files = [
            {"id": "1-4", "name": "uiflow-VA-1.html", "created": 3, "body": flow_html(1)},
            {"id": "1-5", "name": "uiflow-VA-1.html", "created": 7, "body": flow_html(2)},
            {"id": "1-6", "name": "uiflow-VA-1.html", "created": 9, "removed": True, "body": flow_html(3)},
        ]
        r = await c.get("/api/yt/flow", params={"issue": "VA-1"})
        out = r.json()
        assert (out["att"], out["flow"]["rev"], out["broken"]) == ("1-5", 2, False)
    assert yt.writes == []


async def test_flow_save_rejects_no_change_and_bad_flow(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2)}])
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": FLOW, "base": "1-1"})
        assert r.status_code == 400 and r.json()["error"] == "Không có thay đổi"
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": {"screens": [], "links": []}, "base": "1-1"})
        assert r.status_code == 400 and r.json()["error"] == "UI flow không hợp lệ"
    assert yt.writes == []


async def test_flow_save_without_engine_writes_nothing(tmp_path):
    yt = FakeYt([])
    c, _ = flow_app(yt, tmp_path)
    (tmp_path / "uiflow.js").unlink()
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": FLOW})
    assert r.status_code == 503 and "uiflow.js" in r.json()["error"] and yt.writes == []


async def test_upload_401_reaches_the_ui_message():
    for status, code, text in ((401, 401, "Token YouTrack hết hạn"), (403, 403, "không có quyền")):
        svc = make(lambda req, s=status: httpx.Response(s, text="no"))
        try:
            await svc.upload("VA-1", "a.png", b"x", mime="image/png")
        except YtError as e:
            assert e.status == code and text in e.message
        else:
            raise AssertionError("expected YtError")

    def down(req):
        raise httpx.ConnectError("down")

    try:
        await make(down).detach("VA-1", "1-1")
    except YtError as e:
        assert (e.status, e.message) == (502, "Không kết nối được YouTrack")
    else:
        raise AssertionError("expected YtError")


async def test_flow_save_upload_timeout_is_unknown_not_failed(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2)}],
                {UPLOAD: httpx.ReadTimeout("slow")})  # fmt: skip
    c, svc = flow_app(yt, tmp_path)
    svc._cache["issue:VA-1"] = (time.monotonic(), {})
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
    assert r.status_code == 502 and r.json()["error"].startswith("Không rõ đã lưu chưa")
    assert yt.writes == [UPLOAD]  # no DELETE, no comment
    assert "issue:VA-1" not in svc._cache  # stale ran on this path too


async def test_flow_save_upload_500_is_a_plain_failure(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2)}], {UPLOAD: 500})
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
    assert r.status_code == 502 and r.json()["error"].startswith("YouTrack 500") and yt.writes == [UPLOAD]


def test_real_engine_survives_build_html():
    engine = (pathlib.Path(__file__).resolve().parents[1] / "web/public/uiflow.js").read_text(encoding="utf-8")
    assert "UIFlow" in uiflow.build_html(uiflow.clean(FLOW, "VA-1"), engine)


async def test_flow_save_replaces_a_broken_file(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": uiflow.MARK + "<html>broken"}])
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": FLOW, "base": "1-1"})
    assert r.status_code == 200 and r.json()["warn"] == "Đã thay file UI flow hỏng trên ticket"
    assert ("DELETE", "/api/issues/VA-1/attachments/1-1") in yt.writes and r.json()["rev"] == 1


async def test_flow_html_exports_the_flow_on_screen_and_writes_nothing(tmp_path):
    yt = FakeYt([])  # a draft: no file on the ticket yet
    c, _ = flow_app(yt, tmp_path)
    async with c:
        theme = {"color-hl": "oklch(0.53 0.135 40)", "color-ink": "#221a14", "BAD key": "red",
                 "bad": "red;}</style><script>"}
        r = await c.post("/api/yt/flow/html", json={"id": "VA-1", "flow": moved(), "base": None, "theme": theme})
    assert r.status_code == 200 and r.json()["name"] == "uiflow-VA-1.html"
    # the exporter's colours ride along as plain values; anything that is not one is left out
    assert "<style>:root{--color-hl:oklch(0.53 0.135 40);--color-ink:#221a14;}</style>" in r.json()["html"]
    assert uiflow.extract(r.json()["html"]).screens[0].id == moved()["screens"][0]["id"]
    assert yt.writes == []


async def test_flow_get_says_when_the_ticket_changed_after_the_file(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 1_000_000, "body": flow_html(2)}])
    c, _ = flow_app(yt, tmp_path)
    async with c:
        yt.updated = 1_000_000 + 60_000  # the save's own comment
        assert (await c.get("/api/yt/flow", params={"issue": "VA-1"})).json()["ticket_newer"] is False
        yt.updated = 1_000_000 + 10 * 60_000
        assert (await c.get("/api/yt/flow", params={"issue": "VA-1"})).json()["ticket_newer"] is True


async def test_flow_delete_removes_only_the_file_seen_then_comments(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2)}])
    c, svc = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow/delete", json={"id": "VA-1", "base": "1-2"})  # someone saved since
        assert r.status_code == 409 and yt.writes == []
        svc._cache["issue:VA-1"] = (time.monotonic(), {})
        r = await c.post("/api/yt/flow/delete", json={"id": "VA-1", "base": "1-1"})
    assert r.status_code == 200 and r.json() == {"warnings": []}
    assert yt.writes == [("DELETE", "/api/issues/VA-1/attachments/1-1"), ("POST", "/api/issues/VA-1/comments")]
    assert yt.comment.startswith("Đã xoá UI flow") and "issue:VA-1" not in svc._cache


async def test_flow_md_exports_the_flow_on_screen_for_an_ai_and_writes_nothing(tmp_path, monkeypatch):
    from telegram_dashboard import zeplin

    monkeypatch.setattr(zeplin, "token", lambda: "")  # never asked: these screens link no design
    yt = FakeYt([])
    c, svc = flow_app(yt, tmp_path)
    ticket = {"id": "VA-1", "summary": "Login", "description": "AC-1: Gửi OTP"}
    svc._cache["issue:VA-1"] = (time.monotonic(), ticket)
    async with c:
        r = await c.post("/api/yt/flow/md", json={"id": "VA-1", "flow": FLOW, "note": "Làm bằng Compose",
                                                  "data": False})
    out = r.json()
    assert r.status_code == 200, out
    assert out["name"] == "uiflow-VA-1.md" and "## Yêu cầu của người giao việc\n\nLàm bằng Compose" in out["md"]
    assert "AC-1: Gửi OTP" in out["md"] and "## Còn thiếu / cần hỏi lại" in out["md"]
    assert "## Dữ liệu sơ đồ" not in out["md"] and yt.writes == []
    assert out["tokens"] == -(-len(out["md"].encode()) // 3)  # the pre-check's estimate, shown in the dialog


async def test_only_the_files_author_may_replace_or_remove_it(tmp_path):
    """The uploader YouTrack records is the file's signature: anyone opens and edits it (a draft), only they save."""
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2), "author": OTHER}])
    c, _ = flow_app(yt, tmp_path)
    async with c:
        got = (await c.get("/api/yt/flow", params={"issue": "VA-1"})).json()
        assert (got["author"], got["yours"]) == ({"id": "1-2", "login": "an", "name": "An"}, False)
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
        assert r.status_code == 403 and r.json()["error"].startswith("Chỉ An (người lưu UI flow này)")
        r = await c.post("/api/yt/flow/delete", json={"id": "VA-1", "base": "1-1"})
        assert r.status_code == 403 and yt.writes == []  # nothing uploaded, removed or commented
        yt.files[0]["author"] = ME
        assert (await c.get("/api/yt/flow", params={"issue": "VA-1"})).json()["yours"] is True
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
        assert r.status_code == 200 and r.json()["rev"] == 3


async def test_a_name_taken_by_another_attachment_gets_the_savers_name(tmp_path):
    yt = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2), "author": ME},
                 {"id": "1-5", "name": "uiflow-VA-1.html", "created": 1, "body": "<html>a copy"}])  # fmt: skip
    c, _ = flow_app(yt, tmp_path)
    async with c:
        r = await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
    assert r.status_code == 200 and b'filename="uiflow-VA-1 - T\xc3\xb4i.html"' in yt.upload  # "Tôi": the saver
    yt2 = FakeYt([{"id": "1-1", "name": "uiflow-VA-1.html", "created": 5, "body": flow_html(2), "author": ME}])
    c, _ = flow_app(yt2, tmp_path)
    async with c:  # only the file being replaced has that name: kept as is
        await c.post("/api/yt/flow", json={"id": "VA-1", "flow": moved(), "base": "1-1"})
    assert b'filename="uiflow-VA-1.html"' in yt2.upload


async def test_flow_image_cannot_run_script_on_the_app_origin(tmp_path, monkeypatch):
    """A Zeplin "image" served as image/svg+xml from 127.0.0.1 would run its script with the app's cookie when
    opened in a tab (Markdown "Mở ảnh ở tab mới"): same guard headers as /attachment."""
    from telegram_dashboard import zeplin

    async def image(_u):
        return b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml"

    monkeypatch.setattr(zeplin, "image", image)
    c, _ = flow_app(FakeYt([]), tmp_path)
    async with c:
        r = await c.get("/api/yt/flow/image", params={"u": "https://img.zeplin.io/a.svg"})
    assert r.status_code == 200
    assert r.headers["content-security-policy"] == "sandbox" and r.headers["x-content-type-options"] == "nosniff"
