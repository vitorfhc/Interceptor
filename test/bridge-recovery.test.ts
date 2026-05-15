import { describe, expect, test } from "bun:test"
import {
  formatBridgeUnavailableError,
  getBridgeRecoveryActions,
  getBridgeRecoveryLayout,
} from "../daemon/bridge-recovery"

const home = "/Users/tester"
const uid = 501
const daemonImportMetaUrl = new URL("../daemon/index.ts", import.meta.url).href
const repoBundlePath = new URL("../dist/interceptor-bridge.app", daemonImportMetaUrl).pathname
const repoDistBinaryPath = new URL("../dist/interceptor-bridge", daemonImportMetaUrl).pathname

function existsFor(paths: string[]) {
  const set = new Set(paths)
  return (path: string) => set.has(path)
}

describe("bridge recovery layout", () => {
  test("browser-only mode produces upgrade guidance and no recovery actions", () => {
    const layout = getBridgeRecoveryLayout({
      exists: existsFor([]),
      home,
      importMetaUrl: daemonImportMetaUrl,
      uid,
    })

    expect(layout.mode).toBe("browser-only")
    expect(layout.launchAgentInstalled).toBe(false)
    expect(layout.availableBundlePath).toBeNull()
    expect(getBridgeRecoveryActions(layout, existsFor([]))).toEqual([])
    expect(formatBridgeUnavailableError(layout)).toContain("interceptor upgrade --full")
  })

  test("user-local full install prefers kickstart before opening the user bundle", () => {
    const userLaunchAgent = `${home}/Library/LaunchAgents/com.interceptor.bridge.plist`
    const userBundle = `${home}/.local/share/interceptor/interceptor-bridge.app`
    const exists = existsFor([userLaunchAgent, userBundle])
    const layout = getBridgeRecoveryLayout({
      exists,
      home,
      importMetaUrl: daemonImportMetaUrl,
      uid,
    })

    expect(layout.mode).toBe("full-install")
    expect(layout.launchAgentDomain).toBe("gui/501/com.interceptor.bridge")
    expect(layout.availableBundlePath).toBe(userBundle)

    const actions = getBridgeRecoveryActions(layout, exists)
    expect(actions.map((action) => action.kind)).toEqual([
      "kickstart_launchagent",
      "open_user_bundle",
    ])
  })

  test("pkg full install prefers kickstart then the /Applications bundle", () => {
    const systemLaunchAgent = "/Library/LaunchAgents/com.interceptor.bridge.plist"
    const applicationsBundle = "/Applications/interceptor-bridge.app"
    const exists = existsFor([systemLaunchAgent, applicationsBundle])
    const layout = getBridgeRecoveryLayout({
      exists,
      home,
      importMetaUrl: daemonImportMetaUrl,
      uid,
    })

    expect(layout.mode).toBe("full-install")
    expect(layout.availableBundlePath).toBe(applicationsBundle)

    const actions = getBridgeRecoveryActions(layout, exists)
    expect(actions.map((action) => action.kind)).toEqual([
      "kickstart_launchagent",
      "open_applications_bundle",
    ])
    expect(formatBridgeUnavailableError(layout)).not.toContain("build-bridge.sh")
    expect(formatBridgeUnavailableError(layout)).toContain("interceptor status")
  })

  test("pkg full install with plist NOT bootstrapped tells the user to bootstrap, not kickstart", () => {
    const systemLaunchAgent = "/Library/LaunchAgents/com.interceptor.bridge.plist"
    const applicationsBundle = "/Applications/interceptor-bridge.app"
    const exists = existsFor([systemLaunchAgent, applicationsBundle])
    const layout = getBridgeRecoveryLayout({
      exists,
      home,
      importMetaUrl: daemonImportMetaUrl,
      uid,
    })

    const error = formatBridgeUnavailableError(layout, { launchAgentLoaded: false })
    expect(error).toContain("launchctl bootstrap")
    expect(error).toContain(systemLaunchAgent)
    expect(error).toContain("log out and back in")
  })

  test("pkg full install with plist already bootstrapped falls back to kickstart guidance", () => {
    const systemLaunchAgent = "/Library/LaunchAgents/com.interceptor.bridge.plist"
    const applicationsBundle = "/Applications/interceptor-bridge.app"
    const exists = existsFor([systemLaunchAgent, applicationsBundle])
    const layout = getBridgeRecoveryLayout({
      exists,
      home,
      importMetaUrl: daemonImportMetaUrl,
      uid,
    })

    const error = formatBridgeUnavailableError(layout, { launchAgentLoaded: true })
    expect(error).not.toContain("launchctl bootstrap")
    expect(error).toContain("kickstart")
  })

  test("repo fallback uses the repo bundle before the bare binary", () => {
    const exists = existsFor([repoBundlePath, repoDistBinaryPath])
    const layout = getBridgeRecoveryLayout({
      exists,
      home,
      importMetaUrl: daemonImportMetaUrl,
      uid,
    })

    expect(layout.mode).toBe("dev-checkout")
    expect(layout.availableBundlePath).toBe(repoBundlePath)
    expect(layout.availableBareBinaryPath).toBe(repoDistBinaryPath)

    const actions = getBridgeRecoveryActions(layout, exists)
    expect(actions.map((action) => action.kind)).toEqual([
      "open_repo_bundle",
      "spawn_bare_binary",
    ])
    expect(formatBridgeUnavailableError(layout)).toContain("build-bridge.sh")
  })
})
