#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/pibarticker"
CONFIG_FILE="${APP_DIR}/config.json"
BACKEND_URL="http://127.0.0.1:8000"
URL="http://127.0.0.1:8000/?kiosk=1"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing ${CONFIG_FILE}; kiosk launcher cannot read setup settings."
  exit 1
fi

readarray -t CONFIG_LINES < <(
  python3 - <<'PY' "${CONFIG_FILE}"
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
cfg = json.loads(path.read_text(encoding="utf-8"))
kiosk = cfg.get("kiosk", {})
monitor = cfg.get("monitor", {})

auto_start = str(kiosk.get("autoStart", "autostart")).strip().lower()
width = int(monitor.get("width", 1920) or 1920)
height = int(monitor.get("height", 380) or 380)
flags = kiosk.get("chromiumFlags", [])
if not isinstance(flags, list):
    flags = []
if not flags:
    flags = ["--kiosk", "--noerrdialogs", "--disable-infobars"]

print(auto_start)
print(f"{width}x{height}")
for flag in flags:
    text = str(flag).strip()
    if text:
        print(text)
PY
)

AUTO_START="${CONFIG_LINES[0]:-autostart}"
DISPLAY_MODE="${CONFIG_LINES[1]:-1920x380}"
CHROMIUM_FLAGS=("${CONFIG_LINES[@]:2}")

if [[ "${AUTO_START}" != "autostart" ]]; then
  echo "Kiosk startup is disabled in Setup > Display; skipping Chromium launch."
  exit 0
fi

CHROMIUM_BIN=""
if command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium-browser"
elif command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium"
else
  echo "Chromium is not installed."
  exit 1
fi

# Keep the pointer hidden while kiosk is active.
unclutter -idle 0.5 -root >/dev/null 2>&1 &

# Disable DPMS and screen blanking for always-on signage.
xset s off
xset -dpms
xset s noblank
xrandr -s "${DISPLAY_MODE}" >/dev/null 2>&1 || true

# Wait for backend before starting Chromium.
for _ in $(seq 1 60); do
  if curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

while true; do
  "${CHROMIUM_BIN}" \
    --disable-session-crashed-bubble \
    --disable-translate \
    --disable-features=TranslateUI \
    --overscroll-history-navigation=0 \
    --check-for-update-interval=31536000 \
    "${CHROMIUM_FLAGS[@]}" \
    "${URL}"

  # Chromium may exit during updates/crashes; restart automatically.
  sleep 2
done
