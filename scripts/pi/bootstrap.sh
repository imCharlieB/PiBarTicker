#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/pibarticker"
APP_USER="pi"
BRANCH="main"
REPO_URL=""
LAUNCH_NOW="1"

# Default to the official repo so the most common case is a trivial one-liner
# (users with forks can still override with --repo).
DEFAULT_REPO_URL="https://github.com/imCharlieB/PiBarTicker.git"

usage() {
  cat <<'EOF'
Usage:
  sudo bash bootstrap.sh [options]

  The simplest form (recommended):
    curl .../bootstrap.sh | sudo bash

Options:
  --repo <url>         GitHub repository URL (default: official PiBarTicker).
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
  echo "Run as root. Example: curl -fsSL .../bootstrap.sh | sudo bash"
  exit 1
fi

# Default to the official repo if the user didn't pass --repo.
# This makes the common "just paste the one-liner" case work with no extra args.
if [[ -z "${REPO_URL}" ]]; then
  REPO_URL="${DEFAULT_REPO_URL}"
  echo "No --repo given — defaulting to official PiBarTicker repo:"
  echo "  ${REPO_URL}"
fi

echo "Installing bootstrap dependencies..."
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl tar rsync

REPO_TRIMMED="${REPO_URL%.git}"
REPO_TRIMMED="${REPO_TRIMMED%/}"
ARCHIVE_URL=""

if [[ "${REPO_TRIMMED}" =~ ^https://github\.com/[^/]+/[^/]+$ ]]; then
  ARCHIVE_URL="${REPO_TRIMMED}/archive/refs/heads/${BRANCH}.tar.gz"
elif [[ "${REPO_TRIMMED}" =~ ^git@github\.com:[^/]+/[^/]+$ ]]; then
  REPO_PATH="${REPO_TRIMMED#git@github.com:}"
  ARCHIVE_URL="https://github.com/${REPO_PATH}/archive/refs/heads/${BRANCH}.tar.gz"
else
  echo "Unsupported repo URL format: ${REPO_URL}"
  echo "Use https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Downloading ${ARCHIVE_URL}..."
curl -fsSL "${ARCHIVE_URL}" -o "${TMP_DIR}/source.tar.gz"
tar -xzf "${TMP_DIR}/source.tar.gz" -C "${TMP_DIR}"

SOURCE_DIR="$(find "${TMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "${SOURCE_DIR}" || ! -f "${SOURCE_DIR}/scripts/pi/install_pi.sh" ]]; then
  echo "Downloaded archive does not contain scripts/pi/install_pi.sh"
  exit 1
fi

INSTALL_ARGS=(
  "--app-dir" "${APP_DIR}"
  "--source-dir" "${SOURCE_DIR}"
  "--user" "${APP_USER}"
)

if [[ "${LAUNCH_NOW}" == "0" ]]; then
  INSTALL_ARGS+=("--no-launch-now")
fi

echo "Running installer..."
bash "${SOURCE_DIR}/scripts/pi/install_pi.sh" "${INSTALL_ARGS[@]}"

echo
echo "Done. Re-run this same command anytime to update and redeploy."
