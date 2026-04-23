import { describe, expect, test } from "bun:test"
import { parseScreenshotCommand } from "../cli/commands/screenshot"
import { inferRouteCandidates } from "../extension/src/background/capabilities/canvas"

describe("interceptor canvas CLI parser", () => {
  test("canvas status returns status action", () => {
    const a = parseScreenshotCommand(["canvas", "status"])
    expect(a.type).toBe("canvas_status")
  })

  test("canvas log parses index kind and limit", () => {
    const a = parseScreenshotCommand(["canvas", "log", "2", "--kind", "fillText,drawImage", "--limit", "25"])
    expect(a.type).toBe("canvas_log")
    expect(a.canvasIndex).toBe(2)
    expect(a.kinds).toEqual(["fillText", "drawImage"])
    expect(a.limit).toBe(25)
  })

  test("canvas objects parses kind and limit", () => {
    const a = parseScreenshotCommand(["canvas", "objects", "--kind", "text", "--limit", "10"])
    expect(a.type).toBe("canvas_objects")
    expect(a.kind).toBe("text")
    expect(a.limit).toBe(10)
  })

  test("canvas model returns model action", () => {
    const a = parseScreenshotCommand(["canvas", "model", "--limit", "5"])
    expect(a.type).toBe("canvas_model")
    expect(a.limit).toBe(5)
  })

  test("canvas routes returns routes action", () => {
    const a = parseScreenshotCommand(["canvas", "routes", "--filter", "save", "--limit", "7"])
    expect(a.type).toBe("canvas_routes")
    expect(a.filter).toBe("save")
    expect(a.limit).toBe(7)
  })

  test("canvas ocr parses index and region", () => {
    const a = parseScreenshotCommand(["canvas", "ocr", "1", "--region", "10,20,30,40"])
    expect(a.type).toBe("canvas_ocr")
    expect(a.canvasIndex).toBe(1)
    expect(a.region).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })
})

describe("inferRouteCandidates", () => {
  test("prioritizes state-bearing first-party routes", () => {
    const candidates = inferRouteCandidates([
      {
        url: "/document/d/abc/save?id=abc",
        method: "POST",
        status: 200,
        type: "xhr",
        timestamp: 100,
        contentType: "application/json",
        body: "{\"revisionRanges\":[[3,3]],\"ackMessages\":[]}",
        tabUrl: "https://docs.google.com/document/d/abc/edit"
      },
      {
        url: "/document/d/abc/save?id=abc",
        method: "POST",
        status: 200,
        type: "xhr",
        timestamp: 101,
        contentType: "application/json",
        body: "{\"revisionRanges\":[[4,4]],\"ackMessages\":[]}",
        tabUrl: "https://docs.google.com/document/d/abc/edit"
      },
      {
        url: "https://docs.google.com/static/document/client/js/app.js",
        method: "GET",
        status: 200,
        type: "fetch",
        timestamp: 99,
        contentType: "application/javascript",
        body: "",
        tabUrl: "https://docs.google.com/document/d/abc/edit"
      }
    ], undefined, 10)

    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0].route).toContain("/document/d/abc/save")
    expect(candidates[0].methods).toContain("POST")
    expect(candidates[0].reasons).toContain("mutation-like-route")
    expect(candidates[0].reasons).toContain("state-bearing-body")
  })
})
