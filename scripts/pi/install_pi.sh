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
  x11-xserver-utils \
  xdotool \
  unclutter

# Stop any currently running services so we can safely update files.
# They will be restarted at the end of the install.
echo "Stopping running services for clean update..."
systemctl stop pibarticker-backend.service 2>/dev/null || true
pkill -f "launch-kiosk.sh" 2>/dev/null || true
pkill -f "chromium" 2>/dev/null || true
pkill -f "chromium-browser" 2>/dev/null || true
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

echo "Configuring kiosk autostart for user ${APP_USER}..."
mkdir -p "${APP_HOME}/.config/autostart"
cat > "${APP_HOME}/.config/autostart/pibarticker-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=PiBarTicker Kiosk
Comment=Launch PiBarTicker kiosk on desktop login
Exec=${APP_DIR}/scripts/pi/launch-kiosk.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

mkdir -p "${APP_HOME}/.config/lxsession/LXDE-pi"
if [[ ! -f "${APP_HOME}/.config/lxsession/LXDE-pi/autostart" ]]; then
  cat > "${APP_HOME}/.config/lxsession/LXDE-pi/autostart" <<'EOF'
@lxpanel --profile LXDE-pi
@pcmanfm --desktop --profile LXDE-pi
@xscreensaver -no-splash
EOF
fi

AUTOSTART_FILE="${APP_HOME}/.config/lxsession/LXDE-pi/autostart"
if ! grep -Fq "@${APP_DIR}/scripts/pi/launch-kiosk.sh" "${AUTOSTART_FILE}"; then
  printf "\n@%s/scripts/pi/launch-kiosk.sh\n" "${APP_DIR}" >> "${AUTOSTART_FILE}"
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}/.config"
chmod +x "${APP_DIR}/scripts/pi/launch-kiosk.sh"

# --- Disable the "Login keyring did not get unlocked" prompt ---
# Very common on Raspberry Pi OS Desktop with autologin (used by almost
# all kiosk setups). The default "Login" keyring is password-protected,
# but autologin never enters the password, so you get an annoying unlock
# dialog on every boot.
#
# We remove the keyring file for the target user and (for dedicated
# kiosks) purge gnome-keyring entirely so the prompt can never appear.
echo "Disabling login keyring prompt (common on Pi autologin)..."

KEYRING_DIR="${APP_HOME}/.local/share/keyrings"
sudo -u "${APP_USER}" mkdir -p "${KEYRING_DIR}"
sudo -u "${APP_USER}" rm -f "${KEYRING_DIR}/login.keyring" 2>/dev/null || true

# Purge gnome-keyring for a clean kiosk experience.
# This is safe and recommended for dedicated signage/ticker Pis.
if apt-get purge -y gnome-keyring >/dev/null 2>&1; then
  echo "Purged gnome-keyring to prevent future unlock prompts."
fi

if [[ "${LAUNCH_NOW}" == "1" ]]; then
  echo "Attempting immediate kiosk launch (if desktop session is active)..."
  if pgrep -f "${APP_DIR}/scripts/pi/launch-kiosk.sh" >/dev/null 2>&1; then
    echo "Kiosk launcher is already running."
  elif [[ -S "/tmp/.X11-unix/X0" && -f "${APP_HOME}/.Xauthority" ]]; then
    sudo -u "${APP_USER}" env DISPLAY=:0 XAUTHORITY="${APP_HOME}/.Xauthority" \
      nohup "${APP_DIR}/scripts/pi/launch-kiosk.sh" >/tmp/pibarticker-kiosk.log 2>&1 &
    echo "Kiosk launcher started for current desktop session."
  else
    echo "No active desktop session detected; kiosk starts on next login/reboot."
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
