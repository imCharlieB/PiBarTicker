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
    "--start-maximized",
]
RECOMMENDED = [
    "--noerrdialogs", "--disable-infobars",
    "--force-device-scale-factor=1", "--enable-gpu-rasterization",
    "--enable-zero-copy", "--ignore-gpu-blocklist",
    "--disable-smooth-scrolling", "--overscroll-history-navigation=0",
    "--disable-translate", "--disable-features=TranslateUI",
    "--enable-features=OverlayScrollbar,VaapiVideoDecoder",
    "--disable-webgpu", "--disable-session-crashed-bubble",
    "--check-for-update-interval=31536000",
]
WAYLAND_FEATURES = {"WaylandWindowDecorations"}
BAD_SET = {b.strip() for b in BAD_FLAGS}
cleaned = []
for f in flags:
    s = str(f).strip()
    if s in BAD_SET:
        continue
    if s.startswith("--enable-features="):
        parts = [p for p in s[len("--enable-features="):].split(",") if p not in WAYLAND_FEATURES]
        s = f"--enable-features={','.join(parts)}" if parts else None
        if not s:
            continue
    cleaned.append(s)
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

# Redundant bash-level strip for flags that must never reach Chromium.
# Belt-and-suspenders in case the Python filter above misses them (e.g. encoding
# differences in config.json leave the string comparison failing silently).
_safe_flags=()
for _f in "${CHROMIUM_FLAGS[@]}"; do
  case "${_f}" in
    --no-decommit-pooled-pages|--kiosk|--ozone-platform=wayland|--ozone-platform=x11|--use-gl=egl)
      echo "Stripped bad Chromium flag: ${_f}" ;;
    *)
      _safe_flags+=("${_f}") ;;
  esac
done
CHROMIUM_FLAGS=("${_safe_flags[@]+"${_safe_flags[@]}"}")

WIDTH=$(echo "$DISPLAY_MODE" | cut -d'x' -f1)
HEIGHT=$(echo "$DISPLAY_MODE" | cut -d'x' -f2)

# Write openbox application rules with the exact pixel dimensions for this monitor
# mode. This is more reliable than --start-maximized because it does not depend on
# which xrandr logical monitor happens to be flagged as primary. OpenBox applies
# <size> and <position> when the window is first mapped, forcing the window to
# cover the full X screen width (3840px in dual mode) at position 0,0.
write_openbox_config() {
  local rc="${HOME}/.config/openbox/rc.xml"
  mkdir -p "${HOME}/.config/openbox"
  # Only remove decorations — do NOT add position/size rules.
  # openbox interprets <position> relative to the primary monitor, not the X screen
  # origin, which misplaces the window when the primary is HDMI-2 (at x=1920).
  # Chromium's --window-position and --window-size flags use absolute X screen
  # coordinates and are set in the launch command; the WM must honour them.
  cat > "${rc}" <<'RCEOF'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <application class="*">
      <decor>no</decor>
    </application>
  </applications>
</openbox_config>
RCEOF
  openbox --reconfigure 2>/dev/null || true
  # openbox --reconfigure is async; give it a moment to finish before we set
  # the root cursor, otherwise openbox restores the theme cursor and wins.
  sleep 1
  echo "openbox rc.xml written: decor=no for all windows"
}
write_openbox_config

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
  unclutter -idle 0.01 -root >/dev/null 2>&1 &
fi

# Disable DPMS and screen blanking for always-on signage.
if command -v xset >/dev/null 2>&1; then
  xset s off >/dev/null 2>&1 || true
  xset -dpms >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
fi

# Hide the X11 root-window cursor using a blank 1x1 XBM bitmap.
# xsetroot -cursor_name none is not a valid cursor name and fails silently;
# passing identical zero-pixel bitmaps for cursor+mask makes it invisible.
# Called once here and again in the Chromium restart loop because openbox
# or xrandr resets the root cursor to the theme default on mode changes.
hide_root_cursor() {
  if command -v xsetroot >/dev/null 2>&1; then
    printf '#define c_width 1\n#define c_height 1\nstatic unsigned char c_bits[] = {0x00};' \
      > /tmp/_blank_cursor.xbm
    xsetroot -cursor /tmp/_blank_cursor.xbm /tmp/_blank_cursor.xbm 2>/dev/null || true
  fi
}
hide_root_cursor

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

  # Remove any stale PiBarTicker logical monitor from a previous run so it
  # does not conflict when we rebuild the combined virtual screen below.
  xrandr --delmonitor PiBarTicker 2>/dev/null || true

  if [ "${SWAP_OUTPUTS:-false}" = "true" ] && [ "${#outputs[@]}" -ge 2 ]; then
    local tmp="${outputs[0]}"
    outputs[0]="${outputs[1]}"
    outputs[1]="$tmp"
  fi

  # Find or create the custom mode on all connected outputs.
  local modename
  modename=$(xrandr | grep -E "^\s+${WIDTH}x${HEIGHT}" | awk '{print $1}' | head -1) || true
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
    # xrandr always marks the LAST connected output (HDMI-2 on Pi) as primary and
    # this cannot be overridden via --output --primary.  Place HDMI-2 at x=0 so
    # the primary is on the left.  PiBarTicker is then anchored on HDMI-2 and
    # becomes the primary logical monitor at 3840x380 — which means the window
    # manager and Chromium both see a 3840-wide primary and honour our window size.
    # With swapOutputs the user explicitly reverses the physical order; honour it.
    local anchor other
    if [ "${SWAP_OUTPUTS:-false}" = "true" ]; then
      anchor="${outputs[0]}"   # user-swapped: put HDMI-1 first
      other="${outputs[1]}"
    else
      anchor="${outputs[1]}"   # default: put HDMI-2 (always primary) at x=0
      other="${outputs[0]}"
    fi

    echo "Dual X11: setting ${anchor} to ${modename:-${WIDTH}x${HEIGHT}} at pos 0,0 (primary anchor)"
    if [ -n "$modename" ]; then
      xrandr --output "${anchor}" --mode "${modename}" --pos "0,0" 2>/dev/null || true
    else
      xrandr --output "${anchor}" --auto --pos "0,0" 2>/dev/null || true
    fi
    echo "Dual X11: setting ${other} to ${modename:-${WIDTH}x${HEIGHT}} at pos ${WIDTH},0"
    if [ -n "$modename" ]; then
      xrandr --output "${other}" --mode "${modename}" --pos "${WIDTH},0" 2>/dev/null || true
    else
      xrandr --output "${other}" --auto --pos "${WIDTH},0" 2>/dev/null || true
    fi

    sleep 1
    local combined_width=$(( WIDTH * ${#outputs[@]} ))
    local per_mm_w per_mm_h
    per_mm_w=$(xrandr 2>/dev/null | grep "^${anchor} connected" | sed -n 's/.* \([0-9]*\)mm x \([0-9]*\)mm.*/\1/p' | head -1) || true
    per_mm_h=$(xrandr 2>/dev/null | grep "^${anchor} connected" | sed -n 's/.* \([0-9]*\)mm x \([0-9]*\)mm.*/\2/p' | head -1) || true
    per_mm_w=${per_mm_w:-160}
    per_mm_h=${per_mm_h:-90}
    local combined_mm_w=$(( per_mm_w * ${#outputs[@]} ))
    xrandr --setmonitor PiBarTicker "${combined_width}/${combined_mm_w}x${HEIGHT}/${per_mm_h}+0+0" "${anchor}" 2>/dev/null || true
    echo "Set logical monitor PiBarTicker ${combined_width}/${combined_mm_w}x${HEIGHT}/${per_mm_h}+0+0 (anchor: ${anchor})"
    echo "xrandr --listmonitors after setmonitor:"
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
# Re-apply blank cursor after xrandr mode changes, which can cause openbox
# to restore the default theme cursor on the root window.
hide_root_cursor

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

# Explicit window size so Chromium fills the full X screen regardless of xrandr state.
if [ "${MONITOR_MODE}" = "dual" ]; then
  WINDOW_WIDTH=$(( WIDTH * 2 ))
else
  WINDOW_WIDTH=${WIDTH}
fi

while true; do
  # Kill any desktop panel that could respawn and sit on top of the kiosk window.
  pkill -f lxpanel 2>/dev/null || true
  pkill -f tint2 2>/dev/null || true
  pkill -f pcmanfm 2>/dev/null || true
  sleep 0.5

  echo "=== Chromium launch $(date) | mode=${MONITOR_MODE} window=${WINDOW_WIDTH}x${HEIGHT} ==="
  echo "--- xrandr monitors ---"
  xrandr --listmonitors 2>&1 || true
  echo "--- end monitors ---"

  # Clear stale profile so saved window geometry does not override openbox rules.
  rm -rf /tmp/pibarticker-kiosk 2>/dev/null || true

  "${CHROMIUM_BIN}" \
    --window-position=0,0 \
    --window-size=${WINDOW_WIDTH},${HEIGHT} \
    --user-data-dir=/tmp/pibarticker-kiosk \
    --incognito \
    --no-first-run \
    --no-default-browser-check \
    --password-store=basic \
    "${CHROMIUM_FLAGS[@]}" \
    "${CHROMIUM_APP_ARG}" || true

  while display_explicitly_off; do
    sleep 3
  done

  apply_display_mode
  hide_root_cursor

  sleep 5
done
