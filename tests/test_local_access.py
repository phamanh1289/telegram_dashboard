from conftest import CODE, ORIGIN, unlock


def test_private_api_requires_cookie(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/api/status").status_code == 401
    unlock(client)
    assert client.get("/api/status").status_code == 200


def test_cross_origin_mutation_rejected(client):
    for headers in ({"Origin": "http://evil.test"}, {}, {"Origin": "http://localhost:8765"}):
        r = client.post("/api/unlock", json={"code": CODE}, headers=headers)
        assert r.status_code == 403
    unlock(client)
    # cookie alone is not enough for a cross-site read either
    assert client.get("/api/status", headers={"Origin": "http://evil.test"}).status_code == 403


def test_invalid_host_rejected(client):
    for host in ("localhost:8765", "evil.test", "127.0.0.1:3000"):
        assert client.get("/health", headers={"Host": host}).status_code == 400


def test_unlock_rate_limited(client):
    for _ in range(5):
        r = client.post("/api/unlock", json={"code": "nope"}, headers={"Origin": ORIGIN})
        assert r.status_code == 401
    r = client.post("/api/unlock", json={"code": CODE}, headers={"Origin": ORIGIN})
    assert r.status_code == 429
    assert "retry-after" in r.headers


def test_api_404_is_not_static_html(client):
    unlock(client)
    r = client.get("/api/missing")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    assert client.get("/").text == "<html>shell</html>"


def test_no_store_headers(client):
    assert client.get("/api/status").headers["cache-control"] == "private, no-store"
    unlock(client)
    r = client.get("/api/status")
    assert r.headers["cache-control"] == "private, no-store"
    assert r.json()["state"] in {"connected", "connecting"}
