"""Digest: structured AI summary of a group conversation, read live from Telegram.

Separate from tag drafts: it needs a chat-wide consent (digest_consents) and never touches
per-message grants or handled state. Messages are never stored; only the latest result and
how far digests have read (digests), both dropped with the consent.
"""

import json
import re
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from .ai import AiService, data_json
from .errors import ApiError
from .models import DigestRequest, DigestResult, StoredMessage
from .storage import Db, Store

MAX_MESSAGES = 400
MAX_CHARS = 80_000
KEYS = ("topics", "decisions", "changes", "impacts", "confirmations", "actions")
STATUSES = ("decided", "open", "dropped")
TICKET = re.compile(r"^[A-Za-z][A-Za-z0-9]*-\d+$")
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
Every item cites the ids of the messages it is based on, and every item and topic also has \
"tickets": the YouTrack ticket ids (like ABC-123) named in those messages, else []. Never invent facts: leave a field empty \
or drop the item when unsure; empty lists are fine. Write every text in Vietnamese, short and \
concrete."""


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
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return None
    if not isinstance(data, dict) or (data and not set(data) & set(KEYS)):
        return None
    out: dict = {}
    for key in KEYS:
        items = data.get(key)
        rows = []
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict):
                continue
            row = {k: _field(v) for k, v in it.items() if k not in ("message_ids", "tickets") and v is not None}
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
    return out


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
            msgs = await self.bridge.fetch_range(req.chat_id, since, until, MAX_MESSAGES + 1)
            if req.after_id is not None:  # `since` has 1s precision: the boundary would repeat
                msgs = [m for m in msgs if m.message_id > req.after_id]
        else:
            msgs = []
        too_many = len(msgs) > MAX_MESSAGES  # before filtering: the range itself is too long
        msgs = [m for m in msgs if m.chat_id == req.chat_id and not m.deleted and _text(m)]
        if not msgs:
            raise ApiError(422, "digest_empty")
        chars = sum(len(_text(m)) for m in msgs)
        if too_many or chars > MAX_CHARS:
            why = f"hơn {MAX_MESSAGES} tin" if too_many else f"{_num(chars)} ký tự"
            raise ApiError(
                422, "digest_too_large",
                detail=f"Khoảng này có {why} (tối đa {MAX_MESSAGES} tin / {_num(MAX_CHARS)} "
                "ký tự); hãy thu hẹp khoảng thời gian hoặc chọn bớt tin.",
            )  # fmt: skip
        context = [
            {
                "id": str(m.message_id),
                "at": m.date.astimezone(VN).strftime("%d/%m %H:%M"),
                "from": "me" if m.outgoing else (m.sender_name or "?"),
                **({"reply_to": str(m.reply_to_id)} if m.reply_to_id else {}),
                "text": _text(m),
            }
            for m in msgs
        ]
        prompt = TASK
        if teams := [t.strip() for t in req.teams if t.strip()]:
            prompt += f'\nTeams for "impacts.who" (use only these names): {", ".join(teams)}.'
        prompt += f"\n<messages>\n{data_json(context)}\n</messages>"
        text = await self.ai.ask(prompt, feature="digest")
        if not await self._consented(req.chat_id):
            raise ApiError(
                409, "ai_permission_changed",
                detail="Quyền đã đổi trong lúc xử lý; kết quả bị bỏ. "
                "Dữ liệu đã gửi provider không thể thu hồi.",
            )  # fmt: skip
        parsed = parse_result(text, {c["id"] for c in context})
        result = DigestResult(
            **(parsed or {}),
            raw="" if parsed is not None else text,
            source_count=len(msgs),
            since=since,
            until=until,
        )
        newest = max(msgs, key=lambda m: m.message_id)
        await self.db.write(
            self.store.save_digest, req.chat_id, newest.message_id, newest.date,
            result.model_dump_json(),
        )  # fmt: skip
        return result
