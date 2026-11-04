# Cài Telegram Dashboard (người dùng)

Tải bản mới nhất tại **https://github.com/phamanh1289/telegram_dashboard/releases/latest**.
Không cần cài Python, Node hay git: gói đã có sẵn tất cả.

## Windows 10/11 (64-bit)

1. Tải **`TelegramDashboard-X.Y.Z-windows-x64-setup.exe`**.
2. Mở file. Windows có thể hiện *"Windows protected your PC"* (bộ cài chưa ký số): bấm **More info** → **Run anyway**.
3. Bấm Next → Install. Không cần quyền admin; app cài vào `%LOCALAPPDATA%\Programs\Telegram Dashboard`,
   tạo shortcut **Telegram Dashboard** ở Start Menu (và Desktop nếu tick).
4. Cuối bộ cài để tick **Open Telegram Dashboard** → Finish. Một cửa sổ đen mở (đó là server, **để nguyên**),
   trình duyệt tự mở `http://127.0.0.1:8765`. Nếu Windows Firewall hỏi, chọn **Cancel** cũng được (app chỉ nghe trên máy).
5. Lần đầu: **Cài đặt › Telegram** tự mở → dán **API ID / API Hash** (tạo ở https://my.telegram.org/apps,
   mục *API development tools*) → đăng nhập bằng số điện thoại → mã Telegram gửi → mật khẩu 2FA (nếu có).

Hằng ngày: mở **Telegram Dashboard** từ Start Menu. Đóng cửa sổ đen = tắt app.

Không muốn dùng bộ cài: tải `…-windows-x64.zip`, *Extract All*, mở `Start Dashboard Telegram.bat` trong thư mục vừa giải nén.

## macOS (Apple Silicon)

1. Tải **`TelegramDashboard-X.Y.Z-macos-arm64.zip`**, mở để giải nén, kéo thư mục **Telegram Dashboard**
   vào nơi cố định (ví dụ `Applications` hoặc `Documents`).
2. Double-click `Start Dashboard Telegram.command`. Lần đầu macOS chặn (chưa notarize):
   **System Settings › Privacy & Security** → kéo xuống → **Open Anyway** → mở lại file.
3. Terminal mở (để nguyên), trình duyệt mở `http://127.0.0.1:8765`. Đăng nhập như bước 5 của Windows.

## Cập nhật

**Cài đặt › GitHub › Cập nhật**: app tự kiểm tra GitHub mỗi giờ; có bản mới thì hiện số bản → bấm **Cập nhật**
(hoặc bật *Tự động cập nhật*). App tải gói mới, khởi động lại và tải lại trang; đăng nhập, cài đặt và dữ liệu giữ nguyên.

Cài đè bằng Setup.exe bản mới hơn cũng được (Windows), dữ liệu cũng giữ nguyên.

## AI (tùy chọn)

Tính năng AI cần cài và đăng nhập riêng một trong các CLI: Claude Code (`claude`), Codex (`codex`)
hoặc Antigravity (`agy`). Không có thì inbox vẫn chạy, chỉ ẩn AI.

## Gỡ cài đặt

- Windows: Settings › Apps › **Telegram Dashboard** › Uninstall. Dữ liệu (`data\` trong thư mục cài, gồm session
  Telegram) được giữ lại; xóa tay nếu muốn sạch hẳn.
- macOS: xóa thư mục **Telegram Dashboard**.
- Nên thu hồi phiên: Telegram › Settings › Devices › kết thúc phiên của dashboard.
