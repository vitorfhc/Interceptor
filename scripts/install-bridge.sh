#!/bin/bash
set -euo pipefail

# install-bridge.sh — Install the locally built interceptor-bridge.
#
# Usage:
#   bash scripts/build-bridge.sh
#   bash scripts/install-bridge.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"
BINARY_SRC="$DIST_DIR/interceptor-bridge"

PLIST_NAME="com.interceptor.bridge"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
BINARY_DST="/usr/local/bin/interceptor-bridge"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: interceptor-bridge is macOS only."
  exit 1
fi

if [[ ! -f "$BINARY_SRC" ]]; then
  echo "ERROR: bridge binary not found at $BINARY_SRC"
  echo "Run: bash scripts/build-bridge.sh"
  exit 1
fi

if launchctl list | grep -q "$PLIST_NAME" 2>/dev/null; then
  echo "==> Unloading existing LaunchAgent..."
  launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true
fi

if [[ -f /tmp/interceptor-bridge.pid ]]; then
  PID="$(head -1 /tmp/interceptor-bridge.pid)"
  kill "$PID" 2>/dev/null || true
  sleep 1
fi

echo "==> Installing bridge binary to $BINARY_DST..."
cp "$BINARY_SRC" "$BINARY_DST"
chmod +x "$BINARY_DST"

echo "==> Installing LaunchAgent plist..."
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BINARY_DST</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/interceptor-bridge.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/interceptor-bridge.stderr.log</string>
    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
PLIST

echo "==> Loading LaunchAgent..."
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo ""
echo "==> interceptor-bridge installed."
echo "    Binary: $BINARY_DST"
echo "    Test:   interceptor macos tree"
