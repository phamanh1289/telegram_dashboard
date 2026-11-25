# Telegram Dashboard — tổng quan review và kế hoạch cải tiến

Ngày tổng hợp: **13/11/2026**. Phạm vi: Telegram Dashboard, backend Python, frontend web, tích hợp Telegram/YouTrack/AI CLI và quy trình release.

Tài liệu này gộp kết quả review, các việc cần làm, chi tiết triển khai, tác động (effect), rủi ro (risk) và trạng thái trước/sau dự kiến. Đây là backlog đề xuất; **các thay đổi trong backlog chưa được triển khai**. Những số đo và kết quả test bên dưới thuộc lượt review trước trong cùng cuộc trao đổi, không phải kết quả sau cải tiến.

## 1. Nhận định tổng quan

Dự án đã tạo được luồng xử lý công việc từ Telegram tới Q&A, Briefing, đối chiếu BE/code, AI Agent và YouTrack. Hôm nay và Luồng việc đã nối các phần này với nhau. Hướng phát triển có giá trị nhất là làm cho kết luận có thể kiểm tra lại, công việc không bị bỏ sót và quyền tự động hóa có phạm vi rõ ràng.

Thứ tự ưu tiên:

1. Bảo vệ dữ liệu, giới hạn quyền AI và bảo đảm commit đúng phần được duyệt.
2. Hiển thị đúng độ đầy đủ của dữ liệu và trạng thái công việc.
3. Giảm I/O, payload và các lượt đọc Telegram trùng nhau.
4. Mở rộng feature trên Hôm nay, Q&A, Đối chiếu BE và Release đang có.
5. Chỉ mở rộng tự động hóa sau khi quyền, checkout và hàng đợi đủ tin cậy.

### 1.1. Giải pháp hiện tại và hướng cải tiến

Catalog hướng dẫn có 176 mục thao tác, không tương đương 176 feature độc lập.

| Nhóm | Đang có | Khoảng trống cần xử lý | Hạng mục |
|---|---|---|---|
| Hôm nay / Luồng việc | Gom tag, ticket rủi ro, Q&A, phiên AI, Báo lại và Briefing thành chuỗi theo ID; chia việc chờ bạn và bạn đang chờ | Cần hành động tiếp theo rõ hơn, lý do ưu tiên, độ mới và độ đầy đủ của nguồn | R02, F03 |
| Inbox / trả lời | Nháp theo tin, mention, ngữ cảnh, outbox, snooze theo thời gian/câu trả lời/ticket, xử lý chưa rõ đã gửi | Cần dẫn người dùng kiểm tra đúng tin khi delivery_unknown, tránh gửi trùng | F06 |
| Q&A | Mã câu hỏi, chuỗi trả lời, nhắc việc, chốt câu trả lời; Done/Xóa lưu backend | Một số state còn theo trình duyệt; giới hạn quét và 8 nhóm gần đây ảnh hưởng khả năng theo dõi | R02, F01 |
| Briefing / Đối chiếu BE | Tóm tắt có nguồn, quyết định, thay đổi, việc mở, đọc phần mới, chuyển câu trả lời sang AI | Kết luận thiếu phiên bản nguồn; việc mở phụ thuộc cửa sổ tóm tắt; dấu đã đối chiếu cần thể hiện đúng trạng thái | R03, R04, F02 |
| AI Agent | Phân tích/cho sửa, hỏi tiếp, hàng đợi, kết quả, diff, PR, tự nhận câu trả lời BE theo rule | Phạm vi đọc/shell theo provider, commit cùng checkout, quyền sửa kéo dài và hàng đợi trong RAM | S01, R01, R04, A01 |
| YouTrack | Dev/QA/PO, bảng/board, bulk/undo, dashboard, QC/lead time/sprint, báo cáo, AI, Báo lại | Cần bằng chứng bàn giao và dữ liệu đầy đủ hơn; danh sách lớn cần đo hiệu năng | R02, P04, F04 |
| Vận hành / release | Đóng gói, checksum, chữ ký release, action pin theo SHA | Workflow release chưa chạy đủ các kiểm tra đang có trước phát hành | R05 |

### 1.2. Các nền tảng nên giữ

- Local API có Host/Origin/Sec-Fetch-Site và cookie token; response API có no-store.
- Outbox không tự gửi lại khi kết quả giao tin chưa xác định.
- SQL dùng placeholder; file dữ liệu có giới hạn quyền; CLI con có lọc biến môi trường.
- Text bên ngoài được đóng khung như dữ liệu; digest kiểm lại consent trước khi lưu.
- SQLite có WAL, transaction, connection theo thread và I/O qua thread pool.
- YouTrack dùng lại HTTP client, TTL cache, single-flight và generation chống cache cũ.
- SSE có revision cursor, reconnect và cập nhật cache cho edit.
- Release có checksum, chữ ký và GitHub Action pin theo SHA.

Các lớp này là nền tốt. Chúng không thay thế kiểm thử quyền thực tế hoặc kiểm chứng luồng đầu cuối.

### 1.3. Cách hiểu mức độ và bằng chứng

| Nhãn | Ý nghĩa |
|---|---|
| P1 | Xử lý trước khi mở rộng tự động hóa hoặc phát hành rộng hơn |
| P2 | Xử lý trong chu kỳ cải tiến gần nhất |
| P3 | Chỉ làm khi có số đo hoặc nhu cầu cụ thể đủ mạnh |
| Đã tái hiện | Đã chạy probe bằng dữ liệu giả trong scratch và quan sát hành vi |
| Thấy trong code | Đường xử lý thể hiện rủi ro; chưa chứng minh toàn bộ tác động bằng phiên thật |
| Đề xuất | Hướng sản phẩm/kỹ thuật, chưa triển khai và chưa có số đo sau cải tiến |

P1/P2/P3 là thứ tự xử lý của đợt review, không phải CVSS. Độ lớn Nhỏ/Vừa/Lớn là tương đối, chưa phải estimate ngày công. Các quyết định sản phẩm ghi trong tài liệu là đề xuất để chốt khi triển khai.

## 2. Danh sách việc cần làm

Tất cả hạng mục dưới đây có trạng thái **Chưa triển khai**. Một số là việc phải sửa; một số là bước phát triển có điều kiện.

| ID | Việc | Loại | Ưu tiên | Căn cứ | Độ lớn | Phụ thuộc chính |
|---|---|---|---|---|---|---|
| S01 | Chuẩn hóa quyền AI theo provider và hệ điều hành | Security | P1 | Code + tài liệu chính thức; chưa pentest | Vừa–lớn | Không |
| S02 | Xóa dữ liệu nhóm bao gồm dữ liệu dẫn xuất | Privacy / lifecycle | P1 | Đã tái hiện prompt/log còn sau purge | Vừa–lớn | Chốt chính sách phiên chứa nhiều nhóm |
| S03 | Dùng chung chính sách preview notification | Privacy | P2 | Thấy trong code | Nhỏ | Không |
| R01 | Ngăn commit gom sửa tay; cô lập phiên sửa | Data integrity | P1 | Đã tái hiện ở repo giả | Vừa–lớn | Không |
| R02 | Báo độ đầy đủ và phân trang các nguồn bị giới hạn | Correctness | P2 | Thấy cap và kiểu response trong code | Vừa | Không |
| R03 | Giữ việc Briefing mở độc lập với cửa sổ summary | Reliability | P2 | Thấy giới hạn carry trong code | Vừa | Phối hợp mô hình nguồn của F02 |
| R04 | State AI có cấu trúc và badge đúng nghĩa | Correctness | P2 | Parser/hiển thị hiện tại trong code | Vừa | Không |
| R05 | Gate test/lint/typecheck và kiểm tra bảo vệ trước release | Release quality | P1 | Workflow hiện tại | Nhỏ–vừa | Mở rộng cùng các fix P1 |
| R06 | Tách module theo phần thay đổi thực tế | Maintainability | P3 | Cấu trúc và kích thước file | Từng phần nhỏ | Chỉ khi sửa luồng liên quan |
| P01 | Đọc log AI theo cursor/offset | Performance | P2 | Đã đo log giả | Vừa | Không |
| P02 | Giảm payload và số lượt đọc file của task list | Performance | P2 | Đường đọc hiện tại trong code | Vừa | Phối hợp R04 |
| P03 | Limiter Telegram dùng chung, TTL và single-flight | Performance / reliability | P2 | Đã tái hiện 12 calls với 3 requests | Vừa | Không |
| P04 | Đo frontend; windowing khi có bằng chứng | Performance | P3 | Render thêm nhưng giữ DOM cũ | Đo: nhỏ; sửa: tùy số đo | Có baseline UI |
| F01 | Đồng bộ state Q&A và nhóm theo dõi | Improve feature | P2 | State local và 8 nhóm gần đây | Vừa | Phối hợp R02 |
| F02 | Kết luận có phiên bản và độ mới của bằng chứng | New feature | P2 | Khoảng trống trên luồng đã có | Vừa–lớn | R04; phối hợp F01, R03 |
| F03 | Hành động tiếp theo và lý do ưu tiên trên Hôm nay | Improve feature | P2 | Hôm nay/Luồng việc đang có | Nhỏ–vừa | R02, R04; dùng thêm F02 khi sẵn |
| F04 | Sẵn sàng bàn giao/release có bằng chứng | New feature | P2 | Release report và QC đang có | Vừa | R02, R04; F02 bổ sung phiên bản nguồn |
| A01 | AutoBE có queue bền, quyền rõ và giới hạn tự chạy | Improve automation | P2 | RAM queue và quyền xét từ lịch sử | Vừa–lớn | S01, R01, R04 |
| F05 | Tìm lại quyết định và bằng chứng xuyên nguồn | New feature có điều kiện | P3 | Search hiện tập trung vào tag | Vừa–lớn | F01, F02; xác nhận nhu cầu tìm kiếm |
| F06 | Hỗ trợ kiểm tra sau delivery_unknown | Improve feature | P2 | Outbox/recovery đang có | Nhỏ–vừa | Giữ nguyên nguyên tắc không tự retry |

## 3. Chi tiết các việc security và dữ liệu

### S01 — Chuẩn hóa quyền AI theo provider và hệ điều hành

**Trước cải tiến.** Các provider có biện pháp hạn chế khác nhau. Claude đặt failIfUnavailable=false trên Windows native. Codex dùng legacy read-only/workspace-write nhưng command builder chưa khai báo readable roots/denied roots tương đương danh sách secret của Claude/Agy. read-only có thể vẫn có shell và không đồng nghĩa chỉ đọc project. Antigravity đã không cấp shell vì thiếu sandbox, cần giữ giới hạn này.

**Cần làm chi tiết:**

1. Lập ma trận provider × OS × chế độ: không tool, đọc code, chạy lệnh, sửa code. Ghi rõ khả năng thực thi thực tế.
2. Trước chạy, kiểm tra CLI/version/capability cần thiết. Không có sandbox thực thi được thì không cấp shell; vẫn cho chế độ đọc phù hợp nếu an toàn.
3. Giới hạn phạm vi đọc vào project, dữ liệu đính kèm đã chọn và phần hệ thống tối thiểu cần thiết. Chặn data/, .env, session Telegram, token API và các thư mục credential.
4. Giữ lọc env, hạn chế network, MCP/plugin/browser và hook theo khả năng CLI; không coi câu dặn trong prompt là biện pháp cưỡng chế.
5. Hiển thị lý do chế độ không khả dụng và lựa chọn còn dùng được. Không tự chuyển sang quyền rộng hơn để chạy cho xong.
6. Kiểm thử bằng canary giả cho file ngoài project, thư mục credential giả, network/loopback và ghi ngoài phạm vi. Kiểm riêng chế độ không tool.

**Sau cải tiến.** Chế độ được bật theo quyền có thể cưỡng chế trên CLI và OS đang dùng. Thiếu khả năng bảo vệ thì chế độ nguy hiểm không chạy.

**Effect.** Giảm nguy cơ nội dung Telegram/ticket điều khiển AI đọc dữ liệu riêng tư hoặc chạy lệnh ngoài phạm vi. Người dùng biết chính xác khả năng nào đang hoạt động.

**Risk hiện tại.** Prompt bên ngoài đi vào agent có quyền rộng hơn người dùng có thể hiểu từ nhãn chỉ đọc/sandbox.

**Risk khi triển khai/còn lại.** Giới hạn quá chặt có thể làm build/test không chạy; khác phiên bản CLI có thể đổi ngữ nghĩa flag. Cần compatibility matrix và lỗi rõ ràng. Không hứa loại bỏ toàn bộ prompt injection. Không dùng kết quả helper chưa chạy được làm bằng chứng chặn thành công.

**Phần liên quan.** providers.py, config.py, ai.py, agent.py, UI lựa chọn chế độ và tests provider/agent. Nguồn [C01](#c01-quyền-ai-và-local-api).

**Done khi.** Chế độ không tool không gọi tool; chế độ đọc không ghi; canary ngoài phạm vi không đọc được; shell không chạy không sandbox; UI hiển thị đúng capability. Có bằng chứng trên từng nền tảng được tuyên bố hỗ trợ.

### S02 — Xóa dữ liệu nhóm bao gồm dữ liệu dẫn xuất

**Trước cải tiến.** Purge xóa message, digest/consent và dữ liệu liên quan trong một số bảng. Probe xác nhận prompt trong tasks, log và phiên được liệt kê vẫn còn. Endpoint chưa điều phối dừng phiên và xóa dữ liệu dẫn xuất.

**Cần làm chi tiết:**

1. Liệt kê nơi giữ dữ liệu nhóm: message, outbox, prompt, result, log, task refs, agent-links, ảnh/cache và nháp trình duyệt.
2. Chốt phạm vi nút Xóa dữ liệu nhóm. Ghi rõ dữ liệu trên máy và dữ liệu đã gửi provider/Telegram có giới hạn khác nhau.
3. Tìm task liên quan theo anchor và refs. Với phiên chứa nhiều nhóm, chọn quy tắc xóa cả phiên hoặc giữ phần an toàn; không tự giả định có thể scrub hoàn chỉnh một log tự do.
4. Dừng/cancel việc đang ghi trước khi xóa. Dùng generation/cancellation để lượt chạy cũ không ghi dữ liệu trở lại sau purge.
5. Xóa DB/file/cache/nháp đúng phạm vi; lỗi xóa phải hiển thị và có thể thử lại. Xử lý việc dọn lại sau restart khi cần.
6. Mô tả riêng retention chủ động cho log/ảnh/link cũ; không xóa âm thầm lịch sử cần giữ ngoài chính sách đã chốt.

**Sau cải tiến.** Người dùng có một hợp đồng xóa rõ ràng; dữ liệu nằm trong phạm vi đã cam kết được xóa nhất quán và không xuất hiện lại do tác vụ đang chạy.

**Effect.** Giảm dữ liệu riêng tư lưu dư, đồng thời giảm dung lượng và tránh kết quả AI dùng lại nguồn đã xóa.

**Risk hiện tại.** Người dùng có thể nghĩ đã xóa dữ liệu nhưng bản sao AI vẫn đọc được trên máy.

**Risk khi triển khai/còn lại.** Xóa nhầm phiên nhiều nhóm có thể mất lịch sử còn cần; file đang mở trên Windows có thể không xóa được. Không thể thu hồi dữ liệu đã gửi provider, thông báo hệ điều hành hoặc bản sao bên ngoài. Xóa logic cũng không phải cam kết xóa vật lý mọi bản sao trên đĩa/backup.

**Phần liên quan.** app.py purge, storage.py, tasks.py, agent.py, links.py, cache live và luồng purge frontend. Nguồn [C03](#c03-xóa-dữ-liệu-và-lịch-sử-ai).

**Done khi.** Probe kiểm DB, file, cache và UI sau purge; task đang chạy không tái tạo dữ liệu; phiên nhiều nhóm tuân thủ chính sách; lỗi xóa không bị báo thành công hoàn toàn.

### S03 — Dùng chung chính sách preview notification

**Trước cải tiến.** Thông báo tag kiểm preview; notifyLate của Q&A đưa nội dung câu hỏi vào notification khi bật thông báo mà chưa kiểm cùng tùy chọn.

**Cần làm chi tiết:**

1. Áp dụng cùng nguồn preference và quy tắc fallback cho notification tag, Q&A và đường thông báo liên quan.
2. Khi preview tắt hoặc preference chưa tải, dùng nội dung trung tính, không lấy snippet câu hỏi.
3. Giữ deep link và hành vi mở đúng công việc; rà nhãn cài đặt để người dùng hiểu phạm vi.

**Sau cải tiến.** Tắt preview có hiệu lực nhất quán ở các luồng notification được app tạo.

**Effect.** Giảm nội dung công việc lộ trên màn hình khóa/Notification Center.

**Risk hiện tại.** Người dùng tắt preview ở một nơi nhưng Q&A vẫn hiện nội dung.

**Risk khi triển khai/còn lại.** Preference chưa sẵn có thể tạo hành vi không nhất quán; notification đã gửi trước đó có thể còn do hệ điều hành giữ. Cần mặc định an toàn, không đổi ý nghĩa bật/tắt notification.

**Phần liên quan.** qa-page.tsx, use-events.ts, prefs/privacy và đường notification backend. Nguồn [C04](#c04-notification).

**Done khi.** Các trường hợp bật/tắt notification × bật/tắt preview hiển thị đúng; preview tắt không có snippet trong body notification mới.

## 4. Chi tiết các việc correctness, reliability và codebase

### R01 — Ngăn commit gom sửa tay; cô lập phiên sửa

**Trước cải tiến.** Diff phiên dựa trên snapshot, nhưng open_pr commit toàn bộ file được chọn ở trạng thái hiện tại. Probe: sửa tay dòng 1 trước snapshot, AI sửa dòng 3 sau snapshot; commit cuối chứa cả hai. Nếu snapshot thất bại, luồng còn fallback về toàn working tree.

**Cần làm chi tiết:**

1. Chặn đường tạo commit/PR tự động nếu baseline thiếu hoặc không thể xác minh.
2. Với checkout dùng chung, phát hiện file đã dirty trước phiên và file thay đổi tiếp sau lúc xem diff. Không tự gom chúng vào commit.
3. Gắn hành động commit với nội dung đã review, không chỉ danh sách path. Nếu diff thay đổi, yêu cầu xem lại kết quả mới.
4. Với phiên cho sửa, ưu tiên worktree/checkout riêng. Chuẩn bị rõ cách mang thay đổi có sẵn vào phiên nếu cần và cách đưa kết quả về.
5. Xử lý submodule theo từng repo; không tự đẩy phần sửa trong submodule như thể đã thuộc commit parent.
6. Giữ trạng thái staging/branch và sửa tay của người dùng; không dùng reset/clean để làm checkout sạch.

**Sau cải tiến.** Commit chứa đúng phần thay đổi được duyệt; thiếu baseline hoặc có xung đột nội dung thì dừng với lý do cụ thể.

**Effect.** Tránh đưa code ngoài task vào PR, giảm rủi ro review thiếu và ảnh hưởng công việc song song.

**Risk hiện tại.** File được AI chạm tới có thể kéo cả sửa tay trước đó vào commit mà diff phiên không đánh dấu là thay đổi mới.

**Risk khi triển khai/còn lại.** Worktree tăng dung lượng, cần xử lý build cache, local config, submodule và cleanup. Nếu chọn giải pháp theo patch, xử lý overlap cùng file khó hơn lọc theo path. Khi snapshot không tin cậy, giữ diff chỉ để xem, không fallback sang commit toàn bộ.

**Phần liên quan.** gitops.py snapshot/changes/open_pr, tasks.py start_task/task_pr, task-changes.tsx. Nguồn [C02](#c02-snapshot-diff-và-commit).

**Done khi.** Test cùng file có sửa trước phiên, sửa khác file, staged/unstaged, baseline thiếu và diff đổi sau preview. Commit chỉ chứa nội dung được duyệt; sửa tay/staging ban đầu được giữ; push/PR trong test dùng fake remote hoặc stub.

### R02 — Báo độ đầy đủ và phân trang các nguồn bị giới hạn

**Trước cải tiến.** Q&A quét tối đa 600 tin rồi trả danh sách không có metadata về phạm vi thực đọc. Task list giới hạn 200; ticket paging có cap 50.000; transitions có giới hạn số trang. Người dùng có thể hiểu danh sách trả về là toàn bộ dữ liệu đã chọn.

**Cần làm chi tiết:**

1. Phân biệt khoảng thời gian yêu cầu và phạm vi thực quét. Trả metadata phù hợp như scanned_since, fetched_at, truncated/has_more hoặc lý do chưa đầy đủ.
2. Bổ sung cursor/tải tiếp ở nguồn phù hợp; không chỉ tăng cap và làm request nặng hơn.
3. Giữ câu hỏi đang mở bằng ID/refs để theo dõi, thay vì chỉ trông vào cửa sổ 600 tin mới nhất.
4. Mở rộng cảnh báo nguồn của Hôm nay/YouTrack để thể hiện lỗi, dữ liệu cũ và dữ liệu thiếu khác nhau.
5. Không hiện khẳng định đã hết việc/đạt KPI nếu nguồn liên quan chưa đọc đủ. Các thống kê cần nêu rõ phạm vi.
6. Đổi response backend thì cập nhật model, export OpenAPI, regen frontend type và mọi caller.

**Sau cải tiến.** Danh sách và số liệu đi cùng phạm vi dữ liệu rõ ràng; người dùng có thể tải tiếp hoặc chủ động thu hẹp phạm vi.

**Effect.** Giảm bỏ sót câu hỏi, hiểu sai dashboard và kết luận AI dựa trên dữ liệu thiếu.

**Risk hiện tại.** Dữ liệu thiếu có thể trông như không có việc cần xử lý.

**Risk khi triển khai/còn lại.** Pagination thêm request và cần giữ cursor đúng khi dữ liệu live thay đổi. Kiểm soát bằng P03 và giới hạn hợp lý; không hứa dữ liệu Telegram đã xóa hoặc không có quyền đọc sẽ được phục hồi.

**Phần liên quan.** app.py Q&A, storage.py list_tasks, yt_dashboard.py paging/transitions, models.py, API type, Hôm nay/Q&A/YouTrack. Nguồn [C05](#c05-giới-hạn-dữ-liệu-và-việc-mở).

**Done khi.** Dataset vượt từng cap có dấu thiếu dữ liệu; tải tiếp không mất/lặp mục; thay đổi filter không dùng nhầm metadata cũ; số liệu incomplete không được gắn nhãn đầy đủ.

### R03 — Giữ việc Briefing mở độc lập với cửa sổ summary

**Trước cải tiến.** Carry giữ việc mở tối đa 30 ngày và 60 mục. Một việc có thể rơi khỏi summary dù chưa được đóng.

**Cần làm chi tiết:**

1. Lưu danh tính, nguồn và trạng thái việc mở độc lập với bản summary mới nhất.
2. Digest mới chỉ thêm/cập nhật/đề xuất giải quyết việc đã có; dùng nguồn/ID để tránh nhân bản.
3. Việc cũ chuyển sang vùng cần rà lại hoặc archive có lý do; tuổi không tự đổi thành Done.
4. Giữ thao tác đóng/mở lại và lịch sử người dùng đã xử lý. Nếu AI suy ra một việc được giải quyết, giữ bằng chứng và phân biệt với đóng do người dùng.
5. Phối hợp F02 để dùng cùng cách tham chiếu nguồn; không tạo hai bộ ID cho cùng một việc.

**Sau cải tiến.** Summary có thể gọn nhưng việc chưa giải quyết vẫn tồn tại và tìm lại được.

**Effect.** Giảm thất lạc công việc kéo dài; tăng giá trị của Briefing như công cụ theo dõi thay vì chỉ tóm tắt.

**Risk hiện tại.** Giới hạn summary quyết định việc nào còn xuất hiện trong hàng việc.

**Risk khi triển khai/còn lại.** Migration từ text/summary cũ có thể tạo trùng hoặc sai quan hệ. Chỉ import có nguồn đủ rõ; phần không xác định đưa vào rà lại, không tự suy ra là đã xong.

**Phần liên quan.** digest.py carry/run, storage.py/models.py và briefing-page.tsx/digest-page.tsx. Nguồn [C05](#c05-giới-hạn-dữ-liệu-và-việc-mở).

**Done khi.** Việc chưa đóng vẫn hiện khi quá 30 ngày/vượt 60 mục; chạy summary lại không tạo trùng; đóng/mở lại giữ đúng trạng thái.

### R04 — State AI có cấu trúc và badge đúng nghĩa

**Trước cải tiến.** task_state parse nhãn tiếng Việt trong Markdown, trong khi câu trả lời tuân theo ngôn ngữ người dùng. Một số badge dựa nhiều vào phiên tồn tại/đang chạy hơn là kết quả đã kiểm chứng. Đây là rủi ro giao thức và hiển thị; không khẳng định AI luôn trả sai.

**Cần làm chi tiết:**

1. Tách trạng thái tiến trình, trạng thái công việc và trạng thái kiểm chứng. Phiên chạy xong không tự có nghĩa công việc Done hay code đã đúng.
2. Nhận/lưu metadata có enum và validation; Markdown chỉ là nội dung hiển thị. Chuẩn hóa qua adapter provider hiện có, không phụ thuộc một heading theo ngôn ngữ.
3. Với output thiếu/sai metadata, giữ trạng thái chưa xác định và nội dung đọc được; không suy đoán thành công.
4. Đổi badge cho phiên lỗi/dừng/chưa có kết quả/đã có kết quả/cần đối chiếu lại theo dữ liệu thực.
5. Legacy session dùng fallback rõ ràng. Gửi trả lời không tự đánh dấu phiên đối chiếu Done.

**Sau cải tiến.** Cùng trạng thái nghiệp vụ được hiển thị nhất quán dù câu trả lời đổi ngôn ngữ hoặc format.

**Effect.** Hôm nay, AI Agent và AutoBE xử lý đúng lượt chờ; giảm dấu xanh gây hiểu nhầm.

**Risk hiện tại.** Parser có thể mất trạng thái do thay văn phong; trạng thái tiến trình dễ bị hiểu là kết luận đã xác minh.

**Risk khi triển khai/còn lại.** Provider không đồng đều về structured output; enum mới có thể lệch giữa API/UI. Cần validate server và fallback legacy; không chuyển hàng loạt phiên cũ sang Done bằng heuristic.

**Phần liên quan.** ai.py/task_state, providers.py, tasks.py, models.py, deep-think.tsx, tasks-page.tsx, today-page.tsx. Nguồn [C06](#c06-trạng-thái-ai-và-ngôn-ngữ).

**Done khi.** Output tiếng Việt/English không đổi state; output malformed không báo thành công; phiên dừng có badge đúng; reply và Done vẫn là hai thao tác đúng theo luồng hiện có.

### R05 — Gate kiểm tra trước release

**Trước cải tiến.** Workflow release build, đóng gói và ký; chưa gọi pytest/typecheck/lint trước phát hành. Test local đã pass không thay thế gate trên commit được phát hành.

**Cần làm chi tiết:**

1. Chạy Ruff, backend test, frontend typecheck/lint trên source của release; job đóng gói/phát hành phụ thuộc kết quả này.
2. Giữ khóa ký chỉ trong secret và action pin theo SHA.
3. Đưa test hồi quy của R01/S02/S03 và các bảo vệ quyền provider vào kiểm tra tập trung, có mục đích.
4. Phân biệt unit test/fake argv với smoke test quyền thực tế theo OS; chỉ tuyên bố hỗ trợ capability đã kiểm.
5. Tách kiểm tra cần AI thật/credential khỏi CI mặc định. Dùng dữ liệu giả và không phát sinh gửi tin/push thật.

**Sau cải tiến.** Gói release chỉ được phát hành khi các gate bắt buộc trên đúng source đó đạt.

**Effect.** Giảm lỗi hồi quy lọt vào bản đóng gói và làm rõ bằng chứng của mỗi bản phát hành.

**Risk hiện tại.** Có thể ký/phát hành bản mà các kiểm tra đang có chưa chạy hoặc đang fail.

**Risk khi triển khai/còn lại.** CI chậm hoặc flaky có thể cản release. Dùng bộ test rủi ro cao ổn định; pass CI vẫn không thay thế QA thiết bị và chạy thật.

**Phần liên quan.** .github/workflows/release.yml, tests hiện có và kiểm tra frontend. Nguồn [C07](#c07-release).

**Done khi.** Một gate fail chặn publish; không lộ secret; các nền tảng phát hành có bằng chứng kiểm tra tương ứng.

### R06 — Tách module theo phần thay đổi thực tế

**Trước cải tiến.** Một số module lớn chứa nhiều phần cùng thay đổi: storage khoảng 1.662 dòng, yt_dashboard 1.658, app 1.280, settings 1.381 và briefing-page 1.080 ở thời điểm review. Kích thước tự nó không chứng minh lỗi.

**Cần làm chi tiết:**

1. Khi triển khai hạng mục cụ thể, xác định đoạn vừa truy cập dữ liệu, vừa xử lý nghiệp vụ, vừa format/parse.
2. Tách hàm thuần khỏi I/O hoặc nhóm route/service theo luồng khi có lý do thay đổi thật.
3. Giữ wiring tại create_app và API công khai đang dùng; không thêm framework DI hoặc lớp wrapper chỉ để chia file.
4. Tách refactor khỏi thay đổi behavior thành bước review/kiểm chứng rõ ràng.

**Sau cải tiến.** Phần đang phát triển dễ đọc và kiểm thử hơn, với diff có phạm vi kiểm soát được.

**Effect.** Giảm chi phí sửa và nguy cơ chạm nhầm nghiệp vụ lân cận.

**Risk hiện tại.** Sửa một luồng dễ kéo theo nhiều trách nhiệm trong cùng module.

**Risk khi triển khai/còn lại.** Refactor diện rộng gây merge conflict, tăng diff và tạo abstraction không cần thiết. Đây là việc có điều kiện, không phải một đợt viết lại repo.

**Phần liên quan.** Chỉ module đang thuộc hạng mục triển khai; không đặt mục tiêu giảm số dòng toàn dự án.

**Done khi.** Behavior giữ nguyên qua focused test/compile; người review theo được luồng với ít điểm nhảy hơn; không thêm layer không có nhu cầu thực.

## 5. Chi tiết các việc performance

### P01 — Đọc log AI theo cursor/offset

**Trước cải tiến.** AgentRunner.read đọc toàn file rồi bỏ các dòng cũ. Frontend poll khoảng 1,5 giây khi chạy. Với log giả không có event mới: 1 MB khoảng 0,54 ms; 10 MB 5,61 ms; 40 MB 27,12 ms, warm cache trên máy review.

**Cần làm chi tiết:**

1. Trả cursor cho vị trí byte/đoạn đã đọc, chỉ đọc phần mới sau cursor.
2. Giữ phần dòng đang ghi dở cho lượt sau; không làm mất hoặc parse lặp event.
3. Có định danh/generation log để nhận ra rerun/truncate/reset, không chỉ so chiều dài.
4. Giới hạn số byte/event mỗi response; có cách đọc tiếp lịch sử khi cần.
5. Giữ final poll bắt đủ event cuối trước khi dừng, cancellation và khôi phục khi quay lại phiên.

**Sau cải tiến.** Chi phí mỗi poll chủ yếu theo dữ liệu mới; poll không có event không tăng theo toàn bộ lịch sử log.

**Effect.** Giảm disk I/O, allocation và CPU của phiên dài; hỗ trợ nhiều phiên mà không tăng chi phí theo tuổi từng log.

**Risk hiện tại.** File càng lớn thì mỗi lần kiểm không có gì mới vẫn càng tốn.

**Risk khi triển khai/còn lại.** Cursor byte cần xử lý UTF-8, partial line và file reset. Không mất event quan trọng hơn giảm thêm vài ms. Số đo trên không phải latency toàn app hoặc mức tăng tốc đã đạt.

**Phần liên quan.** agent.py/read, tasks.py/task_events, tasks-feed.tsx/useTaskLog và API contract. Nguồn [C08](#c08-log-ai-và-task-list).

**Done khi.** Đo bytes read và latency với 1/10/40 MB: khi không có event mới, lượng đọc không tăng theo kích thước log; kiểm append, dòng dở, rerun và event cuối.

### P02 — Giảm payload và số lượt đọc file của task list

**Trước cải tiến.** /tasks lấy tối đa 200 phiên, đọc result/prompt/mtime từng phiên; result có thể đến 20.000 ký tự/phiên. Khi có phiên chạy, list poll khoảng 10 giây.

**Cần làm chi tiết:**

1. List trả metadata, state và preview ngắn đủ dùng; khi mở phiên mới tải result/prompt đầy đủ.
2. Lưu/cập nhật summary metadata khi ghi hoặc cache theo mtime; không đọc lại toàn bộ result mỗi lần poll.
3. Giữ select/structural sharing của query hiện có; chỉ invalidate tài nguyên liên quan khi có thay đổi.
4. Kiểm mọi caller của taskListQuery/useTaskList: Hôm nay, inbox, AI Agent, Đối chiếu BE, Luồng việc.
5. Phối hợp R02 để lịch sử có thể tải tiếp thay vì âm thầm biến mất sau 200 phiên.

**Sau cải tiến.** Mở list tải nhẹ; chọn phiên mới đọc nội dung cần xem. State không bị suy ra từ preview đã cắt.

**Effect.** Giảm payload, thao tác file và chi phí render của dữ liệu không được mở.

**Risk hiện tại.** Một phiên đang chạy khiến nhiều nội dung của các phiên đã xong được đọc/truyền lại.

**Risk khi triển khai/còn lại.** Caller cũ có thể đang dùng result đầy đủ để dựng chip hoặc draft; cache metadata có thể cũ. Cần kiểm các caller và cập nhật nguyên tử cùng lúc ghi kết quả.

**Phần liên quan.** tasks.py, agent.py đọc kết quả, storage.py, models.py, inbox.ts và các component dùng task. Nguồn [C08](#c08-log-ai-và-task-list).

**Done khi.** Có baseline payload/file reads/p95 ở 20/100/200 phiên; đặt mục tiêu đề xuất giảm ít nhất 80% payload trong dataset chuẩn chứa kết quả dài. Chưa xem đây là mức cải thiện thực tế cho mọi dữ liệu.

### P03 — Limiter Telegram dùng chung, TTL và single-flight

**Trước cải tiến.** Briefing tạo semaphore trong từng request. Probe 3 request đồng thời tạo peak 12 live calls dù cap mỗi request là 4. Q&A/member cache kiểm trước semaphore nhưng chưa gom request trùng đang bay.

**Cần làm chi tiết:**

1. Đưa limiter vào service/bridge dùng chung cho các luồng live được chọn, không tạo lại theo request.
2. Gom fetch cùng key đang bay; recheck cache khi đã chờ. Key phải gồm đủ chat, khoảng, cursor và tham số ảnh hưởng kết quả.
3. Dùng TTL ngắn cho latest ID và dữ liệu phù hợp; giữ invalidation khi gửi, edit, purge hoặc đổi tài khoản/quyền.
4. Xử lý cancellation của một caller mà không làm hỏng request dùng chung cho caller khác.
5. Giữ lỗi kết nối/FloodWait riêng với dữ liệu rỗng; có thời điểm retry và trạng thái dữ liệu cũ rõ ràng.

**Sau cải tiến.** Nhiều tab/request vẫn tuân theo cap chung; cùng key chỉ tạo một lượt fetch tại một thời điểm.

**Effect.** Giảm FloodWait, burst request và công việc trùng; phân phối tài nguyên ổn định hơn.

**Risk hiện tại.** Cap theo request không giới hạn toàn tài khoản; cache cold tạo nhiều lượt fetch trùng.

**Risk khi triển khai/còn lại.** Limiter quá thấp làm thao tác người dùng chờ; cache sai key hoặc invalidate thiếu làm dữ liệu cũ/rò phạm vi. Cần cân bằng ưu tiên tương tác và background dựa trên đo đạc.

**Phần liên quan.** app.py briefing/_qa_msgs/members, TelegramBridge và DigestService khi nối limiter chung. Nguồn [C09](#c09-live-read-và-cache-telegram).

**Done khi.** Probe nhiều request không vượt cap chung; cùng key cold chỉ có một fetch; đổi key không dùng nhầm dữ liệu; lỗi/cancel/purge không để lại cache hoặc task sai.

### P04 — Đo frontend; windowing khi có bằng chứng

**Trước cải tiến.** Bảng ticket thêm 150 dòng mỗi bước nhưng giữ dòng cũ trong DOM. Chưa có số đo UI thật để kết luận mức độ chậm.

**Cần làm chi tiết:**

1. Đo render duration, DOM nodes, bộ nhớ và độ mượt scroll với 1k/5k/20k ticket trong môi trường thử riêng.
2. Đo lúc nhập tìm kiếm, đổi filter, chọn nhiều, mở preview và tick thời gian. Xác định phần tốn thực sự.
3. Nếu DOM là nút thắt, windowing vùng danh sách cần thiết. Nếu tính toán là nút thắt, xử lý đúng phép tính/scope/context gây render lại.
4. Giữ keyboard navigation, focus, screen reader, grouping, selection và thao tác board.
5. Không thêm dependency, memo hoặc global state mới chỉ vì dự đoán sẽ nhanh hơn.

**Sau cải tiến.** Có baseline và bằng chứng của thay đổi; nếu cần windowing, DOM chịu giới hạn theo vùng xem.

**Effect.** Tăng độ mượt khi dữ liệu lớn, tránh tối ưu nhầm nơi.

**Risk hiện tại.** Số DOM nodes có thể tăng sau cuộn dài; chưa biết ngưỡng ảnh hưởng người dùng thực.

**Risk khi triển khai/còn lại.** Windowing có thể làm mất focus, sai chiều cao nhóm hoặc ảnh hưởng accessibility. Chỉ triển khai khi số đo chứng minh lợi ích và các hành vi này được giữ.

**Phần liên quan.** yt/tickets.tsx, yt/state.tsx, các selector/context liên quan. Nguồn [C10](#c10-ui-danh-sách-và-luồng-việc).

**Done khi.** Có so sánh trước/sau trên cùng dataset và máy; không chỉ dựa vào cảm giác; các thao tác chính và accessibility không hồi quy.

## 6. Chi tiết feature cải tiến và feature mới

### F01 — Đồng bộ state Q&A và nhóm theo dõi

**Trước cải tiến.** Done/Xóa Q&A ở backend; câu trả lời Chốt, trạng thái đã xem, mute và nhóm gần đây còn theo trình duyệt. Theo dõi tự động tập trung vào 8 nhóm gần đây.

**Cần làm chi tiết:**

1. Chuyển state ảnh hưởng nghiệp vụ như câu trả lời được chốt, mute/reminder và nhóm chủ động theo dõi sang backend của app local.
2. Phân biệt nhóm gần đây và nhóm cần theo dõi; không để mở nhóm thứ 9 tự làm người dùng mất theo dõi một câu hỏi quan trọng.
3. Xác định có cần đồng bộ seen giữa trình duyệt hay chỉ chốt/mute/follow; tránh coi mọi preference là dữ liệu nghiệp vụ.
4. Migration localStorage phải idempotent; nếu hai trình duyệt có lựa chọn khác nhau, xử lý theo quy tắc rõ hoặc cho người dùng rà lại.
5. Giữ nhận diện chat_id + code/message_id; theo dõi câu hỏi mở qua ID khi vượt cửa sổ tin gần nhất của R02.

**Sau cải tiến.** Các trình duyệt cùng kết nối một app backend thấy cùng câu trả lời đã chốt và danh sách cần theo dõi. Không hàm ý đồng bộ giữa nhiều máy chưa có cơ chế chia sẻ backend.

**Effect.** Giảm thao tác chốt lại và bỏ sót khi đổi trình duyệt; Q&A đáng tin hơn cho công việc dài ngày.

**Risk hiện tại.** Trạng thái quan trọng khác nhau giữa trình duyệt; giới hạn recents có thể ảnh hưởng theo dõi.

**Risk khi triển khai/còn lại.** Migration có xung đột; theo dõi nhiều nhóm tăng live reads. Dùng P03 và lịch đọc phù hợp; không mở rộng polling vô hạn.

**Phần liên quan.** qa-page.tsx, qa-recent.ts/prefs, app.py/storage.py/models.py. Nguồn [C11](#c11-qa-state-và-nhóm-theo-dõi).

**Done khi.** Hai trình duyệt trên cùng backend thấy cùng accepted answer/follow state; import lặp không tạo trùng; mở nhóm mới không mất câu hỏi đang theo dõi.

### F02 — Kết luận có phiên bản và độ mới của bằng chứng

**Trước cải tiến.** Có nguồn tin và phiên đối chiếu, nhưng chưa có luồng đầy đủ xác định kết luận đang dựa trên phiên bản nào của nguồn và code.

**Cần làm chi tiết:**

1. Lưu kết luận cùng source refs, thời điểm/hash nội dung hoặc edit version, người chốt và lần đối chiếu code.
2. Revision code phải phân biệt commit với working tree dirty; không ghi mỗi HEAD rồi coi đã đại diện cho toàn bộ code AI đọc.
3. Khi tin nguồn sửa/xóa, đánh dấu kết luận cần rà lại; khi code liên quan đổi, dùng phạm vi đã biết để cảnh báo, tránh báo mọi kết luận cũ sau mỗi commit.
4. Giữ lịch sử kết luận trước/sau. AI đề xuất kết luận mới; người dùng chốt các quyết định cần trách nhiệm con người.
5. Hiển thị ngay trên Q&A, thẻ BE và phiên đối chiếu; dùng Hôm nay để đưa việc cần rà lại lên, không tạo dashboard trùng.
6. Bản đầu ưu tiên nguồn Telegram edit và revision lúc đối chiếu. Phân tích dependency code sâu hơn chỉ bổ sung khi cần.

**Sau cải tiến.** Người dùng biết kết luận nào được chốt, dựa trên bằng chứng nào và đã cần kiểm tra lại hay chưa.

**Effect.** Tránh dùng câu trả lời cũ sau khi BE đổi contract; giảm hỏi lại lịch sử quyết định và đối chiếu thủ công.

**Risk hiện tại.** Có kết quả AI trước đây dễ bị hiểu là vẫn đúng với nguồn/code hiện tại.

**Risk khi triển khai/còn lại.** Hash/nguồn không đọc được hoặc code thay đổi ngoài phạm vi đã biết làm cảnh báo thiếu/thừa. Trạng thái còn mới không phải chứng minh đúng; giữ nhãn chưa kiểm chứng và nguồn bằng chứng rõ ràng.

**Ví dụ trước/sau.** Trước: BE chốt A, AI đối chiếu xong, BE sửa thành A+B nhưng kết quả cũ vẫn trông như hoàn tất. Sau: giữ lịch sử A và gắn Cần đối chiếu lại cho chuỗi việc, rồi đối chiếu A+B trên revision mới.

**Phần liên quan.** Q&A Chốt, Digest/Briefing decisions, task refs, storage/models, Đối chiếu BE và Luồng việc. Nguồn [C05](#c05-giới-hạn-dữ-liệu-và-việc-mở), [C10](#c10-ui-danh-sách-và-luồng-việc).

**Done khi.** Edit/delete nguồn làm thay đổi đúng kết luận liên quan; giữ lịch sử; revision dirty được thể hiện đúng; không tự đóng việc vì có phiên AI mới.

### F03 — Hành động tiếp theo và lý do ưu tiên trên Hôm nay

**Trước cải tiến.** Hôm nay đã gom các nguồn thành chuỗi và chia gấp/chờ bạn/bạn đang chờ. Người dùng còn phải tự suy ra bước kế tiếp qua nhiều màn.

**Cần làm chi tiết:**

1. Áp dụng rule xác định từ dữ liệu: BE trả lời mới thì đối chiếu; AI có kết quả thì review; ticket Fixed thì chuẩn bị báo lại; còn câu hỏi thì mở đúng Q&A.
2. Mỗi chuỗi có một hành động chính phù hợp trạng thái; vẫn giữ đường xem toàn bộ nguồn và hành động khác.
3. Hiển thị lý do ưu tiên: quá hạn, blocked, có thay đổi mới, đang chờ quyết định; tránh score khó giải thích do AI tự sinh.
4. Khi nguồn lỗi/cũ/thiếu, hiển thị phạm vi và không nói chắc đã hết việc.
5. Tôn trọng nháp, snooze, lựa chọn Done và liên kết đang có. Tạo nháp không tự gửi tin hoặc tự Done phiên.

**Sau cải tiến.** Người dùng nhìn một chuỗi việc biết cần làm bước gì, vì sao và bấm tới đúng nơi.

**Effect.** Giảm chuyển màn và thời gian quyết định; tăng giá trị trang đang là entry point chính.

**Risk hiện tại.** Có đủ dữ liệu nhưng người dùng vẫn phải tự ghép hành động tiếp theo.

**Risk khi triển khai/còn lại.** Rule sai ưu tiên có thể đẩy việc không đúng lúc; hiển thị quá nhiều gợi ý gây nhiễu. Giữ một hành động chính, có lý do và không tự tạo side effect ngoài thao tác người dùng.

**Phần liên quan.** today-page.tsx, work-trail.tsx, task state, Q&A, Báo lại và metadata R02. Nguồn [C10](#c10-ui-danh-sách-và-luồng-việc).

**Done khi.** Bộ tình huống đại diện dẫn tới đúng màn/tin/phiên; không tạo hai việc trùng cho cùng nguồn; source lỗi không hiện lời khẳng định hết việc.

### F04 — Sẵn sàng bàn giao/release có bằng chứng

**Trước cải tiến.** Có Release report, QC transitions, ticket và phân tích AI. Số liệu/bản báo cáo chưa phải một checklist bằng chứng cho từng ticket hoặc phiên bản ứng dụng.

**Cần làm chi tiết:**

1. Bổ sung trên màn Release/report hiện có các điều kiện tối thiểu theo vai trò: AC, xác nhận còn thiếu, state ticket, kết quả kiểm tra và báo lại.
2. Mỗi điều kiện có trạng thái đạt/chưa đạt/chưa biết và link nguồn. Không suy ra đã test chỉ vì ticket Fixed hoặc một phiên AI đã xong.
3. Ghi build/revision, thời điểm, loại kiểm tra và người xác nhận cho bằng chứng test. Phân biệt unit/build với device QA.
4. AI giải thích điểm thiếu và soạn nháp báo cáo; rule/dữ liệu quyết định các trạng thái có thể xác định được.
5. Bản đầu dùng dữ liệu hiện có và xác nhận thủ công có nguồn; không yêu cầu tích hợp thêm CI/test management mới.

**Sau cải tiến.** Người dùng thấy lý do chưa sẵn sàng bàn giao và có thể mở đúng nguồn để hoàn tất.

**Effect.** Giảm handoff thiếu thông tin, retest sai bản và báo cáo kết luận quá mức từ state ticket.

**Risk hiện tại.** Báo cáo tổng hợp có thể được hiểu như bằng chứng đã kiểm tra đầy đủ.

**Risk khi triển khai/còn lại.** Rule khác giữa project/vai trò; bằng chứng cũ có thể không còn đúng cho build mới. Phải hiển thị revision/tuổi và chưa biết; không tự chặn quy trình cả team bằng rule chưa được chốt.

**Phần liên quan.** yt/release.tsx, yt/report.tsx, QC transitions, ticket detail và source refs. Nguồn [C12](#c12-release-report-và-đối-chiếu).

**Done khi.** Ticket Fixed nhưng chưa có test vẫn hiện chưa biết; bằng chứng đúng build/revision; mỗi kết luận mở được nguồn; bản report xuất ra giữ đúng phạm vi và giới hạn dữ liệu.

### A01 — AutoBE có queue bền, quyền rõ và giới hạn tự chạy

**Trước cải tiến.** Queue relay nằm trong RAM, restart mất lượt chờ dù tag gốc còn. Quyền sửa tự động xét cả lịch sử: phiên đã từng được cho sửa có thể tự sửa tiếp khi nhận BE reply. Guide đã mô tả hành vi này; đây là rủi ro thiết kế, không khẳng định bypass ngoài thiết kế.

**Cần làm chi tiết:**

1. Lưu job theo session và source message IDs trong DB; có trạng thái pending/running/done/failed, khóa nhận job và chống nhận trùng.
2. Sau restart, khôi phục job chưa hoàn tất; không tự gửi lại Telegram hoặc lặp side effect không chắc kết quả.
3. Đặt quyền tự sửa theo project/session/phạm vi và thời hạn hoặc lượt được duyệt. Thay đổi ngữ nghĩa quyền phải được giải thích cho người dùng.
4. Giới hạn số phiên chạy theo project, số lượt tự chạy và tổng thời gian/lượt trước khi cần người dùng xem.
5. Khi lỗi/FloodWait/quá giới hạn, giữ job, lý do và thao tác tiếp tục; không chỉ log rồi bỏ.
6. Dùng checkout riêng của R01 cho phiên sửa. Giữ việc gửi câu hỏi Telegram do người dùng chủ động thực hiện.

**Sau cải tiến.** Lượt chờ phục hồi được, quyền tự sửa có ranh giới và vòng tự động không tiếp tục vô hạn.

**Effect.** Giảm chuyển tin thủ công mà vẫn kiểm soát quota, file thay đổi và lỗi sau restart.

**Risk hiện tại.** Mất lượt relay; một lần cho sửa có tác dụng dài hơn một lượt; nhiều phiên có thể tranh cùng checkout.

**Risk khi triển khai/còn lại.** Recovery sai có thể chạy trùng; quyền mới có thể phá kỳ vọng phiên cũ. Migration không tự mở rộng quyền; khi không xác định được kết quả thì yêu cầu rà lại thay vì thực hiện side effect lại.

**Phần liên quan.** autobe.py, AgentRunner, tasks.py, storage.py, rule settings và task UI. Nguồn [C13](#c13-autobe).

**Done khi.** Restart giữa lúc chờ/chạy không mất job hoặc chạy trùng; cap theo project có hiệu lực; hết quyền/lượt thì dừng đúng; lỗi có thể thấy và phục hồi; không tự gửi Telegram.

### F05 — Tìm lại quyết định và bằng chứng xuyên nguồn

**Trước cải tiến.** Tìm kiếm hiện tập trung vào nội dung tag; các nguồn Q&A, quyết định BE, phiên AI và ticket có thể phải tìm riêng. Command palette đã có điều hướng, nên không cần tạo thêm entry point trùng.

**Cần làm chi tiết:**

1. Mở rộng tìm kiếm hiện có cho các bản ghi đã lưu và có quyền dùng: câu trả lời chốt, quyết định, kết quả đối chiếu, refs ticket/tin.
2. Kết quả thể hiện ai chốt, lúc nào, nguồn, revision và trạng thái cần rà lại; dẫn tới đúng màn hiện có.
3. Ưu tiên ID, text search và bộ lọc nguồn/trạng thái. Chỉ cân nhắc FTS/semantic search sau khi đo dữ liệu và nhu cầu.
4. Không live-crawl mọi nhóm hoặc gửi toàn lịch sử sang AI chỉ để tìm. Xóa/quyền/retention phải áp dụng vào index.

**Sau cải tiến.** Một lần tìm có thể tìm lại quyết định và bằng chứng liên quan, với độ mới rõ ràng.

**Effect.** Giảm hỏi lại và mất thời gian đọc nhiều lịch sử riêng lẻ.

**Risk hiện tại.** Thông tin tồn tại nhưng khó tìm lại hoặc không rõ còn đúng không.

**Risk khi triển khai/còn lại.** Index có thể giữ dữ liệu đã purge hoặc làm lộ nội dung qua snippet. Phụ thuộc S02/F02; không dùng kết quả tìm kiếm cũ như một nguồn sự thật độc lập.

**Phần liên quan.** Tìm kiếm/palette hiện có, storage và source refs của F01/F02. Nguồn [C11](#c11-qa-state-và-nhóm-theo-dõi), [C12](#c12-release-report-và-đối-chiếu).

**Done khi.** Tìm đúng dữ liệu đại diện theo ID/nội dung/nguồn; purge làm kết quả biến mất; nguồn không còn hiệu lực có dấu phù hợp. Chỉ triển khai sau khi xác nhận nhu cầu đủ mạnh.

### F06 — Hỗ trợ kiểm tra sau delivery_unknown

**Trước cải tiến.** Outbox đã phân biệt kết quả chưa rõ và không tự retry. Người dùng vẫn phải mở nhóm rồi tự tìm tin để quyết định có cần gửi lại không.

**Cần làm chi tiết:**

1. Từ trạng thái chưa rõ đã gửi, cho mở đúng nhóm/tin gốc và khoảng thời gian lần gửi.
2. Khi người dùng yêu cầu kiểm tra, đọc phạm vi hẹp để hỗ trợ đối chiếu bản nháp, thời gian, reply target và tin của chính họ.
3. Nếu không đủ căn cứ, giữ trạng thái chưa rõ. Không coi không tìm thấy trong một cửa sổ là chắc chắn chưa gửi.
4. Chỉ cập nhật đã gửi khi có bằng chứng đáng tin; không tự tạo request gửi mới hoặc tự đổi random_id.
5. Giữ draft và thông báo rõ trước một lần gửi lại do người dùng chủ động chọn.

**Sau cải tiến.** Người dùng có đường kiểm tra tập trung, ít phải tìm tay và ít có xu hướng gửi lại ngay.

**Effect.** Giảm tin trùng và công sức xử lý lỗi mạng; tận dụng outbox đang có.

**Risk hiện tại.** Người dùng có thể gửi lại khi chưa kiểm tra đủ, dù app không tự retry.

**Risk khi triển khai/còn lại.** Tin giống nhau hoặc history thiếu làm đối chiếu nhầm. Không hứa phát hiện chính xác trong mọi tình huống; dùng tiêu chí chặt và giữ lựa chọn kiểm tra thủ công.

**Phần liên quan.** Outbox/send backend, composer recovery và deep link Telegram. Nguồn [C14](#c14-gửi-tin-và-outbox).

**Done khi.** Timeout, connection loss, tin gửi thành công nhưng response mất và nhiều tin giống nhau không gây tự gửi lại hoặc xác nhận sai là chưa gửi.

## 7. Roadmap và điều kiện chuyển đợt

Đây là thứ tự đề xuất, không phải cam kết lịch. Không tự triển khai toàn bộ đợt sau chỉ vì đã liệt kê trong tài liệu.

| Đợt | Hạng mục | Mục tiêu | Điều kiện hoàn tất |
|---|---|---|---|
| 1 — Quyền và dữ liệu | S01, R01, S02, S03, R05 | Quyền AI thực thi được; commit không gom sửa tay; purge đúng phạm vi; có gate release | Test hồi quy đạt và có bằng chứng capability theo nền tảng được hỗ trợ |
| 2 — Độ tin cậy và I/O | R02, R03, R04, P01, P02, P03, F01 | Không mất việc vì cửa sổ dữ liệu; state rõ; giảm đọc/truyền trùng; Q&A đồng bộ | Dataset vượt cap hiển thị đúng; đo trước/sau; restart/purge/cancel không gây state sai |
| 3 — Giá trị sản phẩm | F02, F03, F04, F06 | Kết luận có phiên bản, hành động tiếp theo và bằng chứng bàn giao | Luồng từ nguồn tới kiểm chứng/báo lại chạy được trên tình huống thực có phạm vi rõ |
| 4 — Mở rộng có điều kiện | A01 sau S01/R01/R04; P04, R06, F05 theo bằng chứng | Tự động hóa phục hồi được; giải quyết nút thắt hoặc nhu cầu đã đo | Queue không mất/lặp; quyền không bị mở rộng; số đo/nhu cầu chứng minh cần phần mở rộng |

### 7.1. Những quyết định cần chốt khi triển khai

| Quyết định | Đề xuất mặc định để xem xét | Ảnh hưởng |
|---|---|---|
| Không có sandbox cần thiết | Không cấp shell/sửa vượt capability; cho dùng chế độ đọc phù hợp | S01; trải nghiệm Windows/CLI cũ |
| Purge phiên chứa nhiều nhóm | Trình bày rõ phạm vi; không hứa scrub chính xác log tự do nếu chưa làm được | S02; tránh xóa nhầm hoặc giữ bản sao |
| Phiên sửa code | Worktree riêng; không tự dọn checkout đang dirty | R01; an toàn thay đổi song song |
| State Q&A cần đồng bộ | Chốt/follow/mute trước; seen tùy nhu cầu | F01; migration và live reads |
| Quyền sửa của AutoBE | Phạm vi và thời hạn/lượt rõ, không tự nới quyền phiên cũ | A01; cân bằng tiện dụng và kiểm soát |
| Điều kiện sẵn sàng release | Quy tắc theo project/vai trò; thiếu bằng chứng là chưa biết | F04; tránh chặn team bằng rule chưa thống nhất |
| Virtualization/FTS/dependency mới | Chỉ chọn sau baseline và xác nhận nhu cầu | P04/F05; tránh chi phí không cần thiết |

### 7.2. Nguyên tắc triển khai chung

- Tách từng hạng mục thành thay đổi có thể review và rollback riêng; giữ sửa không liên quan trong working tree.
- API contract đổi thì kiểm mọi caller, export OpenAPI và regen type frontend.
- Feature người dùng thấy đổi thì cập nhật guide theo đúng nhãn UI.
- Không tự retry mutation gửi tin; timeout/mất kết nối giữ delivery_unknown.
- Giữ các error state rõ; lỗi và dữ liệu thiếu không hiển thị như dữ liệu rỗng.
- Query/cache mới phải có key, invalidation và cancellation đúng; không thêm polling trong từng row.
- Dùng primitive UI đang có: Segmented/Pill, Hint, AiAsk và token thiết kế.
- Test tập trung vào nhánh/rủi ro thực; không tạo suite chỉ lặp lại implementation.
- Không build đè web/out hoặc chạy thử trên cổng 8765. UI/E2E chạy trên bản copy ở scratch với cổng riêng.
- Sau thay đổi feature/bugfix/refactor, chạy focused verification, self-review, CodeGraph sync và cập nhật WORKING-CONTEXT nếu có.

## 8. So sánh trạng thái tổng thể trước và sau

Cột Sau là mục tiêu dự kiến sau khi các hạng mục tương ứng hoàn thành, chưa phải kết quả hiện tại.

| Khía cạnh | Trước | Sau dự kiến | Lợi ích chính | Rủi ro còn lại cần quản lý |
|---|---|---|---|---|
| Quyền AI | Khác nhau theo provider/OS; một số chế độ chưa có biên đọc/shell rõ | Capability và phạm vi được thực thi, có kiểm chứng | Giảm truy cập ngoài ý định | CLI/OS đổi; prompt injection vẫn cần nhiều lớp bảo vệ |
| Commit/PR | Snapshot dùng cho diff, commit theo file hiện tại | Baseline tin cậy, nội dung được duyệt, checkout riêng cho sửa | Không gom sửa tay ngoài task | Chi phí worktree/submodule và merge |
| Xóa dữ liệu | Một số bản sao AI/cache nằm ngoài purge | Phạm vi xóa rõ và áp dụng cho dữ liệu dẫn xuất | Người dùng kiểm soát dữ liệu tốt hơn | Không thu hồi bản đã gửi bên ngoài/backup |
| Độ đầy đủ | Cap có thể làm danh sách trông như đầy đủ | Phạm vi thực đọc, pagination và cảnh báo | Giảm bỏ sót và hiểu sai số liệu | Nguồn ngoài có thể không còn đọc được |
| Trạng thái | Có phần phụ thuộc Markdown/tiến trình | State nghiệp vụ, tiến trình và kiểm chứng tách rõ | UI/rule ít phụ thuộc văn phong AI | Output thiếu hoặc nguồn thay đổi cần fallback |
| Việc dài ngày | Briefing carry và Q&A recent/window có thể bỏ sót | Việc mở/follow tồn tại độc lập cửa sổ summary | Theo dõi đến khi thật sự xử lý | Dữ liệu cũ cần review/retention rõ |
| Hiệu năng | Đọc toàn log, task list nặng, limiter theo request | Đọc incremental, list gọn, limiter/cache chung | Giảm I/O và burst request | Phải đo trên dữ liệu thật để biết mức cải thiện |
| Giá trị sản phẩm | Có nhiều công cụ nhưng còn tự ghép kết luận/bước tiếp | Nguồn có phiên bản, việc có hành động và bằng chứng | Ít chuyển màn và hỏi lại | Gợi ý/rule cần giải thích được |
| Tự động hóa | Queue RAM, quyền sửa từ lịch sử | Queue bền, chống trùng, quyền và budget rõ | Phục hồi và kiểm soát được | Retry/recovery vẫn cần xử lý kết quả chưa rõ |
| Release | Có build/ký nhưng thiếu gate kiểm tra trong workflow | Gate trên source phát hành + bằng chứng kiểm tra | Giảm hồi quy bản đóng gói | CI pass chưa thay thế QA thực tế |

## 9. Bằng chứng kiểm chứng từ lượt review

### 9.1. Kiểm tra đã chạy

| Kiểm tra | Kết quả ghi nhận | Phạm vi / giới hạn |
|---|---|---|
| uv run pytest -q | 240 passed, 16,10 giây | Backend tại working tree lúc review |
| npm run typecheck | Pass | Frontend typecheck, không phải browser QA |
| npm run lint | Pass | Frontend lint |
| uv run ruff check . | Pass | Python static checks |
| npm audit --omit=dev | 0 lỗ hổng đã biết được báo cáo | Dependency production tại thời điểm audit |
| pip-audit trên production lock đã export | 21 dependency bên thứ ba, 0 lỗ hổng đã biết | Bỏ qua package dự án editable; chưa audit dev dependencies |

Không có lỗ hổng đã biết trong dependency không chứng minh logic ứng dụng hoặc quyền AI an toàn.

### 9.2. Probe đã chạy với dữ liệu giả

| Probe | Cách tái hiện | Quan sát | Hạng mục |
|---|---|---|---|
| Commit cùng file | Repo giả: commit baseline; sửa tay dòng 1; snapshot; AI sửa dòng 3; gọi open_pr với push/gh bị stub | Diff phiên không đánh dấu dòng 1 là phần thêm mới nhưng commit chứa sửa tay dòng 1 | R01 |
| Purge | Store giả có nhóm, task chứa dummy prompt và dummy log; gọi purge_chat rồi đọc task/log/list | Prompt còn, log còn, task list còn 1 phiên | S02 |
| Briefing concurrency | Gọi endpoint 3 lần đồng thời, mỗi request có 8 nhóm; transport giả đếm active calls | Peak 12 live calls, cap từng request là 4 | P03 |
| Log không có event mới | File JSONL giả 1/10/40 MB; gọi read với after đã ở cuối, lấy median 3 lần | 0 event trả về; khoảng 0,54/5,61/27,12 ms | P01 |

Số đo log là warm cache, synthetic trên máy review, không phải p95 toàn app hoặc mức tăng tốc sau sửa.

### 9.3. Phần chưa được chứng minh

- Chưa chạy UI end-to-end, phiên AI thật, QA thiết bị hoặc native Windows.
- Chưa làm pentest đầy đủ, đo frontend lớn, query plan hay volume dữ liệu thực.
- Thử helper sandbox Codex chưa hoàn tất vì cần permission profile; không được tính là test chặn thành công hoặc bằng chứng đã đọc được secret.
- Không đọc secret thật, không gửi Telegram, không ghi YouTrack, không push/mở PR thật trong probe.
- Các file nguồn trọng yếu được kiểm hash và không đổi trong khoảng chạy probe đến lần kiểm đó. Tài liệu không bảo đảm source sẽ giữ nguyên sau thời điểm review.
- Lượt tổng hợp này chỉ viết tài liệu; không triển khai backlog và không chạy lại toàn bộ các kiểm tra trên.

## 10. Nguồn code và tài liệu tham chiếu

Đường dẫn/line bên dưới là mốc của lượt review ngày 13/11/2026. Khi triển khai cần kiểm source hiện tại, nhất là khi working tree có thay đổi chưa commit. Các link local dùng đường dẫn máy hiện tại; khi chia sẻ sang máy khác, tra tên file tương ứng trong repository.

### C01. Quyền AI và local API

- [providers.py — sandbox và policy](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/providers.py:75>)
- [providers.py — ask command](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/providers.py:433>)
- [providers.py — task command](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/providers.py:481>)
- [auth.py — LocalGuardMiddleware](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/auth.py:19>)
- [config.py — child_env](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/config.py:49>)
- [Claude sandboxing](https://code.claude.com/docs/en/sandboxing): Windows native không có sandbox shell như macOS/Linux/WSL2.
- [Codex core sandbox model](https://github.com/openai/codex/blob/main/codex-rs/core/README.md): xem giới hạn legacy mode và chính sách filesystem theo nền tảng.
- [OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): framing phải đi cùng quyền thực thi tối thiểu và kiểm tra ở biên tool.

### C02. Snapshot, diff và commit

- [gitops.py — snapshot](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/gitops.py:98>)
- [gitops.py — changes/open_pr](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/gitops.py:126>)
- [tasks.py — snapshot fallback](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/tasks.py:117>)

### C03. Xóa dữ liệu và lịch sử AI

- [storage.py — purge_chat](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/storage.py:677>)
- [app.py — purge endpoint](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/app.py:300>)
- [agent.py — task file và log](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/agent.py:47>)
- [links.py — dữ liệu link theo phiên](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/links.py:47>)

### C04. Notification

- [qa-page.tsx — notifyLate](</Users/anhpham/Documents/Telegram dashboard/web/src/components/qa-page.tsx:167>)
- [use-events.ts — notifyNew](</Users/anhpham/Documents/Telegram dashboard/web/src/hooks/use-events.ts:25>)

### C05. Giới hạn dữ liệu và việc mở

- [app.py — Q&A scan/cache](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/app.py:705>)
- [storage.py — list_tasks](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/storage.py:1371>)
- [yt_dashboard.py — ticket paging](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/yt_dashboard.py:818>)
- [yt_dashboard.py — transitions](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/yt_dashboard.py:1010>)
- [digest.py — carry](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/digest.py:167>)

### C06. Trạng thái AI và ngôn ngữ

- [ai.py — language rule](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/ai.py:37>)
- [ai.py — task_state parser](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/ai.py:231>)
- [deep-think.tsx — task badge](</Users/anhpham/Documents/Telegram dashboard/web/src/components/deep-think.tsx:57>)

### C07. Release

- [release.yml](</Users/anhpham/Documents/Telegram dashboard/.github/workflows/release.yml:9>)
- [updater.py — kiểm chữ ký và cài gói](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/updater.py:127>)

### C08. Log AI và task list

- [agent.py — read toàn log](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/agent.py:115>)
- [tasks.py — list và events](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/tasks.py:182>)
- [tasks-feed.tsx — useTaskLog](</Users/anhpham/Documents/Telegram dashboard/web/src/components/tasks-feed.tsx:24>)
- [inbox.ts — useTaskList](</Users/anhpham/Documents/Telegram dashboard/web/src/lib/inbox.ts:284>)

### C09. Live read và cache Telegram

- [app.py — semaphore Briefing](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/app.py:668>)
- [app.py — member/Q&A cache](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/app.py:686>)
- [telegram.py — live reads](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/telegram.py:248>)

### C10. UI danh sách và luồng việc

- [today-page.tsx — nối nguồn và chuỗi việc](</Users/anhpham/Documents/Telegram dashboard/web/src/components/today-page.tsx:99>)
- [work-trail.tsx](</Users/anhpham/Documents/Telegram dashboard/web/src/components/work-trail.tsx:34>)
- [yt/tickets.tsx — render theo cap](</Users/anhpham/Documents/Telegram dashboard/web/src/components/yt/tickets.tsx:52>)

### C11. Q&A state và nhóm theo dõi

- [qa-page.tsx — local state](</Users/anhpham/Documents/Telegram dashboard/web/src/components/qa-page.tsx:46>)
- [qa-page.tsx — theo dõi 8 nhóm](</Users/anhpham/Documents/Telegram dashboard/web/src/components/qa-page.tsx:186>)
- [guide.json — hành vi được mô tả cho người dùng](</Users/anhpham/Documents/Telegram dashboard/web/src/lib/guide.json>)

### C12. Release report và đối chiếu

- [YouTrack release](</Users/anhpham/Documents/Telegram dashboard/web/src/components/yt/release.tsx>)
- [YouTrack report](</Users/anhpham/Documents/Telegram dashboard/web/src/components/yt/report.tsx>)
- [Đối chiếu BE](</Users/anhpham/Documents/Telegram dashboard/web/src/components/deep-think.tsx>)
- [guide.json — catalog feature hiện tại](</Users/anhpham/Documents/Telegram dashboard/web/src/lib/guide.json>)

### C13. AutoBE

- [autobe.py — queue](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/autobe.py:80>)
- [autobe.py — edited/flush](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/autobe.py:138>)
- [agent.py — lifecycle tiến trình](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/agent.py:137>)

### C14. Gửi tin và outbox

- [telegram.py — send và delivery_unknown](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/telegram.py:341>)
- [storage.py — outbox](</Users/anhpham/Documents/Telegram dashboard/telegram_dashboard/storage.py:1144>)
- [composer.tsx](</Users/anhpham/Documents/Telegram dashboard/web/src/components/composer.tsx>)

## 11. Checklist sử dụng tài liệu

- [ ] Chọn hạng mục từ đợt 1 và giữ mỗi thay đổi có phạm vi review rõ.
- [ ] Kiểm source hiện tại và xác nhận finding vẫn còn trước khi triển khai.
- [ ] Chốt quyết định sản phẩm chỉ liên quan hạng mục đang làm.
- [ ] Ghi baseline trước khi tối ưu; đánh giá đúng effect và risk của giải pháp đã chọn.
- [ ] Cập nhật trạng thái hạng mục bằng bằng chứng, không đánh dấu xong chỉ vì đã viết code.
- [ ] Khi hoàn tất, bổ sung kết quả thực tế trước/sau, lệnh kiểm tra, giới hạn còn lại và link commit/PR nếu có.

Trạng thái toàn bộ backlog tại thời điểm tạo tài liệu: **chưa triển khai; chưa có số đo sau cải tiến**.
