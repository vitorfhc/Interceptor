import { describe, expect, test } from "bun:test"
import { buildReadTreeAction } from "../cli/commands/compound"
import { parseElementTarget } from "../cli/parse"

describe("buildReadTreeAction", () => {
  test("passes subtree targeting into get_a11y_tree for regular reads", () => {
    const target = parseElementTarget("e7")
    const action = buildReadTreeAction({
      target,
      filterMode: "interactive",
      includeStyle: true,
      includeFrames: false
    })

    expect(action).toMatchObject({
      type: "get_a11y_tree",
      ref: "e7",
      includeStyle: true,
      filter: "interactive"
    })
  })

  test("passes frame and ref targeting into frames_read_tree", () => {
    const target = parseElementTarget("e9_2")
    const action = buildReadTreeAction({
      target,
      filterMode: "interactive",
      includeStyle: false,
      includeFrames: true
    })

    expect(action).toMatchObject({
      type: "frames_read_tree",
      frameId: 9,
      ref: "e2",
      includeStyle: false,
      filter: "interactive"
    })
  })
})
