# Hướng dẫn cài đặt & sử dụng Telegram Dashboard (macOS + Windows)

Tài liệu cho thành viên mới: clone repo về, cài, đăng nhập Telegram và dùng hằng ngày.
Mỗi người chạy **bản riêng trên máy mình**, với **tài khoản Telegram của mình**. Không có server chung.

---

## 0. Tóm tắt nhanh (đã quen thì làm theo đây)

| Bước | macOS | Windows |
|---|---|---|
| 1. Cài công cụ | `brew install git uv node` | `winget install Git.Git astral-sh.uv OpenJS.NodeJS.LTS` |
| 2. Clone | `git clone git@github.com:phamanh1289/telegram_dashboard.git` | như macOS |
| 3. Lấy API ID/Hash | https://my.telegram.org | như macOS |
| 4. Chạy | double-click `Start Dashboard Telegram.command` | double-click `Start Dashboard Telegram.bat` |
| 5. Mở | http://127.0.0.1:8765 | http://127.0.0.1:8765 |

Lần chạy đầu script sẽ tự: cài thư viện → tạo `.env` (bạn điền API ID/Hash) → đăng nhập Telegram → build giao diện → chạy server → mở trình duyệt.

---

## 1. Yêu cầu

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Git | bất kỳ | để clone / cập nhật code |
| [uv](https://docs.astral.sh/uv/) | mới nhất | quản lý Python. **Không cần cài Python riêng**: uv tự tải Python 3.14 theo file `.python-version` |
| Node.js | ≥ 24.14 (khuyến nghị 24.22.1, xem `.node-version`) | để build giao diện |
| Tài khoản Telegram | — | cần điện thoại để nhận mã đăng nhập |
| Claude Code CLI (`claude`) | tùy chọn | chỉ cần nếu muốn dùng tính năng AI |
| Token YouTrack | tùy chọn | chỉ cần nếu dùng nút YouTrack / trang `/yt/` |

---

## 2. Cài công cụ

### 2.1 macOS

1. Cài [Homebrew](https://brew.sh) nếu chưa có (mở **Terminal**):

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Cài Git, uv, Node:

   ```bash
   brew install git uv node
   ```

3. Kiểm tra:

   ```bash
   git --version && uv --version && node --version
   ```

   `node --version` phải ≥ `v24.14`. Nếu thấp hơn: `brew upgrade node` (hoặc dùng nvm: `nvm install 24`).

### 2.2 Windows (10/11)

Mở **PowerShell** (không cần quyền Admin) và chạy:

```powershell
winget install Git.Git astral-sh.uv OpenJS.NodeJS.LTS
```

Không có `winget`? Tải tay: [Git](https://git-scm.com/download/win), [uv](https://docs.astral.sh/uv/getting-started/installation/) (`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`), [Node.js LTS](https://nodejs.org).

**Đóng PowerShell và mở lại** (để PATH nhận công cụ mới), rồi kiểm tra:

```powershell
git --version; uv --version; node --version
```

`node --version` phải ≥ `v24.14`.

---

## 3. Lấy code

Bạn cần được owner mời vào repo GitHub `phamanh1289/telegram_dashboard` trước.

```bash
git clone git@github.com:phamanh1289/telegram_dashboard.git
```

Chưa cấu hình SSH key với GitHub thì dùng HTTPS:

```bash
git clone https://github.com/phamanh1289/telegram_dashboard.git
```

```bash
cd telegram_dashboard
```

> Windows: nên clone vào thư mục **không có dấu tiếng Việt và không quá sâu**, ví dụ `C:\dev\telegram_dashboard`.

---

## 4. Lấy Telegram API ID / API Hash (mỗi người tự lấy)

1. Vào https://my.telegram.org → đăng nhập bằng số điện thoại → nhập mã Telegram gửi về app.
2. Chọn **API development tools**.
3. Điền form: *App title* và *Short name* tùy ý (ví dụ `tg-dashboard` / `tgdash`), *Platform*: `Desktop`. Bấm **Create application**.
4. Ghi lại **App api_id** (số) và **App api_hash** (chuỗi 32 ký tự).

> Đây là thông tin bí mật của **riêng bạn**. Không gửi cho người khác, không commit lên GitHub (file `.env` đã được gitignore).

---

## 5. Cấu hình (không bắt buộc `.env`)

Lần đầu mở dashboard, **Cài đặt Telegram** tự bật: dán API ID/Hash (lấy ở https://my.telegram.org/apps), nhập số điện thoại, mã và mật khẩu 2FA (xem mục 7). YouTrack và quyền đọc tin của AI nằm ở **Cài đặt chung**. Mọi thứ lưu trong `data/` trên máy này.

`.env` chỉ cần cho tùy chỉnh nâng cao (tạo bằng `cp .env.example .env`). Giá trị nhập trên giao diện thắng `.env`. Biến hay dùng:

| Biến | Ý nghĩa |
|---|---|
| `NOTIFY=0` | tắt thông báo khi có tag mới (chỉ có trên macOS) |
| `DONE_REACTION=👍` | thả reaction lên tin Telegram khi bạn bấm ✓ xong |
| `YOUTRACK_URL`, `YOUTRACK_TOKEN`, `YOUTRACK_PROJECT` | bật nút tạo ticket YouTrack và trang `/yt/` (cũng có thể nhập trong Cài đặt trên giao diện) |

Xem đầy đủ trong `.env.example`.

---

## 6. Chạy lần đầu

### 6.1 macOS — cách dễ nhất

1. Mở Finder → thư mục repo → **double-click `Start Dashboard Telegram.command`**.
   - Nếu macOS chặn ("cannot be opened because it is from an unidentified developer"): **chuột phải → Open → Open**. Hoặc chạy một lần trong Terminal: `xattr -d com.apple.quarantine "Start Dashboard Telegram.command"`.
2. Script sẽ:
   - kiểm tra `uv`, `node`, `npm`;
   - cài thư viện Python (`uv sync`) và Node (`npm ci`) nếu chưa có;
   - build giao diện (lần đầu ~1 phút), chạy server, mở trình duyệt.
3. Cửa sổ Terminal hiện menu, bấm số:
   **1** Start · **2** Stop · **3** Restart · **4** Mở trình duyệt · **5** Xem log · **0**/Esc Thoát.
   Đóng cửa sổ = dừng server.

### 6.2 Windows — cách dễ nhất

1. Mở File Explorer → thư mục repo → **double-click `Start Dashboard Telegram.bat`**.
   - Nếu Windows SmartScreen cảnh báo: **More info → Run anyway**.
2. Script sẽ làm các bước giống macOS (cài thư viện, build giao diện khi code đổi), rồi chạy server và tự mở `http://127.0.0.1:8765`.
3. Muốn dừng: bấm **Ctrl+C** trong cửa sổ đen hoặc **đóng cửa sổ**.

### 6.3 Chạy bằng lệnh (cả hai hệ điều hành)

Dùng khi script không chạy được hoặc bạn thích terminal. Chạy trong thư mục repo:

```bash
uv sync --locked
```

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

Rồi mở http://127.0.0.1:8765.

---

## 7. Đăng nhập Telegram (chỉ một lần)

Trong **Cài đặt Telegram** (tự mở lần đầu), sau khi lưu API ID/Hash. Vẫn có thể đăng nhập bằng terminal: `uv run python -m telegram_dashboard login`.

1. **Phone**: số điện thoại dạng quốc tế, ví dụ `+84912345678`.
2. **Code**: mã Telegram gửi vào app Telegram (tin từ "Telegram"), không phải SMS.
3. **Password**: mật khẩu 2FA nếu bạn có bật (gõ không hiện ký tự, cứ gõ rồi Enter).

Thấy `Đã đăng nhập: <tên>` là xong. Phiên lưu ở `data/account.session`, lần sau không hỏi lại.

> Nhập mã/2FA **chỉ trong cửa sổ terminal trên máy bạn**. Không gửi mã cho ai, kể cả AI agent.

---

## 8. Sử dụng

Mở **http://127.0.0.1:8765** — phải dùng `127.0.0.1`, **không dùng `localhost`** (sẽ bị từ chối mọi thao tác).

### 8.1 Telegram Inbox (`/`)

- Không cần chọn nhóm: khi ai đó **tag** hoặc **reply** bạn trong nhóm, tin hiện ngay. App chỉ lưu tin tag bạn, không nạp lịch sử cũ — nên lúc mới cài inbox sẽ trống, chờ có tag mới.
- **Việc cần xử lý** (mục đầu): mọi tin tag chưa xử lý, chờ lâu nhất lên đầu; quá 4 giờ thì đỏ.
- Tin được tính **đã xử lý** khi bạn reply nó (từ dashboard, điện thoại hay máy khác) hoặc bấm ✓.
- Mỗi tin có: 💬 xem ngữ cảnh, ⏰ nhắc lại sau, bỏ qua người gửi, link mở trong Telegram.
- **Trả lời**: bấm Trả lời → gõ → **Gửi** hoặc Ctrl/Cmd+Enter (Enter = xuống dòng).
- **Quy tắc tự bỏ qua** (biểu tượng phễu): theo từ khóa (ví dụ `#TB`) hoặc người gửi.
- **Phím tắt**: `j`/`k` chọn tin · `r` trả lời · `x` xong · `a` nhờ AI · `Esc` thoát.

### 8.2 AI (tùy chọn)

Cần Claude Code CLI đã đăng nhập (mục 9). Không có `claude` thì inbox vẫn chạy, chỉ ẩn AI.

- **Nhờ AI**: Trả lời một tin → khung "Nhờ AI" → chọn **dự án** (nút **Thêm** mở hộp thoại chọn thư mục) → nhập yêu cầu → Enter. AI trả 3 bản nháp, bấm để đưa vào khung soạn. AI **không bao giờ tự gửi**.
- **Tóm tắt**: AI liệt kê việc tồn theo mức gấp.
- **Tạo task (AI Agent)**: chạy Claude trong thư mục dự án; chế độ *plan* chỉ đọc, *edit* được sửa file.
- Đổi model / AI (Claude, Codex, Antigravity): **Cài đặt** trên giao diện.

### 8.3 YouTrack Dashboard (`/yt/`)

Bấm link YouTrack trên header. Cần `YOUTRACK_URL` + `YOUTRACK_TOKEN` (trong `.env` hoặc nhập ở Cài đặt). Token lấy tại YouTrack → Profile → **Account Security → New token**. Chưa có token thì xem dữ liệu mẫu: http://127.0.0.1:8765/yt/?mock=1

---

## 9. Cài Claude Code CLI (để dùng AI)

macOS:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Windows (PowerShell; cần đã cài Git for Windows ở mục 2.2):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Mở terminal mới, chạy `claude` một lần và đăng nhập tài khoản claude.ai (Pro/Max/Team) theo hướng dẫn trên màn hình. Kiểm tra:

```bash
claude auth status
```

Sau đó **restart dashboard** (macOS: phím 3; Windows: đóng và mở lại `.bat`).

---

## 10. Cập nhật khi có code mới

```bash
git pull
```

Rồi chạy lại script khởi động:

- macOS: trong menu bấm **3** (Restart) — tự build lại giao diện nếu code đổi. Nếu có thay đổi thư viện, chạy thêm `uv sync --locked` và `npm ci` trước.
- Windows: đóng cửa sổ cũ, double-click `.bat` lại — tự build lại khi commit đổi. Nếu có thay đổi thư viện: `uv sync --locked` và `npm ci`.

Dữ liệu của bạn (`data/`, `.env`) không bị ảnh hưởng khi pull.

---

## 11. Dữ liệu & bảo mật

- Tất cả dữ liệu nằm trong thư mục `data/` trên máy bạn: phiên Telegram (`account.session`), database (`dashboard.sqlite3`), log (`server.log`). Đã gitignore.
- **`data/account.session` = quyền đăng nhập Telegram của bạn.** Không copy, không gửi ai.
- Server chỉ nghe trên `127.0.0.1` — máy khác trong mạng không truy cập được.
- Đăng xuất / thu hồi: Telegram → Settings → Devices → kết thúc phiên tương ứng, rồi xóa `data/account.session`. Muốn xóa sạch: xóa cả thư mục `data/`.

---

## 12. Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| `Thiếu uv/node/npm` | Cài lại mục 2, **mở terminal mới** để PATH cập nhật |
| `uv sync` lỗi tải Python | Kiểm tra mạng/proxy; chạy `uv python install 3.14` rồi thử lại |
| `npm ci` báo lỗi engine | Node quá cũ → cài Node ≥ 24.14 |
| Trình duyệt báo không kết nối được | Server chưa chạy hoặc đã dừng; xem log `data/server.log` |
| Mọi nút bấm báo lỗi / bị từ chối | Đang mở `localhost` → đổi sang `http://127.0.0.1:8765` |
| Port 8765 bị chiếm | Một dashboard khác đang chạy. macOS: menu phím 2 rồi 1. Windows: `netstat -ano \| findstr 8765` rồi `taskkill /PID <pid> /F` |
| Giao diện trống / 503 | Chưa build: `npm run build` |
| App báo `login_required` | Phiên Telegram hết hạn → đăng nhập lại ở Cài đặt Telegram |
| `FloodWaitError` khi login | Telegram giới hạn số lần thử, đợi theo số giây báo rồi thử lại |
| Không có tính năng AI | `claude` chưa có trên PATH hoặc chưa đăng nhập → mục 9, rồi restart |
| macOS: không hiện thông báo tag mới | System Settings → Notifications → **Script Editor** → bật Allow |

### Khác biệt trên Windows

- **Thông báo** khi có tag mới chỉ có trên macOS (Windows: xem số tin chờ trên tiêu đề tab).
- **Codex / Antigravity** chưa được kiểm thử trên Windows; dùng Claude (mặc định). Nút đăng nhập Antigravity (mở Terminal) chỉ chạy trên macOS.
- Hộp thoại **chọn thư mục dự án** dùng hộp thoại của Windows (có thể hiện sau cửa sổ trình duyệt nếu bị che — kiểm tra thanh taskbar).

---

## 13. Cho developer (tùy chọn)

Chế độ dev (hot reload giao diện):

```bash
npm run dev
```

Mở http://127.0.0.1:3000. Kiểm tra trước khi đẩy code:

```bash
uv run pytest -q
```

```bash
uv run ruff check .
```

```bash
npm run typecheck && npm run lint
```

Chi tiết kiến trúc và E2E: xem [README.md](../README.md).
