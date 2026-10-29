# Telegram Dashboard

Web local để tập trung tin nhắn nhóm, trả lời bằng tài khoản Telegram cá nhân và dùng AI hỗ trợ soạn nháp (tùy chọn, mặc định tắt).

- Frontend: Next.js (App Router, static export) + React + TypeScript, Tailwind v4, shadcn/ui (Base UI), Motion, TanStack Query.
- Backend: FastAPI + Telethon + SQLite (WAL) trong một Python process; REST + SSE.
- Bản build: FastAPI phục vụ cả UI tĩnh và `/api` tại `http://127.0.0.1:8765`. Static export vẫn là app Next/React tương tác, chỉ là không có Next server lúc chạy; API, cookie và Telegram đều thuộc Python.

Tài liệu: [plan](docs/superpowers/plans/2026-10-29-local-web-implementation.md) · [thiết kế](docs/superpowers/specs/2026-10-29-local-web-design.md) · [rà stack](docs/decisions/2026-10-29-stack-review.md) · [nghiệm thu](docs/verification/local-web-smoke.md).

## Cài đặt từ clone sạch

Yêu cầu: Python 3.14 + [uv](https://docs.astral.sh/uv/), Node 24 LTS (khuyến nghị ≥ 24.22.1, xem `.node-version`).

```bash
uv sync --locked
```

```bash
npm ci
```

```bash
cp .env.example .env
```

Điền `TELEGRAM_API_ID` và `TELEGRAM_API_HASH` (lấy tại https://my.telegram.org). Biến chỉ dùng ở backend, không bao giờ có tiền tố `NEXT_PUBLIC`.

## Đăng nhập Telegram (CLI, một lần)

```bash
uv run python -m telegram_dashboard login
```

Nhập số điện thoại, mã xác nhận và mật khẩu 2FA **trực tiếp trong terminal**. Session lưu ở `data/account.session` (quyền 0600, thư mục `data/` 0700, đã gitignore). Không gửi mã/2FA cho ai, kể cả agent.

## Chạy bản build (một process)

```bash
npm run build
```

```bash
npm start
```

Terminal in **mã mở khóa** (đổi mỗi lần chạy). Mở `http://127.0.0.1:8765` và nhập mã. Phải dùng `127.0.0.1`; mở bằng `localhost` sẽ sai Origin nên mọi thao tác bị từ chối.

## Chạy chế độ dev

```bash
npm run dev
```

Next dev ở `http://127.0.0.1:3000` (proxy `/api` sang Python `:8765`), Python nhận `APP_ORIGIN=http://127.0.0.1:3000`. Ctrl+C dừng cả hai. Port 3000 phải trống.

## Sử dụng

1. **Quản lý** → **Theo dõi** nhóm. Chỉ nhóm được chọn mới được lưu; khi bắt đầu chỉ nạp tối đa 50 tin gần nhất (không phải toàn bộ lịch sử).
2. **Trả lời** một tin → soạn → **Gửi** hoặc Ctrl/Cmd+Enter (Enter xuống dòng). Nếu kết quả "chưa rõ", dùng **Kiểm tra** hoặc **Thử lại cùng yêu cầu** (dùng lại cùng `random_id`, Telegram không tạo tin thứ hai). Ứng dụng không bao giờ tự gửi lại.
3. **Bỏ theo dõi** dừng thu thập; **Xóa dữ liệu** là thao tác riêng có xác nhận, xóa tin/nội dung chưa gửi trên máy. Tin đã/đang gửi tới Telegram không thu hồi được.
4. **Khóa** (logout) xóa phiên trình duyệt. Muốn thu hồi session Telegram: Telegram → Settings → Devices → kết thúc phiên, rồi xóa `data/account.session`; app sẽ báo `login_required`.

## AI (tùy chọn)

Đặt cả `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` trong `.env` (endpoint tương thích OpenAI Chat Completions, gọi từ backend bằng httpx, timeout 30s, không tự retry). Thiếu cấu hình thì inbox vẫn chạy bình thường.

Telegram API Terms hạn chế dùng dữ liệu Telegram với AI. App chỉ gửi những tin có **quyền dữ liệu** hợp lệ: đúng chat/tin/nội dung hiện tại, còn hạn, có phạm vi (draft/summary), và mỗi người gửi có tham chiếu bằng chứng đồng ý. Tin sửa/xóa tự mất quyền; không hỗ trợ media/forward. Đây là guard kỹ thuật, không phải chứng nhận pháp lý. AI chỉ trả văn bản; người dùng tự đưa vào khung soạn và bấm gửi.

## Kiểm tra

```bash
uv run pytest -q
```

```bash
uv run ruff check .
```

```bash
npm run api:types && npm run typecheck && npm run lint
```

```bash
npx playwright install chromium
```

```bash
npm run build && npm run test:e2e
```

E2E chạy với backend fixture độc lập (`web/tests/fixture_server.py`, dữ liệu giả, Telegram/AI giả, port 8765 và 8799), không cần credentials. Sau khi đổi DTO Python, chạy lại `npm run api:types` để sinh `web/src/lib/api.generated.d.ts`.

## Giới hạn đã biết

- Một tài khoản, một người dùng, chỉ loopback; chưa có desktop wrapper/VPS/media/agent tự động.
- Telegram không bảo đảm thông báo mọi lần xóa/sửa cũ; recovery chỉ lấy được tin mà tài khoản còn thấy.
- Nhóm thường nâng cấp supergroup: nhóm cũ bị đánh dấu đã chuyển và dừng thu thập; chọn lại nhóm mới.
- SQLite/session không được mã hóa riêng; dựa vào quyền file và mã hóa ổ đĩa. Xóa dữ liệu không cam kết xóa pháp y khỏi WAL/backup.
