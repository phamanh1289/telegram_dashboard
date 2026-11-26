# Đăng nhập ngay trong tab (lần chạy đầu)

## Vì sao
Cài mới, mở app thì tab Telegram và YouTrack tự `router.replace` sang `/settings/#…`. Người mới rơi vào trang Cài đặt dày đặc (Hàng chờ, Q&A, Briefing, quy tắc…), không biết mình đang ở đâu; lúc chờ chỉ có chữ "Đang kiểm tra…". Muốn: mỗi tab tự hiện **chỉ một thẻ đăng nhập** ở giữa, có linh vật phản ứng, loading có cảnh.

## Mục tiêu / không làm / phản mục tiêu
- Mục tiêu: tab Telegram chưa đăng nhập (`setup_required` / `login_required`) và tab YouTrack chưa có token (`mock`) hiện thẻ đăng nhập riêng; xong thì vào thẳng nội dung tab.
- Không làm: màn hướng dẫn chung nhiều bước; thiết lập tài khoản AI trong thẻ; đếm ngược gửi lại mã; mắt nhìn theo con trỏ.
- Phản mục tiêu: thêm lối vào thứ hai (thẻ trong Cài đặt vẫn là chỗ **đổi** tài khoản, dùng cùng component); chặn chuyển sang tab khác; lỗi hiện như "chưa có dữ liệu".

## Hướng đã chọn
- **A (chọn): đăng nhập ngay trong tab.** Bỏ 2 chỗ redirect, tab tự giải thích chính nó, không màn mới.
- B: màn hướng dẫn chung (vai trò → Telegram → YouTrack → AI). Trùng checklist `guide-setup.tsx`, thêm lối vào thứ hai.
- C: giữ redirect, ẩn thẻ khác trong Cài đặt. Vẫn rơi vào Cài đặt, không giải quyết điều người dùng thấy tệ.

## Thiết kế
1. **Chủ sở hữu form** (một nguồn, không shim):
   - `TelegramSection` + `TG_ERRORS` chuyển từ `features/settings/components/telegram.tsx` sang `features/telegram/components/login.tsx` (`TelegramLogin`).
   - Form URL/token YouTrack chuyển từ `features/settings/components/youtrack.tsx` sang `features/youtrack/components/connect.tsx` (`YtConnect`).
   - Cài đặt import lại từ hai file đó. Cả hai nhận `onMood?(mood)` tùy chọn để thẻ ngoài tab điều khiển linh vật; trong Cài đặt không truyền.
2. **Khung thẻ** `shared/components/login-stage.tsx` (`LoginStage`, trung lập, nhận props): `BotStage` + `AiBot`, tiêu đề, một dòng phụ, `children`. Căn giữa màn như `RolePicker`, có `TopBar` phía trên để vẫn chuyển tab được.
3. **Tab Telegram** (`inbox.tsx`): bỏ `firstRun` + redirect; `setup_required` / `login_required` → `LoginStage` + `TelegramLogin`. Thứ tự giữ như cũ: đăng nhập → chọn vai trò → inbox.
4. **Tab YouTrack** (`youtrack/components/app.tsx`): bỏ redirect `mock`; `mock` → `LoginStage` + `YtConnect`. Thứ tự vai trò giữ như cũ.
5. **Linh vật phản ứng** (`mood` trên wrapper, CSS trong `globals.css`, tôn trọng `prefers-reduced-motion`):
   - `shy`: focus ô bí mật (API Hash, 2FA, token) → `.m-blink` / `.ai-blink` dừng animation, khép (`scale: 1 .1`).
   - `peek`: bấm 👁 hiện chữ → mắt hé (`scale: 1 .45`).
   - `busy`: đang gửi mã / đăng nhập / kiểm token → `BotStage` có vòng `ai-ring` + robot lắc nhẹ.
   - `no`: lỗi → thẻ rung ngang 1 lần (motion), linh vật lắc đầu.
   - `happy`: thành công → `m-wave` + "Xin chào {tên}" ~1,2s rồi vào tab.
6. **Ô bí mật có nút 👁**: `SecretInput` trong `shared/components/ui/input.tsx` (Eye / EyeOff, bọc `Hint`), dùng cho API Hash, 2FA, token YouTrack.
7. **Mã OTP**:
   - Backend `POST /api/telegram/code` trả `{via: "app" | "sms" | "other", length: number | null}` thay 204 (đọc `sent.type` của Telethon); sinh lại `api.generated.d.ts`.
   - Frontend `CodeInput`: một `<input>` thật (`one-time-code`, dán được) vẽ thành `length` ô (mặc định 5); đủ số thì tự gửi.
   - Dòng phụ theo `via`: "Mã gửi vào app Telegram (không phải SMS)" / "Mã gửi qua SMS".
8. **Thanh bước** API → Số điện thoại → Mã → 2FA: bước xong có ✓; đổi bước bằng `AnimatePresence` fade/slide; 2FA chỉ hiện khi cần.
9. ~~**Loading** cảnh `connect`~~: bỏ (xem plan › Global Constraints): thẻ chỉ hiện khi status/config đã nạp, chờ mutation do `mood="busy"` lo.
10. **i18n + guide**: chuỗi mới có bản en; sửa chapter guide vi/en đang nói "lần đầu mở Cài đặt".

## Kiểm chứng
- `npm run typecheck`, `npm run lint`, `uv run ruff check .`, `uv run pytest -q tests/test_repo_guards.py` + test route Telegram code.
- E2E trên bản copy ở scratch (không đụng `:8765`, `web/out`): chụp màn tab Telegram (API → số → mã → 2FA → xong), tab YouTrack (token sai → đúng), mood nhắm mắt, đo tâm cảnh `connect` so với vùng chờ.

## Để người làm tự quyết
Thời lượng / biên độ animation, bố cục ô OTP trên màn hẹp, câu chữ `LINES` cụ thể.
