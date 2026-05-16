import { HELP, helpForCommand } from "./help"
import { parseTabFlag } from "./parse"
import { formatState, formatTabs, formatCookies, formatResult } from "./format"
import { sendCommand, sendCommandWs, type DaemonResult, type DaemonResponse } from "./transport"
import { fromPassive, writeExport, type PassiveNetEntry, type ExportFormat } from "../shared/exports"
import { ensureDaemon } from "./daemon-spawn"
import { parseStateCommand } from "./commands/state"
import { parseActionsCommand } from "./commands/actions"
import { parseNavigationCommand } from "./commands/navigation"
import { parseTabsCommand } from "./commands/tabs"
import { parseNetworkCommand } from "./commands/network"
import { parseScreenshotCommand } from "./commands/screenshot"
import { parseDataCommand } from "./commands/data"
import { parseMetaCommand } from "./commands/meta"
import { parseEvalCommand } from "./commands/eval"
import { parseBatchCommand } from "./commands/batch"
import { parseMonitorCommand } from "./commands/monitor"
import { parseSceneCommand } from "./commands/scene"
import { parseSseCommand } from "./commands/sse"
import { runCompoundCommand } from "./commands/compound"
import { runOverride } from "./commands/override"
import { runMacosCommand } from "./commands/macos"
import { runUpgradeCommand } from "./commands/upgrade"
import { runInitCommand } from "./commands/init"
import { VERSION, BUILD_SHA, BUILD_DATE } from "./version"

// Command → module routing
const STATE_CMDS = new Set(["state", "tree", "diff", "find", "text", "html"])
const ACTION_CMDS = new Set(["click", "type", "select", "focus", "blur", "hover", "drag", "dblclick", "rightclick", "check", "keys", "click-at", "what-at", "regions"])
const NAV_CMDS = new Set(["navigate", "back", "forward", "scroll", "wait", "wait-stable", "wait_for"])
const TAB_CMDS = new Set(["tabs", "tab", "window", "frames", "session"])
const NET_CMDS = new Set(["network", "net", "headers"])
const SS_CMDS = new Set(["screenshot", "canvas", "capture"])
const DATA_CMDS = new Set(["cookies", "storage", "history", "bookmarks", "downloads", "clear", "clipboard"])
const META_CMDS = new Set(["status", "reload", "meta", "links", "images", "forms", "info", "page_info", "query", "exists", "count", "table", "attr", "style", "events", "search", "notify", "sessions", "capabilities", "modals", "panels"])
const EVAL_CMDS = new Set(["eval"])
const BATCH_CMDS = new Set(["batch", "raw"])
const MONITOR_CMDS = new Set(["monitor"])
const SCENE_CMDS = new Set(["scene"])
const SSE_CMDS = new Set(["sse"])
const COMPOUND_CMDS = new Set(["open", "read", "act", "inspect"])
const OVERRIDE_CMDS = new Set(["override"])
const MACOS_CMDS = new Set(["macos"])
const UPGRADE_CMDS = new Set(["upgrade"])
const INIT_CMDS = new Set(["init"])

// Commands that don't require a daemon connection (or, in init's case,
// bootstrap it themselves rather than relying on the pre-dispatch auto-spawn).
const NO_DAEMON = new Set(["status", "help", "events", "session", "upgrade", "init"])

// Every command the CLI dispatches. Used to reject unknown commands
// before any daemon-spawning side effect runs.
const ALL_KNOWN_CMDS = new Set<string>([
  ...STATE_CMDS, ...ACTION_CMDS, ...NAV_CMDS, ...TAB_CMDS, ...NET_CMDS,
  ...SS_CMDS, ...DATA_CMDS, ...META_CMDS, ...EVAL_CMDS,
  ...BATCH_CMDS, ...MONITOR_CMDS, ...SCENE_CMDS, ...SSE_CMDS,
  ...COMPOUND_CMDS, ...OVERRIDE_CMDS, ...MACOS_CMDS,
  ...UPGRADE_CMDS, ...INIT_CMDS,
  "help",
])

// Monitor subcommands that are handled locally (no daemon needed)
const MONITOR_LOCAL_SUBCOMMANDS = new Set(["tail", "list", "export"])

function unwrapResult(response: DaemonResponse): DaemonResult {
  return response.result
}

async function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes("--json")
  // Screenshot responses can carry tens-to-hundreds of KB of base64
  // dataUrl payloads. Native-messaging port-based responses for that size
  // are unreliable on Brave/Chromium (messages are silently dropped despite
  // the documented 1MB native-messaging limit). The WebSocket transport does
  // not exhibit this issue, so we auto-route screenshot through it.
  const isScreenshotCmd = args[0] === "screenshot"
  const useWs = args.includes("--ws") || (isScreenshotCmd && !args.includes("--no-ws"))
  const anyTab = args.includes("--any-tab")
  const globalTabId = parseTabFlag(args)

  // Build filtered args (strip global flags). NB: --json is dual-purpose —
  // it can be a global "emit JSON output" boolean OR a domain-specific
  // value flag (e.g. `translate batch --json '["a","b"]'`). Disambiguate
  // by position: `--json` at index 0 or 1 is the global boolean (it's
  // always near the front, like `interceptor --json status`); deeper
  // occurrences are always domain value flags consumed by the parser.
  const tabIdx = args.indexOf("--tab")
  const tabFilterSet = new Set(["--ws", "--any-tab"])
  if (tabIdx !== -1) { tabFilterSet.add("--tab"); if (args[tabIdx + 1]) tabFilterSet.add(args[tabIdx + 1]) }
  const filtered = args.filter((a, i) => {
    if (tabFilterSet.has(a)) return false
    if (a === "--json") return i > 1
    return true
  })

  if (filtered.length === 0 || filtered[0] === "help") {
    console.log(HELP)
    return
  }

  // --version / -V short-circuit. Runs before any daemon-spawn side effect.
  if (filtered[0] === "--version" || filtered[0] === "-V") {
    if (jsonMode) {
      console.log(JSON.stringify({
        name: "interceptor",
        version: VERSION,
        sha: BUILD_SHA,
        buildDate: BUILD_DATE,
      }))
    } else {
      console.log(`interceptor ${VERSION} (${BUILD_SHA}, ${BUILD_DATE})`)
    }
    return
  }

  // Per-command --help / -h short-circuit. `interceptor open --help` prints
  // the open-specific help block; `interceptor --help` (no command) falls
  // back to the full HELP. Runs before any daemon-spawn side effect.
  if (filtered.includes("--help") || filtered.includes("-h")) {
    const sub = helpForCommand(filtered[0])
    if (sub) {
      console.log(sub)
    } else {
      console.log(HELP)
    }
    return
  }

  const cmd = filtered[0]

  if (!ALL_KNOWN_CMDS.has(cmd)) {
    console.error(`error: unknown command '${cmd}'. Run 'interceptor help' for usage.`)
    process.exit(1)
  }

  let needsDaemon = !NO_DAEMON.has(cmd)
  if (cmd === "monitor" && filtered[1] && MONITOR_LOCAL_SUBCOMMANDS.has(filtered[1])) {
    needsDaemon = false
  }

  if (needsDaemon && !useWs) {
    await ensureDaemon()
  }

  // Dispatch to command module
  let action: { type: string; [key: string]: unknown } | null

  if (MACOS_CMDS.has(cmd)) {
    await runMacosCommand(filtered, { jsonMode, useWs, globalTabId })
    return
  }

  if (UPGRADE_CMDS.has(cmd)) {
    await runUpgradeCommand(filtered)
    return
  }

  if (INIT_CMDS.has(cmd)) {
    await runInitCommand(filtered)
    return
  }

  if (COMPOUND_CMDS.has(cmd)) {
    await runCompoundCommand(cmd, filtered, { jsonMode, useWs, globalTabId, anyTab })
    return
  }

  if (OVERRIDE_CMDS.has(cmd)) {
    await runOverride(filtered, { jsonMode, useWs, globalTabId })
    return
  }

  if (STATE_CMDS.has(cmd))       action = parseStateCommand(filtered)
  else if (ACTION_CMDS.has(cmd)) action = parseActionsCommand(filtered)
  else if (NAV_CMDS.has(cmd))    action = parseNavigationCommand(filtered)
  else if (TAB_CMDS.has(cmd))    action = await parseTabsCommand(filtered)
  else if (NET_CMDS.has(cmd))    action = parseNetworkCommand(filtered)
  else if (SS_CMDS.has(cmd))     action = parseScreenshotCommand(filtered)
  else if (DATA_CMDS.has(cmd))   action = parseDataCommand(filtered)
  else if (META_CMDS.has(cmd))   action = await parseMetaCommand(filtered, jsonMode)
  else if (EVAL_CMDS.has(cmd))   action = parseEvalCommand(filtered)
  else if (BATCH_CMDS.has(cmd))  action = parseBatchCommand(filtered)
  else if (MONITOR_CMDS.has(cmd)) action = await parseMonitorCommand(filtered, jsonMode)
  else if (SCENE_CMDS.has(cmd))   action = await parseSceneCommand(filtered, jsonMode)
  else if (SSE_CMDS.has(cmd))     action = parseSseCommand(filtered)
  else {
    // Unreachable: ALL_KNOWN_CMDS guard above rejects unknown commands
    // before this dispatch chain runs.
    console.error(`error: unhandled command '${cmd}'`)
    process.exit(1)
  }

  // null means the command handled its own output (status, events, session)
  if (action === null) return

  if (action && action.type === "sse_tail") {
    const filter = (action.filter as string) || ""
    const timeout = (action.timeout as number) || 60000
    const startTime = Date.now()
    let offset = 0
    let lastActive = true

    while (Date.now() - startTime < timeout) {
      try {
        const chunkAction = { type: "sse_chunk", filter, since: offset }
        const resp = useWs
          ? await sendCommandWs(chunkAction, globalTabId)
          : await sendCommand(chunkAction, globalTabId)
        const result = unwrapResult(resp)
        if (result?.success && result.data) {
          const d = result.data as { active: boolean; text?: string; offset?: number }
          if (d.text) {
            process.stdout.write(d.text)
            offset = d.offset || offset
          }
          if (!d.active && lastActive) {
            // stream ended
            break
          }
          lastActive = d.active
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200))
    }
    process.exit(0)
  }

  // Apply global modifiers
  if (anyTab) action.anyTab = true
  if (filtered.includes("--changes")) action.changes = true
  const frameIdx = args.indexOf("--frame")
  if (frameIdx !== -1 && args[frameIdx + 1]) {
    action.frameId = parseInt(args[frameIdx + 1])
  }

  try {
    const response = useWs
      ? await sendCommandWs(action, globalTabId)
      : await sendCommand(action, globalTabId)
    const result = unwrapResult(response)

    // Screenshot save-to-disk post-processing
    if (result.success && result.data && typeof result.data === "object" &&
        (result.data as Record<string, unknown>).save &&
        (result.data as Record<string, unknown>).dataUrl) {
      const d = result.data as Record<string, unknown>
      const dataUrl = d.dataUrl as string
      const base64 = dataUrl.split(",")[1]
      const formatStr = d.format as string
      const ext = formatStr === "png" ? "png" : formatStr === "webp" ? "webp" : "jpg"
      const filename = `interceptor-screenshot-${Date.now()}.${ext}`
      const bytes = Buffer.from(base64, "base64")
      await Bun.write(filename, bytes)
      d.filePath = `${process.cwd()}/${filename}`
      delete d.save
      delete d.dataUrl
      process.stderr.write(`saved: ${d.filePath}\n`)
    }

    // Net-log export: route through the new format pipeline when --format is set
    // and not the default text. Text remains on the existing formatResult path.
    if (action.type === "net_log" && result.success && action.format && action.format !== "text") {
      const format = action.format as ExportFormat
      const entries = (result.data as PassiveNetEntry[] | undefined) || []
      const captures = fromPassive(entries)
      try {
        await writeExport({
          format,
          captures,
          meta: {
            generatorName: "interceptor",
            generatorVersion: VERSION,
            generatedAt: new Date(),
            source: "net-log",
            comment: `net log buffer dump (${captures.length} entries)`,
          },
          out: action.out as string | undefined,
        })
        // pcapng with --out: also report saved path. har/json with --out: same. Both go to stderr so stdout stays clean.
        if (action.out) process.stderr.write(`saved: ${action.out}\n`)
      } catch (err) {
        console.error(`error: ${(err as Error).message}`)
        process.exit(1)
      }
      return
    }

    // Pretty-print known result types
    if (!jsonMode && result.success) {
      if (action.type === "get_state") {
        console.log(formatState(result.data as Parameters<typeof formatState>[0]))
        return
      }
      if (action.type === "tab_list") {
        console.log(formatTabs(result.data as Parameters<typeof formatTabs>[0]))
        return
      }
      if (action.type === "cookies_get") {
        console.log(formatCookies(result.data as Parameters<typeof formatCookies>[0]))
        return
      }
    }

    console.log(formatResult(result, jsonMode))
  } catch (err) {
    console.error(`error: ${(err as Error).message}`)
    process.exit(1)
  }
}

main()
