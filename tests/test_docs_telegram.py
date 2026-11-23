"""Việc cần xử lý against Tài liệu: a message's file kept in the library (added / updated / removed), a KB article
downloaded again on demand, the file's name kept with the message, PDFs read through pypdf."""

import pytest
from conftest import ORIGIN, A, msg
from telegram_dashboard.docs.extract import read_text
from telegram_dashboard.docs.library import tg_name
from telegram_dashboard.models import FileInfo
from telegram_dashboard.youtrack.client import YtError


@pytest.fixture(autouse=True)
def _origin(request):
    if "client" in request.fixturenames:
        request.getfixturevalue("client").headers["Origin"] = ORIGIN


def doc_msg(mid: int, name: str, size: int = 10, text: str = "spec mới nè"):
    m = msg(A, mid, text)
    m.media_kind, m.file = "document", FileInfo(name=name, size=size, mime="text/markdown")
    return m


def put(client, mid, name, body: bytes):
    s = client.app.state
    m = doc_msg(mid, name, len(body))
    s.store.apply_message(m)
    client.app.state.bridge.transport.files[(A, mid)] = (m.file, body)
    return client.post("/api/docs/telegram", json={"chat_id": A, "message_id": mid})


@pytest.fixture
def tracked(client):
    client.app.state.store.set_tracking(A, True, title="BE", kind="supergroup")
    client.app.state.bridge.state = "connected"
    return client


def test_a_file_is_added_then_updated_by_name_then_removed(tracked):
    c = tracked
    r = put(c, 5, "spec.md", b"# Spec\n\nfield amount")
    assert r.status_code == 200, r.text
    d = r.json()
    got = (d["source"], d["ref"], d["origin"], d["folder"], d["size"])
    assert got == ("telegram", "spec.md", f"{A}:5", "Telegram", 20)
    assert [x["id"] for x in c.get("/api/docs", params={"source": "telegram"}).json()] == [d["id"]]
    hits = c.get("/api/docs/search", params={"q": "amount", "source": "telegram"}).json()["hits"]
    assert hits[0]["doc"]["id"] == d["id"]

    r2 = put(c, 9, "spec.md", b"# Spec\n\nfield total")
    assert r2.json()["id"] == d["id"] and r2.json()["origin"] == f"{A}:9"
    detail = c.get(f"/api/docs/{d['id']}").json()
    assert detail["revs"][0]["by"] == "Alice" and detail["revs"][0]["blocks"][0]["added"] == ["field total"]

    path = c.app.state.settings.data_dir / "docs" / "telegram" / "spec.md"
    assert path.read_bytes() == b"# Spec\n\nfield total"
    assert c.delete(f"/api/docs/{d['id']}").status_code == 204
    assert not path.exists() and c.get("/api/docs", params={"source": "telegram"}).json() == []
    assert not [p for p in path.parent.iterdir()]  # no temp file left behind


def test_unsupported_or_unknown_files_are_refused_before_a_download(tracked):
    c = tracked
    r = put(c, 5, "bang.xlsx", b"PK")
    assert r.status_code == 422 and r.json()["error"]["code"] == "doc_unsupported"
    assert c.app.state.bridge.transport.downloads == []
    r = c.post("/api/docs/telegram", json={"chat_id": A, "message_id": 77})  # not a kept message
    assert r.status_code == 404 and r.json()["error"]["code"] == "doc_tg_no_file"


def test_a_library_file_of_another_source_cannot_be_removed(tracked):
    c = tracked
    s = c.app.state
    doc = s.store.doc_upsert("yt_article", "VA-A-1", title="x", path="/x", hash="h", chars=1, size=1,
                             updated_at=None, tickets=[], parts=[(1, "", "x")])  # fmt: skip
    assert c.delete(f"/api/docs/{doc}").json()["error"]["code"] == "doc_not_removable"


def test_tg_name_strips_paths_and_keeps_the_extension():
    assert tg_name("../../etc/passwd.md", 3, ".md") == "_.._etc_passwd.md"
    assert tg_name(".md", 3, ".md") == "telegram-3.md"
    assert tg_name("a" * 300 + ".pdf", 3, ".pdf").endswith("a.pdf") and len(tg_name("a" * 300, 3, ".pdf")) == 120


def test_a_kb_article_is_downloaded_again_on_demand(tracked, monkeypatch):
    c = tracked
    s = c.app.state

    async def yt(path, **kw):
        ref = path.rsplit("/", 1)[-1]
        if ref != "VA-A-1":
            raise YtError(404, "not found")
        return {"idReadable": ref, "summary": "Bài 1", "updated": 2_000, "content": "mới",
                "updatedBy": {"fullName": "Lan"}}

    monkeypatch.setattr(s.yt, "yt", yt)
    d = c.post("/api/docs/kb/VA-A-1/refresh").json()
    assert d["source"] == "youtrack" and d["ref"] == "VA-A-1" and d["title"] == "Bài 1"
    assert c.post("/api/docs/kb/VA-A-9/refresh").status_code == 502
    assert c.post("/api/docs/kb/nope/refresh").status_code == 422


def test_the_file_name_is_kept_and_filled_in_on_a_refetch(tracked):
    s = tracked.app.state
    old = msg(A, 5, "spec")
    old.media_kind = "document"
    s.store.apply_message(old)  # stored before names were kept
    assert s.store.get_message(A, 5).file is None
    s.store.apply_message(doc_msg(5, "spec.docx", 42, "spec"))  # the mention backfill reads it again, same version
    assert s.store.get_message(A, 5).file == FileInfo(name="spec.docx", size=42, mime="text/markdown")
    dto = tracked.get("/api/pending").json()
    assert next(p for p in dto if p["message"]["message_id"] == "5")["message"]["file"]["name"] == "spec.docx"


def _pdf(text: str) -> bytes:
    """A one-page PDF with `text` in Helvetica: enough of a text layer for pypdf."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % x for x in offs)
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)


def test_pdf_text_is_read_and_a_broken_one_has_a_code(tmp_path):
    p = tmp_path / "a.pdf"
    p.write_bytes(_pdf("Dieu kien giai ngan"))
    assert "Dieu kien giai ngan" in read_text(p)
    p.write_bytes(b"%PDF-1.4 broken")
    with pytest.raises(ValueError) as e:
        read_text(p)
    assert e.value.args[0] in ("bad_pdf", "pdf_no_text")


