import { describe, expect, test } from "bun:test"

import { parseEvalCommand } from "../cli/commands/eval"

describe("parseEvalCommand", () => {
  test("bare code evaluates in the isolated world", () => {
    expect(parseEvalCommand(["eval", "1+1"])).toEqual({
      type: "evaluate",
      code: "1+1",
      world: "ISOLATED",
    })
  })

  test("--main selects the main world without entering code", () => {
    expect(parseEvalCommand(["eval", "--main", "1+1"])).toEqual({
      type: "evaluate",
      code: "1+1",
      world: "MAIN",
    })
  })

  test("--timeout before --main is consumed without entering code", () => {
    expect(parseEvalCommand(["eval", "--timeout", "8000", "--main", "1+1"])).toEqual({
      type: "evaluate",
      code: "1+1",
      world: "MAIN",
    })
  })

  test("--timeout after --main is consumed without entering code", () => {
    expect(parseEvalCommand(["eval", "--main", "--timeout", "8000", "1+1"])).toEqual({
      type: "evaluate",
      code: "1+1",
      world: "MAIN",
    })
  })

  test("equals-form value flags are consumed without entering code", () => {
    expect(parseEvalCommand(["eval", "--timeout=8000", "--frame=main", "--main", "1+1"])).toEqual({
      type: "evaluate",
      code: "1+1",
      world: "MAIN",
    })
  })

  test("trailing --main selects the main world without entering code", () => {
    expect(parseEvalCommand(["eval", "1+1", "--main"])).toEqual({
      type: "evaluate",
      code: "1+1",
      world: "MAIN",
    })
  })

  test("multi-token code is preserved in order", () => {
    const action = parseEvalCommand(["eval", "const", "x", "=", "1;", "x", "+", "1"])
    expect(action.code).toBe("const x = 1; x + 1")
  })

  test("quoted code containing flag-looking text is preserved", () => {
    const action = parseEvalCommand(["eval", "JSON.stringify(['--main', '--timeout'])"])
    expect(action.code).toBe("JSON.stringify(['--main', '--timeout'])")
  })

  test("fetch snippets are preserved", () => {
    const action = parseEvalCommand(["eval", "fetch('https://example.com').then(r => r.text())"])
    expect(action.code).toBe("fetch('https://example.com').then(r => r.text())")
  })

  test("-- terminator preserves flag-looking code tokens", () => {
    expect(parseEvalCommand(["eval", "--main", "--", "--timeout", "8000", "--main"])).toEqual({
      type: "evaluate",
      code: "--timeout 8000 --main",
      world: "MAIN",
    })
  })
})
