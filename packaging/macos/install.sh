#!/bin/bash
# Install or update Telegram Dashboard on macOS (Apple Silicon):
#   curl -fsSL https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-macos.sh | bash
# Files fetched by curl carry no quarantine flag, so Gatekeeper does not block the unsigned app
# (a zip downloaded in a browser does). Re-running updates in place; data/ is kept.
set -euo pipefail  # macOS bash 3.2: write ${var} before non-ASCII text ("$tag…" breaks in UTF-8)
REPO=phamanh1289/telegram_dashboard
DEST="${TD_DEST:-$HOME/Applications/Telegram Dashboard}"

[ "$(uname -m)" = arm64 ] || { echo "Chỉ hỗ trợ Mac chip Apple (arm64)."; exit 1; }
tag=$(curl -fsSLo /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")
tag=${tag##*/}
ver=${tag#v}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Tải Telegram Dashboard ${tag}…"
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

# A tiny .app beside the folder: Spotlight, Launchpad and Applications list only app bundles.
app="$(dirname "$DEST")/Telegram Dashboard.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$src/AppIcon.icns" "$app/Contents/Resources/" 2>/dev/null || true  # releases before 0.1.6 have none
printf '#!/bin/bash\nexec open %q\n' "$DEST/Start Dashboard Telegram.command" >"$app/Contents/MacOS/launch"
chmod +x "$app/Contents/MacOS/launch"
cat >"$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.github.phamanh1289.telegram-dashboard</string>
  <key>CFBundleName</key><string>Telegram Dashboard</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
EOF
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" 2>/dev/null || true

echo "Đã cài ${tag} vào: ${DEST}"
echo "Lần sau mở: gõ \"Telegram Dashboard\" trong Spotlight / Launchpad (hoặc kéo app vào Dock)."
open "$app"
