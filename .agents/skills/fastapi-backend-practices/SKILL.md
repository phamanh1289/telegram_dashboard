---
name: fastapi-backend-practices
description: Use when writing or reviewing Python code under telegram_dashboard/ or tests/ — FastAPI endpoints, Pydantic models/DTOs, error codes, async I/O with Telethon/httpx, SSE streaming, SQLite storage, local-only security (Host/Origin guard), or pytest tests.
---

# FastAPI backend best practices (telegram_dashboard/)

## Hợp đồng API
- **Lỗi đã gặp trong repo này** (cache cũ, nuốt lỗi, gửi trùng, prompt injection, poll theo dòng…): đọc skill `avoiding-dashboard-pitfalls` trước khi báo xong.
- Endpoint khai báo trong `create_app()` (`app.py`), prefix `/api/…`, danh từ số nhiều, REST verb đúng nghĩa (`PUT` idempotent, `DELETE` trả 204).
- Request/response là Pydantic model trong `models.py` (`…Request`, `…DTO`, `…Page`). ID trên wire là **string** (`StoredMessage` nội bộ dùng int).
- Đổi model → frontend phải regen kiểu: `uv run python -m telegram_dashboard export-openapi` rồi `cd web && npm run api:types`. Quên bước này = lệch hợp đồng.
- Phân trang theo cursor (`before`, `limit`, `has_more`), không offset.

## Lỗi
- Lỗi nghiệp vụ: `raise ApiError(status, "snake_case_code")` (`errors.py`) → `{"error": {"code": …}}`. Frontend dựa vào `code`, không dựa vào message.
- Không để lộ traceback / chi tiết nội bộ; `detail` chỉ chứa tên lỗi an toàn (vd tên exception Telethon).
- `FloodWaitError` → 429 + `retry_after` (đã có handler). Không tự retry thao tác gửi tin.
- `raise … from None` khi chuyển đổi lỗi parse (xem `int_or_404`).

## Async
- Handler `async def`; mọi I/O dùng client async (`httpx.AsyncClient`, Telethon). Việc CPU / I/O chặn (subprocess, đọc file lớn) → `asyncio.to_thread`.
- Đường gọi thường xuyên (YouTrack, Telegram): dùng client do service giữ (mẫu `yt_dashboard.py`). Gọi hiếm (updater, quota) thì `async with httpx.AsyncClient()` tại chỗ là đủ.
- Task nền: giữ tham chiếu và hủy trong lifespan; bắt `CancelledError` để dọn dẹp rồi re-raise.
- SSE / stream: kiểm tra client ngắt (`client_gone`) để dừng sớm.

## Bảo mật (app chỉ chạy local nhưng vẫn là trust boundary)
- `LocalGuardMiddleware` (`auth.py`) kiểm Host/Origin/Sec-Fetch-Site và đặt `no-store` — **không bỏ qua, không nới** cho endpoint mới.
- Validate input bằng Pydantic (`Field(max_length=…)`, `Literal`), không tin path/query thô; đường dẫn file từ client → resolve và kiểm nằm trong thư mục cho phép.
- Bí mật (session Telegram, API hash, token) ở `data/` quyền 0600 (`write_private_json`); không log, không trả về API.
- Subprocess: truyền list args, không `shell=True` với dữ liệu người dùng.

## Storage
- Giá trị SQL luôn qua placeholder (`?` / `?1`); f-string chỉ cho tên cột từ whitelist trong code hoặc chuỗi `?,?,?` (mẫu ở `storage.py`). Ghi nhiều bước trong một transaction.

## Test (pytest, `asyncio_mode=auto`)
- Dùng fixture trong `tests/conftest.py` (`create_app` + fake `TelegramBridge`, helper `msg()`); request phải kèm `Origin` = `ORIGIN`.
- Test hành vi qua HTTP (`TestClient`), không test chi tiết private. Mỗi bug fix có một test tái hiện khi logic có nhánh / rủi ro.

## Quyết định stack (đừng tự đổi)
App desktop 1 người dùng, chỉ loopback, đóng gói zip/Setup.exe. Vì vậy **không thêm**: Granian/uvloop (không cần throughput), Redis + ARQ/SAQ/Celery (không có Redis; việc nền là `asyncio` task), Docker (không deploy server), LangGraph (agent chạy qua `Codex -p`, `agent.py`), loguru/structlog (stdlib `logging` ra `data/server.log` là đủ). Instructor/PydanticAI chỉ khi `parse_ticket`/`json_object` hỏng thường xuyên. Cần một trong số này → hỏi user trước.

## Xác minh
`uv run ruff check . && uv run pytest` (hoặc `uv run pytest tests/test_<module>.py` cho phần đã đổi).
