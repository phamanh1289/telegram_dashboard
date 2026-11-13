# Spike UI flow: Zeplin MCP + ticket YouTrack (2026-11-13)

Chỉ đọc. Không ghi YouTrack, không tải asset.

## 1. Ticket YouTrack

| Ticket | Link Zeplin | Tên màn không link | Ghi chú |
|---|---|---|---|
| VA-12152 (Story Home + hub Bán nhà) | 7 link `app.zeplin.io/project/6a86b68fa244cff502f98251/screen/<id>` (Tiepnhan -00 C, -01 A, Ban-TTS 01, Tiepnhan -02, Ban-TSNY 64, Ban-LXN 71) | "Danh sách Chờ niêm yết" (ghi "Theo VA-11598"), Tiepnhan -00, -01 B/C/D | Bảng "Thiết kế" + khối "Luồng màn" dạng cây text |
| VA-12401 (Android sub-task) | 0 | Tiepnhan -00/-00 C, -01 A, -02, Ban-TTS 01, Ban-TSNY 64, Ban-LXN 71 | Tên màn chỉ ghi chữ, không link; trỏ về Story |
| VA-12154 (Story Ưu tiên nhận) | 9 link (Tiepnhan -00 C/-00 A/-00 B/-03/-11/-02/-12, Ban-TSCNY 42 A) | Tiepnhan -04, -13, -05, -02 A | Cùng định dạng VA-12152 |
| VA-12402 (Android sub-task) | 0 | -00 A, -00 B, -03/-04, -11, -12/-13, -02, Ban-TSCNY 42 A | Chỉ tên màn |
| VA-11588 (Story Chọn loại + Quét GCN) | Có: Web project `6aa3be06623a617590fabbf7`, App project `6a86b68f...` (Ban-TTS 01/02/15/05 A/05 B/02 A, Ban-xacdinh 24, Entry 2 -BanTS 2.1) | Màn "chưa có": căn hộ Thông tin tài sản bán, không-tìm-thấy App; SDK modal | Có 6 ảnh PNG đính kèm (URL `works.citics.vn/api/files/...?sign=` ký, có hạn) |
| VA-11594 (Story Gửi yêu cầu bán) | ~20 link dạng reference `[w10]: https://app.zeplin.io/...` ở cuối description (Web Banv2-xx, App Ban-xacdinh 24/25/26/27/28...) | "màn căn hộ chờ xác nhận" | Link khai báo ở cuối, bảng dùng `[tên][id]` |

Link khác dạng: không thấy zpl.io, scene.zeplin.io; chỉ `app.zeplin.io/project/<pid>/screen/<sid>`. Comment: không có link Zeplin mới (chỉ link wiki VA-A-xxx, changelog).

### Cách viết AC

| Mục | Kết quả |
|---|---|
| Dạng | Story: danh sách đánh số theo nhóm, `**AC1.1 Tiêu đề** ([màn](zeplin)): đoạn văn "Agent ... thì ..."`; Business rule `**BR1:**`. Có tiền tố `[Update 13.11]`, `[Chờ chốt]` |
| Sub-task (Android) | Checklist `- [ ] 1. Android ... → Expect: ...` + mục "AC áp dụng" liệt kê dải AC của Story |
| Ví dụ | `**AC2.3 Mở Tạo yêu cầu bán** (...): Ở hub Bán nhà, Agent bấm "Tạo yêu cầu bán" thì màn Chọn loại tài sản Ban-TTS 01 của VA-11588 mở.` |
| Ví dụ | `- [ ] 5. Android nối năm đích và quay lại → Expect: Tạo yêu cầu bán mở Ban-TTS 01; ...` |
| Luồng màn | Khối ```text dạng cây `├─ "nút" → Tên màn`, rất máy-đọc-được (nguồn tốt cho sơ đồ flow) |
| Mỗi AC | Gắn link Zeplin của màn liên quan ngay trong tiêu đề AC |

## 2. Zeplin MCP `get_screen` (includeVariants=false)

Thử 2 link: Tiepnhan -01 A (`6ab24ac8...`) và Ban-TTS 01 (`6a86b883...`). Không gọi link thứ 3 (đủ kết luận).

| Hạng mục | Kết quả |
|---|---|
| URL ảnh màn hình | KHÔNG có. Không có chuỗi `http` nào trong response; không có trường image/url |
| Công khai tải được? | Không áp dụng (không có URL) |
| Geometry | Có: mọi layer có `rect {x, y, width, height, absolute{x,y}}` |
| Kích thước màn | Tiepnhan -01 A: 375x961; Ban-TTS 01: 375x812 (pt) |
| Tên layer | Có: "Bán nhà", "Tạo yêu cầu bán", "Tiếp nhận tài sản", "Chờ niêm yết", "Tài sản niêm yết", "Lịch xem nhà"... (tên có thể bị cắt, vd "Lịch xem nhà và trạn", "Tiếp nhận khảo sát đ"). Cũng có layer rác: Mask, 072_PSD, Status Bars, Battery |
| Loại layer | `group`, text/shape... kèm fills, borderRadius; text layer có `content` |
| Annotation | `[]` (trống) |
| Kích thước response | Tiepnhan -01 A: 212 KB (~5.3k dòng, ~119 layer name); Ban-TTS 01: 88 KB. Vượt giới hạn token, tool tự lưu ra file. Có prompt mẫu "generate code" ở đầu |
| `targetLayerName` | Tool hỗ trợ lọc theo layer để thu nhỏ (chưa thử) |

## 3. Kết luận

- **Ảnh Zeplin: không khả thi qua MCP `get_screen`, vì response không chứa URL ảnh (chỉ JSON layer). Muốn có ảnh phải dùng `download_layer_asset` (tải file, ngoài phạm vi spike) hoặc export riêng; ảnh PNG đính kèm YouTrack (VA-11588) là URL ký có hạn, cần đăng nhập/sign.**
- Dữ liệu dùng được thay ảnh: tên màn + link từ ticket, cây "Luồng màn" text, tên layer/text nút + rect. Phải lọc (`targetLayerName` hoặc chỉ lấy layer có text, bỏ Mask/Status bar), vì thô ~90-210 KB/màn.
- **AC trong ticket viết dạng: đoạn văn đánh số `AC<nhóm>.<số> Tiêu đề (link màn): Agent ... thì ...` ở Story; checklist `- [ ] n. Android ... → Expect: ...` ở sub-task; kèm khối cây text "Luồng màn" và link Zeplin per-AC.**
