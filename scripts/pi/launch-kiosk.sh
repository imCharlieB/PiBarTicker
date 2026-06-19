#!/usr/bin/env bash
set -euo pipefail

# launch-kiosk.sh
# X11/openbox kiosk launcher for PiBarTicker on Raspberry Pi OS.
# - Started from ~/.config/openbox/autostart (see install_pi.sh)
# - Sets display resolution via xrandr; openbox rc.xml removes all decorations
# - Launches Chromium with --app so it spans both monitors in dual mode
# - Waits for backend health before first launch, then restarts on exit (crash recovery)

# Redirect all script output to the kiosk log for diagnostics.
exec >> /tmp/pibarticker-kiosk.log 2>&1
echo "=== launch-kiosk.sh started $(date) ==="

APP_DIR="/opt/pibarticker"
CONFIG_FILE="${APP_DIR}/config.json"
BACKEND_URL="http://127.0.0.1:8000"
URL="http://127.0.0.1:8000/?kiosk=1"

# Ensure DISPLAY is set (openbox session sets it, but guard for edge cases).
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=:0
fi

# Wait for the X server to be ready before touching xrandr or launching Chromium.
for _ in $(seq 1 30); do
  if [ -S "/tmp/.X11-unix/X0" ] && xrandr >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! xrandr >/dev/null 2>&1; then
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
mode = str(monitor.get("mode", "single")).strip().lower()
swap_outputs = bool(monitor.get("swapOutputs", False))
width = int(monitor.get("width", 1920) or 1920)
height = int(monitor.get("height", 380) or 380)
flags = kiosk.get("chromiumFlags", [])
if not isinstance(flags, list):
    flags = []
BAD_FLAGS = [
    "--no-decommit-pooled-pages",
    "--kiosk",
    "--ozone-platform=wayland",
    "--ozone-platform=x11",
    "--use-gl=egl",
]
RECOMMENDED = [
    "--noerrdialogs", "--disable-infobars",
    "--force-device-scale-factor=1", "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist", "--disable-smooth-scrolling",
    "--overscroll-history-navigation=0", "--disable-translate",
    "--disable-features=TranslateUI",
    "--enable-features=OverlayScrollbar,VaapiVideoDecoder",
    "--disable-webgpu",
]
BAD_SET = {b.strip() for b in BAD_FLAGS}
cleaned = [f for f in flags if str(f).strip() not in BAD_SET]
existing = {f.strip() for f in cleaned}
to_add = [f for f in RECOMMENDED if f.strip() not in existing]
if to_add:
    cleaned.extend(to_add)
flags = cleaned

print(auto_start)
print(mode)
print("true" if swap_outputs else "false")
print(f"{width}x{height}")
for flag in flags:
    text = str(flag).strip()
    if text:
        print(text)
PY
)

AUTO_START="${CONFIG_LINES[0]:-autostart}"
MONITOR_MODE="${CONFIG_LINES[1]:-single}"
SWAP_OUTPUTS="${CONFIG_LINES[2]:-false}"
DISPLAY_MODE="${CONFIG_LINES[3]:-1920x380}"
CHROMIUM_FLAGS=("${CONFIG_LINES[@]:4}")

WIDTH=$(echo "$DISPLAY_MODE" | cut -d'x' -f1)
HEIGHT=$(echo "$DISPLAY_MODE" | cut -d'x' -f2)

if [ "$MONITOR_MODE" = "dual" ]; then
  CHROMIUM_WINDOW_WIDTH=$((WIDTH * 2))
else
  CHROMIUM_WINDOW_WIDTH=$WIDTH
fi

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

# Hide the mouse cursor while the kiosk is active.
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.5 -root >/dev/null 2>&1 &
fi

# Disable DPMS and screen blanking for always-on signage.
if command -v xset >/dev/null 2>&1; then
  xset s off >/dev/null 2>&1 || true
  xset -dpms >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
fi

# Hide the X11 root-window cursor (CSS cursor:none covers Chromium content;
# xsetroot covers any bare desktop area not painted by Chromium).
if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -cursor_name none >/dev/null 2>&1 || true
fi

# Kill power managers and desktop panels that would obscure the kiosk window or
# trigger DPMS-off and cut the HDMI signal.
pkill -f lxqt-powermanagement 2>/dev/null || true
pkill -f lxpanel 2>/dev/null || true
pkill -f tint2 2>/dev/null || true
pkill -f pcmanfm 2>/dev/null || true

# Sets the custom bar resolution on all connected X11 outputs and positions them
# side-by-side. Called at startup and after each Chromium exit (display-off/on
# resets xrandr to the monitor's native mode).
apply_display_mode() {
  if ! command -v xrandr >/dev/null 2>&1; then
    echo "apply_display_mode: xrandr not found"
    return
  fi

  local outputs=()
  mapfile -t outputs < <(xrandr | grep " connected" | awk '{print $1}')
  if [ "${#outputs[@]}" -eq 0 ]; then
    echo "apply_display_mode: no X11 outputs detected"
    return
  fi

  if [ "${SWAP_OUTPUTS:-false}" = "true" ] && [ "${#outputs[@]}" -ge 2 ]; then
    local tmp="${outputs[0]}"
    outputs[0]="${outputs[1]}"
    outputs[1]="$tmp"
  fi

  # Find or create the custom mode on all connected outputs.
  local modename
  modename=$(xrandr | grep -E "^\s+${WIDTH}x${HEIGHT}" | awk '{print $1}' | head -1)
  if [ -z "$modename" ]; then
    local modeline
    modeline=$(cvt "${WIDTH}" "${HEIGHT}" 60 2>/dev/null | grep Modeline | cut -d' ' -f2-)
    if [ -n "${modeline}" ]; then
      modename=$(echo "${modeline}" | awk '{print $1}' | tr -d '"')
      xrandr --newmode ${modeline} 2>/dev/null || true
      for out in "${outputs[@]}"; do
        xrandr --addmode "${out}" "${modename}" 2>/dev/null || true
      done
      echo "Registered X11 mode ${modename} on all outputs"
    else
      echo "cvt failed for ${WIDTH}x${HEIGHT}"
    fi
  fi

  if [ "$MONITOR_MODE" = "dual" ]; then
    local xpos=0
    for out in "${outputs[@]}"; do
      echo "Dual X11: setting ${out} to ${modename:-${WIDTH}x${HEIGHT}} at pos ${xpos},0"
      if [ -n "$modename" ]; then
        xrandr --output "${out}" --mode "${modename}" --pos "${xpos},0" 2>/dev/null || true
      else
        xrandr --output "${out}" --auto --pos "${xpos},0" 2>/dev/null || true
      fi
      xpos=$((xpos + WIDTH))
    done
    [ "${#outputs[@]}" -gt 0 ] && sleep 1
    # Merge both outputs into one logical monitor so Chromium sizes its window
    # to the full 3840x380 combined width rather than one monitor's 1920x380.
    # xrandr --setmonitor requires physical mm dimensions — read them from xrandr.
    local combined_width=$(( WIDTH * ${#outputs[@]} ))
    local per_mm_w per_mm_h
    per_mm_w=$(xrandr 2>/dev/null | grep "^${outputs[0]} connected" | sed -n 's/.* \([0-9]*\)mm x \([0-9]*\)mm.*/\1/p' | head -1)
    per_mm_h=$(xrandr 2>/dev/null | grep "^${outputs[0]} connected" | sed -n 's/.* \([0-9]*\)mm x \([0-9]*\)mm.*/\2/p' | head -1)
    per_mm_w=${per_mm_w:-160}
    per_mm_h=${per_mm_h:-90}
    local combined_mm_w=$(( per_mm_w * ${#outputs[@]} ))
    # --setmonitor resets primary, so set --primary AFTER creating the logical monitor.
    xrandr --setmonitor PiBarTicker "${combined_width}/${combined_mm_w}x${HEIGHT}/${per_mm_h}+0+0" "${outputs[0]}" 2>/dev/null || true
    xrandr --output "${outputs[0]}" --primary 2>/dev/null || true
    echo "Set logical monitor PiBarTicker ${combined_width}/${combined_mm_w}x${HEIGHT}/${per_mm_h}+0+0 (primary)"
    echo "xrandr --listmonitors after setmonitor+primary:"
    xrandr --listmonitors 2>&1 || true
  else
    local primary="${outputs[0]}"
    echo "Single X11: setting ${primary} to ${modename:-${WIDTH}x${HEIGHT}}"
    if [ -n "$modename" ]; then
      xrandr --output "${primary}" --mode "${modename}" --pos "0,0" 2>/dev/null || true
    else
      xrandr --output "${primary}" --auto 2>/dev/null || true
    fi
    for i in "${!outputs[@]}"; do
      [ "$i" -eq 0 ] && continue
      xrandr --output "${outputs[$i]}" --off 2>/dev/null || true
    done
    sleep 1
  fi
}

apply_display_mode

# Wait for backend before starting Chromium.
echo "Waiting for backend /health (up to 60s) before launching Chromium..."
for _ in $(seq 1 60); do
  if curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; then
    echo "Backend healthy, proceeding to Chromium launch."
    break
  fi
  sleep 1
done

echo "Backend healthy (or wait done); launching Chromium now..."

display_explicitly_off() {
  local body
  body=$(curl -fsS "${BACKEND_URL}/api/v1/display/power" 2>/dev/null) || return 1
  echo "$body" | grep -q '"on":false'
}

# Use --app so the window spans both monitors freely; openbox rc.xml removes decorations.
CHROMIUM_APP_ARG="--app=${URL}"

while true; do
  # Kill any desktop panel that could respawn and sit on top of the kiosk window.
  pkill -f lxpanel 2>/dev/null || true
  pkill -f tint2 2>/dev/null || true
  pkill -f pcmanfm 2>/dev/null || true
  sleep 0.5

  echo "=== Chromium launch $(date) | mode=${MONITOR_MODE} window=${CHROMIUM_WINDOW_WIDTH}x${HEIGHT} ==="
  echo "--- xrandr monitors ---"
  xrandr --listmonitors 2>&1 || true
  echo "--- end monitors ---"

  # Clear stale profile so --start-maximized is always honoured (saved geometry overrides flags).
  rm -rf /tmp/pibarticker-kiosk 2>/dev/null || true

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
    --password-store=basic \
    --start-maximized \
    --enable-features=OverlayScrollbar,VaapiVideoDecoder \
    --disable-webgpu \
    "${CHROMIUM_FLAGS[@]}" \
    "${CHROMIUM_APP_ARG}" || true

  while display_explicitly_off; do
    sleep 3
  done

  apply_display_mode

  sleep 5
done
