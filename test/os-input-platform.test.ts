/**
 * test/os-input-platform.test.ts
 *
 * Regression test for the daemon's macOS FFI being gated to Darwin only.
 *
 * The daemon imports os-input (CoreGraphics-backed `act --os` implementation)
 * at startup. Before the platform guard, the module's top-level `dlopen` of
 * /System/Library/Frameworks/CoreGraphics.framework/CoreGraphics threw
 * ERR_DLOPEN_FAILED on Linux at module-load time, crashing the daemon before
 * NM handshake. The fix gates the dlopen on process.platform === "darwin"
 * and short-circuits each exported os* function with an unsupported error
 * on non-Darwin.
 *
 * These tests assert two contracts on non-Darwin:
 *   1. `import("./daemon/os-input")` succeeds without throwing
 *   2. Each exported os* function returns { success: false } with a
 *      platform-mention error string instead of attempting CG operations
 */

import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const IS_DARWIN = process.platform === "darwin"

describe("os-input — non-Darwin platform guard", () => {
  test("module imports without throwing on non-Darwin", async () => {
    // Importing the module is the regression check. Before the fix this threw
    // ERR_DLOPEN_FAILED on Linux. We don't await the actions, just module load.
    let threw: unknown = null
    try {
      await import(resolve(REPO_ROOT, "daemon/os-input.ts"))
    } catch (e) {
      threw = e
    }
    expect(threw).toBeNull()
  })

  test.skipIf(IS_DARWIN)("osClick returns unsupported on non-Darwin", async () => {
    const mod = await import(resolve(REPO_ROOT, "daemon/os-input.ts"))
    const result = await mod.osClick(0, 0)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/macOS only|not supported/)
  })

  test.skipIf(IS_DARWIN)("osKey returns unsupported on non-Darwin", async () => {
    const mod = await import(resolve(REPO_ROOT, "daemon/os-input.ts"))
    const result = await mod.osKey("a")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/macOS only|not supported/)
  })

  test.skipIf(IS_DARWIN)("osType returns unsupported on non-Darwin", async () => {
    const mod = await import(resolve(REPO_ROOT, "daemon/os-input.ts"))
    const result = await mod.osType("hello")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/macOS only|not supported/)
  })

  test.skipIf(IS_DARWIN)("osMove returns unsupported on non-Darwin", async () => {
    const mod = await import(resolve(REPO_ROOT, "daemon/os-input.ts"))
    const result = await mod.osMove([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/macOS only|not supported/)
  })

  test("pure helpers (generateBezierPath, translateCoords) work on every platform", async () => {
    const mod = await import(resolve(REPO_ROOT, "daemon/os-input.ts"))
    // generateBezierPath is just math; it must not depend on the platform guard.
    const path = mod.generateBezierPath(0, 0, 100, 100, 5)
    expect(path).toBeArray()
    expect(path.length).toBe(6) // steps=5 → 6 points (inclusive)
    expect(path[0]).toEqual({ x: 0, y: 0 })
    expect(path[path.length - 1]).toEqual({ x: 100, y: 100 })

    // translateCoords is also pure arithmetic.
    const coords = mod.translateCoords(50, 50, { left: 10, top: 20, width: 800, height: 600 })
    expect(coords).toEqual({ screenX: 60, screenY: 158 }) // 20 + 88 (chromeUiHeight) + 50
  })
})
