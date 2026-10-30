from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


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
            elif message["type"] == "http.response.start" and not scope["path"].startswith("/_next/"):
                # The page shell is not content-hashed: revalidate so a rebuilt UI shows up on reload.
                message = {**message, "headers": [*message["headers"], (b"cache-control", b"no-cache")]}
            await send(message)

        await self.app(scope, receive, send_wrapper)
