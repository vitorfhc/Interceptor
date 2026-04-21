#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(python3 -c "import json; print(json.load(open('$ROOT/extension/manifest.json'))['version'])")
DMG_NAME="Interceptor-v${VERSION}-macOS"
STAGING="$ROOT/dist/dmg-staging"
APP_SRC="$ROOT/dist/Interceptor.app"
UNINSTALL_SRC="$ROOT/scripts/uninstall.sh"
UNINSTALL_NAME="Uninstall Interceptor.command"
DMG_OUT="$ROOT/dist/${DMG_NAME}.dmg"

build_dmg_from_staging() {
  local staging="$1"
  local dmg_out="$2"
  local volume_name="$3"
  local hybrid_base="${dmg_out%.dmg}.hybrid"
  local hybrid_img="${hybrid_base}.dmg"

  rm -f "$hybrid_img" "$dmg_out"

  hdiutil makehybrid \
    -ov \
    -hfs \
    -hfs-volume-name "$volume_name" \
    -o "$hybrid_base" \
    "$staging" > /dev/null

  hdiutil convert "$hybrid_img" -format UDZO -o "$dmg_out" -ov > /dev/null
  rm -f "$hybrid_img"
}

[[ -d "$APP_SRC" ]] || bash "$ROOT/scripts/build-app.sh"
[[ -f "$UNINSTALL_SRC" ]] || { echo "ERROR: uninstall script missing: $UNINSTALL_SRC" >&2; exit 1; }

echo "==> Building Interceptor v${VERSION} DMG"
rm -rf "$STAGING" "$DMG_OUT"
mkdir -p "$STAGING"

ditto "$APP_SRC" "$STAGING/Interceptor.app"
cp "$UNINSTALL_SRC" "$STAGING/$UNINSTALL_NAME"
chmod +x "$STAGING/$UNINSTALL_NAME"
ln -s /Applications "$STAGING/Applications"

echo "==> Creating DMG..."
build_dmg_from_staging "$STAGING" "$DMG_OUT" "Interceptor"

echo ""
echo "==> DMG created: $DMG_OUT"
echo "    Size: $(du -h "$DMG_OUT" | cut -f1)"
echo ""
echo "    Install: open the DMG and drag 'Interceptor.app' into 'Applications'"
echo "    Uninstall: open the DMG and run '$UNINSTALL_NAME'"
