#!/bin/bash
set -euo pipefail

# ── Interceptor Installer ──────────────────────────────────────────────────────
# Native macOS dialogs via osascript. Installs a real Interceptor.app bundle
# that contains the CLI, daemon, and bridge in one place.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$ROOT/scripts/inject.py"
EXT_SRC="$ROOT/extension/dist"
RUNTIME_APP_SRC="$ROOT/Interceptor.app"
PLIST_SRC="$ROOT/launch/com.interceptor.bridge.plist"

INSTALL_DIR="$HOME/.interceptor"
APP_INSTALL_DIR="$HOME/Applications"
APP_DEST="$APP_INSTALL_DIR/Interceptor.app"
APP_BRIDGE="$APP_DEST/Contents/MacOS/Interceptor"
APP_CLI="$APP_DEST/Contents/Resources/bin/interceptor"
APP_DAEMON="$APP_DEST/Contents/Resources/bin/interceptor-daemon"
WRAPPER_DIR="$INSTALL_DIR/bin"
PLIST_DST="$HOME/Library/LaunchAgents/com.interceptor.bridge.plist"

create_wrapper() {
  local dst="$1"
  local target="$2"
  cat > "$dst" <<EOF
#!/bin/bash
exec "$target" "\$@"
EOF
  chmod +x "$dst"
}

wait_for_bridge() {
  for _ in {1..15}; do
    if [[ -S "/tmp/interceptor-bridge.sock" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

trust_field() {
  local field="$1"
  local json="$2"
  python3 - "$field" <<'PY' <<< "$json"
import json, sys

field = sys.argv[1]
try:
    data = json.load(sys.stdin)
    value = data.get("data", {}).get(field)
    if isinstance(value, bool):
        print("true" if value else "false")
    elif value is None:
        print("unknown")
    else:
        print(str(value).lower())
except Exception:
    print("unknown")
PY
}

run_permission_walkthrough() {
  if ! wait_for_bridge; then
    return 0
  fi

  local trust_json access screen mic choice msg

  while true; do
    trust_json=$("$APP_CLI" macos trust --json 2>/dev/null || printf '{}')
    access=$(trust_field "accessibility" "$trust_json")
    if [[ "$access" == "true" ]]; then
      break
    fi

    msg="Step 1 of 3 — Accessibility

Interceptor needs Accessibility to:
• inspect the AX tree
• send trusted clicks and typing
• manage native windows

Click Grant Accessibility to have macOS register Interceptor and open the Accessibility pane. After enabling it, click Re-check."
    choice=$(osascript -e "display dialog \"$msg\" buttons {\"Later\", \"Grant Accessibility\", \"Re-check\"} default button \"Grant Accessibility\" with title \"Interceptor Setup\"" 2>/dev/null | sed 's/button returned://')
    case "$choice" in
      "Grant Accessibility")
        "$APP_CLI" macos trust --accessibility-prompt --json >/dev/null 2>&1 || true
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true
        ;;
      "Re-check") ;;
      *) return 0 ;;
    esac
  done

  while true; do
    trust_json=$("$APP_CLI" macos trust --json 2>/dev/null || printf '{}')
    screen=$(trust_field "screenRecording" "$trust_json")
    if [[ "$screen" == "true" ]]; then
      break
    fi

    msg="Step 2 of 3 — Screen Recording

Interceptor uses Screen Recording for:
• screenshots
• OCR and Vision APIs
• visual capture features

Click Grant Screen Recording to show the macOS prompt. If macOS sends you to System Settings, enable Interceptor there, then click Re-check."
    choice=$(osascript -e "display dialog \"$msg\" buttons {\"Skip for Now\", \"Grant Screen Recording\", \"Re-check\"} default button \"Grant Screen Recording\" with title \"Interceptor Setup\"" 2>/dev/null | sed 's/button returned://')
    case "$choice" in
      "Grant Screen Recording")
        "$APP_CLI" macos trust --screen-prompt --json >/dev/null 2>&1 || true
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" 2>/dev/null || true
        ;;
      "Re-check") ;;
      *) break ;;
    esac
  done

  while true; do
    trust_json=$("$APP_CLI" macos trust --json 2>/dev/null || printf '{}')
    mic=$(trust_field "microphone" "$trust_json")
    if [[ "$mic" == "true" || "$mic" == "false" ]]; then
      break
    fi

    msg="Step 3 of 3 — Microphone (Optional)

Interceptor can use the microphone for:
• speech recognition
• voice activity detection

Click Grant Microphone if you want those features now, or Skip for Now to finish."
    choice=$(osascript -e "display dialog \"$msg\" buttons {\"Skip for Now\", \"Grant Microphone\"} default button \"Grant Microphone\" with title \"Interceptor Setup\"" 2>/dev/null | sed 's/button returned://')
    case "$choice" in
      "Grant Microphone")
        "$APP_CLI" macos trust --microphone-prompt --json >/dev/null 2>&1 || true
        ;;
      *) break ;;
    esac
  done

  trust_json=$("$APP_CLI" macos trust --json 2>/dev/null || printf '{}')
  access=$(trust_field "accessibility" "$trust_json")
  screen=$(trust_field "screenRecording" "$trust_json")
  mic=$(trust_field "microphone" "$trust_json")

  msg="Setup complete.

Current permission state:
• Accessibility: $access
• Screen Recording: $screen
• Microphone: $mic

You can revisit this any time with:
interceptor macos trust --walkthrough"
  osascript -e "display dialog \"$msg\" buttons {\"Done\"} default button \"Done\" with title \"Interceptor Setup\"" 2>/dev/null || true
}

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [[ ! -f "$INJECT" ]]; then
  osascript -e 'display alert "Interceptor" message "inject.py not found. Broken package." as critical'
  exit 1
fi
if [[ ! -d "$EXT_SRC" ]]; then
  osascript -e 'display alert "Interceptor" message "Extension files not found. Broken package." as critical'
  exit 1
fi
if [[ ! -d "$RUNTIME_APP_SRC" ]]; then
  osascript -e 'display alert "Interceptor" message "Interceptor.app not found in the package. Broken installer." as critical'
  exit 1
fi

mkdir -p "$WRAPPER_DIR" "$INSTALL_DIR/launch" "$APP_INSTALL_DIR"

# ── Install Interceptor.app + wrappers ────────────────────────────────────────
launchctl unload "$PLIST_DST" 2>/dev/null || true
pkill -f "/Interceptor.app/Contents/MacOS/Interceptor" 2>/dev/null || true

rm -rf "$APP_DEST"
ditto "$RUNTIME_APP_SRC" "$APP_DEST"
chmod +x "$APP_BRIDGE" "$APP_CLI" "$APP_DAEMON"

create_wrapper "$WRAPPER_DIR/interceptor" "$APP_CLI"
create_wrapper "$WRAPPER_DIR/interceptor-daemon" "$APP_DAEMON"
create_wrapper "$WRAPPER_DIR/interceptor-bridge" "$APP_BRIDGE"

if [[ -f "$PLIST_SRC" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  sed "s|/usr/local/bin/interceptor-bridge|$APP_BRIDGE|g" \
    "$PLIST_SRC" > "$INSTALL_DIR/launch/com.interceptor.bridge.plist"
  cp -f "$INSTALL_DIR/launch/com.interceptor.bridge.plist" "$PLIST_DST"
  launchctl load "$PLIST_DST" 2>/dev/null || true
fi

DAEMON="$APP_DAEMON"
BRIDGE_INSTALLED=1

# ── Question 1: Which browser? ────────────────────────────────────────────────
BROWSERS=()
BROWSER_LABELS=()
if [[ -d "/Applications/Brave Browser.app" ]]; then
  BROWSERS+=("brave")
  BROWSER_LABELS+=("Brave Browser")
fi
if [[ -d "/Applications/Google Chrome.app" ]]; then
  BROWSERS+=("chrome")
  BROWSER_LABELS+=("Google Chrome")
fi

if [[ ${#BROWSERS[@]} -eq 0 ]]; then
  osascript -e 'display alert "Interceptor" message "No supported browser found. Install Brave or Chrome first." as critical'
  exit 1
fi

if [[ ${#BROWSERS[@]} -eq 1 ]]; then
  BROWSER="${BROWSERS[0]}"
  BROWSER_LABEL="${BROWSER_LABELS[0]}"
else
  LIST_STR=$(printf '"%s", ' "${BROWSER_LABELS[@]}")
  LIST_STR="{${LIST_STR%, }}"
  CHOSEN=$(osascript -e "choose from list ${LIST_STR} with title \"Interceptor\" with prompt \"Select your browser:\" default items {\"${BROWSER_LABELS[0]}\"}" 2>/dev/null)
  if [[ "$CHOSEN" == "false" || -z "$CHOSEN" ]]; then
    exit 0
  fi
  if [[ "$CHOSEN" == "Brave Browser" ]]; then
    BROWSER="brave"
    BROWSER_LABEL="Brave Browser"
  else
    BROWSER="chrome"
    BROWSER_LABEL="Google Chrome"
  fi
fi

# ── Question 2: Which profile? ────────────────────────────────────────────────
PROFILE_DATA=$(python3 "$INJECT" --browser "$BROWSER" --profile dummy --extension-src "$EXT_SRC" --daemon-path "$DAEMON" --list-profiles 2>/dev/null || true)

if [[ -z "$PROFILE_DATA" ]]; then
  osascript -e "display alert \"Interceptor\" message \"No profiles found for $BROWSER_LABEL.\" as critical"
  exit 1
fi

PROFILE_DIRS=()
PROFILE_NAMES=()
while IFS=$'\t' read -r dir name; do
  PROFILE_DIRS+=("$dir")
  PROFILE_NAMES+=("$name")
done <<< "$PROFILE_DATA"

if [[ ${#PROFILE_DIRS[@]} -eq 0 ]]; then
  osascript -e "display alert \"Interceptor\" message \"No profiles found for $BROWSER_LABEL.\" as critical"
  exit 1
fi

if [[ ${#PROFILE_DIRS[@]} -eq 1 ]]; then
  PROFILE_DIR="${PROFILE_DIRS[0]}"
  PROFILE_NAME="${PROFILE_NAMES[0]}"
else
  DISPLAY_LIST=$(printf '"%s", ' "${PROFILE_NAMES[@]}")
  DISPLAY_LIST="{${DISPLAY_LIST%, }}"
  CHOSEN_PROFILE=$(osascript -e "choose from list ${DISPLAY_LIST} with title \"Interceptor\" with prompt \"Select profile for $BROWSER_LABEL:\" default items {\"${PROFILE_NAMES[0]}\"}" 2>/dev/null)
  if [[ "$CHOSEN_PROFILE" == "false" || -z "$CHOSEN_PROFILE" ]]; then
    exit 0
  fi
  PROFILE_DIR=""
  PROFILE_NAME="$CHOSEN_PROFILE"
  for i in "${!PROFILE_NAMES[@]}"; do
    if [[ "${PROFILE_NAMES[$i]}" == "$CHOSEN_PROFILE" ]]; then
      PROFILE_DIR="${PROFILE_DIRS[$i]}"
      break
    fi
  done
  if [[ -z "$PROFILE_DIR" ]]; then
    osascript -e 'display alert "Interceptor" message "Profile not found." as critical'
    exit 1
  fi
fi

# ── Confirm and close browser ─────────────────────────────────────────────────
case "$BROWSER" in
  brave)  BROWSER_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" ;;
  chrome) BROWSER_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ;;
esac

if pgrep -f "$BROWSER_BIN" >/dev/null 2>&1; then
  CONFIRM_MSG="$BROWSER_LABEL is currently open and needs to close for installation. Save any work, then click Install to continue."
else
  CONFIRM_MSG="Ready to install Interceptor into $BROWSER_LABEL ($PROFILE_NAME profile). $BROWSER_LABEL will open automatically when done."
fi

ANSWER=$(osascript -e "display dialog \"$CONFIRM_MSG\" buttons {\"Cancel\", \"Install\"} default button \"Install\" with title \"Interceptor\" with icon caution" 2>/dev/null | sed 's/button returned://')
if [[ "$ANSWER" != "Install" ]]; then
  exit 0
fi

if pgrep -f "$BROWSER_BIN" >/dev/null 2>&1; then
  osascript -e "tell application \"$BROWSER_LABEL\" to quit" 2>/dev/null || true
  for _ in {1..15}; do
    if ! pgrep -f "$BROWSER_BIN" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if pgrep -f "$BROWSER_BIN" >/dev/null 2>&1; then
    osascript -e "display alert \"Interceptor\" message \"Could not quit $BROWSER_LABEL. Please close it manually and try again.\" as critical"
    exit 1
  fi
fi

# ── Install with progress ─────────────────────────────────────────────────────
osascript -e 'display notification "Installing Interceptor extension..." with title "Interceptor"' 2>/dev/null || true

RESULT=$(python3 "$INJECT" \
  --browser "$BROWSER" \
  --profile "$PROFILE_DIR" \
  --extension-src "$EXT_SRC" \
  --daemon-path "$DAEMON" 2>&1)

if [[ "$RESULT" != "ok" ]]; then
  osascript -e "display alert \"Interceptor\" message \"Installation failed: $RESULT\" as critical"
  exit 1
fi

case "$BROWSER" in
  brave)  open -a "Brave Browser" ;;
  chrome) open -a "Google Chrome" ;;
esac

osascript -e 'display notification "Interceptor installed successfully! Your browser is starting." with title "Interceptor" sound name "Glass"' 2>/dev/null || true

if [[ "$BRIDGE_INSTALLED" == "1" ]]; then
  run_permission_walkthrough
fi

exit 0
