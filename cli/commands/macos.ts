/**
 * cli/commands/macos.ts — interceptor macos <subcommand>
 *
 * Parses `interceptor macos` subcommands into macos_ prefixed action objects
 * that get routed to the native bridge via the daemon.
 */

import { existsSync } from "node:fs"
import { sendCommand, sendCommandWs, type DaemonResponse } from "../transport"

type Action = { type: string; [key: string]: unknown }
type Result = { success: boolean; error?: string; data?: unknown }

function unwrap(resp: DaemonResponse): Result {
  return resp.result
}

async function send(
  action: Action,
  tabId?: number,
  useWs = false
): Promise<Result> {
  try {
    const resp = useWs
      ? await sendCommandWs(action, tabId)
      : await sendCommand(action, tabId)
    return unwrap(resp)
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// Bridge preflight: detect browser-only installs and short-circuit before the
// daemon roundtrip times out at 15s with a misleading "Ensure Chrome/Brave"
// message. Returns a reason string if the bridge is unreachable, else null.
function bridgePreflightFailure(): string | null {
  if (process.platform !== "darwin") {
    return "'interceptor macos *' commands require macOS (the Swift bridge is mac-only)."
  }
  const home = process.env.HOME || ""
  // Two LaunchAgent locations depending on install channel: per-user (dev
  // path via scripts/install-bridge.sh) or system-wide (signed-pkg path via
  // Interceptor-Full-<v>.pkg). Either is sufficient.
  const launchAgentUser = `${home}/Library/LaunchAgents/com.interceptor.bridge.plist`
  const launchAgentSystem = "/Library/LaunchAgents/com.interceptor.bridge.plist"
  const bridgeSock = "/tmp/interceptor-bridge.sock"
  const bridgePid = "/tmp/interceptor-bridge.pid"
  const launchAgentInstalled = existsSync(launchAgentUser) || existsSync(launchAgentSystem)
  const bridgeReachable = existsSync(bridgeSock) || existsSync(bridgePid)
  if (!launchAgentInstalled && !bridgeReachable) {
    return [
      "'interceptor macos *' requires full computer-use mode.",
      "You're currently running in browser-only mode (no bridge installed).",
      "",
      "To enable:",
      "  interceptor upgrade --full",
    ].join("\n")
  }
  return null
}

export async function runMacosCommand(
  filtered: string[],
  opts: { jsonMode?: boolean; useWs?: boolean; globalTabId?: number }
): Promise<void> {
  // Skip preflight only for "trust" — that subcommand is the user-driven
  // first-run permission walkthrough and may legitimately be the very first
  // call before anything else is wired up. The bridge will surface its own
  // not-ready errors there.
  const sub = filtered[1]
  if (sub !== "trust") {
    const failure = bridgePreflightFailure()
    if (failure !== null) {
      console.error(`error: ${failure}`)
      process.exit(1)
    }
  }

  const action = parseMacosCommand(filtered)
  if (!action) process.exit(1)

  const result = await send(action, opts.globalTabId, opts.useWs)

  if (!result.success) {
    console.error("error:", result.error || "unknown error")
    process.exit(1)
  }

  if (opts.jsonMode) {
    console.log(JSON.stringify(result.data, null, 2))
  } else if (typeof result.data === "string") {
    console.log(result.data)
  } else if (result.data !== undefined && result.data !== null) {
    console.log(JSON.stringify(result.data, null, 2))
  } else {
    console.log("ok")
  }
}

export function parseMacosCommand(filtered: string[]): Action | null {
  const sub = filtered[1]
  if (!sub) {
    console.error("error: interceptor macos requires a subcommand. Examples:")
    console.error("  interceptor macos tree")
    console.error("  interceptor macos apps")
    console.error("  interceptor macos click e5")
    console.error("  interceptor macos trust")
    process.exit(1)
  }

  switch (sub) {
    // ── Accessibility ──
    case "tree":
      return {
        type: "macos_tree",
        app: flagVal(filtered, "--app"),
        pid: flagInt(filtered, "--pid"),
        filter: flagVal(filtered, "--filter") || "interactive",
        depth: flagInt(filtered, "--depth") || 10,
      }

    case "find": {
      const query = filtered[2]
      if (!query) { console.error("error: interceptor macos find requires a query"); process.exit(1) }
      return {
        type: "macos_find",
        query,
        app: flagVal(filtered, "--app"),
        role: flagVal(filtered, "--role"),
      }
    }

    case "inspect": {
      const ref = filtered[2]
      if (ref && !ref.startsWith("--")) return { type: "macos_inspect", ref }
      return {
        type: "macos_compound",
        sub: "inspect",
        app: flagVal(filtered, "--app"),
        pid: flagInt(filtered, "--pid"),
      }
    }

    case "value": {
      const ref = filtered[2]
      if (!ref) { console.error("error: interceptor macos value requires a ref"); process.exit(1) }
      const newValue = filtered[3]
      return { type: "macos_value", ref, ...(newValue !== undefined && { value: newValue }) }
    }

    case "action": {
      const ref = filtered[2]
      if (!ref) { console.error("error: interceptor macos action requires a ref"); process.exit(1) }
      const actionName = filtered[3] || "press"
      return { type: "macos_action", ref, action: actionName }
    }

    case "focused":
      return { type: "macos_focused", app: flagVal(filtered, "--app") }

    case "windows":
      return { type: "macos_windows", app: flagVal(filtered, "--app") }

    // ── Text ──
    case "text": {
      const ref = filtered[2]
      if (!ref) { console.error("error: interceptor macos text requires a ref"); process.exit(1) }
      const mode = filtered.includes("--selection") ? "selection" : filtered.includes("--visible") ? "visible" : "full"
      return { type: "macos_text", ref, mode }
    }

    // ── Menu ──
    case "menu": {
      const items = collectPositionals(filtered, 2, new Set(["--app", "--pid"]))
      return {
        type: "macos_menu",
        ...(items.length > 0 && { items }),
        app: flagVal(filtered, "--app"),
        pid: flagInt(filtered, "--pid"),
      }
    }

    // ── Update (Sparkle) ──
    case "update": {
      const op = filtered[2] || "status"
      return {
        type: "macos_update",
        sub: op,
      }
    }

    // ── Trust ──
    case "trust": {
      // --no-prompt is defense-in-depth for read-only consumers: when set,
      // every prompt-triggering flag is forced false in the wire payload so
      // a future caller-side bug cannot accidentally modify TCC state.
      const noPrompt = filtered.includes("--no-prompt")
      return {
        type: "macos_trust",
        noPrompt,
        prompt: !noPrompt && (filtered.includes("--prompt") || filtered.includes("--walkthrough")),
        walkthrough: !noPrompt && filtered.includes("--walkthrough"),
        accessibilityPrompt: !noPrompt && filtered.includes("--accessibility-prompt"),
        screenPrompt: !noPrompt && filtered.includes("--screen-prompt"),
        microphonePrompt: !noPrompt && filtered.includes("--microphone-prompt"),
      }
    }

    // ── Apps ──
    case "apps":
      return { type: "macos_apps" }

    case "app": {
      const subcommand = filtered[2] || "activate"
      const appName = flagVal(filtered, "--app") || filtered[3]
      return {
        type: "macos_app",
        subcommand,
        app: appName,
        pid: flagInt(filtered, "--pid"),
        bundleId: subcommand === "launch" ? (filtered[3] || flagVal(filtered, "--bundle")) : undefined,
      }
    }

    case "frontmost":
      return { type: "macos_frontmost" }

    // ── Input ──
    case "click": {
      const target = filtered[2]
      if (!target) { console.error("error: interceptor macos click requires a ref or coordinates"); process.exit(1) }
      const isCoords = target.includes(",")
      const action: Action = {
        type: "macos_click",
        ...(isCoords ? { coords: target } : { ref: target }),
        double: filtered.includes("--double"),
        right: filtered.includes("--right"),
      }
      // Optional --app / --pid flow through to the bridge so synthesized
      // CGEvents post via CGEvent.postToPid instead of the system HID
      // tap, keeping the click background-only.
      const clickApp = flagVal(filtered, "--app")
      const clickPid = flagInt(filtered, "--pid")
      if (clickApp) action.app = clickApp
      if (clickPid !== undefined) action.pid = clickPid
      return action
    }

    case "type": {
      const refOrText = filtered[2]
      if (!refOrText) { console.error("error: interceptor macos type requires text or ref + text"); process.exit(1) }
      const action: Action = /^e\d+$/.test(refOrText) && filtered[3]
        ? { type: "macos_type", ref: refOrText, text: filtered[3] }
        : { type: "macos_type", text: refOrText }
      const typeApp = flagVal(filtered, "--app")
      const typePid = flagInt(filtered, "--pid")
      if (typeApp) action.app = typeApp
      if (typePid !== undefined) action.pid = typePid
      return action
    }

    case "keys": {
      const combo = filtered[2]
      if (!combo) { console.error("error: interceptor macos keys requires a key combo"); process.exit(1) }
      const action: Action = { type: "macos_keys", keys: combo }
      const keysApp = flagVal(filtered, "--app")
      const keysPid = flagInt(filtered, "--pid")
      if (keysApp) action.app = keysApp
      if (keysPid !== undefined) action.pid = keysPid
      return action
    }

    case "scroll": {
      const direction = filtered[2] || "down"
      const amount = parseInt(filtered[3] || "300")
      const action: Action = {
        type: "macos_scroll",
        direction,
        amount: isNaN(amount) ? 300 : amount,
        ref: flagVal(filtered, "--ref"),
      }
      // --pid <pid> or --app <name> routes scroll to a specific process
      // via CGEvent.postToPid — works on occluded / minimized windows
      // without changing focus.
      const pid = flagInt(filtered, "--pid")
      const targetApp = flagVal(filtered, "--app")
      const times = flagInt(filtered, "--times")
      const intervalMs = flagInt(filtered, "--interval-ms")
      if (pid !== undefined) action.pid = pid
      if (targetApp) action.app = targetApp
      if (times !== undefined) action.times = times
      if (intervalMs !== undefined) action.intervalMs = intervalMs
      return action
    }

    case "resize": {
      const ref = filtered[2]
      const width = flagInt(filtered, "--width") || parseInt(filtered[3]) || undefined
      const height = flagInt(filtered, "--height") || parseInt(filtered[4]) || undefined
      if (!ref) { console.error("error: interceptor macos resize requires a ref"); process.exit(1) }
      return { type: "macos_resize", ref, width, height }
    }

    case "move": {
      const ref = filtered[2]
      const x = flagInt(filtered, "--x") || parseInt(filtered[3]) || 0
      const y = flagInt(filtered, "--y") || parseInt(filtered[4]) || 0
      if (!ref) { console.error("error: interceptor macos move requires a ref"); process.exit(1) }
      return { type: "macos_move", ref, x, y }
    }

    case "drag": {
      const from = filtered[2]
      const to = filtered[3]
      if (!from || !to) { console.error("error: interceptor macos drag requires from and to refs or coords"); process.exit(1) }
      const fromIsCoords = from.includes(",")
      const toIsCoords = to.includes(",")
      const action: Action = fromIsCoords && toIsCoords
        ? { type: "macos_drag", fromCoords: from, toCoords: to }
        : { type: "macos_drag", from, to }
      const dragApp = flagVal(filtered, "--app")
      const dragPid = flagInt(filtered, "--pid")
      if (dragApp) action.app = dragApp
      if (dragPid !== undefined) action.pid = dragPid
      return action
    }

    // ── Screenshot / Capture ──
    case "screenshot": {
      // Capture-time optimizations: target_max_long_edge resize at capture,
      // WebP encoding, save-strips-dataUrl, --mode display for full-screen.
      const action: Action = {
        type: "macos_screenshot",
        app: flagVal(filtered, "--app"),
        display: flagInt(filtered, "--display"),
        window: flagInt(filtered, "--window"),
        save: filtered.includes("--save"),
        format: flagVal(filtered, "--format") || "jpeg",
        quality: flagInt(filtered, "--quality") || 80,
        element: flagVal(filtered, "--element"),
        cwd: process.cwd(),
      }
      const mode = flagVal(filtered, "--mode")
      if (mode) action.mode = mode
      // --full-screen is a friendlier alias for --mode display
      if (filtered.includes("--full-screen") || filtered.includes("--display-mode")) {
        action.mode = "display"
      }
      const targetMaxLongEdge = flagInt(filtered, "--target-max-long-edge")
      if (targetMaxLongEdge !== undefined) {
        action.target_max_long_edge = targetMaxLongEdge
      } else if (flagVal(filtered, "--target-max-long-edge") === "0") {
        // Explicit "no resize" — keep full pixel resolution (legacy behavior).
        action.target_max_long_edge = 0
      }
      return action
    }

    case "capture": {
      const op = filtered[2] || "frame"
      const action: Action = {
        type: "macos_capture",
        sub: op,
        app: flagVal(filtered, "--app"),
      }
      // `capture frame` blocks briefly waiting for the next sample buffer
      // when the stream is active but hasn't ticked yet. Default 1000ms;
      // override with --timeout-ms.
      const timeoutMs = flagInt(filtered, "--timeout-ms")
      if (timeoutMs !== undefined) action.timeoutMs = timeoutMs
      return action
    }

    // ── Speech ──
    case "listen": {
      const op = filtered[2] || "status"
      return {
        type: "macos_listen",
        sub: op,
        device: flagVal(filtered, "--device"),
      }
    }

    case "vad": {
      const op = filtered[2] || "status"
      return { type: "macos_vad", sub: op }
    }

    // ── Sound ──
    case "sounds": {
      const op = filtered[2] || "status"
      return {
        type: "macos_sounds",
        sub: op,
        filter: flagVal(filtered, "--filter"),
      }
    }

    // ── Vision ──
    case "vision": {
      const op = filtered[2] || "text"
      return {
        type: "macos_vision",
        sub: op,
        app: flagVal(filtered, "--app"),
      }
    }

    // ── NLP ──
    case "nlp": {
      const op = filtered[2]
      if (!op) { console.error("error: interceptor macos nlp requires a subcommand (entities, language, sentiment, tokens, similar, embed)"); process.exit(1) }
      const text = filtered[3]
      return {
        type: `macos_nlp`,
        sub: op,
        text,
        word1: op === "similar" ? filtered[3] : undefined,
        word2: op === "similar" ? filtered[4] : undefined,
      }
    }

    // ── Intelligence ──
    case "ai": {
      const op = filtered[2] || "status"
      const prompt = filtered[3]
      return {
        type: "macos_ai",
        sub: op,
        prompt,
      }
    }

    // ── Sensitive ──
    case "sensitive": {
      const op = filtered[2] || "check"
      return {
        type: "macos_sensitive",
        sub: op,
        app: flagVal(filtered, "--app"),
      }
    }

    // ── Health ──
    case "health": {
      const op = filtered[2] || "status"
      return { type: "macos_health", sub: op }
    }

    // ── Files ──
    case "files": {
      const op = filtered[2] || "recent"
      const path = filtered[3]
      return {
        type: "macos_files",
        sub: op,
        path,
        filter: flagVal(filtered, "--filter"),
        app: flagVal(filtered, "--app"),
        limit: flagInt(filtered, "--limit"),
      }
    }

    // ── Notifications ──
    case "notifications": {
      const op = filtered[2] || "tail"
      return {
        type: "macos_notifications",
        sub: op,
        app: flagVal(filtered, "--app"),
        limit: flagInt(filtered, "--limit"),
      }
    }

    // ── Clipboard ──
    case "clipboard": {
      const op = filtered[2] || "read"
      const text = op === "write" ? filtered[3] : undefined
      return {
        type: "macos_clipboard",
        sub: op,
        text,
        contentType: flagVal(filtered, "--type"),
        image: flagVal(filtered, "--image"),
        limit: flagInt(filtered, "--limit"),
      }
    }

    // ── Display ──
    case "display": {
      const op = filtered[2] || "list"
      const resolution = filtered[3]
      return {
        type: "macos_display",
        sub: op,
        resolution,
        id: flagVal(filtered, "--id") || filtered[3],
        hidpi: filtered.includes("--hidpi"),
        hz: flagInt(filtered, "--hz"),
      }
    }

    // ── Audio ──
    case "audio": {
      const channel = filtered[2] || "output"
      const op = filtered[3] || "start"
      return {
        type: "macos_audio",
        sub: channel,
        op,
        app: flagVal(filtered, "--app"),
        device: flagVal(filtered, "--device"),
        save: filtered.includes("--save"),
      }
    }

    // ── Stream ──
    case "stream": {
      const op = filtered[2] || "status"
      return {
        type: "macos_stream",
        op,
        sid: flagVal(filtered, "--sid") || filtered[3],
        app: flagVal(filtered, "--app"),
        display: flagInt(filtered, "--display"),
        virtual: flagVal(filtered, "--virtual"),
        format: flagVal(filtered, "--format"),
      }
    }

    // ── Monitor ──
    case "monitor": {
      const op = filtered[2] || "status"
      return {
        type: "macos_monitor",
        sub: op,
        sid: flagVal(filtered, "--sid") || (op === "export" ? filtered[3] : undefined),
        instruction: flagVal(filtered, "--instruction"),
        format: filtered.includes("--json") ? "json" : filtered.includes("--plan") ? "plan" : "timeline",
        raw: filtered.includes("--raw"),
        limit: flagInt(filtered, "--limit"),
      }
    }

    // ── Compound Commands ──
    case "open": {
      const appName = filtered[2] || flagVal(filtered, "--app")
      // Background-first by default; --activate is the
      // explicit opt-in for "bring this app to the foreground."
      const activate = filtered.includes("--activate")
      return {
        type: "macos_compound",
        sub: "open",
        app: appName,
        pid: flagInt(filtered, "--pid"),
        filter: flagVal(filtered, "--filter") || "interactive",
        depth: flagInt(filtered, "--depth") || 10,
        activate,
      }
    }

    case "read": {
      return {
        type: "macos_compound",
        sub: "read",
        app: flagVal(filtered, "--app"),
        pid: flagInt(filtered, "--pid"),
        filter: flagVal(filtered, "--filter") || "interactive",
        depth: flagInt(filtered, "--depth") || 10,
      }
    }

    case "act": {
      const target = filtered[2]
      if (!target) { console.error("error: interceptor macos act requires a ref"); process.exit(1) }
      const text = filtered[3]
      return {
        type: "macos_compound",
        sub: "act",
        ref: target,
        text,
        app: flagVal(filtered, "--app"),
        pid: flagInt(filtered, "--pid"),
      }
    }

    // ── Filesystem (FsDomain) ──
    case "fs": {
      const fsSub = filtered[2]
      if (!fsSub) {
        console.error("error: interceptor macos fs requires a subcommand: read | write | search")
        process.exit(1)
      }
      switch (fsSub) {
        case "read": {
          const path = filtered[3]
          if (!path) { console.error("error: interceptor macos fs read requires a path"); process.exit(1) }
          const action: Action = {
            type: "macos_fs_read",
            path,
            encoding: flagVal(filtered, "--encoding") || "utf8",
          }
          const range = flagVal(filtered, "--byte-range")
          if (range) {
            const [s, l] = range.split(",").map((v) => parseInt(v, 10))
            if (!isNaN(s) && !isNaN(l)) action.byteRange = { start: s, length: l }
          }
          return action
        }
        case "write": {
          const path = filtered[3]
          if (!path) { console.error("error: interceptor macos fs write requires a path"); process.exit(1) }
          const action: Action = { type: "macos_fs_write", path }
          const content = flagVal(filtered, "--content")
          const base64 = flagVal(filtered, "--base64")
          if (content !== undefined) action.content = content
          if (base64 !== undefined) { action.content = base64; action.encoding = "base64" }
          if (filtered.includes("--append")) action.append = true
          return action
        }
        case "search": {
          const query = filtered[3]
          if (!query) { console.error("error: interceptor macos fs search requires a query"); process.exit(1) }
          return {
            type: "macos_fs_search",
            query,
            scope: flagVal(filtered, "--scope"),
            limit: flagInt(filtered, "--limit") || 50,
          }
        }
        default:
          console.error(`error: unknown 'fs' subcommand '${fsSub}'. Use: read | write | search`)
          process.exit(1)
      }
    }

    // ── URL fetch (NetDomain) ──
    case "url": {
      const urlSub = filtered[2]
      if (!urlSub) {
        console.error("error: interceptor macos url requires a subcommand: get | post")
        process.exit(1)
      }
      const target = filtered[3]
      if (!target) { console.error(`error: interceptor macos url ${urlSub} requires a URL`); process.exit(1) }
      const headers: Record<string, string> = {}
      // Collect every --header "K: V" pair
      for (let i = 0; i < filtered.length - 1; i++) {
        if (filtered[i] === "--header" || filtered[i] === "-H") {
          const raw = filtered[i + 1]
          const m = /^([^:]+):\s*(.*)$/.exec(raw)
          if (m) headers[m[1].trim()] = m[2]
        }
      }
      const action: Action = {
        type: "macos_url_fetch",
        url: target,
        method: urlSub === "post" ? "POST" : (flagVal(filtered, "--method") || "GET").toUpperCase(),
        headers,
        timeoutMs: flagInt(filtered, "--timeout") || 30000,
      }
      const body = flagVal(filtered, "--body")
      if (body !== undefined) action.body = body
      const ct = flagVal(filtered, "--content-type")
      if (ct) (action.headers as Record<string, string>)["Content-Type"] = ct
      return action
    }

    // ── Log query (LogDomain) ──
    case "log": {
      const logSub = filtered[2]
      if (logSub !== "query") {
        console.error("error: interceptor macos log requires the 'query' subcommand")
        process.exit(1)
      }
      let predicate = flagVal(filtered, "--predicate")
      const subsystem = flagVal(filtered, "--subsystem")
      const category = flagVal(filtered, "--category")
      // Build a predicate from --subsystem / --category if no explicit one
      if (!predicate) {
        const parts: string[] = []
        if (subsystem) parts.push(`subsystem == "${subsystem}"`)
        if (category) parts.push(`category == "${category}"`)
        if (parts.length) predicate = parts.join(" AND ")
      }
      return {
        type: "macos_log_query",
        predicate,
        since: flagVal(filtered, "--since"),
        limit: flagInt(filtered, "--limit") || 100,
        includeInfo: filtered.includes("--include-info"),
        includeDebug: filtered.includes("--include-debug"),
      }
    }

    // ── app_intent (Apple Events / IntentDomain) ──
    case "intent": {
      const intentSub = filtered[2]
      if (!intentSub) {
        console.error("error: interceptor macos intent requires a subcommand: dispatch | warmup")
        process.exit(1)
      }
      switch (intentSub) {
        case "dispatch": {
          const action: Action = { type: "macos_intent_dispatch" }
          const script = flagVal(filtered, "--script")
          const javascript = flagVal(filtered, "--javascript")
          const bundleId = flagVal(filtered, "--bundle")
          const intent = flagVal(filtered, "--intent")
          const target = flagVal(filtered, "--target")
          const params = flagVal(filtered, "--params")
          const argsRaw = flagVal(filtered, "--args")

          if (script !== undefined) action.script = script
          if (javascript !== undefined) action.javascript = javascript
          if (bundleId !== undefined) action.bundleId = bundleId
          if (intent !== undefined) action.intent = intent
          if (target !== undefined) action.target = target
          if (params !== undefined) {
            try { action.parameters = JSON.parse(params) }
            catch { console.error("error: --params must be JSON"); process.exit(1) }
          }
          if (argsRaw !== undefined) {
            try { action.args = JSON.parse(argsRaw) }
            catch {
              // Allow space-separated raw form
              action.args = argsRaw.split(" ").filter(Boolean)
            }
          }
          if (!script && !javascript && !bundleId) {
            console.error("error: macos intent dispatch requires one of --script, --javascript, or --bundle")
            process.exit(1)
          }
          return action
        }
        case "warmup": {
          const bundleIds = filtered.slice(3).filter((s) => !s.startsWith("--"))
          if (bundleIds.length === 0) {
            console.error("error: interceptor macos intent warmup requires one or more bundle ids")
            process.exit(1)
          }
          return { type: "macos_intent_warmup", bundleIds }
        }
        default:
          console.error(`error: unknown 'intent' subcommand '${intentSub}'. Use: dispatch | warmup`)
          process.exit(1)
      }
    }

    // ── container_run (ContainerDomain) ──
    case "container": {
      const containerSub = filtered[2]
      if (containerSub !== "run") {
        console.error("error: interceptor macos container requires the 'run' subcommand")
        process.exit(1)
      }
      const image = filtered[3]
      if (!image) {
        console.error("error: interceptor macos container run requires an image (e.g. docker.io/library/alpine:3)")
        process.exit(1)
      }
      const cmd = flagVal(filtered, "--cmd")
      const command: string[] = cmd ? cmd.split(" ").filter(Boolean) : []
      const env: Record<string, string> = {}
      const mounts: Array<Record<string, unknown>> = []
      for (let i = 0; i < filtered.length - 1; i++) {
        if (filtered[i] === "--env") {
          const raw = filtered[i + 1]
          const m = /^([^=]+)=(.*)$/.exec(raw)
          if (m) env[m[1]] = m[2]
        }
        if (filtered[i] === "--volume" || filtered[i] === "-v") {
          const raw = filtered[i + 1]
          // host:container[:mode]
          const parts = raw.split(":")
          if (parts.length >= 2) {
            mounts.push({
              hostPath: parts[0],
              mountPath: parts[1],
              mode: parts[2] || "ro",
            })
          }
        }
      }
      return {
        type: "macos_container_run",
        image,
        command,
        network: flagVal(filtered, "--network") || "off",
        env,
        mounts,
        timeoutMs: flagInt(filtered, "--timeout") || 60000,
      }
    }

    // ── Overlays (OverlayDomain) ──
    case "overlay": {
      const overlaySub = filtered[2]
      if (!overlaySub) {
        console.error("error: interceptor macos overlay requires a subcommand: start | stop | list | status | eval | ctl | verbs")
        process.exit(1)
      }
      switch (overlaySub) {
        case "start": {
          const action: Action = { type: "macos_overlay_start" }
          const id = flagVal(filtered, "--id")
          const level = flagVal(filtered, "--level")
          const particles = flagVal(filtered, "--particles")
          const scene = flagVal(filtered, "--scene")
          const sceneScript = flagVal(filtered, "--scene-script")
          const url = flagVal(filtered, "--url")
          const htmlB64 = flagVal(filtered, "--html-b64")
          const rect = flagVal(filtered, "--rect")
          const timeout = flagInt(filtered, "--timeout-seconds")
          const density = flagInt(filtered, "--density")
          const lifetime = flagInt(filtered, "--lifetime")
          const anchor = flagVal(filtered, "--anchor")

          if (id) action.id = id
          if (level) action.level = level
          if (filtered.includes("--interactive")) action.interactive = true
          if (filtered.includes("--no-interactive")) action.interactive = false
          if (filtered.includes("--single-space")) action.single_space = true
          if (filtered.includes("--no-fullscreen-aux")) action.no_fullscreen_aux = true
          if (timeout !== undefined) action.timeout_seconds = timeout
          if (anchor) action.anchor = anchor

          if (particles) action.particles = particles
          if (density !== undefined) action.density = density
          if (lifetime !== undefined) action.lifetime = lifetime
          if (scene) action.scene = scene
          if (sceneScript) action.scene_script = sceneScript
          if (url) action.url = url
          if (htmlB64) action.html_b64 = htmlB64

          if (rect) {
            const [x, y, w, h] = rect.split(",").map((v) => parseFloat(v))
            if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h)) {
              action.rect = { x, y, width: w, height: h }
            }
          }

          if (!particles && !scene && !sceneScript && !url && !htmlB64) {
            console.error("error: overlay start requires one of --particles, --scene, --scene-script, --url, --html-b64")
            process.exit(1)
          }
          return action
        }
        case "stop": {
          const id = filtered[3]
          const action: Action = { type: "macos_overlay_stop" }
          if (id) action.id = id
          return action
        }
        case "list":
          return { type: "macos_overlay_list" }
        case "status": {
          const id = filtered[3]
          const action: Action = { type: "macos_overlay_status" }
          if (id) action.id = id
          return action
        }
        case "eval": {
          const id = filtered[3]
          const js = filtered[4]
          if (!id || !js) { console.error("error: overlay eval requires <id> <javascript>"); process.exit(1) }
          return { type: "macos_overlay_eval", id, javascript: js }
        }
        case "ctl": {
          const id = filtered[3]
          const verb = filtered[4]
          if (!id || !verb) { console.error("error: overlay ctl requires <id> <verb> [args]"); process.exit(1) }
          const action: Action = { type: "macos_overlay_ctl", id, verb }
          // Remaining --foo bar pairs become args
          const args: Record<string, unknown> = {}
          for (let i = 5; i < filtered.length - 1; i++) {
            if (filtered[i].startsWith("--")) {
              const key = filtered[i].slice(2)
              const val = filtered[i + 1]
              const numeric = parseFloat(val)
              args[key] = !isNaN(numeric) && /^-?[\d.]+$/.test(val) ? numeric : val
            }
          }
          if (Object.keys(args).length) action.args = args
          return action
        }
        case "verbs": {
          const id = filtered[3]
          const action: Action = { type: "macos_overlay_verbs" }
          if (id) action.id = id
          return action
        }
        default:
          console.error(`error: unknown 'overlay' subcommand '${overlaySub}'. Use: start | stop | list | status | eval | ctl | verbs`)
          process.exit(1)
      }
    }

    default:
      console.error(`error: unknown macos subcommand '${sub}'. Run 'interceptor help' for usage.`)
      process.exit(1)
  }
}

// ── Flag helpers ──

function flagVal(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1 || !args[idx + 1]) return undefined
  return args[idx + 1]
}

function flagInt(args: string[], flag: string): number | undefined {
  const val = flagVal(args, flag)
  if (val === undefined) return undefined
  const n = parseInt(val)
  return isNaN(n) ? undefined : n
}

function collectPositionals(args: string[], startIndex: number, flagsWithValues = new Set<string>()): string[] {
  const values: string[] = []
  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i]
    if (flagsWithValues.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith("--")) continue
    values.push(arg)
  }
  return values
}
