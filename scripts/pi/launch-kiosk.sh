#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/pibarticker"
CONFIG_FILE="${APP_DIR}/config.json"
BACKEND_URL="http://127.0.0.1:8000"
URL="http://127.0.0.1:8000/?kiosk=1"

if [[ -z "${DISPLAY:-}" && -S "/tmp/.X11-unix/X0" ]]; then
  export DISPLAY=:0
fi

# Wait for the X server to be fully ready before doing anything with display or launching Chromium.
# This prevents "can't open display" and black screens if launched too early.
for _ in $(seq 1 30); do
  if [ -S "/tmp/.X11-unix/X0" ] && DISPLAY=${DISPLAY:-:0} xrandr >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! DISPLAY=${DISPLAY:-:0} xrandr >/dev/null 2>&1; then
  echo "Warning: X server not responding yet, proceeding anyway..."
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

# Parse width/height for explicit window sizing (helps Chromium match the xrandr mode exactly on bar displays)
WIDTH=$(echo "$DISPLAY_MODE" | cut -d'x' -f1)
HEIGHT=$(echo "$DISPLAY_MODE" | cut -d'x' -f2)

if [[ "${AUTO_START}" != "autostart" ]]; then
  echo "Kiosk startup is disabled in Setup > Display; skipping Chromium launch."
  exit 0
fi

# Ensure desktop components are running early so you see the desktop launch (lxpanel, desktop icons) like it used to.
# The kiosk Chromium will cover it after.
if ! pgrep -x lxpanel >/dev/null 2>&1; then
  lxpanel --profile LXDE-pi &
fi
if ! pgrep -x pcmanfm >/dev/null 2>&1; then
  pcmanfm --desktop --profile LXDE-pi &
fi
sleep 2

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
  # Get current active resolution
  CURRENT_MODE=$(xrandr | grep -E ' connected (primary )?[0-9]+x[0-9]+' | head -1 | grep -o '[0-9]\+x[0-9]\+' | head -1)

  if [ "$CURRENT_MODE" != "${DISPLAY_MODE}" ]; then
    echo "Current mode $CURRENT_MODE does not match desired ${DISPLAY_MODE}, setting up..."
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
    sleep 2
  else
    echo "Display already at desired mode ${DISPLAY_MODE}"
  fi
fi

# After possible resolution change, briefly restart desktop components so you see the desktop launch (like it used to),
# then the kiosk Chromium will cover it. This prevents going straight to black.
sleep 1
if command -v lxpanel >/dev/null 2>&1; then
  killall lxpanel pcmanfm 2>/dev/null || true
  sleep 1
  lxpanel --profile LXDE-pi &
  pcmanfm --desktop --profile LXDE-pi &
  sleep 2
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
    --window-size=${WIDTH},${HEIGHT} \
    --window-position=0,0 \
    --kiosk \
    "${CHROMIUM_FLAGS[@]}" \
    "${URL}"

  # Chromium may exit during updates/crashes; restart automatically.
  sleep 2
done
