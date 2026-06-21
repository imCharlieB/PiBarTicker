# Raspberry Pi Install and Kiosk Setup

This guide installs PiBarTicker on Raspberry Pi OS and configures a Chromium kiosk that uses Setup page values from `config.json`.

## What the installer configures

- Copies app files to `/opt/pibarticker`
- Creates Python virtual environment at `/opt/pibarticker/.venv`
- Installs backend requirements from `backend/requirements.txt`
- Installs frontend dependencies and builds `frontend/dist`
- Installs and enables backend service `pibarticker-backend.service`
- Configures desktop autologin via `raspi-config nonint do_boot_behaviour B4` (Desktop Autologin for current Labwc/Wayland session)
- Creates `~/.config/labwc/autostart` (executable shell script) to launch `scripts/pi/launch-kiosk.sh` on desktop session start — **not** a XDG `.desktop` file; removes any stale `.desktop` from prior installs to prevent double-launch
- Makes one targeted edit to `/etc/lightdm/lightdm.conf`: comments out `display-setup-script=` to stop LightDM/Labwc from triggering a flashing "Loading setup configuration" screen. This is the only direct lightdm.conf edit — no `lightdm.conf.d/` files are created or modified
- Removes `~/.local/share/keyrings/login.keyring` to prevent the "Login keyring did not get unlocked" prompt that appears on every autologin boot (package is left installed)
- Creates a custom Plymouth boot splash from `frontend/public/pibarticker-logo.svg` (Pi 4/5 auto-detected, SVG converted to PNG, original backed up, initramfs rebuilt) — your PiBarTicker logo appears at boot instead of the default Raspberry Pi splash

## Prerequisites

- Raspberry Pi 4 or 5
- Raspberry Pi OS Desktop (Bookworm preferred)
- User `pi` exists
- Network access (for package install and ESPN feeds)

OS flavor requirement:

- Use the Desktop image (full desktop session required).
- `Lite` is not supported by this kiosk flow because it relies on a graphical desktop session (Labwc/Wayland or X11) for the compositor, wlr-randr/xrandr, and Chromium kiosk.

## One-command install or update from GitHub

**The dead-simple command** (recommended — paste this on a fresh Raspberry Pi OS Desktop):

```bash
curl -fsSL https://raw.githubusercontent.com/imCharlieB/PiBarTicker/main/scripts/pi/bootstrap.sh | sudo bash
```

This single line does everything: downloads the code, runs the installer, sets up the backend service + kiosk, and installs the custom PiBarTicker boot splash (with Pi 4/5 detection).

Run the exact same one-liner any time to update or redeploy.

What happens under the hood:
- downloads the selected branch as a source archive from GitHub
- installs or updates `/opt/pibarticker` (no local git checkout required on the Pi)
- runs `scripts/pi/install_pi.sh`
- redeploys everything and attempts immediate kiosk launch if a desktop session is active

For forks, a different branch, or other options, pass them after `--`:

```bash
curl .../bootstrap.sh | sudo bash -s -- --repo https://github.com/you/your-fork.git --branch my-feature
```

If you see old git checkout errors during an update, force a fresh bootstrap fetch:

```bash
curl -fsSL "https://raw.githubusercontent.com/imCharlieB/PiBarTicker/main/scripts/pi/bootstrap.sh?ts=$(date +%s)" | sudo bash
```

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

- If Kiosk startup is anything other than `autostart`, the launcher exits without opening Chromium.
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

Kiosk launcher logs (two locations):

```bash
# Output from the installer's immediate launch attempt (and nohup wrapper):
tail -f ~/pibarticker-kiosk.log

# Ongoing Chromium output from the while-true restart loop in launch-kiosk.sh:
tail -f /tmp/pibarticker-kiosk.log
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
  - For Labwc/Wayland (current official Pi OS), confirm `~/.config/labwc/autostart` exists and references the launch-kiosk.sh (the installer creates this executable shell script; it does not use or create ~/.config/autostart/*.desktop).
  - Older versions of the installer created `/etc/lightdm/lightdm.conf.d/50-pibarticker-autologin.conf` (and forced `rpd-labwc` etc.). That file has been known to break the desktop/greeter and, during manual recovery, sometimes led to desktop packages being removed by `apt autoremove`. Current installer does not create or manage any 50-pibarticker-autologin.conf file at all (we never plan to write or touch "that file" again and do no direct edits to lightdm.conf.d/). It only calls `raspi-config nonint do_boot_behaviour B4` (Desktop Autologin for current Labwc session) + creates `~/.config/labwc/autostart` (executable script for kiosk launcher). No legacy lxsession/LXDE-pi code. If a bad 50-pibarticker file is still present, delete it manually. If desktop packages were previously removed, reinstall them first with something like `sudo apt install --no-install-recommends raspberrypi-ui-mods xserver-xorg lightdm` (exact package names can vary by Pi OS version).
- Chromium does not open:
  - Check `kiosk.autoStart` is `autostart` in Setup.
  - Verify Chromium exists: `which chromium-browser || which chromium`.
- Kiosk opens but no app:
  - Check backend health: `curl http://127.0.0.1:8000/health`.
  - Check backend logs with `journalctl`.
- Display mode not applied:
  - Run `xrandr` and verify your exact mode exists.
  - Add a custom mode in Raspberry Pi display settings if needed.

## Branding assets

App logo assets now ship in frontend public files:

- `frontend/public/pibarticker-logo.svg`
- `frontend/public/favicon.svg`

Pre-desktop splash branding note:

- Replacing the logo shown before desktop load is controlled by Raspberry Pi OS splash/boot configuration (outside app runtime).
- Use `frontend/public/pibarticker-logo.svg` as the master artwork and convert/export to PNG for your chosen splash mechanism.

## Manual uninstall

```bash
sudo systemctl disable --now pibarticker-backend.service
sudo rm -f /etc/systemd/system/pibarticker-backend.service
sudo systemctl daemon-reload
sudo rm -rf /opt/pibarticker

# Remove kiosk autostart
rm -f ~/.config/labwc/autostart

# Restore original Plymouth boot splash (if backup exists)
sudo cp /usr/share/plymouth/themes/pix/splash.png.pibarticker-backup \
        /usr/share/plymouth/themes/pix/splash.png 2>/dev/null || true
sudo update-initramfs -u -k all 2>/dev/null || true
```
