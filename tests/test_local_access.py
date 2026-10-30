from conftest import ORIGIN, msg


def test_cross_origin_requests_rejected(client):
    for headers in ({"Origin": "http://evil.test"}, {}, {"Origin": "http://localhost:8765"}):
        r = client.put("/api/chats/x/ai-permission", json={}, headers=headers)
        assert r.status_code == 403
    assert client.get("/api/status", headers={"Origin": "http://evil.test"}).status_code == 403
    assert client.get("/api/status", headers={"Origin": ORIGIN}).status_code == 200


def test_invalid_host_rejected(client):
    for host in ("localhost:8765", "evil.test", "127.0.0.1:3000"):
        assert client.get("/health", headers={"Host": host}).status_code == 400


def test_api_404_is_not_static_html(client):
    r = client.get("/api/missing")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    assert client.get("/").text == "<html>shell</html>"


def test_no_store_headers(client):
    r = client.get("/api/status")
    assert r.headers["cache-control"] == "private, no-store"
    assert r.json()["state"] in {"connected", "connecting"}


def test_toggle_handled(client):
    store = client.app.state.store
    store.track_mention("-1001", "Team", "supergroup")
    store.apply_message(msg("-1001", 7, "@me ?", sender="5"))
    url = "/api/chats/-1001/messages/7/handled"
    assert client.put(url, json={"handled": True}, headers={"Origin": ORIGIN}).status_code == 204
    chats = client.get("/api/chats").json()["items"]
    assert chats[0]["pending_count"] == 0
    page = client.get("/api/chats/-1001/messages?pending=true").json()
    assert page["items"] == []
    bad = client.put("/api/chats/-1001/messages/99/handled", json={"handled": True},
                     headers={"Origin": ORIGIN})  # fmt: skip
    assert bad.status_code == 404


def test_mark_all_handled_respects_since(client):
    from datetime import UTC, datetime

    store = client.app.state.store
    store.track_mention("-1001", "Team", "supergroup")
    old, new = msg("-1001", 1, "@me a", sender="5"), msg("-1001", 2, "@me b", sender="5")
    new.date = datetime(2026, 10, 30, tzinfo=UTC)
    store.apply_message(old)
    store.apply_message(new)
    h = {"Origin": ORIGIN}
    r = client.post("/api/chats/-1001/handled-all?since=2026-10-29T00:00:00Z", headers=h)
    assert r.json() == {"count": 1}
    assert client.get("/api/chats").json()["items"][0]["pending_count"] == 1
    assert client.post("/api/chats/-1001/handled-all", headers=h).json() == {"count": 1}
