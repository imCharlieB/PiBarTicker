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
  openbox \
  x11-xserver-utils
apt-get install -y --no-install-recommends unclutter 2>/dev/null || \
  apt-get install -y --no-install-recommends unclutter-xfixes 2>/dev/null || \
  echo "unclutter not available — cursor will remain visible"

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
BAD_FLAGS = [
    "--no-decommit-pooled-pages",
    "--ozone-platform=wayland",
    "--ozone-platform=x11",
]
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
    "--use-gl=egl",
    "--enable-features=OverlayScrollbar,VaapiVideoDecoder",
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

echo "Configuring kiosk autostart for user ${APP_USER} (X11/openbox)..."
rm -f "${APP_HOME}/.config/autostart/pibarticker-kiosk.desktop" 2>/dev/null || true

mkdir -p "${APP_HOME}/.config/openbox"
OPENBOX_AUTOSTART="${APP_HOME}/.config/openbox/autostart"
cat > "${OPENBOX_AUTOSTART}" <<OPENBOX_EOF
#!/bin/sh
${APP_DIR}/scripts/pi/launch-kiosk.sh &
OPENBOX_EOF
chmod +x "${OPENBOX_AUTOSTART}"

# Disable lxqt-powermanagement DPMS via its config file. Even though we kill it at
# kiosk start, the Pi OS system autostart may relaunch it. Setting EnableDPMS=false
# means it can run but will never fire DPMS-off or drop the HDMI signal.
echo "Disabling lxqt-powermanagement DPMS via config..."
mkdir -p "${APP_HOME}/.config/lxqt"
python3 - "${APP_HOME}/.config/lxqt/lxqt-powermanagement.conf" <<'PY'
import sys, os, re
path = sys.argv[1]
content = open(path).read() if os.path.exists(path) else ''
if '[Monitor]' in content:
    if 'EnableDPMS' in content:
        content = re.sub(r'(EnableDPMS\s*=\s*).*', r'\1false', content)
    else:
        content = content.replace('[Monitor]', '[Monitor]\nEnableDPMS=false')
else:
    content = content.rstrip('\n') + '\n\n[Monitor]\nEnableDPMS=false\n'
open(path, 'w').write(content)
print("lxqt-powermanagement: EnableDPMS=false")
PY
chown "${APP_USER}:${APP_USER}" "${APP_HOME}/.config/lxqt/lxqt-powermanagement.conf"

# Save monitor EDID files to kernel firmware and register them via cmdline.txt.
# When a display is powered off it stops responding to EDID queries; without a
# cached EDID the DRM driver may drop the output entirely. With the firmware EDID
# the kernel always has the monitor's identity and keeps the output available.
# Skips silently if monitors are off at install time (EDID file is empty/missing).
echo "Capturing EDID firmware for connected displays..."
EDID_HINTS=""
for _conn_dir in /sys/class/drm/card*-HDMI-A-*; do
  [[ -d "${_conn_dir}" ]] || continue
  _edid_src="${_conn_dir}/edid"
  [[ -s "${_edid_src}" ]] || continue          # skip if monitor is off/absent
  _conn_name="$(basename "${_conn_dir}" | sed 's/card[0-9]*-//')"  # e.g. HDMI-A-1
  _edid_dest="/lib/firmware/${_conn_name}.edid"
  cp "${_edid_src}" "${_edid_dest}"
  chmod 644 "${_edid_dest}"
  echo "  Saved EDID for ${_conn_name} → ${_edid_dest}"
  if [[ -n "${EDID_HINTS}" ]]; then
    EDID_HINTS="${EDID_HINTS},${_conn_name}:${_conn_name}.edid"
  else
    EDID_HINTS="${_conn_name}:${_conn_name}.edid"
  fi
done

if [[ -n "${EDID_HINTS}" ]]; then
  CMDLINE_FILE=""
  for _c in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    if [[ -f "${_c}" ]]; then CMDLINE_FILE="${_c}"; break; fi
  done
  if [[ -n "${CMDLINE_FILE}" ]]; then
    # Remove any stale drm.edid_firmware entry then append the fresh one.
    # cmdline.txt must remain a single line — sed operates in-place.
    sed -i 's/ drm\.edid_firmware=[^ ]*//g' "${CMDLINE_FILE}"
    sed -i "s|$| drm.edid_firmware=${EDID_HINTS}|" "${CMDLINE_FILE}"
    echo "  Added drm.edid_firmware=${EDID_HINTS} to ${CMDLINE_FILE}"
  else
    echo "  WARNING: cmdline.txt not found — skipping drm.edid_firmware."
  fi
else
  echo "  No EDID data found — monitors may be off. Run the installer again with displays on to enable EDID firmware."
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}/.config"
chmod +x "${APP_DIR}/scripts/pi/launch-kiosk.sh"

# Configure autologin to X11 openbox session.
echo "Configuring X11/openbox desktop autologin..."
raspi-config nonint do_boot_behaviour B4 || true

# Override the session to openbox (X11) — raspi-config B4 defaults to Labwc/Wayland.
for _conf in /etc/lightdm/lightdm.conf \
             /etc/lightdm/lightdm.conf.d/50-raspi-config.conf \
             /etc/lightdm/lightdm.conf.d/rpd-autologin.conf; do
  [[ -f "${_conf}" ]] || continue
  sed -i 's/^autologin-session=.*/autologin-session=openbox/' "${_conf}" || true
  sed -i 's/^user-session=.*/user-session=openbox/' "${_conf}" || true
done
mkdir -p /etc/lightdm/lightdm.conf.d/
cat > /etc/lightdm/lightdm.conf.d/60-pibarticker-session.conf <<'LEOF'
[Seat:*]
autologin-user=pi
autologin-user-timeout=0
autologin-session=openbox
LEOF

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

  # Launch the ticker now at the end of install (no reboot needed).
  sudo -u "${APP_USER}" \
    env DISPLAY=":0" \
        XAUTHORITY="${XAUTHORITY:-${APP_HOME}/.Xauthority}" \
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
