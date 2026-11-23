#!/bin/bash
# Install or update Radar on macOS (Apple Silicon):
#   curl -fsSL https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-macos.sh | bash
# Files fetched by curl carry no quarantine flag, so Gatekeeper does not block the unsigned app
# (a zip downloaded in a browser does). Re-running updates in place; data/ is kept.
set -euo pipefail  # macOS bash 3.2: write ${var} before non-ASCII text ("$tag…" breaks in UTF-8)
REPO=phamanh1289/telegram_dashboard
# CI signs every release zip with the key the app checks its updates with (backend/telegram_dashboard/release_key.pem,
# here as SPKI for openssl; tests/test_updater_release.py keeps the two equal). GitHub's digest only says the asset is
# what was uploaded, not who built it.
PUB="-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAjACK1OuCgtvk+aL++SYW
+as+fi1qWxYV9JIJLMwkk/g4peiqGjxdm1qYGadQustzCJADMGYjmi1OJ2Hqu9AZ
i8gDGjQbVrVVdf8U0SOkLfPbrOdmUv2zylCxe8GJaf7e1rb6dsvpCS7Pqxn8KlkX
XO+mlYfa2ppP4Y41RYOMSlHgVvPTf5w5aBBpqUHK8CmK8IZ/Enj0gFhI6BPhew3o
9Rp4zt2MTqO2X7GBdMi1xbE9d/wAA8NYYP9lePhHIHXRwpY45AAhF3in9wCmk63P
4uYbWegn6lwMBo3/z8q6qLlpO3LYi2ds9/ZZzz8uschAE1qk8JTUU63V3OZNR0YS
VP/F+6WgOl2Ysp/E64gAmCiq9CC8cdKWfchztI38iDkGQPvOj5KiadpncekNU3B9
mQ7BWeATaygwZbZiGE7aY6GoepgdvFtBLJkRqZeX8UP4+QtbZvI7lgKz9/BoYi8C
8mOto2iycve4UsaKr1Z3tZWVWRLHUtrt+89vrBweNMnRAgMBAAE=
-----END PUBLIC KEY-----"
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
curl -fsSL -o "$tmp/td.zip.sig" "https://github.com/$REPO/releases/download/$tag/$file.sig" ||
  { echo "Bản ${tag} không có chữ ký (.sig): không cài."; exit 1; }
printf '%s\n' "$PUB" >"$tmp/pub.pem"
/usr/bin/openssl dgst -sha256 -verify "$tmp/pub.pem" -signature "$tmp/td.zip.sig" "$tmp/td.zip" >/dev/null 2>&1 ||
  { echo "Gói tải về không có chữ ký hợp lệ của Radar: không cài."; exit 1; }
ditto -x -k "$tmp/td.zip" "$tmp/x"
src="$tmp/x/Telegram Dashboard"
mkdir -p "$DEST/versions"
rm -rf "$DEST/versions/$ver"
mv "$src/versions/$ver" "$DEST/versions/$ver"
cp "$src/Start Dashboard Telegram.command" "$DEST/"
printf %s "$ver" >"$DEST/current"
# only what was just verified (and the launcher): never a whole folder something else may have dropped into
xattr -dr com.apple.quarantine "$DEST/versions/$ver" "$DEST/Start Dashboard Telegram.command" 2>/dev/null || true

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
