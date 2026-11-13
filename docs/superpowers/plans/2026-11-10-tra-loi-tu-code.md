# Trả lời từ code: plan

> Ai đó trong nhóm hỏi tôi về logic / nghiệp vụ / tiến độ → AI đọc code dự án và trả lời → tôi copy hoặc gửi luôn thành reply.

## 1. Job story

**Khi** một người trong group hỏi tôi "màn X validate gì?", "case Y xử lý sao?", "feature Z xong chưa?",
**tôi muốn** AI đọc code dự án rồi soạn câu trả lời có căn cứ, đúng giọng với người hỏi,
**để** trả lời trong 1–2 phút thay vì mở IDE dò code, và không trả lời sai.

Thành công là: mở tin → bấm 1 lần → đọc kết luận + căn cứ → bấm **Gửi** (hoặc Copy) trên bản nháp. Không phải gõ prompt.

## 2. Hiện trạng: đã có gần đủ, chỉ thiếu 3 mảnh

| Cần | Đã có | Ở đâu |
|---|---|---|
| Mở panel trả lời cho *bất kỳ* tin nào (tag hoặc không) | ✅ `onReply` → `Composer` | `message-item.tsx`, `inbox.tsx` |
| AI đọc tin + ngữ cảnh + ảnh, stream, nút dừng | ✅ `/api/ai/draft` → `AiService.run` | `app.py:409`, `ai.py:325` |
| AI đọc thư mục code (read-only, đã đăng ký) | ✅ server nhận `project`, kiểm `has_project` + `reader_available`, timeout 600s | `ai.py:345` |
| Danh sách dự án + picker + pref nhớ dự án | ✅ `useProjects`, `ProjectPicker`, `readAgentProject` | `project-picker.tsx`, `prefs.ts:138` |
| Giọng câu trả lời theo vai trò người hỏi | ✅ `ASK_STYLE` trong `SYSTEM_PROMPT` | `ai.py:97` |
| Gửi reply an toàn (request_id, `delivery_unknown`, nhắc lại, done loop) | ✅ `submit(body)` | `composer.tsx:303` |
| Nháp AI → ô soạn | ✅ thẻ radio "Mẫu AI" | `composer.tsx:458` |
| **Chọn dự án trong Trợ lý AI** | ❌ frontend gửi cứng `project: null` | `composer.tsx:209` |
| **Prompt "trả lời câu hỏi từ code"** | ❌ chỉ có task "tóm tắt + 3 nháp theo quan hệ" | `ai.py:367` |
| **Copy / Gửi ngay trên từng bản nháp** | ❌ chỉ chọn vào ô soạn rồi Gửi | `composer.tsx:458` |

→ Không làm màn mới, không endpoint mới, không session AI Agent mới. Mở rộng đúng panel Trợ lý AI đang có.

Vì sao không dùng AI Agent session (Đối chiếu BE): đó là việc dài, sống ở tab khác, nút gửi gửi *tin mới* (`quote:false`). Ở đây người dùng đang đứng trong panel trả lời của chính tin đó, cần câu trả lời là *reply* ngay tại chỗ.

## 3. Thiết kế UX

### Luồng

1. Tin hỏi xuất hiện (Inbox nếu tag tôi; hoặc ở danh sách tin nhóm) → mở **Trả lời** như mọi khi.
2. Trong **Trợ lý AI**, ô prompt có thêm chip **`</> Đọc code: <dự án> ▾`** (trong `tools`, cạnh chọn model).
   - Mặc định: dự án chọn lần trước (`replyCode` pref); lần đầu là "Không đọc code".
   - Có dự án → nút chạy đổi nhãn **"Trả lời từ code"** (icon `Code`), không cần gõ prompt.
   - Không dự án → giữ nguyên hành vi cũ "Tóm tắt & gợi ý".
3. Chạy: `AiThinking` với dòng riêng cho đọc code ("Đang lục code {dự án}…", "Đang lần theo API…", "Đang đối chiếu nghiệp vụ…"), `ai-ring` trên ô prompt, nút dừng. Thời gian thường 30s–3 phút.
4. Kết quả, 2 khối:
   - **Thẻ kết quả (cho tôi đọc)**: Trả lời · Căn cứ (`path:hàm`) · Độ chắc · Cần xác nhận.
   - **Bản nháp trả lời (gửi người hỏi)**: 2 thẻ **Ngắn gọn** / **Đầy đủ**; mỗi thẻ có **Copy** và **Gửi** ở góc phải.
5. **Gửi** trên thẻ = gửi đúng thẻ đó thành *reply* vào tin hỏi (cùng `submit` của ô soạn → cùng trạng thái Đã gửi / không rõ / lỗi). Muốn sửa trước: bấm thẻ (như cũ) → vào ô soạn → sửa → Gửi.

### Wireframe (cột Trợ lý AI)

```
┌ ✨ Trợ lý AI ──────────────────── [Giao AI Agent] [Tạo ticket] ┐
│                                     ┌──────────────────────────┐ │
│                                     │ </> Trả lời từ code       │ │  ← UserBubble
│                                     └──────────────────────────┘ │
│ ┌ Kết quả ─────────────────────────────────────── 48s ┐          │
│ │ **Trả lời:** OTP hết hạn sau 120s, nhập sai 5 lần   │          │
│ │   khoá 15 phút.                                     │          │
│ │ **Căn cứ:**                                         │          │
│ │  • `auth/OtpViewModel.kt:verify` đếm sai, khoá …    │          │
│ │  • `core/Config.kt:OTP_TTL` = 120                   │          │
│ │ **Độ chắc:** Cao (thấy cả app); rule khoá ở BE      │          │
│ │   chưa thấy.                                        │          │
│ │ **Cần xác nhận:** BE có khoá riêng không?           │          │
│ └─────────────────────────────────────────────────────┘          │
│ Trả lời cho Lan (PO)                                              │
│ ┌ Ngắn gọn ─────────────────────────────── [⧉] [➤] ┐            │
│ │ Mã OTP dùng được 2 phút; sai 5 lần sẽ bị khoá 15p. │            │
│ └────────────────────────────────────────────────────┘            │
│ ┌ Đầy đủ ───────────────────────────────── [⧉] [➤] ┐            │
│ │ …                                                  │            │
│ └────────────────────────────────────────────────────┘            │
│ ╭────────────────────────────────────────────────────╮            │
│ │ Thêm yêu cầu (không bắt buộc)…                     │            │
│ │ [</> Đọc code: cagent-android ▾] [model▾] (Trả lời từ code ↑) │
│ ╰────────────────────────────────────────────────────╯            │
└───────────────────────────────────────────────────────────────────┘
```

### Quy tắc thiết kế (theo CLAUDE.md)
- Ô prompt ghim đáy; chip dự án + nút chạy nằm **trong** `AiPromptBox` (`tools` / `actions`). Không thêm khung giới thiệu.
- Chọn dự án dùng `ProjectPicker` (đã là base-ui, cùng kiểu `Dropdown`); mọi icon giải thích qua `Hint`.
- Copy / Gửi trên thẻ là icon-button `ASK_BTN` + `Hint` ("Copy", "Gửi trả lời cho {tên}"), giống nút trên câu hỏi của AI Agent → cùng ngôn ngữ thị giác.
- Thẻ đã gửi: icon ✓ màu `ok`, nút Gửi disable; trạng thái không rõ: icon màu `warn` + hint "xem nhóm trước khi gửi lại".
- Chữ chính `text-ink`; cỡ chữ theo token; chuỗi mới có vi + en.

## 4. Định dạng câu trả lời (prompt `ANSWER_TASK`)

Phần 1, Markdown, cho tôi đọc:
- **Trả lời:** 1–3 câu, kết luận thẳng câu hỏi (nhiều câu hỏi: từng ý một).
- **Căn cứ:** 2–5 gạch, mỗi gạch `path:hàm` + code đó làm gì. Không thấy code liên quan: nói rõ.
- **Độ chắc:** Cao / Trung bình / Thấp + lý do một câu (vd. chỉ thấy phía app, rule nằm ở BE).
- **Cần xác nhận:** điều code không trả lời được (bỏ mục nếu không có).
- Câu hỏi tiến độ / deadline: code không biết lịch → nói phần code đã có (màn, API, flag, TODO), ghi "tiến độ cần xác nhận" (Phase 2 bổ sung git log + ticket).

`===` rồi 2 bản nháp ngăn bởi `---`: 1) Ngắn gọn (1–2 câu) 2) Đầy đủ (≤5 câu). Ngôi thứ nhất, plain text, viết theo `ASK_STYLE` cho người hỏi (dev → kỹ thuật được nêu API/field; PO/QA/QC/khách → ngôn ngữ màn hình / hành vi, **không** path, tên hàm, tên field). Không trích secrets.

Cùng parser `===` / `---` đang có → không đổi `AiResult`.

## 5. Plan thực thi

### Phase 1: MVP (≈ nửa ngày)

| # | File | Thay đổi | Kiểm |
|---|---|---|---|
| 1 | `telegram_dashboard/ai.py` | Thêm `ANSWER_TASK`; `run` nhận `kind="answer"`: dùng `ANSWER_TASK`, áp dòng "me / ngôi thứ nhất", `my_style`, parser `===`/`---` (đổi điều kiện `kind == "draft"` → `kind != "ticket"`); khi có `project` thêm câu "được đọc file trong thư mục hiện tại (chỉ đọc)" để không mâu thuẫn "You have no tools" của `SYSTEM_PROMPT`. Model: giữ model "chat" đang hiện ở ô prompt (không đổi sang model task, để chọn model trên UI là đúng model chạy). | test bên dưới |
| 2 | `telegram_dashboard/app.py:416` | `ai_draft`: `"answer" if body.project else "draft"`. Không đổi model request. | |
| 3 | `tests/test_ai.py` | 1 test: `run("answer", project=…)` → prompt có `ANSWER_TASK`, `cwd`=project, tách được 2 options + analysis. | `uv run pytest tests/test_ai.py` |
| 4 | `web/src/lib/prefs.ts` | `readReplyCode()` / lưu `replyCode` (path hoặc ""). | |
| 5 | `web/src/components/composer.tsx` | State `code` từ `readReplyCode`; truyền `project: code || null`; `tools` thêm `ProjectPicker` (compact, `none="Không đọc code"`, ẩn khi `!usesCode(role)` hoặc không có dự án → hint "Thêm dự án ở AI Agent"); nhãn nút chạy + bubble + `THINKING` đổi theo `code`; `onError` map thêm `project_not_found`, `ai_scope_not_allowed` (nhóm chưa theo dõi). | typecheck |
| 6 | `composer.tsx` thẻ "Mẫu AI" | Header mỗi thẻ thêm `[Copy]` (`copyText`) + `[Gửi]` (`submit(o)`); `preventDefault` để không bật radio; disable khi `pending`, `targetDeleted`, `o.length > MAX`; nhãn thẻ: 2 options + chế độ code → "Ngắn gọn"/"Đầy đủ", 3 → `LEVELS` như cũ. Áp cho **cả** chế độ thường (cùng một code). | thử tay |
| 7 | `web/src/components/ai/chat.tsx` | `AiSkill` thêm `"answer"` (icon `Code`, "Trả lời từ code") cho `AiIdle` khi đã chọn dự án. | |
| 8 | `lib/i18n/en/*.ts` | Bản en cho mọi chuỗi mới. | typecheck |
| 9 | `web/src/lib/guide.json` + `guide.en.json` | Mục Trợ lý AI: chip "Đọc code", nút Copy / Gửi trên bản nháp. | |
| 10 | Log chạy AI | `feature="answer"` hiện trong Cài đặt › Claude › lượt chạy: thêm nhãn nếu trang đó map tên feature. | |

Xong: `uv run pytest tests/test_ai.py tests/test_repo_guards.py`, `npm run typecheck && npm run lint` trong `web/`, e2e trên bản copy ở scratchpad (không đụng `:8765`, không build đè `web/out`), `codegraph sync`.

### Phase 2: câu hỏi tiến độ (làm khi Phase 1 dùng thấy thiếu)

- `gitops.py`: `recent(project)` = `git log --since=14.days -n 40 --pretty='%h %ad %an %s'` + nhánh hiện tại (reuse `_git`). Đưa vào prompt dạng `<git_log>` qua `data_json` (commit message là text người khác viết → không tin cậy).
- Ticket: ID có trong tin (`TICKET_ID`) + `related` (Composer đã tính sẵn bằng `useOpenSimilar`) → gửi `ticket_ids` lên; server đọc summary / state / assignee / sprint từ YouTrack (reuse fetch ticket của `yt_dashboard`). Prompt: tiến độ = state ticket + commit gần đây + code hiện có.

### Phase 3 (đã làm)
- Chạy nền: lượt "Trả lời từ code" gửi `X-Ai-Job` (dùng chung kho `AiJobs` của YouTrack), job lưu theo tag (`replyJob:<chat>:<msg>`); đóng panel vẫn chạy, mở lại tag đọc tiếp qua `GET /api/ai/job/{id}`; "Hủy" gọi `DELETE` và xoá job.
- ~~Menu ⋯ trên dòng tin › "Trả lời từ code"~~: đã gỡ (2026-11-10). Trùng lối vào đã có: bấm dòng tin mở khung trả lời, chọn dự án trong ô prompt rồi chạy; thêm một nút nữa cho cùng việc chỉ làm thêm đường đi.

## 6. Edge case & lỗi

| Tình huống | Hành vi |
|---|---|
| Chưa đăng ký dự án nào | Chip disable + Hint "Thêm dự án ở AI Agent"; vẫn dùng chế độ cũ. |
| Dự án đã bị xoá | 404 `project_not_found` → báo lỗi trong thẻ + chip về "Không đọc code". |
| Không có CLI đọc dự án | `ai_agent_missing` (đã có text). |
| Nhóm chưa theo dõi | `ai_scope_not_allowed` → "Theo dõi nhóm này để AI đọc được tin". |
| Code không trả lời được (deadline, ưu tiên) | Độ chắc Thấp + mục Cần xác nhận; nháp nói thẳng "để em check lại với …". |
| Người hỏi là PO/khách | Nháp không có path / tên hàm (ASK_STYLE); path chỉ ở thẻ kết quả cho tôi. |
| Nháp > 4096 ký tự | Nút Gửi disable, Copy vẫn được. |
| Gửi timeout | `delivery_unknown` như ô soạn: "xem nhóm trước khi gửi lại", không tự gửi lại. |
| Đóng panel giữa lượt | Dừng lượt (như hiện tại). |
| Tin có ảnh chụp màn | Ảnh đã được đưa vào (`images`). |

## 7. An toàn
- Chỉ thư mục đã đăng ký (`has_project`), CLI read-only, **không** shell (lượt mang text người khác). Không thêm ngoại lệ sandbox.
- Tin người khác qua `data_json` (escape `<`) như mọi prompt; prompt dặn không trích `.env` / key / token.
- Gửi luôn cần cú bấm của tôi; không tự gửi.

## 8. Acceptance criteria
- [ ] Mở trả lời một tin hỏi, chọn dự án, bấm "Trả lời từ code" → có thẻ kết quả với ≥1 `path:hàm` (khi code có liên quan) và 2 bản nháp.
- [ ] Copy trên thẻ → clipboard đúng nội dung + toast.
- [ ] Gửi trên thẻ → tin reply vào đúng tin hỏi; thẻ hiện ✓; lỗi / không rõ hiện như ô soạn.
- [ ] Không chọn dự án → hành vi cũ không đổi (3 nháp theo quan hệ), giờ cũng có Copy / Gửi.
- [ ] Role QA/PO: không thấy chip (giữ luật `usesCode`).
- [ ] Dự án đã chọn được nhớ qua lần mở sau.
- [ ] vi / en đủ; guide cập nhật; test + typecheck + repo guards xanh.

## 9. Quyết định mở
1. **PO/QA có được đọc code không?** Đề xuất: giữ `usesCode(role)` (đồng bộ YouTrack `_code_dir`). Nếu muốn PO hỏi nghiệp vụ từ code: bỏ gate cho riêng chế độ này, câu trả lời viết non-tech.
2. **Gửi trên thẻ: gửi ngay hay đưa vào ô soạn?** Đề xuất: gửi ngay (giống nút gửi câu hỏi ở AI Agent); sửa thì bấm thẻ như cũ.
