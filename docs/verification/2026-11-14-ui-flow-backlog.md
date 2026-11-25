# UI Flow — Backlog (mục 12) và cải tiến thêm: kiểm chứng

Ngày: 14/11/2026 · nhánh `features/refactor-ui-diagram` · chưa commit. Mọi mục chạy bằng code; không thêm lượt AI.

## Đã có trước khi làm → phần thêm

| Backlog | Đã có | Thêm |
|---|---|---|
| 1. Bộ lọc Cần rà soát | "Soát luồng": orphan / nút cụt / thiếu back / thiếu AC / dữ liệu hỏng (gồm link mất đích) | Loại mới **Chưa khớp ảnh** (nút có ảnh mà không thấy trên thiết kế) và **Thiếu nguồn** (màn không link Zeplin); nút lọc theo loại kèm số đếm; ở chế độ Sửa bấm dòng mở luôn màn / nút để sửa. Cùng một lối vào "Soát luồng" |
| 2. Chọn màn bắt đầu | Prototype, layout, kiểm orphan đều lấy màn đầu tiên | `Flow.start` (schema v2, tuỳ chọn; id lạ bị bỏ) ở Python / JS / TS; nút "▶ Màn bắt đầu" trong khung thuộc tính; dấu ▶ trên màn; Prototype, "Bắt đầu lại", layout, kiểm orphan, checklist dùng chung `startOf` |
| 3. Redo | Undo bằng ⌘Z, không có nút | `api.redo`, ⌘⇧Z / Ctrl+Y, nút "↶ Hoàn tác" / "↷ Làm lại" (chế độ Sửa, tự tắt khi hết bước); sửa mới xoá nhánh redo |
| 4. So sánh phiên bản | `changes()` chỉ chạy lúc lưu (bình luận) | `POST /api/yt/flow/diff` dùng đúng `changes()` so với file hiện tại trên ticket, không ghi; nút "Xem thay đổi" cạnh "Cập nhật", báo khi file trên ticket đã đổi; danh sách tự ẩn khi sửa tiếp |
| 5. Cập nhật nguồn có chọn lọc | Render lại thay toàn bộ sơ đồ | `keep_manual`: render lại giữ ghi chú, vùng bấm vẽ tay, màn bắt đầu của màn / nút khớp (cùng id hoặc cùng tên, như danh sách thay đổi), và vị trí khi không có màn mới. Dialog gửi `keep` = sơ đồ đang xem (gồm sửa chưa lưu; chỉ dùng cho merge bằng code, không vào prompt); lượt "Tiếp tục" dùng file ticket. Footer báo "Giữ từ sơ đồ trước: …". `GET /flow` trả `ticket_newer` (ticket sửa sau file > 2 phút) → dòng nhắc chỉ tới ⋯ › Render lại (không thêm lối vào thứ hai). Ảnh Zeplin luôn đọc bản mới nhất nên thiết kế đổi tự hiện |
| 6. Checklist test từ graph | Không có | `testPaths`: DFS có giới hạn từ màn bắt đầu, giữ đường thêm liên kết mới, đến khi phủ mọi liên kết tới được; liệt kê liên kết không tới được. Thẻ "Checklist test" trong "Soát luồng" + "Sao chép"; `UIFlow.paths()` cho test. AI diễn giải: dán vào AI của ticket (không thêm prompt / lối AI mới) |

## Cải tiến thêm

- Bình luận / "Xem thay đổi" ghi cụ thể: thêm / sửa / xoá ghi chú, vẽ / chỉnh / bỏ vùng bấm, đổi màn bắt đầu (trước đây gộp "Sửa thuộc tính").
- Một loạt phím mũi tên trên cùng màn / vùng (< 1 s giữa hai lần) là một bước undo.
- Tìm màn theo chữ trên nút ("đăng xuất" → Trang chủ).
- Render lại khi không đọc được file ticket để giữ chỉnh tay: render vẫn xong, cảnh báo nằm trong "Nguồn dựng sơ đồ".

## Test (lần chạy cuối)

- Python toàn bộ `tests/`: **354 passed**; Ruff `telegram_dashboard tests` sạch. Mới: start, `keep_manual` (đổi id, thêm màn), changes chi tiết, `/flow/diff` không ghi, `ticket_newer` với ngưỡng bình luận, `/ai/flow` với `keep`.
- Playwright toàn bộ `web/tests` (bản copy scratch, cổng 8883): **149 passed, 1 failed** — `mascot.spec.ts`, lỗi sẵn có, không liên quan. Mới: màn bắt đầu, Cần rà soát + lọc + mở nút, redo (nút + phím + nhánh bị xoá), gộp undo phím, checklist + sao chép clipboard, Xem thay đổi, ticket đổi + render gửi `keep`, tìm theo nút.
- `tsc`, ESLint `web/` sạch; `api.generated.d.ts` sinh lại (`kept`).

## Giới hạn

- `ticket_newer` dựa vào `updated` của ticket: bình luận hay đổi field bất kỳ sau 2 phút cũng tính là "ticket đổi".
- Ghép chỉnh tay theo id / tên giống danh sách thay đổi: màn bị AI đổi tên khác hẳn sẽ không mang ghi chú / vùng bấm theo.
- Checklist dừng ở 60 đường / 20.000 bước DFS với sơ đồ rất dày; phần còn lại hiện là "chưa đi tới".
- Không có lượt AI diễn giải checklist riêng.
