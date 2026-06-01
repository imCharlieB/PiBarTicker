#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/pibarticker"
CONFIG_FILE="${APP_DIR}/config.json"
BACKEND_URL="http://127.0.0.1:8000"
URL="http://127.0.0.1:8000/?kiosk=1"

if [[ -z "${DISPLAY:-}" && -S "/tmp/.X11-unix/X0" ]]; then
  export DISPLAY=:0
fi

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
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.5 -root >/dev/null 2>&1 &
fi

# Disable DPMS and screen blanking for always-on signage.
if command -v xset >/dev/null 2>&1; then
  xset s off >/dev/null 2>&1 || true
  xset -dpms >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
fi

if command -v xrandr >/dev/null 2>&1; then
  # Robust custom resolution support for bar displays (e.g. 1920x380, 3840x380).
  # Many users need non-standard modes that aren't pre-registered.
  # This uses cvt to generate and registers the mode on the first connected output if needed.
  WIDTH=$(echo "${DISPLAY_MODE}" | cut -d'x' -f1)
  HEIGHT=$(echo "${DISPLAY_MODE}" | cut -d'x' -f2)

  if ! xrandr | grep -q "${DISPLAY_MODE}"; then
    echo "Custom mode ${DISPLAY_MODE} not found, attempting to create it..."
    # Generate modeline (60Hz is usually fine for ticker)
    MODELINE=$(cvt "${WIDTH}" "${HEIGHT}" 60 2>/dev/null | grep Modeline | cut -d' ' -f2-)
    if [ -n "${MODELINE}" ]; then
      MODENAME=$(echo "${MODELINE}" | awk '{print $1}' | tr -d '"')
      # Add the mode
      xrandr --newmode ${MODELINE} 2>/dev/null || true
      # Find primary output
      OUTPUT=$(xrandr | grep " connected" | head -n1 | cut -d' ' -f1)
      if [ -n "${OUTPUT}" ] && [ -n "${MODENAME}" ]; then
        xrandr --addmode "${OUTPUT}" "${MODENAME}" 2>/dev/null || true
        echo "Registered mode ${MODENAME} on ${OUTPUT}"
      fi
    else
      echo "cvt failed to generate modeline for ${DISPLAY_MODE}"
    fi
  fi

  # Now try to set the mode
  xrandr -s "${DISPLAY_MODE}" 2>/dev/null || xrandr -s "${DISPLAY_MODE}" >/dev/null 2>&1 || true
  sleep 0.5
fi

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
    --force-device-scale-factor=1 \
    --enable-gpu-rasterization \
    --enable-zero-copy \
    --ignore-gpu-blocklist \
    --disable-smooth-scrolling \
    --user-data-dir=/tmp/pibarticker-kiosk \
    --incognito \
    --no-first-run \
    --no-default-browser-check \
    "${CHROMIUM_FLAGS[@]}" \
    "${URL}"

  # Chromium may exit during updates/crashes; restart automatically.
  sleep 2
done
