# UI Flow phase 6–7 — Search, thêm từ Zeplin, hotspot, note, drag, layout: kiểm chứng

Ngày: 14/11/2026 · nhánh `features/refactor-ui-diagram`. Mọi thao tác dưới đây chạy bằng code, 0 lượt AI.

## Đã làm

| Hạng mục | Cách làm | Ở đâu |
|---|---|---|
| T6.1 Tìm màn | Ô combobox trên thanh công cụ (map + file HTML): tên không phân biệt dấu/hoa (`norm`), id, link Zeplin (so `canon`). Đếm + danh sách; ↑/↓ chọn, Enter gọi `goto` (focus có sẵn), Esc xoá. Màn khớp viền vàng `uf-match`, khác `uf-on` của focus. Không commit/dirty/undo; chỉ đổi class, không dựng lại flow | `web/public/uiflow.js` `finder/search/applyMatch` |
| T6.2 Thêm từ Zeplin | Nút "+ Từ Zeplin" (chế độ Sửa): kiểm URL; trùng (`canon`) → tới màn có sẵn + "Vẫn thêm bản sao"; dashboard đọc qua `opts.lookup` = `POST /flow/shots` (cache backend dùng lại cho truy vấn ảnh sau đó), thêm màn với tên + ảnh Zeplin trong **một** commit. 401/mạng → "Không đọc được Zeplin: …" + Thử lại; không có màn → thông báo riêng; cả hai có "Thêm màn chờ ảnh". File HTML độc lập (không backend) thêm màn chờ ảnh | `uiflow.js` `zeplinForm`, `web/src/lib/uiflow.ts` `lookup` |
| T7.1 Hotspot | "+ Vùng bấm" → kéo trên ảnh vẽ rect (nút mới hoặc vẽ lại cho nút đang chọn). Rect kéo để dời, góc để đổi cỡ, luôn nằm trong ảnh, tối thiểu 12 px. Inspector số theo px thiết kế; "Khớp theo chữ" bỏ rect. Đổi tên/nối/xoá dùng đường có sẵn (xoá nút bỏ cả link cùng undo). Toạ độ là tỉ lệ ảnh gốc nên không lệch theo zoom/pan/ảnh dài | `editor()` `startDraw/drawn/shift`, `buildFrame` |
| T7.2 Note | Ô "Ghi chú" (textarea, ≤4.000, lưu khi blur, Esc trả lại), badge ✎ (textContent/title, không HTML). Lưu trong flow/draft/HTML, không post YouTrack | `editor().memo`, `buildFrame` |
| T7.3 Drag | Giữ drag/overlay family; thêm ô Vị trí X/Y và phím mũi tên (màn 10/100 px với Shift, kéo theo popup; vùng bấm 2/10 px). Esc/pointercancel rollback cả drag rect/draw | `nudge`, `cancel` |
| T7.4 Layout | "Sắp xếp lại": xoá toạ độ rồi chạy `layout` có sẵn (BFS phân lớp, cycle không lặp, overlay cạnh cha, cụm rời, thứ tự ổn định) — một undo. Mở file / ảnh tới muộn vẫn không tự layout lại | `relayout` |

Sửa thêm lỗi có từ trước: `node()` gọi `CSS.escape` nhưng `CSS` trong engine là chuỗi stylesheet → chọn một nút ném lỗi. Đổi thành `window.CSS.escape`. Vùng bấm vẽ tay được phép nằm trên vùng home bar (khớp chữ vẫn đẩy xuống dòng dưới như cũ).

## Test

- Browser (bản copy scratch, cổng 8883; không đụng `web/out` / `:8765`): `uiflow`, `flow-dialog`, `flow-renderer`, `flow-manifest`, `uiflow-pack` — **120 passed**. Mới 10 test: tìm (không dấu, URL, id, phím, Esc, không dirty); thêm Zeplin (đọc 1 lần, tên + ảnh, 1 undo; URL sai, trùng + bản sao, lỗi token, không tìm thấy, màn chờ ảnh; keyboard-only); dialog thật qua `/flow/shots` lỗi 502 rồi Thử lại; vẽ/đổi cỡ/sửa số/khớp chữ + undo; Esc thoát vẽ; note + badge + Esc + không render HTML; phím + ô vị trí kéo theo popup, Sắp xếp lại 1 undo; rect kéo trong ảnh + phím; rect/note qua "Lưu file".
- Python: 194 passed (flow + yt + ai + guards + storage). `tsc`, ESLint sạch. `guide.json` / `guide.en.json` cập nhật.

## Giới hạn

- Link `zpl.io` rút gọn chỉ phân giải ở server, nên trùng giữa link rút gọn và link đầy đủ của cùng màn chưa bị phát hiện ở client.
- Backend vẫn gộp 403 với 404 thành "không tìm thấy" (một màn không chia sẻ không được làm hỏng cả lô ảnh); thông báo nói rõ cả hai khả năng.
- Thuật toán layout giữ nguyên (đã ổn định, xử lý cycle/overlay/cụm rời); chưa đo/chỉnh thêm bố cục nhánh.
- Nút chú thích không có link vẫn hiện ở "Soát luồng" dạng nút cụt (cảnh báo, không bắt buộc nối).
- Mỗi lần nhấn phím mũi tên là một bước undo (chưa gộp).
- Hint/Segmented cho toolbar engine thuộc phase 8.
