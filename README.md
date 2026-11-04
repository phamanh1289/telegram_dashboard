# Telegram Dashboard

Web local để tập trung tin nhắn nhóm, trả lời bằng tài khoản Telegram cá nhân và dùng AI hỗ trợ soạn nháp (tùy chọn, mặc định tắt).

- Frontend: Next.js (App Router, static export) + React + TypeScript, Tailwind v4, shadcn/ui (Base UI), Motion, TanStack Query.
- Backend: FastAPI + Telethon + SQLite (WAL) trong một Python process; REST + SSE.
- Bản build: FastAPI phục vụ cả UI tĩnh và `/api` tại `http://127.0.0.1:8765`. Static export vẫn là app Next/React tương tác, chỉ là không có Next server lúc chạy; API, cookie và Telegram đều thuộc Python.

Hai module độc lập, chuyển qua lại bằng link trên header (crossfade bằng View Transitions):

- **Telegram Inbox** tại `/`.
- **Cài đặt** tại `/settings/` (nhóm Chung / Telegram / YouTrack / AI / GitHub / Phím tắt, `#nhóm` trên URL).
- **YouTrack Dashboard** tại `/youtrack/` (React, `web/src/components/yt/`; bản vanilla JS cũ vẫn ở `/yt/`, `web/public/yt/`) + API `/api/yt/*` (`telegram_dashboard/yt_dashboard.py`, cache 50s, gộp request trùng, tải trang song song). Dùng chung `YOUTRACK_URL` / `YOUTRACK_TOKEN` (không cần `YOUTRACK_PROJECT`); tùy chọn `YT_HISTORY_DAYS`, `YT_WIP`, `YT_STALE`, `YT_DEAD`. Thiếu token thì hiện dữ liệu mẫu.

Tài liệu: [plan](docs/superpowers/plans/2026-10-29-local-web-implementation.md) · [thiết kế](docs/superpowers/specs/2026-10-29-local-web-design.md) · [rà stack](docs/decisions/2026-10-29-stack-review.md) · [nghiệm thu](docs/verification/local-web-smoke.md).

## Bản cài cho người dùng

Người dùng cuối tải bộ cài ở [GitHub Releases](https://github.com/phamanh1289/telegram_dashboard/releases/latest) (Windows `…-setup.exe`, macOS: lệnh `curl … install-macos.sh | bash`), không cần Python/Node/git: **[docs/INSTALL.md](docs/INSTALL.md)**. Cập nhật ngay trong Cài đặt › GitHub. Phát hành bản mới: skill `/release` (`.claude/skills/release/SKILL.md`) → tag `vX.Y.Z` → CI `.github/workflows/release.yml` đóng gói cả hai OS (`scripts/package.py`, `packaging/`).

## Cài đặt từ clone sạch

> Hướng dẫn chi tiết từng bước cho macOS và Windows: **[docs/SETUP.md](docs/SETUP.md)**. Windows: double-click `Start Dashboard Telegram.bat`.

Yêu cầu: Python 3.14 + [uv](https://docs.astral.sh/uv/), Node 24 LTS (khuyến nghị ≥ 24.22.1, xem `.node-version`).

```bash
uv sync --locked
```

```bash
npm ci
```

Không cần `.env`: lần đầu mở dashboard, **Cài đặt › Telegram** tự mở để dán API ID/Hash (https://my.telegram.org/apps) rồi đăng nhập (số điện thoại → mã → 2FA). Lưu ở `data/config.json` (0600), thắng `.env`. `.env` (từ `.env.example`) chỉ cho tùy chỉnh nâng cao. Vẫn đăng nhập được bằng terminal: `uv run python -m telegram_dashboard login`. Session lưu ở `data/account.session` (quyền 0600, thư mục `data/` 0700, đã gitignore). Không gửi mã/2FA cho ai, kể cả agent.

## Chạy bản build (một process)

```bash
npm run build
```

```bash
npm start
```

Trên macOS có thể double-click `Start Dashboard Telegram.command`: script tự cài dependencies nếu thiếu, build lại UI khi cần, chạy server nền và mở trình duyệt. Trong cửa sổ đó bấm một số (không cần Enter; Esc thoát): **1** start · **2** stop · **3** restart (tự build lại UI nếu code đổi) · **4** mở trình duyệt · **5** xem log (`data/server.log`) · **0** thoát. Đóng cửa sổ cũng dừng server.

Mở `http://127.0.0.1:8765` (không cần mã; chỉ loopback, Host/Origin được kiểm tra). Phải dùng `127.0.0.1`; mở bằng `localhost` sẽ sai Origin nên mọi thao tác bị từ chối.

## Chạy chế độ dev

```bash
npm run dev
```

Next dev ở `http://127.0.0.1:3000` (proxy `/api` sang Python `:8765`), Python nhận `APP_ORIGIN=http://127.0.0.1:3000`. Ctrl+C dừng cả hai. Port 3000 phải trống.

## Sử dụng

1. Không cần chọn nhóm: khi có người **tag** (hoặc reply) bạn trong nhóm, tin đó hiện ngay trong dashboard qua luồng cập nhật Telegram. Chỉ tin tag bạn (và tin bạn trả lời) được lưu; không nạp lịch sử.
2. **Trả lời** một tin → soạn → **Gửi** hoặc Ctrl/Cmd+Enter (Enter xuống dòng). Nếu kết quả "chưa rõ", dùng **Kiểm tra** hoặc **Thử lại cùng yêu cầu** (dùng lại cùng `random_id`, Telegram không tạo tin thứ hai). Ứng dụng không bao giờ tự gửi lại.
3. **Nhờ AI** (khi đã bật AI): bấm **Trả lời** một tin → khung "Nhờ AI" hiện ra → chọn **dự án** (nút **Thêm** mở Finder để chọn thư mục) → nhập **prompt** → Enter hoặc **AI xử lý**. AI trả 3 mẫu: bấm mẫu để đưa vào khung soạn, hoặc ➤ để gửi ngay.
   - Có dự án: agent chạy trong thư mục đó với quyền **chỉ đọc** (Read/Grep/Glob).
   - **Tạo task** (AI Agent): chạy `claude -p` không giao diện trong dự án, xem và nhắn tiếp ngay trên dashboard. Chế độ **plan** chỉ đọc; **edit** được sửa file (trừ `.claude/`, `.git/`, `.github/`). Luôn tắt shell, web và MCP.
4. **Việc cần xử lý** (mục đầu danh sách, mặc định khi mở): mọi tin tag chưa xử lý của mọi nhóm, chờ lâu nhất lên đầu, nhãn "chờ X giờ" (đỏ khi quá 4 giờ). Tiêu đề tab hiện số tin chờ; tag mới có thông báo macOS (`NOTIFY=0` để tắt).
   - Tin được coi là **đã xử lý** khi bạn reply nó (từ dashboard, điện thoại hay máy khác) hoặc bấm ✓. Mỗi tin còn có: 💬 **ngữ cảnh** (~15 tin trước/sau, lấy trực tiếp từ Telegram), ⏰ **nhắc lại sau** (1 giờ / 3 giờ / 9:00 sáng mai) hoặc **luôn bỏ qua người gửi**, link **Telegram**, ảnh trong tin.
   - **Quy tắc tự bỏ qua** (biểu tượng phễu): từ khóa như `#TB` hoặc người gửi; tin khớp tự chuyển "đã xử lý", không báo.
   - **Tóm tắt**: AI liệt kê việc tồn theo mức gấp. **Phím tắt**: `j`/`k` chọn tin, `r` trả lời, `x` xong, `a` nhờ AI, `Esc` thoát.
   - Khi nhờ AI: mỗi nhóm nhớ dự án riêng; có **prompt mẫu** (lưu thêm được); **Kèm ngữ cảnh nhóm** gửi thêm tin xung quanh; ảnh trong tin được AI đọc. **Tạo task** gắn với tin: agent ghi kết quả vào file, dashboard hiện ngay dưới tin kèm nút "Dùng kết quả làm nháp trả lời". **YouTrack** (nếu cấu hình `YOUTRACK_*`) tạo ticket rồi chèn link vào khung trả lời; **AI soạn** điền sẵn tiêu đề, Type / Priority và mô tả theo mẫu. Tin không có mã ticket hiện các ticket đang mở có vẻ liên quan (+ chèn link). Nháp AI nhớ bạn là cấp gì với từng người gửi và bắt chước giọng các tin bạn từng gửi trong nhóm (khi `AI_REQUIRE_CONSENT=0`).
5. Muốn thu hồi session Telegram: Telegram → Settings → Devices → kết thúc phiên, rồi xóa `data/account.session`; app sẽ báo `login_required`.

## AI (tùy chọn)

Mọi tính năng AI (nháp, tóm tắt, Digest, Tạo task) đều chạy qua **Claude Code CLI** (`claude`) trên máy, dùng tài khoản claude.ai đã đăng nhập (`claude auth status`); không cần API key hay gateway. Thiếu `claude` trên PATH thì inbox vẫn chạy, chỉ tắt AI.

- Nháp/tóm tắt/Digest: `AI_AGENT_COMMAND` (mặc định `claude -p --tools ""`: prompt qua stdin, kết quả qua stdout, tắt công cụ để nội dung chat không thể thực thi gì; timeout 180s), model `AI_MODEL` (mặc định `haiku`, effort `AI_EFFORT` mặc định `medium`; Task/AI Agent mặc định `sonnet`; model/effort chọn trong Cài đặt → Tài khoản Claude sẽ được ưu tiên).
- Có dự án hoặc tin có ảnh: `AI_AGENT_PROJECT_COMMAND` (chỉ Read/Grep/Glob).
- Tạo task: `AI_TASK_COMMAND` / `AI_TASK_MODEL` / `AI_TASK_EFFORT`. AI YouTrack đọc trên 10 ticket cũng chạy bằng model này.
- Nháp và AI YouTrack hiện chữ dần trong lúc Claude viết (stream-json, chỉ khi lệnh là `claude`).
- YouTrack Dev › **AI: việc tôi đã nhận**: các việc bạn đã hứa trong tin Telegram 7 ngày qua (cần `AI_REQUIRE_CONSENT=0`). Lead › AI brief nói thêm phần thay đổi từ lần brief trước.
- Nháp AI biết mention nào là bạn: tự lấy @username của tài khoản đang đăng nhập (`TELEGRAM_ME` để ghi đè).
- **Codex / Antigravity** thay cho Claude: Cài đặt › AI › *Dùng AI nào* — một lựa chọn cho mọi tính năng AI (nháp, tóm tắt, Digest, YouTrack, Task, AI Agent). Mỗi AI giữ model/effort riêng (`data/claude.json` › `by`), đổi qua lại không mất; danh sách model lấy từ CLI (Claude: haiku/sonnet/opus/fable; Codex: `~/.codex/models_cache.json`; Antigravity: danh sách `agy models`, mức suy luận nằm trong tên model nên không có effort). Cần CLI trên PATH (`npm i -g @openai/codex`; Antigravity CLI `agy`; đổi lệnh bằng `CODEX_COMMAND` / `ANTIGRAVITY_COMMAND`) và đã đăng nhập (Codex: nút Đăng nhập mở trình duyệt; Antigravity: mở Terminal chạy `agy`, đăng nhập Google). Gemini CLI không còn dùng vì Google đã khóa đăng nhập bằng tài khoản cá nhân cho nó. Codex chạy sandbox `read-only` (Task sửa file: `workspace-write`), nháp thì tắt shell; Antigravity chạy custom agent `telegram-dashboard-read` / `-edit` (app tự ghi vào `~/.gemini/antigravity-cli/agents/`) chỉ có tool đọc/sửa file, cộng luật `--settings` chặn shell, MCP và web (Task sửa file: `--mode accept-edits`). Hạn mức và tự hạ model chỉ có ở Claude. Task đang dở tiếp tục bằng CLI và lựa chọn của AI đã bắt đầu nó.
- Các lệnh `claude` không nhận biến môi trường `TELEGRAM_*`, `YOUTRACK_*`, `YT_*`.

Tắt *Hỏi trước khi AI đọc tin Telegram* (Cài đặt › AI) hoặc `AI_REQUIRE_CONSENT=0` để bỏ bước cấp quyền từng tin (chỉ dùng cá nhân).

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
