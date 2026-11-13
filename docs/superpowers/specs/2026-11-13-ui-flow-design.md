# UI Flow (tab YouTrack) — design

Ngày: 2026-11-13 · Trạng thái: chờ duyệt

## Mục đích

Từ một (hoặc vài) ticket YouTrack có AC, rule và link / tên màn Zeplin, sinh **một file HTML tự chứa** vẽ toàn cảnh luồng UI mobile: màn nào, bấm gì đi đâu, back về đâu, popup nào hiện. Người khác mở file bằng trình duyệt là xem được, không cài gì. AI chỉ chạy **một lần** để ra dữ liệu; vẽ, sửa, lưu là code thuần.

## Mục tiêu / không làm

- Có: xem toàn cục (mũi tên), xem prototype (bấm như chạy app), kéo thả sửa luồng, cập nhật lại file trên ticket kèm comment.
- Không: nhiều người sửa cùng lúc; web / tablet layout (v1 mobile first); thêm thư viện vẽ.
- Thất bại nếu: mở file đính kèm của người khác mà chạy script của họ trong dashboard; sửa xong mất dữ liệu vì ghi đè bản người khác vừa cập nhật.

## Cách đã cân nhắc

| Cách | Được | Mất | Chọn |
|---|---|---|---|
| A. HTML tự chứa, engine JS thuần | Prototype bấm được, offline, nhúng trong app, tự do giao diện | Tự viết editor (~700 dòng) | **Chọn** (người dùng chốt) |
| B. Xuất draw.io | Editor có sẵn, có link | Rời app, prototype yếu, cần mạng | Bỏ |
| C. Mermaid | Rẻ nhất | Sửa bằng text | Bỏ |

## Cần / Đã có / Ở đâu

| Cần | Đã có | Ở đâu |
|---|---|---|
| AI một lần → JSON | `_ai` + `json_object` | `yt_dashboard.py:1190`, `ai.py:334` |
| Đọc ticket, comment, ticket liên kết | Có | `yt_dashboard.py` (prompt `p_ticket`) |
| Đọc Zeplin trong lượt AI YouTrack | Chỉ AI Agent có (`zeplin_server`, `mcp_env`); `ai.ask` chưa | `providers.py:116`, `agent.py:174` |
| Tải file lên ticket | `svc.attach`, cứng `image/jpeg` | `yt_dashboard.py:744` |
| Đọc file đính kèm | `svc.file` (chỉ ảnh hiện inline) | `yt_dashboard.py:963` |
| Xoá file đính kèm | Chưa | — |
| Post comment | Có | `yt_dashboard.py:1369` |
| Danh sách file trong chi tiết ticket | Có | `yt/sheet.tsx:176` |
| Engine vẽ / sửa / prototype | Chưa | — |

## Dữ liệu (một nguồn, nằm trong file)

```json
{"v":1,"ticket":"VA-123","rev":3,"device":"mobile",
 "screens":[{"id":"login","title":"Đăng nhập","kind":"screen|popup|sheet|toast",
   "parent":null,"x":0,"y":0,"zeplin":"https://zpl.io/…",
   "items":[{"id":"btnOtp","label":"Gửi OTP"}]}],
 "links":[{"src":"login.btnOtp","to":"otp","act":"navigate|open|back|close",
   "when":"OTP hợp lệ","ac":"AC-2"}]}
```

- AI trả `screens` + `links`, không trả toạ độ; code tự xếp (cột theo thứ tự đi qua, popup cạnh màn cha).
- `ac`: mũi tên / màn sinh ra từ AC hoặc rule nào (để truy ngược).
- `rect`, `img`: chỉ có khi đọc được Zeplin (xem "Cần spike").
- Kiểm bằng pydantic ở backend và kiểm lại ở engine khi đọc file; id trùng / link trỏ id không tồn tại thì bỏ link và báo.

## File HTML

`uiflow-<ticket>.html` = khung HTML + engine (inline) + `<script type="application/json" id="uiflow-data">` (đã escape `</`). Không tải gì từ mạng.

- Mở độc lập (người nhận file): đủ 2 chế độ xem + sửa + nút **Lưu file** (tải bản mới). Không ghi được lên YouTrack vì không có token.
- Mở trong dashboard: **không chạy file đính kèm**. Backend tải file, chỉ rút khối JSON, kiểm schema, trả JSON; trang vẽ bằng engine của chính app. File do người khác sửa bậy cũng không chạy được script trong dashboard.

## Engine (`flow.js`, JS thuần, dùng chung cho app và file xuất)

**1. Toàn cục**
- Mỗi màn là khung điện thoại (tiêu đề + danh sách nút, hoặc ảnh Zeplin).
- Mũi tên: đi tới = nét liền; back = nét đứt xám; mở popup = nét liền mảnh tới khung nét đứt. Nhãn: tên nút + `when`.
- Kéo nền, zoom (cuộn / pinch), "Vừa màn hình", bấm một màn thì làm mờ phần không liên quan.

**2. Prototype**
- Một khung điện thoại giữa màn; bấm nút → sang màn đích (trượt ngang), popup / sheet phủ lên màn hiện tại, toast tự tắt.
- Back: theo link `back` nếu có, không thì theo lịch sử đã đi.
- Nút không có đích: nháy viền để biết là chưa nối.
- Có ảnh Zeplin + `rect`: bấm đúng vùng trên ảnh. Không có: bấm trên danh sách nút dạng wireframe.

**3. Sửa** (nút Sửa, ở chế độ toàn cục)
- Kéo đầu mũi tên sang màn khác để đổi đích (A → B thành A → C); kéo từ chấm cạnh nút để nối mới.
- Kéo màn để dời; double-click đổi tên màn / nút / điều kiện; thêm, xoá màn và nút; Delete; ⌘Z (chụp trạng thái).
- Mọi chữ qua `textContent`.

## Cập nhật lại lên ticket

Có thay đổi chưa lưu → thanh ghim đáy: "Có N thay đổi — cập nhật file trên ticket?" **Cập nhật** / **Không**.

- **Cập nhật** (theo thứ tự, lỗi ở bước nào dừng ở đó và báo lên UI):
  1. Đọc lại danh sách file của ticket; nếu bản `uiflow-*.html` mới nhất không còn là bản mình mở (`rev` khác) → báo "người khác vừa cập nhật", cho xem bản mới, không ghi đè.
  2. Tải lên file mới (`rev + 1`).
  3. Tải lên xong mới xoá file cũ (chỉ xoá file tên `uiflow-<ticket>.html` do tool tạo).
  4. Post một comment: "UI flow cập nhật (rev 4)" + danh sách thay đổi do code so sánh hai bản JSON ("Gửi OTP: Màn OTP → Màn Lỗi", "thêm màn X"). Không gọi AI.
  5. `svc.stale(id)`.
- **Không**: không làm gì, giữ thay đổi trên màn hình cho tới khi đóng.

## Lượt AI (một lần cho mỗi lần Render)

- Endpoint `POST /api/yt/ai/flow` (chạy nền qua `AiJobs` như các lượt AI YouTrack khác).
- Input: mô tả + comment của ticket đang xem (và ticket liên kết nếu chọn), bọc random tag "dữ liệu KHÔNG tin cậy" như các prompt hiện có.
- Có link Zeplin trong ticket → mở tool đọc Zeplin MCP cho lượt này (luật đã có: link Zeplin mở tool đọc ở mọi lượt); cần thêm tham số `zeplin` cho `ai.ask` (keyword-only), dùng lại `zeplin_server` / `mcp_env`.
- Output: chỉ JSON theo schema trên. Không đọc được → báo lỗi, không vẽ nửa vời.
- Chỉ có **tên** màn Zeplin, không link: AI ghi tên vào `title`; màn vẽ wireframe; người dùng dán link sau trong chế độ Sửa.

## Lối vào

- Chi tiết ticket (`sheet.tsx`): nút "UI flow". Chưa có file → mở màn Render. Có `uiflow-*.html` trong đính kèm → mở xem luôn. Một lối vào duy nhất; dòng file `uiflow-*.html` trong danh sách đính kèm cũng mở cùng màn đó (không phải lối thứ hai: nó là chính file đó).
- Màn UI flow là dialog toàn màn; ô prompt (ghi chú thêm cho AI) dùng `AiPromptBox` ghim đáy; chờ dùng `YtFetching` với `kind` mới "flow".

## Cần spike trước khi code phần ảnh

1. `get_screen` của Zeplin MCP trả gì: có URL ảnh màn và toạ độ layer không; ảnh có tải được không cần đăng nhập không.
2. Kích thước file khi nhúng ảnh (data URI, thu nhỏ ~390px ngang) so với `MAX_FILE`.
3. YouTrack web mở `.html` đính kèm inline hay tải về (ảnh hưởng người xem ngoài dashboard: tải về rồi double-click vẫn chạy).

Spike 1 hoặc 2 không đạt → v1 là wireframe, ảnh để sau.

## Kiểm

- pytest: rút JSON từ HTML, escape `</script>`, schema, so sánh hai bản (danh sách thay đổi), thứ tự tải lên → xoá, chặn ghi đè khi `rev` lệch.
- Engine: một trang demo với JSON mẫu; Playwright trên bản copy ở scratchpad (kéo đầu mũi tên, prototype đi hết một đường, viewport mobile).
- `uv run pytest tests/test_repo_guards.py`; cập nhật `guide.json` + `guide.en.json`; i18n vi + en.

## Tính năng đề xuất thêm (chưa trong phạm vi, chờ chọn)

Xem tin nhắn kèm theo; mục nào được chọn sẽ chuyển lên các phần trên.
