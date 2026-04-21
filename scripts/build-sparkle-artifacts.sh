#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(python3 -c "import json; print(json.load(open('$ROOT/extension/manifest.json'))['version'])")
APP_BUNDLE="$ROOT/dist/Interceptor.app"
DIST_SPARKLE_DIR="$ROOT/dist/sparkle"
UPDATES_DIR="$ROOT/updates"
APPCAST_PATH="$ROOT/appcast.xml"
ARCHIVE_NAME="Interceptor-${VERSION}.zip"
ARCHIVE_PATH="$DIST_SPARKLE_DIR/$ARCHIVE_NAME"
UPDATES_ARCHIVE_PATH="$UPDATES_DIR/$ARCHIVE_NAME"
SPARKLE_SOURCE_DIR="${SPARKLE_SOURCE_DIR:-/Volumes/VRAM/80-89_Resources/80_Reference/research/Sparkle}"
SPARKLE_KEY_ACCOUNT="${SPARKLE_KEY_ACCOUNT:-interceptor-sparkle}"
DERIVED_DATA_DIR="${DERIVED_DATA_DIR:-$ROOT/.build/sparkle-tools}"
FEED_URL_FILE="$ROOT/sparkle/feed-url.txt"
PUBLIC_KEY_FILE="$ROOT/sparkle/public-ed-key.txt"

[[ -d "$APP_BUNDLE" ]] || bash "$ROOT/scripts/build-app.sh"

if [[ ! -f "$PUBLIC_KEY_FILE" ]]; then
  bash "$ROOT/scripts/setup-sparkle-keys.sh"
fi

SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-}"
if [[ -z "$SPARKLE_FEED_URL" && -f "$FEED_URL_FILE" ]]; then
  SPARKLE_FEED_URL="$(tr -d '\n' < "$FEED_URL_FILE")"
fi

if [[ -z "$SPARKLE_FEED_URL" ]]; then
  echo "ERROR: Sparkle feed URL is not configured. Set SPARKLE_FEED_URL or create sparkle/feed-url.txt." >&2
  exit 1
fi

SPARKLE_DOWNLOAD_URL_PREFIX="${SPARKLE_DOWNLOAD_URL_PREFIX:-${SPARKLE_FEED_URL%appcast.xml}updates/}"

mkdir -p "$DIST_SPARKLE_DIR" "$UPDATES_DIR"

echo "==> Building Sparkle generate_appcast tool"
xcodebuild \
  -project "$SPARKLE_SOURCE_DIR/Sparkle.xcodeproj" \
  -scheme generate_appcast \
  -configuration Release \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  build > /dev/null

GENERATE_APPCAST_BIN="$DERIVED_DATA_DIR/Build/Products/Release/generate_appcast"
[[ -x "$GENERATE_APPCAST_BIN" ]] || {
  echo "ERROR: generate_appcast binary not found at $GENERATE_APPCAST_BIN" >&2
  exit 1
}

echo "==> Creating Sparkle update archive"
rm -f "$ARCHIVE_PATH" "$UPDATES_ARCHIVE_PATH"
ditto -c -k --keepParent "$APP_BUNDLE" "$ARCHIVE_PATH"
cp "$ARCHIVE_PATH" "$UPDATES_ARCHIVE_PATH"

echo "==> Generating Sparkle appcast"
"$GENERATE_APPCAST_BIN" \
  --account "$SPARKLE_KEY_ACCOUNT" \
  --download-url-prefix "$SPARKLE_DOWNLOAD_URL_PREFIX" \
  -o "$APPCAST_PATH" \
  "$UPDATES_DIR"

cp "$APPCAST_PATH" "$DIST_SPARKLE_DIR/appcast.xml"

echo "==> Sparkle artifacts ready"
echo "    Archive: $ARCHIVE_PATH"
echo "    Appcast: $APPCAST_PATH"
