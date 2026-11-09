"""Q&A: questions posted from the dashboard (text, then a "#QA…" line) and the reply chains under them."""

import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from .models import StoredMessage

_CODE = re.compile(r"#QA(\d+)\b", re.IGNORECASE)
_EPOCH = datetime(2026, 1, 1, tzinfo=UTC)


def qa_code(now: datetime) -> str:
    """#QA27012345: seconds since 2026, known before sending (the question's own id is not). Digits only, so Telegram
    makes it a hashtag and tapping it lists the thread."""
    return f"#QA{int((now - _EPOCH).total_seconds())}"


def names_code(text: str) -> bool:
    return bool(_CODE.search(text))


_TAG = re.compile(r"(?<![\w.])@[A-Za-z0-9_]{5,32}")  # a Telegram @username, not an e-mail address


def has_tag(text: str) -> bool:
    """Tags someone: only such a message opens a Q&A (an untagged one goes out as a plain message)."""
    return bool(_TAG.search(text)) or "](tg://user?id=" in text  # or a tag by name (split_mentions)


Fetch = Callable[[list[int]], Awaitable[list[StoredMessage]]]


async def chain_code(fetch: Fetch, mid: int, hops: int = 10) -> str | None:
    """The "#QA…" code of the thread a message sits in, found up its reply chain (the message itself first): answering
    with Q&A a reply to an existing question then answers in that thread instead of opening a second one.
    ponytail: one Telegram read per hop, only on such sends; `hops` caps a deep chain."""
    for _ in range(hops):
        m = next(iter(await fetch([mid])), None)
        if m is None:
            return None
        if found := _CODE.search(m.text):
            return f"#QA{found[1]}"
        if not m.reply_to_id:
            return None
        mid = m.reply_to_id
    return None


def find_threads(msgs: list[StoredMessage]) -> list[tuple[str, list[StoredMessage]]]:
    """Threads in `msgs`, each oldest first: it starts at the first message naming a #QA code and takes every message
    naming that code or replying, down any chain, to one already in it (ask → answer → follow-up → answer...). A code
    first named in a reply (someone asked, you answered with Q&A) puts the message it replies to first: the question."""
    live = sorted((m for m in msgs if not m.deleted), key=lambda m: m.message_id)  # a reply comes after its target
    by_id = {m.message_id: m for m in live}
    threads: dict[str, list[StoredMessage]] = {}
    owner: dict[int, str] = {}  # message id -> its thread's code
    for m in live:
        codes = _CODE.findall(m.text)
        code = next((c for c in codes if c in threads), None) or owner.get(m.reply_to_id) or next(iter(codes), None)
        if not code:
            continue
        if code not in threads and (q := by_id.get(m.reply_to_id)) and q.message_id not in owner:
            threads[code] = [q]
            owner[q.message_id] = code
        threads.setdefault(code, []).append(m)
        owner[m.message_id] = code
    return [(f"#QA{c}", ms) for c, ms in threads.items()]


if __name__ == "__main__":

    def msg(mid, text, reply=None):
        return StoredMessage(chat_id="-1", message_id=mid, sender_id="1", sender_name="U", text=text,
                             date=datetime.now(UTC), reply_to_id=reply)  # fmt: skip

    found = find_threads([
        msg(1, "API login lỗi 500?\n#QA11"), msg(2, "ok"), msg(3, "Bị từ hôm qua", 1), msg(4, "log đâu?", 3),
        msg(5, "đây", 4), msg(6, "Deploy?\n#QA22"), msg(7, "rồi nhé #qa22"), msg(8, "lạc đề", 2),
        msg(9, "A hỏi: staging đâu?"), msg(10, "đây nhé\n#QA33", 9), msg(11, "cảm ơn", 10), msg(12, "#QA44 lại", 1),
    ])  # fmt: skip
    got = [(c, [m.message_id for m in ms]) for c, ms in found]
    assert got == [("#QA11", [1, 3, 4, 5, 12]), ("#QA22", [6, 7]), ("#QA33", [9, 10, 11])], got  # 12: stays
    assert qa_code(datetime(2026, 1, 1, 0, 1, tzinfo=UTC)) == "#QA60"
    assert has_tag("@minh_be xem giúp") and has_tag("hỏi @MinhBE nhé")
    assert has_tag("hỏi [Minh](tg://user?id=42) nhé")
    assert not has_tag("mail a.b@citics.vn") and not has_tag("@abc ngắn") and not has_tag("không tag ai")
    print("ok")
