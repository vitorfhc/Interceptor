type ActionResult = { success: boolean; error?: string; data?: unknown; tabId?: number }

type Origin = "AUTHOR" | "USER"

type InstallRecord = {
  tabId: number
  frameIds: number[] | undefined
  allFrames: boolean
  css: string
  origin: Origin
}

const handleStore = new Map<string, InstallRecord>()

function randomHandle(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return "s_" + crypto.randomUUID()
    }
  } catch {}
  return "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function dropHandlesForTab(tabId: number): void {
  for (const [handle, rec] of handleStore) {
    if (rec.tabId === tabId) handleStore.delete(handle)
  }
}

let listenerRegistered = false
function ensureTabCloseListener(): void {
  if (listenerRegistered) return
  try {
    chrome.tabs.onRemoved.addListener((tabId) => dropHandlesForTab(tabId))
    listenerRegistered = true
  } catch {}
}

async function handleStyleInject(
  action: { type: string; [key: string]: unknown },
  tabId: number
): Promise<ActionResult> {
  ensureTabCloseListener()
  const css = action.css as string | undefined
  if (typeof css !== "string" || !css.trim()) {
    return { success: false, error: "style_inject requires a non-empty 'css' string" }
  }
  const originRaw = (action.origin as string) || "USER"
  const origin: Origin = originRaw === "AUTHOR" ? "AUTHOR" : "USER"
  const frameIdsArg = action.frameIds as number[] | undefined
  const allFrames = action.allFrames === true || (!frameIdsArg && action.allFrames !== false)

  const target: chrome.scripting.InjectionTarget = frameIdsArg && frameIdsArg.length
    ? { tabId, frameIds: frameIdsArg }
    : { tabId, allFrames }

  try {
    await chrome.scripting.insertCSS({
      target,
      css,
      origin
    })
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) }
  }

  const handle = randomHandle()
  handleStore.set(handle, {
    tabId,
    frameIds: frameIdsArg,
    allFrames,
    css,
    origin
  })

  let frames: number[] = []
  if (frameIdsArg && frameIdsArg.length) frames = [...frameIdsArg]
  else if (allFrames) {
    try {
      const list = await chrome.webNavigation.getAllFrames({ tabId })
      frames = list?.map(f => f.frameId) ?? []
    } catch {
      frames = []
    }
  } else {
    frames = [0]
  }

  return { success: true, data: { handle, frames }, tabId }
}

async function handleStyleRemove(
  action: { type: string; [key: string]: unknown },
  tabId: number
): Promise<ActionResult> {
  const handle = action.handle as string | undefined
  if (!handle) return { success: false, error: "style_remove requires 'handle'" }

  const rec = handleStore.get(handle)
  if (!rec) {
    return { success: true, data: { removed: false, reason: "unknown or already-removed handle" }, tabId }
  }

  const target: chrome.scripting.InjectionTarget = rec.frameIds && rec.frameIds.length
    ? { tabId: rec.tabId, frameIds: rec.frameIds }
    : { tabId: rec.tabId, allFrames: rec.allFrames }

  try {
    await chrome.scripting.removeCSS({
      target,
      css: rec.css,
      origin: rec.origin
    })
  } catch (err) {
    handleStore.delete(handle)
    return {
      success: true,
      data: {
        removed: false,
        reason: `removeCSS threw (tab may be closed): ${(err as Error).message}`
      },
      tabId
    }
  }

  handleStore.delete(handle)
  return { success: true, data: { removed: true }, tabId }
}

export async function handleStyleActions(
  action: { type: string; [key: string]: unknown },
  tabId: number
): Promise<ActionResult> {
  if (action.type === "style_inject") return handleStyleInject(action, tabId)
  if (action.type === "style_remove") return handleStyleRemove(action, tabId)
  return { success: false, error: `unknown style action: ${action.type}` }
}
