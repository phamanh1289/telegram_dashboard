---
name: release
description: Phát hành version mới của Telegram Dashboard — tăng version, tạo tag vX.Y.Z, để CI đóng gói macOS + Windows (zip + Setup.exe) lên GitHub Release; người dùng bản cài cũ cập nhật trong Cài đặt. Dùng khi user nói "release", "phát hành", "ra bản mới", "tạo tag", "đóng gói".
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

App đã cài đọc `releases` của repo `phamanh1289/telegram_dashboard` (`telegram_dashboard/updater.py`,
`REPO`): Cài đặt › Cập nhật hiện "Có N bản mới trên GitHub Releases" → bấm Cập nhật (hoặc bật tự động).
**Tên file asset phải kết thúc `-<platform>.zip`** (`windows-x64`, `macos-arm64`), updater tìm theo đuôi này.
Mỗi zip có thêm `<zip>.sig` (CI ký RSA bằng secret `RELEASE_SIGNING_KEY`); updater chỉ cài khi chữ ký khớp
`telegram_dashboard/release_key.pem`. Thiếu secret → job `release` fail (không bao giờ phát hành bản không ký).

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

## Các bước

1. **Kiểm tra sạch**: `git status` sạch, đang ở nhánh sẽ release (mặc định `master`; nhánh khác chỉ khi
   user nói rõ). `git pull --ff-only`.
2. **Test**: `uv run --no-sync pytest -q`, `npm run typecheck`, `npm run build`. Lỗi → dừng, báo user.
   Kiểm tra secret đã có: `gh secret list | grep RELEASE_SIGNING_KEY` (chưa có → xem mục "Một lần duy nhất").
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
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```
5. **Push** (hỏi user trước — đây là thao tác công khai): `git push origin HEAD` rồi `git push origin vX.Y.Z`.
6. **Theo dõi CI**: `gh run list --workflow release.yml -L 1`, `gh run watch <id>` (cần `gh auth login`;
   không có thì đưa user link `https://github.com/phamanh1289/telegram_dashboard/actions`).
7. **Xác nhận**: `gh release view vX.Y.Z --json assets -q '.assets[].name'` phải có đủ 5 file ở trên
   và 2 file `.zip.sig`.
   Báo user link release `https://github.com/phamanh1289/telegram_dashboard/releases/tag/vX.Y.Z`.

## Khi CI lỗi

- Sửa code → commit → **tag mới** (tăng patch tiếp). Không force-push/di chuyển tag đã push: máy người dùng
  có thể đã tải bản đó.
- Release hỏng đã tạo: `gh release edit vX.Y.Z --draft` (updater bỏ qua draft/prerelease) rồi phát hành bản sau.

## Thử gói trên máy (không bắt buộc)

```bash
npm run build && uv run --no-project --python 3.14 scripts/package.py v0.0.0
```
Ra `dist/TelegramDashboard-0.0.0-<platform>.zip` cho đúng OS đang chạy (Windows build chỉ có trên CI
hoặc máy Windows). `dist/` đã gitignore.

## Lưu ý thiết kế (đừng phá)

- Bản cài: `<thư mục cài>/{Start Dashboard Telegram.bat|.command, current, versions/<ver>/{python,app}, data/}`.
  Launcher đặt `TD_HOME` → data ở `<thư mục cài>/data`, ngoài `versions/`, nên cập nhật không mất session.
- Cập nhật không ghi đè file đang chạy: tải vào `versions/<ver mới>`, đổi `current`, server thoát mã 75,
  launcher chạy lại bản mới; lần khởi động sau xóa bản cũ. **Launcher không bao giờ được cập nhật trong app**
  (Windows/bash đọc script khi đang chạy) → giữ launcher tối giản; đổi launcher = người dùng cài Setup mới.
- Đổi tên repo/owner → sửa `REPO` trong `updater.py` trước khi release.
