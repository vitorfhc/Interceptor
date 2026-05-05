const BRIDGE_LABEL = "com.interceptor.bridge"
const APPLICATIONS_BRIDGE_BUNDLE = "/Applications/interceptor-bridge.app"
const SYSTEM_LAUNCH_AGENT_PATH = `/Library/LaunchAgents/${BRIDGE_LABEL}.plist`

type ExistsFn = (path: string) => boolean

export type BridgeInstallMode = "browser-only" | "dev-checkout" | "full-install"

export type BridgeRecoveryActionKind =
  | "kickstart_launchagent"
  | "open_applications_bundle"
  | "open_user_bundle"
  | "open_repo_bundle"
  | "spawn_bare_binary"

export interface BridgeRecoveryLayout {
  mode: BridgeInstallMode
  launchAgentInstalled: boolean
  launchAgentPath: string | null
  launchAgentDomain: string | null
  applicationsBundlePath: string
  userBundlePath: string
  repoBundlePath: string
  bundleCandidates: string[]
  availableBundlePath: string | null
  repoDistBinaryPath: string
  repoReleaseBinaryPath: string
  repoDebugBinaryPath: string
  bareBinaryCandidates: string[]
  availableBareBinaryPath: string | null
}

export interface BridgeRecoveryAction {
  kind: BridgeRecoveryActionKind
  command: string
  args: string[]
}

function userLaunchAgentPath(home: string): string {
  return `${home}/Library/LaunchAgents/${BRIDGE_LABEL}.plist`
}

function userBridgeBundlePath(home: string): string {
  return `${home}/.local/share/interceptor/interceptor-bridge.app`
}

function repoBridgeBundlePath(importMetaUrl: string): string {
  return new URL("../dist/interceptor-bridge.app", importMetaUrl).pathname
}

function repoDistBridgeBinaryPath(importMetaUrl: string): string {
  return new URL("../dist/interceptor-bridge", importMetaUrl).pathname
}

function repoReleaseBridgeBinaryPath(importMetaUrl: string): string {
  return new URL("../interceptor-bridge/.build/release/interceptor-bridge", importMetaUrl).pathname
}

function repoDebugBridgeBinaryPath(importMetaUrl: string): string {
  return new URL("../interceptor-bridge/.build/debug/interceptor-bridge", importMetaUrl).pathname
}

export function getBridgeRecoveryLayout(opts: {
  exists: ExistsFn
  home: string
  importMetaUrl: string
  uid: number | null
}): BridgeRecoveryLayout {
  const { exists, home, importMetaUrl, uid } = opts
  const launchAgentUser = userLaunchAgentPath(home)
  const launchAgentInstalled = exists(launchAgentUser) || exists(SYSTEM_LAUNCH_AGENT_PATH)
  const launchAgentPath = exists(SYSTEM_LAUNCH_AGENT_PATH)
    ? SYSTEM_LAUNCH_AGENT_PATH
    : (exists(launchAgentUser) ? launchAgentUser : null)

  const applicationsBundlePath = APPLICATIONS_BRIDGE_BUNDLE
  const userBundlePath = userBridgeBundlePath(home)
  const repoBundlePath = repoBridgeBundlePath(importMetaUrl)
  const bundleCandidates = [applicationsBundlePath, userBundlePath, repoBundlePath]
  const availableBundlePath = bundleCandidates.find(exists) ?? null

  const repoDistBinaryPath = repoDistBridgeBinaryPath(importMetaUrl)
  const repoReleaseBinaryPath = repoReleaseBridgeBinaryPath(importMetaUrl)
  const repoDebugBinaryPath = repoDebugBridgeBinaryPath(importMetaUrl)
  const bareBinaryCandidates = [repoDistBinaryPath, repoReleaseBinaryPath, repoDebugBinaryPath]
  const availableBareBinaryPath = bareBinaryCandidates.find(exists) ?? null

  const hasInstalledFullArtifact =
    launchAgentInstalled || exists(applicationsBundlePath) || exists(userBundlePath)

  return {
    mode: hasInstalledFullArtifact
      ? "full-install"
      : (availableBundlePath || availableBareBinaryPath ? "dev-checkout" : "browser-only"),
    launchAgentInstalled,
    launchAgentPath,
    launchAgentDomain: launchAgentInstalled && uid !== null ? `gui/${uid}/${BRIDGE_LABEL}` : null,
    applicationsBundlePath,
    userBundlePath,
    repoBundlePath,
    bundleCandidates,
    availableBundlePath,
    repoDistBinaryPath,
    repoReleaseBinaryPath,
    repoDebugBinaryPath,
    bareBinaryCandidates,
    availableBareBinaryPath,
  }
}

export function getBridgeRecoveryActions(layout: BridgeRecoveryLayout, exists: ExistsFn): BridgeRecoveryAction[] {
  const actions: BridgeRecoveryAction[] = []

  if (layout.launchAgentDomain) {
    actions.push({
      kind: "kickstart_launchagent",
      command: "/bin/launchctl",
      args: ["kickstart", "-k", layout.launchAgentDomain],
    })
  }
  if (exists(layout.applicationsBundlePath)) {
    actions.push({
      kind: "open_applications_bundle",
      command: "/usr/bin/open",
      args: ["-gj", layout.applicationsBundlePath],
    })
  }
  if (exists(layout.userBundlePath)) {
    actions.push({
      kind: "open_user_bundle",
      command: "/usr/bin/open",
      args: ["-gj", layout.userBundlePath],
    })
  }
  if (exists(layout.repoBundlePath)) {
    actions.push({
      kind: "open_repo_bundle",
      command: "/usr/bin/open",
      args: ["-gj", layout.repoBundlePath],
    })
  }
  if (layout.availableBareBinaryPath) {
    actions.push({
      kind: "spawn_bare_binary",
      command: layout.availableBareBinaryPath,
      args: [],
    })
  }

  return actions
}

export function formatBridgeUnavailableError(layout: BridgeRecoveryLayout): string {
  if (layout.mode === "browser-only") {
    return "Interceptor macOS control requires a full install. Run `interceptor upgrade --full`."
  }
  if (layout.mode === "full-install") {
    return "Interceptor bridge is not reachable. Run `interceptor status` and restart `com.interceptor.bridge` with `launchctl kickstart -k gui/$(id -u)/com.interceptor.bridge`."
  }
  return "Interceptor bridge is not reachable from this source checkout. Run `bash scripts/build-bridge.sh && bash scripts/install-bridge.sh`."
}
