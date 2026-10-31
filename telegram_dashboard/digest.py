"""Digest: structured AI summary of a group conversation, read live from Telegram.

Separate from tag drafts: it needs a chat-wide consent (digest_consents), never touches
per-message grants or handled state, and stores neither the messages nor the result.
"""

import json
from datetime import UTC, datetime

from .ai import AiService
from .errors import ApiError
from .models import DigestRequest, DigestResult, StoredMessage
from .storage import Db, Store

MAX_MESSAGES = 400
MAX_CHARS = 80_000
TIMEOUT = 120.0
KEYS = ("topics", "decisions", "changes", "impacts", "confirmations", "actions")
STATUSES = ("decided", "open", "dropped")

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
Every item cites the ids of the messages it is based on. Never invent facts: leave a field empty \
or drop the item when unsure; empty lists are fine. Write every text in Vietnamese, short and \
concrete."""


def _aware(d: datetime | None) -> datetime | None:
    return None if d is None else d if d.tzinfo else d.replace(tzinfo=UTC)


def _text(m: StoredMessage) -> str:
    if not m.media_kind:
        return m.text
    tag = "[ảnh]" if m.media_kind == "photo" else "[file]"
    return f"{tag} {m.text}".strip()


def parse_result(text: str, ids: set[str]) -> dict | None:
    """The model's JSON object, cleaned: unknown ids dropped, fields coerced to strings.
    None when no JSON object can be read."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    out: dict = {}
    for key in KEYS:
        items = data.get(key)
        rows = []
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict):
                continue
            row = {k: str(v) for k, v in it.items() if k != "message_ids" and v is not None}
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
        since, until = _aware(req.since), _aware(req.until) or datetime.now(UTC)
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
        else:
            msgs = []
        too_many = len(msgs) > MAX_MESSAGES  # before filtering: the range itself is too long
        msgs = [m for m in msgs if m.chat_id == req.chat_id and not m.deleted and _text(m)]
        if not msgs:
            raise ApiError(422, "digest_empty")
        if too_many or sum(len(_text(m)) for m in msgs) > MAX_CHARS:
            raise ApiError(
                422, "digest_too_large",
                detail=f"Tối đa {MAX_MESSAGES} tin / {MAX_CHARS:,} ký tự; "
                "hãy thu hẹp khoảng thời gian.",
            )  # fmt: skip
        context = [
            {
                "id": str(m.message_id),
                "at": m.date.astimezone().strftime("%d/%m %H:%M"),
                "from": "me" if m.outgoing else (m.sender_name or "?"),
                **({"reply_to": str(m.reply_to_id)} if m.reply_to_id else {}),
                "text": _text(m),
            }
            for m in msgs
        ]
        prompt = TASK
        if teams := [t.strip() for t in req.teams if t.strip()]:
            prompt += f'\nTeams for "impacts.who" (use only these names): {", ".join(teams)}.'
        prompt += f"\n<messages>\n{json.dumps(context, ensure_ascii=False)}\n</messages>"
        text = await self.ai._call(prompt, timeout=TIMEOUT)
        if not await self._consented(req.chat_id):
            raise ApiError(
                409, "ai_permission_changed",
                detail="Quyền đã đổi trong lúc xử lý; kết quả bị bỏ. "
                "Dữ liệu đã gửi provider không thể thu hồi.",
            )  # fmt: skip
        parsed = parse_result(text, {c["id"] for c in context})
        return DigestResult(
            **(parsed or {}),
            raw="" if parsed is not None else text,
            source_count=len(msgs),
            since=since,
            until=until,
        )
