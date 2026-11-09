<p align="center">
  <img src="web/src/app/icon.svg" alt="Radar" width="120">
</p>

<h1 align="center">Radar</h1>

<h3 align="center">Một hộp thư cho mọi tin Telegram tag bạn, kèm YouTrack và AI soạn nháp.</h3>
<p align="center"><b>Chạy trên máy bạn, đăng nhập bằng tài khoản Telegram của bạn.<br>
Không server chung, không gửi dữ liệu đi đâu ngoài Telegram, YouTrack và AI bạn tự chọn.</b></p>

<p align="center">
  <a href="https://github.com/phamanh1289/telegram_dashboard/releases/latest"><img src="https://img.shields.io/github/v/release/phamanh1289/telegram_dashboard?label=release&color=c2410c" alt="Bản mới nhất"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-24292f?logo=apple&logoColor=white" alt="macOS Apple Silicon">
  <img src="https://img.shields.io/badge/Windows-10%20%2F%2011%20x64-24292f?logo=windows&logoColor=white" alt="Windows 10/11 x64">
  <img src="https://img.shields.io/badge/ch%E1%BA%A1y-127.0.0.1-2f855a" alt="Chỉ chạy trên máy">
</p>

**macOS** (mở Terminal, dán, Enter):

```bash
curl -fsSL https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-macos.sh | bash
```

**Windows** (mở PowerShell, dán, Enter):

```powershell
irm https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-windows.ps1 | iex
```

<p align="center">
  <a href="#cài-đặt-3-phút">Cài đặt</a> ·
  <a href="#mở-web-sau-khi-cài">Mở web</a> ·
  <a href="#lần-đầu-sử-dụng">Lần đầu</a> ·
  <a href="#hướng-dẫn-sử-dụng">Sử dụng</a> ·
  <a href="#ai-tùy-chọn">AI</a> ·
  <a href="#xử-lý-sự-cố">Sự cố</a> ·
  <a href="#cho-developer">Developer</a>
</p>

---

Radar gom mọi tin có người **tag** hoặc **reply** bạn trong các nhóm Telegram vào một hàng chờ, chờ lâu nhất lên đầu. Bạn trả lời ngay trên web bằng chính tài khoản Telegram của mình, hoãn, ghim, đánh dấu xong, hoặc nhờ AI soạn nháp và tạo ticket YouTrack từ tin. Tab **YouTrack** là dashboard ticket theo vai trò Dev / QA / PO.

<table>
<tr>
<td width="50%" valign="top">

### Telegram Inbox

- **Việc cần xử lý**: mọi tag chưa xử lý của mọi nhóm, quá hạn tô màu.
- **Trả lời** tại chỗ, nháp tự lưu, không bao giờ tự gửi lại.
- **Hoãn / Nhắc lại sau / Ghim / Xong**, quy tắc tự bỏ qua.
- **Q&A**: hỏi trong nhóm, theo dõi câu trả lời, nhắc khi chưa ai trả lời.
- **Briefing / Digest**: AI tóm tắt mọi nhóm, gom "Cần confirm", "Việc cần làm".

</td>
<td width="50%" valign="top">

### YouTrack và AI

- **My Dashboard** theo vai trò: Hôm nay (Dev), Kiểm thử (QA), Brief (PO).
- Bảng / Board ticket, bộ lọc, view đã lưu, xuất CSV, báo cáo release.
- **Tạo ticket** từ tin Telegram, AI điền sẵn tiêu đề, Type, Priority, mô tả.
- **AI Agent**: giao việc cho Claude Code / Codex / Antigravity chạy trong thư mục dự án.
- **Trợ lý AI** ở mọi trang (`⌘J` / `Ctrl+J`).

</td>
</tr>
</table>

## Cài đặt (3 phút)

Không cần cài Python, Node hay git: gói cài đã có sẵn tất cả. Chạy lại lệnh cài = cập nhật, dữ liệu giữ nguyên.

### macOS (Apple Silicon)

1. Mở **Terminal**: bấm `⌘ Space`, gõ `Terminal`, Enter.
2. Dán lệnh dưới đây, bấm Enter:

   ```bash
   curl -fsSL https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-macos.sh | bash
   ```

3. Lệnh tải bản mới nhất vào `~/Applications/Telegram Dashboard`, tạo app **Radar** (`~/Applications/Radar.app`) rồi mở app.
4. Một cửa sổ Terminal hiện menu: đó là server, **để nguyên** (đóng cửa sổ = tắt app). Trình duyệt tự mở `http://127.0.0.1:8765`.

> **Vì sao không tải zip bằng trình duyệt?** App chưa được Apple notarize nên file tải qua trình duyệt bị chặn (*"Apple could not verify…"*). Lệnh cài ở trên không bị chặn. Nếu đã lỡ tải zip: **System Settings › Privacy & Security › Open Anyway**, hoặc chạy `xattr -dr com.apple.quarantine "<thư mục Telegram Dashboard>"`.

### Windows 10/11 (64-bit)

1. Bấm **Start**, gõ `PowerShell`, mở lên (không cần quyền Admin).
2. Dán lệnh dưới đây, bấm Enter:

   ```powershell
   irm https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-windows.ps1 | iex
   ```

3. Lệnh cài vào `%LOCALAPPDATA%\Programs\Telegram Dashboard`, tạo shortcut **Radar** ở Start Menu và Desktop rồi mở app.
4. Một cửa sổ đen hiện ra: đó là server, **để nguyên** (đóng cửa sổ = tắt app). Trình duyệt tự mở `http://127.0.0.1:8765`.

<details>
<summary><b>Tải bộ cài bằng tay (Setup.exe / zip)</b></summary>

Lấy file ở [GitHub Releases](https://github.com/phamanh1289/telegram_dashboard/releases/latest):

| Nền tảng | File | Ghi chú |
|---|---|---|
| Windows | `TelegramDashboard-X.Y.Z-windows-x64-setup.exe` | Chưa ký số: SmartScreen hiện *"Windows protected your PC"* → **More info** → **Run anyway**. Trình duyệt cảnh báo "không phổ biến" → **Keep** |
| Windows (không cài) | `…-windows-x64.zip` | Chuột phải › Properties › tick **Unblock** › OK → *Extract All* → mở `Start Dashboard Telegram.bat` |
| macOS | `…-macos-arm64.zip` | Nên dùng lệnh cài; tải tay thì xem ghi chú Gatekeeper ở trên |

Mỗi gói có chữ ký RSA (`.sig`); app chỉ tự cập nhật từ gói có chữ ký hợp lệ, lệnh cài kiểm tra sha256. Chi tiết: [docs/INSTALL.md](docs/INSTALL.md).

</details>

## Mở web sau khi cài

Sau khi cài, app tự mở trình duyệt. Những lần sau:

| Cách | macOS | Windows |
|---|---|---|
| Mở app | Gõ **Radar** trong Spotlight / Launchpad (kéo vào Dock cho tiện) | Bấm **Radar** ở Start Menu / Desktop |
| Bằng lệnh | Terminal mới: `mydashboard start` | cmd / PowerShell mới: `mydashboard start` |
| Server đang chạy, chỉ mở lại trang | `mydashboard open` | `mydashboard open` |

Địa chỉ web: **http://127.0.0.1:8765**

- **Phải dùng `127.0.0.1`**. Mở bằng `localhost` thì trang vẫn hiện nhưng mọi thao tác bị từ chối.
- Port 8765 bị app khác chiếm thì server tự dùng port trống kế tiếp (8766…) và tự mở đúng địa chỉ. Mở app lần nữa khi đang chạy chỉ mở lại trang, không chạy thêm server.
- **Màn hình khóa** khi mở bằng bookmark hoặc trình duyệt khác: chạy `mydashboard open` một lần (trang mở kèm mã, trình duyệt được nhớ ~1 năm), hoặc dán mã trong file `~/.telegram_dashboard/api_token`. Nhờ vậy chương trình khác trên máy, kể cả AI Agent, không gọi được API để gửi tin thay bạn.
- Tắt app: đóng cửa sổ Terminal / cửa sổ đen của server.

## Lần đầu sử dụng

### 1. Lấy Telegram API ID / API Hash (mỗi người tự lấy, một lần)

1. Vào https://my.telegram.org → đăng nhập bằng số điện thoại → nhập mã Telegram gửi về app Telegram.
2. Chọn **API development tools**.
3. Điền *App title* và *Short name* tùy ý (ví dụ `radar` / `radar`), *Platform*: `Desktop` → **Create application**.
4. Ghi lại **App api_id** (số) và **App api_hash** (chuỗi 32 ký tự).

> Đây là thông tin bí mật của riêng bạn. Không gửi cho ai.

### 2. Đăng nhập Telegram

Lần đầu mở web, trang **Cài đặt › Telegram** tự mở:

1. Dán **API ID** và **API Hash** → lưu.
2. **Số điện thoại** dạng quốc tế, ví dụ `+84912345678`.
3. **Mã**: Telegram gửi vào app Telegram (tin từ "Telegram"), không phải SMS.
4. **Mật khẩu 2FA** nếu bạn có bật.

Xong là dùng được ngay; lần sau không hỏi lại. Chỉ nhập mã / 2FA trên web của **máy bạn**, không gửi mã cho ai, kể cả AI agent.

### 3. Chọn vai trò

**Cài đặt › Chung › Vai trò**: **Dev**, **QA/QC** hoặc **PO/PM**. Vai trò quyết định trang chủ, dashboard YouTrack và cách AI tóm tắt / tạo ticket. QA và PO không dùng AI Agent nên không cần thư mục code.

### 4. Chờ tag đầu tiên

App **không nạp lịch sử cũ**: lúc mới cài inbox trống. Khi có người tag hoặc reply bạn trong nhóm, tin hiện ngay. Không cần chọn nhóm.

### 5. (Tùy chọn) Nối thêm

| Muốn dùng | Cần gì | Ở đâu |
|---|---|---|
| Tab **YouTrack**, tạo ticket từ tin | URL YouTrack + token (YouTrack › Profile › **Account Security › New token**) | **Cài đặt › YouTrack** |
| AI soạn nháp, tóm tắt, AI Agent | Một AI CLI đã đăng nhập: Claude Code, Codex hoặc Antigravity | **Cài đặt › AI** (xem [AI](#ai-tùy-chọn)) |
| Thông báo khi có tag mới (macOS) | Cho phép thông báo | **Cài đặt › Telegram › Hàng chờ và thông báo** |
| Giao diện sáng / tối, màu chủ đạo | — | **Cài đặt › Chung › Giao diện** |

## Hướng dẫn sử dụng

Trong app, bấm `?` để xem toàn bộ phím tắt; **Cài đặt › Tìm cài đặt** để tìm nhanh một tùy chọn.

### Telegram Inbox (`/`)

**Hàng chờ**

- **Việc cần xử lý** (mục đầu thanh bên, mặc định khi mở): mọi tag chưa xử lý của mọi nhóm, chờ lâu nhất lên đầu; thời gian chờ canh phải, đổi màu khi quá ngưỡng (đổi ngưỡng ở Cài đặt › Telegram). Tiêu đề tab trình duyệt hiện số tin chờ.
- **Hôm nay**: một dòng đếm mọi việc đang chờ bạn ở cả hai module (tag chờ lâu nhất, quá hạn, ticket rủi ro, Q&A tới hạn nhắc, phiên AI Agent xong chưa xem); bấm để tới đúng chỗ.
- Tin được tính **đã xử lý** khi bạn reply nó (từ web, điện thoại hay máy khác) hoặc bấm **Xong** (Shift+bấm: xong mà không thả reaction).

**Trên mỗi tin**

| Thao tác | Làm gì |
|---|---|
| **Trả lời** | Bấm tin (hoặc `Enter`) → gõ → **Gửi** hoặc `Ctrl/⌘+Enter` (Enter = xuống dòng). Nháp lưu theo từng tin, tải lại trang không mất |
| **Mẫu** | Câu trả lời soạn sẵn trong ô trả lời (hoặc gõ `/` ở ô trống), điền `{tên}` / `{ticket}` |
| **@** | Tag thành viên nhóm |
| **Hoãn** | 1 giờ / 3 giờ / 14:00 hôm nay / 9:00 sáng mai / thứ Hai 9:00 / giờ tự chọn (giờ Việt Nam) |
| **Nhắc lại sau** | Chọn mốc trước khi Gửi, hoặc ⋯ › *Nhắc lại sau…* trên tag đã xong: tag quay lại hàng chờ đúng giờ |
| **Ghim** | Giữ tin ở mục *Đã ghim* |
| **Ngữ cảnh** | ~15 tin trước / sau, lấy trực tiếp từ Telegram |
| **Mở Telegram** | Mở đúng tin trong app Telegram |

- **Chọn nhiều**: `Space` hoặc Shift+bấm → thanh "N đã chọn: Xong / Xong không reaction / Hoãn / Ghim"; `Esc` bỏ chọn.
- **Màn rộng** (≥ 1280px): khung trả lời mở bên phải, danh sách vẫn ở bên trái; `j`/`k` sang tag kế.
- **Gửi "chưa rõ"** (mạng chập chờn): mở nhóm kiểm tra trước, rồi dùng **Kiểm tra** hoặc **Thử lại cùng yêu cầu** (Telegram không tạo tin thứ hai). App **không bao giờ tự gửi lại**.

**Quy tắc tự động**

- **Luôn bỏ qua**: theo từ khóa (ví dụ `#TB`, thêm ở Cài đặt › Telegram) hoặc theo người gửi (menu **Hoãn** › *Luôn bỏ qua {tên}*, có Hoàn tác). Tin khớp tự chuyển "đã xử lý", không báo.
- **Luôn ưu tiên {tên}**: tag của người đó lên đầu, quá hạn ở nửa ngưỡng.

**Các trang khác ở thanh bên**

- **Q&A**: đăng câu hỏi có mã `#QA…` vào nhóm, theo dõi cả chuỗi trả lời, nhắc khi chưa ai trả lời. *Câu hỏi của tôi* gom câu chưa ai trả lời ở mọi nhóm.
- **Briefing**: AI tóm tắt mọi nhóm có tin mới; mục *Cần bạn / Cần confirm / Việc cần làm* có **Trả lời** và **Tạo ticket**; thẻ **Tuần của tôi** (tag nhận, đã xử lý, thời gian xử lý trung vị / 90%); gửi briefing vào Saved Messages.
- **Trang nhóm**: lọc *Chưa xử lý / Đã xử lý / Cả nhóm*, lọc theo người gửi, tìm, *Xong tất cả*, **Tóm tắt (Digest)** của nhóm.
- **AI Agent**: danh sách phiên AI, nhắn tiếp, duyệt plan rồi cho sửa code.
- **Báo lại**: ticket của bạn chuyển Fixed / Done thì hàng chờ hiện mục nhắc báo lại cho các tin Telegram nhắc ticket đó.

### My Dashboard — YouTrack (`/youtrack/`)

Bấm **YouTrack** trên thanh trên cùng (huy hiệu đỏ = số ticket của bạn cần xử lý ngay). Cần URL + token ở **Cài đặt › YouTrack**; chưa có token thì trang hiện dữ liệu mẫu, các thao tác ghi (tạo ticket, đổi state, bình luận) và AI bị tắt.

| Vai trò | Trang chủ | Có gì |
|---|---|---|
| Dev | **Hôm nay** | Việc hôm nay, cần xử lý ngay, mới cập nhật, AI Studio (Standup, Kế hoạch) |
| QA/QC | **Kiểm thử** | Hàng đợi test, cảnh báo bug tăng đột biến, kết quả test + Copy standup, gợi ý chia QC |
| PO/PM | **Brief** | AI Brief, Lên sprint, Grooming, Bản tin tuần, Release notes, Báo cáo release (xuất MD / PDF / CSV) |

- **Ticket**: Bảng / Board (kéo thả đổi State), bộ lọc Priority / Type / State, **AI lọc** (gõ câu tiếng Việt), view đã lưu, gom nhóm, đổi assignee hàng loạt, xuất CSV.
- **Chi tiết ticket**: đổi State / Priority / Assignee, bình luận (tag `@`), ticket giống / liên quan + AI kiểm tra trùng, **Phiên AI** về ticket, **Nhắc trên Telegram › Hỏi lại trong nhóm**.
- **Dashboard**: Cần chú ý, KPI sprint, Burndown, Lead time, Velocity, tải việc, số liệu QC và bug.
- **Thành viên**: số liệu từng người, AI phân tích, so sánh cả team + AI chia việc.
- **Tạo ticket**: AI soạn từ ghi chú thô; cùng một form với nút tạo ticket bên Telegram.

### Phím tắt hay dùng

| Phím | Làm gì |
|---|---|
| `?` | Xem toàn bộ phím tắt |
| `⌘K` / `Ctrl+K` | Lệnh nhanh: nhóm, trang, ticket `VA-123`, phiên `AI-xxxxxx`, tìm tin |
| `⌘J` / `Ctrl+J` | Trợ lý AI ở mọi trang (Telegram: hỏi về Briefing; YouTrack: hỏi về ticket đang xem) |
| `j` / `k` | Chọn tin trên / dưới |
| `Enter` / `r` | Trả lời tin đang chọn |
| `x` · `s` · `p` | Xong · hoãn 1 giờ · ghim |
| `o` | Mở tin trong Telegram |
| `g` rồi `i` / `q` / `p` / `a` / `b` | Đổi trang |
| `Esc` | Thoát / bỏ chọn |

## AI (tùy chọn)

Mọi tính năng AI chạy qua **AI CLI cài trên máy bạn**, dùng tài khoản bạn đã đăng nhập; không cần API key. Không có CLI nào thì inbox vẫn chạy, chỉ ẩn AI. AI **chỉ trả văn bản**: bạn tự đưa vào khung soạn và bấm gửi.

| AI | Cài | Đăng nhập |
|---|---|---|
| **Claude Code** (mặc định) | macOS: `curl -fsSL https://claude.ai/install.sh \| bash` · Windows: `irm https://claude.ai/install.ps1 \| iex` | Mở terminal mới, chạy `claude` một lần, đăng nhập claude.ai (Pro / Max / Team). Kiểm tra: `claude auth status` |
| **Codex** | `npm i -g @openai/codex` | Nút **Đăng nhập** ở Cài đặt › AI (mở trình duyệt) |
| **Antigravity** | Antigravity CLI (`agy`) theo hướng dẫn của Google | Nút **Đăng nhập** ở Cài đặt › AI (mở Terminal chạy `agy`, chỉ macOS) |

Cài xong: **khởi động lại Radar**, rồi vào **Cài đặt › AI**:

- **Tài khoản**: CLI phải hiện "đang dùng" kèm tài khoản. CLI chưa cài / chưa đăng nhập hiện mờ.
- **Dùng AI nào**: một lựa chọn cho mọi tính năng (nháp, tóm tắt, Digest, YouTrack, AI Agent). Mỗi AI giữ model / effort riêng, đổi qua lại không mất.
- **Quyền riêng tư**: *Ẩn SĐT / email khi gửi AI*, nội dung trong thông báo.
- Nút đồng hồ đo trên thanh trên cùng hiện % hạn mức AI (xanh / vàng từ 70% / đỏ từ 90%).

**Dùng AI trong Inbox**

- **Nhờ AI**: mở trả lời một tin → khung *Nhờ AI* → chọn **dự án** (nút **Thêm** mở hộp thoại chọn thư mục) → nhập prompt → Enter. AI trả 3 bản nháp, bấm để đưa vào khung soạn. Có **prompt mẫu**, **Kèm ngữ cảnh nhóm**, AI đọc được ảnh trong tin.
- **Giao AI Agent**: chạy AI trong thư mục dự án. Chế độ **plan** chỉ đọc; **edit** được sửa file và chạy lệnh trong sandbox (chỉ ghi trong thư mục dự án). Kết quả hiện ngay dưới tin, kèm nút *Dùng kết quả làm nháp trả lời*. Windows chưa có sandbox: chỉ dùng **edit** với tin / link bạn tin tưởng.
- **Tạo ticket YouTrack** từ tin: **AI soạn** điền sẵn tiêu đề, Type / Priority và mô tả, rồi chèn link ticket vào khung trả lời.
- **Đối chiếu BE**: soi câu trả lời của BE với code dự án.

<details>
<summary><b>Chi tiết kỹ thuật AI (biến môi trường, sandbox, quyền dữ liệu)</b></summary>

- Nháp / tóm tắt / Digest: `AI_AGENT_COMMAND` (mặc định `claude -p --tools ""`: prompt qua stdin, kết quả qua stdout, tắt công cụ để nội dung chat không thể thực thi gì; timeout 180s), model `AI_MODEL` (mặc định `haiku`, effort `AI_EFFORT` mặc định `medium`). Model / effort chọn trong Cài đặt được ưu tiên.
- Có dự án hoặc tin có ảnh: `AI_AGENT_PROJECT_COMMAND` (chỉ Read / Grep / Glob).
- AI Agent: `AI_TASK_COMMAND` / `AI_TASK_MODEL` / `AI_TASK_EFFORT` (mặc định `sonnet`). AI YouTrack đọc trên 10 ticket cũng chạy bằng model này. Briefing / Digest có model / effort riêng (`by.<cli>.brief_*`; để trống thì theo model tóm tắt).
- AI Agent **edit**: sửa file (trừ `.claude/`, `.git/`, `.github/`) và chạy shell trong sandbox của Claude Code; mạng chỉ tới kho package (npm, PyPI, Maven, Google Maven, Gradle), không tới `127.0.0.1`. Luôn tắt WebFetch / WebSearch và MCP; không đọc được `data/`, `.env`, `~/.ssh`, `~/.codex`, `~/.aws`, `~/.config/gh`.
- Codex chạy sandbox `read-only` (Task sửa file: `workspace-write`), nháp thì tắt shell. Antigravity chạy custom agent `telegram-dashboard-none` / `-read` / `-edit` (app tự ghi vào `~/.gemini/antigravity-cli/agents/`): nháp / tóm tắt không có tool, lượt đọc chỉ đọc file, Task sửa file chỉ có tool đọc / sửa, không shell. Hạn mức và tự hạ model chỉ có ở Claude. Đổi lệnh bằng `CODEX_COMMAND` / `ANTIGRAVITY_COMMAND`.
- Nháp AI biết mention nào là bạn (tự lấy @username, `TELEGRAM_ME` để ghi đè), nhớ bạn là cấp gì với từng người gửi và bắt chước giọng các tin bạn từng gửi.
- Các lệnh AI không nhận biến môi trường `TELEGRAM_*`, `YOUTRACK_*`, `YT_*`, `GH_TOKEN`, `GITHUB_TOKEN`, `NPM_TOKEN`, `AWS_*`, `AZURE_*`, `GOOGLE_APPLICATION_CREDENTIALS`.
- Telegram API Terms hạn chế dùng dữ liệu Telegram với AI. App chỉ gửi những tin có **quyền dữ liệu** hợp lệ: đúng chat / tin / nội dung hiện tại, còn hạn, có phạm vi (draft / summary). Tin sửa / xóa tự mất quyền; không hỗ trợ media / forward. Digest / Briefing giữ quyền theo từng nhóm (Trang nhóm › Tóm tắt › Cho phép). Đây là guard kỹ thuật, không phải chứng nhận pháp lý.

</details>

## Cập nhật

- **Trong app (khuyên dùng)**: **Cài đặt › Cập nhật**. App kiểm tra GitHub mỗi giờ; có bản mới thì nút bánh răng hiện chấm → bấm **Cập nhật**, hoặc bật **Tự động cập nhật** (bỏ qua khi đang có task AI Agent). App tải gói mới, khởi động lại và tải lại trang; đăng nhập, cài đặt và dữ liệu giữ nguyên.
- **Bằng lệnh**: đóng app rồi chạy lại lệnh cài ở trên (hoặc Setup.exe bản mới hơn).

## Gỡ cài đặt

| | Cách gỡ |
|---|---|
| Windows | Settings › Apps › **Radar** › Uninstall. Thư mục `data\` (gồm phiên Telegram) được giữ lại; xóa tay nếu muốn sạch hẳn |
| macOS | Xóa `~/Applications/Telegram Dashboard`, `~/Applications/Radar.app` và `~/.local/bin/mydashboard` |
| Cả hai | Nên thu hồi phiên: Telegram › Settings › Devices › kết thúc phiên của Radar |

## Dữ liệu và bảo mật

- Mọi dữ liệu nằm trong thư mục `data/` của bản cài trên máy bạn: phiên Telegram (`account.session`), database (`dashboard.sqlite3`), cấu hình (`config.json`), log (`server.log`). File quyền 0600, thư mục 0700.
- **`data/account.session` = quyền đăng nhập Telegram của bạn.** Không copy, không gửi ai.
- Server chỉ nghe trên `127.0.0.1`, kiểm tra Host / Origin; máy khác trong mạng không truy cập được, Firewall không hỏi.
- API chỉ nhận trình duyệt đã mở khóa bằng mã (`~/.telegram_dashboard/api_token`).
- Chỉ tin tag bạn (và tin bạn trả lời) được lưu; không nạp lịch sử.
- Thu hồi: Telegram › Settings › Devices › kết thúc phiên, rồi xóa `data/account.session`; app sẽ báo `login_required`. Xóa sạch: xóa cả thư mục `data/`.

## Nền tảng hỗ trợ

| Hệ điều hành | Trạng thái | Ghi chú |
|---|---|---|
| macOS (Apple Silicon) | Hỗ trợ đầy đủ | Có thông báo khi có tag mới |
| Windows 10/11 (x64) | Hỗ trợ | Không có banner thông báo (xem số tin chờ trên tiêu đề tab); Codex / Antigravity chưa được kiểm thử; AI Agent **edit** không có sandbox |
| macOS Intel, Linux | Chưa có gói cài | Chạy từ source được (xem [Cho developer](#cho-developer)) |

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Trình duyệt báo không kết nối được | Server chưa chạy hoặc đã tắt: mở lại **Radar** / `mydashboard start`. Xem log `data/server.log` |
| Mọi nút bấm báo lỗi / bị từ chối | Đang mở `localhost` → đổi sang `http://127.0.0.1:8765` |
| Hiện màn hình khóa | Chạy `mydashboard open`, hoặc dán mã trong `~/.telegram_dashboard/api_token` |
| `mydashboard: command not found` | Mở **cửa sổ terminal mới** sau khi cài (PATH mới có hiệu lực) |
| Inbox trống sau khi cài | Bình thường: app không nạp lịch sử, chờ có người tag / reply bạn |
| App báo `login_required` | Phiên Telegram hết hạn hoặc đã bị thu hồi → đăng nhập lại ở Cài đặt › Telegram |
| `FloodWaitError` khi đăng nhập | Telegram giới hạn số lần thử, đợi đủ số giây báo rồi thử lại |
| Báo "chưa rõ đã gửi" | Mở nhóm kiểm tra trước khi gửi lại; dùng **Thử lại cùng yêu cầu** (không tạo tin trùng) |
| Không thấy tính năng AI | CLI chưa có trên PATH hoặc chưa đăng nhập → mục [AI](#ai-tùy-chọn), rồi khởi động lại Radar |
| Windows: server đứng im | Tiêu đề cửa sổ đen có chữ *Select* (lỡ bôi đen chữ) → bấm **Esc** |
| Windows: hộp thoại chọn thư mục không hiện | Có thể nằm sau cửa sổ trình duyệt, kiểm tra thanh taskbar |
| macOS: "Apple could not verify…" | Dùng lệnh cài thay vì tải zip; hoặc System Settings › Privacy & Security › **Open Anyway** |
| macOS: không hiện thông báo tag mới | System Settings › Notifications › **Script Editor** › bật Allow |

Báo lỗi: trên tin có nút chép **ID tin**; gửi kèm đoạn cuối `data/server.log` (không gửi `account.session`).

---

## Cho developer

<details>
<summary><b>Kiến trúc</b></summary>

- Frontend: Next.js (App Router, static export) + React + TypeScript, Tailwind v4, shadcn/ui (Base UI), Motion, TanStack Query.
- Backend: FastAPI + Telethon + SQLite (WAL) trong một Python process; REST + SSE.
- Bản build: FastAPI phục vụ cả UI tĩnh và `/api` tại `http://127.0.0.1:8765`. Static export vẫn là app React tương tác, chỉ không có Next server lúc chạy; API, cookie và Telegram đều thuộc Python.
- Module: **Telegram Inbox** `/`, **Cài đặt** `/settings/` (nhóm Chung / Telegram / YouTrack / AI / GitHub / Phím tắt, `#nhóm` trên URL), **My Dashboard** `/youtrack/` (`web/src/components/yt/`) + API `/api/yt/*` (`telegram_dashboard/yt_dashboard.py`, cache 50s, gộp request trùng, tải trang song song).
- YouTrack dùng `YOUTRACK_URL` / `YOUTRACK_TOKEN`; tùy chọn `YT_HISTORY_DAYS`, `YT_WIP`, `YT_STALE`, `YT_DEAD`.

Tài liệu: [plan](docs/superpowers/plans/2026-10-29-local-web-implementation.md) · [thiết kế](docs/superpowers/specs/2026-10-29-local-web-design.md) · [rà stack](docs/decisions/2026-10-29-stack-review.md) · [nghiệm thu](docs/verification/local-web-smoke.md) · [cài từ source chi tiết](docs/SETUP.md).

</details>

<details>
<summary><b>Chạy từ source</b></summary>

Yêu cầu: [uv](https://docs.astral.sh/uv/) (tự tải Python 3.14 theo `.python-version`), Node 24 LTS (khuyến nghị ≥ 24.22.1, xem `.node-version`). Hướng dẫn từng bước cho macOS và Windows: **[docs/SETUP.md](docs/SETUP.md)**.

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

- macOS: double-click `Start Dashboard Telegram.command`, script tự cài dependencies, build lại UI khi cần, chạy server nền và mở trình duyệt. Menu bấm số: **1** start · **2** stop · **3** restart (tự build lại UI nếu code đổi) · **4** mở trình duyệt · **5** xem log · **0** / Esc thoát. Đóng cửa sổ cũng dừng server.
- Windows: double-click `Start Dashboard Telegram.bat`.
- Không cần `.env`: giá trị nhập trên giao diện lưu ở `data/config.json` và thắng `.env`. `.env` (từ `.env.example`) chỉ cho tùy chỉnh nâng cao, ví dụ `NOTIFY=0` (tắt thông báo), `DONE_REACTION=👍`.
- Đăng nhập bằng terminal: `uv run python -m telegram_dashboard login`. Mở trang đã mở khóa: `uv run python -m telegram_dashboard open`.

</details>

<details>
<summary><b>Chế độ dev</b></summary>

```bash
npm run dev
```

Next dev ở `http://127.0.0.1:3000` (proxy `/api` sang Python `:8765`), Python nhận `APP_ORIGIN=http://127.0.0.1:3000`. Ctrl+C dừng cả hai. Port 3000 phải trống.

</details>

<details>
<summary><b>Kiểm tra</b></summary>

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

E2E chạy với backend fixture độc lập (`web/tests/fixture_server.py`, dữ liệu giả, Telegram / AI giả, port 8765 và 8799), không cần credentials. Sau khi đổi DTO Python, chạy lại `npm run api:types` để sinh `web/src/lib/api.generated.d.ts`.

</details>

<details>
<summary><b>Phát hành</b></summary>

Skill `/release` (`.claude/skills/release/SKILL.md`) → tag `vX.Y.Z` → CI `.github/workflows/release.yml` đóng gói cả hai OS (`scripts/package.py`, `packaging/`) và ký từng gói bằng RSA (secret `RELEASE_SIGNING_KEY`; khóa công khai `telegram_dashboard/release_key.pem`). App chỉ tự cập nhật từ gói có chữ ký `.sig` hợp lệ; lệnh cài kiểm tra sha256 của gói.

</details>

## Giới hạn đã biết

- Một tài khoản, một người dùng, chỉ loopback; chưa có VPS / media.
- Telegram không bảo đảm thông báo mọi lần xóa / sửa cũ; recovery chỉ lấy được tin mà tài khoản còn thấy.
- Nhóm thường nâng cấp supergroup: nhóm cũ bị đánh dấu đã chuyển và dừng thu thập; chọn lại nhóm mới.
- SQLite / session không được mã hóa riêng; dựa vào quyền file và mã hóa ổ đĩa. Xóa dữ liệu không cam kết xóa pháp y khỏi WAL / backup.

## Lưu ý

Radar là công cụ cá nhân, không liên kết với Telegram, JetBrains (YouTrack), Anthropic, OpenAI hay Google. Bạn chịu trách nhiệm tuân thủ điều khoản của Telegram và từng dịch vụ AI khi dùng.
