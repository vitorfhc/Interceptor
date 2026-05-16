/**
 * shared/exports/json-envelope.ts — UnifiedCapture[] + session meta → InterceptorExport.
 *
 * Schema-versioned JSON envelope. The shape is defined by `InterceptorExport`
 * in ./types.ts — `schemaVersion` is the stability contract. Lossless w.r.t.
 * the UnifiedCapture input (HAR-incompatible fields like the monitor cause
 * chain survive; binary bodies are base64-encoded when the MIME indicates a
 * non-text type via the same heuristic shared/exports/har.ts uses).
 */

import type {
  UnifiedCapture,
  InterceptorExport,
  InterceptorEntry,
  ExportMetadata,
} from "./types"

// See shared/exports/har.ts for the rationale. Kept in sync between encoders.
const TEXT_APPLICATION_SUBTYPES = new Set<string>([
  "json", "ld+json", "manifest+json", "vnd.api+json",
  "xml", "atom+xml", "rss+xml", "xhtml+xml",
  "javascript", "ecmascript", "x-javascript",
  "x-www-form-urlencoded", "graphql",
  "yaml", "x-yaml", "x-ndjson", "x-ldjson", "csp-report",
])

function isBinaryMime(mime: string | undefined): boolean {
  if (!mime) return false
  const m = mime.toLowerCase()
  const slash = m.indexOf("/")
  if (slash < 0) return false
  const type = m.slice(0, slash)
  const subtype = m.slice(slash + 1).split(";")[0].trim()
  if (type === "text") return false
  if (type === "image" || type === "audio" || type === "video" || type === "font") return true
  if (type === "application") {
    if (TEXT_APPLICATION_SUBTYPES.has(subtype)) return false
    if (subtype.endsWith("+json") || subtype.endsWith("+xml")) return false
    return true
  }
  return false
}

function byteLengthOf(str: string): number {
  return new TextEncoder().encode(str).byteLength
}

function maybeBase64(body: string, mime: string | undefined): { text?: string; encoding?: "base64" } {
  if (!body) return {}
  if (!isBinaryMime(mime)) return { text: body }
  try {
    return { text: btoa(body), encoding: "base64" }
  } catch {
    const bytes = new TextEncoder().encode(body)
    let bin = ""
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
    return { text: btoa(bin), encoding: "base64" }
  }
}

function buildEntry(c: UnifiedCapture): InterceptorEntry {
  const sizeBytes = c.bodyBytes ?? byteLengthOf(c.responseBody)
  const { text, encoding } = maybeBase64(c.responseBody, c.responseContentType)
  const mimeType = c.responseContentType || "application/octet-stream"

  const entry: InterceptorEntry = {
    url: c.url,
    method: c.method,
    status: c.status,
    startedAt: c.startedAt ? new Date(c.startedAt).toISOString() : new Date(0).toISOString(),
    source: c.source,
    request: {
      headers: c.requestHeaders,
    },
    response: {
      headers: c.responseHeaders,
      content: {
        mimeType,
        sizeBytes,
        ...(text !== undefined ? { text } : {}),
        ...(encoding ? { encoding } : {}),
      },
      truncated: c.truncated,
    },
  }

  if (c.endedAt) entry.endedAt = new Date(c.endedAt).toISOString()
  if (c.durationMs) entry.durationMs = c.durationMs
  if (c.responseContentType) entry.response.contentType = c.responseContentType
  if (c.requestPostData) {
    const reqMime = c.requestHeaders["content-type"] || c.requestHeaders["Content-Type"] || "application/octet-stream"
    entry.request.postData = { mimeType: reqMime, text: c.requestPostData }
  }
  if (c.cause !== undefined) {
    entry.cause = { idx: c.cause }
  }
  if (c.tabId !== undefined) entry.tabId = c.tabId
  if (c.seq !== undefined) entry.seq = c.seq

  return entry
}

export function buildJsonEnvelope(
  captures: UnifiedCapture[],
  meta: ExportMetadata,
): InterceptorExport {
  const generatedAt = (meta.generatedAt || new Date()).toISOString()
  const doc: InterceptorExport = {
    schemaVersion: "1.0.0",
    generator: {
      name: "interceptor",
      version: meta.generatorVersion || "0.0.0",
      generatedAt,
    },
    source: meta.source,
    entries: captures.map(buildEntry),
  }
  if (meta.session) doc.session = meta.session
  return doc
}
