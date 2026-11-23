"""Hỏi bạn trong bình luận: open tickets with a comment asking me that I have not answered yet (no comment of mine
after it). Every comment since my last one counts, not only the latest: someone chiming in after the question does
not hide it."""

import re
import time
from datetime import UTC, datetime

from .client import COMMENTS, FIELDS, YtClient, YtError, _me, _normalize, live

RECENT_DAYS = 30  # asks older than this are not looked for
TOP = 300
# "PO" / "PM" / "product owner" (as Briefing's "Cần bạn"), not "POST" / "PMS" nor a time ("3 PM")
PO_RE = re.compile(r"(?<!\w)(?<!\d\s)(po|pm|product owner)(?!\w)", re.I)
# a request word next to the PO ("cần PO …", "PO ơi"), not one anywhere in a report ("PO đã chốt, không cần sửa")
PO_ASK_RE = re.compile(r"(?<!\w)((cần|nhờ|chờ|đợi|hỏi|xin|mời|ping)\s+(po|pm|product owner)"
                       r"|(po|pm|product owner)\s*,?\s*(ơi|giúp|giùm|please|pls))(?!\w)", re.I)  # fmt: skip


def asks_po(text: str) -> bool:
    """A line asks the PO / PM: a question naming them, or a request word next to them. A bare "PO" in a report or
    a decision ("linhlh chốt thay PO") does not count."""
    return any((PO_RE.search(line) and "?" in line) or PO_ASK_RE.search(line) for line in text.splitlines())


def asks_me(text: str, login: str | None, name: str | None, po: bool) -> bool:
    """A comment tags my @login, names me, or (`po`) asks the PO / PM."""
    low = text.lower()
    return bool((login and f"@{login.lower()}" in low) or (name and name.lower() in low) or (po and asks_po(text)))


def pending_ask(comments: list[dict], login: str | None, name: str | None, po: bool) -> dict | None:
    """The newest comment by someone else, after my last comment, that asks me; None when there is none."""
    def mine(c):
        a = c.get("author") or {}
        return (login and a.get("login") == login) or (name and a.get("fullName") == name)

    since = max((c.get("created") or 0 for c in comments if mine(c)), default=0)
    asks = [c for c in comments if (c.get("created") or 0) > since and not mine(c)
            and asks_me(c.get("text") or "", login, name, po)]  # fmt: skip
    return max(asks, key=lambda c: c.get("created") or 0, default=None)


async def asked(svc: YtClient, project: str, po: bool) -> list[dict]:
    """[{ticket, ask: {text, created, author}}], the newest ask first. Keyed "issues:…": a write here (my comment)
    drops it with the ticket lists (stale)."""
    me = await svc.cached("me", lambda: _me(svc))
    if not me.get("login") and not me.get("name"):
        return []  # no identity: nothing can ask "me"

    async def read():
        day = datetime.fromtimestamp(time.time() - RECENT_DAYS * 86400, UTC).date().isoformat()

        def find(when: str):
            q = f"project: {{{project}}} #Unresolved {when}: {day} .. Today sort by: updated desc"
            return svc.yt("/api/issues", query=q, fields=f"{FIELDS},{COMMENTS}",
                          **{"$top": TOP})  # fmt: skip

        try:
            rows = await find("commented")  # only tickets commented on lately: far fewer than every updated one
        except YtError as e:
            if e.status != 400:
                raise
            rows = await find("updated")  # a YouTrack whose search has no "commented:": every ticket updated lately
        out = []
        for d in rows:
            c = pending_ask(live(d.get("comments")), me.get("login"), me.get("name"), po)
            if c:
                a = c.get("author") or {}
                ask = {"text": (c.get("text") or "")[:600], "created": c.get("created"),
                       "author": a.get("fullName") or a.get("login")}  # fmt: skip
                out.append({"ticket": _normalize(d), "ask": ask})
        return sorted(out, key=lambda x: -(x["ask"]["created"] or 0))

    return await svc.cached(f"issues:asked:{project}:{int(po)}", read)
