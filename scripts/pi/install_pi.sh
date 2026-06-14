#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SOURCE_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

APP_DIR="/opt/pibarticker"
SOURCE_DIR="${DEFAULT_SOURCE_DIR}"
APP_USER="pi"
SERVICE_NAME="pibarticker-backend"
LAUNCH_NOW="1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --source-dir)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --user)
      APP_USER="$2"
      shift 2
      ;;
    --no-launch-now)
      LAUNCH_NOW="0"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: sudo bash scripts/pi/install_pi.sh [--app-dir /opt/pibarticker] [--source-dir /path/to/repo] [--user pi] [--no-launch-now]"
      exit 1
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/pi/install_pi.sh"
  exit 1
fi

if [[ ! -f "${SOURCE_DIR}/README.md" || ! -d "${SOURCE_DIR}/backend" || ! -d "${SOURCE_DIR}/frontend" ]]; then
  echo "Invalid source dir: ${SOURCE_DIR}"
  echo "Expected PiBarTicker files (README.md, backend/, frontend/)."
  exit 1
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  echo "User '${APP_USER}' does not exist."
  exit 1
fi

APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
if [[ -z "${APP_HOME}" || ! -d "${APP_HOME}" ]]; then
  echo "Could not determine home directory for user '${APP_USER}'."
  exit 1
fi

echo "Installing OS packages..."
apt-get update

has_install_candidate() {
  local package_name="$1"
  local candidate
  candidate="$(apt-cache policy "${package_name}" | awk '/Candidate:/ { print $2; exit }')"
  [[ -n "${candidate}" && "${candidate}" != "(none)" ]]
}

CHROMIUM_PACKAGE=""
if has_install_candidate chromium; then
  CHROMIUM_PACKAGE="chromium"
elif has_install_candidate chromium-browser; then
  CHROMIUM_PACKAGE="chromium-browser"
else
  echo "Unable to find Chromium package (expected 'chromium-browser' or 'chromium')."
  exit 1
fi

# Install Node.js via NodeSource to get a reliable LTS version with npm included.
# The default Raspberry Pi OS Bookworm repos sometimes lack the npm package or
# ship a version too old for the frontend build.
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -qE '^v(18|20|22|[2-9][0-9])'; then
  echo "Setting up NodeSource LTS repository for Node.js..."
  apt-get install -y --no-install-recommends curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
fi

apt-get install -y --no-install-recommends \
  python3 \
  python3-venv \
  python3-pip \
  nodejs \
  curl \
  rsync \
  "${CHROMIUM_PACKAGE}" \
  wlr-randr \
  wlopm
# X11-only packages (x11-xserver-utils, xdotool, unclutter) removed — not required
# for Labwc/Wayland on current Pi OS. wlr-randr/wlopm and chromium are kept.

# ddcutil: talks directly to monitor hardware over HDMI DDC/CI, bypassing the
# Wayland compositor idle daemon. Not in Pi OS default repos — fetch from Debian
# Bookworm main temporarily, then remove the source so it doesn't affect other packages.
echo "Installing ddcutil (DDC/CI direct monitor control)..."
if ! apt-get install -y --no-install-recommends ddcutil 2>/dev/null; then
  echo "ddcutil not in Pi OS repos — adding Debian Bookworm main temporarily..."
  echo "deb http://deb.debian.org/debian bookworm main" \
    > /etc/apt/sources.list.d/debian-bookworm-main-temp.list
  apt-get update -qq
  apt-get install -y --no-install-recommends ddcutil || \
    echo "WARNING: ddcutil install failed — display control will use wlopm fallback."
  rm -f /etc/apt/sources.list.d/debian-bookworm-main-temp.list
  apt-get update -qq
fi
if command -v ddcutil >/dev/null 2>&1; then
  echo "ddcutil installed — enabling i2c..."
  raspi-config nonint do_i2c 0 2>/dev/null || true
  modprobe i2c-dev 2>/dev/null || true
  usermod -a -G i2c "${APP_USER}" 2>/dev/null || true
else
  echo "ddcutil unavailable — display control will fall back to wlopm."
fi

# Stop any currently running services so we can safely update files.
# They will be restarted at the end of the install.
echo "Stopping running services for clean update..."
systemctl stop pibarticker-backend.service 2>/dev/null || true
# Selective and safe kill: only target this app's own launcher and its chromium instances
# (using full path and unique user-data-dir to avoid killing unrelated processes or user's other chromium).
pkill -f "${APP_DIR}/scripts/pi/launch-kiosk.sh" 2>/dev/null || true
pkill -f "pibarticker-kiosk" 2>/dev/null || true
sleep 1

echo "Preparing app directory at ${APP_DIR}..."
mkdir -p "${APP_DIR}"
SOURCE_REAL="$(realpath "${SOURCE_DIR}")"
APP_REAL="$(realpath "${APP_DIR}")"

if [[ "${SOURCE_REAL}" != "${APP_REAL}" ]]; then
  rsync -a --delete \
    --exclude ".git" \
    --exclude ".venv" \
    --exclude "frontend/node_modules" \
    --exclude "frontend/dist" \
    --exclude "config.json" \
    --exclude "runtime-cache" \
    --exclude "team-meta" \
    --exclude "/logos" \
    "${SOURCE_DIR}/" "${APP_DIR}/"
else
  echo "Source and app directory are the same; skipping sync."
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# Clean up chromiumFlags in config: remove known bad flags that cause "unrecognized flag" errors,
# and ensure recommended Pi flags are present. This fixes launch issues from old configs.
echo "Cleaning chromiumFlags in config to remove bad flags and ensure good Pi defaults..."
python3 - <<'PY' "${APP_DIR}/config.json" || true
import json, sys, pathlib
path = pathlib.Path(sys.argv[1])
if not path.exists():
    sys.exit(0)
cfg = json.loads(path.read_text())
kiosk = cfg.setdefault("kiosk", {})
flags = kiosk.get("chromiumFlags", [])
if not isinstance(flags, list):
    flags = []
BAD_FLAGS = ["--no-decommit-pooled-pages"]
RECOMMENDED = [
    "--kiosk",
    "--noerrdialogs",
    "--disable-infobars",
    "--force-device-scale-factor=1",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--disable-smooth-scrolling",
    "--overscroll-history-navigation=0",
    "--disable-translate",
    "--disable-features=TranslateUI",
    # Wayland/Labwc specific for current Pi OS (fixes Dawn/Vulkan init errors,
    # on_device_model backend, and improves compatibility)
    "--ozone-platform=wayland",
    "--use-gl=egl",
    "--enable-features=OverlayScrollbar,VaapiVideoDecoder,WaylandWindowDecorations",
    "--disable-webgpu",
]
cleaned = [f for f in flags if f not in BAD_FLAGS]
existing = set(cleaned)
to_add = [f for f in RECOMMENDED if f not in existing]
if to_add:
    cleaned.extend(to_add)
kiosk["chromiumFlags"] = cleaned
path.write_text(json.dumps(cfg, indent=2))
print("Cleaned chromiumFlags")
PY

echo "Setting up Python virtual environment..."
sudo -u "${APP_USER}" python3 -m venv "${APP_DIR}/.venv"
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install --upgrade pip
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/backend/requirements.txt"

echo "Installing frontend dependencies and building static assets..."
sudo -u "${APP_USER}" npm --prefix "${APP_DIR}/frontend" ci
sudo -u "${APP_USER}" npm --prefix "${APP_DIR}/frontend" run build

echo "Installing backend service..."
sed \
  -e "s/^User=.*/User=${APP_USER}/" \
  -e "s/^Group=.*/Group=${APP_USER}/" \
  "${APP_DIR}/scripts/pi/pibarticker-backend.service" \
  > "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

echo "Configuring kiosk autostart for user ${APP_USER} (Labwc/Wayland)..."
# For current official Raspberry Pi OS (Labwc on Wayland), the proper place for
# session autostart is ~/.config/labwc/autostart — this is a plain executable
# shell script that labwc sources/executes when the compositor starts the desktop
# session after autologin.
# We deliberately do NOT use ~/.config/autostart/*.desktop (XDG autostart) as it
# is not reliably honored under bare labwc.
#
# We also remove any stale .desktop from previous installs to prevent double-launch
# (which was observed to cause the launcher to be killed/restarted rapidly,
# resulting in the "Loading setup configuration..." UI flashing repeatedly
# as new Chromium instances start and load the frontend).
rm -f "${APP_HOME}/.config/autostart/pibarticker-kiosk.desktop" 2>/dev/null || true

mkdir -p "${APP_HOME}/.config/labwc"
LABWC_AUTOSTART="${APP_HOME}/.config/labwc/autostart"
cat > "${LABWC_AUTOSTART}" <<LABWC_EOF
#!/bin/sh
# PiBarTicker kiosk autostart for labwc (Wayland).
# This script is executed by labwc on desktop session start.
# We exec the launcher in background so the compositor can finish initializing.
${APP_DIR}/scripts/pi/launch-kiosk.sh &
LABWC_EOF
chmod +x "${LABWC_AUTOSTART}"

# Hide the cursor for kiosk mode.
# XCURSOR_SIZE=0 is not reliable — wlroots treats 0 as "use default size."
# The correct approach is a blank cursor theme: all cursor files are valid Xcursor
# binaries but contain a single 1x1 fully-transparent pixel. When wlroots renders
# any cursor from this theme it displays nothing. We generate the theme with Python
# (no extra packages) and point labwc at it via the environment file and rc.xml.
echo "Creating blank cursor theme for kiosk (hides cursor on Wayland)..."
BLANK_THEME_DIR="/usr/share/icons/kiosk-no-cursor"
BLANK_CURSOR_DIR="${BLANK_THEME_DIR}/cursors"
mkdir -p "${BLANK_CURSOR_DIR}"
python3 - "${BLANK_CURSOR_DIR}" <<'PY'
import struct, sys, os

cursor_dir = sys.argv[1]

def make_xcursor():
    """Minimal Xcursor file: one 1x1 fully-transparent image frame."""
    IMAGE_TYPE = 0xfffd0002
    nominal = 1
    # Image chunk: header (36 bytes) + 1 ARGB pixel (4 bytes)
    chunk = struct.pack('<IIIIIIIII', 36, IMAGE_TYPE, nominal, 1, 1, 1, 0, 0, 50)
    chunk += struct.pack('<I', 0x00000000)          # transparent pixel
    file_header = b'Xcur' + struct.pack('<III', 16, 1, 1)
    toc = struct.pack('<III', IMAGE_TYPE, nominal, 28)  # image starts at byte 28
    return file_header + toc + chunk

data = make_xcursor()
names = [
    'default', 'left_ptr', 'text', 'xterm', 'ibeam',
    'hand1', 'hand2', 'pointing_hand', 'pointer',
    'move', 'fleur', 'crosshair', 'cross',
    'wait', 'watch', 'progress', 'half-busy',
    'n-resize', 's-resize', 'e-resize', 'w-resize',
    'nw-resize', 'ne-resize', 'sw-resize', 'se-resize',
    'ns-resize', 'ew-resize', 'nwse-resize', 'nesw-resize',
    'col-resize', 'row-resize', 'all-scroll',
    'not-allowed', 'no-drop', 'grabbing', 'grab',
    'zoom-in', 'zoom-out',
]
for name in names:
    with open(os.path.join(cursor_dir, name), 'wb') as f:
        f.write(data)
print(f"Created {len(names)} blank cursor files in {cursor_dir}")
PY
printf '[Icon Theme]\nName=kiosk-no-cursor\nComment=Blank cursor theme for kiosk\n' \
  > "${BLANK_THEME_DIR}/index.theme"
echo "Blank cursor theme ready at ${BLANK_THEME_DIR}."

# rc.xml: tell labwc to use the blank cursor theme (only create if not already present)
LABWC_RC="${APP_HOME}/.config/labwc/rc.xml"
if [[ ! -f "${LABWC_RC}" ]]; then
  cat > "${LABWC_RC}" <<'LABWC_RC_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme>
    <cursor>
      <theme>kiosk-no-cursor</theme>
      <size>24</size>
    </cursor>
  </theme>
</openbox_config>
LABWC_RC_EOF
  echo "Created labwc rc.xml pointing to blank cursor theme."
else
  echo "labwc rc.xml already exists; skipping rc.xml cursor config."
fi

# environment file: set XCURSOR_THEME so every Wayland client also picks up the blank theme
LABWC_ENV="${APP_HOME}/.config/labwc/environment"
touch "${LABWC_ENV}"
sed -i '/^XCURSOR_SIZE=/d; /^XCURSOR_THEME=/d' "${LABWC_ENV}" 2>/dev/null || true
printf 'XCURSOR_THEME=kiosk-no-cursor\nXCURSOR_SIZE=24\n' >> "${LABWC_ENV}"
echo "Set XCURSOR_THEME=kiosk-no-cursor in labwc environment."

chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}/.config"
chmod +x "${APP_DIR}/scripts/pi/launch-kiosk.sh"

# If labwc is the active compositor for the user, try a reconfigure. This can help pick up
# the new autostart in some cases (though full session restart is still best for first-time
# autostart scripts). Harmless if not running.
sudo -u "${APP_USER}" labwc --reconfigure 2>/dev/null || true

# Configure autologin using the official raspi-config tool.
# B4 = Desktop Autologin (the modern equivalent that works with the current
# Labwc/Wayland "Desktop" session). B2 was the old one.
# We never touch /etc/lightdm/lightdm.conf.d/ or force any session name here
# (that was the source of previous breakage with rpd-labwc).
echo "Configuring desktop autologin (B4 for Labwc/Wayland)..."
sudo raspi-config nonint do_boot_behaviour B4 || true

# We rely only on raspi-config B4 + the labwc/autostart script above.
# No 50-pibarticker-autologin.conf is created, no edits to lightdm.conf.d/.
# We do perform one targeted edit to the *main* /etc/lightdm/lightdm.conf below
# (to disable display-setup-script, which was causing repeated "Loading setup
# configuration" flashes under Labwc on some setups). This is the only direct
# lightdm.conf edit.

# === Fix for "Loading setup configuration" flashing on Labwc ===
# Some LightDM/Labwc setups run a display-setup-script (often dispsetup.sh)
# on session start. This can cause the desktop to briefly show a "Loading
# setup configuration" screen (or trigger re-renders) before the kiosk
# Chromium takes over, leading to flashing. We comment it out here.
# This edit is to the main lightdm.conf only (never lightdm.conf.d/).
echo "Disabling display-setup-script to stop LightDM/Labwc flashing..."
sudo sed -i 's|^display-setup-script=.*|#display-setup-script=/usr/share/dispsetup.sh|' /etc/lightdm/lightdm.conf || true

# --- Suppress gnome-keyring prompts for kiosk autologin ---
# On Pi OS Desktop, gnome-keyring-daemon is started by pam_gnome_keyring.so in
# /etc/pam.d/lightdm-autologin before the desktop session even starts — that is the
# primary trigger, not XDG autostart. lxsession does not run under bare labwc so the
# ~/.config/autostart Hidden=true overrides we write below are never read.
# Removing pam_gnome_keyring from the autologin PAM config is the only reliable fix.
echo "Suppressing gnome-keyring keyring prompts on autologin..."

# (a) PAM — primary trigger on Pi OS Desktop with autologin
PAM_AUTOLOGIN="/etc/pam.d/lightdm-autologin"
if [[ -f "${PAM_AUTOLOGIN}" ]] && grep -q pam_gnome_keyring "${PAM_AUTOLOGIN}"; then
  cp "${PAM_AUTOLOGIN}" "${PAM_AUTOLOGIN}.pibarticker-backup" 2>/dev/null || true
  sed -i '/pam_gnome_keyring/d' "${PAM_AUTOLOGIN}"
  echo "  Removed pam_gnome_keyring from ${PAM_AUTOLOGIN}."
else
  echo "  pam_gnome_keyring not present in ${PAM_AUTOLOGIN:-/etc/pam.d/lightdm-autologin (not found)} — skipping."
fi

# (b) XDG autostart overrides — belt-and-suspenders if a session manager ever runs
AUTOSTART_DIR="${APP_HOME}/.config/autostart"
mkdir -p "${AUTOSTART_DIR}"
for _gk_desktop in /etc/xdg/autostart/gnome-keyring-*.desktop; do
  [[ -f "${_gk_desktop}" ]] || continue
  _gk_fname="$(basename "${_gk_desktop}")"
  printf '[Desktop Entry]\nType=Application\nHidden=true\n' > "${AUTOSTART_DIR}/${_gk_fname}"
done
chown -R "${APP_USER}:${APP_USER}" "${AUTOSTART_DIR}"
echo "gnome-keyring suppression complete."

if [[ "${LAUNCH_NOW}" == "1" ]]; then
  echo "Attempting immediate kiosk launch (no reboot needed for first run)..."
  LOG_FILE="${APP_HOME}/pibarticker-kiosk.log"
  USER_UID=$(id -u "${APP_USER}" 2>/dev/null || echo 1000)
  # Ensure the log is owned by the target user and writable by them.
  # This prevents "Permission denied" when the redirection happens (whether
  # by root or inside user context) if a previous run left restrictive perms.
  # Clean stale /tmp log from old runs.
  rm -f /tmp/pibarticker-kiosk.log || true
  sudo -u "${APP_USER}" touch "${LOG_FILE}" || true
  sudo -u "${APP_USER}" chmod 666 "${LOG_FILE}" || true

  # Give the just-restarted backend a moment to be healthy before the launcher starts its own wait.
  sleep 2

  # Always do a clean (re)launch of our own launcher at the very end. This is the key to seeing the
  # ticker right after `curl ... | sudo bash` without a reboot. The autostart is for subsequent boots.
  pkill -f "${APP_DIR}/scripts/pi/launch-kiosk.sh" 2>/dev/null || true
  pkill -f "pibarticker-kiosk" 2>/dev/null || true
  sleep 1

  # Detect the active Wayland socket for this user (wayland-0 or wayland-1 — varies by Pi OS).
  # sudo strips the environment so we probe the real socket path rather than assuming wayland-1.
  RESOLVED_XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${USER_UID}}"
  RESOLVED_WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-}"
  if [[ -z "${RESOLVED_WAYLAND_DISPLAY}" ]]; then
    for _sock in "${RESOLVED_XDG_RUNTIME_DIR}/wayland-1" "${RESOLVED_XDG_RUNTIME_DIR}/wayland-0"; do
      if [[ -S "${_sock}" ]]; then
        RESOLVED_WAYLAND_DISPLAY="$(basename "${_sock}")"
        echo "Detected active Wayland socket: ${_sock} (WAYLAND_DISPLAY=${RESOLVED_WAYLAND_DISPLAY})"
        break
      fi
    done
    if [[ -z "${RESOLVED_WAYLAND_DISPLAY}" ]]; then
      echo "No active Wayland socket found in ${RESOLVED_XDG_RUNTIME_DIR}/. Using wayland-1 default (kiosk will wait for compositor)."
      RESOLVED_WAYLAND_DISPLAY="wayland-1"
    fi
  fi

  # Launch the ticker now at the end of install (no reboot needed).
  sudo -u "${APP_USER}" \
    env DISPLAY="${DISPLAY:-:0}" \
        XAUTHORITY="${XAUTHORITY:-${APP_HOME}/.Xauthority}" \
        WAYLAND_DISPLAY="${RESOLVED_WAYLAND_DISPLAY}" \
        XDG_RUNTIME_DIR="${RESOLVED_XDG_RUNTIME_DIR}" \
    sh -c 'nohup "'"${APP_DIR}/scripts/pi/launch-kiosk.sh"'" >> "'"${LOG_FILE}"'" 2>&1 &'
  echo "Kiosk launcher (re)started. The ticker should appear on the Pi screen shortly."

  # Give the launcher time to start (backend health wait up to 60s + compositor + chromium init).
  # Longer/more patient check than before so the install output is useful even on slower first boots.
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    if pgrep -f "chromium" >/dev/null 2>&1 || pgrep -f "chromium-browser" >/dev/null 2>&1; then
      echo "Chromium kiosk process detected - the ticker should now be visible on the Pi desktop screen."
      break
    fi
    if [ $i -eq 10 ]; then
      echo "Chromium not detected after ~30s (may still be waiting for backend health or compositor in the launcher)."
      echo "Check the kiosk log for details: tail -f ${LOG_FILE}"
      echo "You can also manually force it: sudo -u ${APP_USER} ${APP_DIR}/scripts/pi/launch-kiosk.sh >> ${LOG_FILE} 2>&1 &"
    fi
  done
fi

echo

# =============================================================================
# Raspberry Pi boot splash customization (Pi 4 / Pi 5 support)
# - Auto-detects model via /proc/device-tree/model (Raspberry Pi 4 vs 5)
# - On-demand installs rsvg-convert (librsvg2-bin) + ImageMagick for SVG->PNG
# - Uses frontend/public/pibarticker-logo.svg (and its referenced PNG) as source
# - Creates 1920x1080 black canvas with centered logo (safe for Pi HDMI + bar displays)
# - Backs up original /usr/share/plymouth/themes/pix/splash.png (idempotent)
# - Replaces the default Plymouth pix splash
# - Runs plymouth-set-default-theme -R + update-initramfs so it takes effect on boot
# This is completely non-fatal; install continues even if splash setup has issues.
# =============================================================================
setup_custom_splash() {
  local pi_model=""
  if [[ -r /proc/device-tree/model ]]; then
    # tr -d '\0' is the most reliable way to strip NUL terminators from device-tree strings.
    # The sed \x00 approach is GNU-only and can silently produce an empty string on some Pi OS images.
    pi_model="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
  fi

  echo "Detected hardware model: ${pi_model:-unknown (device-tree unreadable)}"

  local is_pi4=0
  local is_pi5=0
  local splash_w=1920
  local splash_h=1080

  if [[ "${pi_model}" == *"Raspberry Pi 5"* ]]; then
    is_pi5=1
    echo "Raspberry Pi 5 detected. Targeting 1920x1080 splash (compatible default)."
  elif [[ "${pi_model}" == *"Raspberry Pi 4"* ]]; then
    is_pi4=1
    echo "Raspberry Pi 4 detected. Targeting 1920x1080 splash."
  else
    echo "Not recognized as Raspberry Pi 4 or 5 (or /proc/device-tree/model unreadable). Skipping custom splash."
    return 0
  fi

  # Use Python Pillow for image generation — python3-pil is available on all Pi OS Bookworm
  # variants including arm64 (Pi 5), unlike imagemagick/librsvg2-bin which are absent there.
  echo "Installing python3-pil for splash image generation..."
  if ! apt-get install -y --no-install-recommends python3-pil; then
    echo "WARNING: Could not install python3-pil. Skipping custom boot splash."
    return 0
  fi

  local logo_png="${APP_DIR}/frontend/public/pibarticker-logo-transparent.png"
  if [[ ! -f "${logo_png}" ]]; then
    echo "WARNING: ${logo_png} not present after file sync. Skipping splash."
    return 0
  fi

  local logo_w=880
  if [[ ${is_pi5} -eq 1 ]]; then
    logo_w=960
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local splash_png="${tmp_dir}/pibarticker-splash.png"

  echo "Generating boot splash with Python Pillow (${splash_w}x${splash_h}, logo max-width ${logo_w}px)..."
  if ! python3 - "${logo_png}" "${splash_png}" "${logo_w}" "${splash_w}" "${splash_h}" <<'PY'; then
import sys
from PIL import Image

logo_path, out_path = sys.argv[1], sys.argv[2]
logo_max_w, canvas_w, canvas_h = int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])

logo = Image.open(logo_path).convert("RGBA")
logo.thumbnail((logo_max_w, logo_max_w * 4), Image.LANCZOS)
canvas = Image.new("RGB", (canvas_w, canvas_h), (0, 0, 0))
x = (canvas_w - logo.width) // 2
y = (canvas_h - logo.height) // 2
canvas.paste(logo, (x, y), logo)
canvas.save(out_path, "PNG")
print(f"Splash created: {canvas_w}x{canvas_h}, logo at ({x},{y}) size {logo.width}x{logo.height}")
PY
    echo "WARNING: Pillow splash generation failed. Skipping."
    rm -rf "${tmp_dir}" 2>/dev/null || true
    return 0
  fi

  if [[ ! -f "${splash_png}" ]]; then
    echo "WARNING: Splash PNG not produced. Skipping."
    rm -rf "${tmp_dir}" 2>/dev/null || true
    return 0
  fi

  # Apply to the active Plymouth theme used by Raspberry Pi OS Desktop
  local ply_dir="/usr/share/plymouth/themes/pix"
  if [[ ! -d "${ply_dir}" ]]; then
    echo "WARNING: Plymouth pix theme dir not found at ${ply_dir}. Skipping splash (non-standard OS?)."
    rm -rf "${tmp_dir}" 2>/dev/null || true
    return 0
  fi

  local orig="${ply_dir}/splash.png"
  local bak="${ply_dir}/splash.png.pibarticker-backup"
  if [[ -f "${orig}" && ! -f "${bak}" ]]; then
    cp "${orig}" "${bak}" 2>/dev/null && echo "Original splash backed up to ${bak}"
  fi

  cp "${splash_png}" "${orig}"
  echo "Replaced Plymouth splash with PiBarTicker logo."

  # Rebuild required for the splash to be embedded in initramfs and shown at boot
  echo "Rebuilding Plymouth theme cache and initramfs (this step can take 30-120 seconds)..."
  if command -v plymouth-set-default-theme >/dev/null 2>&1; then
    plymouth-set-default-theme -R pix 2>/dev/null || echo "Note: plymouth-set-default-theme -R pix returned non-zero (continuing)."
  fi

  # Explicit update-initramfs as specified in requirements (the -R above usually does this, but we ensure)
  if command -v update-initramfs >/dev/null 2>&1; then
    if ! update-initramfs -u -k "$(uname -r)" 2>/dev/null; then
      if ! update-initramfs -u -k all 2>/dev/null; then
        echo "WARNING: update-initramfs did not run cleanly. Splash will still apply after a reboot in most cases."
      fi
    fi
  fi

  rm -rf "${tmp_dir}" 2>/dev/null || true
  echo "Custom boot splash setup finished. You will see the PiBarTicker logo on next boot."
}

# Invoke splash setup in a way that cannot abort the rest of the install
setup_custom_splash || echo "Splash setup encountered non-fatal issues (installation continues normally)."

echo
echo "Install complete."
echo "Backend status: systemctl status ${SERVICE_NAME}.service"
echo "Logs: journalctl -u ${SERVICE_NAME}.service -f"
echo "Kiosk launcher log: tail -f ${APP_HOME}/pibarticker-kiosk.log  (default location; may be /tmp in some older runs)"
