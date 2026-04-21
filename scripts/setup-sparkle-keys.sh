#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPARKLE_SOURCE_DIR="${SPARKLE_SOURCE_DIR:-/Volumes/VRAM/80-89_Resources/80_Reference/research/Sparkle}"
SPARKLE_KEY_ACCOUNT="${SPARKLE_KEY_ACCOUNT:-interceptor-sparkle}"
DERIVED_DATA_DIR="${DERIVED_DATA_DIR:-$ROOT/.build/sparkle-tools}"
PUBLIC_KEY_FILE="$ROOT/sparkle/public-ed-key.txt"

[[ -d "$SPARKLE_SOURCE_DIR" ]] || {
  echo "ERROR: Sparkle source directory not found: $SPARKLE_SOURCE_DIR" >&2
  exit 1
}

mkdir -p "$(dirname "$PUBLIC_KEY_FILE")"

echo "==> Building Sparkle generate_keys tool"
xcodebuild \
  -project "$SPARKLE_SOURCE_DIR/Sparkle.xcodeproj" \
  -scheme generate_keys \
  -configuration Release \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  build > /dev/null

GENERATE_KEYS_BIN="$DERIVED_DATA_DIR/Build/Products/Release/generate_keys"
[[ -x "$GENERATE_KEYS_BIN" ]] || {
  echo "ERROR: generate_keys binary not found at $GENERATE_KEYS_BIN" >&2
  exit 1
}

echo "==> Ensuring Sparkle signing key exists for account '$SPARKLE_KEY_ACCOUNT'"
"$GENERATE_KEYS_BIN" --account "$SPARKLE_KEY_ACCOUNT" > /dev/null

PUBLIC_KEY="$("$GENERATE_KEYS_BIN" --account "$SPARKLE_KEY_ACCOUNT" -p)"
printf '%s\n' "$PUBLIC_KEY" > "$PUBLIC_KEY_FILE"

echo "==> Sparkle public key written to $PUBLIC_KEY_FILE"
