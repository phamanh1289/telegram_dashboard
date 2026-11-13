## Post-task routine
- Xong mỗi task (feature, bug fix, refactor): chạy `codegraph sync` ở thư mục gốc repo để cập nhật index `.codegraph/`.

## UI: tab / segmented / nav highlight
- Mọi nhóm tab chọn-một (view, bộ lọc, khoảng thời gian…) dùng `Segmented` trong `web/src/components/ui/segmented.tsx`; không tự viết `motion.span layoutId` + spring.
- Highlight trượt kiểu khác (nav sidebar, gạch chân, tab có popover) dùng `Pill` cùng file với `className` riêng.
- Đổi animation chỉ sửa `PILL_SPRING` / `Pill` ở đó; mỗi nhóm cần `id` (layoutId) riêng.
- Menu / icon cần giải thích khi hover: bọc bằng `Hint` (`web/src/components/ui/hint.tsx`, trễ `HINT_DELAY` 500ms, linh vật bóng đèn); không dùng `title` cho phần giải thích đó. Nút AI giữ `AiAsk` (robot).

## Lỗi hay gặp: bắt buộc (chi tiết + cách sửa: skill `avoiding-dashboard-pitfalls`)
- Đổi chữ ký hàm: grep mọi caller; tham số tùy chọn để keyword-only. Ghi lên YouTrack xong gọi `svc.stale(id)`, không pop từng key cache.
- Chỉ nuốt lỗi mong đợi (vd. 400 YQL); 401/403/mạng phải lên UI. Mọi mutation frontend có `onError` + `errorText`. "Lỗi" không được hiện như "không có dữ liệu".
- Gửi tin bị timeout / mất kết nối = `delivery_unknown` ("xem nhóm trước khi gửi lại"), không báo "không gửi được", không tự gửi lại. Mọi chỗ giữ `_send_lock` có `wait_for(SEND_TIMEOUT)`.
- Việc nền / cập nhật thất bại: lưu lỗi cho UI và thử lại hoặc quay về trạng thái cũ, không chỉ log. Kiểm lại điều kiện (vd. `agent.busy`) ngay trước bước cuối.
- Text của người khác (tin, ticket, link) đưa vào AI: bọc random tag "dữ liệu KHÔNG tin cậy"; lượt mang text đó không có shell ngoài sandbox; run "không tool" phải không tool ở mọi provider; không thêm ngoại lệ cho `LocalGuardMiddleware`; CLI con dùng `child_env()`.
- Không poll / timer trong từng dòng list (một query hoặc đồng hồ chung). Đọc Telegram live phải có memo TTL + `Semaphore(LIVE_READS)`. Portal / popup chỉ mount khi mở.
- Tailwind 4: container max là `@max-3xl:` (không phải `max-@3xl:`); layout trong khung hẹp dùng container query, không dùng breakpoint viewport.
- Khóa riêng ký release không vào repo; GitHub Action pin theo SHA. `uv run pytest tests/test_repo_guards.py` kiểm các luật máy kiểm được.
- Dev / test: không build đè `web/out`, không đụng `:8765` (app thật đang chạy); e2e chạy trên bản copy ở scratchpad. Subagent luôn truyền `model`.
- Đổi / thêm feature người dùng thấy: cập nhật `web/src/lib/guide.json` theo đúng nhãn UI.
