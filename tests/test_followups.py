from datetime import UTC, datetime, timedelta

from conftest import ORIGIN, A, B, msg

H = {"Origin": ORIGIN}


def _tag(store, chat, mid, sender, at):
    m = msg(chat, mid, f"@me {mid}", sender=sender)
    m.date = at
    store.apply_message(m)


def test_remind_reopens_a_handled_tag_later(client):
    store = client.app.state.store
    store.set_tracking(A, True, "Alpha", "supergroup")
    _tag(store, A, 1, "5", datetime(2026, 10, 30, 8, tzinfo=UTC))
    client.put(f"/api/chats/{A}/messages/1/handled", json={"handled": True}, headers=H)
    assert client.get("/api/pending").json() == []
    later = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    r = client.put(f"/api/chats/{A}/messages/1/remind", json={"until": later}, headers=H)
    assert r.status_code == 200 and r.json() == {"was": "me"}
    m = store.get_message(A, 1)
    assert not m.handled and m.handled_by == "" and m.snoozed_until is not None
    assert client.get("/api/pending").json() == []  # hidden until then
    # Undo puts back how it was done, quietly (no cascade to its Q&A / sessions)
    client.put(f"/api/chats/{A}/messages/1/remind", json={"until": None, "restore": "me"}, headers=H)
    m = store.get_message(A, 1)
    assert m.handled and m.handled_by == "me" and m.snoozed_until is None
    client.put(f"/api/chats/{A}/messages/1/remind", json={"until": later}, headers=H)
    client.put(f"/api/chats/{A}/messages/1/remind", json={"until": None}, headers=H)
    assert [i["message"]["message_id"] for i in client.get("/api/pending").json()] == ["1"]
    assert client.put(f"/api/chats/{A}/messages/9/remind", json={"until": None}, headers=H).status_code == 404


def test_priority_sender_sorts_first_and_replaces_ignore(client):
    store = client.app.state.store
    store.set_tracking(A, True, "Alpha", "supergroup")
    _tag(store, A, 1, "5", datetime(2026, 10, 29, 8, tzinfo=UTC))  # oldest
    _tag(store, A, 2, "9", datetime(2026, 10, 30, 8, tzinfo=UTC))
    r = client.post("/api/rules", json={"kind": "priority", "value": "9", "label": "Boss"}, headers=H).json()
    assert r["handled"] == 0 and r["rule"]["kind"] == "priority"
    items = client.get("/api/pending").json()
    assert [(i["message"]["message_id"], i["message"]["priority"]) for i in items] == [("2", True), ("1", False)]
    _tag(store, A, 3, "9", datetime(2026, 10, 31, 8, tzinfo=UTC))  # a new tag from them is flagged on arrival
    assert store.get_message(A, 3).priority
    # ignoring the same sender drops the priority rule (and clears their tags)
    client.post("/api/rules", json={"kind": "sender", "value": "9", "label": "Boss"}, headers=H)
    assert [x["kind"] for x in client.get("/api/rules").json()] == ["sender"]
    assert not store.get_message(A, 2).priority
    client.post("/api/rules", json={"kind": "priority", "value": "5", "label": "PO"}, headers=H)
    rid = next(x["id"] for x in client.get("/api/rules").json() if x["kind"] == "priority")
    client.delete(f"/api/rules/{rid}", headers=H)
    assert not store.get_message(A, 1).priority


def test_week_stats(client):
    store = client.app.state.store
    store.set_tracking(A, True, "Alpha", "supergroup")
    store.set_tracking(B, True, "Beta", "supergroup")
    now = datetime.now(UTC)
    for mid, chat, ago in ((1, A, 2), (2, A, 2), (3, B, 3), (4, B, 10)):  # days ago; 4 is last week
        _tag(store, chat, mid, "5", now - timedelta(days=ago))
    with store._conn(write=True) as c:  # handled 30 / 90 / 60 min after the tag, by reply / Xong / rule
        for mid, by, after in ((1, "reply", 30), (2, "me", 90), (3, "rule", 5), (4, "dashboard", 60)):
            c.execute("UPDATE messages SET handled=1, handled_by=?, handled_at=date+? WHERE message_id=?",
                      (by, after * 60, mid))  # fmt: skip
    s = client.get("/api/stats/week").json()
    assert s["cur"] | {"median_min": 0} == {"received": 3, "handled": 2, "replied": 1, "marked": 1, "auto": 1,
                                            "median_min": 0, "p90_min": 90}  # fmt: skip
    assert s["cur"]["median_min"] == 60 and s["prev"]["received"] == 1 and s["prev"]["median_min"] == 60
    assert s["slow"] == [{"chat_id": A, "title": "Alpha", "handled": 2, "median_min": 60}]
