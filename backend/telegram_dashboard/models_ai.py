"""AI / provider account DTOs: preferences, catalog, accounts, runs, mascot, the know-it-all bot, a draft's result."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from .models import AiEffort, AiModel, AiProvider


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


class GuideTurn(BaseModel):
    """An earlier question to the guide bot and its answer, for follow-ups."""

    q: str = Field(max_length=500)
    a: str = Field(max_length=8000)


class AiGuideRequest(BaseModel):
    """A question about how to use the app, answered from the in-app guide the page sends (never the app's own code)."""

    question: str = Field(min_length=1, max_length=500)
    guide: str = Field(max_length=200_000)
    history: list[GuideTurn] = Field(default_factory=list, max_length=6)
    page: str = Field("", max_length=200)  # the page the user is on (path), so "here" / "this button" make sense
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
