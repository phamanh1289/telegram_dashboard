# UI Flow — Deep review và kế hoạch cải thiện

Ngày: 14/11/2026  
Trạng thái: đã triển khai phase 0–8 và backlog mục 12 trên `features/refactor-ui-diagram`. Bàn giao: [phase 8](docs/UI-FLOW-PHASE-8-HANDOFF.md), [backlog](docs/UI-FLOW-BACKLOG-VERIFICATION.md). Bằng chứng và giới hạn kiểm chứng: [phase 0–2](docs/UI-FLOW-PHASE-0-2-VERIFICATION.md), [phase 3–4](docs/UI-FLOW-PHASE-3-4-VERIFICATION.md), [phase 5](docs/UI-FLOW-PHASE-5-VERIFICATION.md), [phase 6–7](docs/UI-FLOW-PHASE-6-7-VERIFICATION.md).

## 1. Mục tiêu và giới hạn bằng chứng

Review được chia cho 3 subagent: backend/hiệu năng/token, vòng đời tác vụ/rủi ro và editor/UI/UX. Các phát hiện dựa trên trace source tại thời điểm review, chưa chạy benchmark, browser test hoặc AI thật. Số dòng dưới đây là mốc của lần khảo sát, cần đối chiếu lại khi triển khai.

Mục tiêu:

- Giữ công việc khi đóng tab, reload hoặc server restart.
- Giảm dữ liệu gửi AI; dùng code cho editor và xử lý kỹ thuật.
- Tăng tốc mở flow, đọc ảnh, lưu file và tương tác trên sơ đồ lớn.
- Bổ sung tìm màn, thêm từ Zeplin, hotspot và ghi chú.
- Nâng cấp kéo thả và sắp xếp tự động trên nền hiện có.
- Kiểm chứng từng phase; backlog next step không tự động thuộc phạm vi triển khai.

### Quyết định đã chốt với người dùng

- Khôi phục tác vụ/kết quả/bản nháp qua server restart.
- Sau restart, tự tiếp tục bước code an toàn; AI đang dở chỉ gọi lại khi người dùng bấm **Tiếp tục**.
- Comment là ghi chú plain text của sơ đồ, chưa có reply, mention hoặc thông báo.
- Ô vẽ là hotspot/chú thích; chưa xây bộ wireframe tự do.
- **Cập nhật** là thao tác ghi lên YouTrack rõ ràng; autosave chỉ lưu bản nháp cục bộ.

### Hiện trạng tính năng

| Nhu cầu | Hiện trạng | Hướng xử lý |
|---|---|---|
| Tìm tên màn/link Zeplin | Có focus màn và highlight liên quan; chưa có UI tìm kiếm | Thêm search, tái sử dụng focus |
| Thêm màn từ Zeplin | Thêm màn trống rồi nhập URL; tự đọc ảnh | Rút thành thao tác thêm bằng URL |
| Thêm/xóa ô | Có item, nhãn, liên kết; vùng bấm suy ra từ chữ Zeplin | Thêm rectangle chỉnh tay |
| Comment màn | Chưa có ghi chú riêng | Note lưu cùng sơ đồ |
| Kéo màn | Đã có, gồm nhóm overlay | Sửa tính toàn vẹn, thêm thao tác bàn phím |
| Tự sắp xếp | Đã có BFS, phân lớp, vị trí overlay | Cải thiện bố cục và thêm lệnh sắp xếp lại |

## 2. Phát hiện review

### 2.1. Rủi ro và vòng đời

| Mức | Phát hiện | Nguồn |
|---|---|---|
| P1 | Kết quả AI và chỉnh sửa chưa lưu nằm trong RAM. Reload/đóng tab có thể mất; guard chỉ bảo vệ đóng dialog | `web/src/components/yt/flow.tsx:38–39,146`; `web/public/uiflow.js:1908–1909` |
| P1 | Trong lúc upload vẫn render lại được; callback save cũ có thể thay kết quả mới | `web/src/components/yt/flow.tsx:116–125,144,180–196` |
| P1 | DELETE hủy AI không chờ xác nhận, nuốt lỗi và xóa job pointer; mất mạng có thể để job chạy nhưng UI mất dấu | `web/src/lib/yt.ts:70`; `web/src/components/yt/flow.tsx:96–101,145` |
| P2 | Job chỉ ở RAM; restart/expired job trả 404 rồi UI quay về file cũ/rỗng mà không giải thích | `telegram_dashboard/ai.py:985–991,1029–1033`; `web/src/components/yt/flow.tsx:91` |
| P2 | Lỗi mount/set/shots có thể không đi vào UI lỗi/Retry | `web/src/lib/uiflow.ts:57–70` |
| P2 | Hủy drag hoặc ảnh đến giữa drag có thể giữ tọa độ đã đổi nhưng không dirty/undo | `web/public/uiflow.js:1362–1368,1565–1570,1884–1887` |

Hành vi hiện tại cần phân biệt:

- Đóng dialog đang render: ngắt subscriber bằng `AI_LEAVE`, giữ job; mở lại nối vào job cũ.
- Đóng tab/mất kết nối: không đồng nghĩa AI đã dừng; server có thể còn chạy.
- Bấm Dừng: chưa bảo đảm khi request hủy thất bại.
- Server restart: job đang chạy mất khỏi RAM.
- Lỗi renderer trình duyệt: khác lỗi AI; cần retry vẽ từ dữ liệu sẵn có.

Các cơ chế đã tốt cần giữ:

- Cùng ticket bắt đầu lượt mới sẽ hủy job cũ phía server.
- Save đối chiếu base attachment và báo 409 khi khác.
- Upload chưa rõ kết quả không tự retry; lỗi xóa file cũ/comment có warning.
- Đường AI flow đánh dấu dữ liệu ticket không tin cậy và không truyền project/shell.

Giới hạn còn lại: lock save cục bộ không tạo atomic compare-and-swap giữa nhiều dashboard instance. Hai instance vẫn có thể cùng đọc một base rồi cùng upload. Không được mô tả kiểm tra 409 hiện tại là bảo đảm cộng tác đa người tuyệt đối.

### 2.2. Hiệu năng và token

1. **Prompt chưa có ngân sách tổng.** Trần lý thuyết riêng label Zeplin: 60 màn × 200 text × 80 ký tự ≈ 960.000 ký tự, chưa gồm JSON/story/comment. Đây là trần từ code, không phải số đo thực tế. Nguồn: `telegram_dashboard/yt_dashboard.py:1847,1190,1264`.
2. **Zeplin concurrency theo request, chưa gộp inflight.** Nhiều caller tải cùng màn bị trùng và vượt giới hạn tổng mong muốn. Nguồn: `telegram_dashboard/zeplin.py:128–145`.
3. **Mở/lưu tải cả HTML để lấy JSON nhỏ.** File có thể chứa tới 20 MB ảnh nhúng. Nguồn: `telegram_dashboard/yt_dashboard.py:800–809`; `telegram_dashboard/uiflow.py:60`.
4. **Ảnh buffer trước khi kiểm cap; pack đồng thời tất cả ảnh.** Nguy cơ tăng memory và nghẽn decode/canvas. Nguồn: `telegram_dashboard/zeplin.py:183–193`; `web/src/lib/uiflow.ts:120`.
5. **Commit dựng lại toàn bộ màn/link.** Pan/drag đã có RAF và cập nhật phần liên quan; cần profile commit trước khi thay renderer. Nguồn: `web/public/uiflow.js:1651–1672,1788–1799`.

Backend đã dùng một lượt AI, REST Zeplin, cache 1 giờ; validate/layout/export/diff bằng code. Không thêm lượt AI tóm tắt trung gian.

## 3. Phase 0 — Baseline và kiểm chứng

### T0.1. Dataset

- Fixture 5, 20, 60 màn; tối đa hiện hành 300 liên kết.
- Có nhánh, vòng lặp, overlay, màn rời, ảnh dài, label trùng, nút không khớp ảnh.
- Có flow cũ, flow lỗi và ảnh thiếu.

### T0.2. Đo pipeline

- Đo đọc ticket/story, Zeplin, AI, validate/layout, mount, pack, upload.
- Ghi cache hit/miss, request count, bytes, prompt size từng phần.
- Token thực khi provider trả; ước lượng phải ghi nhãn.
- Không ghi nội dung ticket/prompt/ảnh vào telemetry mặc định.

### T0.3. Kiểm chứng ban đầu

- Chạy test flow Python/browser hiện có, typecheck, repo guards.
- Browser chạy bản copy scratch/cổng riêng; không build đè `web/out`, không đụng `:8765`.
- Ghi máy/browser/dataset; so cold/warm trên cùng môi trường.

**Đầu ra:** baseline và regression test cho lỗi đã xác nhận. Chưa cam kết phần trăm giảm token/latency trước khi đo.

## 4. Phase 1 — Chặn mất dữ liệu và race

### T1.1. Bảo vệ bản chưa lưu

- App-owned guard khi reload/đóng tab; điều hướng nội bộ lưu draft hoặc hỏi bỏ.
- Giữ tham chiếu kết quả AI tới khi lưu/bỏ rõ ràng.
- Tách hành động đóng khung với bỏ bản nháp.

### T1.2. Serialize save/render

- Khi upload khóa render lại và hành động thay thế nội dung.
- Operation ID bảo vệ callback save/render cũ.
- Giữ draft khi upload lỗi.
- Upload chưa rõ kết quả phải đọc lại attachment đối chiếu trước khi gửi lại; không auto retry.

### T1.3. Cancel có xác nhận

- Trạng thái đang yêu cầu dừng; chỉ báo đã dừng khi server xác nhận.
- Mất mạng giữ job ID, báo chưa xác nhận dừng.
- Reconnect đối chiếu trạng thái trước khi cancel/tạo job mới.
- Cancel idempotent, xử lý cả cancel đến trước job start.

### T1.4. Renderer/gesture

- Catch mount/set/shots; cleanup mount dở, Retry từ flow hiện có, không gọi AI.
- Pointercancel/đổi mode/ảnh cập nhật giữa drag rollback snapshot.
- Gesture thành công đúng một commit/undo.

**Nghiệm thu:** reload bản nháp, cancel mất mạng, save chậm rồi render, lỗi mount, ảnh cập nhật giữa drag; không mất nội dung/callback cũ/báo dừng sai.

## 5. Phase 2 — Persistence và recovery

### T2.1. Kho job UI flow

- SQLite/migration theo cơ chế dự án; không thêm queue service.
- Lưu job/ticket/account-server scope/base attachment/status/stage/checkpoint/error/result đã validate.
- Checkpoint tham chiếu ảnh, không lặp base64 trong events.
- Không TTL-xóa job đang chạy hoặc draft chưa lưu.

### T2.2. State machine

`queued → running → succeeded | failed | cancelled | interrupted`; `cancel_requested` là trạng thái chờ xác nhận.

- Đóng page chỉ ngắt subscriber.
- Restart chuyển running thành interrupted.
- Lưu kết quả AI hoàn chỉnh đã validate trước bước render UI.
- Tiếp tục bước code có checkpoint hợp lệ sau restart.
- Thiếu AI result hoàn chỉnh: hiện **Tiếp tục**, giải thích cần gọi AI lại; chờ người dùng bấm.
- Không giả định provider/subprocess cũ còn sống.

### T2.3. Editor draft

- IndexedDB theo account/server/ticket, chứa flow và base attachment.
- Debounce 500 ms sau commit, trạng thái đang lưu/đã lưu/lỗi; không chỉ dựa vào beforeunload.
- Mở lại kiểm draft/job và metadata ticket mới.
- Base đổi: giữ draft, báo conflict, không auto overwrite.

### T2.4. Reconnect/retention

- Resume event bằng cursor thay vì replay toàn log không cần thiết.
- Kết quả chưa lưu/bỏ giữ để recovery; lịch sử đã xử lý giữ 30 ngày.
- Xóa draft là hành động rõ ràng; logout/đổi account cô lập cache/job/draft.

**Nghiệm thu:** restart mỗi stage, đóng/mở tab, AI xong trước khi UI nhận, draft conflict, lỗi dung lượng, job không còn; mọi tình huống có trạng thái rõ.

## 6. Phase 3 — Giảm token, code xử lý nhiều hơn

### T3.1. Payload flow riêng

- Bỏ assignee/estimate/sprint và field không phục vụ flow.
- Dedup subtask/story; ưu tiên cây luồng, AC/rule, URL và correction liên quan.
- Cắt đơn vị dữ liệu hoàn chỉnh, không cắt JSON giữa chuỗi.
- Manifest nguồn sử dụng và phần lược bỏ.

### T3.2. Budget

- Khởi điểm: Nhanh 12.000, Kỹ 24.000 input token ước lượng; thấp hơn context khả dụng sau khi dành output.
- Hiệu chỉnh trên corpus; không coi đây là con số tối ưu đã đo.
- AC/rule ưu tiên hơn label trang trí.
- Yêu cầu bắt buộc vượt budget: báo thu hẹp/chuyển Kỹ; không âm thầm bỏ điều kiện.
- Không thêm AI summary trung gian.

### T3.3. Skeleton bằng code

- URL canonicalization, ID, dedup, title/kích thước/label bằng code.
- Parse cây có cấu trúc xác định; đánh dấu phần mơ hồ cho AI.
- AI chỉ suy luận điều hướng/điều kiện thiếu; không sinh HTML/ảnh/tọa độ layout/dữ liệu thiết kế đã có.
- Validate, hotspot matching, layout, diff, export bằng code.

### T3.4. Chất lượng

- So độ phủ màn/liên kết/điều kiện trước-sau cùng token và latency.
- Hiện phần cần xác nhận khi thiếu nguồn.
- Search/thêm Zeplin/sửa hotspot/note/layout dùng 0 lượt AI.
- Không tự thêm lượt AI sửa output lỗi; người dùng quyết định chạy lại.

**Nghiệm thu:** payload đúng budget, giữ AC/rule bắt buộc, token giảm trên corpus mà không giảm độ phủ.

## 7. Phase 4 — Tăng tốc đọc/ghi/ảnh/render

### T4.1. Zeplin

- Semaphore service-wide 4 reads; inflight dedup theo URL chuẩn hóa và account scope.
- Cache bounded 512 màn, TTL 1 giờ; đổi token/config invalidate.
- Một subscriber cancel không phá kết quả subscriber khác.

### T4.2. Attachment

- Cache parsed flow theo attachment identity và quyền; không giữ HTML lớn.
- Luôn kiểm metadata mới trước conflict; attachment mới buộc đọc lại.
- Save thành công seed cache.

### T4.3. Ảnh/export

- Stream proxy, ngắt khi vượt byte cap.
- Client pack tối đa 3 ảnh đồng thời, giữ progress/failed count.
- Bound cache ảnh pack và cleanup object URL.
- Nhúng ảnh lỗi có warning, không mất JSON flow.

### T4.4. Editor

- Profile commit fixture lớn trước khi đổi renderer.
- Search/highlight không rebuild flow; property edit cập nhật màn/link bị ảnh hưởng.
- Ảnh tới không reset camera/selection/gesture.
- Chỉ viewport culling nếu đo thấy cần; không Canvas/WebGL rewrite.

**Nghiệm thu:** 10 caller cùng màn chỉ 1 read; active reads ≤4, pack ≤3; warm attachment không tải HTML lần hai. Mục tiêu máy baseline: p95 pan/drag frame <32 ms; search/highlight không tạo task >100 ms.

## 8. Phase 5 — Schema editor v2

### T5.1. Interface

- `Item.rect?: {x, y, w, h}` chuẩn hóa theo toàn ảnh; số hữu hạn, kích thước dương, trong bounds.
- `Screen.note?: string`, plain text tối đa 4.000 ký tự.
- Giữ ID và link; manual rect ưu tiên text matching.
- TypeScript editor có type đầy đủ thay type flow rút gọn.

### T5.2. Compatibility

- Đọc v1/migrate trong bộ nhớ; ghi v2 khi người dùng save.
- Đồng bộ JS sanitizer/Python validation/export-import/AI adapter.
- HTML standalone nhúng renderer hiểu v2.
- Client mới từ chối sửa version chưa hỗ trợ, không bỏ field âm thầm.
- Backend/frontend rollout cùng version; client cũ không an toàn để chỉnh file v2.

**Nghiệm thu:** v1/v2 round-trip, giữ rect/note qua export/reload, lỗi schema rõ ràng; history không chứa base64 ảnh.

## 9. Phase 6 — Search và thêm Zeplin

### T6.1. Search

- Title không phân biệt dấu/hoa thường; Zeplin URL hoặc screen ID.
- Count/list kết quả; Enter chọn, phím lên/xuống chuyển, Escape đóng.
- Chọn gọi focus hiện có; highlight match khác adjacency highlight.
- Không dirty/undo cho search.

### T6.2. Thêm từ URL

- Action **Thêm màn từ Zeplin**: kiểm URL, đọc metadata/ảnh, thêm.
- Trùng URL focus existing; duplicate là action riêng.
- 401/403/mạng có lỗi/Retry, không biến thành không tìm thấy.
- URL hợp lệ chưa tải ảnh cho phép giữ màn chờ khi người dùng chọn.
- Một undo; không AI.

**Nghiệm thu:** tiếng Việt, URL tương đương/trùng/sai, lỗi quyền/mạng/ảnh và keyboard-only.

## 10. Phase 7 — Hotspot, note, drag, layout

### T7.1. Hotspot

- Vẽ rectangle, chọn/move/resize/rename/link/delete.
- Inspector số học là cách thao tác không cần drag.
- Chú thích không bắt buộc có link.
- Xóa item và link tham chiếu trong cùng undo.
- Tọa độ ảnh gốc không lệch vì zoom/pan/ảnh dài.

### T7.2. Screen note

- Badge, editor plain text; lưu draft/flow/HTML, không tự post YouTrack comment.
- Escape hủy; save một undo; không thực thi HTML.

### T7.3. Drag

- Giữ drag/overlay family; thêm vị trí inspector và di chuyển bằng phím.
- Escape/pointercancel rollback; camera/zoom không sai khoảng dịch.

### T7.4. Layout

- Flow mới layout bằng code trước hiển thị.
- Gom cycle để phân lớp ổn định, sắp nhánh theo quan hệ, overlay gần cha, tách cụm rời.
- **Sắp xếp lại toàn bộ** là một undo.
- Mở file có tọa độ/ảnh tới muộn không tự layout lại.
- Thứ tự ổn định để cùng dữ liệu không nhảy bố cục ngẫu nhiên.

**Nghiệm thu:** zoom/pan/ảnh dài, reverse resize, undo/delete/note/export, cycle/overlay/cụm rời; mở lại giữ tọa độ người dùng.

## 11. Phase 8 — Hoàn thiện và bàn giao

- Focused tests: `tests/test_uiflow.py`, `web/tests/uiflow-*.spec.ts`, `web/tests/flow-dialog.spec.ts`; thêm persistence/concurrency test đúng rủi ro.
- Typecheck, repo guards, browser scratch; baseline cold/warm cho latency/request/token/memory/frame time.
- Keyboard/focus/reduced-motion/container hẹp.
- Dashboard dùng Hint/Segmented; standalone hành vi tương đương, không kéo React chỉ vì tooltip.
- Cập nhật `web/src/lib/guide.json`, task summary trong `WORKING-CONTEXT.md` nếu có, chạy `codegraph sync` sau triển khai.
- Bàn giao rõ test đã chạy/chưa chạy, số đo và giới hạn còn lại.

## 12. Backlog next step

| Ưu tiên | Feature | Giá trị |
|---|---|---|
| 1 | Bộ lọc Cần rà soát | Nút chưa khớp ảnh, link thiếu đích, màn thiếu nguồn |
| 2 | Chọn màn bắt đầu | Thay phụ thuộc thứ tự màn đầu của prototype |
| 3 | Redo | Chỉnh hotspot/layout nhiều lần an toàn |
| 4 | So sánh phiên bản | Xem thay đổi trước cập nhật ticket |
| 5 | Cập nhật nguồn có chọn lọc | Báo ticket/Zeplin đổi, giữ chỉnh tay |
| 6 | Checklist test từ graph | Code liệt kê nhánh/đường đi; AI diễn giải khi được yêu cầu |

Đã triển khai cả 6 mục (xem [kiểm chứng backlog](docs/UI-FLOW-BACKLOG-VERIFICATION.md)). Backlog chưa bao gồm realtime collaboration, threaded comments, wireframe tổng quát hoặc renderer mới.

## 13. Mốc bàn giao và phân công song song

| Mốc | Phase | Kết quả |
|---|---|---|
| A | 0–2 | Dữ liệu và tác vụ đáng tin cậy |
| B | 3–4 | Giảm token và thời gian |
| C | 5 | Khóa schema/compatibility |
| D | 6–7 | Editor hoàn thiện |
| E | 8 | Kiểm chứng/tài liệu/bàn giao |

Triển khai tối đa 3 worker + 1 điều phối:

- Backend: jobs/checkpoints/API/cache.
- Frontend lifecycle: reconnect/draft/save/cancel.
- Editor: engine/hotspot/search/layout.
- Điều phối: schema/API/migration/tích hợp/verification.

Mỗi file chung có một chủ sở hữu trong từng đợt. Chốt hợp đồng schema/trạng thái trước nối dây; worker không revert thay đổi của nhau. Mỗi mốc qua kiểm chứng trước khi mở phần phụ thuộc tiếp theo.

## 14. Checklist thực thi

- [x] Phase 0: baseline và regression coverage.
- [x] Phase 1: data-loss/race/cancel/renderer integrity.
- [x] Phase 2: persistent jobs và drafts, restart recovery.
- [x] Phase 3: bounded prompt và deterministic skeleton.
- [x] Phase 4: caching/concurrency/image/render performance.
- [x] Phase 5: schema v2 và migration.
- [x] Phase 6: search và Zeplin import.
- [x] Phase 7: hotspot/note/drag/layout.
- [x] Phase 8: verification, guide, context, CodeGraph sync.
- [x] Backlog: Cần rà soát, màn bắt đầu, redo, so sánh phiên bản, giữ chỉnh tay khi render lại, checklist test.

File này ghi kế hoạch; các checkbox chỉ đánh dấu khi có bằng chứng triển khai và kiểm chứng.
