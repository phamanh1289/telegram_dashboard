# UI Flow phase 5 — Schema v2: kiểm chứng

Ngày: 14/11/2026 · nhánh `features/refactor-ui-diagram`

## Đã làm

| Hạng mục | Ở đâu |
|---|---|
| `Item.rect?: {x,y,w,h}` (tỉ lệ toàn ảnh, hữu hạn, w/h > 0, nằm trong ảnh; rect hỏng bị bỏ, item quay về khớp chữ) | `telegram_dashboard/uiflow.py` (`Rect`, `Item._rect`), `web/public/uiflow.js` (`rectOf`) |
| `Screen.note`, plain text ≤ 4.000 ký tự (cắt như title/label) | `uiflow.py` (`MAX_NOTE`, `_trim`), `uiflow.js` (`CAP_NOTE`) |
| `v: 2`; file v1 đọc và chuyển v2 trong bộ nhớ, ghi v2 khi save | `uiflow.clean`, `sanitize` |
| File v > 2: backend `TooNew` → 422 có thông điệp (không coi là "hỏng", không mở nút Render lại đè lên); engine ném lỗi thay vì sửa | `uiflow.extract`, `YtService.flow_file`, `sanitize` |
| Manual rect ưu tiên hơn text matching khi đặt vùng bấm (map + prototype dùng chung `hotspots`) | `uiflow.js` `hotspots` |
| AI adapter không nhận rect/note từ model | `uiflow.merge_ai` |
| Type TS đầy đủ (`FlowScreen`, `FlowItem`, `FlowRect`, `FlowLink`) thay type rút gọn | `web/src/lib/yt.ts` |
| HTML standalone nhúng `uiflow.js` mới nên hiểu v2; history/undo vẫn chỉ chứa flow JSON, ảnh ở `SHOTS` riêng | không đổi cơ chế |

Note không vào prompt AI: payload flow chỉ dựng từ ticket/story/Zeplin, không đọc flow cũ.

## Test

- Python: `test_uiflow`, `test_flow_prompt`, `test_flow_jobs`, `test_flow_cache`, `test_yt_dashboard`, `test_repo_guards` — **117 passed**. Mới: v1→v2 + rect/note round-trip qua HTML, rect ngoài ảnh bị bỏ, `TooNew` cho v3/v9, `merge_ai` bỏ rect/note từ AI.
- Browser (bản copy scratch, cổng 8883; `web/out` và `:8765` không đụng): `uiflow`, `flow-dialog`, `flow-renderer`, `flow-manifest`, `uiflow-pack` — 109 passed + 1 test cũ kỳ vọng `v: 1` đã cập nhật sang 2 và chạy lại pass. Mới: v1→v2 giữ rect/note, rect hỏng bị bỏ, rect đặt vùng bấm đúng toạ độ khung, v3 bị từ chối.
- `tsc --noEmit`, ESLint (file đã sửa), Ruff: sạch.

## Giới hạn

- Client cũ (schema v1) mở file v2 sẽ coi là hỏng và có thể đề nghị Render lại đè; cần rollout backend + frontend cùng lúc (như kế hoạch ghi).
- Chưa có UI vẽ/sửa rect hay note — thuộc phase 7. Phase 5 chỉ khoá schema/compatibility.
- Đường 422 `TooNew` của `flow_file` chưa có test HTTP riêng; logic chặn nằm ở `extract` đã có test.
