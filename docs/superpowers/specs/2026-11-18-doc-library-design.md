# Kho tài liệu (Tài liệu): design

Ngày: 2026-11-18 · Trạng thái: chờ duyệt

## 1. Ý định và lý do

Trong lúc làm feature, tài liệu tới từ BE, PO và Dev qua ba nguồn: YouTrack, Telegram, file rời trên máy. Người dùng
muốn **một nơi** để xem lại và tìm nhanh trong toàn bộ tài liệu đó.

Ràng buộc chính: lượng tài liệu rất lớn nên **việc gì code làm được thì code làm (0 token)**; AI chỉ chạy khi người
dùng chủ động gọi, và chỉ nhận phần nội dung code đã lọc sẵn.

### Hiện trạng đo được (data/ ngày 2026-11-18)

- Tài liệu chỉ vào app qua link trong prompt phiên AI Agent: `link_block` (`backend/telegram_dashboard/links.py`) tải
  YouTrack article / ticket / tin t.me, bài dài hơn `INLINE_CHARS` (8k) lưu vào `agent-links/<task_id>/`.
- Lưu **riêng từng phiên**: `VA-A-128` (~100KB, 2 heading) được tải và lưu 5 lần cho 5 phiên, `VA-A-175` 4 lần.
- Bài trên `SUMMARY_FROM` (30k) có dưới 3 heading thì gọi AI tóm tắt mỗi lần lưu: tính năng `links` trong
  `data/claude_runs.jsonl` đã chạy 36 lượt, ~310k token vào, ~155k token ra.
- Không có màn nào xem tài liệu trong app (chỉ mở được YouTrack). ⌘K tìm tin tag (`text_fold LIKE`) và ticket
  (`/api/youtrack/search`), không tìm trong nội dung tài liệu.
- Link trong tin đã lưu: 15 ticket, 12 KB article, 5 Zeplin. Bot BE có 179 tin chữ (dài tới 3k ký tự). **Chưa có tin
  nào đính kèm file tài liệu** (`media_kind='document'` = 0).

## 2. Mục tiêu / Không làm / Thất bại

**Mục tiêu**

1. Một kho chung: mỗi tài liệu lưu một bản, mọi nơi dùng lại; không tải lại, không tóm tắt lại khi nội dung chưa đổi.
2. Màn **Tài liệu**: duyệt theo nguồn, tìm trong nội dung, đọc đúng đoạn khớp. Toàn bộ bằng code.
3. AI theo yêu cầu, có trần token: hỏi trên các đoạn code đã lọc; tóm tắt cache theo nội dung.
4. Phiên AI Agent dùng lại kho: hết việc tải và tóm tắt lặp ở mục 1.

**Không làm (bản này)**

- Tìm theo nghĩa bằng embedding / vector.
- Đồng bộ toàn bộ ticket YouTrack (đã có tìm ticket).
- PDF (cần thêm dependency), Google Docs, Swagger, Confluence, Zeplin.
- File đính kèm trong tin Telegram (dữ liệu chưa có trường hợp nào).
- So sánh phiên bản khi tài liệu đổi.
- Upload file qua trình duyệt; sửa tài liệu trong app.
- Cho phiên AI Agent tự tìm trong cả kho.
- Mục tìm tài liệu trong ⌘K.

**Thất bại dù chạy được**

- Một thao tác xem / tìm / mở màn mà gọi AI ngầm.
- Một lượt hỏi AI gửi cả tài liệu dài thay vì các đoạn đã lọc.
- Cùng một nội dung (cùng hash) bị tóm tắt hai lần.
- Tin của nhóm Telegram A lọt vào câu trả lời gửi về nhóm B qua kho.
- Lỗi đồng bộ (401 / mạng) hiện ra như "chưa có tài liệu".

## 3. Các cách đã cân nhắc

| Cách | Mô tả | Đánh đổi | Kết quả |
|---|---|---|---|
| **A. File trên đĩa + chỉ mục SQLite** | Nội dung là file `.md` (hoặc file gốc của người dùng), metadata + FTS5 trong `dashboard.sqlite3` | Hai nơi phải khớp nhau: cần đối chiếu hash | **Người dùng chọn** |
| B. Tất cả trong SQLite | Nội dung, metadata, FTS5 cùng một DB | Nhất quán sẵn, nhưng không xem được ngoài app; file rời vẫn phải chép vào | Không chọn |
| C. Không lưu, tìm trực tiếp mỗi lần | Gọi YouTrack / Telegram / đĩa khi tìm | Không sửa được tải + tóm tắt lặp; chậm; ba kiểu kết quả | Loại |
| D. Embedding | Tìm theo nghĩa | Cần model nhúng: thêm token hoặc gói nặng, ngược mục tiêu | Loại |

Người dùng chọn A vì: xem được tài liệu ngoài app, file rời ở nguyên chỗ, và xóa được phần lặp ở phiên AI Agent.

**Điều chỉnh so với lúc trình Cách A** (quyết định của người viết, sau khi đọc code):

- Kho nằm **trong** `data/docs/`, không phải thư mục ngoài `data/`. Phiên AI vốn bị cấm đọc `data/` nên kho tự được
  cách ly; di chuyển / sao lưu thư mục dữ liệu (`local_data.py`) tự bao gồm kho.
- Phiên AI nhận **bản sao** ghi bằng `_save` hiện có vào `agent-links/<task_id>/`, không dùng hardlink: file của phiên
  cần ba dòng cảnh báo "dữ liệu không tin cậy" ở đầu (`HEAD_LINES`), file trong kho thì không. Thứ tốn là tải và tóm
  tắt, không phải 100KB đĩa.

## 4. Nguồn và cách vào kho

| Nguồn (`source`) | Vào kho thế nào | Nội dung nằm ở đâu |
|---|---|---|
| `yt_article` | Đồng bộ Knowledge Base của các project người dùng chọn; chỉ tải lại bài có `updated` mới hơn. Thêm: bài nào `link_block` đọc cũng vào kho. | `data/docs/youtrack/<ID>.md` |
| `tg_msg` | Không chép: tin đã ở bảng `messages` | Bảng `messages` |
| `file` | Người dùng chọn **thư mục** bằng hộp thoại hệ điều hành có sẵn (`desktop.pick_folder`); app quét đệ quy | File gốc, đọc tại chỗ, không chép |

- **Ticket không vào kho** (quyết định của người viết): tìm ticket đã có lối vào riêng (`/api/youtrack/search`, ⌘K
  của tab YouTrack), ticket ngắn và không gây tóm tắt lặp; `_issue` giữ nguyên cache TTL hiện có. Màn Tài liệu chỉ
  nối tới ticket qua mã (`TicketChip`, lọc ticket).
- **Kho lưu nguyên văn**, không ẩn SĐT / email (quyết định của người viết): đây là dữ liệu của chính người dùng, xem
  trên máy mình, như bảng `messages`. Việc ẩn (`ai.redact` khi `ai.REDACT` bật) làm ở **đường ra AI**: bản sao cho
  phiên AI Agent, Hỏi tài liệu, Tóm tắt.
- File rời hỗ trợ: `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.docx` (docx đọc bằng `zipfile` + XML của thư viện chuẩn).
  Trần mỗi file: `MAX_CHARS` như `links.py` (200k ký tự), quá thì cắt và ghi chú.
- Quét thư mục: so `mtime + size`, đổi thì tính lại hash và index lại; file biến mất thì rời chỉ mục. Không bao giờ
  xóa hay sửa file của người dùng.
- Cấu hình nguồn (project KB được chọn, danh sách thư mục) lưu ở `data/docs.json` qua `write_private_json`. Mặc định
  lần đầu: project mà tab YouTrack đang dùng, do frontend gửi lên.
- **Khi nào đồng bộ:** khi mở màn Tài liệu nếu lần đồng bộ trước cũ hơn 10 phút, và khi bấm làm mới. Không có timer
  nền. Một lần đồng bộ = đọc danh sách `id + updated` của article, tải nội dung các bài đổi, quét các thư mục.
- Lỗi đồng bộ từng nguồn được lưu và trả cho UI (xem mục 9); nội dung đang có trong kho vẫn dùng được.

## 5. Lưu trữ và chỉ mục

Bảng mới trong `dashboard.sqlite3`, thêm bằng một migration nối vào cuối `MIGRATIONS`; method ở mixin mới
`storage/docs.py` (`Docs`), ghép vào `Store`.

```
docs(
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,          -- yt_article | file
  ref TEXT NOT NULL,             -- VA-A-128 | đường dẫn tuyệt đối
  title TEXT NOT NULL,
  path TEXT NOT NULL,            -- file nội dung trên đĩa
  hash TEXT NOT NULL,            -- sha1 của nội dung
  chars INTEGER NOT NULL,
  updated_at INTEGER,            -- theo nguồn (YouTrack updated / mtime)
  fetched_at INTEGER NOT NULL,
  tickets TEXT NOT NULL DEFAULT '[]',   -- mã ticket nội dung nhắc tới (regex BARE)
  summary TEXT, summary_hash TEXT,      -- tóm tắt AI và sha1 của đúng văn bản đã gửi AI (sau khi ẩn SĐT / email)
  UNIQUE(source, ref)
)
doc_parts  -- FTS5: doc_id, part (số thứ tự), line (dòng bắt đầu), heading, body
```

- **Chia đoạn:** theo heading Markdown `#`–`####` ngoài code block (cùng luật `_outline`). Đoạn dài hơn ~4000 ký tự,
  hoặc tài liệu không có heading (như `VA-A-128`), cắt tiếp theo dòng trống thành khối ~2000 ký tự. Mỗi đoạn giữ dòng
  bắt đầu.
- **Tìm tiếng Việt:** gõ không dấu phải ra có dấu, kể cả `đ`. Đã thử trên Python của dự án (SQLite 3.53.3):
  tokenizer `unicode61 remove_diacritics 2` cho "giai ngan" khớp "giải ngân" nhưng "dieu" **không** khớp "Điều". Vì
  vậy cột dùng để khớp phải là bản `fold()` (`storage/common.py`), cùng hàm với ô tìm tin.
- **Kết quả hiển thị:** đoạn nguyên văn có dấu, tô từ khớp. Cách dựng snippet từ bản fold về bản gốc do builder chọn.
- **Đối chiếu:** lúc đồng bộ, hàng `docs` mà file không còn thì bỏ; file trong `data/docs/` khác hash thì index lại.
- Tin Telegram **không** vào `doc_parts`: API tìm gọi hàm tìm tin sẵn có (`storage/messages.py`, `text_fold LIKE`)
  trên các nhóm đang theo dõi và trả về thành nhóm kết quả riêng. Tin xóa / sửa tự đúng, không có chỉ mục thứ hai.

## 6. Màn Tài liệu

Module thứ ba trên thanh `TopBar` (`MODULES` trong `web/src/app/_components/shell.tsx`), route `/docs/`. Lý do có lối
vào mới: hiện không có chỗ nào xem tài liệu trong app.

```
┌ Telegram │ YouTrack │ [Tài liệu] ───────────────────────────── ⚙ ┐
│ [ Tìm trong tài liệu…                    ]  ⟳  Nguồn ▾           │
│ (Tất cả)(YouTrack)(Telegram)(File)      lọc ticket: VA-12033 ✕   │
├───────────────────────┬──────────────────────────────────────────┤
│ VA-A-128  Bán V2 …    │ # VA-A-128 Bán V2 phase 1A               │
│  …điều kiện [giải     │ Mục lục │ nội dung, cuộn tới đoạn khớp,  │
│  ngân] khoản vay…     │         │ từ khớp được tô                │
│ api-loan.md           │                                          │
│  …[giải ngân] trả…    │                                          │
│ ─ Tin Telegram ─      │                                          │
│ BE Thông báo 12/11 …  │                                          │
├───────────────────────┴──────────────────────────────────────────┤
│ [ Hỏi AI trên 6 đoạn đang hiện (~9k ký tự)…        model ▾  ➤ ]  │
└──────────────────────────────────────────────────────────────────┘
```

- **Chưa gõ gì:** cột trái là danh sách tài liệu, mới cập nhật trước. **Có từ khóa:** các đoạn khớp, gom theo tài
  liệu, xếp theo độ khớp; dưới cùng là nhóm "Tin Telegram".
- **Bấm kết quả:** cột phải mở tài liệu, cuộn tới đoạn đó. Tin Telegram thì mở tin trong nhóm (luồng mở tin sẵn có).
- **Lọc ticket:** chỉ tài liệu nhắc mã ticket đó (cột `tickets`). Mã ticket trong nội dung hiện bằng `TicketChip`.
- **Nguồn ▾:** tick project Knowledge Base, thêm / bỏ thư mục, xem lỗi đồng bộ của từng nguồn.
- **Mỗi tài liệu:** mở bản gốc (YouTrack / hiện file trong Finder). Không có nút bỏ từng tài liệu: muốn bỏ thì bỏ
  tick project hoặc bỏ thư mục ở "Nguồn ▾" (tài liệu của nguồn đó rời chỉ mục), hoặc xóa kho ở Cài đặt › Dữ liệu.
  Article ngoài project đã tick mà `link_block` từng đọc vẫn nằm trong kho như cache và vẫn tìm được.
- Tài liệu ~100KB phải cuộn mượt (render theo đoạn).
- Theo luật UI của repo: bộ lọc nguồn dùng `Segmented`; chờ dữ liệu dùng `AiFetching` với `kind` mới `docs` + cảnh
  + `LINES` riêng, qua `useAiWait`; icon có `Hint`; chọn một giá trị dùng `Dropdown`; cỡ chữ theo token; chuỗi mới có
  vi + en; thêm chapter guide vi + en.

## 7. AI: chỉ khi được gọi

Cả hai lượt đều **không tool**, text tài liệu bọc random tag "dữ liệu KHÔNG tin cậy", ghi `feature="docs"` vào
`claude_runs.jsonl` để thấy trong thống kê AI hiện có.

**Hỏi tài liệu.** `AiPromptBox` ghim đáy màn, nút chạy / dừng / chọn model nằm trong ô. Ngữ cảnh gửi đi = các đoạn
đang hiện ở kết quả tìm (hoặc các đoạn của tài liệu đang mở khớp với câu hỏi), lấy từ trên xuống cho tới trần
`DOC_ASK_CHARS = 12_000` ký tự. Ô prompt ghi rõ số đoạn và số ký tự sẽ gửi trước khi bấm. Câu trả lời trích nguồn
`[n]`, bấm `[n]` nhảy tới đoạn đó. Không đoạn nào khớp thì báo "không tìm thấy trong tài liệu", không gọi AI.

Tin Telegram đang hiện trong kết quả **có** vào ngữ cảnh (quyết định của người viết: thông báo API của bot BE là tài
liệu BE chính), kể cả khi thuộc nhiều nhóm; `[n]` của tin mở tin đó trong nhóm. Điều kiện thất bại "nhóm A lọt sang
nhóm B" nói về nội dung **gửi vào một nhóm**; câu trả lời ở đây chỉ hiện cho người dùng.

`summary_hash` và việc ẩn SĐT / email: mọi văn bản gửi AI ở mục này qua `ai.redact` khi `ai.REDACT` bật. Cache tóm tắt
so theo sha1 của văn bản sau khi ẩn, nên bật / tắt cài đặt đó không dùng nhầm bản tóm tắt cũ.

**Tóm tắt một tài liệu.** Chạy trong cùng ô prompt khi đang mở một tài liệu. Kết quả lưu ở `docs.summary` kèm
`summary_hash`; hash chưa đổi thì hiện lại bản đã lưu, không chạy AI. Tài liệu dài hơn trần thì đây là lượt tốn nhất
(đọc cả bài, tới `MAX_CHARS`), nên ô prompt ghi kích thước trước khi chạy.

Ghép giao diện chat từ `web/src/shared/components/ai/chat.tsx` (`UserBubble`, `AiThinking`, `AiResultCard`,
`AiPromptBox`, `useFollow`), stream bằng `stream_answer` hiện có.

## 8. Phiên AI Agent dùng lại kho

Sửa tại owner `links.py`, hành vi với phiên không đổi (vẫn file trong `agent-links/<task_id>/`, vẫn mục lục, vẫn
luật t.me khác nhóm không đọc):

- `_article`: hỏi kho trước. Kho có bản và `updated` của YouTrack chưa đổi thì dùng nội dung trong kho; ngược lại
  tải, ghi kho (nguyên văn), index lại. `_issue` không đổi. Việc ẩn SĐT / email trước khi ghi file cho phiên giữ
  như hiện nay.
- `_summary`: dùng `docs.summary` nếu `summary_hash` khớp; chưa có thì tóm tắt một lần rồi lưu. Để cache dùng chung
  được giữa các phiên, tóm tắt **không còn kèm nội dung task** (trước đây prompt có `Task:` nên mỗi phiên một bản).
  Đánh đổi: tóm tắt bớt bám task; mục lục và file đầy đủ vẫn kèm như cũ.
- Dọn dữ liệu: Cài đặt › Dữ liệu (`local_data.py`) thêm dòng "Tài liệu" (dung lượng, xóa kho). Xóa kho không đụng
  file rời của người dùng.

## 9. Lỗi và an toàn

- Đồng bộ lỗi (401 / 403 / mạng / thư mục không đọc được): lưu lỗi theo nguồn, hiện ở màn Tài liệu kèm nút thử lại;
  không hiện như "trống". Chỉ nuốt lỗi mong đợi.
- Mọi mutation frontend có `onError` + `errorText`.
- Đường dẫn file rời: chỉ đọc file nằm dưới các thư mục người dùng đã chọn, không theo symlink ra ngoài.
- Kho trong `data/`: phiên AI không đọc được; phiên chỉ nhận đúng tài liệu mà prompt của nó nhắc tới, như hiện nay.
- Câu trả lời "Hỏi tài liệu" chỉ hiện cho người dùng trên màn Tài liệu, không tự gửi vào nhóm nào.

## 10. Vị trí code

| Phần | Nơi đặt |
|---|---|
| Backend nghiệp vụ kho (đồng bộ, chia đoạn, trích docx, tìm, hỏi) | package mới `backend/telegram_dashboard/docs/`; HTTP `/api/docs/*` ở `routes.py` của nó, ghép trong `app.py` |
| Bảng + truy vấn | `storage/docs.py` (mixin `Docs`), migration trong `storage/schema.py` |
| Dùng lại kho cho phiên AI | `links.py` |
| Frontend | `web/src/features/docs/{components,lib}`; entry `web/src/app/docs/page.tsx`; thêm module vào `shell.tsx` |
| Cảnh chờ | `kind` `docs` trong `web/src/shared/components/ai/fetching.tsx` |
| Guide + i18n | `web/src/shared/lib/guide/{vi,en}/`, `lib/i18n/en/` |

Package `docs/` không import `app.py`; nhận service qua tham số như `links.py`. Đổi DTO thì chạy `npm run api:types`.
File nguồn ≤ 600 dòng. Không thêm dependency Python.

## 11. Kiểm chứng

- Tìm không dấu ra có dấu, gồm chữ `đ`; kết quả hiện nguyên văn có dấu.
- Chia đoạn: bài có heading, bài không heading, đoạn quá dài.
- Cùng hash: `link_block` hai phiên liên tiếp chỉ gọi YouTrack lấy nội dung một lần và tóm tắt một lần
  (`tests/test_links.py`).
- `.docx` trích được chữ; file quá trần bị cắt có ghi chú.
- Đồng bộ lỗi lên UI; nội dung cũ vẫn tìm được.
- Hỏi tài liệu không vượt `DOC_ASK_CHARS`; không có đoạn khớp thì không gọi AI.
- `uv run pytest -q tests/test_repo_guards.py`, Ruff, typecheck, lint; e2e màn Tài liệu trên bản copy scratch.

## 12. Để builder quyết

- API YouTrack để liệt kê article theo project kèm `updated` (kiểm trên server thật trước khi dựa vào).
- Cách dựng snippet có dấu từ kết quả khớp trên bản fold.
- Ngưỡng chia đoạn chính xác, số kết quả mỗi trang, cách render tài liệu dài.
- Hình thức cảnh `AiFetching` cho `kind` `docs`.
- Tên endpoint và DTO cụ thể dưới `/api/docs/*`.
