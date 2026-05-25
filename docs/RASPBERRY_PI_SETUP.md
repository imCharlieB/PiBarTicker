# Raspberry Pi Install and Kiosk Setup

This guide installs PiBarTicker on Raspberry Pi OS and configures a Chromium kiosk that uses Setup page values from `config.json`.

## What the installer configures

- Copies app files to `/opt/pibarticker`
- Creates Python virtual environment at `/opt/pibarticker/.venv`
- Installs backend requirements from `backend/requirements.txt`
- Installs frontend dependencies and builds `frontend/dist`
- Installs and enables backend service `pibarticker-backend.service`
- Adds desktop autostart entry for `scripts/pi/launch-kiosk.sh`

## Prerequisites

- Raspberry Pi 4 or 5
- Raspberry Pi OS Desktop (Bookworm preferred)
- User `pi` exists
- Network access (for package install and ESPN feeds)

OS flavor requirement:

- Use the Desktop image (full desktop session required).
- `Lite` is not supported by this kiosk flow because it relies on an X desktop session (`xset`, `xrandr`, Chromium kiosk, and LXDE autostart).

## One-command install or update from GitHub

Use this command on the Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/imCharlieB/PiBarTicker/main/scripts/pi/bootstrap.sh | sudo bash -s -- \
  --repo https://github.com/imCharlieB/PiBarTicker.git \
  --branch main
```

What this does:

- downloads the selected branch as a source archive from GitHub
- installs or updates `/opt/pibarticker` from that archive (no local git checkout required)
- runs the same installer each time (`scripts/pi/install_pi.sh`)
- redeploys backend/frontend/service every run
- attempts to launch kiosk immediately if a desktop session is active

Use the exact same command later to update.

## Install on the Pi

1. Clone or copy this repo to the Pi.
2. From repo root, run:

```bash
sudo bash scripts/pi/install_pi.sh
```

3. Reboot:

```bash
sudo reboot
```

After reboot, backend starts as a service and Chromium launches into kiosk mode when Setup allows it.

## Setup page settings that control kiosk behavior

These fields are read at startup from `config.json` and applied by `scripts/pi/launch-kiosk.sh`:

- Display -> Width (`monitor.width`)
- Display -> Height (`monitor.height`)
- Display -> Kiosk startup (`kiosk.autoStart`)
- Display -> Chromium flags (`kiosk.chromiumFlags`)

Notes:

- If Kiosk startup is `disabled`, the launcher exits without opening Chromium.
- Chromium flags are passed exactly as configured in Setup.
- Launcher opens `http://127.0.0.1:8000/?kiosk=1`.
- The script attempts `xrandr -s <width>x<height>` before Chromium launch.

## Service and logs

Check backend:

```bash
systemctl status pibarticker-backend.service
```

Follow backend logs:

```bash
journalctl -u pibarticker-backend.service -f
```

Restart backend:

```bash
sudo systemctl restart pibarticker-backend.service
```

## Common updates

If you installed with the bootstrap command, run the same curl command again.

If you installed from a local checkout, redeploy with:

```bash
cd /path/to/repo
sudo bash scripts/pi/install_pi.sh
```

## Troubleshooting

- Black screen after boot:
  - Confirm desktop session is enabled (Raspberry Pi OS Desktop, not Lite).
  - Confirm `~/.config/autostart/pibarticker-kiosk.desktop` exists and references `/opt/pibarticker/scripts/pi/launch-kiosk.sh`.
  - Legacy LXDE sessions can also use `~/.config/lxsession/LXDE-pi/autostart`.
- Chromium does not open:
  - Check `kiosk.autoStart` is `autostart` in Setup.
  - Verify Chromium exists: `which chromium-browser || which chromium`.
- Kiosk opens but no app:
  - Check backend health: `curl http://127.0.0.1:8000/health`.
  - Check backend logs with `journalctl`.
- Display mode not applied:
  - Run `xrandr` and verify your exact mode exists.
  - Add a custom mode in Raspberry Pi display settings if needed.

## Manual uninstall

```bash
sudo systemctl disable --now pibarticker-backend.service
sudo rm -f /etc/systemd/system/pibarticker-backend.service
sudo systemctl daemon-reload
sudo rm -rf /opt/pibarticker
```
