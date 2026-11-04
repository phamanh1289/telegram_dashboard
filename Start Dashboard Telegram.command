#!/bin/bash
# Double-click in Finder to start the dashboard. A menu in this window starts/stops/restarts it.
set -e
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null

# ---- look -------------------------------------------------------------------
B=$'\e[1m' D=$'\e[2m' R=$'\e[0m'
RED=$'\e[31m' GRN=$'\e[32m' YEL=$'\e[33m' BLU=$'\e[34m' CYN=$'\e[36m'
ok()   { printf "  ${GRN}✔${R} %s\n" "$*"; }
err()  { printf "  ${RED}✖${R} %s\n" "$*"; }
warn() { printf "  ${YEL}!${R} %s\n" "$*"; }
info() { printf "  ${BLU}›${R} %s\n" "$*"; }
step() { printf "\n${B}${CYN}━━ %s${R}\n" "$*"; }
pause_close() { printf "\n  ${D}Enter để đóng${R} "; read -r; }

banner() {
  printf "\n${B}${CYN}  ╭──────────────────────────────────╮${R}\n"
  printf "${B}${CYN}  │${R}  ${B}✈  Telegram Dashboard${R}           ${B}${CYN}│${R}\n"
  printf "${B}${CYN}  ╰──────────────────────────────────╯${R}\n"
}

banner

# ---- setup ------------------------------------------------------------------
step "Kiểm tra môi trường"
for cmd in uv node npm; do
  if command -v "$cmd" >/dev/null; then ok "$cmd"; else err "Thiếu $cmd — xem README."; pause_close; exit 1; fi
done

[ -d .venv ] || { info "Cài Python dependencies…"; uv sync --locked; }
[ -d node_modules ] || { info "Cài Node dependencies…"; npm ci; }

# Telegram API ID/Hash and login are set in the dashboard (Cài đặt Telegram); .env is optional.

set +e  # interactive loop below: a failed kill/curl must not close the window
URL="http://127.0.0.1:8765"
LOG="data/server.log"
PID=""

build_if_stale() {
  # Rebuild the UI when it is missing or older than the sources.
  if [ ! -f web/out/index.html ] || [ -n "$(find web/src -newer web/out/index.html -print -quit)" ]; then
    info "Code giao diện đã đổi — đang build lại…"
    if npm run build >>"$LOG" 2>&1; then ok "Build giao diện xong"; else err "Build lỗi — chạy bản giao diện cũ (xem log)."; fi
  fi
}

# Dashboard servers on port 8765 (ours or one left from another window).
server_pids() {
  for p in $(lsof -t -nP -iTCP:8765 -sTCP:LISTEN 2>/dev/null); do
    ps -o command= -p "$p" | grep -q telegram_dashboard && echo "$p"
  done
}

running() { [ -n "$(server_pids)" ]; }

start() {
  if running; then warn "Server đã chạy rồi — ${URL}"; return; fi
  build_if_stale
  mkdir -p data
  # Don't leak a gateway exported in an old shell into the claude CLI: all AI uses its claude.ai login.
  env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL \
    .venv/bin/python -m telegram_dashboard serve >>"$LOG" 2>&1 &
  PID=$!
  disown "$PID"  # no "Terminated" job notice on stop; the EXIT trap still stops it
  local frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) i=0  # array: bash 3.2 slices strings by byte
  for _ in $(seq 60); do
    if curl -s -o /dev/null -H "Host: 127.0.0.1:8765" "$URL/health"; then
      printf "\r\e[K"; ok "Server đang chạy — ${B}${URL}${R}"
      return
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      printf "\r\e[K"; err "Server dừng ngay khi khởi động. Log gần nhất:"
      tail -n 20 "$LOG" | sed "s/^/    ${D}│${R} /"
      return
    fi
    printf "\r  ${CYN}%s${R} Đang khởi động server…" "${frames[i++ % 10]}"
    sleep 0.5
  done
  printf "\r\e[K"; warn "Server chưa trả lời sau 30 giây — chọn 5 để xem log."
}

stop() {
  local pids
  pids=$(server_pids)
  if [ -z "$pids" ]; then info "Không có server nào đang chạy."; return; fi
  kill $pids 2>/dev/null
  for _ in $(seq 20); do running || break; sleep 0.25; done
  running && kill -9 $(server_pids) 2>/dev/null
  PID=""
  ok "Đã dừng server."
}

trap 'stop >/dev/null; printf "\n"; exit 0' EXIT INT TERM HUP

# One digit chooses at once (every option is a single digit); Esc quits. Sets $key ("esc" for Esc).
read_choice() {
  key=""
  printf "  ${B}›${R} Bấm số để chọn ${D}(Esc: thoát)${R}: "
  while IFS= read -r -s -n 1 c; do
    case "$c" in
      $'\e')
        rest=""; IFS= read -r -s -n 2 -t 1 rest  # arrow keys also start with Esc: ignore them (bash 3.2: whole seconds)
        [ -z "$rest" ] && { echo; key="esc"; return; } ;;
      [0-9]) key=$c; echo "$c"; return ;;
    esac
  done
  exit 0  # stdin closed
}

menu() {
  local status
  if running; then status="${GRN}● đang chạy${R}  ${D}${URL}${R}"; else status="${RED}○ đã dừng${R}"; fi
  printf "\n${D}  ──────────────────────────────────────${R}\n"
  printf "  ${B}Trạng thái${R}  %s\n\n" "$status"
  printf "   ${CYN}1${R}  ▶  Start            ${CYN}4${R}  ↗  Mở trình duyệt\n"
  printf "   ${CYN}2${R}  ■  Stop             ${CYN}5${R}  ≡  Xem log\n"
  printf "   ${CYN}3${R}  ↻  Restart          ${CYN}0${R}  ⏻  Thoát ${D}(Esc)${R}\n\n"
}

step "Khởi động"
start
running && open "$URL"

while true; do
  menu
  read_choice
  case "$key" in
    1) step "Start"; start ;;
    2) step "Stop"; stop ;;
    3) step "Restart"; stop; start ;;
    4) open "$URL"; ok "Đã mở ${URL}" ;;
    5) step "Log gần nhất (${LOG})"; tail -n 40 "$LOG" | sed "s/^/    ${D}│${R} /" ;;
    0 | esc) step "Thoát"; stop; ok "Tạm biệt!"; exit 0 ;;
    *) err "Không có lựa chọn \"$key\"." ;;
  esac
done
