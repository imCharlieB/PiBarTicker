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
apt-get install -y --no-install-recommends \
  python3 \
  python3-venv \
  python3-pip \
  nodejs \
  npm \
  curl \
  rsync \
  chromium-browser \
  x11-xserver-utils \
  xdotool \
  unclutter

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
    --exclude "logos" \
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
echo "Install complete."
echo "Backend status: systemctl status ${SERVICE_NAME}.service"
echo "Logs: journalctl -u ${SERVICE_NAME}.service -f"
echo "Kiosk launcher log: tail -f /tmp/pibarticker-kiosk.log"
