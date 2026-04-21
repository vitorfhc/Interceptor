#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

[[ -f signing.env ]] || { echo "ERROR: signing.env missing"; exit 1; }
[[ -f notarization.env ]] || { echo "ERROR: notarization.env missing"; exit 1; }
# shellcheck disable=SC1091
source signing.env
# shellcheck disable=SC1091
source notarization.env

: "${SIGN_IDENTITY:?SIGN_IDENTITY not set in signing.env}"
: "${NOTARY_PROFILE:?NOTARY_PROFILE not set in notarization.env}"

VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
DMG_OUT="$ROOT/dist/Interceptor-v${VERSION}-macOS.dmg"
APP_BUNDLE="$ROOT/dist/Interceptor.app"

ENT_PLIST="$ROOT/scripts/entitlements.plist"

sign_bun() {
  local bin="$1"
  local bundle_id="$2"
  [[ -f "$bin" ]] || { echo "    SKIP $bin (missing)"; return; }
  echo "    Signing $bin"
  codesign --force --options runtime --timestamp \
    --sign "$SIGN_IDENTITY" \
    --entitlements "$ENT_PLIST" \
    -i "$bundle_id" \
    "$bin"
  codesign --verify --verbose=1 "$bin" 2>&1 | sed 's/^/      /' | head -3
}

sign_native() {
  local bin="$1"
  local bundle_id="$2"
  [[ -f "$bin" ]] || { echo "    SKIP $bin (missing)"; return; }
  echo "    Signing $bin"
  codesign --force --options runtime --timestamp \
    --sign "$SIGN_IDENTITY" \
    -i "$bundle_id" \
    "$bin"
  codesign --verify --verbose=1 "$bin" 2>&1 | sed 's/^/      /' | head -3
}

echo "============================================================"
echo "  Interceptor v${VERSION} drag-install macOS release"
echo "============================================================"
echo "  App signing:       $SIGN_IDENTITY"
echo "  Notary profile:    $NOTARY_PROFILE"
echo "  Output DMG:        $DMG_OUT"
echo

echo "==> Phase 1/6: Build all components"
bash scripts/build.sh --target=macos

echo
echo "==> Phase 2/6: Sign standalone binaries"
sign_bun "$ROOT/dist/interceptor" "com.hackervalley.interceptor-cli"
sign_bun "$ROOT/daemon/interceptor-daemon" "com.hackervalley.interceptor-daemon"
sign_bun "$ROOT/dist/interceptor-setup" "com.hackervalley.interceptor-setup"
sign_native "$ROOT/dist/interceptor-bridge" "com.hackervalley.interceptor-bridge"

echo
echo "==> Phase 3/6: Assemble and sign Interceptor.app"
bash scripts/build-app.sh
codesign --verify --verbose=2 --deep --strict "$APP_BUNDLE" 2>&1 | sed 's/^/      /' | head -10

echo
echo "==> Phase 4/6: Build Sparkle update artifacts"
bash scripts/build-sparkle-artifacts.sh

echo
echo "==> Phase 5/6: Build, sign, and notarize DMG"
bash scripts/build-dmg.sh
codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG_OUT"
codesign --verify --verbose=1 "$DMG_OUT" 2>&1 | sed 's/^/      /' | head -3

xcrun notarytool submit "$DMG_OUT" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait
xcrun stapler staple "$DMG_OUT"

echo
echo "==> Phase 6/6: Verification"
echo "    --- app signature ---"
codesign -dvv "$APP_BUNDLE" 2>&1 | sed 's/^/      /' | head -12
echo "    --- dmg signature ---"
codesign -dvv "$DMG_OUT" 2>&1 | sed 's/^/      /' | head -12
echo "    --- sparkle artifacts ---"
test -f "$ROOT/dist/sparkle/Interceptor-${VERSION}.zip"
test -f "$ROOT/dist/sparkle/appcast.xml"
echo "      dist/sparkle/Interceptor-${VERSION}.zip"
echo "      dist/sparkle/appcast.xml"
if command -v syspolicy_check >/dev/null 2>&1; then
  echo "    --- syspolicy_check (distribution assessment) ---"
  syspolicy_check distribution "$DMG_OUT" 2>&1 | sed 's/^/      /'
else
  echo "    --- spctl (Gatekeeper assessment) ---"
  spctl --assess --type open -vv "$DMG_OUT" 2>&1 | sed 's/^/      /'
fi
echo "    --- stapler validate ---"
xcrun stapler validate "$DMG_OUT" 2>&1 | sed 's/^/      /'

echo
echo "============================================================"
echo "  ✓ Interceptor v${VERSION} release build complete"
echo "  → $DMG_OUT"
echo "============================================================"
