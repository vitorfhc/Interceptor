#!/usr/bin/env bun

import { createHmac } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs"
import { join, resolve } from "node:path"

type BrowserId = "brave" | "chrome"

type BrowserPaths = {
  app: string
  support: string
  nativeMessagingHosts: string
  name: string
}

type ProfileRecord = {
  dir: string
  name: string
}

function browserExecutablePath(browser: BrowserId): string {
  return browser === "brave"
    ? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const eq = token.indexOf("=")
    if (eq !== -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      out[token.slice(2)] = true
      continue
    }
    out[token.slice(2)] = next
    i += 1
  }
  return out
}

function getBrowserPaths(browser: BrowserId): BrowserPaths {
  if (browser === "brave") {
    return {
      app: "/Applications/Brave Browser.app",
      support: resolve(process.env.HOME || "", "Library/Application Support/BraveSoftware/Brave-Browser"),
      nativeMessagingHosts: resolve(process.env.HOME || "", "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
      name: "Brave Browser",
    }
  }
  return {
    app: "/Applications/Google Chrome.app",
    support: resolve(process.env.HOME || "", "Library/Application Support/Google/Chrome"),
    nativeMessagingHosts: resolve(process.env.HOME || "", "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
    name: "Google Chrome",
  }
}

function installedNativeMessagingTargets(): BrowserPaths[] {
  const candidates: BrowserPaths[] = [
    {
      app: "/Applications/Brave Browser.app",
      support: resolve(process.env.HOME || "", "Library/Application Support/BraveSoftware/Brave-Browser"),
      nativeMessagingHosts: resolve(process.env.HOME || "", "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
      name: "Brave Browser",
    },
    {
      app: "/Applications/Google Chrome.app",
      support: resolve(process.env.HOME || "", "Library/Application Support/Google/Chrome"),
      nativeMessagingHosts: resolve(process.env.HOME || "", "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
      name: "Google Chrome",
    },
    {
      app: "/Applications/Google Chrome for Testing.app",
      support: resolve(process.env.HOME || "", "Library/Application Support/Google/ChromeForTesting"),
      nativeMessagingHosts: resolve(process.env.HOME || "", "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"),
      name: "Google Chrome for Testing",
    },
    {
      app: "/Applications/Chromium.app",
      support: resolve(process.env.HOME || "", "Library/Application Support/Chromium"),
      nativeMessagingHosts: resolve(process.env.HOME || "", "Library/Application Support/Chromium/NativeMessagingHosts"),
      name: "Chromium",
    },
  ]

  return candidates.filter((candidate) => existsSync(candidate.app))
}

function getDeviceId(): string {
  const output = execFileSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
    encoding: "utf8",
  })
  for (const line of output.split("\n")) {
    if (line.includes("IOPlatformUUID")) {
      return line.split("=")[1]?.trim().replaceAll("\"", "") || fail("Unable to parse IOPlatformUUID")
    }
  }
  return fail("Could not get IOPlatformUUID")
}

function getChromeSeed(): Buffer {
  const seedPath = "/tmp/chrome_pref_hash_seed.bin"
  return existsSync(seedPath) ? readFileSync(seedPath) : Buffer.alloc(0)
}

function normalizeChromeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeChromeValue(item))
      .filter((item) => {
        if (Array.isArray(item)) return item.length > 0
        if (item && typeof item === "object") return Object.keys(item as Record<string, unknown>).length > 0
        return true
      })
    return normalized
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(input).sort()) {
      const normalized = normalizeChromeValue(input[key])
      if (Array.isArray(normalized) && normalized.length === 0) continue
      if (normalized && typeof normalized === "object" && Object.keys(normalized as Record<string, unknown>).length === 0) continue
      output[key] = normalized
    }
    return output
  }
  return value
}

function chromeJson(value: unknown): string {
  if (value === undefined || value === null) return ""
  return canonicalJson(normalizeChromeValue(value))
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value).replaceAll("<", "\\u003C")
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value)

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>
    const keys = Object.keys(input).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`
  }

  return JSON.stringify(value)
}

function computeHmac(seed: Buffer, deviceId: string, path: string, valueJson: string): string {
  return createHmac("sha256", seed)
    .update(Buffer.from(`${deviceId}${path}${valueJson}`, "utf8"))
    .digest("hex")
    .toUpperCase()
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

function isBrowserRunning(browser: BrowserId): boolean {
  try {
    execFileSync("/usr/bin/pgrep", ["-f", browserExecutablePath(browser)], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function listProfiles(browser: BrowserId): ProfileRecord[] {
  const paths = getBrowserPaths(browser)
  if (!existsSync(paths.support)) return []

  const profiles: ProfileRecord[] = []
  for (const name of readdirSync(paths.support).sort()) {
    const prefsPath = join(paths.support, name, "Preferences")
    if (!existsSync(prefsPath)) continue
    try {
      const prefs = readJsonFile<Record<string, unknown>>(prefsPath)
      const profile = prefs.profile as Record<string, unknown> | undefined
      const displayName = typeof profile?.name === "string" ? profile.name : "(unnamed)"
      profiles.push({ dir: name, name: displayName })
    } catch {
      // Ignore malformed profile prefs and keep scanning.
    }
  }
  return profiles
}

function installExtension(options: {
  browser: BrowserId
  profileDir: string
  extensionSrc: string
  daemonPath: string
  manifestTemplate: string
}): void {
  if (isBrowserRunning(options.browser)) {
    fail(`${getBrowserPaths(options.browser).name} is still running. Quit it completely before Interceptor updates the profile.`)
  }

  const paths = getBrowserPaths(options.browser)
  const profilePath = join(paths.support, options.profileDir)
  const prefsPath = join(profilePath, "Secure Preferences")

  if (!existsSync(profilePath)) fail(`Profile not found: ${profilePath}`)
  if (!existsSync(prefsPath)) fail(`Secure Preferences not found at ${prefsPath}`)

  const manifest = readJsonFile<Record<string, unknown>>(join(options.extensionSrc, "manifest.json"))
  const version = typeof manifest.version === "string" ? manifest.version : fail("Extension manifest version missing")
  const extensionId = "hkjbaciefhhgekldhncknbjkofbpenng"
  const deviceId = getDeviceId()
  const seed = options.browser === "chrome" ? getChromeSeed() : Buffer.alloc(0)

  const extensionDest = join(profilePath, "Extensions", extensionId, `${version}_0`)
  mkdirSync(extensionDest, { recursive: true })
  for (const item of readdirSync(options.extensionSrc)) {
    cpSync(join(options.extensionSrc, item), join(extensionDest, item), { recursive: true, force: true })
  }

  const originalPrefs = readFileSync(prefsPath, "utf8")
  const prefs = JSON.parse(originalPrefs) as Record<string, unknown>
  const installTime = String(Date.now() * 1000 + 11644473600000000)

  const activePermissions = {
    api: Array.isArray(manifest.permissions) ? manifest.permissions : [],
    explicit_host: Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [],
    manifest_permissions: [],
    scriptable_host: ["<all_urls>"],
  }

  const entry = {
    account_extension_type: 0,
    active_bit: true,
    active_permissions: activePermissions,
    commands: {},
    content_settings: [],
    creation_flags: 38,
    disable_reasons: [],
    first_install_time: installTime,
    from_webstore: false,
    granted_permissions: activePermissions,
    incognito: false,
    last_update_time: installTime,
    location: 4,
    manifest,
    path: `${extensionId}/${version}_0`,
    preferences: {},
    regular_only_preferences: {},
    was_installed_by_default: false,
    was_installed_by_oem: false,
    withholding_permissions: false,
  }

  const extensions = ((prefs.extensions as Record<string, unknown> | undefined) ||= {})
  const settings = ((extensions.settings as Record<string, unknown> | undefined) ||= {})
  settings[extensionId] = entry

  const protection = ((prefs.protection as Record<string, unknown> | undefined) ||= {})
  const macs = ((protection.macs as Record<string, unknown> | undefined) ||= {})
  const macExtensions = ((macs.extensions as Record<string, unknown> | undefined) ||= {})
  const macSettings = ((macExtensions.settings as Record<string, unknown> | undefined) ||= {})
  const entryPath = `extensions.settings.${extensionId}`
  macSettings[extensionId] = computeHmac(seed, deviceId, entryPath, chromeJson(entry))
  protection.super_mac = computeHmac(seed, deviceId, "", chromeJson(macs))

  writeFileSync(`${prefsPath}.pre-interceptor`, originalPrefs)
  writeFileSync(prefsPath, JSON.stringify(prefs))

  const hostManifest = readJsonFile<Record<string, unknown>>(options.manifestTemplate)
  hostManifest.path = resolve(options.daemonPath)
  const targets = installedNativeMessagingTargets()
  if (!targets.some((target) => target.nativeMessagingHosts === paths.nativeMessagingHosts)) {
    targets.push(paths)
  }
  for (const target of targets) {
    mkdirSync(target.nativeMessagingHosts, { recursive: true })
    writeJsonFile(join(target.nativeMessagingHosts, "com.interceptor.host.json"), hostManifest)
  }

  const verifyPrefs = readJsonFile<Record<string, unknown>>(prefsPath)
  const verifyEntry = (verifyPrefs.extensions as Record<string, unknown> | undefined)?.settings as Record<string, unknown> | undefined
  if (!existsSync(extensionDest) || !verifyEntry?.[extensionId]) {
    fail(`Interceptor could not verify the browser-profile install for ${paths.name}.`)
  }
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)

  if (command === "profiles") {
    const browser = args.browser
    if (browser !== "brave" && browser !== "chrome") fail("Usage: interceptor-setup profiles --browser <chrome|brave>")
    process.stdout.write(JSON.stringify({ browser, profiles: listProfiles(browser) }))
    return
  }

  if (command === "install") {
    const browser = args.browser
    const profile = args.profile
    const extensionSrc = args["extension-src"]
    const daemonPath = args["daemon-path"]
    const manifestTemplate = args["manifest-template"]
    if (browser !== "brave" && browser !== "chrome") fail("Usage: interceptor-setup install --browser <chrome|brave> --profile <profile> --extension-src <dir> --daemon-path <path> --manifest-template <path>")
    if (typeof profile !== "string") fail("Missing --profile")
    if (typeof extensionSrc !== "string") fail("Missing --extension-src")
    if (typeof daemonPath !== "string") fail("Missing --daemon-path")
    if (typeof manifestTemplate !== "string") fail("Missing --manifest-template")

    installExtension({
      browser,
      profileDir: profile,
      extensionSrc,
      daemonPath,
      manifestTemplate,
    })
    process.stdout.write(JSON.stringify({ success: true, browser, profile }))
    return
  }

  fail("Usage: interceptor-setup <profiles|install> [options]")
}

main()
