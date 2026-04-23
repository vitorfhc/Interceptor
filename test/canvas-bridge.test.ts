/// <reference lib="dom" />

import { beforeAll, describe, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

beforeAll(() => {
  ;(globalThis as any).chrome = {
    runtime: {
      onMessage: {
        addListener() {}
      }
    }
  }
})

describe("canvas bridge", () => {
  test("captures log and object events from page world", async () => {
    const bridge = await import("../extension/src/content/canvas-bridge")
    bridge.resetCanvasBridgeForTest()

    document.dispatchEvent(new CustomEvent("__interceptor_canvas_log", {
      detail: { t: 1, kind: "fillText", canvasId: "cv1", text: "Hello" }
    }))
    document.dispatchEvent(new CustomEvent("__interceptor_canvas_object", {
      detail: { t: 2, kind: "text", canvasId: "cv1", text: "Hello", source: "draw-op", confidence: 0.9 }
    }))

    const status = bridge.getCanvasBridgeStatus() as {
      installed: boolean
      logSize: number
      objectSize: number
      kindCounts: Record<string, number>
    }
    const log = bridge.getCanvasBridgeLog({ limit: 10 })
    const objects = bridge.getCanvasBridgeObjects({ limit: 10 })

    expect(status.installed).toBe(true)
    expect(status.logSize).toBeGreaterThan(0)
    expect(status.objectSize).toBeGreaterThan(0)
    expect(status.kindCounts.fillText).toBeGreaterThan(0)

    expect(log.total).toBeGreaterThan(0)
    expect((log.entries as Array<{ kind?: string }>)[0]?.kind).toBe("fillText")

    expect(objects.total).toBeGreaterThan(0)
    expect((objects.objects as Array<{ kind?: string; text?: string }>)[0]?.kind).toBe("text")
    expect((objects.objects as Array<{ kind?: string; text?: string }>)[0]?.text).toBe("Hello")
  })

  test("filters logs and objects by requested canvas index", async () => {
    const bridge = await import("../extension/src/content/canvas-bridge")
    bridge.resetCanvasBridgeForTest()

    document.dispatchEvent(new CustomEvent("__interceptor_canvas_log", {
      detail: {
        t: 1,
        kind: "getContext",
        canvasId: "cvA",
        canvas: { canvasId: "cvA", domIndex: 0, id: "canvas-a" }
      }
    }))
    document.dispatchEvent(new CustomEvent("__interceptor_canvas_log", {
      detail: {
        t: 2,
        kind: "getContext",
        canvasId: "cvB",
        canvas: { canvasId: "cvB", domIndex: 1, id: "canvas-b" }
      }
    }))
    document.dispatchEvent(new CustomEvent("__interceptor_canvas_log", {
      detail: { t: 3, kind: "fillText", canvasId: "cvA", text: "Alpha" }
    }))
    document.dispatchEvent(new CustomEvent("__interceptor_canvas_log", {
      detail: { t: 4, kind: "fillText", canvasId: "cvB", text: "Beta" }
    }))
    document.dispatchEvent(new CustomEvent("__interceptor_canvas_object", {
      detail: { t: 5, kind: "text", canvasId: "cvA", text: "Alpha", source: "draw-op", confidence: 0.9 }
    }))
    document.dispatchEvent(new CustomEvent("__interceptor_canvas_object", {
      detail: { t: 6, kind: "text", canvasId: "cvB", text: "Beta", source: "draw-op", confidence: 0.9 }
    }))

    const firstLog = bridge.getCanvasBridgeLog({ canvasIndex: 0, limit: 10 })
    const secondLog = bridge.getCanvasBridgeLog({ canvasIndex: 1, limit: 10 })
    const firstObjects = bridge.getCanvasBridgeObjects({ canvasIndex: 0, limit: 10 })
    const secondObjects = bridge.getCanvasBridgeObjects({ canvasIndex: 1, limit: 10 })

    expect((firstLog.entries as Array<{ canvasId?: string }>).every((entry) => entry.canvasId === "cvA")).toBe(true)
    expect((secondLog.entries as Array<{ canvasId?: string }>).every((entry) => entry.canvasId === "cvB")).toBe(true)
    expect((firstObjects.objects as Array<{ canvasId?: string }>).every((entry) => entry.canvasId === "cvA")).toBe(true)
    expect((secondObjects.objects as Array<{ canvasId?: string }>).every((entry) => entry.canvasId === "cvB")).toBe(true)
  })
})
