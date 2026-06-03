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

apt-get install -y --no-install-recommends \
  python3 \
  python3-venv \
  python3-pip \
  nodejs \
  npm \
  curl \
  rsync \
  "${CHROMIUM_PACKAGE}" \
  wlr-randr
# X11-only packages (x11-xserver-utils, xdotool, unclutter) removed — not required
# for Labwc/Wayland on current Pi OS. wlr-randr and chromium (or chromium-browser)
# are kept. The launcher skips X11-only tools via `command -v` guards if absent.

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

chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}/.config"
chmod +x "${APP_DIR}/scripts/pi/launch-kiosk.sh"

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

# --- Disable the "Login keyring did not get unlocked" prompt ---
# Very common on Raspberry Pi OS Desktop with autologin (used by almost
# all kiosk setups). The default "Login" keyring is password-protected,
# but autologin never enters the password, so you get an annoying unlock
# dialog on every boot.
#
# We ONLY remove the keyring file for the target user.
# DO NOT purge the gnome-keyring package — it can mark desktop components
# as "no longer required" and break the desktop session.
echo "Disabling login keyring prompt (common on Pi autologin)..."

KEYRING_DIR="${APP_HOME}/.local/share/keyrings"
sudo -u "${APP_USER}" mkdir -p "${KEYRING_DIR}"
sudo -u "${APP_USER}" rm -f "${KEYRING_DIR}/login.keyring" 2>/dev/null || true
echo "Removed user's login.keyring (safe; package left installed to keep desktop intact)."

if [[ "${LAUNCH_NOW}" == "1" ]]; then
  echo "Attempting immediate kiosk launch..."
  if pgrep -f "${APP_DIR}/scripts/pi/launch-kiosk.sh" >/dev/null 2>&1; then
    echo "Kiosk launcher is already running."
  else
    # Launch the ticker now at the end of install (no reboot needed for testing).
    # The launcher internally waits for Wayland/X compositor if not yet ready in this env.
    # We pass through any available session env vars (works whether install run from GUI terminal or ssh).
    sudo -u "${APP_USER}" \
      env ${WAYLAND_DISPLAY:+WAYLAND_DISPLAY="$WAYLAND_DISPLAY"} \
          ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"} \
          ${DISPLAY:+DISPLAY="$DISPLAY"} \
      nohup "${APP_DIR}/scripts/pi/launch-kiosk.sh" >/tmp/pibarticker-kiosk.log 2>&1 &
    echo "Kiosk launcher started (or will activate when desktop session is ready)."
  fi
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
    # Use sed to strip NUL terminator(s) from device-tree strings (robust, no tr \0 quoting quirks)
    pi_model="$(sed 's/\x00//g' /proc/device-tree/model 2>/dev/null || true)"
  fi

  echo "Detected hardware model: ${pi_model:-unknown}"

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

  # Install only the tools we need for this step (keeps the main package list unchanged)
  echo "Installing conversion tools (librsvg2-bin, imagemagick) for splash generation..."
  if ! apt-get install -y --no-install-recommends librsvg2-bin imagemagick >/dev/null 2>&1; then
    echo "WARNING: Could not install image tools. Skipping custom boot splash."
    return 0
  fi

  local logo_svg="${APP_DIR}/frontend/public/pibarticker-logo.svg"
  if [[ ! -f "${logo_svg}" ]]; then
    echo "WARNING: ${logo_svg} not present after file sync. Skipping splash."
    return 0
  fi

  echo "Creating custom PiBarTicker boot splash from SVG..."

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  # Copy SVG + the PNG it references (href is relative) so rasterizer resolves assets reliably
  cp "${logo_svg}" "${tmp_dir}/pibarticker-logo.svg" 2>/dev/null || true
  local src_dir
  src_dir="$(dirname "${logo_svg}")"
  if [[ -f "${src_dir}/pibarticker-logo-transparent.png" ]]; then
    cp "${src_dir}/pibarticker-logo-transparent.png" "${tmp_dir}/" 2>/dev/null || true
  fi

  local raster_png="${tmp_dir}/logo-raster.png"
  local splash_png="${tmp_dir}/pibarticker-splash.png"

  # Pick logo render size (example of using Pi4/Pi5 detection for future tuning)
  local logo_w=880
  if [[ ${is_pi5} -eq 1 ]]; then
    logo_w=960
  fi

  # Prefer rsvg-convert (light, accurate for our SVG)
  local raster_ok=0
  if ( cd "${tmp_dir}" && rsvg-convert --width=${logo_w} --keep-aspect-ratio pibarticker-logo.svg -o logo-raster.png >/dev/null 2>&1 ); then
    raster_ok=1
  else
    echo "rsvg-convert did not succeed; trying ImageMagick convert fallback..."
    if convert "${tmp_dir}/pibarticker-logo.svg" -resize ${logo_w}x -background none "${raster_png}" >/dev/null 2>&1; then
      raster_ok=1
    fi
  fi

  if [[ ${raster_ok} -eq 0 ]]; then
    echo "WARNING: SVG to PNG conversion failed for splash. Skipping."
    rm -rf "${tmp_dir}" 2>/dev/null || true
    return 0
  fi

  # Black canvas + centered logo (no text, clean branding)
  if ! convert -size ${splash_w}x${splash_h} xc:#000000 \
       "${raster_png}" -gravity center -composite \
       "${splash_png}" >/dev/null 2>&1; then
    echo "WARNING: Failed to create final splash composite."
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
echo "Kiosk launcher log: tail -f /tmp/pibarticker-kiosk.log"
