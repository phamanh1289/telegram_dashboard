## Post-task routine
- Xong mỗi task (feature, bug fix, refactor): chạy `codegraph sync` ở thư mục gốc repo để cập nhật index `.codegraph/`.

## UI: tab / segmented / nav highlight
- Mọi nhóm tab chọn-một (view, bộ lọc, khoảng thời gian…) dùng `Segmented` trong `web/src/components/ui/segmented.tsx`; không tự viết `motion.span layoutId` + spring.
- Highlight trượt kiểu khác (nav sidebar, gạch chân, tab có popover) dùng `Pill` cùng file với `className` riêng.
- Đổi animation chỉ sửa `PILL_SPRING` / `Pill` ở đó; mỗi nhóm cần `id` (layoutId) riêng.
- Giao diện chat AI (AI Agent, Trợ lý AI tin tag, YouTrack AI, tính năng AI mới) ghép từ `web/src/components/ai/chat.tsx`: `UserBubble`, `AiThinking`/`AiWriting`, `AiResultCard`, `AiPromptBox` (ô prompt ghim dưới, `ai-ring` khi chạy, nút dừng), `useFollow` (feed tự cuộn); không tự viết lại.
- Ô prompt AI (`AiPromptBox`): ghim ở **đáy** màn / dialog (footer), không đặt giữa nội dung. Mọi nút thực hiện AI (chạy / soạn / gửi / dừng, chọn model / effort) nằm **bên trong** ô prompt qua `actions` / `tools` (nút chạy: `Button size="sm"` `rounded-full bg-hl`, bọc `Hint`); không đặt nút chạy AI ở footer riêng hay bên ngoài ô. Không thêm khung giới thiệu "AI sẽ làm gì" cạnh ô prompt; trạng thái chạy dùng robot/`AiThinking` + `ai-ring`.
- Form tạo ticket YouTrack chỉ có một: `TicketForm` (`web/src/components/ticket-form.tsx`) dùng chung cho tab Telegram và tab YouTrack; Project / Type / Priority / Assignee luôn lấy từ YouTrack (`yt.projects/fields/people`); mặc định do form tự tính, giống nhau ở 2 tab (project = project tab YouTrack đang dùng qua `resolveProject`, assignee = mình). Nơi gọi không truyền project / meta riêng. Sửa ở đó, không nhân bản. Section dạng `grid` chứa dòng `truncate` phải có `grid-cols-1` (cột `minmax(0,1fr)`), nếu không chữ dài làm cột nở ra, vùng cuộn bị `autoFocus` cuộn ngang và UI lệch.
- Ô chọn một giá trị trong form / dialog (thuộc tính ticket, model…) dùng `Dropdown` (`web/src/components/ui/dropdown.tsx`, base-ui Select; `prefix` cho tên trường, `hint` cho dòng phụ); không dùng `<select>` native vì popup của nó không theo giao diện app.
- Menu / icon cần giải thích khi hover: bọc bằng `Hint` (`web/src/components/ui/hint.tsx`, trễ `HINT_DELAY` 500ms, linh vật bóng đèn); không dùng `title` cho phần giải thích đó. Nút AI giữ `AiAsk` (robot).
