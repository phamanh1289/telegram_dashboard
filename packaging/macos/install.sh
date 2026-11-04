#!/bin/bash
# Install or update Telegram Dashboard on macOS (Apple Silicon):
#   curl -fsSL https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-macos.sh | bash
# Files fetched by curl carry no quarantine flag, so Gatekeeper does not block the unsigned app
# (a zip downloaded in a browser does). Re-running updates in place; data/ is kept.
set -euo pipefail
REPO=phamanh1289/telegram_dashboard
DEST="${TD_DEST:-$HOME/Applications/Telegram Dashboard}"

[ "$(uname -m)" = arm64 ] || { echo "Chỉ hỗ trợ Mac chip Apple (arm64)."; exit 1; }
tag=$(curl -fsSLo /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")
tag=${tag##*/}
ver=${tag#v}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Tải Telegram Dashboard $tag…"
curl -fL --progress-bar -o "$tmp/td.zip" \
  "https://github.com/$REPO/releases/download/$tag/TelegramDashboard-$ver-macos-arm64.zip"
ditto -x -k "$tmp/td.zip" "$tmp/x"
src="$tmp/x/Telegram Dashboard"
mkdir -p "$DEST/versions"
rm -rf "$DEST/versions/$ver"
mv "$src/versions/$ver" "$DEST/versions/$ver"
cp "$src/Start Dashboard Telegram.command" "$DEST/"
printf %s "$ver" >"$DEST/current"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Đã cài $tag vào: $DEST"
echo "Lần sau mở: double-click 'Start Dashboard Telegram.command' trong thư mục trên (hoặc kéo nó vào Dock)."
open -R "$DEST/Start Dashboard Telegram.command"
open "$DEST/Start Dashboard Telegram.command"
