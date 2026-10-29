# Rà soát stack — Next.js và web local

Ngày kiểm tra: 2026-10-29. Phạm vi: cập nhật thiết kế/plan, đối chiếu nguồn chính thức, package metadata và backend import smoke. Chưa viết sản phẩm hoặc login Telegram.

## Kết luận

Chọn công nghệ stable đang được duy trì, phù hợp ứng dụng local. Người dùng đã duyệt Next.js; phần còn lại không bắt buộc chuyển sang JavaScript hoặc chọn số phiên bản lớn nhất trước compatibility gate. Các version dưới đây là snapshot, không thay thế lockfile/build/test lúc thực thi.

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| UI | Next.js App Router + React + TypeScript strict | Component/state cho inbox, composer và panel AI |
| Styling/components | Tailwind v4 + shadcn/ui Base UI | Theme/layout tùy chỉnh, chỉ lấy component cần; Base UI là mặc định hiện hành |
| Animation | Motion React + CSS cho hiệu ứng nhỏ | Layout/enter/exit, tôn trọng reduced-motion và scroll/focus |
| Dữ liệu UI | TanStack Query, cache RAM | Cursor queries, cancellation và mutation status; chưa cần Redux/Zustand |
| Realtime | FastAPI native SSE + EventSource + REST | Push cập nhật một chiều; không cần WebSocket server hoặc polling liên tục |
| Backend | FastAPI + Pydantic v2 + Uvicorn | Async lifecycle phù hợp client Telegram, DTO rõ ràng; vẫn là stack hiện hành |
| Telegram | Telethon stable 1.x | Stable 1.45.0 có docs/release hiện hành; pure Python, phù hợp luồng đã chọn |
| Database | SQLite WAL, sqlite3 chuẩn | Local một người, không cần quản trị DB server hoặc ORM |
| AI | httpx backend gọi một provider đã cấu hình | Draft/summary chưa cần framework agent; SDK/API chốt theo provider |
| Types API | openapi-typescript từ FastAPI OpenAPI | Tránh DTO Python/TypeScript lệch nhau, không thêm runtime client framework |
| Tooling | uv/uv.lock; npm workspaces/package-lock; Ruff/pytest/Playwright | Cài lặp lại được; focused tests cho data/send/API và browser flows |

## Snapshot phiên bản và bằng chứng

Nguồn là npm dist-tag latest và PyPI current release. Engine/peer metadata chỉ chứng minh yêu cầu khai báo, chưa chứng minh frontend build cùng nhau.

| Package/runtime | Snapshot | Bằng chứng/giới hạn |
|---|---|---|
| Next.js | 16.4.3 | engines Node >=20.9, peer React ^19 được chấp nhận; chưa build UI |
| React | 19.3.1 | npm stable; React DOM pin cùng phiên bản khi resolve |
| TypeScript | 7.0.2 latest; **chọn 5.9.3** | 7.0.2 xung đột peer: openapi-typescript 7.13.0 yêu cầu `^5.x`, typescript-eslint 8.72.1 yêu cầu `<6.1.0` → `npm ci` lỗi ERESOLVE. Pin 5.9.3 tới khi cả hai hỗ trợ bản mới |
| openapi-typescript | 7.13.0 | peer TypeScript `^5.x` |
| typescript-eslint | 8.72.1 | peer TypeScript `>=4.8.4 <6.1.0` (qua eslint-config-next 16.4.3) |
| Tailwind CSS | 4.3.3 | npm stable; tích hợp theo hướng dẫn Next hiện hành |
| shadcn CLI | 4.23.0 | npm stable; dùng để sinh component, không coi CLI là runtime dependency |
| Motion | 14.7.1 | peer React/React DOM ^18 hoặc ^19 |
| TanStack React Query | 5.105.0 | peer React ^18 hoặc ^19 |
| Playwright Test | 1.64.1 | Node >=20; browser install lúc thực thi |
| FastAPI | 0.162.0 | Import pass trên Python 3.14.6 trong environment cô lập |
| Pydantic | 2.14.1 | Import pass với FastAPI trên |
| Telethon | 1.45.0 | Import pass, docs stable cùng phiên bản; chưa authorize/connect thật |
| SQLite | 3.53.3 | sqlite3 runtime của Python đã probe; chưa benchmark DB ứng dụng |
| uv | 0.13.6 | PyPI snapshot; probe chạy bằng uv 0.11.27 có sẵn trên máy (Homebrew), chưa thử 0.13.x. Lockfile nên tạo/kiểm bằng cùng một phiên bản uv |
| Node | Máy 24.14.1; security release gần nhất 24.22.1 (2026-10-20); patch mới nhất 24.22.2 (2026-10-27, không phải security) | Máy đang thiếu security patch; chọn project runtime ≥24.22.1 lúc thực thi; chưa nâng runtime toàn máy |

Kết quả thực tế:

```text
PASS 3.14.6 FastAPI 0.162.0 Pydantic 2.14.1 Telethon 1.45.0 SQLite 3.53.3 native SSE imports OK
```

Probe dùng uv run --isolated --no-project với FastAPI/Pydantic/Telethon pin ở trên, import thêm Uvicorn/httpx và fastapi.sse. Dependencies chỉ trong environment/cache cô lập; không scaffold hoặc cài project vào repo. Không có credentials, không gọi Telegram/AI. Đây không phải end-to-end test hoặc bằng chứng toàn bộ hành vi Python 3.14 đã tương thích.

## Điều chỉnh kiến trúc

1. Next static export cho bản local; FastAPI phục vụ UI/API port 8765. Dev dùng Next port 3000 proxy API. Không bật export và rewrites cùng mode. Auth/cookies do Python quản lý runtime; không dùng Next server cookies/Server Actions/private SSR trong static build.
2. Shell page `/`, chọn chat bằng state/query string. Không export dynamic routes cho nhóm chưa biết trước. Không private data trong HTML/RSC/assets lúc build.
3. SSE dùng cursor `<db_epoch>:<revision>` thống nhất cho event ID và REST snapshot/change pages (một change feed toàn cục `/api/changes`), có reset/replay; UI phân biệt notification cursor với cursor đã apply. Native SSE có từ FastAPI 0.135.0, nên không thêm sse-starlette. Stream chỉ metadata, REST là nguồn dữ liệu, DB là nguồn recovery.
4. Local API queries dùng networkMode:always để đọc localhost khi mất internet; send/AI mutations cũng đặt retry:false, networkMode:always và không persist/resume offline. Network pause có thể làm tác vụ chạy khi online lại dù không retry lỗi; không dựa riêng retry:false để bảo đảm người dùng chủ động gửi.
5. Cookie Path=/api, same-origin proxy và no-store phải kiểm chứng cả dev/build. SSE qua proxy phải nhận event khi stream đang mở; headers không đủ làm bằng chứng pass.

## Các hướng chưa chọn

- **TDLib:** thư viện Telegram chính thức, xử lý nhiều phần đồng bộ/cache. Chọn Telethon để tránh native build/binding/binary distribution trong bản Python local; cân nhắc lại khi có yêu cầu thực tế, không kết luận tốt hơn mọi trường hợp.
- **GramJS/all-TypeScript:** có thể làm Telegram client Node. Đây là lựa chọn ngôn ngữ khác; hiện chưa có lý do chức năng phải bỏ Python hoặc chuyển toàn bộ data layer.
- **PostgreSQL/Prisma/Drizzle/Redis/queue server:** chưa có yêu cầu multi-user hoặc server workloads; không thêm service hoặc data owner thứ hai vào app local.
- **Framework agent:** chưa thêm LangChain/LangGraph/agent SDK khi chỉ có draft/summary không tool execution. Chưa chọn provider/model hoặc API riêng của một provider.
- **Beta/canary/new major chưa qua gate:** stable metadata là candidate. Nếu resolver/typecheck/build lỗi, dùng stable tương thích đã kiểm chứng và ghi lý do; không ép số version lớn nhất.

## Chưa kiểm chứng ở lượt lập plan

- Frontend dependency install/lock, React DOM/types/TypeScript/Next/shadcn/Motion build cùng nhau và Playwright flows. Peer metadata đã cho thấy TypeScript 7.0.2 không resolve được với openapi-typescript/typescript-eslint; TypeScript 5.9.3 chỉ mới thỏa metadata, chưa build.
- SSE trực tiếp/qua Next proxy, reset/replay, subscriber cleanup/auth expiry.
- Telethon lifecycle/recovery/raw-send idempotency/FloodWait trên focused suite và live account.
- Provider/model, API contract và phạm vi dữ liệu đủ điều kiện trước live AI; framework UI không thay đổi điều kiện sử dụng dữ liệu.

## Nguồn chính thức

- [Next static export](https://nextjs.org/docs/app/guides/static-exports), [Next npm metadata](https://registry.npmjs.org/next/latest), [React metadata](https://registry.npmjs.org/react/latest), [TypeScript metadata](https://registry.npmjs.org/typescript/latest).
- [Tailwind Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [shadcn Base UI default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default), [Motion React](https://motion.dev/docs/react), [TanStack mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations), [network modes](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode).
- [FastAPI SSE](https://fastapi.tiangolo.com/tutorial/server-sent-events/), [FastAPI release notes](https://fastapi.tiangolo.com/release-notes/), [FastAPI metadata](https://pypi.org/pypi/fastapi/json), [Pydantic metadata](https://pypi.org/pypi/pydantic/json).
- [Telethon docs](https://docs.telethon.dev/en/stable/), [Telethon metadata](https://pypi.org/pypi/telethon/json), [TDLib](https://core.telegram.org/tdlib/getting-started), [GramJS](https://github.com/gram-js/gramjs).
- [SQLite use cases](https://sqlite.org/whentouse.html), [uv](https://docs.astral.sh/uv/), [openapi-typescript](https://openapi-ts.dev/introduction), [Node 24.22.1 LTS](https://nodejs.org/en/blog/release/v24.22.1).
