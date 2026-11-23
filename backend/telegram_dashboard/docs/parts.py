"""Document text -> searchable parts, ticket ids and accent-safe snippets (the doc library's text rules)."""

import re
from difflib import SequenceMatcher

from ..storage.common import fold

MAX_CHARS = 200_000  # per document, saved or not: untrusted text fed to an agent that may run shell
PART_MAX = 4000  # a heading section longer than this is cut into blocks
BLOCK = 2000
# A ticket named without a link ("VA-123", not inside a URL or an article ID).
BARE = re.compile(r"(?<![\w/-])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?!\w)")
_HEADING = re.compile(r"#{1,4}\s+\S")
REV_LINES = 80  # changed lines kept per update; the rest is counted in "more"
REV_LINE_CHARS = 300


def tickets_of(text: str) -> list[str]:
    return list(dict.fromkeys(BARE.findall(text)))


def _pieces(lines: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Paragraphs (blank-line separated) as (first line, text); one longer than BLOCK is cut by line."""
    paras, cur = [], []
    for n, line in [*lines, (0, "")]:
        if line.strip():
            cur.append((n, line))
        elif cur:
            paras.append(cur)
            cur = []
    out = []
    for p in paras:
        if sum(len(t) + 1 for _, t in p) <= BLOCK:
            out.append((p[0][0], "\n".join(t for _, t in p)))
            continue
        start, buf = p[0][0], ""
        for n, t in p:
            for k in range(0, len(t), BLOCK):  # a single line longer than BLOCK is cut by characters
                seg = t[k : k + BLOCK]
                if buf and len(buf) + 1 + len(seg) > BLOCK:
                    out.append((start, buf))
                    start, buf = n, ""
                buf = f"{buf}\n{seg}" if buf else seg
                if len(seg) == BLOCK:
                    out.append((start, buf))
                    start, buf = n, ""
        if buf:
            out.append((start, buf))
    return out


def _blocks(lines: list[tuple[int, str]]) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for n, text in _pieces(lines):
        if out and len(out[-1][1]) + 2 + len(text) <= BLOCK:
            out[-1] = (out[-1][0], f"{out[-1][1]}\n\n{text}")
        else:
            out.append((n, text))
    return out


def split_parts(text: str) -> list[tuple[int, str, str]]:
    """(first line from 1, heading or "", body). Headings # to #### outside code fences start a part (the rule of
    links._outline); a part over PART_MAX, or a text without headings, is cut into blocks of paragraphs <= BLOCK."""
    sections: list[tuple[int, str, list[tuple[int, str]]]] = [(1, "", [])]
    fence = False
    for n, line in enumerate(text.split("\n"), 1):
        if line.lstrip().startswith("```"):
            fence = not fence
        elif not fence and _HEADING.match(line):
            sections.append((n, line.strip(), []))
            continue
        sections[-1][2].append((n, line))
    parts = []
    for n, head, lines in sections:
        body = "\n".join(t for _, t in lines).strip()
        if not body and not head:
            continue
        if len(body) <= PART_MAX and (head or len(body) <= BLOCK):
            parts.append((n if head else next((i for i, t in lines if t.strip()), n), head, body))
        else:
            parts.extend((i, head, b) for i, b in _blocks(lines))
    return parts


_BR = re.compile(r"<br\s*/?>", re.I)


def snippet(text: str, q: str, width: int = 200) -> tuple[str, list[tuple[int, int]]]:
    """Original text (accents kept) of `width` chars around the first hit of a word of `q`, and the (start, end)
    ranges of the hits in the returned string. Matching is on fold(), which can change the length, so a map from
    folded to original positions is built per character. `<br>` (a line break in a YouTrack table cell) reads as
    a space."""
    text = _BR.sub(" ", text)
    folded, pos = [], []
    for i, ch in enumerate(text):
        f = fold(ch)
        folded.append(f)
        pos.extend([i] * len(f))
    flat = "".join(folded)
    words = [w for w in fold(q).split() if w]
    hits = [(m.start(), m.end()) for w in words for m in re.finditer(re.escape(w), flat)]
    if not hits:
        return text[:width], []
    first = min(h[0] for h in hits)
    a = max(0, pos[first] - width // 4)
    b = min(len(text), a + width)
    marks: list[tuple[int, int]] = []
    for s, e in sorted(hits):
        s0, e0 = pos[s], pos[e - 1] + 1
        if s0 >= a and e0 <= b:
            if marks and s0 - a < marks[-1][1]:
                marks[-1] = (marks[-1][0], max(marks[-1][1], e0 - a))
            else:
                marks.append((s0 - a, e0 - a))
    return text[a:b], marks


def _lines(parts: list[tuple[int, str, str]]) -> tuple[list[str], list[str]]:
    """The non-blank lines of `parts` and the heading each sits under; a heading counts once, where its section
    starts. Parts drop blank lines, so a file's old text (gone from disk) and the new one compare alike."""
    texts, heads, last = [], [], None
    for _, head, body in parts:
        if head and head != last:
            texts.append(head)
            heads.append(head)
        last = head
        for line in body.split("\n"):
            if line.strip():
                texts.append(line.rstrip())
                heads.append(head)
    return texts, heads


def changes(old: list[tuple[int, str, str]], new: list[tuple[int, str, str]]) -> dict | None:
    """What an update changed, line by line: {"blocks": [{"heading", "removed", "added", "at"}], "more": lines left out
    past REV_LINES}; None when only blank lines / trailing spaces moved. `at`: where the block's first change sits in
    the new text, as an index into its _lines (the reader finds the line there: docs/components/diff-mark.tsx)."""
    a, ha = _lines(old)
    b, hb = _lines(new)
    blocks: list[dict] = []
    kept = more = 0
    for op, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        head = hb[j1] if j1 < j2 else ha[i1]
        got = {}
        for key, lines in (("removed", a[i1:i2]), ("added", b[j1:j2])):
            room = max(0, REV_LINES - kept)
            got[key] = [x[:REV_LINE_CHARS] for x in lines[:room]]
            kept += len(got[key])
            more += len(lines) - len(got[key])
        if not (got["removed"] or got["added"]):
            continue
        if blocks and blocks[-1]["heading"] == head:
            blocks[-1]["removed"] += got["removed"]
            blocks[-1]["added"] += got["added"]
        else:
            blocks.append({"heading": head, **got, "at": j1})
    return {"blocks": blocks, "more": more} if blocks or more else None


if __name__ == "__main__":  # self-check of changes()
    old = split_parts("# Quy trình\n\nBước 1\nBước 2\n\n## Hạn\n\n3 ngày")
    new = split_parts("# Quy trình\n\nBước 1\nBước 2 (sửa)\n\n\n## Hạn\n\n3 ngày\n5 ngày nếu lễ")
    assert changes(old, new) == {
        "blocks": [
            {"heading": "# Quy trình", "removed": ["Bước 2"], "added": ["Bước 2 (sửa)"], "at": 2},
            {"heading": "## Hạn", "removed": [], "added": ["5 ngày nếu lễ"], "at": 5},
        ],
        "more": 0,
    }, changes(old, new)
    assert changes(old, split_parts("# Quy trình\n\nBước 1  \n\n\nBước 2\n\n## Hạn\n\n3 ngày")) is None
    print("ok")
