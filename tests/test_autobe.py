import shlex
import sys
import time
from datetime import UTC, datetime

from conftest import ORIGIN, FakeTransport, TestClient, create_app
from telegram_dashboard import autobe
from telegram_dashboard.config import Settings
from telegram_dashboard.models import StoredMessage

A = "-100777"
H = {"Origin": ORIGIN}
FAKE = (  # a CLI turn: slow when the prompt says so, then a result naming its permission mode
    "import json, sys, time\n"
    "text = sys.stdin.read()\n"
    "time.sleep(1.0 if 'chậm' in text else 0)\n"
    "print(json.dumps({'type': 'result', 'result': 'ARGS ' + ' '.join(sys.argv[1:]), 'is_error': False}))\n"
)


def msg(mid, text, sender="5", reply=None, out=False):
    return StoredMessage(chat_id=A, message_id=mid, sender_id=None if out else sender, sender_name=None if out else
                         f"U{sender}", text=text, date=datetime.now(UTC), edit_date=None, reply_to_id=reply,
                         topic_id=None, outgoing=out, media_kind=None, deleted=False)  # fmt: skip


def test_be_answers_go_on_in_their_session_and_agent_rule_opens_one(tmp_path, monkeypatch):
    fake = tmp_path / "fake_claude.py"
    fake.write_text(FAKE)
    out = tmp_path / "web" / "out"
    out.mkdir(parents=True)
    (out / "index.html").write_text("x")
    cfg = Settings(root=tmp_path, ai_task_command=f"{shlex.quote(sys.executable)} {shlex.quote(str(fake))}")
    proj = tmp_path / "proj"
    proj.mkdir()
    with TestClient(create_app(cfg, transport=FakeTransport()), base_url=ORIGIN) as c:
        st, auto = c.app.state.store, c.app.state.autobe
        st.add_project(str(proj), "proj")
        st.set_tracking(A, True, "Team", "supergroup")

        def tasks():
            return c.get("/api/tasks").json()

        def turns(tid, n=1):  # the user turns, once at least `n` ran and the session is idle
            for _ in range(200):
                ev = c.get(f"/api/tasks/{tid}/events").json()
                users = [i for i in ev["items"] if i["kind"] == "user"]
                if len(users) >= n and not ev["running"] and ev["items"][-1]["kind"] == "result":
                    return users
                time.sleep(0.05)
            raise AssertionError("still running")

        def tag(m):  # as the bridge does for a new pending tag
            st.store_mentions([("Team", "supergroup", m, False)])
            c.portal.call(auto.on_tags, [m])

        # agent: a new tag from 88 opens a plan session on the rule's project; a rule needs a registered project
        assert c.post("/api/rules", json={"kind": "agent", "value": "88", "label": "BE TB", "project": "/nope"},
                      headers=H).status_code == 404  # fmt: skip
        r = c.post("/api/rules", json={"kind": "agent", "value": "88", "label": "BE TB", "project": str(proj),
                                        "role": "dev", "intro": "Android dev"}, headers=H).json()  # fmt: skip
        assert r["handled"] == 0 and r["rule"]["project"] == str(proj)
        tag(msg(1, "📢 BÁN V2: thêm reason_group", sender="88"))
        (t,) = tasks()
        assert (t["message_id"], t["mode"], t["project"]) == ("1", "plan", str(proj))
        first = turns(t["id"])[0]["text"]
        assert "Người gửi: U88" in first and "KHÔNG tin cậy" in first and "Android dev" in first
        tag(msg(1, "📢 BÁN V2: thêm reason_group", sender="88"))  # seen already: no second session
        assert len(tasks()) == 1

        # relay: 77's answer to the session's ask (up the reply chain: the ask names #REF-…) is its next turn
        c.post("/api/rules", json={"kind": "relay", "value": "77", "label": "BE HT"}, headers=H)
        ref = f"#REF-{t['id'][-6:]}"
        st.apply_message(msg(2, f"@be_bot hỏi reason_group?\n{ref}", reply=1, out=True))
        tag(msg(3, "@me reason_group có trên dev", sender="77", reply=2))
        relayed = turns(t["id"], 2)[-1]
        assert relayed["text"].startswith("[Tự động] U77 đã trả lời") and relayed["mode"] == "plan"  # never edited
        assert "[#3] U77" in relayed["text"] and "> @me reason_group có trên dev" in relayed["text"]
        assert "KHÔNG tin cậy" in relayed["text"]
        with st._conn() as db:  # attached: the session's Done takes it along
            assert (A, 3) in [tuple(x) for x in db.execute("SELECT chat_id, message_id FROM task_refs")]
        tag(msg(4, "@me ngoài lề", sender="66", reply=2))  # no relay rule for 66: stays a tag
        tag(msg(5, "@me cũng ngoài lề", sender="77"))  # no session up its chain
        assert len(turns(t["id"])) == 2

        # the user let a turn edit (and it runs slow): the answer that comes meanwhile waits, then may edit too
        slow = c.post(f"/api/tasks/{t['id']}/message", json={"text": "chậm", "edit": True}, headers=H)
        assert slow.status_code == 204
        tag(msg(6, "@me thêm ý 2", sender="77", reply=2))
        assert auto.pending.get(t["id"])
        last = turns(t["id"], 4)
        assert len(last) == 4 and [x["mode"] for x in last[-2:]] == ["edit", "edit"] and "[#6] U77" in last[-1]["text"]
        assert not auto.pending.get(t["id"]) and auto.error == ""

        assert last[-1].get("auto") is True and "auto" not in last[-2]  # the log tells whose turn it was

        # quota at the threshold: the answer waits (kept in the DB: a restart reads it back), runs once quota is back
        monkeypatch.setattr(autobe, "quota_now", lambda _settings: {"5h": 85.0})
        tag(msg(7, "@me thêm ý 3", sender="77", reply=2))
        assert auto.pending.get(t["id"]) and auto.error.startswith("tạm dừng, quota Claude 5h 85%")
        held = c.get(f"/api/tasks/{t['id']}/events").json()["items"]
        assert sum(i["kind"] == "user" for i in held) == 4 and "Vòng BE tạm dừng" in held[-1]["text"]  # said why
        assert [m.message_id for m in st.auto_pending()[t["id"]]] == [7]  # what AutoBe.restore reads at the next start
        monkeypatch.setattr(autobe, "quota_now", lambda _settings: {})
        c.portal.call(auto.flush, t["id"])
        assert "[#7] U77" in turns(t["id"], 5)[-1]["text"] and auto.error == "" and st.auto_pending() == {}

        # Done: no more relays into it
        c.put(f"/api/tasks/{t['id']}/handled", json={"handled": True, "react": False}, headers=H)
        tag(msg(8, "@me còn nữa", sender="77", reply=2))
        assert len(turns(t["id"])) == 5

        # relay + a Q&A thread no open session holds: the answer opens a plan session on the rule's project (the
        # question attached); the thread's next answer goes on in that session, not a second one
        c.post("/api/rules", json={"kind": "relay", "value": "77", "label": "BE HT", "project": str(proj)}, headers=H)
        st.apply_message(msg(20, "@be_bot field X có chưa?\n#QA_BE_123", out=True))
        tag(msg(21, "@me field X có rồi", sender="77", reply=20))
        (q,) = [x for x in tasks() if x["id"] != t["id"]]
        assert (q["message_id"], q["mode"], q["project"]) == ("21", "plan", str(proj))
        first = turns(q["id"])[0]["text"]
        assert "field X có rồi" in first and "[#20] Bạn" in first and "#QA_BE_123" in first
        tag(msg(22, "@me thêm: field Y cũng có", sender="77", reply=20))
        assert len(tasks()) == 2 and "[#22] U77" in turns(q["id"], 2)[-1]["text"]

        # Xóa dữ liệu nhóm: the sessions holding the group's messages go with it (row, log, result)
        log = cfg.data_dir / "tasks" / f"{t['id']}.log.jsonl"
        assert log.is_file()
        assert c.delete(f"/api/chats/{A}/data", headers=H).status_code == 204
        assert tasks() == [] and not log.exists() and not list(log.parent.glob(f"{t['id']}*"))
