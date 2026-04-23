import { sendToContentScript } from "../content-bridge"

type ActionResult = { success: boolean; error?: string; data?: unknown; tabId?: number }

type FrameTreeEntry = {
  frameId: number
  parentFrameId: number
  url: string
  opaque?: true
  error?: string
  tree?: string
  text?: string
}

export async function handleFrameActions(
  action: { type: string; [key: string]: unknown },
  tabId: number
): Promise<ActionResult> {
  if (action.type === "frames_list") {
    const frames = await chrome.webNavigation.getAllFrames({ tabId })
    return {
      success: true,
      data: frames?.map(f => ({ frameId: f.frameId, url: f.url, parentFrameId: f.parentFrameId }))
    }
  }

  if (action.type === "frames_read_tree") {
    const depth = (action.depth as number) || 15
    const filter = (action.filter as string) || "interactive"
    const maxChars = (action.maxChars as number) || 50000
    const includeStyle = action.includeStyle === true
    const includeText = action.includeText === true
    const targetFrameId = typeof action.frameId === "number" ? action.frameId : undefined
    const targetIndex = typeof action.index === "number" ? action.index : undefined
    const targetRef = typeof action.ref === "string" ? action.ref : undefined

    let frames: chrome.webNavigation.GetAllFrameResultDetails[] | undefined
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId }) || undefined
    } catch (err) {
      return { success: false, error: `getAllFrames failed: ${(err as Error).message}` }
    }
    if (!frames || !frames.length) {
      return { success: true, data: { frames: [] }, tabId }
    }
    const frameList = targetFrameId === undefined
      ? frames
      : frames.filter((frame) => frame.frameId === targetFrameId)

    const results: FrameTreeEntry[] = await Promise.all(frameList.map(async (f) => {
      const entry: FrameTreeEntry = {
        frameId: f.frameId,
        parentFrameId: f.parentFrameId,
        url: f.url
      }
      try {
        const treeAction: { type: string; [key: string]: unknown } = {
          type: "get_a11y_tree",
          depth,
          filter,
          maxChars,
          includeStyle,
          frameId: f.frameId
        }
        if (targetIndex !== undefined) treeAction.index = targetIndex
        if (targetRef) treeAction.ref = targetRef
        const treeResp = await sendToContentScript(
          tabId,
          treeAction,
          f.frameId
        ) as { success: boolean; error?: string; data?: unknown }
        if (!treeResp.success) {
          entry.opaque = true
          entry.error = treeResp.error || "unreachable frame"
        } else {
          const raw = typeof treeResp.data === "string" ? treeResp.data : ""
          entry.tree = f.frameId === 0
            ? raw
            : raw.replace(/\[e(\d+)\]/g, `[e${f.frameId}_$1]`)
        }
        if (includeText) {
          const textAction: { type: string; [key: string]: unknown } = { type: "extract_text", frameId: f.frameId }
          if (targetIndex !== undefined) textAction.index = targetIndex
          if (targetRef) textAction.ref = targetRef
          const textResp = await sendToContentScript(
            tabId,
            textAction,
            f.frameId
          ) as { success: boolean; data?: unknown }
          if (textResp.success && typeof textResp.data === "string") {
            entry.text = textResp.data
          }
        }
      } catch (err) {
        entry.opaque = true
        entry.error = (err as Error).message || "injection failed"
      }
      return entry
    }))

    return { success: true, data: { frames: results }, tabId }
  }

  return { success: false, error: `unknown frame action: ${action.type}` }
}
