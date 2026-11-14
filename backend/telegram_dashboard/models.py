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
    platform: Literal["android", "ios", "mobile", "any"] = "android"  # angle of the analysis
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
    platform: Literal["android", "ios", "mobile", "any"] = "android"
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
# session; agent: a sender's new tags open an AI Agent session (plan) on the rule's project. Those three clear nothing.
RuleKind = Literal["keyword", "sender", "priority", "relay", "agent"]


class RuleDTO(BaseModel):
    id: int
    kind: RuleKind
    value: str  # keyword: lowercase text; sender / priority: the sender's id
    label: str  # sender / priority / relay / agent: the sender's name
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


class ClaudeUsage(BaseModel):
    label: str
    percent: float
    resets_at: str | None = None


class AiResetCredit(BaseModel):
    """A free "reset my limits now" the plan granted (Claude, Codex)."""

    id: str
    title: str | None = None
    description: str | None = None
    expires_at: str | None = None
    left: int = 1  # resets in this one (a Claude grant may hold several)
    usable: bool = True  # Claude: false while paused, cooling down, or until a limit is hit (when it requires one)


class ClaudeAccount(BaseModel):
    """`claude auth status --json`, as the CLI reports it."""

    loggedIn: bool = False
    authMethod: str | None = None
    email: str | None = None
    orgName: str | None = None
    subscriptionType: str | None = None
    # From Anthropic's account API (absent when the token can't be read).
    name: str | None = None
    created_at: str | None = None
    org_type: str | None = None
    rate_tier: str | None = None
    subscription_status: str | None = None
    extra_usage: bool | None = None
    usage: list[ClaudeUsage] = []
    usage_at: str | None = None  # when the quota was last read from Anthropic
    usage_error: str | None = None  # "no_token": the CLI login has no live token, usage is the last reading
    resets: list[AiResetCredit] = []  # the plan's free limit resets
    resets_left: int = 0
    resets_blocked: str | None = None  # why none are offered: "cli_version" (update the CLI), "tier"…
    login_pending: bool = False
    login_url: str | None = None


class AiPicks(BaseModel):
    """One CLI's model/effort ("" = its default); task_* apply to tasks and the AI Agent, brief_* to
    Briefing / Digest ("" = same as model / effort), yt_* / yt_task_* to YouTrack's light / heavy runs
    ("" = same as model / task_model)."""

    model: AiModel = ""
    effort: AiEffort = ""
    task_model: AiModel = ""
    task_effort: AiEffort = ""
    brief_model: AiModel = ""
    brief_effort: AiEffort = ""
    yt_model: AiModel = ""
    yt_effort: AiEffort = ""
    yt_task_model: AiModel = ""
    yt_task_effort: AiEffort = ""
    guide_model: AiModel = ""  # the know-it-all bot ("" = same as model / effort)
    guide_effort: AiEffort = ""


class AiUse(BaseModel):
    """The CLI each kind of run uses, picked with its model: drafts, Briefing / Digest, tasks / AI Agent,
    YouTrack light / heavy ("" = like its base kind: drafts, YouTrack heavy: tasks)."""

    chat: AiProvider = "claude"
    brief: AiProvider | Literal[""] = ""
    task: AiProvider = "claude"
    yt: AiProvider | Literal[""] = ""
    yt_task: AiProvider | Literal[""] = ""
    guide: AiProvider | Literal[""] = ""  # the know-it-all bot


class AiPrefs(BaseModel):
    """use: the CLI each kind of run uses; by: each CLI's own picks (see providers.prefs)."""

    use: AiUse = AiUse()
    by: dict[AiProvider, AiPicks] = {}
    fallback: bool = False  # Claude: step down to haiku (tasks: sonnet) once a window reaches fallback_at %
    fallback_at: int = Field(90, ge=50, le=100)


class AiOption(BaseModel):
    value: str
    label: str
    hint: str = ""
    group: str = ""  # a routed model's provider (opencodex: AgentAPI, combo, ...)
    efforts: list[AiEffort] | None = None  # this model's own levels ([]: none); None: the CLI's


class AiCatalogEntry(BaseModel):
    """What one CLI offers (providers.catalog). efforts: [] = the CLI takes none."""

    id: AiProvider
    name: str
    models: list[AiOption]
    efforts: list[AiEffort]
    quota: bool  # a quota to show and fall back on (Claude)
    install: str


class AiAccount(BaseModel):
    """Another agent CLI's login, as far as the dashboard can tell (see providers.account)."""

    provider: AiProvider
    installed: bool
    install: str  # the command that installs it
    loggedIn: bool = False
    method: str | None = None  # ChatGPT / Google / API key
    email: str | None = None
    plan: str | None = None
    login_pending: bool = False
    login_url: str | None = None
    usage: list[ClaudeUsage] = []  # the plan's windows, as for Claude
    usage_at: str | None = None
    resets: list[AiResetCredit] = []  # Codex: free rate-limit resets still to use (the list may be capped)
    resets_left: int = 0  # how many there are in all


class AiResetRequest(BaseModel):
    credit_id: str | None = Field(default=None, max_length=200)  # None: the next available one
    # one per "Reset ngay" confirm, the same on a retry after no answer: the provider spends the reset at most once
    request_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{8,64}$")


class AiResetResult(BaseModel):
    outcome: Literal["reset", "nothingToReset", "noCredit", "alreadyRedeemed", "cooldown", "unknown"]


class AiLoginStarted(BaseModel):
    url: str | None = None


class AiRun(BaseModel):
    """One logged AI run (any CLI). cost: what the tokens would cost on the API, in USD;
    quota: % used per window right after the run (as fresh as the 3-minute quota cache)."""

    at: str
    feature: str
    model: str
    effort: str = ""
    fallback: bool = False
    ok: bool
    error: str | None = None
    ms: int = 0
    cost: float | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int = 0
    cache_write: int = 0
    turns: int = 0
    quota: dict[str, float] = {}
    imported: bool = False  # read back from the CLI's transcripts, not logged live
    provider: str = "claude"  # which AI CLI ran it: claude / codex / antigravity
    ref: str | None = None  # the session code the user sees: YT-xxxxxx (YouTrack AI), REF-xxxxxx (AI Agent)
    sid: str | None = None  # Claude's session id: its transcript, ~/.claude/projects/*/<sid>.jsonl
    external: bool = False  # run outside this app (feature: Claude Desktop, Codex CLI…; project: its folder)
    project: str = ""


class AiTestRequest(BaseModel):
    task: bool = False
    brief: bool = False  # Briefing / Digest picks
    yt: bool = False  # YouTrack picks
    guide: bool = False  # the know-it-all bot's picks


class AiMascotRequest(BaseModel):
    """What the member wants their AI mascot to look like (Cài đặt › Linh vật AI)."""

    description: str = Field(min_length=1, max_length=200)
    style: Literal["cute", "pixel", "line"] = "cute"
    # a reference picture to draw after (data: URL, PNG / JPEG / WebP / GIF, ~300 KB)
    image: str = Field("", max_length=420_000)
    # the model / effort to draw with, on the drafts CLI ("" = its default); None: the quick model (the drafts picks
    # with a reference picture)
    model: AiModel | None = None
    effort: AiEffort = ""


class AiMascotRig(BaseModel):
    """The model / effort to ready a drawing to move with (Dùng linh vật này); None: the drafts picks."""

    model: AiModel | None = None
    effort: AiEffort = ""


class AiMascotJob(BaseModel):
    """One AI mascot drawing, run in the background: `svg` once done, `error` (an ApiError code) if it failed."""

    id: str
    description: str
    style: str
    state: Literal["running", "done", "error"]
    svg: str = ""
    rigged: bool = False  # its eyes / a limb / an accent grouped to move like the robot's (POST …/rig)
    error: str = ""
    detail: str = ""


class AiTestResult(BaseModel):
    text: str
    ms: int


class ClaudeLoginStarted(BaseModel):
    url: str | None = None


class ClaudeLoginCode(BaseModel):
    code: str = Field(min_length=8, max_length=1000, pattern=r"^[\w\-.~#]+$")


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


class TaskMessage(BaseModel):
    text: str = Field(min_length=1, max_length=16000)  # 8000 typed + attached messages
    refs: list[TaskRef] = Field(default=[], max_length=10)  # attached messages (MAX_REFS): Done ticks them
    edit: bool = False  # "Accept edit": run this turn of a plan task allowed to edit files
    mcp: bool = False  # this turn may use the user's own MCP servers / plugins, outside the sandbox (edit turns)


class TaskAi(BaseModel):
    """Model/effort for the next turns of one AI Agent session ("" = the CLI default)."""

    model: AiModel = ""
    effort: AiEffort = ""


class GuideTurn(BaseModel):
    """An earlier question to the guide bot and its answer, for follow-ups."""

    q: str = Field(max_length=500)
    a: str = Field(max_length=8000)


class AiGuideRequest(BaseModel):
    """A question about how to use the app, answered from the in-app guide (sent by the page) and the app's own code."""

    question: str = Field(min_length=1, max_length=500)
    guide: str = Field(max_length=200_000)
    history: list[GuideTurn] = Field(default_factory=list, max_length=6)
    page: str = Field("", max_length=200)  # the page the user is on (path), so "here" / "this button" make sense
    code: bool = True  # may read the app's own code (rules, show / hide conditions); off: the guide only, faster
    name: str = Field("", max_length=80)  # how the bot calls the user (YouTrack, else Telegram name); "": anh/chị
    state: str = Field("", max_length=300)  # what this machine has set up (Telegram, AI, YouTrack, role)
    # the Hôm nay list as the page reads it now (today-page.tsx workText): "còn việc nào chờ?" answered from it; sent
    # every turn, a session carried on too, since it changes
    work: str = Field("", max_length=12_000)
    # the AI session of the turns before (the answer's `sid`): this one carries it on, so `guide` holds only the
    # features not sent yet and `history` is empty
    sid: UUID | None = None


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
    message_ids: list[str] = Field(default=[], max_length=2000)  # wins over the range
    after_id: int | None = None  # range only: skip messages a previous digest already read
    # the running digest Briefing shows: carries its open items and is saved; False = a one-off view, left out of it
    save: bool = True
    # open items of the saved digest I closed (ticked / replied), as their joined message ids: not carried on
    closed: list[Annotated[str, Field(max_length=400)]] = Field(default=[], max_length=500)
    teams: list[Annotated[str, Field(max_length=30)]] = Field(default=[], max_length=10)
    intro: str = Field("", max_length=2000)  # the user's self-introduction (Cài đặt › Telegram)


class DigestRef(BaseModel):
    message_ids: list[str] = []
    tickets: list[str] = []  # YouTrack ids named in those messages


class DigestTopic(DigestRef):
    title: str = ""
    summary: str = ""
    status: Literal["decided", "open", "dropped"] = "open"


class DigestItem(DigestRef):
    text: str = ""
    who: str = ""  # decided by / owner / who must confirm / team name
    due: str = ""  # actions only
    why: str = ""  # context: the problem behind it and how it was concluded
    be: bool = False  # a question to / answer from / agreement with the backend team
    topic: str = ""  # title of the topic it belongs to (kept when the item is carried to a later digest)
    asker: str = ""  # BE items: who raised the question / request
    question: str = ""  # BE decisions / changes: the question this answers ("text" is the answer)
    at: datetime | None = None  # open items: when it was first raised (its oldest cited message)
    carried: bool = False  # open item kept from an earlier digest: nothing since settled it


class BeReply(BaseModel):
    """A message replying to an open question with BE that the latest digest has not read yet."""

    reply_to: str  # the question's message id (cited by the digest item)
    message_id: str
    sender: str
    text: str
    date: datetime
    direct: bool = True  # a reply to the question; False: a later plain message from whoever must answer (a guess)


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


class BriefingAskRequest(BaseModel):
    """A question about every group's latest digest."""

    question: str = Field(min_length=1, max_length=1000)
    intro: str = Field("", max_length=2000)


class SavedMessageRequest(BaseModel):
    """Text for the user's own Saved Messages (Telegram markdown: **bold**, __italic__)."""

    text: str = Field(min_length=1, max_length=20_000)


class QaItem(BaseModel):
    code: str  # "#QA27012345": the line the dashboard adds under a question; answers may name it
    chat_title: str
    question: MessageDTO
    answers: list[MessageDTO]  # the reply chain under the question (and messages naming its code), oldest first
    done: bool = False  # you marked it Xong: no nudge, not waiting (removed threads are not listed at all)


class QaMarkRequest(BaseModel):
    chat_id: str
    code: str = Field(pattern=r"^#QA(?:_(?:BE|PO|QC)_)?\d+$")
    state: Literal["done", "deleted"] | None  # None: back to normal


class QaPostRequest(BaseModel):
    chat_id: str
    text: str = Field(min_length=1, max_length=4000)  # room for the code line under Telegram's 4096
    reply_to: str | None = None  # None: a new question (gets a code line); else a reply in its thread, as typed
    start: bool = False  # with reply_to: answer someone's question with Q&A (code line; their message leads the thread)

    @field_validator("text")
    @classmethod
    def _utf16_len(cls, v: str) -> str:
        if utf16_len(v) > 4000:  # Telegram counts UTF-16 units: emoji take two
            raise ValueError("text must be at most 4000 UTF-16 code units")
        return v


class QaSummaryRequest(BaseModel):
    """One Q&A thread for the AI to conclude: its message ids as the page lists them (the question first)."""

    chat_id: str
    message_ids: list[str] = Field(min_length=1, max_length=500)
    accepted_id: str | None = None  # the answer the user marked ("Chốt"): the conclusion builds on it
    intro: str = Field("", max_length=2000)


class QaPosted(BaseModel):
    message_id: str
    code: str | None  # the new question's code, or (joined) the thread the answer went into
    joined: bool = False  # `start` on a message already in a thread: answered there, no new code


class BriefingItem(BaseModel):
    chat_id: str
    title: str
    consent: bool
    consent_until: datetime | None = None  # the consent's end, also once passed (Briefing offers to renew)
    saved: SavedDigest | None = None
    latest_id: str | None = None  # newest message on Telegram; None if unknown or no consent


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
        handled_by=m.handled_by,
        handled_at=m.handled_at,
        snoozed_until=m.snoozed_until,
        snooze_on=m.snooze_on,
        pinned=m.pinned,
        priority=m.priority,
        links=m.links,
        sender_username=m.sender_username,
    )


class FlowRetryRequest(BaseModel):
    note: str = Field("", max_length=2000)
    deep: bool = False


class FlowOmittedDTO(BaseModel):
    source: str
    kind: str
    count: int


class FlowManifestDTO(BaseModel):
    measurement: Literal["estimated"] = "estimated"
    estimated_input_tokens: int
    estimated_payload_tokens: int = 0
    context_floor_assumed: int = 32768
    budget: int
    sources: list[str]
    omitted: list[FlowOmittedDTO]
    warnings: list[str] = Field(default_factory=list)
    ambiguous_lines: int = 0
    output_reserve: int = 6144
    envelope_reserve: int = 2048
    kept: dict[str, int] = Field(default_factory=dict)  # a re-render: what the person's edits it carried over


class FlowResultDTO(BaseModel):
    flow: dict
    manifest: FlowManifestDTO | None = None
    warnings: list[str] = Field(default_factory=list)


class FlowJobDTO(BaseModel):
    id: str
    issue: str
    status: Literal["queued", "running", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted"]
    stage: str
    base: str | None
    request: FlowRetryRequest | None
    result: FlowResultDTO | None
    error: dict | None
    processed: bool
    cursor: int
    created_at: float
    updated_at: float
    needs_ai_retry: bool


class FlowScopeDTO(BaseModel):
    scope: str
