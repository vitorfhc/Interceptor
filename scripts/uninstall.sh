#!/bin/bash
set -euo pipefail

# Removes user-scoped Interceptor CLI/native-messaging state. Browser extensions
# still need to be removed from brave://extensions or chrome://extensions.

USER_HOME="${USER_HOME_OVERRIDE:-$HOME}"
PATH_MARKER_START="# >>> interceptor path >>>"
PATH_MARKER_END="# <<< interceptor path <<<"

echo "==> Stopping interceptor processes..."
pkill -f "interceptor-daemon" 2>/dev/null || true
pkill -f "interceptor-bridge" 2>/dev/null || true

echo "==> Removing runtime files..."
rm -f /tmp/interceptor.sock /tmp/interceptor.pid
rm -f /tmp/interceptor-bridge.sock /tmp/interceptor-bridge.pid

echo "==> Removing native messaging manifests..."
rm -f "$USER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.interceptor.host.json"
rm -f "$USER_HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.interceptor.host.json"
rm -f "$USER_HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/com.interceptor.host.json"
rm -f "$USER_HOME/Library/Application Support/Chromium/NativeMessagingHosts/com.interceptor.host.json"
rm -rf "$(cd "$(dirname "$0")/.." && pwd)/daemon/.generated"

echo "==> Removing extension metadata from old installs if present..."
rm -f "$USER_HOME/Library/Application Support/Google/Chrome/External Extensions/hkjbaciefhhgekldhncknbjkofbpenng.json"
rm -f "$USER_HOME/Library/Application Support/BraveSoftware/Brave-Browser/External Extensions/hkjbaciefhhgekldhncknbjkofbpenng.json"

echo "==> Removing standalone bridge LaunchAgent if present..."
launchctl bootout "gui/$(id -u)/com.interceptor.bridge" 2>/dev/null || true
rm -f "$USER_HOME/Library/LaunchAgents/com.interceptor.bridge.plist"
rm -f /usr/local/bin/interceptor-bridge 2>/dev/null || true

echo "==> Removing legacy CLI install directory if present..."
rm -rf "$USER_HOME/.interceptor"

echo "==> Removing legacy shell PATH hooks if present..."
for target in "$USER_HOME/.zprofile" "$USER_HOME/.zshrc" "$USER_HOME/.bash_profile" "$USER_HOME/.bashrc"; do
  [[ -f "$target" ]] || continue
  perl -0pi -e "s/\\Q$PATH_MARKER_START\\E.*?\\Q$PATH_MARKER_END\\E\\n?//sg" "$target"
done

echo ""
echo "Interceptor user-scoped state removed."
echo ""
echo "Remove the browser extension manually if it is still present:"
echo "  Brave:  brave://extensions/"
echo "  Chrome: chrome://extensions/"
