<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Frontend ownership: feature, bug fix và refactor

Đọc `../docs/ARCHITECTURE.md` và quy tắc ownership trong `../AGENTS.md` trước khi sửa. Tìm implementation/caller hiện có, sửa đúng feature; không tạo bản sao để xử lý cùng hành vi ở màn khác.

- `src/app/`: thin Next route entrypoints; `_components/` chứa composition toàn app (navigation, shell, integrated guide/tour).
- `src/features/telegram/`: màn Telegram, chat/SSE hooks, message, composer, Q&A, Digest, task và helper dữ liệu riêng.
- `src/features/youtrack/`: ticket/dashboard/workflow/flow và helper/query/action riêng; TicketForm là implementation dùng chung cho mọi nơi tạo ticket.
- `src/features/settings/`: màn cấu hình và preview giao diện.
- `src/shared/components/`: UI primitive, khung AI, Avatar, Markdown và editor trung lập; `ui/` sở hữu Button/Dialog/Segmented/Hint…
- `src/shared/hooks/`, `src/shared/lib/`: hook trung lập, HTTP transport/generated DTO, preferences, i18n, time, notification và utility dùng chung.

### Chiều phụ thuộc

- Shared không import feature hoặc app: áp dụng cho import thường, type, dynamic và relative path. Component chung nhận props/callback; adapter query/action/formatting nghiệp vụ nằm trong feature.
- Composition biết nhiều nghiệp vụ đặt tại `app/_components`, không đặt trong shared. `app/page.tsx` chỉ ghép entrypoint, không chứa implementation nghiệp vụ.
- Import trực tiếp module sở hữu. Tích hợp Telegram–YouTrack có thể gọi component/helper của feature kia; không nhân bản và không gom vào shared chỉ vì có hai caller. Không thêm barrel re-export toàn feature.
- Không tái tạo `src/components`, `src/hooks`, `src/lib` hoặc forwarding file cho đường dẫn cũ. UI mới dùng primitive hiện có tại `src/shared/components/ui`.
- Đổi module/chữ ký phải rà tất cả màn gọi, test, fixture, config và alias. Kiểu DTO sinh vào `src/shared/lib/api.generated.d.ts`; sửa nguồn backend rồi chạy `npm run api:types` từ root, không sửa generated type bằng tay.

### Xác minh

- Chạy `npm run typecheck` và `npm run lint` từ root hoặc web; chạy `uv run pytest -q tests/test_repo_guards.py` từ root để kiểm ranh giới shared.
- Thay đổi luồng UI: build/e2e trên bản copy scratch. Không build đè `web/out`, không dùng app thật ở :8765.
- Đổi feature người dùng thấy: cập nhật các chapter trong `src/shared/lib/guide/{vi,en}/` và bản dịch liên quan.
