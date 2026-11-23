# Tính năng mới cho vai trò PO/PM — cách dùng (22/11/2026)

Bật trước: **Cài đặt › Chung › Vai trò = PO/PM**. Các nút ghi "(PO)" bên dưới chỉ hiện với vai trò này.
Ký hiệu: 🤖 cần AI · 🔀 AI tuỳ chọn · ✋ không dùng AI. Trong app: nút **Hướng dẫn sử dụng** có tour từng bước cho các mục này.

## 1. Cập nhật story (PO) — 🔀

Đưa một thay đổi (AC còn thiếu, quyết định mới, nghiệp vụ sửa) vào mô tả ticket, lưu lên YouTrack rồi báo nhóm. Một khung dùng chung cho mọi lối vào.

**Mở khung từ:**
- YouTrack › Ticket › bấm dòng ticket › **Cập nhật story** cạnh mục Mô tả
- Telegram › Briefing › mục Cần confirm / Đã chốt / Thay đổi › **Cập nhật story**
- Telegram › Q&A › chuỗi có mã ticket › thanh **Đã chốt** hoặc thẻ **Kết luận (AI)** › **Cập nhật story** (xem mục 2)
- YouTrack › bảng bên › ✨ AI cho ticket này › **Chuẩn hoá mô tả** › **Lưu vào mô tả** (xem mục 3)

**Trong khung:**
1. Kiểm mã ticket ở đầu khung; ghi thay đổi ở ô dưới cùng.
2. Chọn một cách:
   - **Soạn** (🤖): AI viết lại toàn bộ mô tả (giữ nguyên phần không đổi, cả link và ảnh) + tin báo nhóm.
   - **Tự sửa mô tả** (✋): mở mô tả đang có trên YouTrack để tự sửa; tin báo nhóm điền sẵn "Đã cập nhật story VA-x: …". AI lỗi / hết quota thì nút này có ngay trong thẻ lỗi.
3. Tab **Thay đổi** (xanh thêm, đỏ bỏ) để soát; tab **Sửa** để chỉnh tay.
4. **Lưu lên YouTrack**. Ô "Lưu kèm tin này làm bình luận" (bật sẵn) báo người theo dõi ticket.
   - Bị chặn nếu ai đó vừa sửa mô tả trên YouTrack: bấm **Soạn lại** hoặc **Lấy bản mới để sửa**. Không bao giờ ghi đè bản của người khác.
5. **Báo nhóm**: mở ô trả lời trong nhóm Telegram (ngay tin đã chốt, hoặc tin gần nhất nhắc ticket), @tag sẵn Assignee / QC; xem lại rồi tự gửi. Ticket chưa được nhắc ở nhóm nào thì **Copy tin**.

Mục Briefing / Q&A đã lưu hiện **"Đã vào story VA-x"** và tự sang đã xử lý; bấm lại để cập nhật lần nữa.

## 2. Q&A đã chốt → story, không cần AI (PO) — ✋ *(mới)*

1. Telegram › **Q&A** › chọn nhóm › bấm câu hỏi có nhắc mã ticket.
2. **Chốt** câu trả lời đúng (nút trên tin trả lời).
3. Trên thanh **Đã chốt · <người>** ở đầu chuỗi, bấm **Cập nhật story**: ô thay đổi có sẵn câu trả lời đã chốt + câu hỏi.
4. **Tự sửa mô tả** (hoặc Soạn) › Lưu › Báo nhóm (tin nhắc ngay câu trả lời đã chốt).

Muốn AI tóm tắt cả chuỗi trước: robot **AI tóm tắt kết luận** › thẻ Kết luận (AI) › Cập nhật story.

## 3. Chuẩn hoá mô tả → Lưu vào mô tả (PO) — 🤖

YouTrack › Ticket › bấm dòng › ✨ **AI cho ticket này** › **Chuẩn hoá mô tả** › chờ AI › **Lưu vào mô tả** › khung Cập nhật story mở với bản mới › xem Thay đổi › Lưu lên YouTrack.
Mô tả quá dài để AI đọc hết thì chỉ còn Copy.

## 4. Briefing › Chờ bổ sung — ✋ (mục lấy từ Briefing do AI tóm tắt)

Đưa việc còn chờ người khác ra khỏi danh sách chưa xử lý, theo dõi tuổi, nhắc khi cần.
1. Telegram › Trợ lý AI › **Briefing** › ở một mục bấm **Chờ…** › chọn **Chờ design** hoặc **Chờ BU** (lý do của PO/PM). Chờ design trên ticket có gợi ý chuyển State sang bước design.
2. Tab **Chờ bổ sung**: mỗi mục hiện tuổi (đỏ khi quá 3 ngày).
   - **Nhắc**: mở ô trả lời ngay tin gốc với câu soạn sẵn ("Nhờ bổ sung design cho: …" / "Nhờ BU confirm giúp: …"), @tag sẵn người cần trả lời.
   - **Có vẻ xong**: tự hiện khi ticket đã đi tiếp State (Chờ design) hoặc có người trả lời tin gốc (Chờ BU) → bấm **Đóng**. Không tự đóng.
   - Tick vòng tròn khi hết chờ; **Bỏ chờ** trả mục về danh sách; **Cập nhật story** đưa kết quả vào ticket.
3. Danh sách lưu trên máy chủ dashboard: máy / trình duyệt nào cũng thấy.

## 5. Briefing › tab "Cần bạn" và mục Đã chốt — ✋

- Tab **Cần bạn**: mục hỏi / giao cho bạn theo tên YouTrack, **và** mục hỏi chung "PO", "PM", "product owner" (không nhầm "3 PM", "POST").
- Mục bạn đã reply đúng tin gốc (từ app hay Telegram) tự sang đã xử lý, ghi "Bạn đã trả lời".
- Mục **Đã chốt** có mã ticket: PO dùng **Cập nhật story** (nút "ghi vào <ticket>" chỉ dành cho Dev / QA).

## 6. YouTrack › Tổng quan: thẻ "Chờ PO chốt" — ✋

YouTrack › **Tổng quan** (trang chủ PO):
- Ticket gán cho bạn đang ở State define / confirm; **Xem cả … ticket** để mở danh sách đầy đủ (giống lối tắt "Chờ PO chốt" ở Ticket).
- Cuối thẻ: bình luận YouTrack **đang hỏi bạn** (tag @bạn, nhắc tên bạn, hoặc hỏi PO / PM) mà bạn chưa trả lời. Bấm dòng để mở ticket, trả lời ở ô bình luận (⌘↵) → ticket tự rời danh sách.

## 7. AI Studio › Chất lượng ticket (PO) — 🤖

YouTrack › Tổng quan › AI Studio › tab **Chất lượng ticket**: AI rà ticket trong sprint chưa tới QC, chỉ chỗ thiếu tiêu chí nghiệm thu, nên tách, chưa estimate, có vẻ trùng, kèm gợi ý bổ sung story. Kết quả lưu trong ngày, mở lại không tốn lượt. Sprint hết ticket chưa tới QC thì tab bị khoá.

## 8. Huy hiệu và trang Hôm nay — ✋

- Đang ở Telegram / Tài liệu / Cài đặt: tab **YouTrack** hiện huy hiệu vàng = ticket rủi ro + bình luận hỏi bạn + **ticket chờ bạn chốt** (khi không có ticket mới giao cho bạn).
- Telegram › **Hôm nay**: có thêm ticket chờ bạn chốt (8 ticket chờ lâu nhất + một dòng dẫn sang YouTrack cho phần còn lại) và bình luận YouTrack đang hỏi bạn.
- Trả lời tin Telegram nhắc ticket (hoặc **Hỏi lại trong nhóm**): ô trả lời @tag sẵn **cả Assignee lẫn QC** của ticket.

## 9. Tài liệu và `#` (mọi vai trò, PO dùng nhiều) — ✋ / 🔀

- Tab **Tài liệu** trên thanh trên cùng: kho bài Knowledge Base YouTrack + file trên máy; tìm không dấu, Mục lục, ⌘F trong bài, ⭐ Yêu thích, lịch sử cập nhật (dòng đã đổi, người sửa); mã KB và tên màn Zeplin trong bài bấm mở được.
- **Hỏi AI trên tài liệu** (🔀): hỏi bài đang mở; câu hỏi lặp lại trên cùng bản trả về bản đã lưu kèm "Hỏi lại AI".
- Gõ **`#`** trong ô nhắn (mô tả / bình luận YouTrack, trả lời Telegram, Q&A) → chọn tài liệu (↑↓, Enter). YouTrack chèn link `[tên](url)`; Telegram gửi tiêu đề thành link tới bài gốc.

---
Checklist test tương ứng: [po-features.md](../test-checklists/po-features.md).
