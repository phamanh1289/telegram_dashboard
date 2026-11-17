# Backend ownership

Đọc `../docs/ARCHITECTURE.md` và quy tắc ownership trong `../AGENTS.md` trước mọi feature, bug fix hoặc refactor.

- Python source ở `backend/telegram_dashboard`; giữ package import `telegram_dashboard`. Chạy lệnh từ gốc repo bằng `uv run`; không thêm PYTHONPATH hoặc bản sao package ở root.
- Telegram: sửa trong `telegram/`; bridge ở `bridge.py`, Telethon transport ở `transport.py`, HTTP ở `routes.py`, Q&A/Digest/live reads ở module tương ứng.
- YouTrack: sửa trong `youtrack/`; API `/api/youtrack/*` ở `routes.py`, `/api/yt/*` ở `api.py` (AI: `api_ai.py`, UI flow: `api_flow.py`); UI flow/prompt/jobs ở module tương ứng.
- Infrastructure/AI dùng chung ở module gốc package đang sở hữu trách nhiệm (`config`, `auth`, `storage`, `ai`, `providers`, `agent`, `events`…). Không đưa nghiệp vụ domain mới vào `app.py`.
- `app.py` khởi tạo service, quản lifespan, lỗi/middleware, API chung và ghép router trước API catch-all/static mount. Domain không import ngược `app.py`; truyền dependency cần thiết, giữ nguồn Settings chung.
- Fix ở implementation gốc và rà mọi caller. Di chuyển module phải đổi import tĩnh/động, monkeypatch và fixture; không thêm re-export/shim để che caller chưa cập nhật.
- Giữ root dữ liệu ở gốc checkout và layout release hiện có; đổi đường dẫn source phải rà `config.py`, `pyproject.toml`, `scripts/package.py`, CI và resource path.
- Xác minh theo phạm vi: `uv run ruff check .`, focused pytest và `uv run pytest -q tests/test_repo_guards.py`. Đổi DTO: `npm run api:types` từ root, kiểm tra diff contract và frontend typecheck.
