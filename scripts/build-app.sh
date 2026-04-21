#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_SRC_DIR="$PROJECT_DIR/interceptor-app"
DIST_DIR="$PROJECT_DIR/dist"
APP_BUNDLE="$DIST_DIR/Interceptor.app"
SIGNING_ENV="$PROJECT_DIR/signing.env"
ENTITLEMENTS_PLIST="$PROJECT_DIR/scripts/entitlements.plist"
VERSION=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/extension/manifest.json'))['version'])")

APP_HOST_BIN="$APP_SRC_DIR/.build/release/InterceptorHost"
CLI_BIN="$PROJECT_DIR/dist/interceptor"
DAEMON_BIN="$PROJECT_DIR/daemon/interceptor-daemon"
BRIDGE_BIN="$PROJECT_DIR/dist/interceptor-bridge"
SETUP_BIN="$PROJECT_DIR/dist/interceptor-setup"
ICON_FILE="$PROJECT_DIR/scripts/Interceptor.icns"
EXTENSION_DIR="$PROJECT_DIR/extension/dist"
MANIFEST_TEMPLATE="$PROJECT_DIR/daemon/com.interceptor.host.json"
LAUNCH_AGENT_TEMPLATE="$PROJECT_DIR/interceptor-bridge/com.interceptor.bridge.plist"
FONT_ASSET_DIR="$PROJECT_DIR/interceptor-app/Assets/Fonts"
IMAGE_ASSET_DIR="$PROJECT_DIR/interceptor-app/Assets/Images"
SPARKLE_CONFIG_DIR="$PROJECT_DIR/sparkle"
SPARKLE_FEED_URL_FILE="$SPARKLE_CONFIG_DIR/feed-url.txt"
SPARKLE_PUBLIC_KEY_FILE="$SPARKLE_CONFIG_DIR/public-ed-key.txt"

SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-}"
if [[ -z "$SPARKLE_FEED_URL" && -f "$SPARKLE_FEED_URL_FILE" ]]; then
  SPARKLE_FEED_URL="$(tr -d '\n' < "$SPARKLE_FEED_URL_FILE")"
fi

SPARKLE_PUBLIC_KEY="${SPARKLE_PUBLIC_KEY:-}"
if [[ -z "$SPARKLE_PUBLIC_KEY" && -f "$SPARKLE_PUBLIC_KEY_FILE" ]]; then
  SPARKLE_PUBLIC_KEY="$(tr -d '\n' < "$SPARKLE_PUBLIC_KEY_FILE")"
fi

for required in "$CLI_BIN" "$DAEMON_BIN" "$BRIDGE_BIN" "$SETUP_BIN" "$MANIFEST_TEMPLATE" "$LAUNCH_AGENT_TEMPLATE"; do
  [[ -e "$required" ]] || { echo "ERROR: missing required build artifact: $required" >&2; exit 1; }
done

[[ -d "$EXTENSION_DIR" ]] || { echo "ERROR: extension/dist missing — run scripts/build.sh first" >&2; exit 1; }

echo "==> Building InterceptorHost (release)..."
cd "$APP_SRC_DIR"
swift build -c release --product InterceptorHost 2>&1

[[ -f "$APP_HOST_BIN" ]] || { echo "ERROR: build failed — InterceptorHost not found at $APP_HOST_BIN" >&2; exit 1; }

echo "==> Assembling Interceptor.app..."
rm -rf "$APP_BUNDLE"
mkdir -p \
  "$APP_BUNDLE/Contents/MacOS" \
  "$APP_BUNDLE/Contents/Frameworks" \
  "$APP_BUNDLE/Contents/Resources/bin" \
  "$APP_BUNDLE/Contents/Resources/Fonts" \
  "$APP_BUNDLE/Contents/Resources/extension/dist" \
  "$APP_BUNDLE/Contents/Resources/templates" \
  "$APP_BUNDLE/Contents/Library/LaunchAgents"

SPARKLE_PLIST_KEYS=""
if [[ -n "$SPARKLE_FEED_URL" ]]; then
  SPARKLE_PLIST_KEYS="${SPARKLE_PLIST_KEYS}
    <key>SUFeedURL</key>
    <string>${SPARKLE_FEED_URL}</string>"
fi

if [[ -n "$SPARKLE_PUBLIC_KEY" ]]; then
  SPARKLE_PLIST_KEYS="${SPARKLE_PLIST_KEYS}
    <key>SUPublicEDKey</key>
    <string>${SPARKLE_PUBLIC_KEY}</string>
    <key>SUAllowsAutomaticUpdates</key>
    <true/>
    <key>SUAutomaticallyUpdate</key>
    <true/>"
fi

cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Interceptor</string>
    <key>CFBundleIdentifier</key>
    <string>com.hackervalley.interceptor</string>
    <key>CFBundleName</key>
    <string>Interceptor</string>
    <key>CFBundleDisplayName</key>
    <string>Interceptor</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSUIElement</key>
    <false/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>Interceptor uses the microphone for speech recognition and voice activity detection.</string>
    <key>ATSApplicationFontsPath</key>
    <string>Fonts</string>
${SPARKLE_PLIST_KEYS}
</dict>
</plist>
PLIST

cp "$APP_HOST_BIN" "$APP_BUNDLE/Contents/MacOS/Interceptor"
cp "$BRIDGE_BIN" "$APP_BUNDLE/Contents/MacOS/InterceptorBridge"
cp "$CLI_BIN" "$APP_BUNDLE/Contents/Resources/bin/interceptor"
cp "$DAEMON_BIN" "$APP_BUNDLE/Contents/Resources/bin/interceptor-daemon"
cp "$SETUP_BIN" "$APP_BUNDLE/Contents/Resources/bin/interceptor-setup"
cp "$MANIFEST_TEMPLATE" "$APP_BUNDLE/Contents/Resources/templates/com.interceptor.host.json"
cp "$LAUNCH_AGENT_TEMPLATE" "$APP_BUNDLE/Contents/Library/LaunchAgents/com.interceptor.bridge.plist"
cp "$FONT_ASSET_DIR"/* "$APP_BUNDLE/Contents/Resources/Fonts/"
cp "$IMAGE_ASSET_DIR"/InterceptorLogo.png "$APP_BUNDLE/Contents/Resources/InterceptorLogo.png"
if [[ -f "$ICON_FILE" ]]; then
  cp "$ICON_FILE" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
fi

if ! otool -l "$APP_BUNDLE/Contents/MacOS/Interceptor" | grep -q "@executable_path/../Frameworks"; then
  install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP_BUNDLE/Contents/MacOS/Interceptor"
fi

ditto "$EXTENSION_DIR" "$APP_BUNDLE/Contents/Resources/extension/dist"

SPARKLE_FRAMEWORK="$(find "$APP_SRC_DIR/.build" -path '*Sparkle.framework' -type d | head -1)"
if [[ -n "$SPARKLE_FRAMEWORK" ]]; then
  ditto "$SPARKLE_FRAMEWORK" "$APP_BUNDLE/Contents/Frameworks/Sparkle.framework"
elif [[ -n "$SPARKLE_FEED_URL" || -n "$SPARKLE_PUBLIC_KEY" ]]; then
  echo "ERROR: Sparkle.framework not found in SwiftPM build artifacts" >&2
  exit 1
else
  echo "==> Sparkle framework not found — updater will remain disabled until Sparkle is configured"
fi

chmod -R a+rX "$APP_BUNDLE/Contents/Resources/extension/dist"
chmod +x \
  "$APP_BUNDLE/Contents/MacOS/Interceptor" \
  "$APP_BUNDLE/Contents/MacOS/InterceptorBridge" \
  "$APP_BUNDLE/Contents/Resources/bin/interceptor" \
  "$APP_BUNDLE/Contents/Resources/bin/interceptor-daemon" \
  "$APP_BUNDLE/Contents/Resources/bin/interceptor-setup"

if [[ -f "$SIGNING_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$SIGNING_ENV"
  if [[ -n "${SIGN_IDENTITY:-}" ]]; then
    sign_bun() {
      local bin="$1"
      local bundle_id="$2"
      codesign --force --options runtime --timestamp \
        --sign "$SIGN_IDENTITY" \
        --entitlements "$ENTITLEMENTS_PLIST" \
        -i "$bundle_id" \
        "$bin"
    }

    sign_native() {
      local bin="$1"
      local bundle_id="$2"
      codesign --force --options runtime --timestamp \
        --sign "$SIGN_IDENTITY" \
        -i "$bundle_id" \
        "$bin"
    }

    echo "==> Signing Interceptor.app nested executables..."
    sign_native "$APP_BUNDLE/Contents/MacOS/Interceptor" "com.hackervalley.interceptor"
    sign_native "$APP_BUNDLE/Contents/MacOS/InterceptorBridge" "com.hackervalley.interceptor-bridge"
    sign_bun "$APP_BUNDLE/Contents/Resources/bin/interceptor" "com.hackervalley.interceptor-cli"
    sign_bun "$APP_BUNDLE/Contents/Resources/bin/interceptor-daemon" "com.hackervalley.interceptor-daemon"
    sign_bun "$APP_BUNDLE/Contents/Resources/bin/interceptor-setup" "com.hackervalley.interceptor-setup"
    if [[ -d "$APP_BUNDLE/Contents/Frameworks/Sparkle.framework" ]]; then
      codesign --force --options runtime --timestamp --deep \
        --sign "$SIGN_IDENTITY" \
        "$APP_BUNDLE/Contents/Frameworks/Sparkle.framework"
    fi

    echo "==> Signing Interceptor.app bundle..."
    codesign --force --options runtime --timestamp --deep \
      --sign "$SIGN_IDENTITY" \
      -i "com.hackervalley.interceptor" \
      "$APP_BUNDLE"
    codesign --verify --verbose=2 --deep --strict "$APP_BUNDLE"
  fi
else
  echo "==> No signing.env found — skipping app-bundle signing"
fi

echo "==> Built $APP_BUNDLE"
