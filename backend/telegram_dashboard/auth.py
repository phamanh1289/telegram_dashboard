import hmac
import json
from http.cookies import CookieError, SimpleCookie
from urllib.parse import urlsplit

from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CROSS_SITE = {"cross-site", "same-site"}  # Sec-Fetch-Site of a request another page made
COOKIE_AGE = 400 * 86400  # browsers cap cookie lifetime at 400 days


def _json(status: int, code: str, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code}}, status_code=status,
                        headers={"Cache-Control": "private, no-store", **(headers or {})})  # fmt: skip


class LocalGuardMiddleware:
    """Host/Origin checks and no-store headers for /api. Pure ASGI so SSE is not buffered.
    `token`: /api also needs the `td_auth_<port>` cookie, which `POST /api/auth {token}` sets. Host/Origin only stop
    web pages; the token stops other local processes (an AI agent's shell, another OS user). The browser gets it
    once from a `?t=` link the server / launcher opens (the page posts it here); None = off (tests, fixtures)."""

    def __init__(self, app: ASGIApp, host_header: str, app_origin: str, token: str | None = None):
        self.app = app
        self.host_header = host_header
        self.app_origin = app_origin
        self.token = token
        self.cookie = f"td_auth_{host_header.rsplit(':', 1)[-1]}"  # per port: two installs never clash
        # The dev proxy (Next) rewrites Host; the browser's Host arrives as X-Forwarded-Host.
        self.forwarded_hosts = {host_header, urlsplit(app_origin).netloc}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        problem = None
        fwd = headers.get("x-forwarded-host")
        if headers.get("host") != self.host_header or (
            fwd is not None and fwd not in self.forwarded_hosts
        ):
            problem = (400, "invalid_host")  # DNS rebinding, also through the dev proxy
        elif headers.get("sec-fetch-site") in CROSS_SITE:  # <img>/no-cors GETs send no Origin
            problem = (403, "invalid_origin")
        else:
            origin = headers.get("origin")
            if scope["method"] not in SAFE_METHODS:
                if origin != self.app_origin:
                    problem = (403, "invalid_origin")
            elif origin is not None and origin != self.app_origin:
                problem = (403, "invalid_origin")
        if problem:
            return await _json(*problem)(scope, receive, send)

        is_api = scope["path"].startswith("/api")
        if self.token and is_api:
            if scope["path"] == "/api/auth":
                return await self._login(scope, receive, send)
            if not self._signed_in(headers.get("cookie", "")):
                return await _json(401, "auth_required")(scope, receive, send)

        async def send_wrapper(message: Message) -> None:
            if is_api and message["type"] == "http.response.start":
                hdrs = [(k, v) for k, v in message["headers"] if k.lower() != b"cache-control"]
                is_sse = any(
                    k.lower() == b"content-type" and v.startswith(b"text/event-stream")
                    for k, v in hdrs
                )
                value = b"private, no-store, no-transform" if is_sse else b"private, no-store"
                hdrs.append((b"cache-control", value))  # FastAPI SSE sets X-Accel-Buffering
                message = {**message, "headers": hdrs}
            elif message["type"] == "http.response.start" and scope["path"].startswith("/_next/static/"):
                # Content-hashed build output: a rebuild changes the names, so the browser never needs to revalidate.
                hdrs = [(k, v) for k, v in message["headers"] if k.lower() != b"cache-control"]
                message = {**message, "headers": [*hdrs, (b"cache-control", b"public, max-age=31536000, immutable")]}
            elif message["type"] == "http.response.start" and not scope["path"].startswith("/_next/"):
                # The page shell is not content-hashed: revalidate so a rebuilt UI shows up on reload.
                message = {**message, "headers": [*message["headers"], (b"cache-control", b"no-cache")]}
            await send(message)

        await self.app(scope, receive, send_wrapper)

    def _signed_in(self, cookie_header: str) -> bool:
        try:
            got = SimpleCookie(cookie_header).get(self.cookie)
        except CookieError:
            return False
        return got is not None and hmac.compare_digest(got.value.encode(), self.token.encode())

    async def _login(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["method"] != "POST":
            return await _json(405, "method_not_allowed")(scope, receive, send)
        body = b""
        while True:  # a token is ~43 chars: anything long is not one
            m = await receive()
            body += m.get("body", b"")
            if len(body) > 4096:
                return await _json(413, "too_large")(scope, receive, send)
            if not m.get("more_body"):
                break
        try:
            token = json.loads(body or b"{}").get("token")
        except (ValueError, AttributeError):
            token = None
        if not isinstance(token, str) or not hmac.compare_digest(token.strip().encode(), self.token.encode()):
            return await _json(401, "auth_invalid")(scope, receive, send)
        cookie = f"{self.cookie}={self.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={COOKIE_AGE}"
        resp = Response(status_code=204, headers={"Cache-Control": "private, no-store", "Set-Cookie": cookie})
        await resp(scope, receive, send)
