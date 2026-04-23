import type { SceneProfile } from "../types"
import {
  cursorToAdaptiveScene,
  describeAdaptiveProfile,
  discoverAdaptiveSceneObjects,
  hitTestAdaptiveScene,
  readFocusedWritableText,
  resolveAdaptiveSceneTarget,
  selectedAdaptiveScene,
  writeToFocusedWritableSurface
} from "../adaptive"
import { getCanvasBridgeObjects } from "../../canvas-bridge"

const observerObjectCache = new Map<string, {
  id: string
  rect: { x: number; y: number; w: number; h: number; cx: number; cy: number }
  text?: string
  extras?: Record<string, unknown>
}>()

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return null
}

function toRect(entry: Record<string, unknown>) {
  const base = (entry.rect || entry.bbox) as Record<string, unknown> | undefined
  const x = asNumber(base?.x ?? entry.x)
  const y = asNumber(base?.y ?? entry.y)
  const w = asNumber(base?.w)
  const h = asNumber(base?.h)
  if (x === null || y === null) return null
  const width = w ?? 1
  const height = h ?? 1
  return {
    x,
    y,
    w: width,
    h: height,
    cx: x + width / 2,
    cy: y + height / 2
  }
}

function observerKindToSceneType(kind: string): "text" | "image" | "shape" | "unknown" {
  if (kind === "text") return "text"
  if (kind === "image") return "image"
  if (kind === "rect" || kind === "path") return "shape"
  return "unknown"
}

function observerSceneObjects(profileName: string) {
  observerObjectCache.clear()
  const data = getCanvasBridgeObjects({ limit: 200 })
  if (!data.installed) return []

  return (data.objects as Array<Record<string, unknown>>)
    .map((entry, idx) => {
      const rect = toRect(entry)
      if (!rect) return null
      const kind = String(entry.kind || "").trim()
      const id = `cvobj-${String(entry.canvasId || "unknown")}-${idx}`
      const obj = {
        id,
        type: observerKindToSceneType(kind),
        rect,
        text: typeof entry.text === "string" ? entry.text : undefined,
        extras: {
          strategy: "canvas-observer",
          profile: profileName,
          canvasId: entry.canvasId,
          observerKind: kind,
          source: entry.source,
          confidence: entry.confidence
        }
      }
      observerObjectCache.set(id, obj)
      return obj
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
}

export const genericProfile: SceneProfile = {
  name: "generic",

  detect(): boolean {
    return true
  },

  list(opts): ReturnType<typeof discoverAdaptiveSceneObjects> {
    const base = discoverAdaptiveSceneObjects({ type: opts?.type, profileName: "generic" })
    const observer = observerSceneObjects("generic")
    if (opts?.type) {
      return [...base, ...observer.filter((entry) => entry.type === opts.type)]
    }
    return [...base, ...observer]
  },

  resolve(id: string) {
    if (id.startsWith("cvobj-")) {
      const cached = observerObjectCache.get(id)
      if (cached) return cached
    }
    return resolveAdaptiveSceneTarget(id)
  },

  selected() {
    return selectedAdaptiveScene()
  },

  text() {
    return readFocusedWritableText()
  },

  writeAtCursor(text: string) {
    return writeToFocusedWritableSurface(text)
  },

  cursorTo(opts: { x: number; y: number }) {
    return cursorToAdaptiveScene(opts.x, opts.y)
  },

  hitTest(x: number, y: number) {
    const observer = observerSceneObjects("generic")
    const hit = observer.find((o) => x >= o.rect.x && x <= o.rect.x + o.rect.w && y >= o.rect.y && y <= o.rect.y + o.rect.h)
    if (hit) return hit
    return hitTestAdaptiveScene(x, y)
  },

  describe() {
    return describeAdaptiveProfile("generic", [
      "Capability-driven fallback profile",
      "Uses semantics, geometry, focus, and writable-surface detection",
      "Consumes canvas-observer objects when available"
    ])
  }
}
