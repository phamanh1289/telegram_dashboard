#!/bin/bash
# Telegram Dashboard (installed build). Double-click to start; close this window to stop.
# Keep this file tiny and stable: in-app updates swap versions/<ver> + "current", never this file.
cd "$(dirname "$0")" || exit 1
export TD_HOME="$PWD"
# Unzipped downloads are quarantined; the user already allowed this script, so clear the rest.
xattr -dr com.apple.quarantine . 2>/dev/null
unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL
(sleep 3; open "http://127.0.0.1:8765") &
echo "Telegram Dashboard: http://127.0.0.1:8765 — đóng cửa sổ này để tắt."
while :; do
  V=$(cat current)
  (cd "versions/$V/app" && exec ../python/bin/python3 -m telegram_dashboard serve)
  code=$?
  [ "$code" -eq 75 ] || break  # 75 = updated from Settings: start the new version
done
[ "$code" -eq 0 ] || { echo "Server dừng (mã $code). Enter để đóng."; read -r; }
