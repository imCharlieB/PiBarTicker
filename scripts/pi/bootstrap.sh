#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/pibarticker"
APP_USER="pi"
BRANCH="main"
REPO_URL=""
LAUNCH_NOW="1"

usage() {
  cat <<'EOF'
Usage:
  sudo bash bootstrap.sh --repo https://github.com/<owner>/<repo>.git [options]

Options:
  --repo <url>         Required Git repository URL.
  --branch <name>      Branch to install/update from (default: main).
  --app-dir <path>     Install location (default: /opt/pibarticker).
  --user <name>        Linux user owning runtime (default: pi).
  --no-launch-now      Skip immediate kiosk launch attempt.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --app-dir)
      APP_DIR="$2"
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root. Example: curl ... | sudo bash"
  exit 1
fi

if [[ -z "${REPO_URL}" ]]; then
  echo "Missing --repo"
  usage
  exit 1
fi

echo "Installing bootstrap dependencies..."
apt-get update
apt-get install -y --no-install-recommends git ca-certificates curl

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "Cloning ${REPO_URL} (${BRANCH}) into ${APP_DIR}..."
  rm -rf "${APP_DIR}"
  git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
else
  echo "Updating existing checkout in ${APP_DIR}..."
  git -C "${APP_DIR}" remote set-url origin "${REPO_URL}"
  git -C "${APP_DIR}" fetch origin "${BRANCH}" --depth 1
  git -C "${APP_DIR}" checkout -B "${BRANCH}" "origin/${BRANCH}"
fi

INSTALL_ARGS=(
  "--app-dir" "${APP_DIR}"
  "--source-dir" "${APP_DIR}"
  "--user" "${APP_USER}"
)

if [[ "${LAUNCH_NOW}" == "0" ]]; then
  INSTALL_ARGS+=("--no-launch-now")
fi

echo "Running installer..."
bash "${APP_DIR}/scripts/pi/install_pi.sh" "${INSTALL_ARGS[@]}"

echo
echo "Done. Re-run this same command anytime to update and redeploy."
