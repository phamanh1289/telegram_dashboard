from starlette.applications import Starlette
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient
from telegram_dashboard.auth import LocalGuardMiddleware

HOST, ORIGIN, TOKEN = "127.0.0.1:8765", "http://127.0.0.1:8765", "s3cret-token"


def _client(token):
    app = Starlette(routes=[
        Route("/api/status", lambda r: JSONResponse({"ok": True})),
        Route("/health", lambda r: PlainTextResponse("ok")),
        Route("/", lambda r: PlainTextResponse("shell")),
    ])  # fmt: skip
    app.add_middleware(LocalGuardMiddleware, host_header=HOST, app_origin=ORIGIN, token=token)
    return TestClient(app, base_url=ORIGIN, headers={"Host": HOST})


def test_api_needs_the_token_cookie_but_the_page_and_health_do_not():
    c = _client(TOKEN)
    assert c.get("/api/status").json() == {"error": {"code": "auth_required"}}
    assert c.get("/api/status").status_code == 401
    assert c.get("/").text == "shell" and c.get("/health").text == "ok"
    c.cookies.set("td_auth_8765", "wrong")
    assert c.get("/api/status").status_code == 401


def test_posting_the_token_sets_a_strict_http_only_cookie():
    c = _client(TOKEN)
    assert c.post("/api/auth", json={"token": "nope"}, headers={"Origin": ORIGIN}).status_code == 401
    assert c.post("/api/auth", json={"token": TOKEN}).status_code == 403  # no Origin: another site / process
    r = c.post("/api/auth", json={"token": TOKEN}, headers={"Origin": ORIGIN})
    assert r.status_code == 204
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("td_auth_8765=s3cret-token") and "HttpOnly" in cookie and "SameSite=Strict" in cookie
    assert c.get("/api/status").json() == {"ok": True}


def test_no_token_means_no_auth():
    assert _client(None).get("/api/status").json() == {"ok": True}


def test_the_page_carries_a_csp_that_breaks_nothing_it_uses():
    """Defence in depth for a page that shows other people's text: no plugins, no <base> hijack, never framed,
    forms post nowhere. No script-src: the static export boots with inline scripts."""
    page = _client(TOKEN).get("/").headers
    assert page["x-content-type-options"] == "nosniff" and page["referrer-policy"] == "same-origin"
    csp = page["content-security-policy"]
    for d in ("object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"):
        assert d in csp
    assert "content-security-policy" not in _client(TOKEN).get("/api/status").headers  # json, 401 here
