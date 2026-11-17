# Review cấu trúc và refactor hiệu năng — 14/11/2026

> Cập nhật sau review: đã thực hiện tách thư mục Telegram, YouTrack, backend và shared theo yêu cầu tiếp theo. Xem [cấu trúc hiện tại](../ARCHITECTURE.md) và kết quả tái cấu trúc cuối tài liệu. Các mô tả ở phần đầu là snapshot trước đợt di chuyển.


Phạm vi: kiến trúc backend Python, đường đọc Telegram/SQLite và tài nguyên dùng chung frontend. Review dựa trên CodeGraph, import graph và kiểm tra các luồng liên quan; đây không phải audit bảo mật toàn bộ hoặc benchmark tốc độ trên dữ liệu thật.

## Cấu trúc hiện tại

| Vùng | Trách nhiệm hiện tại | Nhận xét |
| --- | --- | --- |
| `telegram_dashboard/app.py` | Composition root, lifespan, HTTP handlers, một số điều phối nghiệp vụ | Trước refactor 1.415 dòng, phụ thuộc 21 module nội bộ. Nên giữ wiring ở đây, tiếp tục đưa policy/cache sang service theo luồng cụ thể. |
| `telegram_dashboard/storage.py` | SQLite schema/migration, truy vấn và transaction | 1.919 dòng trước refactor. Đã có connection theo thread, WAL/NORMAL và index phục vụ danh sách; tránh thêm repository hierarchy chỉ để chia file. |
| `telegram_dashboard/telegram.py` | Bridge và transport Telegram | Giữ quản lý kết nối/gửi tin ở đây; cache dùng bởi các API đọc thuộc service riêng. |
| `telegram_dashboard/ai.py`, `providers.py`, `agent.py` | Prompt, provider policy, subprocess và vòng đời AI | Ranh giới policy/execution còn lẫn; thay provider hoặc quyền tool có blast radius lớn. |
| `telegram_dashboard/yt_dashboard.py` | Service YouTrack, cache, job và router | 2.146 dòng; tập trung nhiều trách nhiệm nhưng đã có service/cache dùng chung. |
| `web/src/components/`, `web/src/lib/`, `web/src/hooks/` | View, helper/state và data hooks | Có component lớn; một số view import cả module chứa UI lẫn hook. Nên đo bundle trước khi tách lazy loading. |

Kích thước file là tín hiệu bảo trì, không tự chứng minh điểm nghẽn runtime. Không đổi framework hoặc thêm dependency trong đợt này.

## Đã refactor

### 1. Tách đọc Telegram khỏi HTTP handler

`telegram_dashboard/live_reads.py` sở hữu TTL cache, giới hạn đồng thời và vòng đời các lượt đọc Q&A/member. `app.py` gọi service thay vì tự giữ các dictionary cache và triển khai cơ chế đọc.

- Cùng key đang đọc được chia sẻ giữa các request. Trước đây hai cache miss đồng thời đều gọi Telegram.
- Q&A giữ TTL 30 giây, danh sách member giữ TTL 300 giây; cache tối đa tương ứng 100 và 50 key, loại từng mục thay vì xóa trắng khi đầy.
- Q&A/Briefing giữ chung giới hạn 4 lượt đọc; popup member có lane riêng để không chờ polling.
- Hủy một HTTP waiter không hủy lượt đọc mà waiter khác đang dùng. Lifespan hủy và đợi các task còn lại trước khi dừng bridge.
- Gửi Q&A làm mất hiệu lực tất cả khoảng ngày của nhóm đó. Kết quả đọc cũ đang chạy không thể ghi lại cache sau invalidation.
- Lỗi được truyền lên caller, không cache như dữ liệu rỗng.

Regression tests kiểm tra gộp request, TTL, key theo nhóm, cancellation, invalidation trong lúc đọc, retry sau lỗi, giới hạn đồng thời và shutdown. Các test API hiện có kiểm tra hành vi Q&A/member tích hợp.

### 2. Gom truy vấn cây reply theo từng tầng

`storage.py:_tags_under` truy vấn theo frontier và chat, chia mỗi batch tối đa 500 ID. Trước đây mỗi node có một truy vấn tìm con và một truy vấn kiểm tra tag. Cách mới giảm số lần thực thi SQL trong transaction ghi của các thao tác đánh dấu hoàn tất.

Đo bằng SQLite trace trên cây giả lập 421 node: **842 xuống 4 SELECT**. Đây là phép đo số query, không phải cam kết tốc độ trên dữ liệu production. Đồ thị sâu hoặc nhiều chat có mức giảm khác.

Giữ nguyên giới hạn độ sâu, chống chu kỳ, cô lập theo chat và việc đi xuyên qua tổ tiên outgoing/deleted để tìm tag hợp lệ bên dưới. Test thêm frontier vượt giới hạn biến SQLite cũ.

### 3. Tách đồng hồ dùng chung của frontend

`web/src/lib/clock.ts` sở hữu một timer phút và một listener `prefs`. `useNow` trong `inbox.ts` giữ API cũ và đăng ký vào đồng hồ chung. Tài nguyên được dọn khi consumer cuối unmount.

Trước đây mỗi consumer tạo timer/listener riêng; có 46 vị trí gọi tĩnh được CodeGraph ghi nhận, không đồng nghĩa 46 consumer cùng mount. Message list đã truyền `now` từ cha xuống row nên không sửa lại luồng đó.

Test subscription trực tiếp kiểm tra nhiều consumer, tick, đổi preference, cleanup một phần/toàn bộ và đăng ký lại. Chưa đo FPS, thời gian render hoặc heap của app thật.

## Các vấn đề còn lại

Các mục này tồn tại trước refactor, được ghi nhận riêng để tránh trộn thay đổi hành vi vào tối ưu cơ chế đọc.

1. **P2 — Digest có thể biến lỗi đọc thành “chưa có phản hồi”.** `digest.py:_read_all` bắt mọi exception và trả danh sách rỗng; `_scan` cache kết quả. Nên trả trạng thái lỗi từng nhóm cho UI, giữ các nhóm đọc thành công. Cần sửa đồng thời hợp đồng API/UI và test lỗi mạng/quyền/FloodWait.
2. **P2 — Phụ thuộc vòng làm khó tách module và test độc lập.** Phân tích AST của 30 module Python ghi nhận hai strongly connected component: `ai/providers/storage/uiflow/zeplin` và `agent/links/yt_dashboard`. Phân tích này bao gồm import bên trong hàm; không kết luận tất cả là lỗi import runtime. Các cạnh đáng chú ý: `providers` lấy AppleScript helper từ `ai`; `zeplin` lấy metrics từ `ai`; `links` lấy helper private từ `yt_dashboard`. Nên chuyển helper về module sở hữu đúng trách nhiệm và cho các consumer dùng chung, theo từng cạnh và test tương ứng.
3. **P2 — Policy chạy AI và execution còn chung service.** `AiService.ask` quyết định provider/model/tool/env/retry, trong khi `_run` quản subprocess/stream/cancel/metrics. Hướng tiếp theo: tách phần xây dựng kế hoạch chạy thành hàm thuần nhỏ, giữ nguyên public API và lifecycle; không thêm registry hay DI framework. Cần test ma trận provider và quyền tool vì đây là ranh giới nhạy cảm.
4. **P3 — View lớn và import sớm.** `inbox.tsx` import các view Today/Digest/Tasks và module vừa chứa view vừa chứa hook. Settings có route riêng; ticket sheet đã lazy. Cần bundle report trên bản build scratch trước khi chọn ranh giới lazy loading và tách hook khỏi view. Không có bằng chứng để khẳng định đây đang là nguyên nhân làm chậm trang.

## Nguyên tắc phát triển tiếp

- `app.py` giữ wiring/HTTP; policy đọc và vòng đời cache nằm ở service chịu trách nhiệm.
- `storage.py` giữ truy vấn/transaction; không đưa provider AI hoặc HTTP vào đường truy vấn thường xuyên.
- Module hạ tầng không import helper từ service cấp cao. Khi có vòng phụ thuộc, sửa ownership của helper trước khi chia thêm thư mục.
- State/timer/query dùng chung đặt trong module nhỏ; view dùng hook hoặc props. Tách feature khi có ranh giới dữ liệu và vòng đời rõ.
- Tối ưu bằng số query/request/timer hoặc profile; không suy ra hiệu năng từ số dòng hay số thư mục.

## Xác minh

- `uv run pytest -q`: **365 passed**, gồm repo guards.
- `uv run ruff check telegram_dashboard tests`: pass.
- Ruff toàn repo: 10 lỗi có sẵn tại `web/tests/fixture_server.py` (9 E501, 1 B905); file này không thay đổi.
- `npm run typecheck`, `npm run lint` và clock regression (1/1): pass.
- Review độc lập kiểm tra cancellation/invalidation/shutdown và consumer của kết quả cây reply: không phát hiện regression.
- Không build đè `web/out`, không restart app ở `:8765`, không gửi tin Telegram/YouTrack thật. Browser QA và benchmark end-to-end chưa thực hiện.

CodeGraph: sync thành công (index đã cập nhật bởi watcher). Repo không có WORKING-CONTEXT.md. Thay đổi đang ở working tree, chưa commit/push.

## Kết quả tái cấu trúc theo domain

- Di chuyển Python vào `backend/telegram_dashboard`; Telegram có `bridge`, `routes`, `digest`, `qa`, `live_reads`; YouTrack có `service`, `routes`, `flow`, `flow_prompt`, `flow_jobs`.
- `app.py` từ 1.415 dòng trước các đợt refactor còn 723 dòng; HTTP endpoint nghiệp vụ thuộc router domain, cùng getter/setter cấu hình. Không dùng shim cho module cũ.
- Di chuyển 116 file frontend theo mapping; source phân vào `features/{telegram,youtrack,settings}`, `shared`, `app/_components`. Tách helper trung lập khỏi inbox, đưa adapter Mention về feature; shared không import feature/app.
- Cập nhật toàn bộ import, test/patch target, Hatch/uv, script đóng gói, public signing key trong CI, API type generation, shadcn aliases và tài liệu đang dùng.
- Giữ `.env`, `data/`, `web/out` ở gốc checkout và layout release `app/telegram_dashboard` cạnh `app/web/out`.

Xác minh cuối:

- Backend: **367 tests passed**; `uv run ruff check .` pass, kể cả fixture đã sửa các lỗi lint cũ.
- Frontend: typecheck và lint toàn bộ pass. Production static build pass trên bản copy `/tmp/dashboard-domains-jvJ8Nn`; có đủ trang Telegram, YouTrack, Settings.
- Browser/fixture: **45/46 pass** ở lượt đầu (Telegram inbox, UI flow dialog, clock/time/verdict); ca AI draft/follow-up còn lại **pass khi chạy lại riêng**. Không khẳng định suite ổn định 46/46.
- Lỗi flaky được truy nguyên: `tasks.py:task_events` có thể chụp log trước dòng result nhưng trả `running=false` sau khi job kết thúc, làm UI ngừng poll. Hàm này có AST giống HEAD trước refactor; không đổi hành vi đó trong đợt di chuyển. Hướng sửa riêng: chụp running trước/sau lượt đọc và giữ true thêm một poll nếu job đang chạy lúc bắt đầu snapshot; regression test nên chặn snapshot rồi cho job kết thúc.
- OpenAPI so sánh chính xác trước/sau: **98 paths không đổi**, cả ở source và khi import từ wheel đã giải nén theo layout release.
- Wheel build pass; smoke kiểm tra package/domain imports, runtime root, static path và public signing key pass. Chưa tạo/chạy installer macOS/Windows hoặc release.
- Review chéo độc lập không phát hiện regression trong helper extraction, mention adapters, settings root, router ordering, middleware hoặc packaging paths.
- `git diff --check` pass; CodeGraph sync thành công. Không restart app thật, không gửi Telegram/YouTrack thật, chưa commit/push.

## Sửa race kết quả cuối của AI — sau tái cấu trúc

Race `task_events` ghi nhận ở trên đã được sửa trong `backend/telegram_dashboard/tasks.py`: chụp trạng thái chạy trước khi đọc log, giữ polling nếu lượt AI đang chạy tại thời điểm bắt đầu hoặc sau khi đọc. Khi lượt AI kết thúc giữa snapshot, client được đọc thêm một lần để lấy result cuối. Comment tại `useTaskLog` đã được sửa cho đúng hợp đồng này.

- `tests/test_task_events.py` tái hiện có kiểm soát bằng side task thật và snapshot bị giữ đến khi lượt AI hoàn tất, không dùng sleep để đoán timing. Cả success/error/cancel đều fail trước sửa và pass sau sửa; poll kế tiếp nhận result cuối và dừng.
- 94 tests tập trung (task events, agent, AI, inbox, repo guards) pass. Ruff toàn repo và diff check pass.
- Ca Playwright hỏi AI draft rồi hỏi tiếp trong cùng session pass **3/3 lượt độc lập**, mỗi lượt có fixture mới tại scratch `/tmp/dashboard-domains-jvJ8Nn`, port8876/control8899. Dùng static build đã kiểm tra ở đợt tách cấu trúc; frontend lần này chỉ đổi comment.
- Chưa restart app thật hoặc kiểm tra provider AI thật; chưa commit/push.
