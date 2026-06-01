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

# Detect Wayland
IS_WAYLAND=0
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  IS_WAYLAND=1
  echo "Detected Wayland session ($WAYLAND_DISPLAY)"
fi

# Wait for Wayland compositor to be ready if applicable
if [ "$IS_WAYLAND" = "1" ]; then
  for _ in $(seq 1 30); do
    if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wlr-randr >/dev/null 2>&1 && wlr-randr >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! wlr-randr >/dev/null 2>&1; then
    echo "Warning: Wayland compositor not responding yet, proceeding anyway..."
  fi
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
BAD_FLAGS = ["--no-decommit-pooled-pages"]
RECOMMENDED = [
    "--kiosk", "--noerrdialogs", "--disable-infobars",
    "--force-device-scale-factor=1", "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist", "--disable-smooth-scrolling",
    "--overscroll-history-navigation=0", "--disable-translate",
    "--disable-features=TranslateUI",
]
cleaned = [f for f in flags if f not in BAD_FLAGS]
existing = set(cleaned)
to_add = [f for f in RECOMMENDED if f not in existing]
if to_add:
    cleaned.extend(to_add)
flags = cleaned

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

# Ensure desktop components are running early so you see the desktop launch like it used to.
# The kiosk Chromium will cover it after.
# Only for X11; on Wayland the compositor handles the desktop/panels.
if [ "$IS_WAYLAND" = "0" ]; then
  if ! pgrep -x lxpanel >/dev/null 2>&1; then
    lxpanel --profile LXDE-pi &
  fi
  if ! pgrep -x pcmanfm >/dev/null 2>&1; then
    pcmanfm --desktop --profile LXDE-pi &
  fi
  sleep 2
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

if [ "$IS_WAYLAND" = "1" ]; then
  if command -v wlr-randr >/dev/null 2>&1; then
    # Wayland (labwc/sway etc.) custom resolution for bar displays
    OUTPUT=$(wlr-randr | grep -E '^[A-Z]' | head -1 | awk '{print $1}')
    if [ -n "$OUTPUT" ]; then
      CURRENT=$(wlr-randr | grep -A1 "^$OUTPUT" | grep -o '[0-9]\+x[0-9]\+' | head -1 || echo "")
      if [ "$CURRENT" != "${DISPLAY_MODE}" ]; then
        echo "Setting Wayland custom mode ${DISPLAY_MODE} on $OUTPUT"
        wlr-randr --output "$OUTPUT" --custom-mode "${WIDTH}x${HEIGHT}" || true
        sleep 2
      else
        echo "Wayland output already at desired mode"
      fi
    fi
  else
    echo "wlr-randr not found; cannot set custom resolution on Wayland"
  fi
elif command -v xrandr >/dev/null 2>&1; then
  # X11 path: check current, create if needed
  CURRENT_MODE=$(xrandr | grep -E ' connected (primary )?[0-9]+x[0-9]+' | head -1 | grep -o '[0-9]\+x[0-9]\+' | head -1)

  if [ "$CURRENT_MODE" != "${DISPLAY_MODE}" ]; then
    echo "Current mode $CURRENT_MODE does not match desired ${DISPLAY_MODE}, setting up..."
    if ! xrandr | grep -q "${DISPLAY_MODE}"; then
      echo "Custom mode ${DISPLAY_MODE} not found, attempting to create it..."
      MODELINE=$(cvt "${WIDTH}" "${HEIGHT}" 60 2>/dev/null | grep Modeline | cut -d' ' -f2-)
      if [ -n "${MODELINE}" ]; then
        MODENAME=$(echo "${MODELINE}" | awk '{print $1}' | tr -d '"')
        xrandr --newmode ${MODELINE} 2>/dev/null || true
        OUTPUT=$(xrandr | grep " connected" | head -n1 | cut -d' ' -f1)
        if [ -n "${OUTPUT}" ] && [ -n "${MODENAME}" ]; then
          xrandr --addmode "${OUTPUT}" "${MODENAME}" 2>/dev/null || true
          echo "Registered mode ${MODENAME} on ${OUTPUT}"
        fi
      else
        echo "cvt failed to generate modeline for ${DISPLAY_MODE}"
      fi
    fi
    xrandr -s "${DISPLAY_MODE}" 2>/dev/null || xrandr -s "${DISPLAY_MODE}" >/dev/null 2>&1 || true
    sleep 2
  else
    echo "Display already at desired mode ${DISPLAY_MODE}"
  fi
fi

# After possible resolution change, briefly restart desktop components so you see the desktop launch (like it used to),
# then the kiosk Chromium will cover it. This prevents going straight to black.
# Only for X11.
if [ "$IS_WAYLAND" = "0" ]; then
  sleep 1
  if command -v lxpanel >/dev/null 2>&1; then
    killall lxpanel pcmanfm 2>/dev/null || true
    sleep 1
    lxpanel --profile LXDE-pi &
    pcmanfm --desktop --profile LXDE-pi &
    sleep 2
  fi
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
    --ozone-platform=wayland --enable-features=UseOzonePlatform \
    "${CHROMIUM_FLAGS[@]}" \
    "${URL}" >> /tmp/pibarticker-kiosk.log 2>&1

  # Chromium may exit during updates/crashes; restart automatically.
  sleep 2
done
