#!/bin/bash
set -euo pipefail

# ── Interceptor Uninstaller ───────────────────────────────────────────────────
# Removes the installed app bundle, user wrappers, and legacy launch-agent
# state. Does NOT remove the browser extension — that must be done per-browser
# at brave://extensions or chrome://extensions.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "$0")"

if [[ "${INTERCEPTOR_UNINSTALL_ELEVATED:-0}" != "1" && "${EUID}" -ne 0 ]]; then
  CALLER_HOME="$HOME"
  CALLER_UID="$(id -u)"
  CALLER_USER="$(id -un)"
  TMP_SCRIPT="/tmp/interceptor-uninstall-$$.sh"
  cp "$SCRIPT_PATH" "$TMP_SCRIPT"
  chmod 700 "$TMP_SCRIPT"
  /usr/bin/osascript <<OSA
do shell script "INTERCEPTOR_UNINSTALL_ELEVATED=1 USER_HOME_OVERRIDE=" & quoted form of "$CALLER_HOME" & " TARGET_UID=" & quoted form of "$CALLER_UID" & " TARGET_USER=" & quoted form of "$CALLER_USER" & " /bin/bash " & quoted form of "$TMP_SCRIPT" with administrator privileges
OSA
  rm -f "$TMP_SCRIPT"
  exit 0
fi

USER_HOME="${USER_HOME_OVERRIDE:-$HOME}"
TARGET_UID="${TARGET_UID:-$(id -u)}"
TARGET_USER="${TARGET_USER:-$(id -un)}"

INSTALL_DIR="$USER_HOME/.interceptor"
APP_DEST="/Applications/Interceptor.app"
LEGACY_APP_DEST="$USER_HOME/Applications/Interceptor.app"
APP_EXEC="$APP_DEST/Contents/MacOS/Interceptor"
PLIST_DST="$USER_HOME/Library/LaunchAgents/com.interceptor.bridge.plist"

echo "==> Unregistering bundled helper (if present)..."
if [[ -x "$APP_EXEC" ]]; then
  if [[ "${EUID}" -eq 0 ]]; then
    /bin/launchctl asuser "$TARGET_UID" "$APP_EXEC" unregister-helper >/dev/null 2>&1 || true
  else
    "$APP_EXEC" unregister-helper >/dev/null 2>&1 || true
  fi
fi

echo "==> Removing legacy LaunchAgent plist..."
/bin/launchctl bootout "gui/$TARGET_UID/com.interceptor.bridge" 2>/dev/null || true
rm -f "$PLIST_DST"

echo "==> Killing any running interceptor processes..."
pkill -f "interceptor-daemon" 2>/dev/null || true
pkill -f "interceptor-bridge" 2>/dev/null || true
pkill -f "/Interceptor.app/Contents/MacOS/InterceptorBridge" 2>/dev/null || true
pkill -f "/Interceptor.app/Contents/MacOS/Interceptor" 2>/dev/null || true

echo "==> Removing install dir ($INSTALL_DIR)..."
rm -rf "$INSTALL_DIR"

echo "==> Removing installed app bundle ($APP_DEST)..."
rm -rf "$APP_DEST"

echo "==> Removing legacy home-directory app bundle ($LEGACY_APP_DEST)..."
rm -rf "$LEGACY_APP_DEST"

echo "==> Removing stale runtime files..."
rm -f /tmp/interceptor.sock /tmp/interceptor.pid
rm -f /tmp/interceptor-bridge.sock /tmp/interceptor-bridge.pid

echo "==> Forgetting installer receipt and resetting Interceptor TCC approvals..."
/usr/sbin/pkgutil --forget com.hackervalley.interceptor >/dev/null 2>&1 || true
if [[ "${EUID}" -eq 0 ]]; then
  /bin/launchctl asuser "$TARGET_UID" /usr/bin/tccutil reset All com.hackervalley.interceptor >/dev/null 2>&1 || true
else
  /usr/bin/tccutil reset All com.hackervalley.interceptor >/dev/null 2>&1 || true
fi

echo ""
echo "✓ Interceptor uninstalled."
echo ""
echo "The browser extension was NOT removed automatically — remove it manually:"
echo "  • Brave:   open brave://extensions/ and click Remove on Interceptor"
echo "  • Chrome:  open chrome://extensions/ and click Remove on Interceptor"
echo ""
echo "Also revoke Privacy permissions (Accessibility / Input Monitoring /"
echo "Screen Recording) for Interceptor via System Settings → Privacy & Security"
echo "if you want a fully clean system."
