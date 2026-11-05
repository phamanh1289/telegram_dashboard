## Post-task routine
- Xong mỗi task (feature, bug fix, refactor): chạy `codegraph sync` ở thư mục gốc repo để cập nhật index `.codegraph/`.

## UI: tab / segmented / nav highlight
- Mọi nhóm tab chọn-một (view, bộ lọc, khoảng thời gian…) dùng `Segmented` trong `web/src/components/ui/segmented.tsx`; không tự viết `motion.span layoutId` + spring.
- Highlight trượt kiểu khác (nav sidebar, gạch chân, tab có popover) dùng `Pill` cùng file với `className` riêng.
- Đổi animation chỉ sửa `PILL_SPRING` / `Pill` ở đó; mỗi nhóm cần `id` (layoutId) riêng.
- Menu / icon cần giải thích khi hover: bọc bằng `Hint` (`web/src/components/ui/hint.tsx`, trễ `HINT_DELAY` 500ms, linh vật bóng đèn); không dùng `title` cho phần giải thích đó. Nút AI giữ `AiAsk` (robot).
