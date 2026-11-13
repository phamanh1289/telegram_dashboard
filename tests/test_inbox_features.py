from datetime import UTC, datetime, timedelta

from conftest import ORIGIN, A, B, msg

from telegram_dashboard.ai import AiService
from telegram_dashboard.config import Settings

H = {"Origin": ORIGIN}


def _seed(store):
    store.set_tracking(A, True, "Alpha", "supergroup")
    store.set_tracking(B, True, "Beta", "supergroup")
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


def test_snooze_keeps_a_live_message(client):
    store = client.app.state.store
    client.app.state.bridge.state = "connected"
    store.set_tracking(A, True, "Alpha", "supergroup")
    client.app.state.bridge.transport.history[A] = [msg(A, 11, "plain", sender="5")]
    later = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    assert client.put(f"/api/chats/{A}/messages/11/snooze", json={"until": later}, headers=H).status_code == 204
    assert store.get_message(A, 11).snoozed_until is not None
    assert client.put(f"/api/chats/{A}/messages/12/snooze", json={"until": later}, headers=H).status_code == 404


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
    for blank in ("", "   "):  # "" is in every text: it would clear every tag
        assert client.post("/api/rules", json={"kind": "keyword", "value": blank}, headers=H).status_code == 422
    r = client.post("/api/rules", json={"kind": "sender", "value": "5", "label": "Alice"}, headers=H).json()
    assert r["handled"] == 1
    assert r["rule"] | {"id": 0} == {"id": 0, "kind": "sender", "value": "5", "label": "Alice", "project": ""}
    assert r["cleared"] == [{"chat_id": A, "message_id": "1"}]  # what an Undo reopens
    assert client.get("/api/pending").json() == []
    assert store.store_mentions([("Alpha", "supergroup", msg(A, 5, "@me again", sender="5"), False)]) == []
    assert [x["kind"] for x in client.get("/api/rules").json()] == ["keyword", "sender"]


def test_context_is_live_and_only_around_kept_tags(client):
    store = client.app.state.store
    bridge = client.app.state.bridge
    bridge.state = "connected"
    store.set_tracking(A, True, "Alpha", "supergroup")
    bridge.transport.history[A] = [msg(A, i, f"m{i}") for i in range(1, 21)]
    store.apply_message(msg(A, 10, "m10"))
    ids = [m["message_id"] for m in client.get(f"/api/chats/{A}/messages/10/context").json()]
    assert ids == [str(i) for i in range(1, 16)]
    assert client.get(f"/api/chats/{A}/messages/11/context").status_code == 404
    # A kept tag marked done shows as done in the live thread; the rest stay as Telegram has them.
    store.set_handled(A, 10, True)
    done = [m["message_id"] for m in client.get(f"/api/chats/{A}/messages/10/context").json() if m["handled"]]
    assert done == ["10"]


def test_one_message_kept_else_live(client):
    store = client.app.state.store
    bridge = client.app.state.bridge
    store.set_tracking(A, True, "Alpha", "supergroup")
    store.apply_message(msg(A, 10, "kept tag"))
    assert client.get(f"/api/chats/{A}/messages/10").json()["text"] == "kept tag"
    bridge.transport.history[A] = [msg(A, 11, "BE confirm")]
    assert client.get(f"/api/chats/{A}/messages/11").json()["text"] == "BE confirm"
    for bad in ("12", "0", "x", str(2**31)):
        assert client.get(f"/api/chats/{A}/messages/{bad}").status_code == 404


async def test_draft_includes_context(env, tmp_path):
    env.store.set_tracking(A, True, "Alpha", "supergroup")
    env.store.apply_message(msg(A, 1, "@me what about this?", sender="7"))
    s = Settings(root=tmp_path, ai_agent_command="cat", ai_model="", ai_effort="")
    nearby = [msg(A, 0, "the login page crashes on iOS", sender="8")]
    r = await AiService(s, env.store, env.db).run("draft", A, ["1"], nearby=nearby)
    assert "login page crashes" in r.text and "<context>" in r.text


def test_youtrack_not_configured(client):
    r = client.post("/api/youtrack/issues", json={"summary": "x"}, headers=H)
    assert r.status_code == 503 and r.json()["error"]["code"] == "youtrack_not_configured"


def test_youtrack_search_by_id_or_words(client, monkeypatch):
    from telegram_dashboard import app as app_mod

    async def whoami(url, token):
        return {"login": "me", "name": "Me"}

    monkeypatch.setattr(app_mod, "whoami", whoami)
    client.put("/api/youtrack/auth", json={"url": "https://yt.example/", "token": "perm-good"}, headers=H)
    seen = []

    async def yt(path, **kw):
        seen.append(kw["query"])
        return [{"idReadable": "VA-7", "summary": "Ký HĐMG"}]

    monkeypatch.setattr(client.app.state.yt, "yt", yt)
    search = lambda q: client.get("/api/youtrack/search", params={"q": q, "project": "VA"}, headers=H).json()  # noqa: E731
    hit = {"id": "VA-7", "url": "https://yt.example/issue/VA-7", "summary": "Ký HĐMG", "warning": ""}
    assert search(" va-7 ") == [hit]
    search("ký hợp đồng {x} #Resolved")  # an ID finds any state; words only open ones, no YQL syntax
    assert seen == ["issue ID: VA-7", "project: VA #Unresolved ký hợp đồng Resolved"]
    assert search("  ") == [] and len(seen) == 2


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
    store.set_tracking(A, True, "Alpha", "supergroup")
    store.add_task("t1", A, 4, "/tmp/proj", "sửa bug login")
    assert client.get("/api/tasks").json()[0]["result"] is None
    assert client.get("/api/tasks").json()[0]["handled"] is False  # message not stored yet
    # Not a kept tag (e.g. Đối chiếu BE on any reply): Done sits on the session itself.
    done = {"handled": True, "react": False}
    assert client.put("/api/tasks/t1/handled", json=done, headers=H).status_code == 204
    assert client.get("/api/tasks").json()[0]["handled"] is True
    client.put("/api/tasks/t1/handled", json={"handled": False, "react": False}, headers=H)
    store.apply_message(msg(A, 4, "@me login crash"))
    store.set_handled(A, 4, True, "dashboard")  # a reply (the session's asks) handles the tag: the session stays Doing
    assert client.get("/api/tasks").json()[0]["handled"] is False
    client.put("/api/tasks/t1/handled", json=done, headers=H)  # now on the tag: Xong on the session claims it
    assert store.get_message(A, 4).handled_by == "quiet"
    assert store.get_message(A, 4).handled
    assert client.get("/api/tasks").json()[0]["handled"] is True  # the task follows its tag
    # Messages attached to its turns follow the session's Done / reopen (only kept ones; others are no-ops).
    store.apply_message(msg(A, 5, "@me BE: API đã sửa"))
    store.add_task_refs("t1", [(A, 5, ""), (A, 99, "")])
    # Q&A "Đã gửi AI": attached messages and a session's own tag, with their sessions (newest first).
    store.add_task("t0", A, 5, "/tmp/proj", "cũ")
    assert client.get("/api/tasks/sent").json() == {f"{A}:4": ["t1"], f"{A}:5": ["t1", "t0"], f"{A}:99": ["t1"]}
    store.delete_task("t0")
    # Asks reply to the message attached last; a many-topic Đối chiếu BE's citations are not reply targets.
    store.add_task("t2", A, 3, "/tmp/proj", "khác")
    ask_to = lambda: next(x["ask_to"] for x in client.get("/api/tasks").json() if x["id"] == "t2")  # noqa: E731
    assert ask_to() is None
    store.add_task_refs("t2", [(A, 98, ""), (A, 99, "")])
    store.add_task_refs("t2", [(A, 7, ""), (A, 8, "")], ask=False)
    assert ask_to() == {"chat_id": A, "message_id": "99", "qa": ""}
    store.add_task_refs("t2", [(A, 7, "#QA5")])  # attached by hand later: now a target (the newest row), code filled
    assert ask_to() == {"chat_id": A, "message_id": "7", "qa": "#QA5"}
    store.delete_task("t2")
    client.put("/api/tasks/t1/handled", json={"handled": False, "react": False}, headers=H)
    assert not store.get_message(A, 5).handled
    client.put("/api/tasks/t1/handled", json=done, headers=H)
    assert store.get_message(A, 4).handled and store.get_message(A, 5).handled
    # A #QA code in the tag / an attached message: that Q&A thread follows Done / reopen; a removed one stays removed.
    store.apply_message(msg(A, 6, "@me đã trả lời\n#QA11 #qa22"))
    store.add_task_refs("t1", [(A, 6, "")])
    store.set_qa_mark(A, "#QA22", "deleted")
    client.put("/api/tasks/t1/handled", json=done, headers=H)
    assert store.qa_marks(A) == {"#QA11": "done", "#QA22": "deleted"}
    client.put("/api/tasks/t1/handled", json={"handled": False, "react": False}, headers=H)
    assert store.qa_marks(A) == {"#QA22": "deleted"}
    # Done on the tag itself (the list / reply panel, not the session): the session's Q&A follows too.
    client.put(f"/api/chats/{A}/messages/4/handled", json=done, headers=H)
    assert store.qa_marks(A) == {"#QA11": "done", "#QA22": "deleted"}
    # Done / reopen on the tag from the list moves the session's attached messages too, as Done on the session does.
    client.put(f"/api/chats/{A}/messages/4/handled", json={"handled": False, "react": False}, headers=H)
    assert not store.get_message(A, 5).handled and "#QA11" not in store.qa_marks(A)
    client.put(f"/api/chats/{A}/messages/4/handled", json=done, headers=H)
    assert store.get_message(A, 5).handled and store.get_message(A, 6).handled
    # "Đã xử lý tất cả": the same follow-ups (Q&A of the tags, the sessions on them), without reactions.
    client.put(f"/api/chats/{A}/messages/4/handled", json={"handled": False, "react": False}, headers=H)
    assert client.post(f"/api/chats/{A}/handled-all", headers=H).json()["count"] >= 1
    assert store.get_message(A, 5).handled and store.qa_marks(A)["#QA11"] == "done"
    # A tag on no session with its own #QA code: Done / reopen on it moves that Q&A too.
    store.apply_message(msg(A, 7, "@me xem giúp\n#QA33"))
    client.put(f"/api/chats/{A}/messages/7/handled", json=done, headers=H)
    assert store.qa_marks(A)["#QA33"] == "done"
    client.put(f"/api/chats/{A}/messages/7/handled", json={"handled": False, "react": False}, headers=H)
    assert "#QA33" not in store.qa_marks(A)
    client.put("/api/tasks/t1/handled", json=done, headers=H)
    p = task_result_path(settings, "t1")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("Đã sửa crash login iOS, PR #42")
    t = client.get(f"/api/tasks?chat_id={A}").json()[0]
    assert t["message_id"] == "4" and t["result"].startswith("Đã sửa crash")
    assert t["prompt"] == "sửa bug login" and t["chat_title"] == "Alpha"
    assert client.delete("/api/tasks/t1", headers=H).status_code == 204
    assert client.get("/api/tasks").json() == [] and not p.exists()


def test_done_on_an_attached_message_closes_its_doing_sessions(client):
    store = client.app.state.store
    store.set_tracking(A, True, "Alpha", "supergroup")
    store.apply_message(msg(A, 4, "@me login crash"))  # t1's own tag
    store.apply_message(msg(A, 5, "@me BE: API đã sửa\n#QA44"))  # sent along to t1 and t2
    store.apply_message(msg(A, 6, "@me còn lỗi iOS"))  # t1's other attachment
    store.add_task("t1", A, 4, "/tmp/proj", "sửa bug login")
    store.add_task("t2", None, None, "/tmp/proj", "Đối chiếu BE")  # no tag: Done sits on the session
    store.add_task_refs("t1", [(A, 5, "#QA44"), (A, 6, "")])
    store.add_task_refs("t2", [(A, 5, ""), (A, 4, "")])  # t1 and t2 cite each other's messages: the cascade ends
    done = lambda: {x["id"]: x["handled"] for x in client.get("/api/tasks").json()}  # noqa: E731
    assert done() == {"t1": False, "t2": False}
    on, off = {"handled": True, "react": False}, {"handled": False, "react": False}
    assert client.put(f"/api/chats/{A}/messages/5/handled", json=on, headers=H).status_code == 204
    assert done() == {"t1": True, "t2": True}  # both sessions left Doing
    assert store.get_message(A, 4).handled and store.get_message(A, 6).handled  # their messages followed
    assert store.qa_marks(A) == {"#QA44": "done"}  # and their Q&A
    client.put(f"/api/chats/{A}/messages/6/handled", json=off, headers=H)  # reopening one attachment: sessions stay
    assert done() == {"t1": True, "t2": True}


def test_date_range_filters_lists(client):
    _seed(client.app.state.store)  # Beta tag on 10-29, Alpha tag on 10-30
    day = "since=2026-10-29T00:00:00Z&until=2026-10-30T00:00:00Z"
    assert [i["chat_title"] for i in client.get(f"/api/pending?{day}").json()] == ["Beta"]
    assert [c["title"] for c in client.get(f"/api/chats?{day}").json()["items"]] == ["Beta"]
    msgs = client.get(f"/api/chats/{A}/messages?{day}").json()["items"]
    assert msgs == []
    r = client.post(f"/api/chats/{B}/handled-all?{day}", headers=H).json()
    assert r == {"count": 1, "message_ids": [2]}


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
    assert client.post(f"/api/chats/{B}/handled-all", headers=H).json()["count"] == 1
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
        last = ev["items"][-1]["text"]
        assert "--model sonnet --effort medium" in last and "--permission-mode plan" in last and "--session-id" in last
        assert c.get("/api/tasks").json()[0]["running"] is False
        tiep = {"text": "tiếp", "refs": [{"chat_id": A, "message_id": "7"}]}
        assert c.post(f"/api/tasks/{task['id']}/message", json=tiep, headers=H).status_code == 204
        with c.app.state.store._conn() as db:  # attached messages kept with the session for its Done
            assert [tuple(r) for r in db.execute("SELECT chat_id, message_id FROM task_refs")] == [(A, 7)]
        for _ in range(100):
            ev = c.get(f"/api/tasks/{task['id']}/events").json()
            if len(ev["items"]) == 6 and not ev["running"]:
                break
            time.sleep(0.05)
        assert ev["items"][3] | {"at": 0} == {"kind": "user", "text": "tiếp", "mode": "plan", "at": 0}
        assert "--resume" in ev["items"][-1]["text"]
        assert "--permission-mode plan" in ev["items"][-1]["text"]
        # Accept edit: the plan task's next turn resumes the same session allowed to edit
        go = {"text": "làm đi", "edit": True}
        assert c.post(f"/api/tasks/{task['id']}/message", json=go, headers=H).status_code == 204
        for _ in range(100):
            ev = c.get(f"/api/tasks/{task['id']}/events").json()
            if len(ev["items"]) == 9 and not ev["running"]:
                break
            time.sleep(0.05)
        assert "--permission-mode acceptEdits" in ev["items"][-1]["text"] and "--resume" in ev["items"][-1]["text"]


def test_deep_thinking_runs_as_a_read_only_agent_session(tmp_path):
    import shlex
    import sys

    from conftest import FakeTransport, TestClient, create_app

    fake = tmp_path / "fake_claude.py"
    fake.write_text("import sys\nsys.stdin.read()\n")
    (tmp_path / "web" / "out").mkdir(parents=True)
    (tmp_path / "web" / "out" / "index.html").write_text("x")
    cfg = Settings(root=tmp_path, ai_agent_command="cat", ai_agent_project_command="pwd",
                   ai_task_command=f"{shlex.quote(sys.executable)} {shlex.quote(str(fake))}")  # fmt: skip
    proj = tmp_path / "proj"
    proj.mkdir()
    with TestClient(create_app(cfg, transport=FakeTransport()), base_url=ORIGIN) as c:
        store = c.app.state.store
        store.add_project(str(proj), "proj")
        store.set_tracking(A, True, title="Alpha", kind="supergroup")
        store.apply_message(msg(A, 4, "BE ơi API trả field gì?", outgoing=True))
        store.apply_message(msg(A, 5, "field là status", sender="8"))
        body = {"chat_id": A, "question_id": "4", "confirm_id": "5", "project": str(proj)}
        r = c.post("/api/ai/deep", json=body, headers=H)
        assert r.status_code == 200, r.text
        [t] = c.get("/api/tasks").json()
        assert (t["id"], t["kind"], t["mode"], t["message_id"]) == (r.json()["id"], "deep", "plan", "5")
        assert t["title"] == "Hỏi: BE ơi API trả field gì?\nBE: field là status" and "<confirm>" in t["prompt"]
        same = c.post("/api/ai/deep", json=body | {"confirm_id": "4"}, headers=H).json()
        assert same["error"]["code"] == "ai_scope_not_allowed"
        # in bulk: digest items (summary + cited ids) of one chat, one session anchored on the newest cited message
        items = [{"text": "Field status", "message_ids": ["4", "5"]}, {"text": "Gone", "message_ids": ["99"]}]
        r = c.post("/api/ai/deep-batch", json={"chat_id": A, "items": items, "project": str(proj)}, headers=H)
        assert r.status_code == 200, r.text
        t = next(t for t in c.get("/api/tasks").json() if t["id"] == r.json()["id"])
        assert (t["kind"], t["mode"], t["message_id"]) == ("deep", "plan", "5")  # one topic: its card shows it
        assert t["title"] == "Đối chiếu BE: Field status"  # the item whose messages are gone is left out
        assert "<items>" in t["prompt"] and "field là status" in t["prompt"] and "Gone" not in t["prompt"]
        # several topics, one waiting for BE: traced too, anchored on the newest cited message (asks post there)
        items = [{"text": "Field status", "message_ids": ["5"], "key": "5"},
                 {"text": "Có discount?", "message_ids": ["4"], "waiting": True}]
        r = c.post("/api/ai/deep-batch", json={"chat_id": A, "items": items, "project": str(proj)}, headers=H)
        t = next(t for t in c.get("/api/tasks").json() if t["id"] == r.json()["id"])
        assert t["message_id"] == "5" and t["title"] == "Đối chiếu 2 chủ đề BE: Field status"
        assert '"status": "waiting"' in t["prompt"] and "⏳ Chờ BE" in t["prompt"]
        assert t["prompt"].count('"id": "5"') == 1  # a topic's id rides along (its verdict maps back by it)
        bad = c.post("/api/ai/deep-batch", json={"chat_id": A, "items": [], "project": str(proj)}, headers=H)
        assert bad.status_code == 422
        # Done on the session: the tags it traced and the Q&A they name follow (not just the anchor)
        store.apply_message(msg(A, 6, "@me BE chốt status\n#QA55", sender="8"))
        store.apply_message(msg(A, 7, "@me thêm field type", sender="8"))
        items = [{"text": "Chốt status", "message_ids": ["6", "7"]}]
        tid = c.post("/api/ai/deep-batch", json={"chat_id": A, "items": items, "project": str(proj)}, headers=H)
        tid = tid.json()["id"]
        assert c.put(f"/api/tasks/{tid}/handled", json={"handled": True, "react": False}, headers=H).status_code == 204
        assert store.get_message(A, 6).handled and store.get_message(A, 7).handled
        assert store.qa_marks(A)["#QA55"] == "done"
        # a #QA code only in the prompt (cited messages read live, never stored) follows too
        store.add_task("d2", A, 999, str(proj), 'tin: "BE trả lời #QA66"', kind="deep")
        store.mark_task_qa("d2", True)
        assert store.qa_marks(A)["#QA66"] == "done"
        # an attached answer never stored: the code found up its chain when attached; attaching again never clears it
        store.add_task_refs("d2", [(A, 998, "#QA77")])
        store.add_task_refs("d2", [(A, 998, "")])
        store.mark_task_qa("d2", True)
        assert store.qa_marks(A)["#QA77"] == "done"
        # the ask the session posted (it names "#REF-<tail>" and its question's code): Done closes that Q&A too
        store.apply_message(msg(A, 997, "@be hỏi thêm?\n\n#REF-0000d2\n#QA88", outgoing=True))
        store.add_task("x-0000d2", A, 999, str(proj), "p")
        store.mark_task_qa("x-0000d2", True)
        assert store.qa_marks(A)["#QA88"] == "done"
        # the tags answering it (down the reply chain under its ask / Q&A question) follow its Done too, not mine
        def reply(mid, to, text, **kw):
            store.apply_message(msg(A, mid, text, **kw).model_copy(update={"reply_to_id": to}))

        reply(996, 997, "@me BE trả lời")
        reply(995, 996, "@me BE bổ sung")
        reply(994, 997, "mình hỏi lại", outgoing=True)
        store.apply_message(msg(A, 993, "@me tin khác"))
        assert sorted(store.mark_task_refs("x-0000d2", True, "quiet")[A]) == [995, 996]
        assert not store.get_message(A, 993).handled
        assert sorted(store.mark_task_refs("x-0000d2", False, "quiet")[A]) == [995, 996]
        # Xong on the Q&A page moves the thread's kept tags the same way (the asker's message the Q&A answered too)
        store.apply_message(msg(A, 980, "@me staging đâu?"))
        reply(981, 980, "@be đây nhé\n#QA90", outgoing=True)
        reply(982, 981, "@me cảm ơn")
        mark = {"chat_id": A, "code": "#QA90", "state": "done"}
        assert c.put("/api/qa/mark", json=mark, headers=H).status_code == 204
        assert store.get_message(A, 980).handled and store.get_message(A, 982).handled
        assert not store.get_message(A, 993).handled
        assert c.put("/api/qa/mark", json=mark | {"state": "deleted"}, headers=H).status_code == 204
        assert store.get_message(A, 982).handled  # removing it leaves the tags as they are
        assert c.put("/api/qa/mark", json=mark | {"state": None}, headers=H).status_code == 204
        assert store.get_message(A, 982).handled  # undoing the removal: was not Xong, nothing to reopen
        c.put("/api/qa/mark", json=mark, headers=H)
        c.put("/api/qa/mark", json=mark | {"state": None}, headers=H)
        assert not store.get_message(A, 980).handled and not store.get_message(A, 982).handled


def test_attached_ref_finds_its_qa_up_the_live_chain(tmp_path):
    import asyncio
    from types import SimpleNamespace

    from telegram_dashboard.storage import Db, Store
    from telegram_dashboard.tasks import add_refs

    st = Store(tmp_path / "db.sqlite3")
    # BE's answer (never stored) replies to the copied ask that carries the code
    answer = msg(A, 2, "trả lời").model_copy(update={"reply_to_id": 1})
    live = {1: msg(A, 1, "@be hỏi field?\n#QA42"), 2: answer}

    async def fetch_ids(chat_id, ids):
        if not live:
            raise ConnectionError("offline")
        return [live[i] for i in ids if i in live]

    async def run():
        db = Db(st, SimpleNamespace(notify=lambda: None))
        s = SimpleNamespace(store=st, db=db, bridge=SimpleNamespace(fetch_ids=fetch_ids))
        await add_refs(s, "t", [(A, "2")])
        live.clear()  # offline: the ref is still kept, only without a code
        await add_refs(s, "t", [(A, "3")])

    asyncio.run(run())
    with st._conn() as c:
        assert [tuple(r) for r in c.execute("SELECT message_id, qa FROM task_refs ORDER BY message_id")] == [
            (2, "#QA42"), (3, "")]


def test_snooze_until_reply_or_ticket_wakes_early(tmp_path):
    from datetime import UTC, datetime, timedelta

    from telegram_dashboard.models import StoredMessage
    from telegram_dashboard.storage import Store

    st = Store(tmp_path / "db.sqlite3")
    st.set_tracking("c1", True, "G", "group")
    t0 = datetime(2026, 11, 1, tzinfo=UTC)

    def msg(mid, reply=None, out=False):
        return StoredMessage(chat_id="c1", message_id=mid, sender_id="9", sender_name="A", text=f"m{mid}", date=t0,
                             edit_date=None, reply_to_id=reply, topic_id=None, outgoing=out, media_kind=None,
                             deleted=False)

    for m in (msg(1), msg(2), msg(3, reply=1, out=True)):
        st.apply_message(m)
    later = datetime.now(UTC) + timedelta(days=7)
    st.set_snooze("c1", 1, later, "reply")
    st.set_snooze("c1", 2, later, "ticket:VA-7")
    assert st.ticket_snoozes() == ["VA-7"]
    st.apply_message(msg(4, reply=3))  # answers my reply to tag 1
    assert st.get_message("c1", 1).snoozed_until is None and st.get_message("c1", 2).snoozed_until is not None
    assert st.wake_ticket("VA-7") == 1 and st.get_message("c1", 2).snoozed_until is None
    st.set_snooze("c1", 1, later, "reply")
    st.wake_on_reply("c1", 2)  # a reply to another tag wakes nothing
    assert st.get_message("c1", 1).snoozed_until is not None
    st.wake_on_reply("c1", 1)  # an untagged reply (never kept) to the tag itself
    assert st.get_message("c1", 1).snoozed_until is None
    # reopening a done tag drops a snooze left from before, or it would be in no list at all
    st.set_snooze("c1", 2, later)
    st.set_handled("c1", 2, True)
    st.set_handled("c1", 2, False)
    assert st.get_message("c1", 2).snoozed_until is None


def test_loop_back_api_import_list_skip(client):
    item = {"ticket": "VA-2", "state": "Done", "chat_id": "c1", "message_id": "5"}
    assert client.post("/api/loopback/import", json={"items": [item, item]}, headers=H).json() == {"added": 1}
    assert client.get("/api/loopback").json() == {"items": [item], "error": ""}
    assert client.post("/api/loopback/done", json={"chat_id": "c1", "message_id": "5"}, headers=H).status_code == 204
    assert client.get("/api/loopback").json()["items"] == []
    again = client.post("/api/loopback/import", json={"items": [item]}, headers=H)
    assert again.json() == {"added": 0}  # skipped stays skipped
