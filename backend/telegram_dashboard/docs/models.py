"""Wire DTOs of /api/docs (kept here: models.py is past the 600-line target)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

# API names of the sources; `youtrack` is stored as `yt_article`, `telegram` is the tracked-chat messages
Source = Literal["youtrack", "telegram", "file"]


class DocDTO(BaseModel):
    id: int
    source: Literal["youtrack", "file"]
    ref: str
    title: str
    chars: int
    updated_at: datetime | None
    tickets: list[str]
    url: str | None
    has_summary: bool


class DocPart(BaseModel):
    part: int
    line: int
    heading: str
    body: str


class DocDetail(BaseModel):
    doc: DocDTO
    parts: list[DocPart]
    summary: str | None


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
    projects: list[str]
    folders: list[str]
    synced_at: datetime | None
    errors: list[DocSourceError]


class DocSourcesBody(BaseModel):
    projects: list[str]
    folders: list[str]


class DocAskBody(BaseModel):
    question: str
    q: str = ""
    source: Source | None = None
    ticket: str | None = None
    doc: int | None = None


class DocCite(BaseModel):
    n: int
    doc: int | None = None
    part: int | None = None
    chat_id: str | None = None
    message_id: int | None = None


class DocAnswer(BaseModel):
    text: str
    cites: list[DocCite]


class DocSummary(BaseModel):
    text: str
    cached: bool
