"""Wire DTOs of /api/docs (kept here: models.py is past the 600-line target)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# API names of the sources; `youtrack` is stored as `yt_article`, `telegram` is the tracked-chat messages, `kb_cache`
# the articles of projects not in the sources (the AI Agent's cache, hidden everywhere else); `telegram` also lists the
# files kept from Telegram messages (stored as `tg_file`)
Source = Literal["youtrack", "telegram", "file", "kb_cache"]


class DocDTO(BaseModel):
    id: int
    source: Literal["youtrack", "file", "telegram"]
    ref: str
    title: str
    chars: int
    updated_at: datetime | None
    tickets: list[str]
    url: str | None
    has_summary: bool
    parent: str | None = None  # a Knowledge Base article's parent article (the list's tree)
    folder: str | None = None  # a file's source folder as chosen, and its path under it (the list's tree)
    rel: str | None = None
    size: int = 0  # bytes of the file (a Telegram file: as Telegram sent it, to tell its versions apart)
    origin: str | None = None  # a Telegram file: the message it came from, "<chat_id>:<message_id>"


class DocPart(BaseModel):
    part: int
    line: int
    heading: str
    body: str


class DocRevBlock(BaseModel):
    heading: str  # the section the lines sit under ("" before the first heading)
    removed: list[str]
    added: list[str]
    # index of the first changed line among the new text's non-blank lines (headings once); None: recorded before
    at: int | None = None


class DocRev(BaseModel):
    """One update seen by a sync: what changed since the stored copy (several edits between two syncs show as one)."""

    at: datetime
    by: str | None  # YouTrack's updatedBy; None for a file
    blocks: list[DocRevBlock]
    more: int  # changed lines left out


class DocDetail(BaseModel):
    doc: DocDTO
    parts: list[DocPart]
    summary: str | None
    revs: list[DocRev] = []  # newest first, every one since `added_at`
    added_at: datetime | None = None  # when it came into the library; None: stored before the app recorded it


class DocHit(BaseModel):
    doc: DocDTO
    part: int
    line: int
    heading: str
    text: str
    marks: list[tuple[int, int]]


class DocMsgHit(BaseModel):
    chat_id: str
    message_id: int
    chat_title: str
    sender_name: str | None
    date: datetime
    text: str
    marks: list[tuple[int, int]]


class DocSearch(BaseModel):
    hits: list[DocHit]
    messages: list[DocMsgHit]
    ask_parts: int
    ask_chars: int


class DocSourceError(BaseModel):
    source: str
    ref: str
    code: str
    detail: str


class DocSources(BaseModel):
    projects: list[str]  # Knowledge Base projects read whole
    articles: list[str]  # Knowledge Base branches: an article and every one under it
    folders: list[str]
    synced_at: datetime | None
    errors: list[DocSourceError]
    cached: int  # articles in the Agent's cache (kb_cache)


class DocSourcesBody(BaseModel):
    projects: list[str]
    folders: list[str]
    articles: list[str] | None = None  # None: the chosen branches stay


class KbNode(BaseModel):
    """A Knowledge Base article in its project's tree, for picking branches."""

    id: str
    title: str
    parent: str | None


SESSION = r"^[A-Za-z0-9_-]{1,64}$"  # an AI popup conversation's id (the page makes it)


class DocAskBody(BaseModel):
    question: str
    q: str = ""
    source: Source | None = None
    ticket: str | None = None
    doc: int | None = None
    session: str | None = Field(None, pattern=SESSION)  # the answer is kept in this conversation's history
    fresh: bool = False  # run the AI even when the same question on this version of the document has a saved answer


class DocCite(BaseModel):
    n: int
    doc: int | None = None
    part: int | None = None
    chat_id: str | None = None
    message_id: int | None = None


class DocAnswer(BaseModel):
    text: str
    cites: list[DocCite]
    saved_at: datetime | None = None  # set: a saved answer given back (same question, same document), no AI run


class DocSummary(BaseModel):
    text: str
    cached: bool


class DocAiSession(BaseModel):
    """One AI popup conversation in the history: `question` its first one ("" when it began with a Tóm tắt of
    `doc_title`)."""

    session: str
    at: datetime
    n: int
    kind: Literal["ask", "summary"]
    question: str
    doc: int | None
    doc_title: str


class DocAiTurn(BaseModel):
    """A turn of a conversation; `stale`: its document changed (or left the library) since."""

    id: int
    kind: Literal["ask", "summary"]
    question: str
    text: str
    cites: list[DocCite]
    doc: int | None
    doc_title: str
    stale: bool
    at: datetime


class DocZeplinScreen(BaseModel):
    """A Zeplin screen matching a name written in a document: `image` a signed Zeplin image URL ("" when none), `url`
    the screen on Zeplin's web app."""

    project: str
    project_name: str
    platform: str
    id: str
    name: str
    image: str
    w: float
    h: float
    url: str


class DocTgBody(BaseModel):
    """A Telegram message whose document goes into the library (added, or updating the one of the same name)."""

    chat_id: str = Field(pattern=r"^-?\d{1,20}$")
    message_id: int = Field(ge=1)

