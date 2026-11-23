---
name: push-gate
description: Use when committing, pushing, merging or switching branches in this repo — "push hết code", "commit và push", "merge master vào", "chuyển nhánh", pushing master or a release tag, or when a push is blocked by the c-tools hook ("Chặn đẩy lên main/master: mã chưa qua cổng chất lượng", "ruff: command not found", "chưa có review độc lập ở commit này").
---

# Commit, push, merge (Telegram Dashboard)

## Quy ước

- Nhánh mặc định `master`; làm việc trên nhánh `features/*`; PR merge vào `master` trên GitHub; release luôn từ `master`
  (skill `release`).
- Subject commit theo prefix (release note nhóm theo nó, skill `release-notes`): `feat(<khu>): …`, `fix(<khu>): …`,
  `ci(…)`, `refactor(…)`, `wip(<nhánh>): …` (gom việc dở), `chore(release): vX.Y.Z`. Tiếng Anh, không `@tên`.
- Hook c-tools chỉ chặn **push lên `master`/`main`**. Push nhánh `features/*` và push tag không qua cổng.
- Hook so khớp theo **chữ trong lệnh**: một lệnh Bash chỉ sửa file mà chứa chuỗi `git push` (heredoc, sed vào skill)
  cũng bị chặn. Sửa file bằng Edit / Write, hoặc viết script ra file rồi chạy file đó.
- Được push khi user đã nói rõ trong tin nhắn: "push", "commit và push", "release", "tạo tag / release tag" (release
  gồm push master + tag). Không có các chữ đó → commit xong thì hỏi trước khi push.
- Mỗi lần gọi Bash là shell mới: `Q`, `PATH`, `R` phải gán lại **trong cùng lệnh** dùng chúng.

## Trước mọi commit

```bash
git rev-parse --abbrev-ref HEAD
git status --short | wc -l
git status --short | grep -v '^ M'                                   # file mới: xem có phải của dự án không
git status --short | grep -iE '\.env|secret|credential|\.key|\.pem|settings\.local'   # phải rỗng
git ls-files --others --exclude-standard | xargs grep -lE "(api[_-]?key|token|password)\s*[:=]\s*['\"][A-Za-z0-9_-]{16,}" 2>/dev/null
```
Có file nhạy cảm / secret (vd `.env.local`) → không `git add -A`: kiểm `git check-ignore -v <file>`, báo user tên file,
hỏi: thêm vào `.gitignore` hay bỏ khỏi commit (add từng file còn lại). Không tự đọc / in nội dung file đó. "Push hết code" = `git add -A` toàn bộ (gồm WIP của user
và phiên khác) trên nhánh hiện tại; commit message `wip(<nhánh>): …` liệt kê khu vực + gạch đầu dòng việc của mình.

`fatal: Unable to create '.git/index.lock': File exists` = một git khác (phiên khác / editor) đang chạy: chờ vài giây,
`ls .git/index.lock`, chạy lại. Chỉ xoá lock khi `pgrep -fl "git "` rỗng mà lock vẫn còn.

## Push nhánh feature

```bash
git push origin <nhánh>                 # lần đầu: git push -u origin <nhánh>
git status -sb | head -1                # phải "## <nhánh>...origin/<nhánh>" không còn [ahead N]
```

## Push `master` qua cổng c-tools

Hook `PreToolUse` của plugin c-tools chặn `git push` lên master khi commit HEAD chưa qua cổng. **Không né** (không
đổi lệnh, không push qua đường khác). Đường duy nhất ngoài cổng là user tự gõ `/c-deploy-ok <lý do>` (30 phút);
agent không tự gõ, không gợi ý thay cho việc chạy cổng.

```bash
Q=$(find "$HOME/Library/Application Support/Claude" "$HOME/.claude/plugins" -path '*/lib/ctools-quality.mjs' -print0 2>/dev/null | xargs -0 ls -t | head -1)
export PATH="$PWD/.venv/bin:$PATH"      # ruff chỉ có trong .venv: thiếu dòng này → "ruff: command not found" → lint TRƯỢT
[ -x .venv/bin/ruff ] || uv sync        # chưa có .venv / ruff
node "$Q" check --run-lint              # cần "✓ ĐẠT", critical 0 / high 0; trượt → sửa code, commit, chạy lại
node "$Q" review-prompt                 # in prompt review cho đúng dải commit cần chấm
```
1. Giao prompt đó **nguyên văn** cho subagent mới (Agent, `subagent_type: general-purpose`, `model: "opus"` — luôn
   truyền model), thêm 2–3 câu ngữ cảnh việc đã đổi, yêu cầu trả về DUY NHẤT JSON
   `{"reviewer","summary","blockers":[{"title","file","line","fix"}],"majors":[…],"minors":[…]}`. Không tự chấm.
2. Có blocker/major → sửa, commit mới, chạy lại `check` + review (review ghi **theo commit**: commit mới = chấm lại;
   gửi tiếp cho cùng agent qua SendMessage với dải mới cho rẻ). Minor rẻ, có hậu quả cụ thể → sửa luôn; còn lại ghi
   vào báo cáo cho user.
3. Ghi review rồi kiểm cổng, push:
   ```bash
   R="<scratchpad>/review.json"         # JSON agent trả về, nguyên khối
   node "$Q" review-record --file "$R"  # "ghi review … ở <sha> · blocker 0 · major 0"
   node "$Q" gate                       # "✓ qua cổng chất lượng"
   git push origin HEAD
   ```
Hook không tự chạy lint: nó đọc kết quả `check` / `review-record` đã ghi cho commit HEAD, nên PATH của hook không
quan trọng. Hook vẫn chặn sau khi `gate` đạt → đọc dòng lý do trong lỗi hook (lint / review / commit mới hơn) và xử
lý đúng lý do đó.

## Push tag

```bash
git push origin vX.Y.Z                  # sau khi master đã push
```
Không `--force`, không xoá / di chuyển tag đã push (máy người dùng có thể đã tải bản đó). Tag sai → tag mới (skill `release`).

## Chuyển nhánh

Chỉ khi `git status --short` rỗng: `git checkout <nhánh>`. Có thay đổi dở → hỏi user (commit, stash) chứ không
`git checkout -- <file>` / `git restore` (từng xoá WIP của user). Sau khi chuyển:
`git rev-list --left-right --count HEAD...master` để báo nhánh hơn / kém master bao nhiêu commit.

## Merge `master` vào nhánh feature

```bash
git fetch origin
git rev-list --left-right --count HEAD...origin/master   # "0 N": chỉ kém → fast-forward
git merge --ff-only origin/master                         # "0 N"
git merge origin/master                                   # "M N": có commit riêng → merge commit, giải conflict
```
Conflict: giữ cả hai ý khi được; không chắc → dừng, báo user file + đoạn conflict. Merge xong chạy test phần bị đụng
(`uv run --no-sync pytest -q`, `npm run typecheck`) trước khi push. Push nhánh feature cần user đồng ý nếu họ chưa nói "push".

## Lỗi hay gặp

| Hiện tượng | Nguyên nhân | Cách đúng |
|---|---|---|
| `lint TRƯỢT · ruff: command not found` | ruff chỉ trong `.venv` | `export PATH="$PWD/.venv/bin:$PATH"` rồi `check --run-lint` |
| `chưa có review độc lập ở commit này` | commit mới sau lần review trước | `review-prompt` → subagent → `review-record` → `gate` |
| Hook chặn dù vừa `check` đạt | `check` không ghi review | cần cả review-record, kiểm bằng `gate` |
| `index.lock: File exists` | git khác đang chạy | chờ rồi chạy lại, không xoá vội |
| Hook chặn lệnh không phải push | lệnh chứa chữ `git push` (sửa skill / doc) | sửa bằng Edit / Write hoặc script file |
| Release thiếu code của nhánh | release từ nhánh feature / master chưa merge PR | merge PR vào master trước, release từ master |
| Nhánh feature kém master sau release | commit `chore(release)` chỉ trên master | `git merge --ff-only origin/master` rồi push |
