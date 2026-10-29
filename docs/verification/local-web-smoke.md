# Nghiệm thu web local — bằng chứng kiểm tra

Ngày: 2026-10-29. Nhánh `feat/local-web`. Máy: macOS arm64, Python 3.14.6 (uv 0.11.27), Node 24.14.1 (chưa phải bản security 24.22.1 khuyến nghị — runtime toàn máy không được nâng).

Toàn bộ kiểm tra dưới đây dùng dữ liệu giả, Telegram giả và AI giả. **Chưa có kiểm tra nào trên tài khoản Telegram thật.**

## Gate tự động

| Gate | Kết quả |
|---|---|
| `uv run pytest -q` | pass — 52 tests (local access 6, storage/sync 15, send 13, events 8, AI 10) |
| `uv run ruff check .` / `ruff format --check` | pass |
| `uv pip check`, `uv lock --check` | pass |
| `npm run api:types` + diff | pass, không drift |
| `npm run typecheck` (TS 5.9.3 strict) | pass |
| `npm run lint` (ESLint 10.13 + eslint-config-next 16.4.3) | pass |
| `npm run build` (Next 16.4.3 static export) | pass — chỉ route `/` và `/_not-found` |
| `npm run test:e2e` (Playwright 1.64.1, Chromium headless) | pass — 10 tests; 3 lần chạy gần nhất đều pass |
| `git check-ignore` `.env`, `data/*.session`, `data/*.sqlite3*`, `.venv/`, `web/out/`, `web/.next/`, `node_modules/`, Playwright output, `work/` | tất cả bị ignore |
| `git diff --check`, quét pattern secrets trên file mới | sạch |

## Smoke thủ công (dữ liệu giả)

| Kiểm tra | Kết quả |
|---|---|
| Build mode qua fixture backend: unlock → chọn nhóm → 50 tin → XSS hiển thị dạng text | pass |
| SSE trực tiếp: tin mới, sửa, xóa hiện ngay; tự cuộn khi đang ở cuối | pass |
| Gửi reply bằng Cmd+Enter: tin xuất hiện đúng 1 lần, draft/target được xóa | pass |
| Dev proxy (Next `:3100` → FastAPI, APP_ORIGIN tương ứng): unlock 204, cookie `Path=/api` dùng được, cross-origin 403, không cookie 401, `private, no-store` | pass |
| SSE qua Next dev proxy: nhận event trước khi stream đóng; giữ kết nối 50 giây (3 heartbeat) | pass |
| Ctrl+C khi còn SSE mở | ban đầu **treo** (uvicorn chờ kết nối đóng) → sửa `timeout_graceful_shutdown=3`; sau sửa dừng trong 3 giây, không sót process |
| `npm run dev` khi port 3000 bị process khác chiếm | Next lỗi, supervisor dừng luôn Python, không sót process |
| `web/out` không chứa dữ liệu tài khoản hay key | pass (chỉ có nhãn UI) |

Ghi chú: smoke dev dùng port 3100 vì 3000 đang bị một process khác trên máy chiếm; `npm run dev` thật cần 3000 trống.

## Live checks (tài khoản thật)

| Kiểm tra | Trạng thái |
|---|---|
| `login` CLI với mã/2FA thật | not_run |
| Liệt kê nhóm, theo dõi một nhóm, đối chiếu tin mới với Telegram; nhóm không chọn không vào DB | not_run |
| Restart/mất mạng rồi recovery | not_run |
| Reply thật vào nhóm/tin/topic do người dùng chỉ định; duplicate click | not_run |
| FloodWait/SlowMode thật | not_run |
| AI với provider thật | not_run — chưa chọn provider/model và chưa có dữ liệu đủ điều kiện |

Các mục này cần người dùng đăng nhập trên máy và chỉ định nơi được phép gửi thử.

## Phát hiện khi thực thi

- Lỗi React key trùng giữa `MessageList` và `Composer` làm timeline nhân đôi khi đổi nhóm — Playwright bắt được, đã sửa.
- `npm audit`: 3 cảnh báo mức thấp (deepmerge) chỉ trong `shadcn` CLI (devDependency sinh component), không vào bundle runtime.
- `eslint-config-next` vẫn kéo ESLint 9 cho plugin nội bộ; ESLint 10.13 của workspace chạy được với cấu hình hiện tại.
