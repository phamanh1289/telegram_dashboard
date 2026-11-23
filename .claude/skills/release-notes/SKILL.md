---
name: release-notes
description: Use when writing, previewing or rewriting the GitHub Release notes of Telegram Dashboard — before tagging vX.Y.Z (the tag message summary), when a published release only shows PR titles or "What's Changed", or when the user asks for "release note", "ghi chú phát hành", "tóm tắt thay đổi", "viết lại note cho vX.Y.Z".
---

# Release notes (Telegram Dashboard)

## Nội dung release đến từ đâu

Job `release` trong `.github/workflows/release.yml` chạy `bash scripts/release-notes.sh "$GITHUB_REF_NAME"` và
đưa kết quả vào `body_path` của `softprops/action-gh-release`. Body = theo thứ tự:

1. **Thân message của annotated tag** (mọi dòng sau dòng 1 + dòng trống): phần tóm tắt cho người dùng, do agent
   viết lúc tag. Tag không có thân → phần này trống, release chỉ còn danh sách commit.
2. **Commit từ tag `v*` trước** (theo ancestry, `git describe "$tag^"`), bỏ merge và `chore(release)`, nhóm
   `### Tính năng / Features` (`feat`), `### Sửa lỗi / Fixes` (`fix`), `### Khác / Other` (còn lại).
   `feat(docs): x` → `- **docs**: x` (subject commit viết tiếng Anh nên phần này dùng chung cho 2 ngôn ngữ).
3. GitHub tự nối thêm danh sách PR + link **Full Changelog** (`generate_release_notes: true`).

App đã cài **không** đọc body release (updater chỉ tải zip), nên note chỉ hiện trên trang GitHub Release.

Commit subject quyết định nhóm: dùng đúng prefix `feat(...)`, `fix(...)`, `ci(...)`, `wip(...)`, `chore(release)`.

**Song ngữ**: note luôn có tiếng Việt trước, tiếng Anh sau, cùng nội dung (người dùng app chọn VI / EN trong app).
Tóm tắt có 2 khối `## Có gì mới` và `## What's new`, cùng nhóm, cùng số gạch, cùng thứ tự; tiêu đề nhóm commit do
script in sẵn dạng `Việt / English`.

## Viết tóm tắt (trước khi tag)

1. Tag trước (`P`): sắp tag → `git describe --tags --abbrev=0 --match 'v*' HEAD`; viết lại note cho tag đã có
   `vX.Y.Z` → `git describe --tags --abbrev=0 --match 'v*' vX.Y.Z^` và thay `HEAD` bằng `vX.Y.Z` trong các lệnh dưới.
2. Đọc nguồn, theo thứ tự hữu ích:
   ```bash
   git log --no-merges --format='--- %s%n%b' <tag trước>..HEAD          # subject + thân commit
   git diff <tag trước> HEAD -- web/src/shared/lib/guide/vi/ | grep -E '^\+\s*"title"'   # tính năng người dùng thấy
   git diff --stat <tag trước> HEAD -- web/src backend | tail -40        # khu vực bị đổi
   ```
   Commit `wip(...)` thường gom cả trăm file với subject vô nghĩa: **title guide mới** là nguồn chính cho phần
   người dùng thấy. Mỗi feature người dùng thấy đều phải có chapter guide (luật repo), nên title guide ≈ danh sách tính năng.
3. Viết file `${TMPDIR:-/tmp}/tag-msg.md` đúng khuôn:
   ```markdown
   vX.Y.Z

   ## Có gì mới

   **Tài liệu**
   - <thay đổi người dùng thấy, 1 câu, theo nhãn UI tiếng Việt>

   **Telegram**
   - …

   **YouTrack**
   - …

   **Cài đặt** / **Chung**
   - …

   ## What's new

   **Documents**
   - <cùng ý với gạch tiếng Việt tương ứng, theo nhãn UI tiếng Anh>

   **Telegram**
   - …

   **YouTrack**
   - …

   **Settings** / **General**
   - …
   ```
   - Dòng 1 = `vX.Y.Z`, dòng 2 trống (thiếu dòng trống → git coi tất cả là subject, thân rỗng, mất tóm tắt).
   - Chỉ giữ nhóm có nội dung; mỗi nhóm 1–5 gạch; màn mới ghi "(màn mới)" sau tên nhóm.
   - Đúng nhãn UI: tiếng Việt lấy từ guide `web/src/shared/lib/guide/vi/` / chuỗi `t("…")`; tiếng Anh lấy đúng bản
     dịch của nhãn đó trong `web/src/shared/lib/i18n/en/*.ts` và `guide/en/` (vd "Tài liệu" → "Documents",
     "Yêu thích" → "Favourites"), không tự dịch khác app. Không tên file, hàm, API, field, mã commit.
     Tra nhãn: `grep -rn '"Yêu thích"' web/src/shared/lib/i18n/en/` (không thấy → `grep -rn 'Yêu thích' web/src/shared/lib/guide/en/`).
   - Khối tiếng Anh dịch đúng từng gạch tiếng Việt: không thêm, không bớt, không đổi thứ tự.
   - Không `@tên` (GitHub notify người đó), không hứa điều chưa kiểm (chỉ viết cái có trong code / guide).
   - Sửa lỗi người dùng gặp → nhóm theo màn, câu dạng "Sửa: <hiện tượng> không còn xảy ra".
4. Tag (giữ dòng `##` / `#`, mặc định git xoá dòng bắt đầu bằng `#`):
   ```bash
   git tag -a vX.Y.Z --cleanup=verbatim -F "${TMPDIR:-/tmp}/tag-msg.md"
   bash scripts/release-notes.sh vX.Y.Z      # xem trước đúng body CI sẽ đăng (trừ phần GitHub nối thêm)
   ```
   Sai trước khi push: `git tag -d vX.Y.Z` rồi tag lại. Đã push: **không** di chuyển tag, sửa body bằng mục dưới.

## Viết lại note cho release đã đăng

Sửa trang release công khai: hỏi user trước, trừ khi chính user vừa yêu cầu viết lại note cho đúng tag đó.

```bash
N="${TMPDIR:-/tmp}/notes-vX.Y.Z.md"
# 1. tóm tắt "## Có gì mới …" + "## What's new …" (khuôn ở trên, không có dòng vX.Y.Z) vào "$N"
bash scripts/release-notes.sh vX.Y.Z >> "$N"                                  # danh sách commit như CI
printf '**Full Changelog**: https://github.com/phamanh1289/telegram_dashboard/compare/<tag trước>...vX.Y.Z\n' >> "$N"
gh release edit vX.Y.Z --notes-file "$N"
gh release view vX.Y.Z --json body,isDraft,assets -q '(.body|split("\n")|.[0:3]|join("\n")), .isDraft, (.assets|length)'
```
Kiểm: body mở đầu `## Có gì mới`, có `## What's new`, `isDraft` false, đủ 7 asset (xem skill `release`). `gh release edit` chỉ đổi
body, không đụng asset / tag. Tag cũ không có thân message thì `release-notes.sh` chỉ in danh sách commit: đúng.

## Lỗi hay gặp

| Hiện tượng | Nguyên nhân | Cách đúng |
|---|---|---|
| Release chỉ có "What's Changed" + tên PR | tag tạo bằng `-m "vX.Y.Z"` (không thân) | tag bằng `-F tag-msg.md` có tóm tắt |
| Mất các dòng `## Có gì mới` | `git tag` cleanup=strip xoá dòng `#` | `--cleanup=verbatim` |
| Tóm tắt không hiện | thiếu dòng trống sau dòng 1 | dòng 2 để trống |
| Script in `no tag vX.Y.Z`, exit 1 | gõ sai tag / chưa tag | `git tag --list 'v*'` |
| `fixup!` / `feature …` lọt nhóm sai | subject không theo prefix | sửa subject trước khi push (sau push thì để nguyên) |
| File ghi ra `/tag-msg.md` | `$TMPDIR` trống (Linux) | luôn `${TMPDIR:-/tmp}` |
| Người bị nhắc nhận notify | `@tên` trong note / subject | bỏ `@` hoặc bọc backtick |
| Note viết tên hàm, API | viết cho dev | viết theo màn và nhãn UI |
| Chỉ có tiếng Việt / EN lệch ý VI | quên khối `## What's new` hoặc dịch tự do | 2 khối, gạch dịch 1–1, nhãn lấy từ `i18n/en` |

Liên quan: skill `release` (cả quy trình phát hành), skill `push-gate` (push master / tag qua cổng c-tools).
