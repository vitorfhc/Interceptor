import { describe, expect, test, spyOn } from "bun:test"

import { parseSaveCommand } from "../cli/commands/save"

// parseSaveCommand must build the JS expression from positional args only —
// never folding stray flags (notably a trailing --json) into the code, which
// previously produced "Invalid left-hand side expression in postfix operation".
describe("parseSaveCommand", () => {
  test("emits a binary_sink_save action with out/code/world", () => {
    const a = parseSaveCommand(["save", "--out", "/tmp/f.bin", "new Blob(['x'])"])
    expect(a.type).toBe("binary_sink_save")
    expect(a.out).toBe("/tmp/f.bin")
    expect(a.code).toBe("new Blob(['x'])")
    expect(a.world).toBe("MAIN")
  })

  test("a trailing --json does NOT leak into the evaluated code", () => {
    const a = parseSaveCommand(["save", "--out", "/tmp/f.bin", "new Blob(['x'])", "--json"])
    expect(a.code).toBe("new Blob(['x'])")
  })

  test("strips leftover boolean flags (--no-ws / --ws / --any-tab) from code", () => {
    const a = parseSaveCommand(["save", "--out", "/tmp/f.bin", "--no-ws", "new Blob([])", "--any-tab"])
    expect(a.code).toBe("new Blob([])")
  })

  test("--isolated selects the ISOLATED world and is not part of code", () => {
    const a = parseSaveCommand(["save", "--out", "/tmp/f.bin", "--isolated", "new Uint8Array(1)"])
    expect(a.world).toBe("ISOLATED")
    expect(a.code).toBe("new Uint8Array(1)")
  })

  test("--chunk-size is parsed and neither flag nor value lands in code", () => {
    const a = parseSaveCommand(["save", "--out", "/tmp/f.bin", "--chunk-size", "65536", "buf"])
    expect(a.chunkSize).toBe(65536)
    expect(a.code).toBe("buf")
  })

  test("a multi-token expression is preserved in order", () => {
    const a = parseSaveCommand(["save", "--out", "/tmp/f.bin", "await", "fetch(u).then(r=>r.blob())"])
    expect(a.code).toBe("await fetch(u).then(r=>r.blob())")
  })

  test("--timeout before --out is consumed without entering code", () => {
    const a = parseSaveCommand(["save", "--timeout", "8000", "--out", "/tmp/f.bin", "new Blob([])"])
    expect(a.out).toBe("/tmp/f.bin")
    expect(a.code).toBe("new Blob([])")
  })

  test("--timeout after expression is consumed without entering code", () => {
    const a = parseSaveCommand(["save", "--out", "/tmp/f.bin", "new Blob([])", "--timeout", "8000"])
    expect(a.code).toBe("new Blob([])")
  })

  test("--out=<path> and --chunk-size=<n> forms are supported", () => {
    const a = parseSaveCommand(["save", "--out=/tmp/f.bin", "--chunk-size=4096", "new Blob([])"])
    expect(a.out).toBe("/tmp/f.bin")
    expect(a.chunkSize).toBe(4096)
    expect(a.code).toBe("new Blob([])")
  })

  test("requires --out explicitly (no silent positional fallback)", () => {
    const exit = spyOn(process, "exit").mockImplementation(((): never => { throw new Error("exit") }))
    const err = spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(() => parseSaveCommand(["save", "new Blob([])"])).toThrow("exit")
    } finally {
      exit.mockRestore()
      err.mockRestore()
    }
  })

  test("requires a JavaScript expression", () => {
    const exit = spyOn(process, "exit").mockImplementation(((): never => { throw new Error("exit") }))
    const err = spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(() => parseSaveCommand(["save", "--out", "/tmp/f.bin"])).toThrow("exit")
    } finally {
      exit.mockRestore()
      err.mockRestore()
    }
  })
})
