/**
 * test/fixtures/linux-os-input-check.ts
 *
 * Fixture invoked by test/install-linux-container.test.ts inside a Linux Bun
 * container (via `interceptor macos container run`). The CLI's --cmd flag
 * splits on whitespace (cli/commands/macos.ts:893), so multi-word `bun -e`
 * invocations are awkward to pass cleanly. Running this fixture as a single-
 * argument script sidesteps the quoting problem.
 *
 * Assertions emitted on stdout (the test parses these markers):
 *   - import-ok                                                — module loaded without throwing ERR_DLOPEN_FAILED
 *   - osClick:{"success":false,"error":"act --os not …"}       — non-Darwin sentinel
 *
 * If either check fails the script exits non-zero with the error on stderr.
 */

export {}

async function main() {
  let mod: typeof import("../../daemon/os-input")
  try {
    mod = await import("../../daemon/os-input")
  } catch (err) {
    console.error("import-failed:", (err as Error).message)
    process.exit(1)
  }
  console.log("import-ok")

  const r = await mod.osClick(1, 1)
  console.log("osClick:" + JSON.stringify(r))

  if (r.success !== false) {
    console.error("osClick should return success=false on non-Darwin")
    process.exit(2)
  }
  if (typeof r.error !== "string" || !r.error.toLowerCase().includes("not supported")) {
    console.error("osClick error string missing 'not supported': " + JSON.stringify(r))
    process.exit(3)
  }
}

main()
