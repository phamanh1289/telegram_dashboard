# Radar

Web local để tập trung tin nhắn nhóm, trả lời bằng tài khoản Telegram cá nhân và dùng AI hỗ trợ soạn nháp (tùy chọn, mặc định tắt).

- Frontend: Next.js (App Router, static export) + React + TypeScript, Tailwind v4, shadcn/ui (Base UI), Motion, TanStack Query.
- Backend: FastAPI + Telethon + SQLite (WAL) trong một Python process; REST + SSE.
- Bản build: FastAPI phục vụ cả UI tĩnh và `/api` tại `http://127.0.0.1:8765`. Static export vẫn là app Next/React tương tác, chỉ là không có Next server lúc chạy; API, cookie và Telegram đều thuộc Python.

Hai module độc lập, chuyển qua lại bằng link trên header (crossfade bằng View Transitions):

- **Telegram Inbox** tại `/`.
- **Cài đặt** tại `/settings/` (nhóm Chung / Telegram / YouTrack / AI / GitHub / Phím tắt, `#nhóm` trên URL).
- **My Dashboard** (YouTrack) tại `/youtrack/` (React, `web/src/components/yt/`) + API `/api/yt/*` (`telegram_dashboard/yt_dashboard.py`, cache 50s, gộp request trùng, tải trang song song). Dùng chung `YOUTRACK_URL` / `YOUTRACK_TOKEN` (không cần `YOUTRACK_PROJECT`); tùy chọn `YT_HISTORY_DAYS`, `YT_WIP`, `YT_STALE`, `YT_DEAD`. Thiếu token thì trang chuyển sang Cài đặt › YouTrack để nhập.

Tài liệu: [plan](docs/superpowers/plans/2026-10-29-local-web-implementation.md) · [thiết kế](docs/superpowers/specs/2026-10-29-local-web-design.md) · [rà stack](docs/decisions/2026-10-29-stack-review.md) · [nghiệm thu](docs/verification/local-web-smoke.md).

## Cài đặt nhanh (người dùng)

Không cần Python/Node/git. Dán **một lệnh** (bấm nút copy góc phải khung lệnh) rồi Enter. Lệnh tải bản mới nhất, cài và mở app; chạy lại = cập nhật, dữ liệu giữ nguyên.

**macOS** (chip Apple): mở **Terminal** (Spotlight: gõ "Terminal"), dán:

```bash
curl -fsSL https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-macos.sh | bash
```

Cài vào `~/Applications/Telegram Dashboard`; lần sau mở **Radar** từ Spotlight / Launchpad. Hoặc mở Terminal mới, gõ `mydashboard start`.

**Windows 10/11**: bấm Start, gõ **PowerShell**, mở lên, dán:

```powershell
irm https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-windows.ps1 | iex
```

Cài vào `%LOCALAPPDATA%\Programs\Telegram Dashboard`, có shortcut **Radar** ở Start Menu và Desktop. Hoặc mở cmd/PowerShell mới, gõ `mydashboard start`.

Cài bằng lệnh để không bị macOS Gatekeeper / Windows SmartScreen chặn (app chưa ký số). Muốn tải tay thì lấy ở [GitHub Releases](https://github.com/phamanh1289/telegram_dashboard/releases/latest) và xem **[docs/INSTALL.md](docs/INSTALL.md)**. Lần đầu mở: dán Telegram API ID/Hash (https://my.telegram.org/apps) rồi đăng nhập. Cập nhật sau này: Cài đặt › GitHub.

Phát hành bản mới (cho người phát triển): skill `/release` (`.claude/skills/release/SKILL.md`) → tag `vX.Y.Z` → CI `.github/workflows/release.yml` đóng gói cả hai OS (`scripts/package.py`, `packaging/`) và ký từng gói bằng RSA (secret `RELEASE_SIGNING_KEY`; khóa công khai `telegram_dashboard/release_key.pem`). App chỉ tự cập nhật từ gói có chữ ký `.sig` hợp lệ; lệnh cài kiểm tra sha256 của gói.

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

Mở `http://127.0.0.1:8765` (bị chiếm thì server tự dùng port trống kế tiếp và in ra địa chỉ; dev mode thì không đổi; chỉ loopback, Host/Origin được kiểm tra). API chỉ nhận trình duyệt đã mở khóa: `npm start`, Start Dashboard và `mydashboard open` / `uv run python -m telegram_dashboard open` mở trang kèm mã một lần (`?t=…`, đổi thành cookie ~1 năm); bookmark ở trình duyệt chưa mở khóa sẽ hiện màn hình khóa (dán mã trong `~/.telegram_dashboard/api_token`). Nhờ vậy chương trình khác trên máy, kể cả AI Agent, không gọi được API để gửi tin thay bạn. Phải dùng `127.0.0.1`; mở bằng `localhost` sẽ sai Origin nên mọi thao tác bị từ chối.

## Chạy chế độ dev

```bash
npm run dev
```

Next dev ở `http://127.0.0.1:3000` (proxy `/api` sang Python `:8765`), Python nhận `APP_ORIGIN=http://127.0.0.1:3000`. Ctrl+C dừng cả hai. Port 3000 phải trống.

## Sử dụng

1. Không cần chọn nhóm: khi có người **tag** (hoặc reply) bạn trong nhóm, tin đó hiện ngay trong dashboard qua luồng cập nhật Telegram. Chỉ tin tag bạn (và tin bạn trả lời) được lưu; không nạp lịch sử.
2. **Trả lời**: bấm vào một tin (hoặc chọn bằng `j`/`k` rồi `Enter`) → soạn → **Gửi** hoặc Ctrl/Cmd+Enter (Enter xuống dòng). Nếu kết quả "chưa rõ", dùng **Kiểm tra** hoặc **Thử lại cùng yêu cầu** (dùng lại cùng `random_id`, Telegram không tạo tin thứ hai). Ứng dụng không bao giờ tự gửi lại.
3. **Nhờ AI** (khi đã bật AI): mở trả lời một tin → khung "Nhờ AI" hiện ra → chọn **dự án** (nút **Thêm** mở Finder để chọn thư mục) → nhập **prompt** → Enter hoặc **AI xử lý**. AI trả 3 mẫu: bấm mẫu để đưa vào khung soạn, hoặc ➤ để gửi ngay.
   - Có dự án: agent chạy trong thư mục đó với quyền **chỉ đọc** (Read/Grep/Glob).
   - **Giao AI Agent**: chạy `claude -p` không giao diện trong dự án, xem và nhắn tiếp ngay trên dashboard. Chế độ **plan** chỉ đọc (chỉ có Read/Grep/Glob), không có shell; **edit** được sửa file (trừ `.claude/`, `.git/`, `.github/`) **và chạy lệnh shell** trong sandbox của Claude Code: chỉ ghi trong thư mục dự án, mạng chỉ tới kho package (npm, PyPI, Maven, Google Maven, Gradle), không tới `127.0.0.1` nên không gọi được API dashboard. Luôn tắt web (WebFetch/WebSearch) và MCP; không đọc được `data/`, `.env`, `~/.ssh`, `~/.codex`, `~/.aws`, `~/.config/gh`. Windows chưa có sandbox: ở đó chỉ dùng **edit** với tin/link bạn tin tưởng. Tick **Cho sửa code** trên phiên có tin/link của người khác sẽ hiện cảnh báo.
4. **Việc cần xử lý** (mục đầu danh sách, mặc định khi mở): mọi tin tag chưa xử lý của mọi nhóm, chờ lâu nhất lên đầu, thời gian chờ canh phải (vàng khi quá ngưỡng). Tiêu đề tab hiện số tin chờ; tag mới có thông báo macOS (`NOTIFY=0` để tắt), mặc định chỉ hiện nhóm và người gửi (bật nội dung ở Cài đặt › AI › Quyền riêng tư).
   - **Hôm nay**: dòng đầu trang đếm việc đang cần bạn ở cả hai module (tag chờ lâu nhất, quá hạn, ticket rủi ro, Q&A tới hạn nhắc, phiên AI Agent xong chưa xem); bấm để tới đúng chỗ.
   - **Nhắc lại sau**: chọn mốc trong ô trả lời trước khi Gửi, hoặc ⋯ › *Nhắc lại sau…* trên tag đã xong: tag quay lại Việc cần xử lý đúng giờ. **Mẫu** trong ô trả lời (hoặc `/` ở ô trống): câu trả lời soạn sẵn, điền `{tên}` / `{ticket}`.
   - Tin được coi là **đã xử lý** khi bạn reply nó (từ dashboard, điện thoại hay máy khác) hoặc bấm **Xong** (Shift+bấm: xong mà không thả reaction). Mỗi tin còn có: **ngữ cảnh** (~15 tin trước/sau, lấy trực tiếp từ Telegram), **Hoãn** (1 giờ / 3 giờ / 14:00 hôm nay / 9:00 sáng mai / thứ Hai 9:00 / giờ tự chọn, tính theo giờ Việt Nam), **Ghim**, link **Telegram**, ảnh trong tin. Nháp trả lời được lưu theo từng tin trên máy này (chip "Nháp"), Esc hay tải lại trang không mất.
   - **Chọn nhiều**: `Space` hoặc Shift+bấm trên tin → thanh "N đã chọn: Xong / Xong không reaction / Hoãn / Ghim"; `Esc` bỏ chọn. Màn rộng (≥1280px): trả lời mở bên phải, danh sách vẫn ở bên trái; dải "Tag n/N đang chờ" có ‹ › và `j`/`k` sang tag kế; ô trả lời hẹp thì nút *Trả lời / Trợ lý AI* chuyển khung.
   - **Quy tắc tự bỏ qua**: theo từ khóa như `#TB` (thêm ở Cài đặt › Telegram) hoặc theo người gửi (menu **Hoãn** của một tin › "Luôn bỏ qua {tên}", có Hoàn tác); tin khớp, cả tin đang chờ, tự chuyển "đã xử lý", không báo. Ngược lại, "Luôn ưu tiên {tên}" đưa tag của người đó lên đầu (dấu *Ưu tiên*, quá hạn ở nửa ngưỡng). Cài đặt › Telegram liệt kê và xóa các quy tắc.
   - **Digest / Briefing**: mục "Cần confirm" / "Việc cần làm" có **Trả lời** (mở khung trả lời trên tin gốc) và **Tạo ticket**. Ticket của bạn chuyển Fixed/Done (kiểm tra cùng lượt đọc ticket 5 phút một lần, cả khi đang ở trang Telegram) thì Việc cần xử lý hiện mục **Báo lại** cho các tin Telegram nhắc ticket đó. Briefing có thẻ **Tuần của tôi** (tag nhận, đã xử lý, thời gian xử lý trung vị / 90%, nhóm chậm nhất).
   - **Q&A**: đăng câu hỏi có mã `#QA…` vào nhóm bất kỳ, theo dõi cả chuỗi trả lời, nhắc khi chưa ai trả lời; *Câu hỏi của tôi* gom câu chưa ai trả lời ở mọi nhóm. Từ ticket YouTrack › *Nhắc trên Telegram* › **Hỏi lại trong nhóm** mở Q&A của nhóm đó với câu hỏi điền sẵn.
   - **Tóm tắt**: AI liệt kê việc tồn theo mức gấp. **Phím tắt** (bấm `?` để xem hết): `j`/`k` chọn tin, `Enter`/`r` trả lời, `o` mở trong Telegram, `x` xong, `s` hoãn 1 giờ, `p` ghim, `g` rồi `i`/`q`/`p`/`a`/`b` đổi trang, `Tab` rồi `Enter` trả lời tin đang focus, `⌘K`/`Ctrl+K` lệnh nhanh (nhóm, trang, ticket `VA-123`, phiên `AI-xxxxxx`, tìm tin), `Esc` thoát.
   - Khi nhờ AI: mỗi nhóm nhớ dự án riêng; có **prompt mẫu** (lưu thêm được); **Kèm ngữ cảnh nhóm** gửi thêm tin xung quanh; ảnh trong tin được AI đọc. **Giao AI Agent** từ tin: agent ghi kết quả vào file, dashboard hiện ngay dưới tin kèm nút "Dùng kết quả làm nháp trả lời". **YouTrack** (nếu cấu hình `YOUTRACK_*`) tạo ticket rồi chèn link vào khung trả lời; **AI soạn** điền sẵn tiêu đề, Type / Priority và mô tả theo mẫu. Tin không có mã ticket hiện các ticket đang mở có vẻ liên quan (+ chèn link). Nháp AI nhớ bạn là cấp gì với từng người gửi và bắt chước giọng các tin bạn từng gửi trong nhóm (khi tắt *Không cho AI đọc tin Telegram*).
5. Muốn thu hồi session Telegram: Telegram → Settings → Devices → kết thúc phiên, rồi xóa `data/account.session`; app sẽ báo `login_required`.

## AI (tùy chọn)

Mọi tính năng AI (nháp, tóm tắt, Digest, AI Agent) đều chạy qua **Claude Code CLI** (`claude`) trên máy, dùng tài khoản claude.ai đã đăng nhập (`claude auth status`); không cần API key hay gateway. Thiếu `claude` trên PATH thì inbox vẫn chạy, chỉ tắt AI.

- Nháp/tóm tắt/Digest: `AI_AGENT_COMMAND` (mặc định `claude -p --tools ""`: prompt qua stdin, kết quả qua stdout, tắt công cụ để nội dung chat không thể thực thi gì; timeout 180s), model `AI_MODEL` (mặc định `haiku`, effort `AI_EFFORT` mặc định `medium`; Task/AI Agent mặc định `sonnet`; model/effort chọn trong Cài đặt → Tài khoản Claude sẽ được ưu tiên).
- Có dự án hoặc tin có ảnh: `AI_AGENT_PROJECT_COMMAND` (chỉ Read/Grep/Glob).
- AI Agent: `AI_TASK_COMMAND` / `AI_TASK_MODEL` / `AI_TASK_EFFORT`. AI YouTrack đọc trên 10 ticket cũng chạy bằng model này.
- Nháp và AI YouTrack hiện chữ dần trong lúc Claude viết (stream-json, chỉ khi lệnh là `claude`).
- YouTrack Dev › **AI: việc tôi đã nhận**: các việc bạn đã hứa trong tin Telegram 7 ngày qua. Lead › AI brief nói thêm phần thay đổi từ lần brief trước.
- Nháp AI biết mention nào là bạn: tự lấy @username của tài khoản đang đăng nhập (`TELEGRAM_ME` để ghi đè).
- **Codex / Antigravity** thay cho Claude: Cài đặt › AI › *Dùng AI nào* — một lựa chọn cho mọi tính năng AI (nháp, tóm tắt, Digest, YouTrack, Task, AI Agent). Mỗi AI giữ model/effort riêng (`data/claude.json` › `by`), đổi qua lại không mất; danh sách model lấy từ CLI (Claude: haiku/sonnet/opus/fable; Codex: `~/.codex/models_cache.json`; Antigravity: danh sách `agy models`, mức suy luận nằm trong tên model nên không có effort). Cần CLI trên PATH (`npm i -g @openai/codex`; Antigravity CLI `agy`; đổi lệnh bằng `CODEX_COMMAND` / `ANTIGRAVITY_COMMAND`) và đã đăng nhập (Codex: nút Đăng nhập mở trình duyệt; Antigravity: mở Terminal chạy `agy`, đăng nhập Google). Gemini CLI không còn dùng vì Google đã khóa đăng nhập bằng tài khoản cá nhân cho nó. Codex chạy sandbox `read-only` (Task sửa file: `workspace-write`), nháp thì tắt shell; Antigravity chạy custom agent `telegram-dashboard-none` / `-read` / `-edit` (app tự ghi vào `~/.gemini/antigravity-cli/agents/`): nháp/tóm tắt không có tool nào, lượt đọc chỉ đọc file (chặn `data/` và thư mục chứa khóa), Task sửa file chỉ có tool đọc/sửa, không shell; luật `--settings` chặn shell, MCP và web (Task sửa file: `--mode accept-edits`). Hạn mức và tự hạ model chỉ có ở Claude. Task đang dở tiếp tục bằng CLI và lựa chọn của AI đã bắt đầu nó.
- Các lệnh AI không nhận biến môi trường `TELEGRAM_*`, `YOUTRACK_*`, `YT_*`, `GH_TOKEN`, `GITHUB_TOKEN`, `NPM_TOKEN`, `AWS_*`, `AZURE_*`, `GOOGLE_APPLICATION_CREDENTIALS`.
- **Quyền riêng tư** (Cài đặt › AI): *Ẩn SĐT / email khi gửi AI* thay số điện thoại và email trong tin / ticket bằng `[SĐT]` / `[email]` trước khi gửi cho AI.

App dành cho dùng cá nhân: AI đọc tin Telegram của nhóm đang theo dõi (nháp, tóm tắt, tạo ticket bằng AI, Đối chiếu BE, Giao AI Agent từ tin tag) mà không cần bật quyền riêng. Digest / Briefing vẫn giữ quyền theo từng nhóm. Briefing và Digest có model/effort riêng (Cài đặt › AI › Model và effort, `by.<cli>.brief_*`; để trống thì theo model tóm tắt).

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
