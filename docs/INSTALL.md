# Cài Telegram Dashboard (người dùng)

Tải bản mới nhất tại **https://github.com/phamanh1289/telegram_dashboard/releases/latest**.
Không cần cài Python, Node hay git: gói đã có sẵn tất cả.

## Windows 10/11 (64-bit)

**Cách khuyên dùng:** bấm Start, gõ **PowerShell**, mở lên, dán lệnh này rồi Enter:

```powershell
irm https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-windows.ps1 | iex
```

Lệnh tải bộ cài bản mới nhất, cài vào `%LOCALAPPDATA%\Programs\Telegram Dashboard` (không cần quyền admin),
tạo shortcut **Telegram Dashboard** ở Start Menu và Desktop, rồi mở app: một cửa sổ đen hiện ra (đó là server,
**để nguyên**, đóng = tắt app), trình duyệt mở `http://127.0.0.1:8765`.

Lần đầu: **Cài đặt › Telegram** tự mở → dán **API ID / API Hash** (tạo ở https://my.telegram.org/apps,
mục *API development tools*) → đăng nhập bằng số điện thoại → mã Telegram gửi → mật khẩu 2FA (nếu có).

Hằng ngày: mở **Telegram Dashboard** từ Start Menu / Desktop.

**Cách khác: tải Setup.exe bằng trình duyệt** (`TelegramDashboard-X.Y.Z-windows-x64-setup.exe` ở trang Releases).
Bộ cài chưa ký số nên Windows hiện *"Windows protected your PC"* (SmartScreen): bấm **More info** → **Run anyway**.
Trình duyệt (Edge/Chrome) cũng có thể cảnh báo file "không phổ biến": chọn **Keep** / **Giữ lại**.

Không muốn cài: tải `…-windows-x64.zip` → chuột phải › Properties › tick **Unblock** › OK → *Extract All* →
mở `Start Dashboard Telegram.bat` trong thư mục vừa giải nén.

Lưu ý Windows:
- Đừng click/bôi đen chữ trong cửa sổ đen lúc đang chạy (app đã tắt chế độ này, nhưng nếu thấy tiêu đề cửa sổ có
  chữ *Select* thì bấm **Esc** để server chạy tiếp).
- Port 8765 bị app khác chiếm thì app tự dùng port trống kế tiếp (8766…) và tự mở đúng địa chỉ; mở app lần nữa khi đang chạy chỉ mở lại trang, không chạy thêm server.
- Firewall sẽ không hỏi: app chỉ nghe trên máy (127.0.0.1), không mở ra mạng ngoài.
- Thông báo khi có tin tag mới (banner) hiện chỉ có trên macOS; Windows xem số tin chờ trên tiêu đề tab.

## macOS (Apple Silicon)

Mở **Terminal** (Spotlight: gõ "Terminal"), dán lệnh này rồi Enter:

```bash
curl -fsSL https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-macos.sh | bash
```

Lệnh tải bản mới nhất vào `~/Applications/Telegram Dashboard`, mở thư mục đó và chạy app: một cửa sổ
Terminal mở (để nguyên, đóng = tắt app), trình duyệt mở `http://127.0.0.1:8765`. Đăng nhập như bước 5 của Windows.
Lần sau: double-click `Start Dashboard Telegram.command` trong thư mục đó (kéo vào Dock cho tiện).

> Vì sao không tải zip bằng trình duyệt? App chưa được Apple notarize nên file tải qua trình duyệt bị chặn
> (*"Apple could not verify… Not Opened"*). Nếu đã lỡ tải zip: bấm **Done**, mở **System Settings ›
> Privacy & Security**, kéo xuống bấm **Open Anyway** (hoặc chạy
> `xattr -dr com.apple.quarantine "<thư mục Telegram Dashboard>"`) rồi mở lại.

## Cập nhật

**Cài đặt › GitHub › Cập nhật**: app tự kiểm tra GitHub mỗi giờ; có bản mới thì hiện số bản → bấm **Cập nhật**
(hoặc bật *Tự động cập nhật*). App tải gói mới, khởi động lại và tải lại trang; đăng nhập, cài đặt và dữ liệu giữ nguyên.

Chạy lại lệnh cài (PowerShell / Terminal) hoặc Setup.exe bản mới hơn cũng được; **đóng app trước**, dữ liệu giữ nguyên.

## AI (tùy chọn)

Tính năng AI cần cài và đăng nhập riêng một trong các CLI: Claude Code (`claude`), Codex (`codex`)
hoặc Antigravity (`agy`). Không có thì inbox vẫn chạy, chỉ ẩn AI.

## Gỡ cài đặt

- Windows: Settings › Apps › **Telegram Dashboard** › Uninstall. Dữ liệu (`data\` trong thư mục cài, gồm session
  Telegram) được giữ lại; xóa tay nếu muốn sạch hẳn.
- macOS: xóa thư mục `~/Applications/Telegram Dashboard`.
- Nên thu hồi phiên: Telegram › Settings › Devices › kết thúc phiên của dashboard.
