#!/bin/bash
# Install or update Radar on macOS (Apple Silicon):
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

file="TelegramDashboard-$ver-macos-arm64.zip"
echo "Tải Radar ${tag}…"
curl -fL --progress-bar -o "$tmp/td.zip" "https://github.com/$REPO/releases/download/$tag/$file"
# The sha256 GitHub computed for the asset (API, pretty-printed: the first "digest" after its name).
want=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$tag" |
  awk -v n="\"name\": \"$file\"" 'index($0, n) {f = 1} f && /"digest"/ {gsub(/.*"sha256:|".*/, ""); print; exit}')
got=$(shasum -a 256 "$tmp/td.zip" | cut -d' ' -f1)
[ -n "$want" ] && [ "$got" = "$want" ] || { echo "Gói tải về sai checksum (hoặc không đọc được checksum): không cài."; exit 1; }
ditto -x -k "$tmp/td.zip" "$tmp/x"
src="$tmp/x/Telegram Dashboard"
mkdir -p "$DEST/versions"
rm -rf "$DEST/versions/$ver"
mv "$src/versions/$ver" "$DEST/versions/$ver"
cp "$src/Start Dashboard Telegram.command" "$DEST/"
printf %s "$ver" >"$DEST/current"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# `myradar start` (alias `mydashboard`, the old name) in Terminal: a tiny command in ~/.local/bin, put on PATH via ~/.zprofile.
bin="$HOME/.local/bin"
mkdir -p "$bin"
cat >"$bin/myradar" <<EOF
#!/bin/bash
case "\${1:-start}" in
  start) exec $(printf %q "$DEST/Start Dashboard Telegram.command") ;;
  open) cd $(printf %q "$DEST")/versions/"\$(cat $(printf %q "$DEST/current"))"/app && exec ../python/bin/python3 -m telegram_dashboard open ;;
  *) echo "Dùng: \$(basename "\$0") start | open"; exit 2 ;;
esac
EOF
chmod +x "$bin/myradar"
ln -sf myradar "$bin/mydashboard"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) grep -qs '.local/bin' "$HOME/.zprofile" || echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$HOME/.zprofile" ;;
esac

# A tiny .app beside the folder: Spotlight, Launchpad and Applications list only app bundles.
app="$(dirname "$DEST")/Radar.app"
rm -rf "$(dirname "$DEST")/Telegram Dashboard.app"  # name before the rename to Radar
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
  <key>CFBundleName</key><string>Radar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
EOF
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" 2>/dev/null || true

echo "Đã cài ${tag} vào: ${DEST}"
echo "Lần sau mở: gõ \"Radar\" trong Spotlight / Launchpad (hoặc kéo app vào Dock),"
echo "hoặc mở Terminal mới và gõ: myradar start"
open "$app"
