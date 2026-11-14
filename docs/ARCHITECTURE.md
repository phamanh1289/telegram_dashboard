# Cấu trúc và ranh giới module

Source được tổ chức theo nghiệp vụ Telegram, YouTrack và các phần dùng chung. Backend Python tách khỏi frontend Next.js. URL và hợp đồng API không đổi.

```text
backend/
  telegram_dashboard/
    telegram/
      bridge.py          # TelegramBridge: vòng kết nối, ingest/backfill tag, outbox gửi tin, Transport protocol
      transport.py       # TelethonTransport: connect/login, event, đọc tin, gửi tin/reaction
      routes.py          # HTTP chat/message/rule/login, Q&A và Digest/Briefing
      digest.py          # nghiệp vụ tóm tắt và theo dõi phản hồi
      qa.py              # nhận diện và duyệt chuỗi Q&A
      live_reads.py      # TTL, gộp request đọc và giới hạn đồng thời
    youtrack/
      client.py          # YtClient: HTTP, cache TTL, file đính kèm/UI flow, whoami
      queries.py         # YtQueries: danh sách/chi tiết ticket, lịch sử State, people, sprint
      service.py         # YouTrackDashboard: cài đặt team (notes/prompts/workflow), vòng watch
      schemas.py         # body request /api/yt/* và kiểm id/project/role
      api.py             # router /api/yt/* (ticket, field, workflow), ghép api_ai + api_flow
      api_ai.py          # /api/yt/ai/* (một lượt CLI mỗi lần bấm)
      api_flow.py        # /api/yt/flow*, /api/yt/ai/flow, flow jobs
      ai_prompts.py      # prompt AI YouTrack
      routes.py          # auth, tạo issue và tìm issue /api/youtrack/*
      flow.py            # schema và xử lý file UI flow
      flow_prompt.py     # prompt dựng flow
      flow_jobs.py       # vòng đời job dựng flow
    app.py               # composition root/lifespan, lỗi, API AI/projects/status/events
    config.py            # cấu hình, secret env và đường dẫn dữ liệu
    storage/             # SQLite: __init__ ghép Store + Db, schema.py (schema/migration), messages, outbox,
                         # tasks (rule/phiên AI/Q&A), data (digest/thống kê/dọn dữ liệu), flow (UI flow job)
    models.py            # DTO/wire contract và model nội bộ
    ai.py                # AiService: soạn trả lời, ticket, Q&A, Đối chiếu BE; dữ liệu đưa vào prompt (data_json, who)
    ai_prompts.py        # prompt AI dùng chung: ASK_STYLE, ASK_MSG, SYSTEM_PROMPT, session_rules…
    ai_run.py            # chạy một lượt CLI tới câu trả lời: timeout, hủy, retry, run log
    ai_jobs.py           # stream NDJSON (stream_answer) và lượt AI chạy nền (AiJobs)
    providers.py         # chọn CLI/model/effort, catalog, đọc JSON event của CLI
    provider_cmds.py     # dòng lệnh từng CLI: tool, quyền, sandbox, zeplin MCP
    provider_accounts.py # đăng nhập/quota Codex, Antigravity
    desktop.py           # hộp thoại hệ điều hành (chọn thư mục, osascript)
    agent.py, tasks.py   # phiên AI và quản lý tiến trình
    ...                  # auth, privacy, updater, events, local_data, gitops…
tests/                   # regression/integration tests backend
web/
  src/
    app/
      page.tsx           # entrypoint Telegram (/)
      youtrack/page.tsx  # entrypoint YouTrack (/youtrack/)
      settings/page.tsx  # entrypoint Settings (/settings/)
      _components/       # shell, guide và tour điều phối toàn app
      *.css              # design tokens và CSS toàn app
    features/
      telegram/
        components/      # inbox, composer, messages, Q&A, Digest, tasks…
        hooks/           # SSE và lịch sử chat
        lib/             # query/action Telegram, draft, brief, mention adapter…
      youtrack/
        components/      # tickets, dashboard, flow, release, ticket form…
        lib/             # YouTrack client/query, flow draft, stats, mention adapter
        flow-engine/     # ES modules: model/layout, geometry, renderer, camera, player, editor/inspector, finder, styles
      settings/
        components/      # cấu hình và preview giao diện
    shared/
      components/
        ui/              # Button, Dialog, Segmented/Pill, Hint…
        ai/              # khung chat và cảnh AI dùng chung
        ...              # Markdown, Avatar, DateRange, Mention, auth/providers…
      hooks/             # hook đồng hồ dùng chung
      lib/               # HTTP transport/types, i18n, prefs, utils, notifications…
  public/                # static assets, uiflow.js sinh từ flow-engine/ (không sửa tay)
  tests/                 # browser/fixture tests và test helper frontend
scripts/                 # dev và đóng gói
packaging/               # launcher/installer macOS và Windows
```

## Quy tắc phụ thuộc

1. `shared/` chỉ dùng thư viện ngoài hoặc module khác trong `shared/`; không import `features/` hay `app/`. Repo guard kiểm tra cả alias và đường dẫn tương đối.
2. Entry point trong `app/` ghép feature. `app/_components/` chứa shell/guide/tour biết nhiều nghiệp vụ, không coi chúng là primitive dùng chung.
3. Feature sở hữu query, action và adapter dữ liệu của mình. Ví dụ Mention dùng chung chỉ hiển thị/chọn; `groupMembers` và `ytPeople` cung cấp cách đọc/format từ từng feature.
4. Tích hợp Telegram–YouTrack được giữ bằng import trực tiếp vào module sở hữu. Ví dụ Telegram dùng `features/youtrack/components/ticket-form.tsx` để tạo ticket, không nhân bản form và không đưa form nghiệp vụ vào `shared/`. Không dùng barrel re-export toàn feature.
5. Backend domain không import composition root `app.py`. `app.py` khởi tạo service và ghép router. Router Telegram/YouTrack dùng getter/setter cấu hình chung; đổi tài khoản cập nhật cùng nguồn cấu hình, không giữ bản sao riêng.
6. Module persistence/config/auth/AI chung giữ ownership backend; không đưa vào package Telegram/YouTrack chỉ vì một luồng đang gọi nó. Các phụ thuộc vòng cũ ngoài phạm vi di chuyển này được ghi ở báo cáo review, không tuyên bố đã loại bỏ toàn bộ.

## Chạy và đóng gói

Chạy từ gốc repo như trước. Sau khi lấy thay đổi cấu trúc, chạy `uv sync` để cập nhật editable install sang `backend/`:

```sh
uv sync
uv run pytest -q
uv run ruff check .
npm run typecheck
npm run lint
npm run dev
```

CLI giữ tên package `telegram_dashboard`; không cần PYTHONPATH thủ công. `pyproject.toml` chỉ rõ source wheel ở `backend/telegram_dashboard`; pytest biết đường dẫn `backend`.

`Settings.root` trong source checkout vẫn là gốc repo, vì vậy `.env`, `data/`, file cấu hình dữ liệu và `web/out` không chuyển theo source. Bản release tiếp tục có `app/telegram_dashboard` cạnh `app/web/out`; launcher và updater dùng cùng cấu trúc gói cũ. Public signing key đi theo Python package.

Kiểu API sinh vào `web/src/shared/lib/api.generated.d.ts` qua `npm run api:types`. Config shadcn trỏ vào `shared/components/ui`, tránh tái tạo thư mục component cũ.

Build/e2e trong quá trình phát triển phải chạy trên bản copy scratch theo AGENTS.md; không build đè `web/out` hoặc chiếm port app thật.

## Kiểm chứng lần tái cấu trúc

Kết quả đầy đủ: [review ngày 14/11/2026](reviews/2026-11-14-project-structure.md). Cấu trúc trong tài liệu này là nguồn tra cứu hiện tại; phần đầu báo cáo review ghi lại thời điểm trước khi tách thư mục.

## Entry point rule cho coding agent

- Codex: `AGENTS.md` ở gốc và file scope `backend/AGENTS.md`, `web/AGENTS.md`.
- Claude Code: `CLAUDE.md` import trực tiếp root rule/architecture; `backend/CLAUDE.md` và `web/CLAUDE.md` import rule scope tương ứng.
- Gemini CLI: `GEMINI.md` import cùng root rule/architecture; file GEMINI trong backend/web import rule scope tương ứng.
- Antigravity: đọc `AGENTS.md` theo workspace/directory; dùng chung rule chuẩn, không duy trì bản nội dung riêng.

Sau khi cập nhật rule, mở phiên mới hoặc dùng cơ chế refresh context của tool. Đây là cấu hình hướng dẫn; việc tuân thủ vẫn được kiểm tra qua review và repo guards. Chưa chạy xác minh context trong phiên Claude/Gemini/Antigravity thực tế.

## UI flow engine và dữ liệu hướng dẫn

Source engine ở `web/src/features/youtrack/flow-engine/`: model và layout, geometry, DOM/frame renderer, camera, prototype player, editor, inspector, finder và styles có module riêng. `mount.js` giữ composition và lịch sử flow; `index.js` xuất duy nhất `window.UIFlow` và khởi động HTML standalone. API mount/get/set/undo/redo/destroy, schema và đường dẫn `/uiflow.js` giữ nguyên.

`npm run build:uiflow` dùng webpack có sẵn trong phiên bản Next đã pin, tạo bundle IIFE `web/public/uiflow.js` không cần module loader hoặc request bổ sung. Backend nhúng bundle này vào HTML, nên file export tiếp tục mở offline qua `file://`. `prebuild` và `predev` sinh lại bundle; sau khi sửa engine trong phiên dev đang chạy, chạy `npm run build:uiflow`. `npm run check:uiflow` so bundle với source và được gọi bởi root `npm run typecheck`. Bundle được lưu trong repo để checkout chạy test/export trực tiếp; ESLint và giới hạn dòng áp dụng lên source, không áp dụng lên bundle sinh tự động.

Guide ở `web/src/shared/lib/guide/{vi,en}/`, chia chapter theo khu vực UI. Mỗi `index.ts` giữ thứ tự catalog; runtime vẫn lazy-load cả ngôn ngữ ở lần dùng đầu tiên. Thêm/sửa mục ở chapter tương ứng, cập nhật hai ngôn ngữ và index khi thêm chapter.

Tests Python chia theo AI service/runner/accounts/preferences/mascot và YouTrack query/workflow/watch/AI/flow attachments/flow AI. Browser engine có các spec `uiflow-{map,prototype,editor,lifecycle,zeplin,annotations}.spec.ts`, dùng chung `uiflow.helpers.ts`. `web/playwright.uiflow.config.ts` chạy riêng engine qua static fixture, không cần backend server. Repo guard giới hạn 1.000 dòng bao phủ cả engine JS, test và script; mục tiêu source mới ≤600 dòng.
