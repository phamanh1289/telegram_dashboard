# `#` chọn tài liệu trong ô nhắn

## Vì sao
Đính kèm tài liệu hôm nay phải mở Tài liệu › Dùng tài liệu › Đính kèm vào phiên AI. Muốn chọn ngay trong ô đang gõ, giống `@` tag người: phiên AI đọc tài liệu cho task, tin Telegram / comment YouTrack mang link gốc.

## Mục tiêu / không làm
- Gõ `#` (đầu dòng hoặc sau dấu cách, không theo sau là dấu cách) → popup tìm tài liệu trong kho, phím ↑↓ Enter/Tab Esc như `@`.
- Không làm: tự gợi ý tài liệu theo nội dung task; chip tài liệu đã đính kèm; `#` ở Trợ lý AI (không đọc link) và Hỏi AI của Tài liệu.
- Anti-goal: hashtag thường (`#QA_PO_…`) hay heading `# ` bị popup chặn.

## Cách làm (đã duyệt)
- Engine chung trong `shared/components/mention.tsx`: `useCaretPick` (chữ sau ký tự kích hoạt ở caret, phím, chèn) + `PickPopup` (spring scale + fade, reduced motion = fade). `useMention` dựng trên nó, API giữ nguyên; `useJoin(a, b)` ghép `@` + `#` trên một ô.
- `useDocTag(target, text, setText)` ở `features/docs/components/doc-tag.tsx`: danh sách từ `docListQuery` (một request, cache dùng chung màn Tài liệu), lọc trên máy không dấu (tên, đường dẫn, mã ticket), tô chữ khớp (`findTerms` + `Marked`).
- Chữ chèn (thẳng vào ô, không bảng ẩn): AI `#DOC12 (tên)` / link KB `(tên)` (cùng `docRef` với Dùng tài liệu); Telegram `tên: url`; YouTrack `[tên](url)`. Telegram / YouTrack chỉ liệt kê bài có link; khớp mỗi file trên máy thì báo "chỉ dùng trong phiên AI".
- Không khớp gì thì đóng (hashtag gõ bình thường); đang tải / lỗi thì hiện trạng thái.
- Gắn: trả lời Telegram, Q&A, comment YouTrack, mô tả ticket (TicketForm), nhắn tiếp phiên AI (trừ Trợ lý AI), ghi chú Giao AI Agent, ghi chú Đối chiếu BE.

## Approaches đã cân nhắc
- Engine chung + adapter theo feature (chọn): một code cho `@` và `#`, animation sửa một chỗ.
- Hook `#` riêng chép từ `useMention`: nhanh nhưng trùng logic, trái luật reuse.
- Gọi `/api/docs/search` mỗi phím: tìm cả nội dung nhưng chậm, nặng; popup chỉ cần tên.
