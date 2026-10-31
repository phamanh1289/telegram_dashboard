from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ChangeKind = Literal["new", "edit", "delete", "tracking", "untrack", "purge", "migrated"]
OutboxStatus = Literal["pending", "sending", "sent", "failed", "unknown"]
ChatKind = Literal["group", "supergroup"]


class LinkSpan(BaseModel):
    offset: int  # UTF-16 code units, like Telegram entities and JS strings
    length: int
    url: str = ""
    kind: Literal[
        "link", "mention", "code", "pre", "bold", "italic", "underline", "strike", "spoiler", "blockquote"
    ] = "link"


class StoredMessage(BaseModel):
    """Internal message record; ids are ints here and strings on the wire."""

    chat_id: str
    message_id: int
    sender_id: str | None = None
    sender_name: str | None = None
    text: str = ""
    date: datetime
    edit_date: datetime | None = None
    reply_to_id: int | None = None
    topic_id: int | None = None
    outgoing: bool = False
    media_kind: str | None = None
    deleted: bool = False
    handled: bool = False  # answered (any reply from us) or marked done by hand
    snoozed_until: datetime | None = None  # hidden from pending until then
    pinned: bool = False  # sticks to the top of the pending list
    links: list[LinkSpan] = []  # Telegram formatting entities (UTF-16 offsets)


class GroupInfo(BaseModel):
    chat_id: str
    title: str
    kind: ChatKind
    migrated: bool = False


class SentMessage(BaseModel):
    message_id: int
    message: StoredMessage | None = None


class MessageDTO(BaseModel):
    chat_id: str
    message_id: str
    sender_id: str | None
    sender_name: str | None
    text: str
    date: datetime
    edit_date: datetime | None
    reply_to_id: str | None
    topic_id: str | None
    outgoing: bool
    media_kind: str | None
    deleted: bool
    handled: bool = False
    snoozed_until: datetime | None = None
    pinned: bool = False
    links: list[LinkSpan] = []


class ChatDTO(BaseModel):
    chat_id: str
    title: str
    kind: ChatKind
    tracking: bool
    available: bool = True
    migrated: bool = False
    migrated_to: str | None = None
    tracked_at: datetime | None = None
    generation: int = 0
    sync_state: Literal["idle", "syncing", "degraded"] = "idle"
    initial_history_limit: int = 50
    pending_count: int = 0  # tags not handled yet


class ChatsResponse(BaseModel):
    items: list[ChatDTO]
    snapshot_cursor: str


class MessagesPage(BaseModel):
    items: list[MessageDTO]
    snapshot_cursor: str
    has_more: bool


class ChangeItem(BaseModel):
    cursor: str
    chat_id: str
    message_id: str | None
    kind: ChangeKind
    generation: int
    message: MessageDTO | None = None


class ChangesPage(BaseModel):
    items: list[ChangeItem]
    next_cursor: str
    has_more: bool
    reset: bool = False


class StatusDTO(BaseModel):
    state: Literal[
        "setup_required", "login_required", "connecting", "connected", "degraded", "stopped"
    ]
    detail: str | None = None
    ai_configured: bool
    ai_require_consent: bool
    youtrack_configured: bool = False
    db_epoch: str
    cursor: str


class ReplyRequest(BaseModel):
    request_id: UUID
    chat_id: str
    reply_to_message_id: str
    text: str
    retry_unknown: bool = False

    @field_validator("text")
    @classmethod
    def _utf16_len(cls, v: str) -> str:
        n = utf16_len(v)
        if n < 1 or n > 4096:
            raise ValueError("text must be 1-4096 UTF-16 code units")
        return v


class OutboxDTO(BaseModel):
    request_id: str
    code: str | None = None
    chat_id: str
    reply_to_message_id: str
    status: OutboxStatus
    message_id: str | None = None
    error_code: str | None = None
    retry_after: int | None = None


class PermissionGrant(BaseModel):
    message_id: str
    scope: str = Field(min_length=1, max_length=200)
    expires_at: datetime
    participants: dict[str, str] = Field(
        description="sender id -> evidence reference of that person's consent"
    )


class AiPermissionRequest(BaseModel):
    grants: list[PermissionGrant] = []
    revoke_message_ids: list[str] = []


class AiPermissionResponse(BaseModel):
    granted: list[str]
    revoked: list[str]
    rejected: dict[str, str]


class AiDraftRequest(BaseModel):
    chat_id: str
    message_ids: list[str] = Field(min_length=1, max_length=30)
    instruction: str = Field(max_length=2000)
    project: str | None = None  # path of a registered project the agent may read
    with_context: bool = True  # add nearby group messages (fetched live, not stored)
    platform: Literal["android", "ios", "mobile", "any"] = "android"  # angle of the analysis


class HandledRequest(BaseModel):
    handled: bool


class PinRequest(BaseModel):
    pinned: bool


class SnoozeRequest(BaseModel):
    until: datetime | None  # None = wake now


class PendingItem(BaseModel):
    chat_title: str
    message: MessageDTO


class RuleDTO(BaseModel):
    id: int
    kind: Literal["keyword"]
    value: str
    label: str


class RuleRequest(BaseModel):
    kind: Literal["keyword"]
    value: str = Field(min_length=1, max_length=200)
    label: str = Field(default="", max_length=200)


class RuleAdded(BaseModel):
    rule: RuleDTO
    handled: int  # existing pending tags the rule cleared


class TaskDTO(BaseModel):
    id: str
    chat_id: str | None
    message_id: str | None
    project: str
    created_at: datetime
    result: str | None = None  # what the agent wrote back when done
    prompt: str = ""
    mode: str = "terminal"  # terminal | plan | edit (headless, driven from the dashboard)
    running: bool = False
    interactive: bool = False  # its Terminal tab is known, so input can be sent
    chat_title: str | None = None
    sender_name: str | None = None
    message_text: str | None = None


class YouTrackRequest(BaseModel):
    summary: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=20000)


class YouTrackIssue(BaseModel):
    id: str
    url: str


class HandledAllResponse(BaseModel):
    count: int


class ProjectDTO(BaseModel):
    path: str
    name: str


class ProjectRequest(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


class TaskRequest(BaseModel):
    project: str
    mode: Literal["terminal", "plan", "edit"] = "terminal"
    prompt: str = Field(min_length=1, max_length=8000)
    chat_id: str | None = None
    message_id: str | None = None


class TaskMessage(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class TaskInput(BaseModel):
    text: str = Field(max_length=2000)  # empty = press Enter


class AiSummaryRequest(BaseModel):
    chat_id: str
    message_ids: list[str] = Field(min_length=1, max_length=30)


class AiResult(BaseModel):
    text: str
    options: list[str] = []  # alternative drafts; text == options[0] when present
    analysis: str = ""  # draft only: summary of the ask + suggested next steps
    source_message_ids: list[str]
    context_revision: str


class DigestConsent(BaseModel):
    enabled: bool
    expires_at: datetime | None = None


class DigestConsentRequest(BaseModel):
    enabled: bool
    days: int = Field(30, ge=1, le=90)


class HistoryPage(BaseModel):
    items: list[MessageDTO]
    truncated: bool  # more messages in the range than `limit`


class DigestRequest(BaseModel):
    chat_id: str
    since: datetime | None = None  # used when message_ids is empty
    until: datetime | None = None  # default: now
    message_ids: list[str] = Field(default=[], max_length=400)  # wins over the range
    teams: list[Annotated[str, Field(max_length=30)]] = Field(default=[], max_length=10)


class DigestRef(BaseModel):
    message_ids: list[str] = []


class DigestTopic(DigestRef):
    title: str = ""
    summary: str = ""
    status: Literal["decided", "open", "dropped"] = "open"


class DigestItem(DigestRef):
    text: str = ""
    who: str = ""  # decided by / owner / who must confirm / team name
    due: str = ""  # actions only


class DigestResult(BaseModel):
    topics: list[DigestTopic] = []
    decisions: list[DigestItem] = []
    changes: list[DigestItem] = []
    impacts: list[DigestItem] = []
    confirmations: list[DigestItem] = []
    actions: list[DigestItem] = []
    raw: str = ""  # set only when the model's JSON could not be read
    source_count: int
    since: datetime | None = None
    until: datetime | None = None


class SavedDigest(BaseModel):
    result: DigestResult
    created_at: datetime
    last_message_id: str  # newest message any digest of this chat covered
    last_date: datetime


class BriefingItem(BaseModel):
    chat_id: str
    title: str
    consent: bool
    saved: SavedDigest | None = None
    latest_id: str | None = None  # newest message on Telegram; None if unknown or no consent


class ApiErrorBody(BaseModel):
    code: str
    retry_after: int | None = None
    detail: str | None = None


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def to_dto(m: StoredMessage) -> MessageDTO:
    return MessageDTO(
        chat_id=m.chat_id,
        message_id=str(m.message_id),
        sender_id=m.sender_id,
        sender_name=m.sender_name,
        text=m.text,
        date=m.date,
        edit_date=m.edit_date,
        reply_to_id=None if m.reply_to_id is None else str(m.reply_to_id),
        topic_id=None if m.topic_id is None else str(m.topic_id),
        outgoing=m.outgoing,
        media_kind=m.media_kind,
        deleted=m.deleted,
        handled=m.handled,
        snoozed_until=m.snoozed_until,
        pinned=m.pinned,
        links=m.links,
    )
