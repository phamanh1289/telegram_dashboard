from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Cài đặt chung › Tóm tắt theo nền tảng: the angle of every Telegram AI run (ai_prompts.PLATFORM_FOCUS)
Platform = Literal["android", "ios", "web", "mobile", "any"]

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


class FileInfo(BaseModel):
    """A document attached to a message (Telegram's file name, bytes, MIME): Tài liệu checks and adds it by name."""

    name: str = ""
    size: int = 0
    mime: str = ""


# How a tag got handled: me = Xong (with the reaction), quiet = Shift+Xong (no reaction), reply = our own reply on
# Telegram, dashboard = a reply sent from here, all = "Xong tất cả", rule = an auto-skip rule.
HandledBy = Literal["", "me", "quiet", "reply", "dashboard", "all", "rule"]


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
    file: FileInfo | None = None  # media_kind "document" only
    deleted: bool = False
    handled: bool = False  # answered (any reply from us) or marked done by hand
    handled_by: HandledBy = ""  # how it got handled ("" while pending, or marked before this was kept)
    handled_at: datetime | None = None
    snoozed_until: datetime | None = None  # hidden from pending until then
    snooze_on: str | None = None  # "reply" / "ticket:<ID>": back when that happens (snoozed_until: the backstop)
    pinned: bool = False  # sticks to the top of the pending list
    priority: bool = False  # from a "Luôn ưu tiên" sender: sorts first among pending tags
    links: list[LinkSpan] = []  # Telegram formatting entities (UTF-16 offsets)
    sender_username: str | None = None  # live reads only (never stored): Q&A matches it against the question's @tags


class GroupInfo(BaseModel):
    chat_id: str
    title: str
    kind: ChatKind
    migrated: bool = False


class Member(BaseModel):
    """A group member the reply box can tag (@ popup): by @username, or by name when there is none."""

    user_id: str
    name: str
    username: str | None = None


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
    file: FileInfo | None = None
    deleted: bool
    handled: bool = False
    handled_by: HandledBy = ""
    handled_at: datetime | None = None
    snoozed_until: datetime | None = None
    snooze_on: str | None = None  # "reply" / "ticket:<ID>": wakes sooner on that event
    pinned: bool = False
    priority: bool = False  # sender is in "Luôn ưu tiên" (Cài đặt › Telegram): shows first, overdue sooner
    links: list[LinkSpan] = []
    kept: bool = False  # live pages: a tag/reply we store (handled in the tag lists; Cả nhóm hides it)
    sender_username: str | None = None  # live reads (Q&A): "answered by the one tagged"


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
    initial_history_limit: int = 50
    pending_count: int = 0  # tags not handled yet
    oldest_pending: datetime | None = None  # the longest-waiting of them (the sidebar shows its age)


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


class ContactRequest(BaseModel):
    """Cài đặt › Liên hệ: one message to the app's developer on Telegram."""

    # One-line title; a description that keeps the whole message (with the machine lines) in one Telegram message (4096)
    title: str = Field(min_length=1, max_length=120)
    kind: Literal["bug", "feature", "idea", "question"]
    area: Literal["telegram", "youtrack", "docs", "ai", "settings", "other"]
    text: str = Field(min_length=1, max_length=3000)
    diag: bool = True  # add the app / machine lines (contact.diag)
    logs: bool = False  # attach the server's recent warnings / errors as log.txt (log_buffer)
    client: str = Field("", max_length=300)  # browser, language, screen: what only the page knows
    photos: list[str] = Field(default_factory=list, max_length=5)  # base64 PNG / JPEG / WebP, ≤ 5 MB each

    @field_validator("title", "text")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v.strip()


class ContactPolishRequest(BaseModel):
    """Liên hệ › AI viết lại: the draft as typed (not sent anywhere but the AI)."""

    kind: Literal["bug", "feature", "idea", "question"]
    area: Literal["telegram", "youtrack", "docs", "ai", "settings", "other"]
    title: str = Field("", max_length=120)
    text: str = Field(min_length=1, max_length=3000)


class ContactPolish(BaseModel):
    title: str  # the input's own title when the AI gave none
    text: str


class ContactPreview(BaseModel):
    to: str  # the developer's @username
    text: str  # the message exactly as POST /api/contact sends it (photos follow as an album)
    log: str = ""  # log.txt as it would be attached ("" when not asked for or nothing logged)


class StatusDTO(BaseModel):
    state: Literal["setup_required", "login_required", "connecting", "connected", "degraded", "stopped"]
    detail: str | None = None
    ai_configured: bool
    youtrack_configured: bool = False
    telegram_api_id: int | None = None
    telegram_me: str | None = None
    telegram_name: str | None = None  # the account's display name (telegram_me may be its @username)
    db_epoch: str
    cursor: str


class ReplyRequest(BaseModel):
    request_id: UUID
    chat_id: str
    reply_to_message_id: str
    text: str
    retry_unknown: bool = False
    quote: bool = True  # False: a new message in the group (and topic) of reply_to, not a reply to it
    qa: bool = False  # a "#QA…" line under the text when it tags someone (@username): Q&A follows it
    qa_role: Literal["BE", "PO", "QC"] | None = None  # who the ask goes to: "#QA_BE_…", Q&A shows who confirmed

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


class AiDraftRequest(BaseModel):
    chat_id: str
    message_ids: list[str] = Field(min_length=1, max_length=30)
    instruction: str = Field(max_length=2000)
    project: str | None = None  # path of a registered project the agent may read
    with_context: bool = True  # add nearby group messages (fetched live, not stored)
    platform: Platform = "android"  # angle of the analysis
    role: Literal["dev", "qa", "po"] = "dev"  # who reads it (Cài đặt chung › Vai trò)
    intro: str = Field("", max_length=2000)  # the user's self-introduction (Cài đặt chung)
    # with `project`: the tag's question answered from the code ("Trả lời từ code"); these tickets give its progress
    ticket_ids: list[str] = Field(default_factory=list, max_length=10)
    # Trợ lý AI: the turn goes into the tag's (message_ids[0]) saved session, and the earlier turns into the prompt
    save: bool = False
    shown: str = Field("", max_length=16000)  # the turn as the session shows it (attached quoted); "": instruction


class AboutMe(BaseModel):
    """Who the user is (Settings), for every AI Agent session's frame (ai.session_rules)."""

    role: Literal["dev", "qa", "po"] | None = None  # None: not chosen yet
    platform: Platform = "android"
    intro: str = Field("", max_length=2000)


class AiDeepRequest(AboutMe):
    """Deep thinking: a question to BE + BE's confirmation, traced through a project's code."""

    chat_id: str
    question_id: str
    confirm_id: str
    project: str
    instruction: str = Field("", max_length=2000)


class DeepItem(BaseModel):
    """One topic of Q&A with BE: its title / summary and the messages behind it."""

    text: str = Field(max_length=1000)  # the digest's own summary of it
    message_ids: list[str] = Field(min_length=1, max_length=10)
    waiting: bool = False  # BE has not answered yet: trace what the code does now
    key: str = Field("", max_length=20, pattern=r"^\d*$")  # the topic's id (its first message): verdicts map back by it


class AiDeepBatchRequest(AboutMe):
    """Đối chiếu BE in bulk: several digest items of one chat (agreed with BE), traced through a project's code."""

    chat_id: str
    items: list[DeepItem] = Field(min_length=1, max_length=20)
    project: str
    instruction: str = Field("", max_length=2000)


class AiTicketRequest(AiDraftRequest):
    instruction: str = Field("", max_length=2000)  # the user's note for the ticket
    types: list[str] = Field([], max_length=50)  # the YouTrack project's Type values
    priorities: list[str] = Field([], max_length=50)


class AiTicketDraft(BaseModel):
    summary: str  # "" when the model's answer could not be read (it is all in description)
    type: str  # one of the given types, or ""
    priority: str
    description: str


class HandledRequest(BaseModel):
    handled: bool
    react: bool = True  # False: tick done here only, no Telegram reaction


class PinRequest(BaseModel):
    pinned: bool


class PrRequest(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    body: str = Field("", max_length=5000)
    mixed_ok: bool = False  # the user confirmed a PR that carries edits from before the session (gitops.open_pr)


class SnoozeRequest(BaseModel):
    until: datetime | None  # None = wake now
    # wake sooner: "reply" (someone answers the tag or my reply to it) or "ticket:VA-12" (that ticket done)
    on: Annotated[str, Field(pattern=r"^(reply|ticket:[A-Za-z][A-Za-z0-9_]*-\d{1,9})$")] | None = None


class RemindRequest(SnoozeRequest):
    restore: HandledBy | None = None  # Undo: done again exactly as before (how), nothing else follows


class RemindResult(BaseModel):
    was: HandledBy  # how it was handled before the reminder, for Undo


class LoopItem(BaseModel):
    """ "Báo lại": my ticket reached `state`; the stored message to answer about it."""

    ticket: Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_]*-\d{1,9}$")]
    state: Annotated[str, Field(max_length=100)]
    chat_id: Annotated[str, Field(max_length=40)]
    message_id: Annotated[str, Field(pattern=r"^\d{1,12}$")]


class LoopBack(BaseModel):
    items: list[LoopItem]
    error: str = ""  # the background YouTrack watch's last failure ("" = fine): the list may be missing items


class LoopDoneRequest(BaseModel):
    chat_id: Annotated[str, Field(max_length=40)]
    message_id: Annotated[str, Field(pattern=r"^\d{1,12}$")]
    ticket: Annotated[str | None, Field(max_length=40)] = None  # None: every item for the message


class LoopImportRequest(BaseModel):
    items: Annotated[list[LoopItem], Field(max_length=30)]


class PendingItem(BaseModel):
    chat_title: str
    message: MessageDTO


class WeekNumbers(BaseModel):
    received: int  # tags (and replies to you) that came in
    handled: int  # of those, handled by you (replied or marked done), rule auto-handles excluded
    replied: int
    marked: int  # Xong / Xong không reaction / Xong cả nhóm, without a reply
    auto: int  # cleared by a "Luôn bỏ qua" rule
    median_min: float | None  # minutes from the tag to handled
    p90_min: float | None


class SlowGroup(BaseModel):
    chat_id: str
    title: str
    handled: int
    median_min: float


class WeekStats(BaseModel):
    """ "Tuần của tôi": the last 7 days (`cur`), the 7 before (`prev`), this week's slowest groups."""

    cur: WeekNumbers
    prev: WeekNumbers
    slow: list[SlowGroup]


# priority: a sender whose tags sort first; relay: a sender's answers to an AI Agent session's asks go on in that
# session; agent: a sender's new tags open an AI Agent session (plan) on the rule's project. tag_be / tag_po / tag_qc:
# who an AI Agent session's ask to BE / PO / QC tags (ai.role_tags). Only keyword and sender clear tags.
RuleKind = Literal["keyword", "sender", "priority", "relay", "agent", "tag_be", "tag_po", "tag_qc"]


class RuleDTO(BaseModel):
    id: int
    kind: RuleKind
    value: str  # keyword: lowercase text; sender / priority: the sender's id
    label: str  # every kind but keyword: the sender's name
    project: str = ""  # agent: the project folder its sessions run in


class RuleRequest(AboutMe):  # agent: who the user is, for the sessions it opens (the page keeps it, the server doesn't)
    kind: RuleKind
    value: str = Field(min_length=1, max_length=200, pattern=r"\S")  # never blank: "" matches every tag
    label: str = Field(default="", max_length=200)
    project: str = Field(default="", max_length=1000)  # agent: a registered project folder


class MessageRef(BaseModel):
    chat_id: str
    message_id: str


class RuleAdded(BaseModel):
    rule: RuleDTO
    handled: int  # existing pending tags the rule cleared (the toast's count)
    cleared: list[MessageRef]  # those tags, for an Undo (reopen them)


AiEffort = Literal["", "low", "medium", "high", "xhigh", "max", "ultra"]  # ultra: some Codex models
# A CLI model alias or id; never starts with "-" so it can't pass for a flag. "provider/model": a model
# opencodex routes for Codex.
AiModel = Annotated[str, Field(max_length=80, pattern=r"^([A-Za-z][\w.\-\[\]]*(/[\w.\-\[\]]+)?)?$")]


AiProvider = Literal["claude", "codex", "antigravity"]


class AskTo(BaseModel):
    """Where a session's asks go: a reply to the message last attached to it."""

    chat_id: str
    message_id: str
    qa: str = ""  # "#QA…" of the thread it sits in: the reply joins it, no new code


class TaskDTO(BaseModel):
    id: str
    chat_id: str | None
    message_id: str | None
    project: str
    created_at: datetime
    active_at: datetime | None = None  # last turn / step (log written); None: no log yet
    result: str | None = None  # what the agent wrote back when done
    prompt: str = ""
    # plan | edit: headless, driven from the dashboard; terminal: an old Terminal task (read-only)
    mode: Literal["terminal", "plan", "edit"] = "plan"
    running: bool = False
    chat_title: str | None = None
    sender_name: str | None = None
    message_text: str | None = None
    handled: bool = False  # the tagged message was marked done
    # deep: a Deep thinking session (question to BE + BE's confirmation); assist: a tag's Trợ lý AI turns (no project)
    kind: Literal["task", "deep", "assist"] = "task"
    title: str | None = None  # deep: the two messages, short
    provider: AiProvider = "claude"  # the CLI the session runs on
    model: str | None = None  # picked for this session; None: the task picks in AI settings
    effort: str | None = None
    ask_to: AskTo | None = None  # None: asks go out as a new message in the tag's group
    state: Literal["done", "waiting", "you"] | None = None  # the last answer's Trạng thái (ai.task_state)


class YouTrackRequest(BaseModel):
    summary: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=20000)
    markdown: bool = True  # False: plain text, YouTrack parses it as its own wiki markup
    project: str | None = Field(default=None, pattern=r"^[\w-]{1,30}$")  # None: YOUTRACK_PROJECT
    # set after creating, through one command (values go between braces)
    type: str | None = Field(default=None, pattern=r"^[^{}\n]{1,100}$")
    priority: str | None = Field(default=None, pattern=r"^[^{}\n]{1,100}$")
    assignee: str | None = Field(default=None, pattern=r"^[\w.@-]{1,100}$")
    # the tag the ticket comes from: its photo (if any) is attached to the ticket
    chat_id: str | None = Field(default=None, max_length=40)
    message_id: str | None = Field(default=None, pattern=r"^\d{1,12}$")


class TelegramApp(BaseModel):
    api_id: int = Field(gt=0, lt=2**31)
    api_hash: str = Field(pattern=r"^[0-9a-f]{32}$")


class TelegramPhone(BaseModel):
    phone: str = Field(pattern=r"^\+?[0-9 ]{6,20}$")


class TelegramCodeSent(BaseModel):
    via: Literal["app", "sms", "other"]  # app: into the Telegram app on another device, not an SMS
    length: int | None = None  # digits in the code, when Telegram says


class TelegramSignIn(BaseModel):
    code: str | None = Field(default=None, pattern=r"^[0-9]{3,8}$")
    password: str | None = Field(default=None, min_length=1, max_length=256)


class TelegramSignInResult(BaseModel):
    password_required: bool


class YouTrackAuth(BaseModel):
    # the token rides every request: plain http only to this machine
    url: str = Field(pattern=r"^(https://[^\s/]+|http://(localhost|127\.0\.0\.1)(:\d+)?)(/[^\s]*)?$", max_length=200)
    token: str = Field(min_length=8, max_length=500, pattern=r"^\S+$")


class YouTrackUser(BaseModel):
    login: str
    name: str


class YouTrackIssue(BaseModel):
    id: str
    url: str
    summary: str = ""
    warning: str = ""  # created, but Type / Priority / Assignee could not be set


class HandledAllResponse(BaseModel):
    count: int
    message_ids: list[int]  # the tags just marked, for an Undo


class ProjectDTO(BaseModel):
    path: str
    name: str


class ProjectRequest(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


class TaskRequest(AboutMe):
    project: str
    mode: Literal["plan", "edit"] = "plan"
    prompt: str = Field(min_length=1, max_length=8000)
    chat_id: str | None = None
    message_id: str | None = None
    mcp: bool = False  # an edit session's first turn may use the user's own MCP servers / plugins (TaskMessage.mcp)


class TaskRef(BaseModel):
    chat_id: str = Field(max_length=32)
    message_id: str = Field(max_length=16)


class TaskMessage(AboutMe):  # who the user is: a session whose first turn never ran starts over (tasks.send_turn)
    text: str = Field(min_length=1, max_length=16000)  # 8000 typed + attached messages
    refs: list[TaskRef] = Field(default=[], max_length=10)  # attached messages (MAX_REFS): Done ticks them
    edit: bool = False  # "Accept edit": run this turn of a plan task allowed to edit files
    mcp: bool = False  # this turn may use the user's own MCP servers / plugins, outside the sandbox (edit turns)


class TaskAi(BaseModel):
    """Model/effort for the next turns of one AI Agent session ("" = the CLI default)."""

    model: AiModel = ""
    effort: AiEffort = ""


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
        file=m.file,
        deleted=m.deleted,
        handled=m.handled,
        handled_by=m.handled_by,
        handled_at=m.handled_at,
        snoozed_until=m.snoozed_until,
        snooze_on=m.snooze_on,
        pinned=m.pinned,
        priority=m.priority,
        links=m.links,
        sender_username=m.sender_username,
    )
