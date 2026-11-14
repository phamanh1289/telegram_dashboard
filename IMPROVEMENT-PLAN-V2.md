# Telegram Dashboard — plan cải tiến v2 (theo số liệu dùng thật)

Ngày: 13/11/2026. Thay cho `REVIEW-IMPROVEMENT-PLAN.md` (giữ lại làm phụ lục finding). Chưa triển khai mục nào.

## Trạng thái (13/11/2026, sau khi triển khai)

Đã làm, chưa commit; `pytest` 244 pass, ruff / typecheck / lint pass; chưa kiểm trên giao diện chạy thật.

| Mục | Kết quả | Ở đâu |
|---|---|---|
| A1 preview thông báo Q&A | Xong | `prefs.ts` `notifyPreview`, `qa-page.tsx`, `use-events.ts` |
| A2 semaphore Briefing | Xong, dùng chung với Q&A | `app.py` `qa_live` |
| A3 gate test khi release | Xong (job `test` trên macOS, `build` cần nó) | `release.yml` |
| A4 PR gom sửa tay | Xong: file đã sửa từ trước phiên được gắn cờ `mixed`, PR bị từ chối nếu chưa xác nhận | `gitops.py` `_mixed` / `open_pr`, `task-changes.tsx` |
| A5 trạng thái phiên | Xong: nhận nhãn và từ khóa cả tiếng Anh, prompt dặn giữ từ khóa | `ai.py` `_TASK_STATE` |
| A6 lọc log tắt server | Không cần: commit `2d2a9a0` đã sửa, log sau đó sạch | — |
| A7 đánh dấu lượt tự chạy | Xong (`auto: true` trong log phiên). `ref` trống là dữ liệu cũ, không phải lỗi | `agent.py` `start` |
| B1 phanh quota 80% | Xong | `autobe.py` `_over` / `_hold` |
| B2 hàng chờ xuống DB | Xong, khởi động lại thì chạy tiếp (vẫn qua phanh quota) | bảng `auto_pending`, `AutoBe.restore` |
| Purge phiên AI | Xong: xóa mọi phiên liên quan, dùng chung `remove_task` | `tasks.py`, `app.py`, `local_data.py` |
| Effort lượt relay | Xong: tối đa medium | `tasks.py` `RELAY_EFFORT` |
| Sandbox Windows | Xong: Claude không có shell trên Windows | `providers.py` `SHELL_OK` |
| Sandbox Codex | Xong: profile chặn đọc `data/`, `.env`, `~/.ssh`…; đã thử bằng file canary | `providers.py` `_codex_sandbox` |

Điều tra: `ConnectionError` là log của Telethon khi mất mạng, không phải lỗi 500 của app. `answer` / mascot trên Antigravity treo trong hai ngày 11–12/11 (provider), YouTrack AI trên Codex lỗi 4 lần trong 2 phút ngày 09/11 rồi thôi: không có gì để sửa trong code.

Khác bản cũ: mỗi mục phải có số liệu từ `data/` hoặc một dòng code cụ thể; mục không có căn cứ thì nằm ở §7 "Bỏ".

## 0. Số liệu nền (01–13/11/2026, 13 ngày)

Nguồn: `data/claude_runs.jsonl` (449 lượt AI), `data/dashboard.sqlite3`, `data/tasks/*.log.jsonl`, `data/server.log`.

| Tính năng AI | Lượt | Lỗi | Chi phí quy đổi | p50 / p90 |
|---|---|---|---|---|
| AI Agent (`agent`) | 231 | 11 | $863 | 74 s / 203 s |
| YouTrack AI | 84 | 24 | $0,78 | 9 s / 35 s |
| Digest | 44 | 9 | $0,18 | 92 s / 259 s |
| Links | 29 | 0 | $0,21 | 20 s / 29 s |
| Draft | 11 | 1 | $0,10 | 26 s / 30 s |
| Briefing | 4 | 0 | $0,02 | 56 s / 75 s |
| Answer | 3 | 3 | 0 | 169 s / 402 s |

- AI Agent chiếm 99,8% chi phí quy đổi. 208 lượt chạy `claude-opus-5-5` (178 lượt effort high) = $850, khoảng $4,1 mỗi lượt, trung bình 1,5 triệu token cache-read mỗi lượt. Quota tuần đọc ở lượt cuối: 61%. Chi phí là số CLI báo theo giá API; với gói thuê bao thì nó phản ánh quota, không phải tiền trả thêm.
- 27 phiên, 103 lượt gõ, phiên dài nhất 10 lượt. Log phiên lớn nhất 178 KB, result lớn nhất 7,6 KB, DB 1 MB, 479 tin, 14 nhóm theo dõi.
- Outbox: 33 tin đã gửi, 0 tin lỗi hay "chưa rõ đã gửi". Báo lại (`loop_back`): 0 dòng. Digest lưu: 1 dòng. Rule tự chạy: 1.
- `server.log`: 610 "Exception in ASGI application", trong đó khoảng 340 là `CancelledError` lúc tắt server.

Không đo được: số lượt do Vòng BE tự gửi (log lượt không đánh dấu), chi phí theo từng phiên từ `claude_runs.jsonl` (`ref` trống ở 206/231 lượt agent).

## 1. Feature hiện tại: cần improve gì

Luồng chính hôm nay: tag từ bot BE → Hôm nay / Việc cần xử lý → Giao AI Agent hoặc Vòng BE tự chạy (`autobe.py`, rule `relay` / `agent`) → phiên trả "Trạng thái" → bạn gõ lượt tiếp hoặc Done.

| Cần | Đã có | Ở đâu | Thiếu thật |
|---|---|---|---|
| Câu trả lời BE tự vào đúng phiên | Có | `autobe.py:104` `on_tags`, `:143` `flush` | Hàng chờ nằm trong RAM (`:83`), restart là mất lượt |
| Tự chạy không đốt quota | Không | `tasks.py` `send_turn` dùng model của phiên; `autobe.py` không đọc quota | Phanh theo quota (mục B1) |
| Biết phiên đang ở trạng thái nào | Có | `ai.py:231` `_TASK_STATE` | Regex bắt chữ "Trạng thái" tiếng Việt, trong khi `LANG_RULE` (`ai.py:37`) cho trả lời tiếng Anh |
| Biết vì sao một việc được đẩy lên | Có | `today-page.tsx:122–146` (Blocked, Quá hạn, trả lời mới, xong chưa xem, chờ người trả lời) | Không thiếu |
| Gửi lại an toàn khi mất kết nối | Có | `composer.tsx:200–214`, `:641` (thử lại dùng cùng yêu cầu) | Không thiếu; 0/33 tin rơi vào trường hợp này |
| Tắt preview thông báo có hiệu lực mọi nơi | Một nửa | `use-events.ts:35` có kiểm; `qa-page.tsx:174` không | `notifyLate` luôn đưa nội dung câu hỏi |
| Đo được Vòng BE dùng bao nhiêu | Không | log lượt chỉ có `kind, at, text, cost, error` | Một trường đánh dấu lượt tự chạy |

Cần điều tra trước khi gọi là việc phải sửa:

- `answer` qua Antigravity: 3/3 lượt bị hủy sau 169–402 s. Có vẻ treo tới khi bạn bấm hủy.
- YouTrack AI lỗi 24/84: 16 lượt `ai_failed` dồn vào 03–05/11 (có thể đã sửa), còn 4 lượt trên Codex ngày 09/11.

## 2. Feature mới / next step

Dữ liệu chỉ ủng hộ hai việc mới, cả hai nằm trên Vòng BE:

| Việc | Lối vào hiện có | Vì sao chưa đủ |
|---|---|---|
| B1. Phanh quota cho Vòng BE: quota 5 giờ hoặc tuần vượt ngưỡng thì giữ câu trả lời ở hàng chờ và báo trên trang, không tự chạy | Cài đặt rule tự chạy + thẻ quota ở trang tài khoản | Hai thứ này không nối với nhau: một lượt tự chạy tốn khoảng $4 quy đổi và không ai bấm |
| B2. Hàng chờ Vòng BE lưu xuống DB (theo phiên + id tin) | `autobe.pending` | Mất khi restart; app tự restart sau mỗi lần cập nhật |

Không đề xuất thêm màn, nút hay mục menu mới.

## 3. Security

Hôm nay đã có: `LocalGuardMiddleware` + cookie token, `child_env()`, khung "dữ liệu không tin cậy", sandbox Claude + `_data_deny`, Antigravity không shell, `data/` 0700 và file 0600, action pin SHA.

| Cần | Đã có | Ở đâu | Thiếu thật |
|---|---|---|---|
| Xóa dữ liệu nhóm xóa cả bản sao trong phiên AI | Không | `storage.py:688` `purge_chat` không đụng `tasks` | Gọi lại `delete_task` + `delete_task_files` (đang dùng ở `local_data.py:190`) cho phiên gắn nhóm đó |
| Test bảo vệ chạy trước khi ký bản phát hành | Không | `release.yml` chỉ build + ký | Job `test` (ruff, pytest gồm `test_repo_guards.py`, typecheck, lint) và `build` `needs` nó |
| Lượt Codex có tool không đọc được `data/` | Chưa rõ | `providers.py:465–476`: `-s read-only`, không có danh sách chặn đọc như `_data_deny` | Kiểm tài liệu Codex xem có chặn đọc theo đường dẫn không. 13 lượt có tool chạy trên Codex trong 13 ngày |
| Windows không chạy shell khi thiếu sandbox | Không (cố ý) | `providers.py:90`, đã ghi `ponytail:` | Quyết định của bạn: chặn chế độ sửa trên Windows hay giữ |
| Preview thông báo | Một nửa | xem §1 | Một dòng |

## 4. Risk code base

| Cần | Đã có | Ở đâu | Thiếu thật |
|---|---|---|---|
| PR chỉ chứa phần AI sửa | Một nửa | `gitops.py:192` commit theo path; `tasks.py:119` snapshot lỗi thì `base=None` | `open_pr` từ chối khi `base` là None; liệt kê file đã bẩn trước snapshot và không tự gom |
| Lỗi thật không chìm trong log | Không | `__main__.py:102` có bộ lọc nhưng `CancelledError` vẫn ghi khoảng 340 lần | Sửa bộ lọc. Lỗi `stats` ở `local_data.py:126` lặp 6 lần mới được thấy (đã sửa trong working tree, chưa commit) |
| Mất kết nối Telegram trả lỗi có mã | Chưa rõ | 9 lần `ConnectionError` lên tới ASGI | Tìm endpoint nào để lọt |
| Giới hạn đọc Telegram áp cho cả tài khoản | Một nửa | `app.py:704`, `:720` dùng chung; `app.py:685` (Briefing) tạo mới mỗi request | Đưa semaphore Briefing ra ngoài handler |

## 5. Performance

I/O không phải nút thắt ở dữ liệu thật: log lớn nhất 178 KB (bản cũ đo với 1–40 MB), DB 1 MB, 27 phiên. Thời gian và quota nằm ở lượt AI Agent: p50 74 s, p90 203 s, 1,5 triệu token cache-read mỗi lượt.

| Đòn bẩy | Hiệu quả dự kiến | Điều kiện |
|---|---|---|
| Effort / model riêng cho lượt relay ("BE confirm, trace và fix") thay vì luôn opus high | Lớn nhất, nhưng chưa có số | Bạn chốt có chấp nhận lượt relay chạy effort thấp hơn không |
| Ghi `ref` cho mọi lượt agent trong `claude_runs.jsonl` | Không nhanh hơn; cho biết phiên nào ngốn context | Xem vì sao 206/231 lượt đang trống |
| B1 phanh quota | Không nhanh hơn; chặn tiêu quota ngoài ý muốn | — |

## 6. Thứ tự làm

**Đợt A — nhỏ, không cần chốt gì (mỗi việc dưới khoảng 30 dòng):**

1. `notifyLate` theo `notify_preview`.
2. Semaphore Briefing dùng chung.
3. Job test trong `release.yml`.
4. `open_pr` từ chối khi thiếu baseline + cảnh báo file bẩn trước phiên.
5. Token trạng thái cố định (`STATE: done|waiting|you`), giữ regex cũ làm fallback.
6. Sửa bộ lọc `CancelledError` lúc tắt server.
7. Đánh dấu lượt tự chạy trong log phiên; ghi `ref` cho lượt agent.

**Đợt B — cần bạn chốt trước:**

| Việc | Câu cần chốt |
|---|---|
| B1 phanh quota | Ngưỡng bao nhiêu % cho cửa sổ 5 giờ và tuần |
| B2 hàng chờ xuống DB | Sau restart: tự chạy tiếp hay chờ bạn bấm |
| Purge phiên AI | Phiên chứa tin của nhiều nhóm: xóa cả phiên hay giữ |
| Effort lượt relay | Có hạ effort / model cho lượt tự chạy không |
| Sandbox Windows / Codex | Chặn hay giữ như hiện tại |

**Điều tra (chưa phải việc):** `answer` trên Antigravity 3/3 hủy; `ConnectionError` lọt ra ASGI; YouTrack AI lỗi trên Codex.

## 7. Bỏ khỏi backlog cho tới khi số liệu đổi

| Mục bản cũ | Lý do |
|---|---|
| P01 đọc log theo cursor | Log lớn nhất 178 KB, dưới 0,1 ms mỗi lần đọc theo chính số đo của bản cũ |
| P02 task list gọn | 27 phiên, result tối đa 7,6 KB |
| P04 windowing, R06 tách module | Không có số đo, không có luồng đang sửa cần tới |
| R03 việc Briefing mở | 1 digest lưu, 4 lượt Briefing trong 13 ngày |
| F01 đồng bộ Q&A | Chưa có dấu hiệu dùng hai trình duyệt |
| F02 kết luận có phiên bản, F04 sẵn sàng release, F05 tìm xuyên nguồn | Báo lại 0 lần dùng; không có dữ liệu nào cho thấy thiếu |
| F03 hành động tiếp theo, F06 kiểm sau delivery_unknown | Đã có (xem §1) |
| R02 phân trang | Chưa nhóm nào chạm 600 tin (479 tin trên 14 nhóm) |
| A01 phần quyền sửa theo thời hạn / lượt | Gộp vào câu chốt "Effort lượt relay" và B1; chưa cần mô hình quyền riêng |
