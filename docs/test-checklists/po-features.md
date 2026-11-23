# Checklist test vai trò PO — feature mới (20/11/2026)

Nguồn: 4 commit gần nhất (`0217745`, `9b50d11`, `89a8b60`, `122276a`) + phần chưa commit trên nhánh `features/refactor-ui-diagram`.

## Phân loại AI

| Nhãn | Nghĩa | Lưu ý khi test |
|---|---|---|
| 🤖 **AI bắt buộc** | Phải chạy một lượt AI mới làm được, không có đường thủ công | Cần CLI AI đăng nhập + còn quota; mỗi lần bấm tốn 1 lượt; kết quả mỗi lần có thể khác |
| 🔀 **AI tuỳ chọn** | Làm được thủ công; AI chỉ là thêm | Test cả khi dùng và khi không dùng AI |
| ✋ **Thủ công** | Không gọi AI (theo luật / regex / câu mẫu cố định) | Kết quả lặp lại được; nên test kỹ đúng-sai |
| ✋ ← 🤖 | Thao tác không gọi AI, nhưng **dữ liệu đầu vào do AI tạo trước** (vd. mục Briefing do AI tóm tắt nhóm) | Cần đã có Briefing / kết quả AI trước khi test |

**Tóm tắt theo case**

| Nhãn | Case |
|---|---|
| 🤖 AI bắt buộc | PO-08, 09, 19 |
| 🔀 AI tuỳ chọn — nhánh AI | PO-01, 06, 07, 30 |
| ✋ Nhánh không AI (mới) | PO-31, 32, 33, 34 |
| ✋ Thủ công (sau Soạn hoặc Tự sửa) | PO-02, 03, 04, 05 |
| ✋ ← 🤖 | PO-10, 11, 12, 13, 14, 15, 16 (mục lấy từ Briefing) |
| ✋ Thủ công | PO-17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 29 |
| Hỗn hợp | PO-28 (lỗi ở bước AI và bước lưu) |

> Cập nhật story giờ là **AI tuỳ chọn**: trong khung, "Soạn" = AI viết mô tả mới + tin báo nhóm; "Tự sửa mô tả" = mở mô tả hiện tại để tự sửa, tin báo nhóm điền sẵn bằng câu mẫu. Cả 4 lối vào (bảng bên ticket, Briefing, Q&A, Chuẩn hoá mô tả) dùng chung khung này. Q&A có thêm lối không AI: thanh "Đã chốt". "Chuẩn hoá mô tả" và "Chất lượng ticket" vẫn là AI (bản chất tính năng).

## Chuẩn bị

- [ ] Chạy bản dev (`npm run dev`) — phần lớn tính năng PO chưa commit, app `:8765` chưa có
- [ ] Cài đặt › Chung › Vai trò = **PO/PM**
- [ ] CLI AI (Claude / Codex / Antigravity) đăng nhập, còn quota — cho các case 🤖
- [ ] Đã chạy Briefing cho nhóm test (có mục Cần confirm / Đã chốt / Thay đổi) — cho các case ✋ ← 🤖
- [ ] Chọn 1 ticket test (có Assignee + QC) và 1 nhóm Telegram test — "Lưu lên YouTrack" sửa mô tả thật, "Báo nhóm" gửi tin thật
- [ ] Ticket test đã được nhắc trong nhóm test; có thêm 1 ticket chưa từng được nhắc (cho PO-05)

Người test: ________ · Ngày: ________ · Build / commit: ________

---

## A. Cập nhật story

- [ ] **PO-01 · Từ chi tiết ticket (nhánh AI)** — 🔀 AI tuỳ chọn
  - Bước: Ticket › mở bảng bên › "Cập nhật story" cạnh Mô tả › ghi thêm 1 AC › Soạn
  - Đúng: AI trả về toàn bộ mô tả mới, phần không đổi giữ nguyên (cả link, ảnh); mở sẵn tab "Thay đổi" (xanh thêm, đỏ bỏ)
- [ ] **PO-02 · Sửa tay bản AI rồi lưu** — ✋ Thủ công (sau PO-01)
  - Bước: tiếp PO-01 › "Sửa" › chỉnh 1 dòng › "Lưu lên YouTrack"
  - Đúng: mô tả trên YouTrack đúng bản đã sửa
- [ ] **PO-03 · Chặn ghi đè** — ✋ Thủ công (sau PO-01)
  - Bước: bấm Soạn › sửa mô tả trực tiếp trên YouTrack › quay lại bấm Lưu
  - Đúng: bị chặn, yêu cầu Soạn lại; không ghi đè bản người khác vừa sửa
- [ ] **PO-04 · Báo nhóm** — ✋ Thủ công (tin do AI soạn ở PO-01, hoặc câu mẫu ở PO-31)
  - Bước: sau khi lưu › "Báo nhóm"
  - Đúng: ô trả lời mở ngay tin đã chốt, tag sẵn Assignee và QC (nếu có trong nhóm); chỉ gửi khi bạn bấm gửi
- [ ] **PO-05 · Ticket chưa được nhắc ở nhóm nào** — ✋ Thủ công (sau Soạn hoặc Tự sửa)
  - Bước: làm PO-01 với ticket chưa từng được nhắc trên Telegram
  - Đúng: chỉ có "Copy tin", không có "Báo nhóm"
- [ ] **PO-06 · Từ Briefing** — 🔀 AI tuỳ chọn (mục Briefing do AI tóm tắt; trong khung chọn Soạn hoặc Tự sửa mô tả)
  - Bước: Briefing › tab Cần confirm / Đã chốt / Thay đổi › "Cập nhật story"
  - Đúng: khung hiện đúng mã ticket; lưu xong mục ghi "Đã vào story VA-x" và tự chuyển sang đã xử lý
- [ ] **PO-07 · Từ Q&A, thẻ Kết luận (AI)** — 🔀 AI tuỳ chọn (nhánh AI: tóm tắt kết luận + Soạn; nhánh không AI ở PO-33)
  - Bước: Q&A › chọn câu hỏi có mã ticket › robot "AI tóm tắt kết luận" › "Cập nhật story"
  - Đúng: kết luận được đưa vào mô tả; "Báo nhóm" trỏ tới câu trả lời đã chốt (chưa chốt thì tới câu hỏi)
- [ ] **PO-08 · Từ phiên AI** — 🤖 AI bắt buộc
  - Bước: bảng bên › ✨ AI cho ticket này › "Chuẩn hoá mô tả" › "Lưu vào mô tả"
  - Đúng: mở khung Cập nhật story với bản mới, xem được diff, lưu được
- [ ] **PO-09 · Mô tả quá dài** — 🤖 AI bắt buộc
  - Bước: làm PO-08 với ticket có mô tả rất dài
  - Đúng: chỉ còn nút Copy, không có "Lưu vào mô tả"
- [ ] **PO-10 · Nút đúng theo vai trò** — ✋ ← 🤖
  - Bước: Briefing › Đã chốt có mã ticket
  - Đúng: PO không thấy "ghi vào <ticket>"; đổi vai trò sang Dev thì nút này hiện lại

- [ ] **PO-31 · Tự sửa mô tả (không AI)** — ✋ Thủ công
  - Bước: Ticket › bảng bên › "Cập nhật story" › (ghi hoặc bỏ trống ô thay đổi) › "Tự sửa mô tả" › sửa ô "Mô tả mới" › "Lưu lên YouTrack"
  - Đúng: không chạy AI (không có robot / AiThinking); ô "Mô tả mới" là mô tả hiện tại trên YouTrack; tab "Thay đổi" hiện đúng phần vừa sửa; "Tin báo nhóm" điền sẵn "Đã cập nhật story VA-x: <thay đổi>" (ô thay đổi trống: "…nhờ mọi người check lại mô tả."), sửa được; lưu xong kèm bình luận nếu ô bình luận bật
- [ ] **PO-32 · Chặn ghi đè khi tự sửa** — ✋ Thủ công
  - Bước: "Tự sửa mô tả" › sửa mô tả trực tiếp trên YouTrack › quay lại bấm "Lưu lên YouTrack" › bấm "Lấy bản mới để sửa"
  - Đúng: lưu bị chặn ("vừa đổi sau khi bạn mở bản này"); "Lấy bản mới để sửa" nạp lại mô tả mới nhất, lưu lại được
- [ ] **PO-33 · Q&A đã chốt → Cập nhật story (không AI)** — ✋ Thủ công
  - Bước: Q&A › chuỗi có nhắc mã ticket › "Chốt" một câu trả lời › trên thanh "Đã chốt" bấm "Cập nhật story" › "Tự sửa mô tả" › lưu › "Báo nhóm"
  - Đúng: không cần bấm "AI tóm tắt kết luận"; ô thay đổi có sẵn câu trả lời đã chốt + "Câu hỏi: …"; lưu xong nút ghi "Đã vào story VA-x" ở cả thanh Đã chốt lẫn thẻ Kết luận (AI) nếu mở; "Báo nhóm" mở ô trả lời ngay câu trả lời đã chốt; chuỗi không nhắc ticket hoặc vai trò khác PO thì không có nút
- [ ] **PO-34 · AI lỗi → tự sửa** — ✋ Thủ công
  - Bước: AI hết quota / CLI chưa đăng nhập › "Cập nhật story" › Soạn › trong thẻ lỗi "Chưa soạn được" bấm "Tự sửa mô tả"
  - Đúng: thẻ lỗi có nút "Tự sửa mô tả"; bấm vào mở mô tả hiện tại để sửa, lưu được như PO-31

## B. Briefing › Chờ bổ sung

- [ ] **PO-11 · Đưa mục vào danh sách chờ** — ✋ ← 🤖
  - Bước: bấm "Chờ…" ở một mục
  - Đúng: chỉ có 2 lý do "Chờ design" / "Chờ BU"; mục rời danh sách chưa xử lý, sang tab "Chờ bổ sung"
- [ ] **PO-12 · Tuổi và nhắc** — ✋ ← 🤖 (câu nhắc là mẫu cố định, không AI)
  - Bước: mở tab Chờ bổ sung › "Nhắc"
  - Đúng: mỗi mục hiện tuổi (đỏ khi quá 3 ngày); "Nhắc" mở ô trả lời ngay tin gốc với câu mẫu ("Nhờ bổ sung design cho: …" / "Nhờ BU confirm giúp: …"), tag sẵn người cần trả lời
- [ ] **PO-13 · Lưu trên máy chủ** — ✋ ← 🤖
  - Bước: mở Briefing bằng trình duyệt / máy khác
  - Đúng: vẫn thấy danh sách chờ
- [ ] **PO-14 · Bỏ chờ / xong** — ✋ ← 🤖 ("Có vẻ xong" theo luật, không AI)
  - Bước: "Bỏ chờ" một mục; tick vòng tròn một mục; với "Chờ design": chuyển State ticket đi tiếp; với "Chờ BU": có người reply tin gốc
  - Đúng: "Bỏ chờ" trả mục về danh sách chưa xử lý; việc đã có thì hiện "Có vẻ xong" + lý do + nút "Đóng" (không tự đóng); có nút "Cập nhật story"
- [ ] **PO-15 · Tab "Cần bạn"** — ✋ ← 🤖 (lọc bằng regex)
  - Bước: có tin hỏi "PO ơi…" / "anh PM…" không nêu tên bạn; có tin chứa "3 PM" hoặc "POST"
  - Đúng: tin hỏi PO/PM vào "Cần bạn"; "3 PM", "POST" thì không
- [ ] **PO-16 · Tự chuyển sang đã xử lý** — ✋ ← 🤖
  - Bước: reply đúng tin gốc (từ app hoặc từ Telegram)
  - Đúng: mục chuyển sang đã xử lý, ghi "Bạn đã trả lời"

## C. YouTrack — trang chủ PO

- [ ] **PO-17 · Thẻ Chờ PO chốt** — ✋ Thủ công
  - Bước: YouTrack › Tổng quan
  - Đúng: có ticket gán cho bạn ở State define / confirm; cuối thẻ có bình luận hỏi bạn hoặc hỏi PO/PM chung
- [ ] **PO-18 · Bình luận đang hỏi bạn** — ✋ Thủ công
  - Bước: người khác tag @bạn trong bình luận, rồi người thứ ba bình luận chen vào; sau đó bạn trả lời
  - Đúng: ticket vẫn còn sau bình luận chen vào; bạn trả lời xong thì ticket tự rời danh sách
- [ ] **PO-19 · AI Studio › Chất lượng ticket** — 🤖 AI bắt buộc
  - Bước: bấm tab "Chất lượng ticket"
  - Đúng: chỉ rà ticket trong sprint chưa tới QC, lời văn hướng PO (bổ sung story / AC); sprint không còn ticket chưa tới QC thì tab bị khoá, có lý do; mở lại trong ngày không tốn lượt AI
- [ ] **PO-20 · Lối tắt "Chờ PO chốt"** — ✋ Thủ công
  - Bước: Ticket › lối tắt "Chờ PO chốt"
  - Đúng: danh sách khớp với thẻ ở PO-17

## D. Huy hiệu và trang Hôm nay

- [ ] **PO-21 · Huy hiệu vàng** — ✋ Thủ công
  - Bước: đứng ở Telegram, không có ticket mới giao cho bạn
  - Đúng: tab YouTrack có huy hiệu vàng = ticket rủi ro + bình luận hỏi bạn + ticket chờ bạn chốt
- [ ] **PO-22 · Trang Hôm nay** — ✋ Thủ công
  - Bước: có ticket chờ bạn chốt
  - Đúng: tối đa 8 ticket chờ lâu nhất + một dòng dẫn sang YouTrack cho phần còn lại
- [ ] **PO-23 · Tag theo vai trò** — ✋ Thủ công
  - Bước: "Hỏi lại trong nhóm" / bấm trả lời tin có nhắc ticket
  - Đúng: ô trả lời tag sẵn cả Assignee lẫn QC

## E. Tài liệu và `#`

- [ ] **PO-24 · `#` trong mô tả / bình luận YouTrack** — ✋ Thủ công
  - Bước: gõ `#` + vài chữ tên tài liệu (không dấu) › Enter
  - Đúng: popup lọc tài liệu; chèn link dạng `[tên](url)`, chỉ có bài KB
- [ ] **PO-25 · `#` trong ô trả lời Telegram / Q&A** — ✋ Thủ công
  - Bước: gõ `#` › chọn tài liệu › gửi
  - Đúng: ô chỉ hiện tiêu đề; lúc gửi tiêu đề thành link tới bài gốc
- [ ] **PO-26 · Esc rồi gõ lại** — ✋ Thủ công
  - Bước: gõ `#` › Esc › xoá rồi gõ lại `#` đúng chỗ đó
  - Đúng: popup mở lại
- [ ] **PO-27 · Đọc tài liệu** — ✋ Thủ công (link Zeplin tra qua Zeplin, không AI)
  - Bước: mở một bài trong Tài liệu
  - Đúng: có Mục lục, ⌘F tìm trong bài; lịch sử cập nhật hiện dòng đã đổi và người sửa; bấm mã KB / tên màn Zeplin thì mở được
- [ ] **PO-30 · Hỏi AI trong Tài liệu** — 🔀 AI tuỳ chọn (tìm / đọc vẫn dùng được không cần AI)
  - Bước: mở một bài › robot "Hỏi AI trên tài liệu" › hỏi 1 câu; hỏi lại đúng câu đó trên cùng bản tài liệu
  - Đúng: AI trả lời theo tài liệu đang mở; câu hỏi lặp lại trả về bản đã lưu kèm "Hỏi lại AI" (không tốn lượt mới); không có AI thì tìm / đọc vẫn bình thường

## F. Lỗi và vai trò

- [ ] **PO-28 · Lỗi phải lên UI** — Hỗn hợp (🤖 Soạn + ✋ Lưu)
  - Bước: (a) AI hết quota / CLI chưa đăng nhập rồi bấm Soạn; (b) tắt mạng hoặc token YouTrack sai (401) rồi bấm Lưu lên YouTrack
  - Đúng: cả 2 nhánh UI báo lỗi rõ; không im lặng, không hiện như "không có dữ liệu"
- [ ] **PO-29 · Đổi vai trò** — ✋ Thủ công
  - Bước: đổi vai trò sang Dev, rồi QA
  - Đúng: mọi nút "Cập nhật story" (kể cả trên thanh Đã chốt của Q&A) biến mất; "Chờ…" đổi lý do (Dev: Chờ BE / Chờ PO; QA: Chờ build / Chờ fix)

---

## Lỗi ghi nhận

| Mã case | Mô tả lỗi | Ảnh / link | Mức độ |
|---|---|---|---|
| | | | |
