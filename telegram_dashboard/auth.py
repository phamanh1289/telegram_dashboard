import secrets
import time

from fastapi import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import ApiError

COOKIE = "td_session"
SESSION_TTL = 12 * 3600
MAX_FAILS = 5
FAIL_WINDOW = 60
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class LocalAuth:
    def __init__(self, code: str | None = None):
        self.code = code or secrets.token_urlsafe(9)
        self._sessions: dict[str, float] = {}
        self._fails: list[float] = []

    def unlock(self, code: str) -> str:
        now = time.monotonic()
        self._fails = [t for t in self._fails if now - t < FAIL_WINDOW]
        if len(self._fails) >= MAX_FAILS:
            raise ApiError(
                429, "rate_limited", retry_after=int(FAIL_WINDOW - (now - self._fails[0])) + 1
            )
        if not secrets.compare_digest(code.encode(), self.code.encode()):
            self._fails.append(now)
            raise ApiError(401, "invalid_code")
        token = secrets.token_urlsafe(32)
        self._sessions[token] = now + SESSION_TTL
        return token

    def valid(self, token: str | None) -> bool:
        if not token:
            return False
        exp = self._sessions.get(token)
        if exp is None:
            return False
        if exp < time.monotonic():
            del self._sessions[token]
            return False
        return True

    def revoke(self, token: str | None) -> None:
        if token:
            self._sessions.pop(token, None)


def require_session(request: Request) -> str:
    auth: LocalAuth = request.app.state.auth
    token = request.cookies.get(COOKIE)
    if not auth.valid(token):
        raise ApiError(401, "unauthorized")
    return token  # type: ignore[return-value]


class LocalGuardMiddleware:
    """Host/Origin checks and no-store headers for /api. Pure ASGI so SSE is not buffered."""

    def __init__(self, app: ASGIApp, host_header: str, app_origin: str):
        self.app = app
        self.host_header = host_header
        self.app_origin = app_origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        problem = None
        if headers.get("host") != self.host_header:
            problem = (400, "invalid_host")
        else:
            origin = headers.get("origin")
            if scope["method"] not in SAFE_METHODS:
                if origin != self.app_origin:
                    problem = (403, "invalid_origin")
            elif origin is not None and origin != self.app_origin:
                problem = (403, "invalid_origin")
        if problem:
            resp = JSONResponse(
                {"error": {"code": problem[1]}}, status_code=problem[0],
                headers={"Cache-Control": "private, no-store"},
            )  # fmt: skip
            return await resp(scope, receive, send)

        is_api = scope["path"].startswith("/api")

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
            await send(message)

        await self.app(scope, receive, send_wrapper)
