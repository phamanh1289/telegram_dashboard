"""Request bodies of /api/yt/* and the team settings they save (notes, prompts, workflow); id / project checks."""

import re
from typing import Annotated, Any, Literal

from fastapi import Request
from pydantic import BaseModel, Field

from . import flow as uiflow
from .client import ID_RE, YtError


class Mention(BaseModel):
    chat_id: str
    chat: str | None
    from_: str | None = Field(alias="from")
    text: str
    date: int  # epoch ms
    message_id: str
    outgoing: bool
    reply_to_id: str | None


class Assignee(BaseModel):
    id: str
    login: str | None


class Comment(BaseModel):
    id: str
    text: str = Field(min_length=1, max_length=20000)


class FlowSave(BaseModel):
    id: str
    flow: dict
    base: str | None = None  # attachment id of the version the user opened (None: there was none)
    shots: dict[str, uiflow.Shot] = Field({}, max_length=uiflow.MAX_SCREENS)  # Zeplin URL -> image, for the file


class FlowShots(BaseModel):
    urls: list[Annotated[str, Field(max_length=300)]] = Field(max_length=uiflow.MAX_SCREENS)


class FieldSet(BaseModel):
    id: str
    name: Literal["State", "Priority", "Type"]
    value: str = Field(pattern=r"^[^{}\n]{1,100}$")  # goes into a command between braces


class AiTicket(BaseModel):
    id: str
    kind: Literal["brief", "ready", "reply", "rewrite", "split"]
    folder: str = Field("", max_length=1000)  # a registered code folder: the AI reads it (read-only)
    shell: bool = False  # with a folder: may also run commands there (build, test) in the sandbox


class AiData(BaseModel):
    kind: Literal["report", "notes", "ask", "weekly", "team", "release"]
    data: Any
    question: str = Field("", max_length=500)  # kind "ask" only


class AiTickets(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=40)
    scope: str = Field("", max_length=200)  # what the user picked, e.g. "Sprint 12"
    kind: Literal[
        "review",
        "today",
        "summary",
        "ask",
        "standup",
        "plan",
        "testcases",
        "triage",
        "regression",
        "groom",
        "quality",
    ] = "review"
    ask: str = Field("", max_length=2000)  # kind "ask": the user's own request
    stats: Any = None  # kind "ask": figures computed on the page (one person's workload)
    since: int = 0  # kind "standup": start of the last working day, epoch ms
    # kind "review": what moved since the last brief, computed on the page ("VA-1: Open → QC")
    changes: list[Annotated[str, Field(max_length=300)]] = Field([], max_length=200)
    folder: str = Field("", max_length=1000)  # a registered code folder: the AI reads it (read-only)
    shell: bool = False  # with a folder: may also run commands there (build, test) in the sandbox


class AiFlow(BaseModel):
    base: str | None = Field(None, max_length=500)
    id: str
    note: str = Field("", max_length=2000)  # what the user adds to the ticket's own text
    deep: bool = False  # "Kỹ": the heavy picks (a larger model); "Nhanh": the light ones, enough for most tickets
    keep: dict | None = None  # the flow on screen: notes / tap areas / positions survive the render (never prompted)


class AiDraft(BaseModel):
    text: str = Field(min_length=1, max_length=8000)  # what the user typed / pasted
    types: list[Annotated[str, Field(max_length=100)]] = Field([], max_length=50)  # the project's values
    priorities: list[Annotated[str, Field(max_length=100)]] = Field([], max_length=50)


class AiTurn(BaseModel):
    q: str = Field("", max_length=2000)  # "" on the first answer: the request itself is in the prompt
    a: str = Field("", max_length=30_000)


class AiFollowup(BaseModel):
    path: Literal["/ai/ticket", "/ai/data", "/ai/tickets"]  # the first request
    body: dict  # its JSON, validated again by that endpoint's model
    history: list[AiTurn] = Field(min_length=1, max_length=12)
    question: str = Field(min_length=1, max_length=2000)


ROLES = ("dev", "qa", "po")
NOTES_MAX = 4000


class AiNotes(BaseModel):
    """The team's own instructions for every YouTrack AI run, one per role (Settings › YouTrack)."""

    dev: str = Field("", max_length=NOTES_MAX)
    qa: str = Field("", max_length=NOTES_MAX)
    po: str = Field("", max_length=NOTES_MAX)


class SavedPrompt(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=2000)


PromptCtx = Literal["dev:one", "dev:many", "qa:one", "qa:many", "po:one", "po:many"]


class SavedPrompts(BaseModel):
    """Named prompts the team reuses in the YouTrack AI session (Settings › YouTrack)."""

    prompts: list[SavedPrompt] = Field(default_factory=list, max_length=200)
    # per role and ticket count ("dev:one"…): names shown as buttons; missing = the role default
    shown: dict[PromptCtx, Annotated[list[str], Field(max_length=5)]] = Field(default_factory=dict)
    hidden: list[str] = Field(default_factory=list, max_length=50)  # built-ins the team deleted


StateName = Annotated[str, Field(min_length=1, max_length=100)]


class Workflow(BaseModel):
    """The team's own State flow for one project (Settings › YouTrack › Workflow): boxes on a canvas
    and arrows from → to. `on`: the app only moves a ticket along an arrow (YouTrack's own state
    machine still applies on top)."""

    on: bool = False
    pos: dict[StateName, tuple[float, float]] = Field(default_factory=dict, max_length=200)
    edges: list[tuple[StateName, StateName]] = Field(default_factory=list, max_length=1000)
    hidden: list[StateName] = Field(default_factory=list, max_length=200)  # boxes taken off the canvas


# The Dev flow a project starts with when Dev has none saved yet (QA / PO start empty). Only used
# when the project has all these states; the rest are hidden.
DEV_FLOW = {
    "on": True,
    "pos": {
        "OPENED": (24, 24), "ASSIGN TO DESIGN": (288, 24), "TO DO": (24, 104), "CLOSED": (338, 110),
        "ON HOLD": (343, 178), "IN PROGRESS": (24, 182), "BUILT ON DEV": (347, 240),
        "READY FOR TEST": (24, 249),
    },
    "edges": [
        ("OPENED", "TO DO"), ("OPENED", "ASSIGN TO DESIGN"), ("OPENED", "CLOSED"),
        ("TO DO", "IN PROGRESS"), ("TO DO", "CLOSED"), ("TO DO", "ON HOLD"),
        ("IN PROGRESS", "CLOSED"), ("IN PROGRESS", "BUILT ON DEV"), ("BUILT ON DEV", "READY FOR TEST"),
    ],
}  # fmt: skip


class AiFilter(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    options: dict


def _project(p: str) -> str:
    p = re.sub(r"[^\w-]", "", p)
    if not p:
        raise YtError(400, "project required")
    return p


def _issue_id(i: str) -> str:
    if not ID_RE.match(i):
        raise YtError(400, "bad id")
    return i


def _role(request: Request) -> str:
    """The role the page is in (header X-Yt-Role); none picked yet counts as Dev, like Telegram."""
    role = request.headers.get("x-yt-role", "")
    return role if role in ROLES else "dev"
