from datetime import UTC, datetime, timedelta

from conftest import ORIGIN, A, B, msg

from telegram_dashboard.ai import AiService
from telegram_dashboard.config import Settings

H = {"Origin": ORIGIN}


def _seed(store):
    store.track_mention(A, "Alpha", "supergroup")
    store.track_mention(B, "Beta", "supergroup")
    a1 = msg(A, 1, "@me review PR", sender="5")
    a1.date = datetime(2026, 10, 30, 8, tzinfo=UTC)
    b1 = msg(B, 2, "#TB thông báo bảo trì", sender="9")
    b1.date = datetime(2026, 10, 29, 8, tzinfo=UTC)
    store.apply_message(a1)
    store.apply_message(b1)


def test_unified_pending_oldest_first_and_snooze(client):
    store = client.app.state.store
    _seed(store)
    items = client.get("/api/pending").json()
    assert [(i["chat_title"], i["message"]["message_id"]) for i in items] == [
        ("Beta", "2"), ("Alpha", "1"),
    ]  # fmt: skip
    later = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    r = client.put(f"/api/chats/{B}/messages/2/snooze", json={"until": later}, headers=H)
    assert r.status_code == 204
    assert [i["message"]["message_id"] for i in client.get("/api/pending").json()] == ["1"]
    beta = next(c for c in client.get("/api/chats").json()["items"] if c["chat_id"] == B)
    assert beta["pending_count"] == 0
    client.put(f"/api/chats/{B}/messages/2/snooze", json={"until": None}, headers=H)
    assert len(client.get("/api/pending").json()) == 2


def test_pinned_sticks_to_top(client):
    _seed(client.app.state.store)
    assert client.put(f"/api/chats/{A}/messages/1/pin", json={"pinned": True}, headers=H).status_code == 204
    items = client.get("/api/pending").json()
    assert [i["message"]["message_id"] for i in items] == ["1", "2"] and items[0]["message"]["pinned"]
    client.put(f"/api/chats/{A}/messages/1/pin", json={"pinned": False}, headers=H)
    assert [i["message"]["message_id"] for i in client.get("/api/pending").json()] == ["2", "1"]
    assert client.get("/api/pinned").json() == []
    client.put(f"/api/chats/{A}/messages/1/pin", json={"pinned": True}, headers=H)
    client.put(f"/api/chats/{A}/messages/1/handled", json={"handled": True}, headers=H)
    assert [i["message"]["message_id"] for i in client.get("/api/pinned").json()] == ["1"]  # kept after done


def test_rules_clear_existing_and_new_tags(client):
    store = client.app.state.store
    _seed(store)
    r = client.post("/api/rules", json={"kind": "keyword", "value": "#TB"}, headers=H).json()
    assert r["handled"] == 1 and r["rule"]["value"] == "#tb"
    assert [i["message"]["message_id"] for i in client.get("/api/pending").json()] == ["1"]
    assert store.store_mentions([("Beta", "supergroup", msg(B, 3, "#tb lần 2"), False)]) == []
    assert store.get_message(B, 3).handled
    assert client.post("/api/rules", json={"kind": "sender", "value": "5"}, headers=H).status_code == 422
    assert [x["kind"] for x in client.get("/api/rules").json()] == ["keyword"]


def test_context_is_live_and_only_around_kept_tags(client):
    store = client.app.state.store
    bridge = client.app.state.bridge
    bridge.state = "connected"
    store.track_mention(A, "Alpha", "supergroup")
    bridge.transport.history[A] = [msg(A, i, f"m{i}") for i in range(1, 21)]
    store.apply_message(msg(A, 10, "m10"))
    ids = [m["message_id"] for m in client.get(f"/api/chats/{A}/messages/10/context").json()]
    assert ids == [str(i) for i in range(1, 16)]
    assert client.get(f"/api/chats/{A}/messages/11/context").status_code == 404


async def test_draft_includes_context(env, tmp_path):
    env.store.track_mention(A, "Alpha", "supergroup")
    env.store.apply_message(msg(A, 1, "@me what about this?", sender="7"))
    s = Settings(root=tmp_path, ai_agent_command="cat", ai_model="", ai_effort="", ai_require_consent=False)
    nearby = [msg(A, 0, "the login page crashes on iOS", sender="8")]
    r = await AiService(s, env.store, env.db).run("draft", A, ["1"], nearby=nearby)
    assert "login page crashes" in r.text and "<context>" in r.text


def test_youtrack_not_configured(client):
    r = client.post("/api/youtrack/issues", json={"summary": "x"}, headers=H)
    assert r.status_code == 503 and r.json()["error"]["code"] == "youtrack_not_configured"


def test_youtrack_auth_checks_then_saves(client, settings, monkeypatch):
    from telegram_dashboard import app as app_mod
    from telegram_dashboard.errors import ApiError

    async def whoami(url, token):
        if token != "perm-good":
            raise ApiError(400, "youtrack_unauthorized")
        return {"login": "me", "name": "Me"}

    monkeypatch.setattr(app_mod, "whoami", whoami)
    body = {"url": "https://yt.example/", "token": "perm-bad1"}
    r = client.put("/api/youtrack/auth", json=body, headers=H)
    assert r.status_code == 400 and not settings.youtrack_path.exists()
    assert client.get("/api/yt/config", headers=H).json()["mock"] is True

    r = client.put("/api/youtrack/auth", json={**body, "token": "perm-good"}, headers=H)
    assert r.json() == {"login": "me", "name": "Me"}
    assert settings.youtrack_path.stat().st_mode & 0o777 == 0o600
    cfg = client.get("/api/yt/config", headers=H).json()
    assert cfg["mock"] is False and cfg["base"] == "https://yt.example"
    saved = Settings.from_env(root=settings.root)  # survives a restart, over .env
    assert (saved.youtrack_url, saved.youtrack_token) == ("https://yt.example", "perm-good")


def test_task_result_shows_next_to_its_tag(client, settings):
    from telegram_dashboard.agent import task_result_path

    store = client.app.state.store
    store.track_mention(A, "Alpha", "supergroup")
    store.add_task("t1", A, 4, "/tmp/proj", "sửa bug login")
    assert client.get("/api/tasks").json()[0]["result"] is None
    assert client.get("/api/tasks").json()[0]["handled"] is False  # message not stored yet
    store.apply_message(msg(A, 4, "@me login crash"))
    client.put(f"/api/chats/{A}/messages/4/handled", json={"handled": True}, headers=H)
    assert client.get("/api/tasks").json()[0]["handled"] is True  # the task follows its tag
    p = task_result_path(settings, "t1")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("Đã sửa crash login iOS, PR #42")
    t = client.get(f"/api/tasks?chat_id={A}").json()[0]
    assert t["message_id"] == "4" and t["result"].startswith("Đã sửa crash")
    assert t["prompt"] == "sửa bug login" and t["chat_title"] == "Alpha"
    assert client.delete("/api/tasks/t1", headers=H).status_code == 204
    assert client.get("/api/tasks").json() == [] and not p.exists()


def test_date_range_filters_lists(client):
    _seed(client.app.state.store)  # Beta tag on 10-29, Alpha tag on 10-30
    day = "since=2026-10-29T00:00:00Z&until=2026-10-30T00:00:00Z"
    assert [i["chat_title"] for i in client.get(f"/api/pending?{day}").json()] == ["Beta"]
    assert [c["title"] for c in client.get(f"/api/chats?{day}").json()["items"]] == ["Beta"]
    msgs = client.get(f"/api/chats/{A}/messages?{day}").json()["items"]
    assert msgs == []
    r = client.post(f"/api/chats/{B}/handled-all?{day}", headers=H).json()
    assert r == {"count": 1}


def test_done_mirrors_as_telegram_reaction(settings):
    import dataclasses

    from conftest import FakeTransport, TestClient, create_app

    app = create_app(dataclasses.replace(settings, done_reaction="👍"), transport=FakeTransport())
    with TestClient(app, base_url=ORIGIN) as client:
        _reaction_flow(client)


def _reaction_flow(client):
    import time

    _seed(client.app.state.store)
    bridge = client.app.state.bridge
    fake = bridge.transport

    def reactions(n):
        for _ in range(100):  # sent in the background
            if len(fake.reactions) >= n:
                return fake.reactions
            time.sleep(0.02)
        return fake.reactions

    for _ in range(100):
        if bridge.state == "connected":
            break
        time.sleep(0.02)
    url = f"/api/chats/{A}/messages/1/handled"
    client.put(url, json={"handled": True}, headers=H)
    assert reactions(1) == [(A, 1, "👍")]
    client.put(url, json={"handled": True}, headers=H)  # unchanged: nothing sent
    client.put(url, json={"handled": False}, headers=H)  # reopened: reaction removed
    assert reactions(2) == [(A, 1, "👍"), (A, 1, None)]
    assert client.post(f"/api/chats/{B}/handled-all", headers=H).json() == {"count": 1}
    assert reactions(3) == [(A, 1, "👍"), (A, 1, None)]  # bulk marks stay private
    client.put(url, json={"handled": True, "react": False}, headers=H)  # done without a reaction
    assert reactions(3) == [(A, 1, "👍"), (A, 1, None)]


async def test_reaction_never_replaces_or_removes_the_users_own():
    from types import SimpleNamespace as NS

    from telethon.tl import types

    from telegram_dashboard.telegram import TelethonTransport

    def r(e, order=None):
        return types.ReactionCount(reaction=types.ReactionEmoji(emoticon=e), count=1,
                                   chosen_order=order)  # fmt: skip

    class Client:
        results: list = []
        sent: list = []

        async def get_input_entity(self, peer):
            return peer

        async def get_messages(self, peer, ids):
            return NS(reactions=NS(results=self.results))

        async def __call__(self, req):
            self.sent.append([x.emoticon for x in req.reaction])

    t = TelethonTransport.__new__(TelethonTransport)
    t.client, t.bridge = Client(), NS(reaction="👍")
    for results, emoji, sent in (
        ([], "👍", [["👍"]]),  # nothing chosen: add ours
        ([r("❤", 0)], "👍", []),  # the user's own heart stays
        ([r("👍", 0)], None, [[]]),  # reopen takes ours back
        ([r("❤", 0), r("👍", 1)], None, [["❤"]]),  # ...and only ours
        ([r("❤", 0), r("👍")], None, []),  # someone else's 👍: not ours to remove
    ):
        t.client.results, t.client.sent = results, []
        await t.send_reaction(A, 1, emoji)
        assert t.client.sent == sent, (results, emoji)


def test_old_terminal_task_lists_but_is_read_only(client):
    client.app.state.store.add_task("t9", A, 4, "/tmp/proj", "x", mode="terminal")
    assert client.get("/api/tasks").json()[0]["mode"] == "terminal"
    for path in ("message", "reopen"):
        r = client.post(f"/api/tasks/t9/{path}", json={"text": "hi"}, headers=H)
        assert r.status_code == 409 and r.json()["error"]["code"] == "terminal_task_unsupported"


def test_headless_task_runs_and_resumes(tmp_path):
    import shlex
    import sys
    import time

    from conftest import ORIGIN, FakeTransport, TestClient, create_app

    from telegram_dashboard.config import Settings

    fake = tmp_path / "fake_claude.py"
    fake.write_text(
        "import json, sys\n"
        "text = sys.stdin.read()\n"
        "print(json.dumps({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'echo ' + text}]}}))\n"
        "print(json.dumps({'type': 'result', 'result': 'ARGS ' + ' '.join(sys.argv[1:]), 'is_error': False}))\n"
    )
    out = tmp_path / "web" / "out"
    out.mkdir(parents=True)
    (out / "index.html").write_text("x")
    cfg = Settings(root=tmp_path, ai_task_command=f"{shlex.quote(sys.executable)} {shlex.quote(str(fake))}")
    proj = tmp_path / "proj"
    proj.mkdir()
    with TestClient(create_app(cfg, transport=FakeTransport()), base_url=ORIGIN) as c:
        c.app.state.store.add_project(str(proj), "proj")

        def wait_idle(tid):
            for _ in range(100):
                ev = c.get(f"/api/tasks/{tid}/events").json()
                if not ev["running"] and any(i["kind"] == "result" for i in ev["items"]):
                    return ev
                time.sleep(0.05)
            raise AssertionError("task did not finish")

        r = c.post("/api/tasks", json={"project": str(proj), "prompt": "làm A", "mode": "plan"}, headers=H)
        assert r.status_code == 200, r.text
        task = c.get("/api/tasks").json()[0]
        assert r.json()["id"] == task["id"]
        assert task["mode"] == "plan"
        ev = wait_idle(task["id"])
        assert [i["kind"] for i in ev["items"]] == ["user", "assistant", "result"]
        assert "--model sonnet --effort medium" in ev["items"][-1]["text"] and "--permission-mode plan" in ev["items"][-1]["text"] and "--session-id" in ev["items"][-1]["text"]
        assert c.get("/api/tasks").json()[0]["running"] is False
        assert c.post(f"/api/tasks/{task['id']}/message", json={"text": "tiếp"}, headers=H).status_code == 204
        for _ in range(100):
            ev = c.get(f"/api/tasks/{task['id']}/events").json()
            if len(ev["items"]) == 6 and not ev["running"]:
                break
            time.sleep(0.05)
        assert ev["items"][3] == {"kind": "user", "text": "tiếp"} and "--resume" in ev["items"][-1]["text"]
        assert "--permission-mode plan" in ev["items"][-1]["text"]
        # Accept edit: the plan task's next turn resumes the same session allowed to edit
        assert c.post(f"/api/tasks/{task['id']}/message", json={"text": "làm đi", "edit": True}, headers=H).status_code == 204
        for _ in range(100):
            ev = c.get(f"/api/tasks/{task['id']}/events").json()
            if len(ev["items"]) == 9 and not ev["running"]:
                break
            time.sleep(0.05)
        assert "--permission-mode acceptEdits" in ev["items"][-1]["text"] and "--resume" in ev["items"][-1]["text"]
