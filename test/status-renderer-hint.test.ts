import { describe, expect, test } from "bun:test"
import { computeBridgeHint } from "../cli/lib/status-renderer"

describe("computeBridgeHint", () => {
  test("bridge alive — no hint", () => {
    const hint = computeBridgeHint({
      bridge: true,
      mode: "full",
      launchAgentInstalled: true,
      launchAgentLoaded: true,
      launchAgentPath: "/Library/LaunchAgents/com.interceptor.bridge.plist",
    })
    expect(hint).toEqual([])
  })

  test("plist on disk but NOT bootstrapped — emits launchctl bootstrap hint (the bug this fix targets)", () => {
    const plistPath = "/Library/LaunchAgents/com.interceptor.bridge.plist"
    const hint = computeBridgeHint({
      bridge: false,
      mode: "full",
      launchAgentInstalled: true,
      launchAgentLoaded: false,
      launchAgentPath: plistPath,
    })
    const joined = hint.join("\n")
    expect(joined).toContain("launchctl bootstrap")
    expect(joined).toContain(plistPath)
    expect(joined).toContain("NOT bootstrapped")
    expect(joined).toContain("log out and back in")
  })

  test("plist on disk, bootstrapped, bridge dead — emits kickstart hint (existing behavior)", () => {
    const hint = computeBridgeHint({
      bridge: false,
      mode: "full",
      launchAgentInstalled: true,
      launchAgentLoaded: true,
      launchAgentPath: "/Library/LaunchAgents/com.interceptor.bridge.plist",
    })
    const joined = hint.join("\n")
    expect(joined).toContain("kickstart")
    expect(joined).not.toContain("launchctl bootstrap")
  })

  test("user-scoped plist path is reflected in the bootstrap hint", () => {
    const userPlist = "/Users/tester/Library/LaunchAgents/com.interceptor.bridge.plist"
    const hint = computeBridgeHint({
      bridge: false,
      mode: "full",
      launchAgentInstalled: true,
      launchAgentLoaded: false,
      launchAgentPath: userPlist,
    })
    expect(hint.join("\n")).toContain(userPlist)
  })

  test("mode=unknown — bridge alive but no plist on disk — surfaces upgrade-to-full guidance", () => {
    const hint = computeBridgeHint({
      bridge: true,
      mode: "unknown",
      launchAgentInstalled: false,
      launchAgentLoaded: false,
      launchAgentPath: null,
    })
    // bridge=true short-circuits, so unknown-mode message only fires when bridge is dead.
    expect(hint).toEqual([])

    const hintDead = computeBridgeHint({
      bridge: false,
      mode: "unknown",
      launchAgentInstalled: false,
      launchAgentLoaded: false,
      launchAgentPath: null,
    })
    expect(hintDead.join("\n")).toContain("interceptor upgrade --full")
  })

  test("falls back to /Library/LaunchAgents path when plist path is somehow null", () => {
    // Defensive case — shouldn't normally happen since launchAgentInstalled
    // implies launchAgentPath is set, but the formatter should still produce
    // a usable hint rather than printing 'null' to the user.
    const hint = computeBridgeHint({
      bridge: false,
      mode: "full",
      launchAgentInstalled: true,
      launchAgentLoaded: false,
      launchAgentPath: null,
    })
    expect(hint.join("\n")).toContain("/Library/LaunchAgents/com.interceptor.bridge.plist")
    expect(hint.join("\n")).not.toContain("null")
  })
})
