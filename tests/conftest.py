import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from telegram_dashboard.app import create_app
from telegram_dashboard.config import Settings
from telegram_dashboard.events import Hub
from telegram_dashboard.models import GroupInfo, Member, SentMessage, StoredMessage
from telegram_dashboard.storage import Db, Store
from telegram_dashboard.telegram.bridge import TelegramBridge

A = "-1001"  # supergroup
B = "-1002"  # supergroup
G1 = "-11"  # basic group
G2 = "-12"  # basic group
ORIGIN = "http://127.0.0.1:8765"


def msg(chat: str, mid: int, text: str = "hi", *, edit: int | None = None, sender: str = "7",
        topic: int | None = None, outgoing: bool = False) -> StoredMessage:  # fmt: skip
    return StoredMessage(
        chat_id=chat,
        message_id=mid,
        sender_id=sender,
        sender_name="Alice",
        text=text,
        date=datetime(2026, 1, 1, tzinfo=UTC),
        edit_date=None if edit is None else datetime.fromtimestamp(edit, UTC),
        topic_id=topic,
        outgoing=outgoing,
    )


@dataclass
class FakeTransport:
    groups: list[GroupInfo] = field(default_factory=list)
    history: dict[str, list[StoredMessage]] = field(default_factory=dict)
    send_calls: list[dict] = field(default_factory=list)
    reactions: list[tuple] = field(default_factory=list)
    saved: list[str] = field(default_factory=list)
    send_impl: object = None
    connect_impl: object = None
    bridge: object = None
    connected: bool = False

    def attach(self, bridge):
        self.bridge = bridge

    async def connect(self):
        if self.connect_impl:
            return await self.connect_impl()
        self.connected = True
        return True

    async def disconnect(self):
        self.connected = False

    def is_connected(self):
        return self.connected

    async def list_groups(self):
        return list(self.groups)

    async def fetch_context(self, chat_id, message_id, before, after):
        ms = sorted(self.history.get(chat_id, []), key=lambda m: m.message_id)
        older = [m for m in ms if m.message_id < message_id][-before:]
        newer = [m for m in ms if m.message_id > message_id][:after]
        return older + [m for m in ms if m.message_id == message_id] + newer

    async def fetch_older(self, chat_id, before, limit):
        ms = sorted(self.history.get(chat_id, []), key=lambda m: m.message_id)
        return [m for m in ms if before is None or m.message_id < before][-limit:]

    async def download_photo(self, chat_id, message_id, dest):
        return False

    async def fetch_mentions(self, cutoff):
        return []

    async def latest_id(self, chat_id):
        return max((m.message_id for m in self.history.get(chat_id, [])), default=0)

    async def fetch_range(self, chat_id, since, until, limit):
        ms = sorted(self.history.get(chat_id, []), key=lambda m: (m.date, m.message_id))
        return [m for m in ms if since <= m.date < until][-limit:]

    async def fetch_ids(self, chat_id, ids):
        return [m for m in self.history.get(chat_id, []) if m.message_id in ids]

    async def send_reply(self, chat_id, reply_to, text, random_id, topic_id):
        call = dict(chat_id=chat_id, reply_to=reply_to, text=text, random_id=random_id,
                    topic_id=topic_id)  # fmt: skip
        self.send_calls.append(call)
        if self.send_impl:
            return await self.send_impl(call)
        return SentMessage(message_id=1000 + len(self.send_calls))

    async def members(self, chat_id):
        return [
            Member(user_id="42", name="Minh BE", username="minh_be"),
            Member(user_id="43", name="Lan QA"),
            Member(user_id="44", name="Trần Lan Anh", username="lananh_po"),
            Member(user_id="45", name="Đức Mobile"),
        ]

    async def send_reaction(self, chat_id, message_id, emoji):
        self.reactions.append((chat_id, message_id, emoji))

    async def send_saved(self, text):
        self.saved.append(text)


class Env:
    def __init__(self, tmp_path):
        self.store = Store(tmp_path / "db.sqlite3")
        self.hub = Hub()
        self.db = Db(self.store, self.hub)
        self.fake = FakeTransport()
        self.bridge = TelegramBridge(self.store, self.db, self.fake, retry_delay=0.01)
        self.bridge.state = "connected"

    def track(self, chat: str, kind: str = "supergroup"):
        self.store.set_tracking(chat, True, title=f"chat {chat}", kind=kind)

    async def settle(self):
        await asyncio.gather(*self.bridge._bg, return_exceptions=True)


@pytest.fixture(autouse=True)
def _no_keychain(monkeypatch):
    """A claude run refreshes the quota for its log line: never the real Keychain/API in tests."""
    import telegram_dashboard.claude as mod

    async def no_token():
        return None

    monkeypatch.setattr(mod, "_oauth_token", no_token)

    async def no_creds():
        return {}

    monkeypatch.setattr(mod, "_oauth_creds", no_creds)


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


@pytest.fixture
def settings(tmp_path):
    out = tmp_path / "web" / "out"
    out.mkdir(parents=True)
    (out / "index.html").write_text("<html>shell</html>")
    return Settings(root=tmp_path)


@pytest.fixture
def client(settings):
    app = create_app(settings, transport=FakeTransport())
    with TestClient(app, base_url=ORIGIN) as c:
        yield c


class FakeAgent:
    """Stands in for AiService.ask (the claude CLI): records prompts, returns `reply`."""

    def __init__(self, reply="draft text", on_call=None, exc=None):
        self.calls: list[str] = []
        self.projects: list[str | None] = []  # the folder each run could read
        self.shells: list[bool] = []  # each run could run commands there (sandboxed)
        self.refs: list[str] = []  # the session code each run is logged under
        self.kwargs: dict = {}  # the last run's keyword arguments (zeplin: the MCP server it may read)
        self.reply, self.on_call, self.exc = reply, on_call, exc

    async def __call__(
        self,
        prompt,
        project=None,
        read_dir=None,
        system=None,
        heavy=False,
        on_text=None,
        feature=None,
        brief=False,
        yt=False,
        shell=False,
        ref="",
        zeplin=None,
    ):
        self.kwargs = {"zeplin": zeplin, "system": system, "heavy": heavy}
        self.calls.append(prompt)
        self.projects.append(project)
        self.shells.append(shell)
        self.refs.append(ref)
        if self.on_call:
            self.on_call()
        if self.exc:
            raise self.exc
        return self.reply
