# Digest — tóm tắt hội thoại nhóm bằng AI

Ngày: 2026-10-31 · Trạng thái: chờ duyệt · Phạm vi: P1

## Bài toán

- Nhiều group Telegram công việc; mỗi group bàn lẫn lộn nhiều chủ đề, không dùng topic.
- Cần tóm tắt theo **khoảng thời gian**, theo **đoạn hội thoại**, hoặc theo **danh sách tin tự chọn**.
- Kết quả phải trả lời: **đã chốt gì**, **có gì thay đổi**, **ảnh hưởng team nào** (web, mobile…), **PO/PM cần confirm gì**.

Thành công = mở 1 group sau nửa ngày vắng mặt, trong < 1 phút biết được chủ đề nào đã chốt, việc gì liên quan mình, câu nào đang chờ confirm, và bấm được về tin gốc để kiểm chứng.

## Quyết định đã chốt

1. **Consent theo chat** cho Digest (bật 1 lần cho cả group, có hạn, thu hồi được).
2. **Digest độc lập với luồng tag/draft.** Không dùng composer, không dùng `ai_permissions` theo từng tin, không đổi trạng thái `handled/pinned/snoozed`. Chỉ dùng chung lớp gọi provider (`AiService._call`) và Telethon client.
3. **Một lần gọi AI cho cả khối tin** (không chia chunk). Giới hạn 400 tin / 80.000 ký tự; vượt thì báo lỗi và bảo người dùng thu hẹp khoảng.

## Ràng buộc từ code hiện có

- DB chỉ lưu tin tag/reply bạn → Digest **đọc lịch sử trực tiếp từ Telegram** (`iter_messages`), **không lưu nội dung tin** vào SQLite.
- `/api/ai/summary` hiện có (30 tin, gắn với grant từng tin) giữ nguyên, không dùng cho Digest.
- AI chỉ trả text; tin nhóm là dữ liệu không tin cậy (giữ `SYSTEM_PROMPT` chống prompt injection).

## Kiến trúc

```
UI Digest view ──► GET  /api/chats/{id}/history     ──► Telethon (đọc live, không lưu)
              ──► GET/PUT /api/chats/{id}/digest-consent ──► SQLite: digest_consents
              ──► POST /api/digest ──► DigestService ──► kiểm consent ─► đọc lại tin từ Telegram
                                                      ─► AiService._call ─► parse JSON ─► kiểm consent lần 2
```

### Backend

**File mới `telegram_dashboard/digest.py`** — `DigestService(settings, store, db, bridge, ai)`, một hàm chính `run(req) -> DigestResult`.

**Bảng mới** (thêm vào schema trong `storage.py`):

```sql
CREATE TABLE IF NOT EXISTS digest_consents (
  chat_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

Thu hồi = xoá dòng. Hợp lệ khi có dòng và `expires_at > now`. Không phụ thuộc `AI_REQUIRE_CONSENT`: Digest luôn cần consent chat.

**Transport** (`telegram.py`, Protocol + Telethon impl), 2 hàm:

- `fetch_range(chat_id, since, until, limit) -> list[StoredMessage]`: `iter_messages(offset_date=until)` lùi tới `since`, trả theo thứ tự cũ → mới.
- `fetch_ids(chat_id, ids) -> list[StoredMessage]`: `get_messages(ids=...)`, bỏ `None`.

**API**

| Method | Path | Body / Query | Trả về |
|---|---|---|---|
| GET | `/api/chats/{chat_id}/digest-consent` | — | `{enabled, expires_at}` |
| PUT | `/api/chats/{chat_id}/digest-consent` | `{enabled: bool, days: 1..90}` | `{enabled, expires_at}` |
| GET | `/api/chats/{chat_id}/history` | `since`, `until` (ISO), `limit≤400` | `MessageDTO[]` (live) |
| POST | `/api/digest` | `DigestRequest` | `DigestResult` |

`history` chỉ để xem/chọn tin, không gửi gì cho AI → không cần consent, chỉ cần chat có trong danh sách và Telegram đang kết nối. Server đọc `limit+1` tin và trả `{items, truncated}`; khi `truncated`, UI khoá nút chạy và báo "Hơn 400 tin — thu hẹp khoảng thời gian".

`teams` rỗng = AI tự đặt tên team. `until` rỗng = hiện tại.

```python
class DigestRequest(BaseModel):
    chat_id: str
    since: datetime | None = None          # dùng khi không có message_ids
    until: datetime | None = None          # mặc định = now
    message_ids: list[str] = Field(default=[], max_length=400)  # có thì ưu tiên hơn khoảng thời gian
    teams: list[str] = Field(default=[], max_length=10)          # mỗi tên ≤ 30 ký tự

class Ref(BaseModel):
    message_ids: list[str] = []

class DigestTopic(Ref):
    title: str; summary: str; status: Literal["decided", "open", "dropped"]
class DigestItem(Ref):
    text: str
    who: str = ""   # decisions: ai chốt · actions: người phụ trách · confirmations: hỏi ai (PO/PM/…) · impacts: tên team
    due: str = ""   # chỉ actions

class DigestResult(BaseModel):
    topics: list[DigestTopic] = []
    decisions: list[DigestItem] = []
    changes: list[DigestItem] = []
    impacts: list[DigestItem] = []
    confirmations: list[DigestItem] = []
    actions: list[DigestItem] = []
    raw: str = ""                 # chỉ có khi AI trả JSON hỏng: UI hiện text thô
    source_count: int
    since: datetime | None
    until: datetime | None
```

**Luồng `DigestService.run`**

1. AI chưa cấu hình → 503 `ai_not_configured`. Không có consent chat còn hạn → 403 `digest_consent_required`.
2. Đọc tin **từ Telegram phía server** (không tin text client gửi lên): `fetch_ids` nếu có `message_ids`, ngược lại `fetch_range` với `limit=401`. Phải có `since` hoặc `message_ids`, không thì 422.
3. > 400 tin hoặc tổng text > 80.000 ký tự → 422 `digest_too_large` (detail nói số tin). 0 tin → 422 `digest_empty`.
4. Dựng context JSON: `{id, at (HH:MM dd/MM), from ("me" nếu outgoing), reply_to, text}`; tin chỉ có media → text `[ảnh]` / `[file]` (+ caption nếu có). Bỏ tin rỗng.
5. Prompt: gom tin rời rạc thành chủ đề (dựa vào nội dung, `reply_to`, thời gian, người nói); trả **duy nhất JSON** theo schema trên; mọi mục phải có `message_ids` dẫn chứng; `impacts.who` chỉ được là một trong `teams` (nếu có); viết tiếng Việt; không bịa — thiếu thông tin thì để trống.
6. Gọi `AiService._call` (thêm tham số `timeout`, Digest dùng 120s cho HTTP provider; agent giữ `AGENT_TIMEOUT`).
7. Parse: bỏ code fence → `json.loads` → validate Pydantic. Lỗi → trả `raw=text`, các list rỗng. Lọc `message_ids` không thuộc tập đầu vào.
8. Kiểm consent lần 2; bị thu hồi trong lúc chạy → 409 `ai_permission_changed` (giống luồng draft).

### Frontend

**Lối vào:** nút "Tóm tắt" ở header của chat đang mở (chỉ hiện khi AI đã cấu hình). Mở **Digest view** thay chỗ message list, giống cách `TasksPage` thay chỗ; nút back quay lại chat.

**Digest view** (`web/src/components/digest-page.tsx`, 1 file):

- **Thanh trên:** preset `Hôm nay` · `24h` · `3 ngày` · `7 ngày` · tuỳ chọn (dùng lại `date-range.tsx`). Đổi khoảng → gọi `history`.
- **Banner consent** khi chưa bật: "Cho phép AI đọc nhóm này" + chọn thời hạn 7 / 30 / 90 ngày + nút Cho phép. Đã bật: dòng nhỏ "AI được đọc đến dd/MM · Thu hồi".
- **Cột trái — hội thoại live:** danh sách tin trong khoảng, mỗi tin có checkbox. Click = chọn/bỏ; Shift+click = chọn cả đoạn (tóm tắt "đoạn hội thoại"). Không chọn gì = tóm tắt cả khoảng. Nút chính: "Tóm tắt N tin".
- **Cột phải — kết quả**, theo thứ tự ưu tiên đọc: **Cần confirm** → **Đã chốt** → **Thay đổi** → **Ảnh hưởng team** (nhóm theo team) → **Việc cần làm** → **Chủ đề** (badge trạng thái). Mỗi mục có chip `#id`; bấm → cuộn tới và highlight tin đó ở cột trái.
- **Copy markdown** cho toàn bộ kết quả.
- Màn hình hẹp: hai cột xếp chồng, kết quả ở trên.

**Settings:** ô "Team cho Digest" (danh sách cách nhau bằng dấu phẩy), mặc định `Web, Mobile, Backend, QA, Design`, lưu ở `prefs.ts` (localStorage `digestTeams`), gửi kèm mỗi request.

Mỗi chat lưu bản kết quả gần nhất và mốc tin mới nhất đã tóm tắt (bảng `digests`, mốc chỉ tiến lên; xoá cùng consent). Mở Digest view: hiện bản đã lưu, mặc định preset "Từ lần trước", tin đã tóm tắt làm mờ, có vạch "Đã tóm tắt đến đây". Mọi khoảng đều chốt `until` lúc chọn để danh sách và bản tóm tắt khớp nhau.

## Lỗi & bảo mật

- Mọi nội dung tin chỉ đi: Telegram → RAM server → AI provider. Không ghi tin xuống đĩa, không log nội dung; chỉ lưu bản kết quả gần nhất (xoá khi thu hồi consent hoặc xoá dữ liệu chat).
- Consent kiểm 2 lần (trước và sau khi gọi AI). Banner nói rõ dữ liệu gửi provider không thu hồi được.
- Tin nhóm là dữ liệu không tin cậy: giữ `SYSTEM_PROMPT`, AI không có tool, kết quả chỉ hiển thị.
- Telegram mất kết nối → 503 `not_connected` (mã đang dùng, qua `bridge.ensure_connected()`).
- Mã lỗi mới cần thêm vào bản dịch UI: `digest_consent_required`, `digest_too_large`, `digest_empty`.

## Kiểm thử

Pytest với transport/provider giả như test hiện có (`tests/test_digest.py`):

- Không consent / consent hết hạn → 403; thu hồi giữa chừng → 409.
- > 400 tin hoặc > 80k ký tự → 422; 0 tin → 422.
- Server dùng tin đọc từ transport, không phụ thuộc text client.
- Parse: JSON hợp lệ; JSON bọc code fence; JSON hỏng → `raw`; `message_ids` lạ bị lọc.

Frontend: kiểm bằng preview (bật consent, chọn khoảng, shift-chọn đoạn, bấm chip trích dẫn, copy markdown, màn hẹp).

## Ngoài phạm vi P1

- **P2:** preset "từ lần đọc cuối". (Đã làm: lưu digest + mốc "từ lần trước"; trang Briefing: mọi group đang theo dõi, tóm tắt tuần tự các group có tin mới từ mốc, gom "Cần confirm" lên đầu.)
- **P3:** tạo YouTrack issue từ mục "Việc cần làm"/"Cần confirm"; đánh dấu mục confirm đã xử lý.
- Chia chunk / map-reduce cho khoảng > 400 tin — chỉ làm khi giới hạn này thực sự chật.
- Ảnh: chỉ đánh dấu `[ảnh]`, AI không đọc nội dung ảnh.
