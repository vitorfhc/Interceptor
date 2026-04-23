import { resolveElement } from "../input-simulation"

type Action = { type: string; [key: string]: unknown }
type ActionResult = { success: boolean; error?: string; warning?: string; data?: unknown }

export async function handleExtractText(action: Action): Promise<ActionResult> {
  if (action.index !== undefined || action.ref !== undefined) {
    const el = resolveElement(action.index as number | undefined, action.ref as string | undefined)
    if (!el) {
      const label = String(action.ref ?? action.index ?? "unknown")
      return { success: false, error: `stale element [${label}] — run interceptor state to refresh` }
    }
    return { success: true, data: (el.textContent || "").trim() }
  }
  return { success: true, data: document.body.innerText.slice(0, 10000) }
}

export async function handleExtractHtml(action: Action): Promise<ActionResult> {
  if (action.index !== undefined || action.ref !== undefined) {
    const el = resolveElement(action.index as number | undefined, action.ref as string | undefined)
    if (!el) {
      const label = String(action.ref ?? action.index ?? "unknown")
      return { success: false, error: `stale element [${label}] — run interceptor state to refresh` }
    }
    return { success: true, data: el.outerHTML.slice(0, 10000) }
  }
  return { success: true, data: document.documentElement.outerHTML.slice(0, 50000) }
}
