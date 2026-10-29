# Telegram Dashboard

Web local để tập trung tin nhắn nhóm, trả lời bằng tài khoản Telegram cá nhân và dùng AI hỗ trợ soạn nháp.

Repository hiện ở giai đoạn thiết kế và lập plan; chưa có ứng dụng chạy được. Người dùng đã chọn Next.js cho frontend.

## Tài liệu triển khai

- [Plan thực thi theo sáu phase](docs/superpowers/plans/2026-10-29-local-web-implementation.md).
- [Thiết kế và tiêu chí nghiệm thu](docs/superpowers/specs/2026-10-29-local-web-design.md).
- [Rà stack, phiên bản và bằng chứng kiểm tra](docs/decisions/2026-10-29-stack-review.md).

## Kiến trúc đã đề xuất

- Next.js App Router, React, TypeScript; Tailwind CSS, shadcn/ui Base UI, Motion và TanStack Query.
- FastAPI/Pydantic v2, Telethon, SQLite WAL; REST + SSE cho UI.
- Dev: Next ở loopback port 3000, Python ở port 8765, API qua proxy cùng origin.
- Build local: Next static export được FastAPI phục vụ tại port 8765; một Python process chạy backend và UI.
- AI tùy chọn, mặc định tắt; chỉ tạo draft/summary trong phạm vi dữ liệu được phép. Người dùng duyệt trước khi gửi.

Lệnh cài/chạy sẽ được thêm sau khi implementation tạo và kiểm chứng entrypoints/lockfiles. Không đưa Telegram session, OTP/2FA, API hash hoặc AI key vào Git.
