"""Digest / Briefing / Q&A DTOs (telegram/routes_digest.py, digest.py, qa.py)."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from ..models import MessageDTO, Platform, utf16_len


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
    platform: Platform = "any"  # Cài đặt chung › Tóm tắt theo nền tảng
    role: Literal["dev", "qa", "po"] | None = None  # Cài đặt chung › Vai trò


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


class BeReplies(BaseModel):
    replies: dict[str, list[BeReply]] = Field(default_factory=dict)  # chat_id -> replies, newest last
    failed: list[str] = Field(default_factory=list)  # groups not read (said, not shown as "Chờ trả lời")


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
    platform: Platform = "any"
    role: Literal["dev", "qa", "po"] | None = None


class SavedMessageRequest(BaseModel):
    """Text for the user's own Saved Messages (Telegram markdown: **bold**, __italic__)."""

    text: str = Field(min_length=1, max_length=20_000)


class QaItem(BaseModel):
    code: str  # "#QA27012345": the line the dashboard adds under a question; answers may name it
    chat_title: str
    question: MessageDTO
    answers: list[MessageDTO]  # the reply chain under the question (and messages naming its code), oldest first
    done: bool = False  # you marked it Xong: no nudge, not waiting (removed threads are not listed at all)
    holding: list[str] = []  # message ids of answers that only say "got it, will report back" (qa.ack_only)
    accepted: str | None = None  # "Chốt": the message id you marked as the answer (the same on every browser)


class QaList(BaseModel):
    items: list[QaItem]
    truncated: bool = False  # the group wrote more in the range than one read takes: older threads are missing


class QaMarkRequest(BaseModel):
    chat_id: str
    code: str = Field(pattern=r"^#QA(?:_(?:BE|PO|QC)_)?\d+$")
    state: Literal["done", "deleted"] | None  # None: back to normal
    # the thread's messages as listed (read live): its question may not be stored (sent from the Q&A box / Telegram)
    message_ids: list[str] = Field(default_factory=list, max_length=500)


class QaAcceptRequest(BaseModel):
    chat_id: str
    code: str = Field(pattern=r"^#QA(?:_(?:BE|PO|QC)_)?\d+$")
    message_id: str | None = Field(pattern=r"^\d{1,20}$")  # None: no answer marked


class QaPostRequest(BaseModel):
    chat_id: str
    text: str = Field(min_length=1, max_length=4000)  # room for the code line under Telegram's 4096
    reply_to: str | None = None  # None: a new question (gets a code line); else a reply in its thread, as typed
    start: bool = False  # with reply_to: answer someone's question with Q&A (code line; their message leads the thread)
    request_id: UUID | None = None  # one per submit: a resend of it reuses the Telegram random_id (no 2nd post)

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
    unread: bool = False  # Telegram could not be read for this group just now: "no news" is not known
