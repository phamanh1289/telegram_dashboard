import zipfile

import pytest
from telegram_dashboard.docs.extract import read_text
from telegram_dashboard.docs.parts import BLOCK, MAX_CHARS, snippet, split_parts, tickets_of


def test_headings_make_parts_with_their_line():
    assert split_parts("# A\nx\n\n## B\ny") == [(1, "# A", "x"), (4, "## B", "y")]


def test_text_before_first_heading_is_a_part_without_heading():
    assert split_parts("intro\n# A\nx") == [(1, "", "intro"), (2, "# A", "x")]


def test_no_heading_is_cut_into_blocks():
    parts = split_parts("\n\n".join(["đoạn " * 100] * 20))
    assert len(parts) > 1 and all(len(b) <= BLOCK and h == "" for _, h, b in parts)


def test_heading_inside_a_code_fence_is_not_a_part():
    parts = split_parts("# A\n```\n# not a heading\n```\nz")
    assert [h for _, h, _ in parts] == ["# A"] and "# not a heading" in parts[0][2]


def test_one_paragraph_longer_than_a_block_is_cut_by_line():
    lines = [f"dòng {i} " + "x" * 90 for i in range(60)]
    parts = split_parts("\n".join(lines))
    assert len(parts) > 1 and all(len(b) <= BLOCK for _, _, b in parts)
    assert parts[1][0] > 1 and "\n".join(b for _, _, b in parts) == "\n".join(lines)


def test_long_section_keeps_its_heading_on_every_block():
    parts = split_parts("## H\n" + "\n\n".join(["a" * 900] * 10))
    assert len(parts) > 1 and {h for _, h, _ in parts} == {"## H"}


def test_tickets_unique_in_order():
    assert tickets_of("VA-12 and CA-3, VA-12 again, https://x/issue/ZZ-9") == ["VA-12", "CA-3"]


def test_snippet_keeps_accents_and_marks_the_words():
    text, marks = snippet("Điều kiện giải ngân khoản vay", "giai ngan")
    assert [text[a:b] for a, b in marks] == ["giải", "ngân"]


def test_snippet_window_and_marks_are_relative_to_returned_text():
    body = "x" * 500 + " Đơn vị cho vay " + "y" * 500
    text, marks = snippet(body, "don vi", width=60)
    assert len(text) <= 60 and [text[a:b] for a, b in marks] == ["Đơn", "vị"]


def test_snippet_without_match_is_the_start():
    assert snippet("abc def", "zzz") == ("abc def", [])


def _docx(path, paras):
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paras)
    xml = f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", xml)


def test_docx_text(tmp_path):
    _docx(tmp_path / "a.docx", ["một", "hai"])
    assert read_text(tmp_path / "a.docx") == "một\nhai"


def test_binary_and_broken_docx_raise(tmp_path):
    (tmp_path / "a.md").write_bytes(b"\xff\xfe\x00")
    with pytest.raises(ValueError, match="not_text"):
        read_text(tmp_path / "a.md")
    (tmp_path / "b.docx").write_bytes(b"not a zip")
    with pytest.raises(ValueError, match="bad_docx"):
        read_text(tmp_path / "b.docx")
    (tmp_path / "c.pdf").write_bytes(b"x")
    with pytest.raises(ValueError, match="unsupported"):
        read_text(tmp_path / "c.pdf")


def test_long_file_is_cut_with_a_note(tmp_path):
    (tmp_path / "a.txt").write_text("x" * (MAX_CHARS + 50), encoding="utf-8")
    out = read_text(tmp_path / "a.txt")
    assert out.startswith("x" * MAX_CHARS) and out.endswith(f"(… bị cắt ở {MAX_CHARS} ký tự)")


def test_a_big_text_file_is_read_only_up_to_the_cut(tmp_path, monkeypatch):
    from telegram_dashboard.docs import extract

    monkeypatch.setattr(extract, "MAX_CHARS", 10)
    (tmp_path / "a.md").write_bytes(b"x" * 10_000)
    assert read_text(tmp_path / "a.md") == "x" * 10 + "\n\n(… bị cắt ở 10 ký tự)"
    # 41 bytes read (10 * 4 + 1) end inside "é": that tail is dropped, the file is still text
    (tmp_path / "b.md").write_bytes(("ab" + "é" * 100).encode())
    assert read_text(tmp_path / "b.md").startswith("abéééééééé\n\n(… bị cắt")
    (tmp_path / "c.md").write_bytes(b"ab\xff" + b"x" * 100)  # a bad byte before the cut is still not text
    with pytest.raises(ValueError, match="not_text"):
        read_text(tmp_path / "c.md")
