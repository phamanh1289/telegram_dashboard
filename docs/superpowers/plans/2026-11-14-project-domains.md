# Project Domains Implementation Plan

> **For agentic workers:** Implement the owned backend/frontend changes with explicit file boundaries; run integration verification after merging the physical moves.

**Goal:** Tách rõ Telegram, YouTrack, backend và component dùng chung bằng thư mục và ownership thực tế.

**Architecture:** Python source nằm ở backend/telegram_dashboard, Telegram và YouTrack có package/routes riêng. Frontend dùng features/{telegram,youtrack,settings} và shared; app/_components điều phối toàn app.

**Tech Stack:** Python/FastAPI, Next.js/React/TypeScript, Hatch/uv, pytest/Playwright.

**Spec:** [docs/ARCHITECTURE.md](../../ARCHITECTURE.md), theo yêu cầu người dùng trong chat hiện tại.

## Global Constraints

- Giữ URL, OpenAPI, dữ liệu người dùng và cấu trúc release.
- Bảo toàn các thay đổi đã có; không shim/forwarding barrel hoặc dependency mới.
- Không build web/out trên checkout thật; không chạm app ở :8765.

## Review Focus

- Import tương đối/dynamic/monkeypatch phải đi tới đúng module sau di chuyển.
- Shared frontend không kéo ngược feature hoặc app.
- Settings source root và packaged root đều trỏ đúng dữ liệu/static files.
- Router domain vẫn được đăng ký trước fallback/static mount, giữ schema.
- Wheel/signing key/scripts và fixture vẫn chạy độc lập với layout cũ.

## Tasks

- [x] Chụp OpenAPI chuẩn và xác định file ownership.
- [x] Di chuyển frontend theo feature/shared; tách helper trung lập và adapter Mention.
- [x] Di chuyển backend; tách router Telegram/YouTrack, cập nhật import.
- [x] Cập nhật packaging, config, source guards và tài liệu đang dùng.
- [x] Chạy checks tích hợp, isolated production build/e2e, review độc lập và sync CodeGraph.

Kết quả: 367 backend tests; Ruff/typecheck/lint/build pass; E2E45/46 lần đầu, ca AI follow-up pass khi chạy riêng (race cũ được ghi báo cáo); wheel/import smoke và98-path OpenAPI exact match pass.
