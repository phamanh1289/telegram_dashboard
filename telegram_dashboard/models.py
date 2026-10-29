from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ChangeKind = Literal["new", "edit", "delete", "tracking", "untrack", "purge", "migrated"]
OutboxStatus = Literal["pending", "sending", "sent", "failed", "unknown"]
ChatKind = Literal["group", "supergroup"]


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


class ChatsResponse(BaseModel):
    items: list[ChatDTO]
    snapshot_cursor: str


class TrackingRequest(BaseModel):
    enabled: bool


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
    db_epoch: str
    cursor: str


class UnlockRequest(BaseModel):
    code: str = Field(min_length=1, max_length=128)


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


class AiSummaryRequest(BaseModel):
    chat_id: str
    message_ids: list[str] = Field(min_length=1, max_length=30)


class AiResult(BaseModel):
    text: str
    source_message_ids: list[str]
    context_revision: str


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
    )
