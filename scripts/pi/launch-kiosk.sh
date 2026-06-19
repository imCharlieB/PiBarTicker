#!/usr/bin/env bash
set -euo pipefail

# launch-kiosk.sh
# X11/openbox kiosk launcher for PiBarTicker on Raspberry Pi OS.
# - Started from ~/.config/openbox/autostart (see install_pi.sh)
# - Handles display mode via xrandr (X11); wlr-randr path retained but disabled
# - Launches Chromium with GPU + kiosk flags
# - Waits for backend health before first launch, then restarts on exit (crash recovery)

APP_DIR="/opt/pibarticker"
CONFIG_FILE="${APP_DIR}/config.json"
BACKEND_URL="http://127.0.0.1:8000"
URL="http://127.0.0.1:8000/?kiosk=1"

# Set default graphical session environment if not provided (helps when the
# installer starts us via nohup from ssh or non-graphical context).
# For typical Pi OS Labwc (Wayland) with user 'pi' (uid 1000).
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
  # Prefer Wayland defaults for current official Pi OS
  export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
  export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-wayland}"
  echo "Set default Wayland/Labwc env vars (WAYLAND_DISPLAY=$WAYLAND_DISPLAY, XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR, XDG_SESSION_TYPE=$XDG_SESSION_TYPE)"
fi
if [ -z "${DISPLAY:-}" ] && [ -S "/tmp/.X11-unix/X0" ]; then
  export DISPLAY=:0
fi

# Detect Wayland / Labwc (the current official Raspberry Pi OS desktop on Wayland).
# We prioritize Wayland paths (wlr-randr for resolution, dedicated Chromium flags)
# and only fall back to X11 logic if no Wayland compositor is detected.
# This script is intended to be started from ~/.config/labwc/autostart.
# We also auto-detect via wlr-randr succeeding (helps when launched via the
# install script over ssh where the env var may not be inherited initially).
# Force X11 mode — wlr-randr/Labwc cannot reliably re-enable HDMI-A-2 after --off.
IS_WAYLAND=0
echo "X11 mode (Wayland display control disabled)"

if [ "$IS_WAYLAND" = "0" ]; then
  if [[ -z "${DISPLAY:-}" && -S "/tmp/.X11-unix/X0" ]]; then
    export DISPLAY=:0
  fi

  # Wait for the X server to be fully ready before doing anything with display or launching Chromium.
  # This prevents "can't open display" and black screens if launched too early.
  # Skipped on Wayland (modern default).
  for _ in $(seq 1 30); do
    if [ -S "/tmp/.X11-unix/X0" ] && DISPLAY=${DISPLAY:-:0} xrandr >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! DISPLAY=${DISPLAY:-:0} xrandr >/dev/null 2>&1; then
    echo "Warning: X server not responding yet, proceeding anyway..."
  fi
fi

# Wait for Wayland compositor to be ready if applicable (modern Pi).
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
mode = str(monitor.get("mode", "single")).strip().lower()
swap_outputs = bool(monitor.get("swapOutputs", False))
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
    "--use-gl=egl",
    "--enable-features=OverlayScrollbar,VaapiVideoDecoder",
    "--disable-webgpu",
]
BAD_FLAGS += ["--ozone-platform=wayland", "--ozone-platform=x11"]
cleaned = [f for f in flags if f not in BAD_FLAGS]
existing = set(cleaned)
to_add = [f for f in RECOMMENDED if f not in existing]
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

# Parse width/height for explicit window sizing (helps Chromium match the xrandr mode exactly on bar displays)
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

# Kill power managers and desktop panels that would obscure the kiosk window or
# trigger DPMS-off and cut the HDMI signal.
pkill -f lxqt-powermanagement 2>/dev/null || true
pkill -f lxpanel 2>/dev/null || true
pkill -f tint2 2>/dev/null || true
pkill -f pcmanfm 2>/dev/null || true

# Re-enable compositor output in case lxqt had already fired DPMS-off before we
# killed it. Without this, the GPU stays in DRM DPMS-off and the monitor shows
# "No Signal" even after ddcutil D6=1 wakes the panel hardware.
if [ "$IS_WAYLAND" = "1" ] && command -v wlopm >/dev/null 2>&1; then
  wlr-randr 2>/dev/null | grep -E '^[A-Za-z]' | awk '{print $1}' | while read -r OUT; do
    wlopm --on "$OUT" 2>/dev/null || true
  done
fi

# Re-applies the custom bar resolution. Called at startup and after each display-on
# cycle so the output is always at the configured bar dimensions.
apply_display_mode() {
  if [ "$IS_WAYLAND" = "1" ] && command -v wlr-randr >/dev/null 2>&1; then
    if [ "$MONITOR_MODE" = "dual" ]; then
      local outputs=()
      mapfile -t outputs < <(wlr-randr 2>/dev/null | grep -E '^[A-Z][A-Za-z0-9_-]+' | awk '{print $1}')
      # Swap output order when cables are plugged in "backwards" relative to compositor default.
      if [ "${SWAP_OUTPUTS:-false}" = "true" ] && [ "${#outputs[@]}" -ge 2 ]; then
        local tmp="${outputs[0]}"
        outputs[0]="${outputs[1]}"
        outputs[1]="$tmp"
      fi
      local xpos=0
      for out in "${outputs[@]}"; do
        echo "Dual: setting ${out} to ${WIDTH}x${HEIGHT} at pos ${xpos},0"
        wlr-randr --output "$out" --mode "${WIDTH}x${HEIGHT}" --pos "${xpos},0" 2>/dev/null || \
          wlr-randr --output "$out" --custom-mode "${WIDTH}x${HEIGHT}" --pos "${xpos},0" 2>/dev/null || true
        xpos=$((xpos + WIDTH))
      done
      [ ${#outputs[@]} -gt 0 ] && sleep 1
    else
      local out
      out=$(wlr-randr 2>/dev/null | grep -E '^[A-Z]' | head -1 | awk '{print $1}' || echo "")
      if [ -n "$out" ]; then
        local cur
        cur=$(wlr-randr 2>/dev/null | grep -A1 "^${out}" | grep -o '[0-9]\+x[0-9]\+' | head -1 || echo "")
        if [ "$cur" != "${DISPLAY_MODE}" ]; then
          echo "Applying custom mode ${DISPLAY_MODE} on ${out}"
          wlr-randr --output "$out" --custom-mode "${WIDTH}x${HEIGHT}" || true
          sleep 1
        fi
      fi
    fi
  elif command -v xrandr >/dev/null 2>&1; then
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
    else
      local primary="${outputs[0]}"
      echo "Single X11: setting ${primary} to ${modename:-${WIDTH}x${HEIGHT}}"
      if [ -n "$modename" ]; then
        xrandr --output "${primary}" --mode "${modename}" --pos "0,0" 2>/dev/null || true
      else
        xrandr --output "${primary}" --auto 2>/dev/null || true
      fi
      # Turn off secondary outputs in single mode.
      for i in "${!outputs[@]}"; do
        [ "$i" -eq 0 ] && continue
        xrandr --output "${outputs[$i]}" --off 2>/dev/null || true
      done
      sleep 1
    fi
  fi
}

apply_display_mode

# Wait for backend before starting Chromium.
echo "Waiting for backend /health (up to 60s) before launching the ticker Chromium..."
for _ in $(seq 1 60); do
  if curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; then
    echo "Backend healthy, proceeding to Chromium launch."
    break
  fi
  sleep 1
done

echo "Backend healthy (or wait done); launching Chromium kiosk now..."

display_explicitly_off() {
  # Returns true ONLY when backend is up and explicitly says on:false.
  # If backend is unreachable, returns false (don't block Chromium restart).
  local body
  body=$(curl -fsS "${BACKEND_URL}/api/v1/display/power" 2>/dev/null) || return 1
  echo "$body" | grep -q '"on":false'
}

# In dual mode, --kiosk fullscreens per-output/per-monitor and only covers one screen.
# Strip it and use --app so the window spans both outputs as one canvas.
# Openbox rc.xml sets decor=no globally so the --app window has no title bar.
# Single mode keeps --kiosk via CHROMIUM_FLAGS (fullscreens to the one output correctly).
CHROMIUM_APP_ARG="${URL}"
if [ "$MONITOR_MODE" = "dual" ]; then
  FILTERED_FLAGS=()
  for f in "${CHROMIUM_FLAGS[@]}"; do
    [ "$f" != "--kiosk" ] && FILTERED_FLAGS+=("$f")
  done
  CHROMIUM_FLAGS=("${FILTERED_FLAGS[@]}")
  CHROMIUM_APP_ARG="--app=${URL}"
fi

while true; do
  # Kill any desktop panel that could respawn and sit on top of the kiosk window.
  pkill -f wf-panel-pi 2>/dev/null || true
  pkill -f sfwbar 2>/dev/null || true
  pkill -f waybar 2>/dev/null || true
  pkill -f lxpanel 2>/dev/null || true
  pkill -f tint2 2>/dev/null || true
  pkill -f pcmanfm 2>/dev/null || true
  sleep 0.5

  # Launch Chromium in kiosk mode.
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
    --window-size=${CHROMIUM_WINDOW_WIDTH},${HEIGHT} \
    --window-position=0,0 \
    --use-gl=egl \
    --enable-features=OverlayScrollbar,VaapiVideoDecoder \
    --disable-webgpu \
    "${CHROMIUM_FLAGS[@]}" \
    "${CHROMIUM_APP_ARG}" >> /tmp/pibarticker-kiosk.log 2>&1 || true

  # If display was explicitly turned off, hold until it's back on.
  # Only blocks when backend is up and says on:false — never blocks on unreachable.
  while display_explicitly_off; do
    sleep 3
  done

  # Re-apply the custom bar mode after Chromium exits — display-off/on resets
  # the output to native resolution, which leaves the ticker uncropped/off-center.
  apply_display_mode

  sleep 5
done
