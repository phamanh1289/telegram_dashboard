## Post-task routine
- Xong mỗi task (feature, bug fix, refactor): chạy `codegraph sync` ở thư mục gốc repo để cập nhật index `.codegraph/`.

## UI: tab / segmented / nav highlight
- Mọi nhóm tab chọn-một (view, bộ lọc, khoảng thời gian…) dùng `Segmented` trong `web/src/shared/components/ui/segmented.tsx`; không tự viết `motion.span layoutId` + spring.
- Highlight trượt kiểu khác (nav sidebar, gạch chân, tab có popover) dùng `Pill` cùng file với `className` riêng.
- Đổi animation chỉ sửa `PILL_SPRING` / `Pill` ở đó; mỗi nhóm cần `id` (layoutId) riêng.
- Menu / icon cần giải thích khi hover: bọc bằng `Hint` (`web/src/shared/components/ui/hint.tsx`, trễ `HINT_DELAY` 500ms, linh vật bóng đèn); không dùng `title` cho phần giải thích đó. Nút AI giữ `AiAsk` (robot).

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
- Đổi / thêm feature người dùng thấy: cập nhật các chapter tương ứng trong `web/src/shared/lib/guide/{vi,en}/` theo đúng nhãn UI.

## Cấu trúc bắt buộc cho feature, bug fix và refactor

Trước khi sửa code, đọc `docs/ARCHITECTURE.md`, xác định module sở hữu hành vi và tìm implementation/caller hiện có. Áp dụng cho cả code mới lẫn sửa code cũ.

| Loại thay đổi | Nơi đặt code |
| --- | --- |
| Backend Telegram: chat, message, gửi tin, Q&A, Digest/Briefing | `backend/telegram_dashboard/telegram/`; HTTP ở `routes.py` |
| Backend YouTrack: ticket, workflow, UI flow/job | `backend/telegram_dashboard/youtrack/`; `/api/youtrack/*` ở `routes.py`, `/api/yt/*` ở `api.py` (AI: `api_ai.py`, UI flow: `api_flow.py`) |
| Backend dùng chung: cấu hình, auth, storage, AI, events, updater | Module sở hữu tương ứng trong `backend/telegram_dashboard/`; `app.py` giữ composition/lifespan và API chung |
| Frontend Telegram | `web/src/features/telegram/{components,hooks,lib}` |
| Frontend YouTrack | `web/src/features/youtrack/{components,hooks,lib}`; chỉ tạo thư mục con khi có code thật |
| Frontend Settings | `web/src/features/settings/` |
| UI/hook/helper trung lập dùng chung | `web/src/shared/{components,hooks,lib}`; UI primitive ở `shared/components/ui` |
| Next entrypoint và composition nhiều nghiệp vụ | `web/src/app/` và `web/src/app/_components/` |

- Fix hành vi ở module sở hữu; không thêm implementation song song ở module khác. Dùng lại component/helper hiện có trước khi viết mới.
- `shared` **không import** `features` hoặc `app`, kể cả import type, dynamic import hay đường dẫn tương đối. Component chung nhận props/callback; query/action/formatter đặc thù nằm trong adapter của feature.
- Được tái sử dụng module nghiệp vụ qua import trực tiếp, hẹp vào feature sở hữu (vd Telegram dùng TicketForm của YouTrack). Không chuyển code vào `shared` chỉ vì có hai caller nếu nó vẫn phụ thuộc nghiệp vụ; không tạo barrel kéo cả feature vào bundle.
- Backend domain không import `app.py`; ghép router tại composition root trước catch-all/static mount. Giữ cùng nguồn Settings giữa các router, không tạo bản cấu hình riêng bị stale.
- Không tạo lại `telegram_dashboard/` ở root hoặc `web/src/{components,hooks,lib}`; không tạo forwarding shim cho đường dẫn cũ. Feature mới ngoài các nghiệp vụ hiện có cần ownership riêng, không đổ vào `shared` cho tiện.
- Di chuyển/đổi tên/chữ ký: cập nhật mọi import/caller, dynamic import, monkeypatch, test/fixture, script, config, CI/packaging và tài liệu bị ảnh hưởng. Đổi DTO phải sinh lại `web/src/shared/lib/api.generated.d.ts` bằng `npm run api:types` từ root.
- Kích thước: file nguồn mục tiêu ≤ 600 dòng, `test_source_files_stay_small` chặn > 1000. Tách theo seam thật; tách class bằng kế thừa/mixin để giữ API và patch target; không để lại re-export tạm.
- Trước khi xong: kiểm tra chiều phụ thuộc, chạy `uv run pytest -q tests/test_repo_guards.py` và checks phù hợp phần đổi (Python: Ruff + focused tests; frontend: typecheck + lint; đổi luồng UI: build/e2e trên scratch). Giữ API và đường dẫn dữ liệu/release khi chỉ refactor cấu trúc.
