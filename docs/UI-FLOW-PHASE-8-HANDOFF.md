# UI Flow — Phase 8: hoàn thiện và bàn giao

Ngày: 14/11/2026 · nhánh `features/refactor-ui-diagram` · chưa commit. Phase 0–8 của [kế hoạch](../UI-FLOW-REVIEW-PLAN.md) đã triển khai; backlog (mục 12) không thuộc phạm vi.

## Phase 8 đã làm

| Mục kế hoạch | Kết quả |
|---|---|
| Keyboard | Đường chỉ dùng bàn phím trọn vẹn: ô Tìm màn → Enter chọn màn (ở chế độ Sửa mở luôn khung thuộc tính) → Tab tới các nút (dòng "Nút" chọn từng nút) → "+ Vùng bấm" rồi Enter đặt vùng giữa màn → phím mũi tên / ô số để chỉnh; Esc thoát vẽ, thoát chọn, xoá tìm |
| Focus | Bắt đầu vẽ chuyển focus về khung sơ đồ (Enter/Esc tới engine); render lại trả focus về khung như cũ |
| Reduced-motion | Rule CSS có sẵn tắt mọi transition/animation; tìm/goto dùng `reduced` (test có sẵn) |
| Container hẹp | Thanh công cụ wrap, ô tìm co tới 140 px, khung thuộc tính có `max-height` + cuộn; test 390 px |
| Hint/Segmented | Dialog dashboard đã dùng `Hint`/`Segmented` (`flow.tsx`); engine độc lập giữ nút/seg của nó, không kéo React |
| Hiệu năng | Benchmark lặp lại (`docs/uiflow-phase8-after.json`): p95 pan/drag 16,7–18,0 ms (mục tiêu < 32 ms); commit thuộc tính ≤ 4,9 ms ở 60 màn; mount 60 màn 18 ms cold. Tìm trên 60 màn: mỗi phím < 100 ms (test). Một mẫu mỗi cỡ, cùng máy với phase 4: chỉ là đối chiếu, không phải thống kê |
| guide / context / CodeGraph | `guide.json` + `guide.en.json` cập nhật (tìm, Zeplin, vùng bấm, ghi chú, phím, bàn phím); repo không có `WORKING-CONTEXT.md`; `codegraph sync` đã chạy |

## Kiểm chứng toàn bộ (lần chạy cuối)

- Playwright toàn bộ `web/tests` trên bản copy scratch (build riêng, cổng 8883; `web/out` và `:8765` không đụng): **142 passed, 1 failed**. Lỗi duy nhất là `mascot.spec.ts` (đếm id trong SVG mascot), không liên quan UI flow: mã mascot và test đó không có thay đổi nào chưa commit; lỗi có sẵn ở HEAD.
- Python toàn bộ `tests/`: **349 passed**. Ruff `telegram_dashboard tests`: sạch.
- `tsc --noEmit`, ESLint `web/`: sạch.
- Không gọi AI thật, YouTrack thật hay Zeplin thật trong mọi lần kiểm chứng.

## Tài liệu từng mốc

[phase 0–2](UI-FLOW-PHASE-0-2-VERIFICATION.md) · [phase 3–4](UI-FLOW-PHASE-3-4-VERIFICATION.md) · [phase 5](UI-FLOW-PHASE-5-VERIFICATION.md) · [phase 6–7](UI-FLOW-PHASE-6-7-VERIFICATION.md)

## Giới hạn còn lại (gộp)

- Save không phải compare-and-swap nguyên tử giữa nhiều dashboard instance (kiểm 409 theo base attachment chỉ trong một instance).
- Rollout backend + frontend phải cùng lúc: client schema v1 coi file v2 là hỏng.
- Token/latency AI thật và chất lượng trên ticket thật chưa đo; ngân sách 12k/24k là điểm khởi đầu.
- Link `zpl.io` rút gọn chưa được nhận là trùng với link đầy đủ ở client; backend gộp 403 với 404.
- Mỗi lần nhấn mũi tên là một bước undo; chưa có redo (backlog 3).
- Nút chú thích không nối vẫn hiện "Nút cụt" trong Soát luồng (cảnh báo).
- Test `mascot.spec.ts` đang đỏ sẵn, ngoài phạm vi.
