const CANVAS_LOG_CAP = 1000
const CANVAS_OBJECT_CAP = 500

type CanvasBridgeEntry = Record<string, unknown> & { t?: number; kind?: string; canvasId?: string }

const canvasLogBuffer: CanvasBridgeEntry[] = []
const canvasObjectBuffer: CanvasBridgeEntry[] = []
const canvasMetaById = new Map<string, CanvasBridgeEntry>()
let lastCanvasStatus: Record<string, unknown> | null = null

export function getCanvasBridgeStatus(): Record<string, unknown> {
  return lastCanvasStatus || {
    installed: false,
    logSize: 0,
    objectSize: 0,
    kindCounts: {}
  }
}

function canvasOrder(): CanvasBridgeEntry[] {
  return [...canvasMetaById.values()].sort((a, b) => {
    const left = typeof a.domIndex === "number" ? a.domIndex : Number.MAX_SAFE_INTEGER
    const right = typeof b.domIndex === "number" ? b.domIndex : Number.MAX_SAFE_INTEGER
    if (left !== right) return left - right
    return String(a.canvasId || "").localeCompare(String(b.canvasId || ""))
  })
}

function resolveCanvasIdForIndex(canvasIndex?: number): string | null | undefined {
  if (canvasIndex === undefined) return undefined
  const ordered = canvasOrder()
  return String(ordered[canvasIndex]?.canvasId || "") || null
}

export function getCanvasBridgeLog(opts?: { kinds?: string[]; limit?: number; canvasIndex?: number }) {
  const kinds = (opts?.kinds || []).map((k) => String(k).trim()).filter(Boolean)
  const canvasId = resolveCanvasIdForIndex(opts?.canvasIndex)
  let entries = canvasLogBuffer.slice()
  if (canvasId === null) entries = []
  else if (canvasId) entries = entries.filter((entry) => String(entry.canvasId || "") === canvasId)
  if (kinds.length > 0) {
    entries = entries.filter((entry) => kinds.includes(String(entry.kind || "").trim()))
  }
  return {
    installed: true,
    total: entries.length,
    kindCounts: summarizeKinds(entries),
    entries: entries.slice(-Math.max(1, opts?.limit || 100))
  }
}

export function getCanvasBridgeObjects(opts?: { kind?: string; limit?: number; canvasIndex?: number }) {
  const kind = String(opts?.kind || "").trim()
  const canvasId = resolveCanvasIdForIndex(opts?.canvasIndex)
  let objects = canvasObjectBuffer.slice()
  if (canvasId === null) objects = []
  else if (canvasId) objects = objects.filter((entry) => String(entry.canvasId || "") === canvasId)
  if (kind) {
    objects = objects.filter((entry) => String(entry.kind || "").trim() === kind)
  }
  return {
    installed: true,
    total: objects.length,
    objects: objects.slice(-Math.max(1, opts?.limit || 100))
  }
}

export function resetCanvasBridgeForTest(): void {
  canvasLogBuffer.length = 0
  canvasObjectBuffer.length = 0
  canvasMetaById.clear()
  lastCanvasStatus = null
}

function updateCanvasMeta(entry: CanvasBridgeEntry): void {
  const detailMeta = entry.canvas && typeof entry.canvas === "object" ? entry.canvas as CanvasBridgeEntry : null
  const canvasId = String(detailMeta?.canvasId || entry.canvasId || "").trim()
  if (!canvasId) return
  const next: CanvasBridgeEntry = { ...(canvasMetaById.get(canvasId) || {}), canvasId }
  if (detailMeta) Object.assign(next, detailMeta)
  if (typeof entry.domIndex === "number") next.domIndex = entry.domIndex
  canvasMetaById.set(canvasId, next)
}

function pushBounded<T>(arr: T[], item: T, cap: number): void {
  if (arr.length >= cap) arr.shift()
  arr.push(item)
}

function summarizeKinds(entries: Array<{ kind?: unknown }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const entry of entries) {
    const kind = String(entry.kind || "").trim()
    if (!kind) continue
    out[kind] = (out[kind] || 0) + 1
  }
  return out
}

document.addEventListener("__interceptor_canvas_log", ((e: CustomEvent) => {
  try {
    const entry = e.detail as CanvasBridgeEntry
    updateCanvasMeta(entry)
    pushBounded(canvasLogBuffer, entry, CANVAS_LOG_CAP)
    lastCanvasStatus = {
      installed: true,
      logSize: canvasLogBuffer.length,
      objectSize: canvasObjectBuffer.length,
      kindCounts: summarizeKinds(canvasLogBuffer)
    }
  } catch {}
}) as EventListener)

document.addEventListener("__interceptor_canvas_object", ((e: CustomEvent) => {
  try {
    pushBounded(canvasObjectBuffer, e.detail as CanvasBridgeEntry, CANVAS_OBJECT_CAP)
    lastCanvasStatus = {
      installed: true,
      logSize: canvasLogBuffer.length,
      objectSize: canvasObjectBuffer.length,
      kindCounts: summarizeKinds(canvasLogBuffer)
    }
  } catch {}
}) as EventListener)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "get_canvas_bridge_status") {
    sendResponse({
      success: true,
      data: getCanvasBridgeStatus()
    })
    return true
  }

  if (msg.type === "get_canvas_bridge_log") {
    sendResponse({
      success: true,
      data: getCanvasBridgeLog({
        kinds: Array.isArray(msg.kinds) ? msg.kinds as string[] : [],
        limit: msg.limit as number | undefined,
        canvasIndex: typeof msg.canvasIndex === "number" ? msg.canvasIndex : undefined
      })
    })
    return true
  }

  if (msg.type === "get_canvas_bridge_objects") {
    sendResponse({
      success: true,
      data: getCanvasBridgeObjects({
        kind: msg.kind as string | undefined,
        limit: msg.limit as number | undefined,
        canvasIndex: typeof msg.canvasIndex === "number" ? msg.canvasIndex : undefined
      })
    })
    return true
  }
})
