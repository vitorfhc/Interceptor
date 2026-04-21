#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"
APP_BUNDLE="$DIST_DIR/Interceptor.app"
PKG_OUT="$DIST_DIR/Interceptor.pkg"
UNSIGNED_PKG_OUT="$DIST_DIR/Interceptor-unsigned.pkg"
COMPONENT_PKG_OUT="$DIST_DIR/Interceptor-component.pkg"
SIGNING_ENV="$PROJECT_DIR/signing.env"
PKG_SCRIPTS_DIR="$PROJECT_DIR/scripts/pkg-scripts"
VERSION=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/extension/manifest.json'))['version'])")

resolve_installer_identity() {
  if [[ -n "${INSTALLER_SIGN_IDENTITY:-}" ]]; then
    printf '%s\n' "$INSTALLER_SIGN_IDENTITY"
    return 0
  fi

  local team
  team=$(printf '%s' "${SIGN_IDENTITY:-}" | sed -E 's/.*\(([A-Z0-9]+)\).*/\1/')
  if [[ -z "$team" ]]; then
    return 1
  fi

  security find-identity -v | sed -n 's/.*"\(Developer ID Installer: .*('"$team"')\)"/\1/p' | head -1
}

[[ -d "$APP_BUNDLE" ]] || bash "$SCRIPT_DIR/build-app.sh"
[[ -d "$PKG_SCRIPTS_DIR" ]] || { echo "ERROR: package scripts dir missing: $PKG_SCRIPTS_DIR" >&2; exit 1; }
chmod +x "$PKG_SCRIPTS_DIR"/postinstall

echo "==> Building Interceptor.pkg..."
rm -f "$PKG_OUT"
rm -f "$UNSIGNED_PKG_OUT"
rm -f "$COMPONENT_PKG_OUT"

ROOT_DIR="$(mktemp -d "$DIST_DIR/interceptor-pkg-root.XXXXXX")"
mkdir -p "$ROOT_DIR/Applications"
ditto "$APP_BUNDLE" "$ROOT_DIR/Applications/Interceptor.app"

if [[ -f "$SIGNING_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$SIGNING_ENV"
  INSTALLER_IDENTITY="$(resolve_installer_identity || true)"
  if [[ -n "$INSTALLER_IDENTITY" ]]; then
    echo "==> Signing package with: $INSTALLER_IDENTITY"
  else
    echo "==> No Developer ID Installer identity found — building unsigned package"
  fi
else
  echo "==> No signing.env found — building unsigned package"
fi

pkgbuild \
  --root "$ROOT_DIR" \
  --identifier "com.hackervalley.interceptor.component" \
  --version "$VERSION" \
  --install-location "/" \
  --scripts "$PKG_SCRIPTS_DIR" \
  "$COMPONENT_PKG_OUT"

productbuild \
  --package "$COMPONENT_PKG_OUT" \
  --identifier "com.hackervalley.interceptor.pkg" \
  --version "$VERSION" \
  "$UNSIGNED_PKG_OUT"

if [[ -n "${INSTALLER_IDENTITY:-}" ]]; then
  productsign --sign "$INSTALLER_IDENTITY" "$UNSIGNED_PKG_OUT" "$PKG_OUT"
  rm -f "$UNSIGNED_PKG_OUT"
else
  mv "$UNSIGNED_PKG_OUT" "$PKG_OUT"
fi

rm -rf "$ROOT_DIR"
rm -f "$COMPONENT_PKG_OUT"

if command -v pkgutil >/dev/null 2>&1; then
  pkgutil --check-signature "$PKG_OUT" || true
fi

echo "==> Built $PKG_OUT"
