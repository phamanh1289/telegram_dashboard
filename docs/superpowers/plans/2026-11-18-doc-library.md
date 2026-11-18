# Kho tài liệu (Tài liệu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một kho tài liệu chung cho YouTrack article, tin Telegram và file rời: xem / tìm bằng code (0 token), AI chỉ khi gọi và có trần ký tự, phiên AI Agent dùng lại kho.

**Architecture:** Nội dung là file (`data/docs/youtrack/*.md`, file rời đọc tại chỗ); metadata + FTS5 trong `dashboard.sqlite3`. Package backend mới `telegram_dashboard/docs/` sở hữu nghiệp vụ, `links.py` gọi vào để dùng cache. Frontend là module thứ ba `/docs/` trong `web/src/features/docs/`.

**Tech Stack:** Python 3 + FastAPI + SQLite FTS5 (thư viện chuẩn, không thêm dependency); Next.js 16 static export, React 19, TanStack Query 5, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-11-18-doc-library-design.md`

## Cần / Đã có / Ở đâu

| Cần | Đã có | Ở đâu |
|---|---|---|
| Tải article, bọc "không tin cậy", mục lục, file cho phiên | Có, dùng lại | `links.py` (`_article`, `_save`, `_outline`) |
| Fold dấu tiếng Việt | Có, dùng lại | `storage/common.py::fold`, `web/src/shared/lib/utils.ts::fold` |
| Chọn thư mục bằng hộp thoại OS | Có, dùng lại | `desktop.pick_folder` |
| Stream câu trả lời AI | Có, dùng lại | `ai_jobs.stream_answer`, `AiService.ask`, `api.ts::apiStream` |
| Khung chat AI, ô prompt, cảnh chờ, Markdown, `TicketChip` | Có, dùng lại | `shared/components/ai/*`, `shared/components/markdown.tsx`, `features/telegram/components/message/rich-text.tsx` |
| Mở một tin Telegram | Có, dùng lại | deep link `/?chat=<id>&msg=<mid>` (`inbox.tsx`) |
| Bảng `docs` + FTS, chia đoạn, trích docx, đồng bộ, API, màn Tài liệu | **Thiếu** | plan này |

## Tổng quan phase

| Phase | Target files | Surgical action | Verification |
|---|---|---|---|
| 1 | `storage/docs.py`, `storage/schema.py`, `storage/messages.py` | Bảng `docs` + FTS5, tìm tin nhóm đang theo dõi | `tests/test_docs_store.py` |
| 2 | `docs/parts.py`, `docs/extract.py` | Chia đoạn, snippet có dấu, trích `.docx` | `tests/test_docs_parts.py` |
| 3 | `docs/library.py`, `docs/sync.py`, `app.py` | Ghi kho, cache article, tóm tắt theo hash, đồng bộ | `tests/test_docs_library.py` |
| 4 | `links.py`, `local_data.py`, `settings/components/data.tsx` | Phiên AI dùng lại kho; dòng "Tài liệu" ở Dữ liệu | `tests/test_links.py`, `tests/test_data_move.py` |
| 5 | `docs/routes.py`, `docs/ask.py`, `models.py`, `desktop.py` | API `/api/docs/*`, Hỏi / Tóm tắt có trần | `tests/test_docs_api.py`, `npm run api:types` |
| 6 | `web/src/features/docs/*`, `app/docs/page.tsx`, `shell.tsx`, `fetching.tsx` | Màn duyệt / tìm / đọc | typecheck, lint, xem trên bản scratch |
| 7 | `features/docs/components/ask.tsx` | Ô prompt AI ghim đáy | typecheck, lint, xem trên bản scratch |
| 8 | `guide/{vi,en}/docs.json`, `web/tests/docs.spec.ts`, `docs/ARCHITECTURE.md`, `AGENTS.md` | Guide, e2e, kiểm cuối | toàn bộ pytest, Ruff, typecheck, lint, e2e scratch |

Thứ tự bắt buộc: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (mỗi phase dùng interface của phase trước). Sau phase 4, phần tiết kiệm token ở phiên AI Agent đã có hiệu lực dù chưa có màn.

## Global Constraints

- Không thêm dependency Python hay npm. Dependency Python đang pin `==X.Y.Z`.
- Không commit / push trừ khi người dùng bảo (nhánh đang có thay đổi dở của người dùng). Không `git checkout` file bẩn.
- Không build đè `web/out`, không đụng `:8765`; build / e2e chạy trên bản copy ở scratchpad. Subagent luôn truyền `model`.
- File nguồn ≤ 600 dòng. `shared/` không import `features/` hay `app/`. Package `docs/` không import `app.py` và không import `links.py` (chiều phụ thuộc: `links` → `docs`).
- Đổi chữ ký hàm: grep mọi caller; tham số tùy chọn keyword-only. Không re-export tạm khi chuyển tên.
- Text tài liệu gửi AI: bọc random tag "dữ liệu KHÔNG tin cậy" bằng helper sẵn có trong `ai.py` (mẫu ở `ai_prompts.py:243`), lượt đó **không tool**, qua `ai.redact` khi `ai.REDACT` bật.
- Chỉ nuốt lỗi mong đợi; 401 / 403 / mạng phải lên UI. Mọi mutation frontend có `onError` + `errorText`.
- Hằng số từ spec: `DOC_ASK_CHARS = 12_000`, `MAX_CHARS = 200_000`, đoạn tối đa `PART_MAX = 4000`, khối `BLOCK = 2000`, đồng bộ lại khi cũ hơn `SYNC_STALE = 600` giây.
- Định dạng file rời: `.md .txt .json .yaml .yml .docx`.
- Chuỗi UI mới có vi + en; cỡ chữ theo token; tab chọn-một dùng `Segmented`; icon giải thích dùng `Hint`; chọn một giá trị dùng `Dropdown`.
- Xong mỗi task: `codegraph sync` ở gốc repo.

## Quyết định thêm trong plan (spec để ngỏ)

- Bảng `docs` thêm cột `size` (spec nói so `mtime + size`).
- Quét thư mục bỏ qua thư mục bắt đầu bằng `.` và `node_modules`; trần `MAX_FILES = 2000` file mỗi thư mục, vượt thì index 2000 file đầu và báo lỗi `too_many_files`.
- Thư mục không còn / không đọc được: báo lỗi, **giữ** chỉ mục cũ (không coi là "mọi file đã xóa").
- Ngữ cảnh "Hỏi AI" do backend dựng lại từ đúng truy vấn đang hiện, không nhận danh sách đoạn từ frontend; số đoạn / số ký tự trong ô prompt lấy từ response tìm kiếm.
- Câu hỏi không có từ khóa tìm đi kèm: tìm theo **bất kỳ** từ nào của câu hỏi (bỏ từ dưới 3 ký tự), xếp theo độ khớp.
- `MAX_CHARS` chuyển owner sang `docs/parts.py`; `links.py` và `tests/test_links.py` import từ đó.

## Review Focus

1. Từ khóa có ký tự đặc biệt của FTS5 (`"`, `*`, `:`, `-`, ví dụ `VA-12033`, `a:b`, `"`) → không 500, coi như từ thường. Test ở Task 1.
2. Người dùng chọn thư mục rất lớn (ví dụ `~/Documents`) → không treo: bỏ `node_modules` / thư mục ẩn, dừng ở `MAX_FILES`, báo lỗi rõ. Test ở Task 3.
3. File đúng đuôi nhưng nhị phân / sai mã hóa, hoặc `.docx` hỏng → bỏ qua file đó kèm lỗi theo file, các file khác vẫn vào kho. Test ở Task 2 và 3.
4. YouTrack 401 / mất mạng giữa lúc đồng bộ, hoặc thư mục bị tháo → lỗi lên UI, tài liệu cũ vẫn tìm được, không bị xóa khỏi chỉ mục. Test ở Task 3.
5. Symlink trong thư mục trỏ ra ngoài (ví dụ tới `data/` hay `~/.ssh`) → không đọc. Test ở Task 3.

---

### Task 1: Bảng `docs`, FTS5 và tìm tin Telegram

**Files:**
- Create: `backend/telegram_dashboard/storage/docs.py`
- Modify: `backend/telegram_dashboard/storage/schema.py` (migration `_docs`, nối cuối `MIGRATIONS`), `storage/__init__.py` (`Store` thêm mixin `Docs`), `storage/messages.py` (thêm `search_tracked`)
- Test: `tests/test_docs_store.py`

**Interfaces — Produces** (đều là method sync của `Store`, gọi qua `db.read` / `db.write`):
- `doc_upsert(source: str, ref: str, *, title: str, path: str, hash: str, chars: int, size: int, updated_at: int | None, tickets: list[str], parts: list[tuple[int, str, str]]) -> int` — `parts` là `(line, heading, body)` nguyên văn; hash đổi thì thay toàn bộ đoạn và xóa `summary`; trả `id`.
- `doc_find(source: str, ref: str) -> dict | None`, `doc_get(id: int) -> dict | None`
- `doc_list(*, source: str | None = None, ticket: str | None = None) -> list[dict]` — mới cập nhật trước.
- `doc_parts(id: int) -> list[dict]` — `{part, line, heading, body}`.
- `doc_search(q: str, *, source: str | None = None, ticket: str | None = None, doc: int | None = None, any_word: bool = False, limit: int = 30) -> list[dict]` — `{doc_id, part, line, heading, body, rank}`, xếp `bm25`.
- `doc_set_summary(id: int, text: str, hash: str) -> None`
- `doc_delete(*, source: str, ref_prefix: str | None = None, path_prefix: str | None = None, keep: set[str] | None = None) -> int` — `keep`: các `ref` giữ lại.
- `doc_clear() -> None`, `doc_stats() -> dict` (`{count, oldest}`)
- `search_tracked(q: str, limit: int = 20) -> list[dict]` trong `Messages` — tin chưa xóa của nhóm đang theo dõi, mỗi từ của `fold(q)` phải có trong `text_fold` (`LIKE` AND), mới trước; cột như `find_mentions`.

Schema: bảng `docs` theo spec mục 5 cộng `size INTEGER NOT NULL DEFAULT 0`; bảng ảo
`doc_parts USING fts5(heading, body, doc_id UNINDEXED, part UNINDEXED, line UNINDEXED, text UNINDEXED)` — `heading` / `body` là bản `fold()`, `text` là nguyên văn. Truy vấn: `fold(q)` tách từ, mỗi từ đặt trong `"…"` (bỏ dấu `"`), AND mặc định, OR khi `any_word`; từ cuối thêm `*` (gõ tới đâu tìm tới đó).

- [ ] **Step 1: Viết test** `tests/test_docs_store.py` (dùng `Store(tmp_path / "db.sqlite3")`):

```python
def test_search_is_accent_free_and_finds_d_stroke(store):
    i = put(store, "VA-A-1", [(1, "# Điều kiện", "Điều kiện giải ngân khoản vay")])
    assert [r["doc_id"] for r in store.doc_search("dieu kien giai ngan")] == [i]
    assert store.doc_search("giai nga")[0]["body"] == "Điều kiện giải ngân khoản vay"  # prefix, nguyên văn có dấu

def test_fts_syntax_in_a_query_is_plain_words(store):
    put(store, "VA-A-1", [(1, "", "ticket VA-12033 a:b")])
    for q in ('VA-12033', 'a:b', '"', '*', 'x" OR "y', '-'):
        store.doc_search(q)  # không ném lỗi
    assert store.doc_search("VA-12033")

def test_same_hash_keeps_summary_new_hash_replaces_parts(store): ...
    # upsert cùng hash: summary còn; hash khác: doc_parts chỉ còn đoạn mới, summary None

def test_filters_and_any_word(store): ...
    # source=, ticket= (cột tickets), doc=, any_word=True khớp khi chỉ một từ có mặt

def test_search_tracked_folds_and_skips_untracked_and_deleted(store): ...
```

- [ ] **Step 2:** Chạy `uv run pytest -q tests/test_docs_store.py` → FAIL (chưa có `doc_upsert`).
- [ ] **Step 3:** Viết migration `_docs`, mixin `Docs`, `search_tracked`.
- [ ] **Step 4:** `uv run pytest -q tests/test_docs_store.py tests/test_storage_sync.py` → PASS; `uv run ruff check backend tests`.

---

### Task 2: Chia đoạn và trích chữ

**Files:**
- Create: `backend/telegram_dashboard/docs/__init__.py`, `docs/parts.py`, `docs/extract.py`
- Test: `tests/test_docs_parts.py`

**Interfaces — Produces:**
- `parts.MAX_CHARS = 200_000`, `PART_MAX = 4000`, `BLOCK = 2000`
- `parts.split_parts(text: str) -> list[tuple[int, str, str]]` — `(line bắt đầu tính từ 1, heading hoặc "", body)`; heading `#`–`####` ngoài code block (cùng luật `links._outline`); đoạn dài hơn `PART_MAX` hoặc tài liệu không heading thì gom đoạn văn (cách nhau dòng trống) thành khối ≤ `BLOCK`; một đoạn văn đơn dài hơn `BLOCK` cắt theo dòng.
- `parts.tickets_of(text: str) -> list[str]` — mã ticket theo regex `BARE` hiện có (chuyển `BARE` sang `docs/parts.py`, `links.py` import lại), không lặp, giữ thứ tự.
- `parts.snippet(text: str, q: str, width: int = 200) -> tuple[str, list[tuple[int, int]]]` — đoạn nguyên văn quanh lần khớp đầu và các khoảng `(start, end)` cần tô, tính trên chuỗi trả về.
- `extract.EXTS = {".md", ".txt", ".json", ".yaml", ".yml", ".docx"}`
- `extract.read_text(path: Path) -> str` — text file: UTF-8 strict; `.docx`: `zipfile` đọc `word/document.xml`, mỗi `w:p` một dòng; cắt ở `MAX_CHARS` kèm dòng `(… bị cắt ở 200000 ký tự)`. Ném `ValueError(code)` với `code` ∈ `unsupported`, `not_text`, `bad_docx`.

- [ ] **Step 1: Viết test:**

```python
def test_headings_make_parts_with_their_line():
    assert split_parts("# A\nx\n\n## B\ny") == [(1, "# A", "x"), (4, "## B", "y")]

def test_no_heading_is_cut_into_blocks():
    parts = split_parts("\n\n".join(["đoạn " * 100] * 20))
    assert len(parts) > 1 and all(len(b) <= BLOCK and h == "" for _, h, b in parts)

def test_heading_inside_a_code_fence_is_not_a_part(): ...
def test_one_paragraph_longer_than_a_block_is_cut_by_line(): ...

def test_snippet_keeps_accents_and_marks_the_words():
    text, marks = snippet("Điều kiện giải ngân khoản vay", "giai ngan")
    assert [text[a:b] for a, b in marks] == ["giải", "ngân"]

def test_docx_text(tmp_path): ...            # tạo docx tối thiểu bằng zipfile, 2 đoạn → "một\nhai"
def test_binary_and_broken_docx_raise(tmp_path):
    (tmp_path / "a.md").write_bytes(b"\xff\xfe\x00")
    with pytest.raises(ValueError, match="not_text"): read_text(tmp_path / "a.md")
    (tmp_path / "b.docx").write_bytes(b"not a zip")
    with pytest.raises(ValueError, match="bad_docx"): read_text(tmp_path / "b.docx")
def test_long_file_is_cut_with_a_note(tmp_path): ...
```

- [ ] **Step 2:** Chạy → FAIL. **Step 3:** Cài đặt. `snippet` phải đúng cả khi `fold()` đổi độ dài chuỗi (chuỗi NFD): dựng bảng vị trí fold → gốc.
- [ ] **Step 4:** `uv run pytest -q tests/test_docs_parts.py tests/test_links.py` → PASS (regex `BARE` đã đổi chỗ).

---

### Task 3: `Library`: ghi kho, cache article, tóm tắt, đồng bộ

**Files:**
- Create: `backend/telegram_dashboard/docs/library.py`, `docs/sync.py`
- Modify: `backend/telegram_dashboard/app.py` (lifespan: `app.state.docs = Library(settings, db, app.state.ai)` ngay sau `app.state.ai`)
- Test: `tests/test_docs_library.py`

**Interfaces — Consumes:** Task 1 (`doc_*`), Task 2 (`split_parts`, `tickets_of`, `read_text`, `EXTS`, `MAX_CHARS`); `YtClient.yt(path, **params)`; `AiService.ask(user_prompt, system=…, feature=…, on_text=…)`; `config.write_private_json`, `config._read_json`.

**Produces** (`class Library` trong `library.py`):
- `__init__(self, settings, db, ai)`; `self.dir = settings.data_dir / "docs"`; `self.errors: list[dict]`, `self.synced_at: float | None`
- `sources() -> dict` / `async set_sources(projects: list[str], folders: list[str]) -> None` — lưu `data/docs.json`; project bị bỏ: `doc_delete(source="yt_article", ref_prefix=f"{P}-A-")` và xóa file; thư mục bị bỏ: `doc_delete(source="file", path_prefix=…)`.
- `async put(source: str, ref: str, title: str, text: str, *, updated_at: int | None, path: Path | None = None, size: int = 0) -> int` — `yt_article`: ghi `self.dir / "youtrack" / f"{ref}.md"` (0600, thư mục 0700, không qua symlink); `file`: `path` là file gốc, không ghi gì.
- `async article(yt, aid: str) -> str | None` — đọc `fields="idReadable,summary,updated"`; kho có hàng cùng `updated` và file còn thì trả nội dung file; ngược lại tải thêm `content`, `put`, trả `f"# {id} {summary}\n\n{content}"` (đúng dạng `links._article` trả hôm nay).
- `async summary(doc_id: int, *, on_text=None) -> tuple[str, bool]` — `(text, cached)`; văn bản gửi = `ai.redact(text)` khi `ai.REDACT`; `summary_hash` = sha1 của văn bản đã gửi; trùng hash thì trả bản lưu, không gọi AI; lượt AI ghi `feature="docs"`, không tool.
- `SUMMARY_PROMPT` — bản hiện ở `links.py` bỏ phần "cho một AI agent sắp làm task bên dưới" và "ưu tiên phần liên quan tới task".
- `sync.run(lib: Library, yt) -> None` — có `asyncio.Lock`, lời gọi thứ hai chờ lượt đang chạy; ghi `lib.errors` (`{source, ref, code, detail}`) và `lib.synced_at`. Thứ tự: (1) đối chiếu `data/docs/youtrack/`: hàng mất file thì xóa hàng, file khác hash thì index lại từ file; (2) article của các project đã chọn: chỉ tải nội dung bài có `updated` khác; (3) quét các thư mục.

Trước khi viết `sync.run`: **kiểm API thật** bằng một lời gọi GET qua `YtClient` của app (chỉ đọc): thử `/api/articles` với `fields=idReadable,summary,updated,project(shortName)`, `$top`, `$skip` và lọc project; nếu không lọc được theo project thì dùng `/api/admin/projects/{id}/articles`. Ghi cách đã dùng vào docstring của `sync.py`. Nếu cần tra tài liệu YouTrack REST thì tra, không đoán.

- [ ] **Step 1: Viết test** (YouTrack giả bằng hàm `async def yt(path, **params)` đếm lời gọi, như `tests/test_links.py::state`):

```python
async def test_article_is_downloaded_once_until_it_changes(lib, yt):
    await lib.article(yt, "VA-A-1"); await lib.article(yt, "VA-A-1")
    assert yt.content_calls == 1
    yt.updated += 1
    await lib.article(yt, "VA-A-1"); assert yt.content_calls == 2

async def test_summary_runs_once_per_text_and_again_when_redact_flips(lib, ai, monkeypatch): ...
    # 2 lần liên tiếp: ai.calls == 1, lần hai cached=True; đổi ai.REDACT: ai.calls == 2

async def test_sync_indexes_changed_articles_and_folder_files(lib, yt, tmp_path): ...
async def test_a_deleted_file_leaves_the_index_a_missing_folder_does_not(lib, tmp_path): ...
    # xóa 1 file → doc_find None; đổi tên cả thư mục → lỗi "folder_missing", doc cũ vẫn tìm được

async def test_yt_error_is_reported_and_keeps_old_docs(lib, yt):
    yt.fail = YtError(401, "unauthorized")
    await sync.run(lib, yt)
    assert lib.errors[0]["code"] and store.doc_find("yt_article", "VA-A-1")

async def test_bad_file_is_skipped_with_its_own_error(lib, tmp_path): ...   # not_text, các file khác vẫn vào
async def test_symlink_out_of_the_folder_is_not_read(lib, tmp_path): ...
async def test_big_folder_stops_at_max_files_and_skips_node_modules(lib, tmp_path, monkeypatch): ...
    # monkeypatch MAX_FILES = 3; lỗi "too_many_files"; file trong node_modules/ và .git/ không vào
async def test_dropping_a_project_or_folder_removes_its_docs(lib): ...
async def test_a_store_file_edited_or_deleted_by_hand_is_reconciled(lib, yt): ...
    # sửa tay data/docs/youtrack/VA-A-1.md → tìm ra chữ mới; xóa file → hàng mất, lần đồng bộ sau tải lại
```

- [ ] **Step 2:** Chạy → FAIL. **Step 3:** Cài đặt. Đọc thuộc tính lỗi đúng class (`YtError.message`). Đường dẫn file: `resolve()` phải nằm dưới thư mục đã chọn (cũng `resolve()`), `os.walk(followlinks=False)`.
- [ ] **Step 4:** `uv run pytest -q tests/test_docs_library.py` → PASS; Ruff sạch.

---

### Task 4: Phiên AI Agent dùng lại kho; dòng "Tài liệu" ở Cài đặt › Dữ liệu

**Files:**
- Modify: `backend/telegram_dashboard/links.py` (`_article`, `_summary`, import `MAX_CHARS` / `BARE` từ `docs/parts.py`, bỏ `SUMMARY_PROMPT`), `backend/telegram_dashboard/local_data.py` (`stats`, `_clear_files`), `backend/telegram_dashboard/models.py` nếu `DataItem.id` là Literal
- Modify: `web/src/features/settings/components/data.tsx` + `web/src/shared/lib/i18n/en/settings.ts` (nhãn mục `docs`)
- Test: `tests/test_links.py`, `tests/test_data_move.py`

**Interfaces — Consumes:** `Library.article`, `Library.summary`, `Store.doc_find`, `doc_stats`, `doc_clear`.

Thay đổi:
- `_article(s, host: str, aid: str)` (trước nhận `yt`): giữ kiểm `_ours(s.yt, host)`, rồi `await s.docs.article(s.yt, aid)`. Sửa caller duy nhất trong `link_block`.
- `_summary(s, url_kind: str, ref: str, body: str)` (trước nhận `task`): `yt` → `s.docs.summary(doc_id)` (cache); loại khác → `s.ai.ask(..., system=SUMMARY_PROMPT, feature="links")` không kèm task. Sửa caller trong `link_block`.
- Việc `ai.redact` trước khi `_save` cho phiên giữ nguyên.
- `local_data.stats`: thêm `DataItem(id="docs", …)` (dung lượng `data/docs/`, số tài liệu, cũ nhất); `_clear_files("docs")`: `doc_clear()` + xóa `data/docs/`; không đụng file rời.

- [ ] **Step 1:** Sửa `tests/test_links.py::state` để có `docs=Library(...)` trên `Store` thật ở `tmp_path`; thêm test:

```python
def test_two_sessions_share_one_download_and_one_summary(tmp_path):
    # bài > SUMMARY_FROM, < 3 heading; link_block cho task "a" rồi task "b"
    # yt nội dung gọi 1 lần, ai.ask gọi 1 lần, cả hai agent-links/<task>/ đều có file và cùng tóm tắt

def test_summary_prompt_no_longer_carries_the_task(tmp_path): ...   # chuỗi task không có trong prompt gửi AI
def test_clearing_docs_keeps_the_users_files(tmp_path): ...          # trong tests/test_data_move.py hoặc file test của local_data
```

- [ ] **Step 2:** Chạy → FAIL. **Step 3:** Cài đặt; grep `_article(`, `_summary(`, `SUMMARY_PROMPT`, `links.MAX_CHARS`, `links.BARE` trên toàn repo (kể cả test, monkeypatch) và sửa hết.
- [ ] **Step 4:** `uv run pytest -q tests/test_links.py tests/test_agent.py tests/test_autobe.py tests/test_data_move.py tests/test_yt_ai.py tests/test_repo_guards.py` → PASS.

---

### Task 5: API `/api/docs/*` và lượt Hỏi / Tóm tắt

**Files:**
- Create: `backend/telegram_dashboard/docs/routes.py`, `docs/ask.py`
- Modify: `backend/telegram_dashboard/models.py` (DTO), `app.py` (`app.include_router(build_docs_router(settings))` trước catch-all / static mount), `desktop.py` (thêm `reveal`)
- Generate: `web/src/shared/lib/api.generated.d.ts` bằng `npm run api:types`
- Test: `tests/test_docs_api.py`

**Interfaces — Produces:**

DTO (`models.py`):
```python
class DocDTO(BaseModel): id: int; source: str; ref: str; title: str; chars: int; updated_at: datetime | None; tickets: list[str]; url: str | None; has_summary: bool
class DocPart(BaseModel): part: int; line: int; heading: str; body: str
class DocDetail(BaseModel): doc: DocDTO; parts: list[DocPart]; summary: str | None
class DocHit(BaseModel): doc: DocDTO; part: int; line: int; heading: str; text: str; marks: list[tuple[int, int]]
class DocMsgHit(BaseModel): chat_id: str; message_id: int; chat_title: str; sender_name: str | None; date: datetime; text: str; marks: list[tuple[int, int]]
class DocSearch(BaseModel): hits: list[DocHit]; messages: list[DocMsgHit]; ask_parts: int; ask_chars: int
class DocSourceError(BaseModel): source: str; ref: str; code: str; detail: str
class DocSources(BaseModel): projects: list[str]; folders: list[str]; synced_at: datetime | None; errors: list[DocSourceError]
class DocSourcesBody(BaseModel): projects: list[str]; folders: list[str]
class DocAskBody(BaseModel): question: str; q: str = ""; source: str | None = None; ticket: str | None = None; doc: int | None = None
class DocCite(BaseModel): n: int; doc: int | None = None; part: int | None = None; chat_id: str | None = None; message_id: int | None = None
class DocAnswer(BaseModel): text: str; cites: list[DocCite]
class DocSummary(BaseModel): text: str; cached: bool
```

Endpoint (`docs/routes.py::build_router(settings) -> APIRouter`, prefix `/api/docs`, state qua `request.app.state` như `tasks.build_router`):

| Method + path | Trả | Ghi chú |
|---|---|---|
| `GET ""` `?source=&ticket=` | `list[DocDTO]` | |
| `GET /search` `?q=&source=&ticket=&doc=` | `DocSearch` | `source=telegram` chỉ trả `messages`; `source` khác không trả `messages` |
| `GET /{id}` | `DocDetail` | 404 `doc_not_found`; `summary` chỉ khi `summary_hash` còn khớp |
| `GET /sources` | `DocSources` | |
| `POST /sources` (`DocSourcesBody`) | `DocSources` | thư mục phải tồn tại: 422 `doc_folder_not_a_directory` |
| `POST /sources/pick` | `DocSources` hoặc 204 | `desktop.pick_folder()`, thêm vào `folders` |
| `POST /sync` `?force=` | `DocSources` | bỏ qua nếu mới hơn `SYNC_STALE` và không `force` |
| `POST /ask` (`DocAskBody`) | NDJSON, `done` = `DocAnswer` | `stream_answer` |
| `POST /{id}/summary` | NDJSON, `done` = `DocSummary` | bản cache trả ngay |
| `POST /{id}/reveal` | 204 | chỉ `source="file"`; `desktop.reveal(path)` |

`docs/ask.py`:
- `DOC_ASK_CHARS = 12_000`
- `async def context(s, body: DocAskBody) -> tuple[list[dict], int]` — cùng hàm với `/search`: truy vấn = `body.q` nếu có, không thì từ của `body.question` với `any_word=True`; lấy đoạn rồi tin Telegram, từ trên xuống, dừng trước khi vượt `DOC_ASK_CHARS`; trả `(mục đã đánh số, tổng ký tự)`. `/search` dùng chính hàm này để điền `ask_parts` / `ask_chars`.
- `async def answer(s, body: DocAskBody, on_text) -> DocAnswer` — 0 mục: ném `ApiError(404, "doc_no_match")`, không gọi AI; có mục: `s.ai.ask(..., system=DOC_ASK_PROMPT, feature="docs", on_text=on_text)` không `project` / `read_dir` (không tool).
- `DOC_ASK_PROMPT`: chỉ trả lời từ các mục được đánh số, trích `[n]` sau mỗi ý, phần không có trong mục thì nói rõ là không thấy; nối quy tắc "không tool" và "dữ liệu không tin cậy" sẵn có (`AI_NO_TOOLS`).
- `desktop.reveal(path: str) -> None`: macOS `open -R`, Windows `explorer /select,`; chạy bằng `child_env()`.

- [ ] **Step 1: Viết test** (`client` fixture của `tests/conftest.py`, AI giả như `tests/ai_test_helpers.py`):

```python
def test_search_returns_marked_text_and_the_ask_size(client): ...
    # 1 doc, q="giai ngan": hits[0].text chứa "giải ngân", marks khớp; ask_parts == 1; ask_chars == len(đoạn)
def test_ask_stays_under_the_cap(client, ai): ...
    # 20 đoạn 2000 ký tự cùng khớp: phần tài liệu trong prompt gửi AI ≤ 12_000 ký tự; cites đánh số liền từ 1
def test_ask_without_a_match_never_calls_the_ai(client, ai): ...     # error code "doc_no_match", ai.calls == 0
def test_ask_wraps_the_text_as_untrusted_and_runs_without_tools(client, ai): ...
def test_ask_redacts_when_the_setting_is_on(client, ai, monkeypatch): ...
def test_telegram_hits_join_the_context_and_cite_the_message(client, ai): ...
def test_summary_is_cached_by_the_api(client, ai): ...               # lần 2 cached=True, ai.calls == 1
def test_sync_errors_come_back_not_an_empty_list(client): ...         # YouTrack 401 → errors[0].code, HTTP 200, docs cũ còn
def test_reveal_refuses_a_youtrack_doc(client): ...
def test_unknown_doc_is_404(client): ...
```

- [ ] **Step 2:** Chạy → FAIL. **Step 3:** Cài đặt; `npm run api:types`.
- [ ] **Step 4:** `uv run pytest -q tests/test_docs_api.py tests/test_local_access.py tests/test_repo_guards.py` → PASS; `uv run ruff check .`.

---

### Task 6: Màn Tài liệu: duyệt, tìm, đọc

**Files:**
- Create: `web/src/app/docs/page.tsx`, `web/src/features/docs/lib/docs.ts`, `web/src/features/docs/components/{app,results,reader,sources}.tsx`, `web/src/shared/lib/i18n/en/docs.ts`
- Modify: `web/src/app/_components/shell.tsx` (`MODULES` thêm `["docs", "/docs/", "Tài liệu", <icon lucide>, "Chuyển sang Tài liệu"]`; kiểu `module` thêm `"docs"`; grep mọi nơi nhận kiểu này: `TopBar`, `GuideBot`, `AiQuota`), `web/src/shared/components/ai/fetching.tsx` (`FetchKind` thêm `"docs"`, `LINES.docs`, cảnh riêng: AI lật tài liệu và soi đoạn khớp), `web/src/shared/lib/i18n/en/index.ts`

**Interfaces — Consumes:** DTO Task 5 qua `api.generated.d.ts`; `api`, `errorText` (`shared/lib/api.ts`); `Segmented`, `Dropdown`, `Hint`, `Markdown`, `AiFetching` + `useAiWait`; `TicketChip` (`features/telegram/components/message/rich-text.tsx`, import trực tiếp).

**Produces** (`features/docs/lib/docs.ts`):
- `docs.list(source?, ticket?)`, `docs.search(q, f)`, `docs.detail(id)`, `docs.sources()`, `docs.setSources(body)`, `docs.pickFolder()`, `docs.sync(force?)`, `docs.reveal(id)`
- query options: `docListQuery(f)`, `docSearchQuery(q, f)`, `docDetailQuery(id)`, `docSourcesQuery`
- `type DocFilter = { source: "all" | "youtrack" | "telegram" | "file"; ticket: string | null; doc: number | null }`

Hành vi (spec mục 6):
- URL giữ trạng thái: `?q=&source=&ticket=&doc=&part=`; mở lại link ra đúng chỗ.
- Mở màn: gọi `docs.sync()` một lần (backend tự bỏ qua nếu còn mới); nút ⟳ gọi `sync(true)`. Lỗi trong `DocSources.errors` hiện thành dải báo trên danh sách kèm nút thử lại; **không** thay bằng trạng thái trống.
- Ô tìm debounce 200ms; chưa gõ: `docListQuery`; có gõ: `docSearchQuery`. Kết quả gom theo tài liệu, tô `marks`; nhóm "Tin Telegram" ở dưới, bấm mở `/?chat=<id>&msg=<mid>`.
- Reader: render từng đoạn bằng `Markdown` (đoạn ngoài màn hình render lười để bài ~100KB cuộn mượt), mục lục từ `heading`, cuộn tới `part`, tô từ khớp; mã ticket qua `TicketChip`; nút mở bản gốc (`url`) hoặc `docs.reveal`.
- "Nguồn ▾" (`sources.tsx`, popover chỉ mount khi mở): tick project (danh sách từ `yt.projects`), thêm thư mục (`pickFolder`), bỏ thư mục, lỗi từng nguồn. Lần đầu chưa có cấu hình: gửi project tab YouTrack đang dùng (`resolveProject`).
- Chờ dữ liệu: `AiFetching kind="docs"` qua `useAiWait(pending)`, nằm giữa vùng chờ; `cover` đặt trong wrapper `relative` không cuộn cạnh khung cuộn.
- Layout hai cột dùng container query (`@max-3xl:` xếp một cột).

- [ ] **Step 1:** Cài đặt các file trên.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → sạch (thiếu chuỗi en là typecheck lỗi).
- [ ] **Step 3:** Kiểm bằng mắt trên bản copy scratch (dev server cổng khác `:8765`): tìm "giai ngan" ra đoạn có "giải ngân" được tô; mở bài dài cuộn mượt; tắt mạng YouTrack thấy dải lỗi và danh sách cũ; giao diện sáng / tối; khung hẹp.

---

### Task 7: Ô prompt AI trên màn Tài liệu

**Files:**
- Create: `web/src/features/docs/components/ask.tsx`
- Modify: `web/src/features/docs/components/app.tsx` (ghim `ask.tsx` ở đáy), `web/src/features/docs/lib/docs.ts` (`docs.ask(body, signal, onPart)`, `docs.summary(id, signal, onPart)` qua `apiStream`), `web/src/shared/lib/i18n/en/docs.ts`

**Interfaces — Consumes:** `AiPromptBox`, `UserBubble`, `AiThinking`, `AiWriting`, `AiResultCard`, `useFollow` (`shared/components/ai/chat.tsx`); `DocSearch.ask_parts` / `ask_chars`; `DocAnswer`, `DocSummary`.

Hành vi (spec mục 7):
- `AiPromptBox` ghim đáy màn; nút chạy / dừng / chọn model nằm **trong** ô (`actions` / `tools`), nút chạy `Button size="sm"` `rounded-full bg-hl` bọc `Hint`. Không có khung giới thiệu cạnh ô.
- Dòng `top` của ô ghi trước khi bấm: "Hỏi trên {n} đoạn đang hiện (~{k} ký tự)". `ask_parts == 0`: ghi "Chưa có đoạn nào khớp", nút chạy tắt.
- Đang mở một tài liệu: thêm hành động "Tóm tắt tài liệu này" trong ô, ghi kích thước bài; kết quả `cached` hiện ngay, không cảnh chờ.
- Trả lời hiện trong feed (`AiResultCard`), `[n]` là nút: mục tài liệu → mở reader ở đoạn đó; mục tin → mở tin.
- Lỗi: `doc_no_match` → "Không tìm thấy trong tài liệu"; lỗi khác qua `errorText`. Dừng được giữa chừng (`AbortSignal`).

- [ ] **Step 1:** Cài đặt. **Step 2:** `npm run typecheck && npm run lint` → sạch.
- [ ] **Step 3:** Kiểm trên bản scratch: số đoạn / ký tự đổi theo kết quả tìm; hỏi ra câu trả lời có `[n]` bấm được; tóm tắt lần hai không chạy AI (xem `data/claude_runs.jsonl` của bản scratch: chỉ một dòng `feature: "docs"` cho bài đó).

---

### Task 8: Guide, e2e, kiểm cuối

**Files:**
- Create: `web/src/shared/lib/guide/vi/docs.json`, `web/src/shared/lib/guide/en/docs.json`, `web/tests/docs.spec.ts`
- Modify: `web/src/shared/lib/guide/{vi,en}/index.ts`, `web/src/shared/lib/guide/{vi,en}/shell.json` (thanh module có thêm "Tài liệu"), `web/src/shared/lib/guide/{vi,en}/settings.json` (dòng "Tài liệu" ở Dữ liệu), `web/tests/fixture_server.py` (route giả `/api/docs*`), `docs/ARCHITECTURE.md` (thêm `docs/` backend, `features/docs/` frontend, `storage/docs.py`), `AGENTS.md` (bảng "Nơi đặt code": dòng Tài liệu)

- [ ] **Step 1:** Viết chapter guide vi + en theo đúng nhãn UI (`at` giữ nhãn tiếng Việt).
- [ ] **Step 2:** `web/tests/docs.spec.ts` (chạy trên bản copy scratch):

```ts
test("tìm không dấu ra đoạn có dấu và tô từ khớp", ...)        // gõ "giai ngan" → thấy <mark>giải</mark>
test("bấm kết quả mở reader ở đúng đoạn", ...)
test("ô prompt ghi số đoạn và số ký tự, tắt khi không có đoạn khớp", ...)
test("lỗi đồng bộ hiện dải báo, danh sách cũ vẫn còn", ...)
test("tin Telegram mở đúng deep link", ...)
```

- [ ] **Step 3:** Kiểm cuối, tất cả phải sạch:

```bash
uv run pytest -q
uv run ruff check .
npm run typecheck
npm run lint
```
e2e: `npm run test:e2e` trên bản copy scratch. Đo tâm cảnh `AiFetching kind="docs"` so với tâm vùng chờ lúc danh sách đã cuộn.

- [ ] **Step 4:** `codegraph sync`; cập nhật `WORKING-CONTEXT.md` nếu file tồn tại. Báo lại danh sách chỗ đã rà / đã sửa theo luật "rà toàn dự án".
