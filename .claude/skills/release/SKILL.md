---
name: release
description: Phát hành version mới của Telegram Dashboard — tăng version, tạo tag vX.Y.Z, để CI đóng gói macOS + Windows (zip + Setup.exe) lên GitHub Release và publish launcher npm `telegram-dashboard` (`npx telegram-dashboard`); người dùng bản cài cũ cập nhật trong Cài đặt. Dùng khi user nói "release", "phát hành", "ra bản mới", "tạo tag", "tạo release tag mới", "upgrade / nâng release tag", "tăng version", "bump version", "đóng gói", "publish npm", "build npm".
---

# Release Telegram Dashboard

Tag `vX.Y.Z` được push → `.github/workflows/release.yml` build trên `windows-latest` + `macos-latest`
(`scripts/package.py`, Inno Setup `packaging/windows/setup.iss`) → tạo GitHub Release kèm:

- `TelegramDashboard-X.Y.Z-windows-x64-setup.exe` — bộ cài cho người dùng Windows mới
- `TelegramDashboard-X.Y.Z-windows-x64.zip` — bản portable + nguồn cho cập nhật trong app (Windows)
- `TelegramDashboard-X.Y.Z-macos-arm64.zip` — bản macOS (Apple Silicon) + nguồn cập nhật (macOS)
- `install-windows.ps1` — cách cài Windows cho người dùng (`irm …/releases/latest/download/install-windows.ps1 | iex`):
  tải Setup.exe bằng PowerShell nên SmartScreen không chặn; CI parse cú pháp file này trước khi phát hành
- `install-macos.sh` — cách cài macOS cho người dùng (`curl -fsSL …/releases/latest/download/install-macos.sh | bash`);
  tải bằng curl nên không bị Gatekeeper chặn như zip tải bằng trình duyệt (app chưa notarize)

Sau khi Release xong, job `npm` publish `packaging/npm` lên npm với version = tag: gói `telegram-dashboard`
(launcher, chỉ chạy lại `install-macos.sh` / `install-windows.ps1` được copy vào lúc `prepack`). Không build gì thêm
cho npm; không tự `npm publish` từ máy (version và provenance do CI giữ; CI publish bằng Trusted Publishing, không token).

App đã cài đọc `releases` của repo `phamanh1289/telegram_dashboard` (`backend/telegram_dashboard/updater.py`,
`REPO`): Cài đặt › Cập nhật hiện "Có N bản mới trên GitHub Releases" → bấm Cập nhật (hoặc bật tự động).
**Tên file asset phải kết thúc `-<platform>.zip`** (`windows-x64`, `macos-arm64`), updater tìm theo đuôi này.
Mỗi zip có thêm `<zip>.sig` (CI ký RSA bằng secret `RELEASE_SIGNING_KEY`); updater chỉ cài khi chữ ký khớp
`backend/telegram_dashboard/release_key.pem`. Thiếu secret → job `release` fail (không bao giờ phát hành bản không ký).

## Một lần duy nhất: secret ký gói

Khóa riêng nằm ngoài repo ở `~/.config/telegram-dashboard/release_signing_key.pem` (0600, không commit, không in ra).
Trước release đầu tiên có chữ ký, **user tự chạy** (agent không chạy, đây là thao tác lên GitHub):
```bash
gh secret set RELEASE_SIGNING_KEY < ~/.config/telegram-dashboard/release_signing_key.pem
```
Đặt qua web (Settings › Secrets › Actions): dán bản base64 một dòng, `base64 -i ~/.config/telegram-dashboard/release_signing_key.pem | pbcopy`
(dán PEM nhiều dòng qua web từng làm hỏng khóa ở v0.1.8–v0.1.10; CI nhận cả PEM lẫn base64).
Mất khóa riêng → tạo cặp mới, commit `release_key.pem` mới, set lại secret; bản đã cài với khóa cũ phải cài lại
bằng lệnh cài nhanh (updater của chúng từ chối gói ký bằng khóa khác).

## Một lần duy nhất: Trusted Publishing npm (`npx telegram-dashboard`)

Job `npm` (sau `release`) publish launcher `packaging/npm` lên npm với version = tag. Nó chỉ chạy lại
`install.sh` / `install.ps1`, nên không cần build gì thêm. CI **không dùng token**: npm đổi OIDC token của job
(`id-token: write`) lấy quyền publish một lần. Token bỏ qua 2FA không còn publish được (lỗi `EOTP`; npm siết từ
07/2026), nên không quay lại `NPM_TOKEN`.

**User tự làm** (agent không làm: cần đăng nhập + 2FA của user):
1. Package chưa có trên npm (`npm view telegram-dashboard` ra E404) → publish lần đầu từ máy:
   `npm login`, rồi `cd packaging/npm && npm version X.Y.Z --no-git-tag-version && npm publish --access public`;
   xong trả `packaging/npm/package.json` về `0.0.0` (không commit version đó).
2. npmjs.com › `telegram-dashboard` › Settings › **Trusted Publisher** › GitHub Actions: owner `phamanh1289`,
   repo `telegram_dashboard`, workflow `release.yml` (sai một chữ → `ENEEDAUTH` / 404 khi publish).
3. Xoá secret cũ nếu còn: `gh secret delete NPM_TOKEN`.

Chưa làm bước 2 → riêng job `npm` fail, GitHub Release vẫn đã phát hành; làm xong bấm *Re-run failed jobs*.

## Các bước

1. **Kiểm tra sạch**: `git status` sạch, đang ở nhánh sẽ release (mặc định `master`; nhánh khác chỉ khi
   user nói rõ). `git pull --ff-only`. Đang ở nhánh feature: `git fetch origin` rồi
   `git rev-list --left-right --count origin/master...HEAD`: `N 0` = master đã có hết → chuyển sang master theo skill
   `push-gate`; số bên phải > 0 = nhánh có commit chưa vào master → dừng, hỏi user (mở / merge PR trước).
   Không sạch → hỏi user commit / stash trước, không tự bỏ thay đổi.
2. **Test**: `uv run --no-sync pytest -q`, `npm run typecheck`. Lỗi → dừng, báo user.
   Build **không** chạy trong repo (không đè `web/out`), mà trên bản copy ở scratchpad (`S` = thư mục scratchpad của
   phiên + `/e2e`). Luôn rsync lại ngay trước mỗi lần build / e2e: bản copy cũ từng cho test đỏ giả.
   ```bash
   S="<scratchpad>/e2e"; mkdir -p "$S"
   rsync -a --delete --exclude node_modules --exclude .venv --exclude web/.next --exclude web/out --exclude data \
     --exclude .git --exclude .codegraph ./ "$S/"
   [ -d "$S/node_modules" ] || cp -cR node_modules "$S/node_modules"     # copy, không symlink: Turbopack từ chối
   [ -d web/node_modules ] && [ ! -d "$S/web/node_modules" ] && cp -cR web/node_modules "$S/web/node_modules"
   (cd "$S/web" && npx next build)
   ```
   E2E trên bản copy: `E2E_PORT=<cổng trống> E2E_CONTROL=<cổng trống> npx playwright test …` trong `$S/web`
   (8766 / 8796 / 8798 / 8799 hay bị phiên khác chiếm: `lsof -iTCP -sTCP:LISTEN -nP | grep <cổng>`).
   Kiểm tra secret ký gói đã có: `gh secret list | grep RELEASE_SIGNING_KEY` (chưa có → xem mục "Một lần duy nhất");
   npm không cần secret (Trusted Publishing).
3. **Tính version mới**:
   ```bash
   git fetch --tags
   git tag --list 'v*' --sort=-v:refname | head -1
   ```
   - Chưa có tag nào → dùng đúng version trong `pyproject.toml` (lần đầu: `v0.1.0`).
   - Có tag → mặc định tăng **patch** (`v1.2.3` → `v1.2.4`). User nói "minor"/"tính năng lớn" → `v1.3.0`;
     "major"/"breaking" → `v2.0.0`. Version mới phải lớn hơn tag mới nhất (updater so số học).
   - Báo user version sẽ dùng trước khi tag.
4. **Ghi version + commit + tag**:
   ```bash
   sed -i '' 's/^version = ".*"/version = "X.Y.Z"/' pyproject.toml
   uv lock
   git add pyproject.toml uv.lock
   git commit -m "chore(release): vX.Y.Z"
   git tag -a vX.Y.Z --cleanup=verbatim -F "${TMPDIR:-/tmp}/tag-msg.md"
   ```
   `tag-msg.md` là release note song ngữ (Việt + Anh): viết theo skill `release-notes` **trước** lệnh tag, xem trước
   bằng `bash scripts/release-notes.sh vX.Y.Z`.
5. **Push**: `git push origin HEAD` (master, qua cổng c-tools theo skill `push-gate`) rồi `git push origin vX.Y.Z`
   (tag, không qua cổng). Khi nào được push mà không hỏi lại: xem `push-gate` › Quy ước.
6. **Theo dõi CI**: `gh run list --workflow release.yml -L 1`, `gh run watch <id>` (cần `gh auth login`;
   không có thì đưa user link `https://github.com/phamanh1289/telegram_dashboard/actions`).
7. **Xác nhận**: `gh release view vX.Y.Z --json assets -q '.assets[].name'` phải có đủ 5 file ở trên
   và 2 file `.zip.sig`.
   Kiểm body: `gh release view vX.Y.Z --json body -q .body | head` mở đầu `## Có gì mới`, có `## What's new`
   (tag tạo theo skill `release-notes`; tag không có thân thì body chỉ có danh sách commit).
   npm: job `npm` xanh và `npm view telegram-dashboard version` ra `X.Y.Z` (registry có thể trễ 1–2 phút).
   Báo user link release `https://github.com/phamanh1289/telegram_dashboard/releases/tag/vX.Y.Z`
   và `https://www.npmjs.com/package/telegram-dashboard`.
8. **Đưa nhánh feature theo kịp**: commit `chore(release)` chỉ ở master → hỏi user có merge master vào nhánh đang
   làm không (skill `push-gate`, mục merge).

## Khi CI lỗi

- Sửa code → commit → **tag mới** (tăng patch tiếp). Không force-push/di chuyển tag đã push: máy người dùng
  có thể đã tải bản đó.
- Chỉ job `npm` đỏ (`ENEEDAUTH` / `E404` = Trusted Publisher chưa cấu hình hoặc sai repo / workflow; npm lỗi):
  **không** tag mới. Sửa cấu hình trên npmjs.com rồi `gh run rerun <id> --failed`. Version npm đã publish không xóa / đè được: lỗi trong launcher thì sửa rồi ra tag mới.
- Release hỏng đã tạo: hỏi user rồi `gh release edit vX.Y.Z --draft` (updater bỏ qua draft/prerelease) rồi phát hành bản sau.

## Thử gói trên máy (không bắt buộc)

```bash
npm run build && uv run --no-project --python 3.14 scripts/package.py v0.0.0
```
Ra `dist/TelegramDashboard-0.0.0-<platform>.zip` cho đúng OS đang chạy (Windows build chỉ có trên CI
hoặc máy Windows). `dist/` đã gitignore.

Launcher npm: `cd packaging/npm && npm pack --dry-run` phải liệt kê `cli.mjs`, `install-macos.sh`,
`install-windows.ps1`, `package.json`. Chạy thử không cài thật: `HOME=<thư mục tạm> node packaging/npm/cli.mjs open`
→ báo "chưa được cài". Không chạy `start` / `update` trên máy dev (installer cài và mở app thật).

## Lưu ý thiết kế (đừng phá)

- Bản cài: `<thư mục cài>/{Start Dashboard Telegram.bat|.command, current, versions/<ver>/{python,app}, data/}`.
  Launcher đặt `TD_HOME` → data ở `<thư mục cài>/data`, ngoài `versions/`, nên cập nhật không mất session.
- Cập nhật không ghi đè file đang chạy: tải vào `versions/<ver mới>`, đổi `current`, server thoát mã 75,
  launcher chạy lại bản mới; lần khởi động sau xóa bản cũ. **Launcher không bao giờ được cập nhật trong app**
  (Windows/bash đọc script khi đang chạy) → giữ launcher tối giản; đổi launcher = người dùng cài Setup mới.
- Launcher npm chỉ gọi installer / `myradar`: app và `data/` không bao giờ nằm trong `node_modules` (npm update
  sẽ xóa). Đổi cách cài thì sửa `install.sh` / `install.ps1`, npm tự theo ở bản sau.
- Đổi tên repo/owner → sửa `REPO` trong `updater.py`, `install.sh`, `install.ps1` và `repository` trong
  `packaging/npm/package.json` (provenance kiểm khớp repo) trước khi release.
