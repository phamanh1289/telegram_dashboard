"""Links in a task prompt that the agent cannot open itself (no web, no tokens, no Telegram session):
YouTrack Knowledge Base articles and private Telegram message links. The dashboard reads them with
its own YouTrack token and Telegram session and appends their text to the prompt."""

import logging
import re
from urllib.parse import urlsplit

log = logging.getLogger("telegram_dashboard.links")

ARTICLE = re.compile(r"https?://([^\s/]+)\S*?/articles/([A-Za-z][\w]*-A-\d+)")
TG = re.compile(r"https?://t\.me/c/(\d+)/(?:\d+/)?(\d+)")  # /c/<chat>/<msg> or /c/<chat>/<topic>/<msg>
MAX_LINKS = 10
MAX_CHARS = 8000  # per link


async def _article(yt, host: str, aid: str) -> str | None:
    if not yt.token or urlsplit(yt.base).hostname != host:  # another YouTrack: our token isn't for it
        return None
    a = await yt.yt(f"/api/articles/{aid}", fields="idReadable,summary,content")
    return f"# {a.get('idReadable', aid)} {a.get('summary') or ''}\n\n{a.get('content') or ''}"


async def _telegram(s, chat: str, mid: int) -> str | None:
    s.ai.require_read()  # consent mode: no AI reads Telegram text
    chat_id = f"-100{chat}"
    msgs = (await s.db.read(s.store.get_messages_by_ids, chat_id, [mid]))[0]
    if not msgs:
        msgs = await s.bridge.fetch_ids(chat_id, [mid])
    if not msgs:
        return None
    m = msgs[0]
    return f"{m.sender_name or m.sender_id or '?'} ({m.date:%Y-%m-%d %H:%M}):\n{m.text}"


async def expand(s, text: str) -> str:
    """`text` plus a block with each readable link's content; a link that fails is listed as such,
    so the agent says so instead of trying to fetch it."""
    found = [(m.group(0), "yt", m.groups()) for m in ARTICLE.finditer(text)]
    found += [(m.group(0), "tg", m.groups()) for m in TG.finditer(text)]
    if not found:
        return text
    parts = []
    for url, kind, g in list({u: (u, k, g) for u, k, g in found}.values())[:MAX_LINKS]:
        try:
            body = await (_article(s.yt, *g) if kind == "yt" else _telegram(s, g[0], int(g[1])))
        except Exception as e:  # noqa: BLE001 — one bad link never blocks the task
            log.info("link %s not read: %s", url, type(e).__name__)
            body = None
        parts.append(f"## {url}\n\n" + (body[:MAX_CHARS] if body else "(dashboard không đọc được link này)"))
    return text + "\n\n---\nNội dung các link (dashboard đã tải sẵn, không cần mở lại):\n\n" + "\n\n".join(parts)


if __name__ == "__main__":  # self-check of the link patterns
    t = "xem https://works.citics.vn/articles/VA-A-134 và https://t.me/c/1234/273/39671, https://t.me/c/1234/5"
    assert [m.groups() for m in ARTICLE.finditer(t)] == [("works.citics.vn", "VA-A-134")]
    assert [m.groups() for m in TG.finditer(t)] == [("1234", "39671"), ("1234", "5")]
    print("ok")
