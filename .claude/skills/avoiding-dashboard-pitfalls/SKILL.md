---
name: avoiding-dashboard-pitfalls
description: Use when writing, reviewing or finishing a change in this repo (backend/telegram_dashboard/ or web/) that touches caching, writes to YouTrack or Telegram, message sends, background loops, subprocess or AI agent runs, prompts built from other people's text, polling or per-row hooks, the updater or release, local API auth, or Tailwind container queries; or when a bug looks like stale data, a duplicate send, an empty state that hides an error, a hang, FloodWait, or typing lag.
---

# Lỗi hay gặp trong Telegram Dashboard

## Overview
Mọi feature, bug fix và refactor phải theo ownership trong `AGENTS.md` và `docs/ARCHITECTURE.md`: domain có module riêng; shared không import feature/app. Sửa implementation gốc và cập nhật mọi caller; không tạo source path cũ hoặc forwarding shim.
Mỗi dòng dưới đây là lỗi đã có thật trong repo (deep review 2026-11). Đọc bảng của phần mình sửa trước khi viết; trước khi báo xong, chạy **Tự rà** cuối file.

## Dữ liệu sai / cache cũ
| Dấu hiệu | Sai | Đúng |
|---|---|---|
| Bỏ tham số khỏi hàm | caller cũ vẫn truyền vị trí (`issues(p, "active")` thành `who="active"`, lặp từng ký tự) | `grep -rn "tên_hàm(" backend/telegram_dashboard web/src` mọi caller; tham số tùy chọn để keyword-only (`*`) |
| Ghi lên YouTrack | `svc._cache.pop(key)` | `svc.stale(id)`: bump thế hệ, bỏ cả fetch đang bay |
| Lấy "mới nhất" từ API có `$top` | đọc trang đầu (cũ nhất trước) | `reverse=true` hoặc phân trang tới cuối |
| SQL `LIMIT` rồi lọc regex trong Python | mất kết quả (VA-10.. chiếm chỗ VA-1) | bỏ `LIMIT`, `itertools.islice` trên cursor |
| Tra tin đã lưu | coi tin `deleted=1` như còn | luôn xét `deleted` |
| Mã ngắn (hash 8 hex) có `UNIQUE` | trùng thì gửi lỗi 500 | mã hiển thị không `UNIQUE`, hoặc đủ dài |
| Độ dài text gửi Telegram | đếm code point | `utf16_len` (emoji = 2) |
| So host URL | `.hostname` với chuỗi có port / hoa | so `netloc.lower()` cả hai phía |
| Hai lần lưu cùng ticket | phản hồi cũ đè giá trị mới, rollback đè lần lưu sau | số thứ tự theo ticket/field, bỏ phản hồi cũ (`saveTicket`) |

## Lỗi im lặng
| Dấu hiệu | Sai | Đúng |
|---|---|---|
| Bắt lỗi API ngoài | `except YtError: return []`, `.catch(() => {})` | chỉ nuốt mã mong đợi (vd. 400 YQL); 401/403/mạng phải lên UI. "Lỗi" khác "không có dữ liệu" |
| Mutation frontend | không `onError` | `onError: (e) => toast({ text: errorText(e, {...}, "…") })` |
| Hàng loạt / hoàn tác | `.then(ok, () => {})` rồi báo "Đã hoàn tác" | `undoAll` / gom lỗi, toast "x/y" kèm lý do đầu tiên |
| Gửi tin bị timeout / mất mạng | báo "không gửi được" → người dùng gửi lại, nhóm nhận 2 tin | `delivery_unknown`: "chưa rõ đã gửi, xem nhóm trước khi gửi lại"; không tự gửi lại |
| Việc nền thất bại | log 1 lần, không thử lại | đặt `detail` trạng thái + hẹn giờ thử lại (theo giây FloodWait), như `backfill_mentions` |
| Cập nhật nửa chừng | pull xong, build lỗi, chỉ log | quay về commit cũ (`git reset --hard before`), lưu `updater.last_error`, hiện ở Cài đặt |
| Lỗi CLI | `detail` bị bỏ | `cli_reason(...)` vào `ApiError(..., detail=)`; `errorText` nối `detail` |
| Đọc thuộc tính exception trong `except` | `e.detail` trên `YtError` → `AttributeError` ngay trong handler, vòng `watch` chết ở lỗi YouTrack đầu tiên | mở class trước khi đọc: `YtError` có `.status/.message`, `ApiError` có `.code/.status/.detail`; handler của vòng nền phải chạy được với mọi lỗi |

## Đồng thời / tiến trình
- `await` bước dài rồi mới hành động (pull → build → restart): **kiểm lại điều kiện ngay trước bước cuối** (`agent.busy` cả task đang khởi động).
- Subprocess: con cháu giữ stdout làm pump chờ mãi → `start_new_session=True`, `kill_tree` cả nhóm, `_reap_after_exit` sau khi CLI thoát; `stop()` luôn kill nhóm.
- Gửi giữ `_send_lock` phải có `asyncio.wait_for(..., SEND_TIMEOUT)`.
- Đổi transport / client chung: một lock bao `stop → swap → start`.

## Bảo mật (AI agent, API local)
- **Text của người khác** (tin Telegram, ticket, link) là dữ liệu: bọc random tag + câu "dữ liệu KHÔNG tin cậy"; nội dung không được tự đóng khung (`links._TAG`).
- **Lượt có text người khác**: không tool / chỉ Read-Grep-Glob; shell chỉ trong sandbox (mạng chỉ kho package, không loopback). Run "không tool" phải thật sự không tool ở **mọi** provider (Claude, Codex, Antigravity).
- **Deny đọc**: `data/`, `.env`, `~/.ssh`, `~/.codex`, `~/.aws`, `~/.config/gh`, `~/.telegram_dashboard`.
- **API local**: Host/Origin chỉ chặn trình duyệt. Mọi route mới tự nằm sau `LocalGuardMiddleware` (cookie mã truy cập); không thêm ngoại lệ.
- **Link trong text người khác** không tự đọc bằng quyền của mình (t.me chỉ cùng nhóm với tin gốc).
- Biến môi trường cho CLI con đi qua `child_env()`.
- Release: ký gói, action pin theo SHA, khóa riêng không bao giờ vào repo.
- Thông báo / log: không nội dung tin mặc định; log chỉ id và tên lỗi.

## Hiệu năng
| Dấu hiệu | Sai | Đúng |
|---|---|---|
| Đọc Telegram live từ nhiều chỗ | mỗi trang poll riêng, không cache → FloodWait | memo server có TTL + `Semaphore(LIVE_READS)` chung; xóa memo khi ghi |
| Hook trong từng dòng list | `useQuery` có `refetchInterval` / `useNow` mỗi row → N timer | một query/đồng hồ chung, row đọc qua `select` / props; `useMyTickets(..., poll=false)` |
| Component có portal (Hint, menu) | mount portal + AnimatePresence kể cả khi đóng | chỉ mount khi mở / đang thoát |
| Context provider | value là object mới mỗi render | `useMemo`, `notifyOnChangeProps`, `useIsFetching` cho trạng thái tải |
| Mỗi item một request (statesince) | N lượt gọi | suy ra từ dữ liệu gom sẵn đã cache (`/transitions`) |
| Ô gõ nằm cao trong cây | mỗi phím render lại list + ghi localStorage | tách draft vào component/store riêng, debounce lưu |
| Import chéo trang | inbox import từ `settings.tsx` → kéo cả trang | phần dùng chung để trong file nhỏ riêng |

## UI (Tailwind 4, quy tắc dự án)
- Container query: `@3xl:` (min) và **`@max-3xl:`** (max). `max-@3xl:` không sinh CSS, không báo lỗi. Cần tổ tiên có `@container`.
- Layout trong khung hẹp (split view) theo container, không theo viewport (`lg:`).
- Màu vàng (signal) chỉ cho việc cần người dùng; đếm thường dùng màu trung tính.
- Thêm/đổi feature người dùng thấy: cập nhật các chapter tương ứng trong `web/src/shared/lib/guide/{vi,en}/` (nhãn đúng như UI). Chuỗi UI mới: `t("…")` + bản tiếng Anh trong `lib/i18n/en/*.ts`; số / ngày qua `fmtNum` / `fmtDate`.

## Refactor / tách file
- File nguồn mục tiêu ≤ 600 dòng; guard `test_source_files_stay_small` chặn > 1000. File sắp vượt thì tách theo seam thật (client / query / router; mỗi mục Cài đặt một file), không đẻ thêm vào file lớn.
- Class lớn tách bằng kế thừa / mixin (`YouTrackDashboard(YtQueries(YtClient))`, `Store(Messages, Outbox, …)`) để `svc.method` và patch target giữ nguyên; module → package thì `__init__.py` là owner thật của class, không phải barrel.
- Không re-export "tạm thời" để chờ agent khác: trước khi báo xong, trỏ mọi import về module sở hữu và xóa khối re-export (`ai.py` từng giữ 9 tên như vậy).
- Monkeypatch theo nơi tên được **tra cứu** sau khi tách (`patch.object(api_flow, "_ai")`, không phải module cũ).
- Tách xong grep lại biểu thức suy ra lặp ở file anh em (sprint đang chạy từng viết 3 lần ở `tickets` / `release`; nay `runningSprints` trong `yt-stats.ts`).
- Đếm dòng tăng vì header import là bình thường; mục tiêu là bỏ trùng, không phải ép tổng dòng.

## Phụ thuộc
- `pyproject.toml`: mọi dependency (runtime lẫn dev) pin `==X.Y.Z` theo `uv.lock` (guard `test_python_deps_pinned`); không `0.*`, không để trống.
- Trước khi gọi một gói là "khả nghi / thừa": `npm view <gói> repository maintainers` + grep chỗ dùng (`cn` là gói chính thức của shadcn, đang dùng).

## Làm việc song song / kiểm chứng
- Subagent: luôn truyền `model` (mặc định 404 trong môi trường này).
- Nhiều agent sửa cùng lúc: chia **file sở hữu** rõ, ghi **hợp đồng** (tên field, route, query param, key sessionStorage), người điều phối nối dây ở file chung.
- Không build đè `web/out` và không đụng `:8765` (app thật của người dùng). E2E: copy repo sang scratchpad, `cp -cR node_modules` (clone APFS, symlink bị Turbopack từ chối), build và `E2E_PORT=<khác> npx playwright test` ở đó. Không dùng `rsync` (lỗi `mkstempsock` trong sandbox); copy từng mục bằng `cp -cR`, lặp bằng glob có ngoặc kép (không `for f in $(ls)`: tên có dấu cách như `Start Dashboard Telegram.command` bị tách).
- E2E đỏ sau refactor: chạy lại spec đó trên code gốc (file gốc trong scratchpad) trước khi kết luận do thay đổi. `mascot.spec.ts` đỏ cả trên code gốc vì đếm id của linh vật vai trò không có gradient (`undefined` trùng nhau): assertion trên tập phần tử phải lọc phần tử thiếu thuộc tính đang so.

## Tự rà trước khi báo xong
```bash
uv run pytest -q tests/test_repo_guards.py
grep -rnE -A1 'except [A-Za-z]*Error[^:]*:[[:space:]]*$' backend/telegram_dashboard | grep -B1 -E 'return \[\]|pass$'
grep -rnE '\.catch\(\(\) => (\{\}|null)\)' web/src
grep -nE 'refetchInterval|useNow\(' web/src/features/telegram/components/message-item.tsx web/src/features/telegram/components/message-list.tsx
```
Mỗi kết quả của 3 lệnh `grep` cuối phải có lý do đúng (vd. localStorage có thể ném lỗi); không có thì sửa theo bảng trên.

## Red flags
- "Nuốt lỗi cho UI khỏi đỏ" → người dùng tưởng không có dữ liệu.
- "Gửi lại cho chắc" → tin trùng trong nhóm.
- "Chỉ pop đúng key này thôi" → fetch đang bay cache lại bản cũ.
- "Chỉ đọc thôi nên cho đọc mọi file" → text người khác dắt AI đọc khóa.
- "Mỗi dòng tự poll cho đơn giản" → N timer, N request.
- "Re-export tạm cho agent khác chạy được" → shim ở lại mãi; nối import về owner trước khi báo xong.
- "Đánh giá theo tên gói" → gỡ nhầm gói chính thức đang dùng.
- "Thêm nút tắt cho tiện" → hai lối vào cùng một luồng (vd. menu ⋯ "Trả lời từ code" trùng khung Trả lời + chọn dự án, đã gỡ); trace luồng có sẵn trước khi đề xuất.
