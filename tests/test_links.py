import asyncio
import json
import re
from datetime import datetime
from types import SimpleNamespace as NS

from telegram_dashboard.docs.library import Library
from telegram_dashboard.docs.parts import MAX_CHARS
from telegram_dashboard.links import INLINE_CHARS, delete_links, expand, link_block, links_dir
from telegram_dashboard.models import StoredMessage
from telegram_dashboard.storage import Db, Store

URLS = (
    "xem https://works.citics.vn/articles/VA-A-134 và https://t.me/c/1234/273/39671 https://other.host/articles/X-A-1"
)


async def _no_ai(*_, **__):
    raise RuntimeError("no AI")


def state(tmp_path, content: str, tracked: bool = True, summary=None):
    calls = {"yt": 0}
    ask = summary or _no_ai

    async def yt(path, **_):
        assert path == "/api/articles/VA-A-134"
        calls["yt"] += 1
        return {"idReadable": "VA-A-134", "summary": "Quy trình", "content": content, "updated": 1}

    async def read(fn, *a, **kw):
        return fn(*a, **kw)

    async def fetch_ids(chat_id, ids):
        assert (chat_id, ids) == ("-1001234", [39671])
        return [StoredMessage(chat_id=chat_id, message_id=39671, sender_name="An", text="cần hỗ trợ",
                              date=datetime(2026, 11, 5))]  # fmt: skip

    async def flow_outline(detail):  # the ticket's saved UI flow, when it has one
        return "UI flow: Đăng nhập → OTP" if detail.get("attachments") else None

    settings = NS(data_dir=tmp_path / "data")
    ai = NS(require_read=lambda: None, ask=ask)
    store = Store(tmp_path / "db.sqlite3")
    db = Db(store, NS(notify=lambda: None))
    return NS(
        settings=settings,
        yt=NS(base="https://works.citics.vn", token="t", yt=yt, flow_outline=flow_outline),
        ai=ai,
        docs=Library(settings, db, ai),
        calls=calls,
        db=NS(read=read),
        store=NS(
            get_messages_by_ids=lambda chat, ids: ([], ""),
            is_tracking=lambda chat: tracked,
            doc_find=store.doc_find,
            doc_get=store.doc_get,
            doc_list=store.doc_list,
        ),
        bridge=NS(fetch_ids=fetch_ids),
    )


async def test_expand_saves_long_article_and_inlines_telegram_message(tmp_path):
    s = state(tmp_path, "Bước 1 " * 3000)
    out = await expand(s, URLS, "t1")
    saved = next(links_dir(s.settings, "t1").iterdir())  # the long article: whole, in a file the agent may read
    assert "Bước 1 " * 3000 in saved.read_text(encoding="utf-8") and str(saved) in out
    assert saved.stat().st_mode & 0o777 == 0o600 and saved.parent.parent.stat().st_mode & 0o777 == 0o700
    assert "An (2026-11-05 00:00):\ncần hỗ trợ" in out and "<untrusted_link_content>" in out
    assert out.count("dashboard không đọc được") == 1  # the other YouTrack never gets our token
    delete_links(s.settings, "t1")
    assert not links_dir(s.settings, "t1").exists()
    assert await expand(s, "không link", "t1") == "không link"


async def test_untracked_chat_is_not_read(tmp_path):
    out = await expand(state(tmp_path, "ngắn", tracked=False), URLS, "t1")
    assert "cần hỗ trợ" not in out and out.count("dashboard không đọc được") == 2


async def test_link_content_is_capped(tmp_path):
    s = state(tmp_path, "x" * (MAX_CHARS * 2))
    await expand(s, URLS, "t1")
    text = next(links_dir(s.settings, "t1").iterdir()).read_text(encoding="utf-8")
    assert len(text) < MAX_CHARS + 1000 and f"bị cắt ở {MAX_CHARS}" in text


async def test_save_failure_inlines_the_start(tmp_path):
    s = state(tmp_path, "y" * 20000)
    (tmp_path / "agent-links").write_text("")  # a file where the dir goes: every write fails
    out = await expand(s, URLS, "t1")  # the task still starts
    assert "y" * (INLINE_CHARS - 100) in out and "y" * INLINE_CHARS not in out  # the start, after its title
    assert "không lưu được bản đầy đủ" in out


async def test_outline_has_lines_and_verbatim_leads(tmp_path):
    asked = []

    async def ask(prompt, **kw):
        asked.append(prompt)
        return "- ý chính"

    body = "mở đầu\n" + "x\n" * 5000 + "## Yêu cầu API\nTrả về 3 field: a, b, c.\n" + "y\n" * 5000
    s = state(tmp_path, body, summary=ask)
    out = await expand(s, URLS, "t1")
    saved = next(links_dir(s.settings, "t1").iterdir()).read_text(encoding="utf-8").split("\n")
    rows = re.findall(r"- dòng (\d+): (.+)", out)  # each outline line number is the heading's line in the file
    assert [h for _, h in rows] == ["# VA-A-134 Quy trình", "## Yêu cầu API"]
    assert all(saved[int(n) - 1] == h for n, h in rows)
    assert "Trả về 3 field: a, b, c." in out  # the part's start, verbatim
    assert not asked  # short enough: no AI summary


async def test_long_text_without_headings_gets_summary(tmp_path):
    asked = []

    async def ask(prompt, **kw):
        asked.append((prompt, kw))
        return "- ý chính"

    s = state(tmp_path, "z " * 20000, summary=ask)
    out = await expand(s, URLS, "t1")
    assert "Tóm tắt (AI" in out and "- ý chính" in out and len(asked) == 1
    assert "<untrusted_link_content>" in asked[0][0] and asked[0][1]["feature"] == "docs"
    await expand(s, URLS, "t2", summarize=False)
    assert len(asked) == 1


async def test_summary_failure_keeps_outline(tmp_path):
    out = await expand(state(tmp_path, "# Đầu\n" + "z " * 20000), URLS, "t1")
    assert "Mục lục" in out and "Tóm tắt (AI" not in out


async def test_link_block_without_files_for_a_one_shot_ai(tmp_path):
    asked = []

    async def ask(prompt, **kw):
        asked.append(prompt)
        return "- ý chính"

    s = state(tmp_path, "## Mục 1\nđầu mục\n" + "w " * 6000, summary=ask)
    out = await link_block(s, URLS, None)
    assert not (tmp_path / "agent-links").exists() and "dòng " not in out  # nothing saved, no line numbers
    assert "- ## Mục 1\n  đầu mục" in out and "w " * 5000 not in out
    assert "Tóm tắt (AI" in out and len(asked) == 1  # few headings, no file to page: summarized
    assert await link_block(s, "không link", None) == ""


async def test_ticket_link_is_read_as_youtrack_ai_sees_it(tmp_path):
    s = state(tmp_path, "")
    seen = []

    async def cached(key, fn):
        seen.append(key)
        return await fn()

    async def detail(i):
        return {"id": i, "summary": "Sửa màn login", "description": "Nút Đăng nhập bị mờ", "links": [],
                "comments": [{"author": "An", "created": None, "text": "đã có API"}]}  # fmt: skip

    s.yt.cached, s.yt.detail = cached, detail
    text = "làm https://works.citics.vn/issue/VA-12/sua-login và https://other.host/issue/X-1"
    out = await expand(s, text, "t2")
    assert seen == ["issue:VA-12"] and "Sửa màn login" in out and "Nút Đăng nhập bị mờ" in out and "đã có API" in out
    assert out.count("dashboard không đọc được") == 1  # the other YouTrack never gets our token
    assert "uiflow" not in out  # no UI flow file on the ticket: nothing added
    with_flow = {**(await detail("VA-12")), "attachments": [{"name": "uiflow-VA-12.html"}]}
    s.yt.detail = lambda i: asyncio.sleep(0, with_flow)
    out = await expand(s, "làm https://works.citics.vn/issue/VA-12", "t2")
    assert '"uiflow"' in out and "Đăng nhập → OTP" in out  # the session knows what leads where
    delete_links(s.settings, "t2")


async def test_session_reads_tickets_named_by_id_and_their_documents(tmp_path):
    s = state(tmp_path, "nội dung tài liệu")
    seen = []

    async def cached(key, fn):
        seen.append(key)
        return [{"shortName": "VA"}] if key == "projects" else await fn()

    async def detail(i):
        return {"id": i, "summary": "Trả key", "links": [], "comments": [],
                "description": "AC 1.8 xem https://works.citics.vn/articles/VA-A-134"}  # fmt: skip

    s.yt.cached, s.yt.detail = cached, detail
    text = "update AC trong VA-12 (UTF-8, #REF-109c20), VA-12 nữa, xem VA-A-134"
    out = await expand(s, text, "t3")
    assert seen == ["projects", "issue:VA-12"]  # once; not UTF-8 (no such project), not the session code
    assert "## https://works.citics.vn/issue/VA-12" in out and "Trả key" in out
    assert "# VA-A-134 Quy trình" in out and "nội dung tài liệu" in out  # named by ID, and linked from the ticket
    assert out.count("## https://works.citics.vn/articles/VA-A-134") == 1
    assert "dashboard không đọc được" not in out
    assert await link_block(s, text, None) == ""  # YouTrack AI: links only
    delete_links(s.settings, "t3")


async def test_session_gets_library_docs_naming_its_ticket_and_typed_doc_refs(tmp_path):
    s = state(tmp_path, "")
    folder = tmp_path / "kb"
    folder.mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "docs.json").write_text(json.dumps({"folders": [str(folder)]}))
    spec, other = folder / "dac-ta.md", folder / "khac.md"
    spec.write_text("Đặc tả VA-12: trả key theo vai trò")
    other.write_text("Ghi chú nội bộ")
    ids = [await s.docs.index("file", str(f), f.name, f.read_text(), path=f, size=1, updated_at=None)
           for f in (spec, other)]  # fmt: skip

    async def cached(key, fn):
        return [{"shortName": "VA"}] if key == "projects" else await fn()

    async def detail(i):
        return {"id": i, "summary": "Trả key", "links": [], "comments": [], "description": "không link tài liệu"}

    s.yt.cached, s.yt.detail = cached, detail
    out = await expand(s, "làm VA-12", "t4")
    assert f"## #DOC{ids[0]}" in out and "Tài liệu: dac-ta.md" in out and "trả key theo vai trò" in out
    assert "Ghi chú nội bộ" not in out  # names no ticket of the session
    typed = await expand(s, f"đọc #DOC{ids[1]}", "t4")
    assert "Ghi chú nội bộ" in typed
    quoted = await expand(s, f"xem tin\n\n<tg-ab12>\n#DOC{ids[1]}\n</tg-ab12>", "t4")
    assert "Ghi chú nội bộ" not in quoted  # someone else's message can't pull a local file in
    assert await link_block(s, f"#DOC{ids[1]}", None) == ""  # YouTrack AI: ticket text is not the user's ask
    other.unlink()
    (tmp_path / "data" / "docs.json").write_text(json.dumps({"folders": []}))
    gone = await expand(s, f"đọc #DOC{ids[0]}", "t4")
    assert "trả key theo vai trò" not in gone and "dashboard không đọc được" in gone  # out of the sources: unread
    delete_links(s.settings, "t4")


async def test_two_sessions_share_one_download_and_one_summary(tmp_path):
    asked = []

    async def ask(prompt, **kw):
        asked.append(prompt)
        return "- ý chính"

    s = state(tmp_path, "z " * 20000, summary=ask)  # > SUMMARY_FROM, no headings
    a = await expand(s, URLS, "a")
    b = await expand(s, URLS, "b")
    assert s.calls["yt"] == 3 and len(asked) == 1  # first: updated-check + download; second: updated-check only
    assert "- ý chính" in a and "- ý chính" in b
    files = [next(links_dir(s.settings, k).iterdir()).read_text() for k in "ab"]
    assert files[0] == files[1]


async def test_summary_prompt_no_longer_carries_the_task(tmp_path):
    asked = []

    async def ask(prompt, **kw):
        asked.append(prompt)
        return "- ok"

    s = state(tmp_path, "z " * 20000, summary=ask)
    await expand(s, "BÍ_MẬT_TASK " + URLS, "a")
    assert asked and all("BÍ_MẬT_TASK" not in p for p in asked)
