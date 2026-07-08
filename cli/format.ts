/**
 * cli/format.ts — output formatting helpers
 */

const USER_SCRIPTS_DISABLED_REASON = "user_scripts_disabled"
const USER_SCRIPTS_DISABLED_EVAL_MESSAGE =
  'eval can\'t run: at chrome://extensions → Interceptor → Details, enable "Allow user scripts" (Developer mode on), then retry.'

function hasUserScriptsDisabledSignal(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { reason?: unknown }).reason === USER_SCRIPTS_DISABLED_REASON
  )
}

// Replace CSP-blocked-eval errors with an actionable structured message and
// strip the leaked chrome-extension://<id> URL. A userScripts-disabled signal
// wins first; unflagged CSP failures keep the legacy page-CSP guidance.
export function rewriteCspEvalError(raw: string | undefined, data?: unknown): string | undefined {
  // When the extension reports this reason, the CSP-looking fallback failure is
  // caused by Chrome's per-extension userScripts toggle being disabled.
  if (hasUserScriptsDisabledSignal(data)) return USER_SCRIPTS_DISABLED_EVAL_MESSAGE
  if (!raw) return raw
  const cspPatterns = [
    /content security policy.*(?:script-src|unsafe-eval|eval)/i,
    /(?:'unsafe-eval'|unsafe-eval).*not.*allowed.*source.*script/i,
    /refused to (?:create|evaluate).*string.*javascript/i,
    /(?:eval|evaluating a string).*(?:not.*allowed|content security)/i,
  ]
  if (!cspPatterns.some(re => re.test(raw))) return raw
  return [
    "page CSP blocks eval.",
    "Use 'interceptor html <ref>', 'interceptor read', 'interceptor text <ref>',",
    "or 'interceptor find \"<query>\"' for structured-tree access instead.",
  ].join("\n  ")
}

export function formatState(data: {
  url: string
  title: string
  elementTree: string
  focused?: string
  staticText?: string
  scrollPosition: { y: number; height: number; viewportHeight: number }
  tabId: number
}) {
  const scroll = data.scrollPosition
  let out = `url: ${data.url}\ntitle: ${data.title}\nscroll: ${scroll.y}/${scroll.height} (vh:${scroll.viewportHeight})\ntab: ${data.tabId}\nfocused: ${data.focused || "none"}\n\n${data.elementTree}`
  if (data.staticText) {
    out += `\n---\n${data.staticText}`
  }
  return out
}

export function formatTabs(tabs: { id: number; url: string; title: string; active: boolean }[]) {
  return tabs.map(t => `${t.active ? "*" : " "} ${t.id}  ${t.url}  ${t.title}`).join("\n")
}

export function formatCookies(cookies: { name: string; value: string; domain: string; path: string }[]) {
  return cookies.map(c => `${c.domain}${c.path}  ${c.name}=${c.value}`).join("\n")
}

export function formatResult(result: { success: boolean; error?: string; data?: unknown }, jsonMode: boolean): string {
  if (jsonMode) return JSON.stringify(result, null, 2)

  if (!result.success) {
    const cleaned = rewriteCspEvalError(result.error, result.data)
    return `error: ${cleaned}`
  }
  if (result.data === undefined || result.data === null) return "ok"
  if (typeof result.data === "string") return result.data
  if (typeof result.data === "number" || typeof result.data === "boolean") return String(result.data)
  return JSON.stringify(result.data, null, 2)
}
