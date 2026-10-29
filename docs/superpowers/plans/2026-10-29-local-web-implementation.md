# Telegram Dashboard Local Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native execution is proposed; no execution method has been selected by the user.

**Goal:** Chạy web local để đọc tập trung tin nhóm, trả lời bằng tài khoản Telegram cá nhân và dùng AI soạn nháp trong phạm vi dữ liệu được phép.

**Architecture:** Next.js App Router dựng frontend tương tác; FastAPI sở hữu Telethon client, SQLite và AI. Dev dùng Next ở port 3000 proxy `/api` sang Python port 8765; bản build Next static export do FastAPI phục vụ cùng origin tại port 8765, chạy một Python process. SSE báo thay đổi, REST lấy snapshot/change pages; AI chỉ trả về text và không được gửi tin.

**Tech Stack:** Next.js + React + TypeScript 5.9 strict, Tailwind v4, shadcn/ui Base UI, Motion React, TanStack Query; Python 3.14, FastAPI/Pydantic v2/Uvicorn, Telethon stable 1.x, SQLite WAL, httpx; uv và npm lockfiles, openapi-typescript, pytest/Ruff/Playwright. Snapshot và bằng chứng import ở [stack review](../../decisions/2026-10-29-stack-review.md); frontend build compatibility vẫn là gate khi thực thi.

**Spec:** [2026-10-29-local-web-design.md](../specs/2026-10-29-local-web-design.md). Người dùng đã chọn web local và duyệt Next.js. Các lựa chọn package còn lại là đề xuất sau rà stack; lượt hiện tại cập nhật plan, chưa triển khai sản phẩm.

## Global Constraints

- Một tài khoản, một người dùng; Python bind `127.0.0.1:8765`, một worker, không reload session thật. Next dev chỉ bind `127.0.0.1:3000`; runtime bản build chỉ cần Python.
- `data/`, `.env`, session, DB/WAL/SHM và `.venv/` phải gitignore trước lần login đầu. Không in secrets hoặc nội dung tin ra log.
- Chỉ thu dữ liệu nhóm được chọn; initial history tối đa 50 tin. API dùng chuỗi cho Telegram IDs, timestamp UTC.
- Không dùng bot token thay cho tài khoản cá nhân. Login Telegram bằng CLI; người dùng tự nhập mã/2FA trên máy.
- Mọi lượt gửi do người dùng chủ động; cùng request UUID dùng lại Telegram `random_id`. Không tự resend tác vụ chưa rõ kết quả.
- UI dùng React text interpolation; SQL parameterized; private API/SSE có local session, Host/Origin checks đúng APP_ORIGIN theo chế độ, không CORS wildcard; private responses không cache/persist.
- AI mặc định tắt, tối đa 30 tin context cùng nhóm, kiểm tra phạm vi trước mỗi lần gọi, không có send tool.
- Không có ORM, Redis, queue server, Docker, multi-account hoặc tải media trong bản đầu. Không chạy Telegram trong Next route handlers, Server Actions hoặc serverless.
- Next build export chỉ có static shell page `/`; không private SSR, runtime Next cookies API, dynamic chat route hoặc export rewrites. Dev rewrites cấu hình riêng khi không bật export.
- Native FastAPI SSE + persisted revisions, không thêm SSE framework. Query cache ở RAM; send/AI mutations dùng retry=false/networkMode=always, không offline queue hoặc tự resume.
- Test chỉ thêm cho logic có rủi ro: scope, sync, dữ liệu, gửi tin, auth và AI. Không viết test lặp lại markup hoặc từng config constant.

## Review Focus

1. Hai nhóm có cùng message ID; tin đến lặp hoặc out-of-order phải giữ đúng dữ liệu — Phase 2.
2. Mất mạng/crash sau Telegram nhận tin nhưng trước khi lưu kết quả; retry không tạo tin thứ hai — Phase 3.
3. Sự kiện xóa thiếu chat ID; không được xóa nhầm dữ liệu nhóm khác — Phase 2.
4. Trang web khác gọi localhost, proxy sai cookie/cache hoặc tin nhắn chứa script; không đọc/gửi được dữ liệu hoặc chạy mã — Phase 1/4.
5. Nội dung nhóm yêu cầu agent gửi tin/rò key; AI không có quyền gửi và request trái scope bị chặn — Phase 5.

## File map dự kiến

```text
pyproject.toml                 # dependency pin, package và CLI entrypoint
uv.lock / .python-version       # reproducible Python environment
package.json / package-lock.json # npm workspace + dev/build/start/check scripts
.node-version                  # Node 24 LTS security patch được kiểm chứng
.gitignore / .env.example       # chỉ tên biến server, không giá trị thật
README.md                      # cài/chạy, đăng nhập, hạn chế và xử lý lỗi
scripts/dev.mjs                # start/stop Next + Python bằng Node stdlib
telegram_dashboard/
  __init__.py / __main__.py     # python -m telegram_dashboard login|serve
  config.py                    # cấu hình và vị trí dữ liệu
  app.py                       # FastAPI lifespan, routes, dependency wiring
  auth.py                      # local unlock, cookie, Host/Origin checks
  models.py                    # DTO/API types, ID dạng chuỗi
  storage.py                   # schema, SQL, transactions, sync/outbox state
  telegram.py                  # client, handlers, catch-up, reply RPC
  events.py                    # SSE metadata replay/reset/heartbeat
  ai.py                        # scope check, context, một HTTP provider
tests/
  test_local_access.py
  test_storage_sync.py
  test_send.py
  test_events.py
  test_ai.py
web/
  package.json / tsconfig.json / next.config.ts / components.json
  eslint.config.mjs / playwright.config.ts / postcss.config.mjs
  src/app/{layout.tsx,page.tsx,globals.css}
  src/components/{providers,unlock,inbox,chat-list,message-list,composer,ai-panel}.tsx
  src/components/ui/            # chỉ shadcn components thực sự dùng
  src/hooks/{use-chat-messages,use-events}.ts
  src/lib/{api.ts,query-client.ts,api.generated.d.ts}
  tests/inbox.spec.ts
  out/                         # generated static export, ignored
data/                          # runtime only, ignored
work/                          # openapi.json tạm cho api:types, ignored
```

Giữ query/storage trong một module cho bản đầu. Chỉ tách `routes` hoặc `services` khi có trách nhiệm thực tế cần tách. Không xây plugin/provider framework.

## Phase 1 | Khởi chạy local và bảo vệ truy cập

**Target files:** root manifests/lockfiles/runtime files, `.gitignore`, `.env.example`, `README.md`, `scripts/dev.mjs`, `web/package.json`, `web/next.config.ts`, `web/src/app/{layout,page}.tsx`, `telegram_dashboard/{__init__,__main__,config,app,auth}.py`, `tests/test_local_access.py`.

**Surgical action:**

- [ ] Kiểm tra `git status`, hướng dẫn repo và runtime. Dùng uv tạo environment/project lock Python 3.14; baseline import FastAPI 0.162.0/Pydantic 2.14.1/Telethon 1.45.0 đã pass trên Python 3.14.6. Dùng Node 24 LTS patch hiện hành; bản cài trên máy là 24.14.1, nguồn chính thức hiện có 24.22.1 security release. Chọn runtime riêng của dự án khi thực thi, không tự nâng runtime toàn máy. Pin TypeScript 5.9.3 (7.0.2 xung đột peer với openapi-typescript và typescript-eslint, xem stack review). Các package còn lại pin sau resolve/build gate.
- [ ] Tạo npm workspace `web` với Next App Router/React/TypeScript strict, config dev proxy và build static export tách biệt. Ghi lockfile. `npm run dev` dùng Node stdlib supervisor chạy Next/Python, Ctrl+C dừng cả hai; `npm run build` build web; `npm start` chạy `uv run --no-sync python -m telegram_dashboard serve` và báo lỗi hữu ích nếu chưa có `web/out`. Trong phase setup, static shell hiển thị setup_required, chưa dựng inbox.
- [ ] Tạo `.gitignore` trước mọi credential, gồm `data/`, `work/`, `.env*` trừ template, `.venv/`, `node_modules/`, `web/.next/`, `web/out/`, Playwright report/trace. `Settings` đọc environment, đường dẫn dữ liệu tuyệt đối dưới repo; TELEGRAM_API_ID/HASH và AI_BASE_URL/MODEL/KEY chỉ ở Python, không dùng NEXT_PUBLIC cho secrets. Không bắt buộc Telegram/AI để mở setup.
- [ ] Tạo `create_app(settings: Settings) -> FastAPI` và CLI `python -m telegram_dashboard serve`; bind loopback, đúng một worker. Endpoint `/health` chỉ trả `{"status":"ok"}`; chưa có Telegram thì private status hiển thị `setup_required`.
- [ ] Tạo `POST /api/unlock` nhận local code CLI sinh bằng secrets, giới hạn thử; cookie phiên HttpOnly/SameSite=Strict, Path=/api. APP_ORIGIN mặc định `http://127.0.0.1:8765` (build); `scripts/dev.mjs` đặt env `APP_ORIGIN=http://127.0.0.1:3000` cho Python khi dev. Host luôn là `127.0.0.1:8765`; mutating API từ chối thiếu/sai Origin; GET/SSE yêu cầu cookie và kiểm tra Origin nếu có. Proxy phải giữ cookie/Origin, dùng upstream cố định, không nhận URL do browser chọn. Private responses no-store; không log body.
- [ ] Serve `web/out` sau API routes/404, không biến `/api/missing` thành HTML 200. Khởi tạo app/export OpenAPI phải không login/connect Telegram. Thêm CLI `python -m telegram_dashboard export-openapi --output work/openapi.json` và npm `api:types` chạy openapi-typescript vào `web/src/lib/api.generated.d.ts`; sinh types mới sau mỗi DTO change, không nhân đôi DTO Python/TS thủ công.
- [ ] Thêm regression test `test_private_api_requires_cookie`, `test_cross_origin_mutation_rejected`, `test_invalid_host_rejected`, `test_unlock_rate_limited`, `test_api_404_is_not_static_html`, `test_no_store_headers`; dùng FastAPI TestClient, không cần Telegram.

**Verification:** `uv run pytest tests/test_local_access.py -q`, `npm run api:types`, `npm run typecheck`, `npm run build`. Kiểm tra `web/out/index.html` và assets không chứa dữ liệu/keys; health 200/private 401. Dev proxy unlock nhận cookie dùng được cho request sau; build chạy với một Python process. Đây chưa phải kết nối Telegram thật.

## Phase 2 | Đăng nhập tài khoản, chọn nhóm và lưu tin

**Target files:** `telegram_dashboard/{__main__,models,storage,telegram,app}.py`, `tests/test_storage_sync.py`, `README.md`.

**Interfaces:** `TelegramBridge.start()`, `stop()`, `list_groups()`; `Store.set_tracking(chat_id: str, enabled: bool)`; `Store.apply_message(message: StoredMessage)`; `Store.apply_deletion(chat_id: str | None, message_ids: list[str])` (`None` khi Telegram không gửi chat ID). Mọi `chat_id` là marked peer ID dạng chuỗi. Bridge dùng Store; network và SQLite không nằm trong UI handlers.

- [ ] Tạo CLI `uv run python -m telegram_dashboard login`; Telethon interactive login chỉ chạy ở terminal. Server dùng session có sẵn và `connect`/`is_user_authorized`, không gọi interactive `start()` từ HTTP handler. Xử lý expired/revoked session thành `login_required`.
- [ ] Tạo SQLite schema version 1 cho chats/messages/outbox/ai_permissions/changes và metadata bằng SQL, bật WAL/busy_timeout và foreign_keys mỗi connection. Metadata chứa db_epoch UUID giữ nguyên tới khi DB reset. Dùng duy nhất `<db_epoch>:<revision>` cho SSE id/Last-Event-ID/query cursor/snapshot_cursor/next_cursor; không phát revision-only ID. Telegram numeric IDs chuyển thành chuỗi ở DTO Pydantic v2. Operation sqlite3 chạy ngoài event loop, mỗi operation connection riêng, transaction ngắn. Mutation và change revision phải commit cùng nhau.
- [ ] Gắn handlers NewMessage/MessageEdited/MessageDeleted trước connect, bật catch-up; đặt `flood_sleep_threshold=0`, `request_retries=0`. Loại chat chưa chọn ngay trước ghi DB. Khi chọn nhóm, ghi mốc/baseline rồi nạp tối đa 50 tin; xử lý overlap giữa history và live qua cùng upsert.
- [ ] Tạo `GET /api/status`, `GET /api/chats`, `PUT /api/chats/{chat_id}/tracking`, `DELETE /api/chats/{chat_id}/data`. List dialogs chỉ lấy metadata nhóm; khi bỏ theo dõi dừng ingest và chặn send/AI ngay, xóa dữ liệu là thao tác riêng có xác nhận trên UI.
- [ ] Hỗ trợ text/caption và media kind; giữ sender/reply/topic. Upsert theo composite key, dùng edit timestamp để bỏ stale events; tombstone không bị resurrect bởi history/replay cũ. Xóa có chat xác định mới cập nhật trực tiếp. Với delete thiếu chat, chỉ đối chiếu message ID trong các nhóm thường (không phải channel) đang theo dõi, nơi ID duy nhất theo tài khoản; không chạm supergroup. Không khớp đúng một tin thì bỏ qua và ghi warning không chứa nội dung. Nhóm thường nâng cấp supergroup (migrate) thì đánh dấu đã chuyển, dừng ingest và báo UI chọn lại nhóm mới.
- [ ] Recovery dùng persisted Telethon session + history checkpoint riêng. Chụp upper bound trước scan, đọc tăng ID theo batch 100; lưu batch và tăng checkpoint trong cùng transaction. Live event không được tăng history checkpoint. Retry recovery sau handler/DB failure, không chỉ sau mất mạng; hiện degraded/syncing để tránh báo đã đủ dữ liệu. Không giới hạn giả 50 tin cho recovery; không hứa khôi phục mọi edit/delete cũ Telegram không cung cấp.
- [ ] Purge nhóm dừng tracking/tăng collection generation trước khi xóa; hủy pending outbox, xóa nội dung messages/outbox, vô hiệu AI grants. Tin xóa cũng purge bản sao nội dung outbox liên quan. Late callback/history batch phải kiểm tra generation trước commit. Với send in-flight chỉ giữ trạng thái/ID tối thiểu và thông báo có thể đã gửi; không hứa thu hồi tin Telegram hoặc forensic erasure.
- [ ] Regression tests: `test_untracked_chat_not_persisted`, `test_same_message_id_in_two_chats`, `test_replay_is_idempotent`, `test_stale_edit_does_not_overwrite_newer`, `test_old_history_does_not_resurrect_deleted`, `test_ambiguous_delete_does_not_touch_other_chat`, `test_basic_group_and_channel_ids_do_not_collide`, `test_migrated_group_stops_ingest`, `test_history_live_overlap`, `test_recovery_more_than_one_page`, `test_live_event_does_not_skip_history_gap`, `test_failed_batch_does_not_advance_checkpoint`, `test_purge_clears_outbox_content_and_blocks_late_callback`, `test_revoked_session_becomes_login_required`. Dùng fake Telegram transport vừa đủ cho những hành vi này.

**Verification:** `uv run pytest tests/test_storage_sync.py -q`, regenerate API types nếu DTO đổi. Live bước sau chỉ khi người dùng login: chọn một nhóm, đối chiếu vài tin mới bằng tài khoản thật; nhóm không chọn không xuất hiện trong DB. Không tạo tin để test nếu người dùng chưa chỉ định nơi được phép gửi.

## Phase 3 | API đọc, tìm và gửi reply có chống trùng

**Target files:** `telegram_dashboard/{models,storage,telegram,events,app}.py`, `tests/{test_send,test_events}.py`, generated API types.

**Interfaces:** `GET /api/chats/{chat_id}/messages?before=...&limit=50&q=...` trả trang cũ; `?after=...` trả tin mới; snapshot có snapshot_cursor cùng read transaction. `GET /api/changes?cursor=<db_epoch>:<revision>&limit=...` là change feed toàn cục cho mọi nhóm theo dõi (khớp last_applied_cursor toàn cục), trả tin mới/edit/delete, thay đổi cấp nhóm và next_cursor; không dùng revision trần; tombstone đủ đồng bộ UI. `GET /api/events` SSE nhận Last-Event-ID hoặc query cursor khi mở lại. `POST /api/messages/reply` nhận `{request_id, chat_id, reply_to_message_id, text}`; `GET /api/outbox/{request_id}` trả trạng thái.

- [ ] Chốt DTO và mã lỗi: `not_tracking`, `reply_not_found`, `not_connected`, `forbidden`, `retry_after`, `delivery_unknown`. Text reply chỉ cho 1–4096 UTF-16 code units; kiểm tra phía server, không nhầm với Python character count. Text search là parameterized query trong một nhóm đã chọn, không tìm qua dữ liệu bị xóa.
- [ ] Tạo outbox transaction với unique UUID và atomic pending-to-sending claim trước network. Reuse UUID cùng payload trả lại tác vụ cũ/202 nếu đang gửi; khác payload trả 409. Chỉ một task send của tài khoản chạy mỗi lúc. Sau purge đối chiếu hash metadata; không khôi phục nội dung để retry.
- [ ] Tạo `TelegramBridge.send_reply(chat_id: str, reply_to_message_id: str, text: str, random_id: int) -> SentMessage` bằng raw SendMessageRequest để giữ `random_id` từ outbox. Resolve peer quyền hiện tại; reply phải thuộc đúng chat và giữ root topic theo Telegram reply schema. Không bật Markdown parse mặc định.
- [ ] Ghi sent result qua cùng message upsert dùng cho outgoing events, chống history/event/API response trùng. FloodWait/SlowMode không tạo timer tự gửi; trả `retry_after`, kiểm chứng Telethon không tự sleep/retry. Timeout hoặc crash để `unknown`; retry theo yêu cầu người dùng dùng lại request/random_id, không tạo một UUID khác. Sau restart, `pending` chưa claim chuyển `failed` (chắc chắn chưa gọi Telegram), `sending` tồn đọng chuyển `unknown`. Reconcile chỉ qua RPC result hoặc Telegram random_id mapping nếu có; `RANDOM_ID_DUPLICATE` không có mapping vẫn unknown, không match theo text/thời gian và không tự tạo ID mới.
- [ ] Tạo SSE bằng native `fastapi.sse.EventSourceResponse`/`ServerSentEvent`. Event ID là cursor `<db_epoch>:<revision>` từ DB, payload metadata không text; snapshot và change pages trả cùng định dạng. Wakeup chỉ sau commit; heartbeat cũng kiểm tra revision để không mất thông báo. Replay batch từ DB, Last-Event-ID ưu tiên hơn query cursor; cursor sai/out of range/db_epoch thay đổi phát reset (collection generation là khái niệm riêng theo nhóm, không dùng để reset stream). Không giữ DB transaction khi chờ, hủy subscriber khi disconnect/logout/hết phiên. Headers chống cache/buffering, không thêm SSE dependency.
- [ ] Regression tests: `test_reply_to_other_chat_rejected`, `test_concurrent_same_uuid_one_rpc`, `test_same_uuid_changed_payload_conflicts`, `test_timeout_retry_reuses_random_id`, `test_restart_marks_inflight_unknown`, `test_restart_marks_unclaimed_pending_failed`, `test_random_id_duplicate_without_mapping_stays_unknown`, `test_flood_wait_does_not_auto_send`, `test_outgoing_event_and_response_deduplicate`, `test_utf16_limit_with_emoji`, `test_topic_reply_preserves_target`, `test_change_feed_contains_edits_and_deletions`.
- [ ] SSE regression tests: `test_no_event_before_commit`, `test_sse_replay_after_reconnect`, `test_last_event_id_precedes_query_cursor`, `test_reset_cursor_rebuilds_snapshot`, `test_old_epoch_resets_even_when_revision_overlaps`, `test_sse_requires_cookie`, `test_disconnect_releases_subscriber`, `test_heartbeat_recovers_missed_wakeup`. Dùng async stream test hữu hạn; không để test chờ stream vô hạn.

**Verification:** `uv run pytest tests/test_send.py tests/test_storage_sync.py tests/test_events.py -q`, `npm run api:types`, `npm run typecheck`. Kiểm tra SSE trực tiếp và qua Next dev proxy nhận từng event trước khi stream đóng, giữ kết nối/auto-reconnect tối thiểu 45 giây. Live send là check riêng có nhóm/tin do người dùng chỉ định; không coi fake RPC pass là đã gửi thành công tài khoản thật.

## Phase 4 | Web inbox dùng được hằng ngày

**Target files:** `web/src/app/{layout.tsx,page.tsx,globals.css}`, `web/src/components/*.tsx`, `web/src/components/ui/`, `web/src/hooks/*.ts`, `web/src/lib/{api,query-client}.ts`, `web/tests/inbox.spec.ts`, Playwright config, `README.md`.

- [ ] Làm Client Components cho unlock/setup và layout ba vùng: nhóm theo dõi; timeline + tìm kiếm; composer/panel AI. Tailwind v4 cho tokens/layout, shadcn/ui Base UI chỉ lấy components cần dùng. UI tiếng Việt, thời gian theo browser sau mount để tránh hydration mismatch; giữ group/reply target rõ ràng. Static shell không fetch private data khi build.
- [ ] Tạo API client dùng generated types, fetch tương đối `/api`, no-store và AbortSignal. TanStack Query keys gồm chat/search/cursor, cache chỉ RAM, local API queries dùng networkMode:"always" và safe GET retry tối đa một lần (auth lỗi không retry); state composer/selected chat dùng React. Không persist query cache/offline mutations, không cài Redux/Zustand.
- [ ] Lấy snapshot_cursor rồi mở một EventSource để drain changes theo batch khi có invalidation. Giữ last_applied_cursor riêng với SSE notification cursor; chỉ tăng sau khi changes apply thành công và luôn drain lại từ last_applied_cursor khi reconnect/refocus. Apply edits/deletes cả khi tin cũ hơn newest ID. Khi hidden/logout đóng stream, khi hiện lại mở với last_applied_cursor (đủ `<db_epoch>:<revision>`) và drain phần còn thiếu; reset xóa cache và snapshot lại. Untrack/purge xóa cache và hủy fetch cũ; đổi nhóm không hiện response cũ. Không background polling toàn inbox mỗi 2 giây.
- [ ] Dùng React text interpolation cho Telegram/AI, không dangerouslySetInnerHTML. Giữ vị trí cuộn khi tải trang cũ; chỉ tự cuộn khi ở cuối. Media placeholder không tự download. Không dùng dynamic chat route hoặc Next features không export được.
- [ ] Composer giữ một UUID cho một lượt gửi tới khi kết quả rõ; mutation cấu hình `retry:false`, `networkMode:"always"`, không pause để tự gửi khi online. Disable nút khi gửi, giữ draft khi lỗi; Enter xuống dòng, Ctrl/Cmd+Enter gửi. Unknown hiện nút kiểm tra/retry cùng request, không tạo request mới ngầm.
- [ ] Motion for React chỉ ở panel chuyển trạng thái/layout cần thiết; CSS cho hover và loading. Tôn trọng reduced-motion, duy trì focus khi mở/đóng dialog, không animate cả timeline gây nhảy scroll. Không thêm thư viện animation thứ hai.
- [ ] Hiển thị trạng thái kết nối, đồng bộ, giới hạn gửi, reply target đã xóa; các nút bỏ theo dõi/xóa dữ liệu có ý nghĩa tách biệt. Không gửi API qua URL khác origin hoặc lưu token trong localStorage.

**Verification:** `npm run typecheck`, `npm run lint`, `npm run build`; Playwright focused fixture flows cho đổi nhóm request chậm, SSE reconnect/edit/delete và REST drain lỗi sau notification không làm mất changes, đọc dữ liệu local khi browser báo offline nhưng FastAPI còn chạy, XSS text-only, duplicate click/offline không tự gửi, lỗi giữ draft và reduced-motion/focus/scroll. Test qua backend fixture độc lập, không thêm endpoint debug vào live app hoặc đăng nhập Telegram thật. Chụp màn hình chỉ dùng dữ liệu giả; không snapshot-test mọi shadcn component.

## Phase 5 | AI soạn nháp và tóm tắt có giới hạn

**Target files:** `telegram_dashboard/{ai,models,storage,app}.py`, `web/src/components/{ai-panel,composer}.tsx`, API types, `tests/test_ai.py`, `web/tests/inbox.spec.ts`, `.env.example`, `README.md`.

**Interfaces:** `POST /api/ai/draft` nhận `{chat_id, message_ids, instruction}`; `POST /api/ai/summary` nhận `{chat_id, message_ids}`. Trả `{text, source_message_ids, context_revision}`; không có send flag hoặc tool call. `PUT /api/chats/{chat_id}/ai-permission` tạo/thu hồi grants theo message ID/content hash, kèm scope, expiry và evidence references cho từng người liên quan; không có group-wide allow-all.

- [ ] Cho phép inbox chạy khi AI thiếu cấu hình; API trả `ai_not_configured`/`ai_scope_not_allowed` mà không gọi provider. Giải thích điều kiện dữ liệu trong UI setup; cơ chế enable là guard kỹ thuật, không phải chứng nhận pháp lý/consent tự động.
- [ ] Định nghĩa `is_ai_eligible(message, grant, now) -> bool`: tracked chat; đúng chat/message ID/content hash; chưa deleted; grant chưa hết hạn/thu hồi; scope bao phủ nội dung; danh sách người liên quan được xác định và mỗi người có evidence reference. Không tạo grant khi thiếu căn cứ hoặc cho forwarded content/media ở bản đầu. Message edit/delete tự vô hiệu grant. Đây là predicate kỹ thuật, không tự xác thực tính pháp lý của bằng chứng.
- [ ] Mỗi request chỉ đọc tối đa 30 message IDs cùng nhóm; mọi tin phải qua predicate ngay trước network, kiểm tra lại trước khi trả kết quả. Nếu thu hồi khi request đang chạy thì bỏ kết quả và giải thích dữ liệu đã dispatch không thể thu hồi từ provider. Từ chối context vượt giới hạn thay vì tự mở rộng sang nhóm khác. Giới hạn tổng context 16.000 ký tự và instruction 2.000; UI yêu cầu chọn ít tin hơn nếu vượt.
- [ ] Khi người dùng chọn provider/model, đối chiếu API/SDK stable chính thức trước khi pin contract. Baseline một endpoint Chat Completions-compatible qua httpx ở backend, timeout 30 giây, không tự retry/429; không tự nhận mọi Responses API hoặc mọi provider đều tương thích. AI_BASE_URL từ environment, browser không được chọn URL. Không cấp credentials/tools cho model, không raw prompt/response logs. Chưa cần LangChain/LangGraph/agent SDK khi chỉ draft/summary.
- [ ] Đưa draft vào composer để người dùng chỉnh/bấm gửi qua Phase 3. Nếu revision hoặc quyền context đã đổi trước lúc gửi, hiện cảnh báo draft có thể cũ; không tự gọi lại provider hay tự gửi.
- [ ] Regression tests: `test_disabled_ai_never_calls_provider`, `test_cross_chat_context_rejected`, `test_deleted_context_rejected`, `test_edited_content_invalidates_grant`, `test_missing_participant_evidence_rejected`, `test_expired_grant_rejected`, `test_context_limits_enforced`, `test_permission_revoked_during_request_discards_result`, `test_prompt_injection_cannot_send_or_access_secrets`, `test_provider_timeout_keeps_manual_reply_available`. Mock HTTP tại ranh giới provider, không gọi model bằng dữ liệu nhóm thật trong suite.

**Verification:** `uv run pytest tests/test_ai.py -q`, regenerate API types, typecheck và Playwright draft flow chứng minh không tự gửi. Demo bằng fixture giả trước; live context chỉ sau khi người dùng xác định cấu hình và điều kiện dữ liệu phù hợp.

## Phase 6 | Nghiệm thu và hướng dẫn vận hành

**Target files:** `README.md`, `docs/verification/local-web-smoke.md`; chỉ sửa code nếu có lỗi thực tế trong các gate.

- [ ] Ghi README từ clone sạch: chọn Node 24 LTS patch/Python 3.14, `uv sync --locked`, `npm ci`, cấu hình environment, `uv run python -m telegram_dashboard login`, `npm run build`, `npm start`; dev dùng `npm run dev`. Ghi rõ static export vẫn là Next.js/React tương tác, nhưng không có Next server runtime; API/cookie thuộc Python. Có quy trình unlock/logout/revoke session, không secrets thật.
- [ ] Chạy `uv run pytest -q`, `uv run ruff check .`, `uv pip check`, `npm run api:types`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` và kiểm tra types generated không drift. Kiểm chứng server start/stop không treo Telethon/SSE tasks; dev supervisor không để child process chạy sót. Chỉ chạy lại gate sau thay đổi/failure có liên quan.
- [ ] Browser smoke hoàn chỉnh với dữ liệu giả và ghi kết quả thật trong tài liệu nghiệm thu. Live checks tách thành hàng `pass/fail/not_run`, chỉ thực hiện khi người dùng login/chỉ định hành động gửi. Không ghi nội dung tin, số điện thoại hoặc secrets vào tài liệu.
- [ ] Kiểm tra `git diff --check`, `git status`, `git check-ignore` với path mẫu `.env`, `data/account.session`, `data/dashboard.sqlite3`, `.venv/`, `web/out/index.html`, `web/.next/`, `node_modules/`, Playwright traces. Review tracked files/build artifacts để chắc chắn không secrets hoặc dữ liệu thật. Commit theo phase nếu được yêu cầu hoặc workflow repo quy định; không push/deploy nếu chưa được yêu cầu.
- [ ] Nếu `.codegraph/` tồn tại khi kết thúc implementation thì chạy `codegraph sync`; nếu `WORKING-CONTEXT.md` tồn tại thì cập nhật Current Task/Key Changes/Affected Files/CodeGraph Status và giữ lịch sử. Repo hiện không có cả hai nên không tạo chỉ để đáp ứng bước này.

**Done:** Các tiêu chí trong spec đạt, hoặc giới hạn live test chưa thực hiện được ghi rõ. Không gọi kết nối/gửi thật là đã nghiệm thu nếu mới chạy fixture. Sau gate pass, dừng; desktop wrapper/VPS/media/agent tự động là phạm vi sau.

## Thứ tự và điểm dừng

| Phase | Kết quả có thể review | Gate |
|---|---|---|
| 1 | Next shell + Python API, dev/build local | Auth tests + export/proxy/types |
| 2 | Chọn nhóm và lưu/đồng bộ tin | Scope/storage/recovery tests |
| 3 | Đọc, tìm, reply qua API + SSE | Send/idempotency/replay tests |
| 4 | Next inbox và animation | Typecheck/lint/build + focused Playwright |
| 5 | AI draft/summary tùy chọn | AI scope/error tests |
| 6 | Chạy lại từ clone sạch, tài liệu đủ | Full focused suite + smoke evidence |

Điểm dừng sớm có giá trị: Phase 4 hoàn thành là có inbox và trả lời thủ công, dùng được độc lập với AI. Thông tin cần người dùng cung cấp khi thực thi live: Telegram credentials nhập local, nhóm theo dõi, nơi được phép gửi thử; provider/model/key và phạm vi dữ liệu đủ điều kiện chỉ cần trước live AI. Không cần các thông tin này để bắt đầu coding/test fake.
