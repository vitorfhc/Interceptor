---
name: interceptor-macos
description: Use when the agent should drive native macOS applications via `interceptor macos *` — read accessibility trees, click and type with OS-level trusted input, capture occluded / minimized / cross-Space windows, run on-device speech / vision / NLP, dispatch Apple Events to background apps, monitor and replay native flows. Stay background-first unless the user asks for activation. This skill covers the macOS surface only; for content inside a browser tab use `interceptor-browser`.
---

<!--
Reserved namespace: `.agents/skills/interceptor-windows/` is reserved for a future
Windows surface (UIA, Win32 input, ETW). It does not exist yet — do not stub it.
When it ships it will be a peer of this skill with the same shape.
-->

# Interceptor macOS

This is an agent-operator skill for the macOS surface of Interceptor. Use the `interceptor macos *` CLI to drive native macOS applications: AX trees, OS-level trusted input, capture / vision / speech / NLP / Apple Events, monitor-and-replay, overlays. For content inside a browser tab load `interceptor-browser` instead.

The macOS bridge is a Swift daemon launched as a LaunchAgent / `.app` bundle. It links Apple frameworks only (Accessibility, ScreenCaptureKit, AVFoundation, Speech, Vision, NaturalLanguage, OSLogStore, NSAppleScript, container runtime). No private APIs.

## Fast Path

1. Run `interceptor status` and `interceptor macos trust` — confirm the bridge socket is alive and the right TCC permissions are granted.
2. Prefer the compound surface:

```bash
interceptor macos open "Finder"      # Tree + windows (background-first; pass --activate to foreground)
interceptor macos read               # Tree + frontmost app info
interceptor macos act e5             # Click + wait + updated tree (AX press → no focus change)
interceptor macos act e3 "hello"     # Type + wait + updated tree (AX value-set → no focus change)
interceptor macos inspect            # Tree + apps + frontmost info
```

3. Treat `eN` refs as short-lived. AXObserver auto-invalidates the tree when the app changes; re-read before acting.

## The One Rule

**Only two commands are allowed to move focus:** `interceptor macos app activate <app>` and `interceptor macos open <app> --activate`. Everything else is background-first by contract — including `open` without `--activate`, all input verbs, all reads, capture, AX, menu, intent dispatch, scroll, drag, vision, and overlays. If you call any other command and the user's frontmost app changes, that is a bug — file it.

## Background First (default contract)

When the user names a specific app ("screenshot of Brave", "scroll Signal", "open a tab in Brave"), **do the work without bringing it to the foreground unless the task strictly requires it.** Never reach for `interceptor macos app activate`, never insert `activate` into AppleScript blocks, never `--mode display`-screenshot a backgrounded app's window.

| Want to do | Background path | No focus change? |
|---|---|---|
| Capture an occluded / minimized / cross-Space window | `interceptor macos screenshot --app "X"` (uses `CGSHWCaptureWindowList`) | ✅ |
| Read AX tree of an Electron app (Slack/Discord/Cursor/Brave/Notion/VS Code) | `interceptor macos tree --app "X"` (auto-wakes via `AXManualAccessibility`) | ✅ |
| Open URL in a specific browser | `interceptor macos intent dispatch --bundle <id> --script 'open location "..."'` | ✅ Apple Events deliver without raising |
| Read the active tab URL of Brave/Chrome/Safari | `interceptor macos intent dispatch --bundle <id> --script '... URL of active tab ...'` | ✅ |
| Scroll a backgrounded app | `interceptor macos scroll <dir> <amount> --app "X" --times <N>` (routes via `postToPid`) | ✅ for Cocoa & most Electron; Chromium-occluded apps may need brief raise |
| Move / resize a backgrounded window | `interceptor macos move/resize "X"` via AX | ✅ |
| Click / type / drag against a non-frontmost native app | `interceptor macos act <ref>` (AX press / value-set) or `... --app "X"` (PID-routed CGEvent) | ✅ |

**Reflexes to drop:** `interceptor macos app activate` is not a precondition for capture, AX read, scroll, type, or Apple Events. Skip it. The user's focused window stays where it was.

**When the user explicitly says "bring it forward / show me / switch to"**: respect that. Activate, do the operation, leave it there (or return to previous frontmost if asked).

### Background-First Contract (current as of 0.10.12)

`interceptor macos open` and the synthesized-input verbs (`click`, `type`, `keys`, `drag`) are background-first by default. Foregrounding is opt-in via `--activate` on `open`, or via the explicit `app activate` command.

**Compound `open`:**

```bash
interceptor macos open "Finder"               # background — does NOT raise Finder
interceptor macos open "Finder" --activate    # explicit foregrounding (NSWorkspace.OpenConfiguration.activates = true)
```

When the target app is **already running**, the bridge does literally nothing in the launch path and proceeds straight to AX reads. This is deliberate: per Apple docs, calling `NSWorkspace.openApplication(at:configuration:)` for an already-running app delivers a `kAEOpenApplication` Apple Event, and standard AppKit apps respond by self-activating. `OpenConfiguration.activates = false` only suppresses the *system's* activation pass — it does NOT stop the app's own self-activation reflex. The only truly background-safe behavior for a running target is to skip the launch call entirely.

When the target app is **not yet running**, the bridge resolves the app URL through a directed search of `/Applications`, `/System/Applications`, `/System/Applications/Utilities`, and `~/Applications`, then calls `NSWorkspace.openApplication(at:configuration:)` with `activates = false` and `addsToRecentItems = false`. Note: AppKit apps may still self-activate during a cold launch — this is platform behavior we cannot suppress for not-running targets. If you need a guaranteed background launch, use `interceptor macos intent dispatch --bundle <id> --script 'launch'` and let the Apple Event open the app without the open-document reflex.

**Input verbs with `--app` / `--pid`:**

```bash
interceptor macos click 100,200 --app "TextEdit"   # CGEvent.postToPid(pid_t)
interceptor macos type "hello" --app "TextEdit"    # AX value-set first; else postToPid keys
interceptor macos keys "Meta+A" --pid 1234         # postToPid
interceptor macos drag 100,100 200,200 --app X     # postToPid
```

When `--app` or `--pid` is provided, the bridge posts events directly to that PID via `CGEvent.postToPid(pid_t)`. The events do not need the target to be frontmost. When neither is provided, the bridge falls back to `cghidEventTap` (system-wide HID, follows the user's frontmost app — legacy "drive whatever's visible" semantics preserved).

**Refs always route to AX first.** `interceptor macos act <ref>`, `click <ref>`, `type <ref>` use `AXUIElementPerformAction(kAXPressAction)` and `AXUIElementSetAttributeValue(kAXValueAttribute, ...)` directly when possible, bypassing CGEvents and never moving focus. AX value-set is gated to text-bearing roles: `AXTextField`, `AXTextArea`, `AXSearchField`, `AXComboBox`. Other roles fall back to synthesized key events posted via `postToPid` of the ref's owning PID.

**Verifying it actually worked.** Each input verb returns a routing tag in its success message:
- `"ax-pressed ref"` — pure AX press, no event posting.
- `"ax-set value (N chars)"` — AX value-set, no event posting.
- `"clicked at (x, y) → pid=NNNN"` — synthesized CGEvent posted to a specific PID.
- `"clicked at (x, y) → frontmost"` — synthesized CGEvent on the system HID tap (legacy fallback).

If you see `→ frontmost` when you expected per-PID delivery, the target wasn't resolvable and the call hit the legacy fallback — pass `--app` or `--pid`.

**Worked example — type into a backgrounded TextEdit while another app stays frontmost:**

```bash
# Whatever's frontmost stays frontmost. We populate TextEdit silently.
interceptor macos open "TextEdit"                                # no activation; reads AX state
interceptor macos focused --app "TextEdit"                       # → ref e1 = AXTextArea
interceptor macos type e1 "hello, background world"              # → "ax-set value (21 chars)"
interceptor macos value e1                                       # confirms text landed
interceptor macos frontmost                                      # unchanged
```

### Background-Safe Verb Inventory

Every command in this table has been live-verified to leave frontmost untouched. Tested directly with `interceptor macos frontmost` before/after each call.

| Verb | Background-safe? | Notes |
|---|---|---|
| `open <app>` (no `--activate`) | ✅ | No-op if running; documented background-first launch otherwise |
| `read --app <app>` | ✅ | Pure AX read |
| `tree --app <app>` | ✅ | Pure AX read; sets `AXManualAccessibility` only (NOT `AXEnhancedUserInterface` — that one foregrounded AppKit apps and was removed) |
| `windows --app <app>` | ✅ | Pure AX read |
| `focused --app <app>` | ✅ | Pure AX read |
| `find --app <app>` | ✅ | Pure AX read |
| `inspect <ref>` / `inspect --app <app>` | ✅ | Pure AX read |
| `value <ref>` | ✅ | Pure AX read |
| `act <ref>` | ✅ | AX press; no CGEvent |
| `act <ref> "text"` | ✅ | AX value-set; no CGEvent |
| `click <ref>` | ✅ | AX press first; PID-routed CGEvent fallback |
| `click x,y --app <app>` | ✅ | `CGEvent.postToPid` |
| `type <ref> "..."` | ✅ | AX value-set first; PID-routed keys fallback |
| `type "..." --app <app>` | ✅ | AX value-set if focused on text role; else PID-routed keys |
| `keys "..." --app <app>` | ✅ | `CGEvent.postToPid` |
| `keys "..." --pid <n>` | ✅ | `CGEvent.postToPid` |
| `drag --app <app>` | ✅ | `CGEvent.postToPid` |
| `scroll <dir> <n> --app <app>` | ✅ | `CGEvent.postToPid` (with optional Chromium wake) |
| `screenshot --app <app>` | ✅ | `CGSHWCaptureWindowList` — works on occluded / minimized / cross-Space windows |
| `intent dispatch --bundle <id>` | ✅ | Apple Events deliver without raising |
| `menu --app <app>` (list / invoke) | ✅ | AX |
| `app hide / unhide / quit` | ✅ | Pure lifecycle operations |
| `app activate <app>` | ❌ by design | This command's contract IS to foreground |
| `open <app> --activate` | ❌ by design | This is the explicit opt-in |
| `click x,y` (no `--app`/`--pid`) | ❌ by design | Legacy "drive frontmost" mode |
| `type "..."` (no `--app`/`--pid`/ref) | ❌ by design | Legacy "drive frontmost" mode |
| `keys "..."` (no `--app`/`--pid`) | ❌ by design | Legacy "drive frontmost" mode |

## Read Hierarchy

1. Compound: `interceptor macos open "X"`, `interceptor macos read`, `interceptor macos inspect`.
2. AX tree narrows: `tree`, `find`, `focused`, `value`, `action`, `windows`, `inspect <ref>`.
3. App / window control: `apps`, `app activate/hide/quit/launch`, `frontmost`, `move`, `resize`.
4. Capture: `screenshot --app "X"`, `capture start/frame/stop`, `stream start/frame/stop`.
5. Audio intelligence: `listen`, `vad`, `sounds`, `audio output/input`.
6. Vision / NLP / Intelligence: `vision text/faces/hands/bodies`, `nlp entities/sentiment/language`, `ai prompt`.
7. Cross-app routing: `intent dispatch --bundle <id> --script <applescript>`, `intent warmup`.
8. System reads: `notifications tail`, `clipboard read/write/tail`, `files watch`, `fs read/write/search`, `url get/post`, `log query`.
9. Overlays: `overlay *` — panic hotkey `Ctrl+Opt+Cmd+Escape` always available.
10. Recording: `monitor start/stop/tail/export [--plan]`.

## Daily-Driver Domains

The five daily-driver domains an agent reaches for repeatedly:

- **Accessibility (AX)** — `tree`, `find`, `inspect`, `value`, `action`, `windows`, `focused`. See `references/accessibility-and-input.md`.
- **Input** — `click`, `type`, `keys`, `scroll`, `drag`. CGEvent-trusted. Auto-escalates from AX action to coordinate click when AX action fails. See `references/accessibility-and-input.md`.
- **Capture** — `screenshot`, `capture`. ScreenCaptureKit + `CGSHWCaptureWindowList` for occluded windows. See `references/capture-and-vision.md`.
- **Monitor** — record native flows, export replay plan. See `references/monitor-and-replay.md`.
- **Clipboard** — `clipboard read/write/tail`.

## Specialized Domains

Everything else the bridge supports — same agent-first contract, used less frequently. *Tiering means presentation, not deprecation; every domain is fully supported.*

- Apps & Windows (`apps`, `app *`, `frontmost`)
- Menu Traversal (`menu`)
- Audio (system + microphone capture)
- Speech & VAD (`listen`, `vad`)
- Sound Classification (`sounds`)
- Vision (`vision faces/text/hands/bodies`)
- NLP (`nlp entities/sentiment/language`)
- Apple Intelligence (`ai prompt`, macOS 26+)
- Notifications (`notifications tail`)
- Trust & Permissions (`trust`)
- Files & Filesystem (`files`, `fs`)
- URL Fetch (`url get/post`)
- Log Query (`log query`)
- Apple Events (`intent dispatch/warmup`)
- Container Runtime (`container run`, macOS 26+)
- Display & Streaming (`display`, `stream`)
- Text (`text` — selection / visible / full from frontmost app)
- Overlays (particles / titans / scene-script / HTML HUD)

See `references/advanced-domains.md` for the deep dive on each.

## Permissions

- Run `interceptor macos trust` — returns current grant status with deep links to System Settings.
- Run `interceptor macos trust --no-prompt` when you want a guaranteed read-only snapshot — every prompt-triggering flag is forced false even if accidentally set.
- Run `interceptor macos trust --prompt` to fire all three TCC prompts at once. Non-blocking — Microphone returns `not_determined` plus `pending_user_action: ["Microphone"]` until the user answers; re-poll trust to observe the resolved state.
- Run `interceptor macos trust --walkthrough` to prompt + auto-open the next missing Privacy pane.
- Per-permission flags exist for narrow flows: `--accessibility-prompt`, `--screen-prompt`, `--microphone-prompt`.
- Treat `interceptor macos trust` as a permission snapshot, not a runtime-health check. Use `interceptor status` to confirm the bridge socket is live before debugging native runtime failures.
- For packaged installs, `/Applications/Interceptor.app` owns helper registration and privacy onboarding. `interceptor macos trust` reports app-owned trust state, not proof that a shell-launched probe will succeed.
- For microphone-sensitive workflows, verify the live path with `interceptor macos audio input start/stop` after trust looks good.

### Response shape

Every permission carries a `status` string drawn from Apple's `AVAuthorizationStatus` vocabulary:

| Status | Meaning | Where it can appear |
|---|---|---|
| `granted` | User authorized | All three permissions |
| `denied` | User declined (or never asked, on AX/Screen — Apple does not distinguish) | All three permissions |
| `not_determined` | User has not yet been prompted | **Microphone only** (Apple's `AXIsProcessTrusted` / `CGPreflightScreenCaptureAccess` return `Bool` only) |
| `restricted` | System policy blocks user from changing it | **Microphone only** |

AX and Screen Recording entries carry a `limitation` field documenting that 2-state asymmetry. Microphone entries do not — its status is fully expressive.

The legacy `granted: bool` field is still emitted for one release (computed from `status == "granted"`) for backward compatibility. Migrate to `status`.

### Worked example: re-poll the microphone after a prompt

```bash
interceptor macos trust --microphone-prompt --json   # returns immediately
# response: { "microphone": "not_determined", "pending_user_action": ["Microphone"], ... }

# user clicks Allow on the system prompt at their leisure...

interceptor macos trust --json                       # re-poll
# response: { "microphone": "granted", ... }
```

This contract matches Apple's documented `requestAccess(for:completionHandler:)` semantics: "Calling this method doesn't block the thread while the system is prompting the user for access."

### Why the mic prompt briefly shows a Dock icon

When `--microphone-prompt` (or `--prompt` / `--walkthrough` / `--prompt-with-microphone-permission`) fires for the first time, you'll see `interceptor-bridge` flash into the Dock for a few seconds. That is intentional. The bridge ships as `LSUIElement = true` (background-only); without temporarily upgrading `NSApp.setActivationPolicy(.regular)`, macOS surfaces the Microphone permission alert as a *transient banner* that auto-dismisses to "denied" before most users see it. The bridge upgrades to `.regular` immediately before `AVCaptureDevice.requestAccess`, then reverts to `.accessory` in the completion handler — same canonical pattern Hammerspoon, Bartender, and Karabiner-Elements use. Accessibility and Screen Recording prompts do NOT need this treatment because their alert/Settings flows are window-server-level and don't depend on the calling app's activation policy.

### Microphone capture writes a real file

`interceptor macos audio input start --save` writes a CoreAudio Format file to `/tmp/interceptor-audio-input-<unix-ts>.caf` using `AVAudioEngine.inputNode` + `AVAudioFile`. The response payload's `filePath` field returns the same path on both `start` and `stop`, so callers don't need to grep `/tmp`. Format is whatever the default input device negotiates (typically `2 ch, 48000 Hz, Float32, interleaved`). Same API path Parrot uses; same TCC anchor (`com.apple.security.device.audio-input` entitlement, `NSMicrophoneUsageDescription` in Info.plist).

| Permission | Required | Enables |
|---|---|---|
| Accessibility | Yes | AX tree, input, window management |
| Screen Recording | Optional | Screenshots, capture, stream, vision |
| Microphone | Optional | Speech recognition, VAD, sound classification |
| Input Monitoring | Optional | `monitor` global key/click capture |

If `interceptor macos *` reports `Interceptor bridge not running` or `connection closed before response`, the helper lifecycle is unhealthy even if `trust` says permissions are granted.

## Safety

- **Panic hotkey** — `Ctrl+Opt+Cmd+Escape` closes every active overlay regardless of owning session. Bridge-side handler.
- **Sensitive frontmost-app gate** — `mac_type`, `mac_keys`, `mac_click(coords)`, `mac_drag` are rejected when the frontmost app's bundle ID is on the denylist (Keychain, 1Password, Dashlane, LastPass, Bitwarden, System Settings, Chase, Bank of America, Wells Fargo). Extend per environment via `SENSITIVE_BUNDLE_IDS`.
- **Permission tiers** — Allow (observational): AX reads, app reads, screenshot, vision, NLP, clipboard read, capture, audio, sounds, speech, scroll, overlays. Ask (interactive): click, type, keys, drag, app quit/hide, clipboard write. Deny: none by default.
- **Stop control** — Active overlays do NOT block session completion. Session shutdown tears down every overlay owned by the session. Engine crash recovery marks orphan overlays `closed_reason=crash`.

## Background Recipes

```bash
# Screenshot of Brave's current window — Brave stays where it was
interceptor macos screenshot --app "Brave Browser" --save --target-max-long-edge 1568

# Open a tab in Brave without bringing Brave to front
interceptor macos intent dispatch --bundle com.brave.Browser \
  --script 'tell application "Brave Browser" to tell front window to make new tab with properties {URL:"https://example.com"}'

# Read the active tab URL/title from Brave (no focus change)
interceptor macos intent dispatch --bundle com.brave.Browser \
  --script 'tell application "Brave Browser" to URL of active tab of front window'

# Read AX tree of Cursor (Electron — wake-up automatic) without activating it
interceptor macos tree --app "Cursor" --filter interactive --depth 6

# Scroll Mail down 5 times while another app stays focused
interceptor macos scroll down 400 --app "Mail" --times 5 --interval-ms 80

# Type into a backgrounded TextEdit while Codex stays frontmost
REF=$(interceptor macos focused --app "TextEdit" --json | jq -r '.ref')
interceptor macos type "$REF" "background-only edit"      # → "ax-set value (...)"
interceptor macos value "$REF"                             # confirm landed
```

## Pitfalls (what went wrong before, why it's fixed)

Earlier bridge versions had three documented foregrounding leaks. They are all fixed in 0.10.12. If you ever see frontmost change unexpectedly in a future build, suspect one of these classes of bug:

- **`AXEnhancedUserInterface = true` on the app element.** This is the AppKit "VoiceOver is active" flag, not just a Chromium tree-build signal. AppKit apps respond by raising their main window. The bridge now sets only `AXManualAccessibility` (the Chromium-specific signal) in `wakeAXTree`. Never set `AXEnhancedUserInterface` from a background-first reader.
- **`NSWorkspace.openApplication(at:configuration:)` with `activates = false` against an already-running app.** Per Apple docs the `activates` flag only suppresses the *system's* activation pass; the receiving app still self-activates in response to `kAEOpenApplication` / `kAEOpenDocuments`. The bridge therefore never calls `openApplication` for a running target — the running-app branch is a strict no-op.
- **Deprecated `NSWorkspace.fullPath(forApplication:)` falling through to deprecated `launchApplication(_:)`.** That fallback always foregrounds and has no configuration knob. The bridge now resolves URLs via `urlForApplication(withBundleIdentifier:)` plus a directed walk of `/Applications`, `/System/Applications`, `/System/Applications/Utilities`, `~/Applications`, and fails closed if nothing matches.

There's also one platform constraint we cannot suppress: launching a not-running AppKit app from cold via `openApplication` may still self-activate via the `kAEOpenApplication` reflex. If you need a guaranteed-background cold launch, skip `open` and use `interceptor macos intent dispatch --bundle <id>` to deliver a custom Apple Event, or accept that cold launches inherently raise.

## When To Switch Surfaces

If the target is **content inside a browser tab** — DOM, page network traffic, scene graph (Canva / Docs / Slides), webapp recording — load `interceptor-browser` instead. The macOS surface cannot read inside a page; the AX tree of a Chrome window stops at the tab strip.

| Task | Stay on macOS | Switch to interceptor-browser |
|---|---|---|
| Click / type in a native app | ✅ default | — |
| Read native AX tree | ✅ default | — |
| Capture occluded / minimized / cross-Space window | ✅ `screenshot --app "X"` | — |
| Native dialogs / Save-Open / file pickers | ✅ | ❌ |
| Browser chrome (URL bar, bookmark menu, profile picker) | ✅ | ❌ |
| Cross-app routing (Notes → Slack, Mail → Brave) | ✅ | ❌ |
| Click / type on a webpage | — | ✅ |
| Read DOM, network, SPA state | — | ✅ |
| Drive Canva / Google Docs / Google Slides scene | — | ✅ |

**Decision rule of thumb:**
- **Anything outside the page** → macOS (this skill)
- **Page content** → `interceptor-browser`
- **App-level operation on a backgrounded target** → stay in background; don't activate.
- **The user's words win.** "Open in Brave" = open in Brave (not just any browser). "Don't bring it up" = stay in the background.

## Open References

- [`references/accessibility-and-input.md`](references/accessibility-and-input.md) — AX tree usage, refs, find/inspect/value/action, input layer (CGEvent escalation).
- [`references/capture-and-vision.md`](references/capture-and-vision.md) — ScreenCaptureKit / CGSHWCaptureWindowList capture, vision (OCR / faces / hands / bodies), audio intelligence.
- [`references/monitor-and-replay.md`](references/monitor-and-replay.md) — native monitor sessions, AX-annotated event format, replay plan generation.
- [`references/advanced-domains.md`](references/advanced-domains.md) — specialized domains: Apple Events, Container, Log query, Fs, Notifications, NLP, Apple Intelligence, Overlays, Display, Stream, URL fetch.
