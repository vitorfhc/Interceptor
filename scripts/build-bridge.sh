#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BRIDGE_DIR="$PROJECT_DIR/interceptor-bridge"
DIST_DIR="$PROJECT_DIR/dist"

echo "==> Building interceptor-bridge (release)..."
cd "$BRIDGE_DIR"
swift build -c release 2>&1

BINARY="$BRIDGE_DIR/.build/release/interceptor-bridge"
if [ ! -f "$BINARY" ]; then
  echo "ERROR: Build failed — binary not found at $BINARY"
  exit 1
fi

mkdir -p "$DIST_DIR"
cp "$BINARY" "$DIST_DIR/interceptor-bridge"
echo "==> Copied to $DIST_DIR/interceptor-bridge"

ls -la "$DIST_DIR/interceptor-bridge"
echo "==> Build complete."
