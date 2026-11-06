import re
from datetime import datetime
from types import SimpleNamespace as NS

from telegram_dashboard.links import INLINE_CHARS, MAX_CHARS, delete_links, expand, link_block, links_dir
from telegram_dashboard.models import StoredMessage

URLS = "xem https://works.citics.vn/articles/VA-A-134 và https://t.me/c/1234/273/39671 https://other.host/articles/X-A-1"


async def _no_ai(*_, **__):
    raise RuntimeError("no AI")


def state(tmp_path, content: str, tracked: bool = True, summary=None):
    async def yt(path, **_):
        assert path == "/api/articles/VA-A-134"
        return {"idReadable": "VA-A-134", "summary": "Quy trình", "content": content}

    async def read(fn, *a):
        return fn(*a)

    async def fetch_ids(chat_id, ids):
        assert (chat_id, ids) == ("-1001234", [39671])
        return [StoredMessage(chat_id=chat_id, message_id=39671, sender_name="An", text="cần hỗ trợ",
                              date=datetime(2026, 11, 5))]  # fmt: skip

    return NS(
        settings=NS(data_dir=tmp_path / "data"),
        yt=NS(base="https://works.citics.vn", token="t", yt=yt),
        ai=NS(require_read=lambda: None, ask=summary or _no_ai),
        db=NS(read=read),
        store=NS(get_messages_by_ids=lambda chat, ids: ([], ""), is_tracking=lambda chat: tracked),
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
    assert "<untrusted_link_content>" in asked[0][0] and asked[0][1]["feature"] == "links"
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
