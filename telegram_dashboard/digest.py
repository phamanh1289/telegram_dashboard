"""Digest: structured AI summary of a group conversation, read live from Telegram.

Separate from tag drafts: it needs a chat-wide consent (digest_consents) and never touches
handled state. Messages are never stored; only the latest result and
how far digests have read (digests), both dropped with the consent.
"""

import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from .ai import AiService, about_user, data_json, json_object
from .errors import ApiError
from .models import DigestRequest, DigestResult, StoredMessage
from .storage import Db, Store, _dt

MAX_MESSAGES = 250  # per AI call
MAX_CHARS = 40_000  # per AI call: smaller parts finish well inside the timeout
MAX_RUN = 2_000  # per digest: a longer stretch is read in calls of ≤ MAX_MESSAGES / MAX_CHARS
MAX_CALLS = 8
OWN = ("message_ids", "tickets", "be", "at", "carried")  # set by us, never taken as text from the model
KEYS = ("topics", "decisions", "changes", "impacts", "confirmations", "actions")
OPEN = ("confirmations", "actions")  # what still waits on someone: kept until a later digest settles it
CARRY_DAYS = 30  # ponytail: an open item nobody settled in a month drops off; a "closed" store if that misses things
MAX_CARRY = 60
STATUSES = ("decided", "open", "dropped")
TICKET = re.compile(r"^[A-Za-z][A-Za-z0-9]*-\d+$")
log = logging.getLogger(__name__)
VN = ZoneInfo("Asia/Ho_Chi_Minh")  # what the UI shows; the server's own zone may be UTC

TASK = """Analyze the group conversation in <messages>: a work chat where several subjects are \
mixed together without topics.
Return ONLY one JSON object (no prose, no code fence) with these keys, each a list:
- "topics": [{"title", "summary", "status": "decided"|"open"|"dropped", "message_ids"}]
- "decisions": [{"text", "who", "message_ids"}] - what was agreed or finalized; who = who decided
- "changes": [{"text", "message_ids"}] - changes to scope, spec, API, design, deadline or plan
- "impacts": [{"who", "text", "message_ids"}] - who = affected team; text = what changes for them
- "confirmations": [{"text", "who", "message_ids"}] - open questions someone (often the PO/PM) \
must confirm; who = who must answer
- "actions": [{"text", "who", "due", "message_ids"}] - who = owner, due = deadline if stated
Rules: group scattered messages into topics by subject, using reply_to, timing and speakers. \
Every item cites the ids of ALL messages it is based on (the question, the discussion and \
the message that settled it), and also has "why": 1-2 sentences of context a reader who missed \
the chat needs - the problem behind it and how the conclusion was reached (who proposed, who \
agreed, quoting the deciding message when short). "text" must make sense on its own: name the \
subject (feature, screen, module, API), not only the verdict. Every item and topic also has \
"tickets": the YouTrack ticket ids (like ABC-123) named in those messages, else []. Every item \
(not topic) has "be": true when it is a question to, an answer from or an agreement with the \
backend (BE) team (API, endpoint, request / response field, data, DB, server logic), else false, and \
"topic": the exact "title" of the topic it belongs to. Never invent \
facts: leave a field empty or drop the item when unsure; empty lists are fine. Write every text \
in Vietnamese, short and concrete."""

CARRY = """
<open> lists items still open from earlier in this chat (key "p1", "p2"…); their messages are older than \
<messages>, which may answer them (a reply_to may point at one of their message_ids). Add a key "resolved": \
the keys of <open> items that <messages> settles (answered, confirmed, done or cancelled); report what settled \
them in "decisions" / "changes" as usual. Never repeat an <open> item in "confirmations" / "actions"."""

ASK = """<briefing> holds the latest AI digests of the user's work groups (JSON per group: \
decisions, changes, impacts, confirmations = open questions, actions = to-dos, topics). Answer \
the user's question from them only; say so when they do not cover it, never invent. Write in \
Vietnamese markdown, short and scannable: bullets, the group name in bold before each point, \
the most urgent first (what waits on the user, deadlines, blockers)."""


def aware(d: datetime | None) -> datetime | None:
    return None if d is None else d if d.tzinfo else d.replace(tzinfo=UTC)


def _text(m: StoredMessage) -> str:
    if not m.media_kind:
        return m.text
    tag = "[ảnh]" if m.media_kind == "photo" else "[file]"
    return f"{tag} {m.text}".strip()


def _num(n: int) -> str:
    return f"{n:,}".replace(",", ".")  # Vietnamese grouping: 80.000


def _field(v) -> str:
    return ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)


def parse_result(text: str, ids: set[str]) -> dict | None:
    """The model's JSON object, cleaned: unknown ids dropped, fields coerced to strings.
    None (show it raw) when no JSON object can be read or it uses none of our keys."""
    data = json_object(text)
    if data is None or (data and not set(data) & {*KEYS, "resolved"}):
        return None
    out: dict = {}
    for key in KEYS:
        items = data.get(key)
        rows = []
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict):
                continue
            row = {k: _field(v) for k, v in it.items() if k not in OWN and v is not None}
            if key != "topics":
                row["be"] = it.get("be") is True
            tix = it.get("tickets")
            row["tickets"] = list(dict.fromkeys(
                t.upper() for t in (tix if isinstance(tix, list) else []) if isinstance(t, str) and TICKET.match(t)
            ))  # fmt: skip
            refs = it.get("message_ids")
            refs = [str(i) for i in refs] if isinstance(refs, list) else []
            row["message_ids"] = list(dict.fromkeys(i for i in refs if i in ids))
            if key == "topics" and row.get("status") not in STATUSES:
                row["status"] = "open"
            rows.append(row)
        out[key] = rows
    done = data.get("resolved")
    out["resolved"] = [str(k) for k in done] if isinstance(done, list) else []
    return out


def _chunks(msgs: list[StoredMessage]) -> list[list[StoredMessage]]:
    """Consecutive stretches of ≤ MAX_MESSAGES / MAX_CHARS (each message fits one: checked before)."""
    out, cur, size = [], [], 0
    for m in msgs:
        n = len(_text(m))
        if cur and (len(cur) >= MAX_MESSAGES or size + n > MAX_CHARS):
            out.append(cur)
            cur, size = [], 0
        cur.append(m)
        size += n
    return [*out, cur] if cur else out


def _carry(prev: dict | None, seen: set[str], closed: set[str]) -> list[tuple[str, dict]]:
    """Open items of the saved digest, as (key, item), that this run does not read again (it re-judges those) and
    the user has not closed (`closed`: their joined message ids, as Briefing keys its ticks)."""
    if prev is None:
        return []
    res = DigestResult.model_validate_json(prev["result"])
    made, old = _dt(prev["created_at"]), datetime.now(UTC) - timedelta(days=CARRY_DAYS)
    out = []
    for key in OPEN:
        for it in getattr(res, key):
            at = aware(it.at) or made
            if at >= old and not set(it.message_ids) & seen and ",".join(it.message_ids) not in closed:
                out.append((key, it.model_dump() | {"at": at, "carried": True}))
    return out[-MAX_CARRY:]


class DigestService:
    def __init__(self, settings, store: Store, db: Db, bridge, ai: AiService):
        self.settings = settings
        self.store = store
        self.db = db
        self.bridge = bridge
        self.ai = ai

    async def _consented(self, chat_id: str) -> bool:
        return await self.db.read(self.store.get_digest_consent, chat_id) is not None

    async def run(self, req: DigestRequest) -> DigestResult:
        if not self.ai.configured:
            raise ApiError(503, "ai_not_configured")
        if await self.db.read(self.store.get_chat, req.chat_id) is None:
            raise ApiError(404, "chat_not_found")
        if not await self._consented(req.chat_id):
            raise ApiError(403, "digest_consent_required")
        since, until = aware(req.since), aware(req.until) or datetime.now(UTC)
        # Messages always come from Telegram here, never from text the client sent.
        if req.message_ids:
            try:
                ids = sorted({int(i) for i in req.message_ids})
            except ValueError:
                raise ApiError(422, "digest_empty") from None
            if not ids or ids[0] < 1 or ids[-1] >= 2**31:  # Telegram ids are int32
                raise ApiError(422, "digest_empty")
            msgs = await self.bridge.fetch_ids(req.chat_id, ids)
            since = until = None
        elif since is not None:
            msgs = await self.bridge.fetch_range(req.chat_id, since, until, MAX_RUN + 1)
            if req.after_id is not None:  # `since` has 1s precision: the boundary would repeat
                msgs = [m for m in msgs if m.message_id > req.after_id]
        else:
            msgs = []
        too_many = len(msgs) > MAX_RUN  # before filtering: the range itself is too long
        msgs = [m for m in msgs if m.chat_id == req.chat_id and not m.deleted and _text(m)]
        if not msgs:
            raise ApiError(422, "digest_empty")
        chars = sum(len(_text(m)) for m in msgs)
        big = max(len(_text(m)) for m in msgs)
        chunks = [] if too_many or big > MAX_CHARS else _chunks(msgs)
        if not chunks or len(chunks) > MAX_CALLS:
            why = (f"hơn {_num(MAX_RUN)} tin" if too_many else f"một tin dài {_num(big)} ký tự" if big > MAX_CHARS
                   else f"{_num(chars)} ký tự")  # fmt: skip
            raise ApiError(
                422, "digest_too_large",
                detail=f"Khoảng này có {why} (tối đa {_num(MAX_RUN)} tin, {_num(MAX_CHARS)} ký tự mỗi lượt AI, "
                f"{MAX_CALLS} lượt); hãy thu hẹp khoảng thời gian hoặc chọn bớt tin.",
            )  # fmt: skip
        # Open items of the last digest ride along until a run settles them: a busy chat never drops a question.
        # A long stretch is read in parts the same way: each part gets what the earlier parts left open.
        prev = await self.db.read(self.store.get_digest, req.chat_id)
        pending = _carry(prev, {str(m.message_id) for m in msgs}, set(req.closed)) if req.save else []
        out: dict[str, list] = {k: [] for k in KEYS}
        raws = []
        for part in chunks:
            text, parsed = await self._ask(req, part, pending)
            if parsed is None:  # unreadable: nothing is known to be settled, so everything open stays
                raws.append(text)
                continue
            done = set(parsed.pop("resolved"))
            pending = [p for i, p in enumerate(pending, 1) if f"p{i}" not in done]
            dates = {str(m.message_id): m.date for m in part}
            for key in KEYS:
                if key not in OPEN:
                    out[key] += parsed[key]
                    continue
                for row in parsed[key]:
                    row["at"] = min((dates[i] for i in row["message_ids"]), default=part[-1].date)
                    pending.append((key, row))
        for key, row in pending:
            out[key].append(row)
        result = DigestResult(
            **out,
            raw="\n\n".join(raws),
            source_count=len(msgs),
            since=since,
            until=until,
        )
        newest = max(msgs, key=lambda m: m.message_id)
        # consent re-checked (for a save, in its own transaction): a revoke during the AI run drops the result
        if not (await self.db.write(
            self.store.save_consented_digest, req.chat_id, newest.message_id, newest.date, result.model_dump_json(),
        ) if req.save else await self._consented(req.chat_id)):  # fmt: skip
            raise ApiError(
                409, "ai_permission_changed",
                detail="Quyền đã đổi trong lúc xử lý; kết quả bị bỏ. "
                "Dữ liệu đã gửi provider không thể thu hồi.",
            )  # fmt: skip
        return result

    async def _ask(self, req: DigestRequest, part: list[StoredMessage], pending: list[tuple[str, dict]]):
        """One AI call over `part`, with the items still open before it: (text, parsed or None)."""
        context = [
            {
                "id": str(m.message_id),
                "at": m.date.astimezone(VN).strftime("%d/%m %H:%M"),
                "from": "me" if m.outgoing else (m.sender_name or "?"),
                **({"reply_to": str(m.reply_to_id)} if m.reply_to_id else {}),
                "text": _text(m),
            }
            for m in part
        ]
        prompt = TASK
        if teams := [t.strip() for t in req.teams if t.strip()]:
            prompt += f'\nTeams for "impacts.who" (use only these names): {", ".join(teams)}.'
        prompt += about_user(req.intro)
        if pending:
            rows = [{"key": f"p{i}", "kind": "confirm" if key == "confirmations" else "action",
                     **{f: it[f] for f in ("text", "who", "due", "message_ids") if it.get(f)}}
                    for i, (key, it) in enumerate(pending, 1)]  # fmt: skip
            prompt += f"{CARRY}\n<open>\n{data_json(rows)}\n</open>"
        prompt += f"\n<messages>\n{data_json(context)}\n</messages>"
        text = await self.ai.ask(prompt, feature="digest", brief=True)
        return text, parse_result(text, {c["id"] for c in context})

    async def ask(self, question: str, intro: str = "", on_text=None) -> str:
        """A question about every consented group's saved digest (the AI's own earlier output, no
        new messages are read)."""
        if not self.ai.configured:
            raise ApiError(503, "ai_not_configured")
        rows = await self.db.read(self.store.briefing_rows)
        data = []
        for r in rows:
            if not (r["consent"] and r["digest"]):
                continue
            res = DigestResult.model_validate_json(r["digest"]["result"])
            keep = res.model_dump(mode="json", include=set(KEYS), exclude_defaults=True)
            at = _dt(r["digest"]["created_at"]).astimezone(VN).strftime("%d/%m %H:%M")
            data.append({"group": r["title"], "summarized_at": at, **keep})
        if not data:
            raise ApiError(422, "briefing_empty")
        prompt = ASK + about_user(intro)
        prompt += f"\n<briefing>\n{data_json(data)}\n</briefing>\n\nCâu hỏi: {question}"
        return await self.ai.ask(prompt, on_text=on_text, feature="briefing", brief=True)

    async def answered(self) -> dict[str, list[str]]:
        """Per consented group: the ids its latest digest cites under "Cần confirm" / "Việc cần làm"
        that I have since replied to on Telegram (a reply_to from me, sent here or in Telegram)."""
        if self.bridge.state != "connected":
            return {}
        live = asyncio.Semaphore(4)
        now = datetime.now(UTC)

        async def one(r: dict) -> tuple[str, list[str]]:
            res = DigestResult.model_validate_json(r["digest"]["result"])
            items = [it for k in OPEN for it in getattr(res, k)]
            cited = {i for it in items for i in it.message_ids}
            if not cited:
                return r["chat_id"], []
            since = aware(res.since) or _dt(r["digest"]["last_date"]) - timedelta(days=7)
            since = min([since, *(aware(it.at) for it in items if it.at)])  # carried items were asked earlier
            try:
                async with live:
                    msgs = await self.bridge.fetch_range(r["chat_id"], since, now, MAX_MESSAGES)
            except Exception as e:  # one unreachable group must not hide the others
                log.warning("answered: %s unread: %r", r["chat_id"], e)
                return r["chat_id"], []
            mine = {str(m.reply_to_id) for m in msgs if m.outgoing and m.reply_to_id}
            return r["chat_id"], sorted(mine & cited)

        rows = [r for r in await self.db.read(self.store.briefing_rows) if r["consent"] and r["digest"]]
        return dict(await asyncio.gather(*(one(r) for r in rows)))
