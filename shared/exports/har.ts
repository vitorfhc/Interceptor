/**
 * shared/exports/har.ts — UnifiedCapture[] → HAR 1.2 document.
 *
 * Pure function. Returns the HAR JSON object; the caller stringifies and writes.
 *
 * Format reference: HAR 1.2 spec at http://www.softwareishard.com/blog/har-12-spec/
 *
 * Field-by-field mapping decisions:
 *   - `version` is the literal "1.2".
 *   - Required arrays (request.cookies / request.headers / request.queryString /
 *     response.cookies / response.headers) are always emitted, possibly empty.
 *   - `entry.time` MUST equal the sum of non-(-1) timings; we synthesise
 *     send=0, wait=floor(0.9*dur), receive=dur-wait so the invariant holds
 *     when only a total duration is known.
 *   - `headersSize` / `bodySize` are `-1` when not measured by the capture.
 *   - Custom fields (`_source`, `_truncated`, `_initiator`) start with
 *     underscore per the HAR spec's custom-fields rule.
 */

import type { UnifiedCapture, ExportMetadata } from "./types"

// HAR document shape — minimal slice we generate. Consumers parse the full
// 1.2 spec but only this subset is required to be valid.
export type HarDocument = {
  log: {
    version: "1.2"
    creator: { name: string; version: string; comment?: string }
    browser?: { name: string; version: string }
    pages?: HarPage[]
    entries: HarEntry[]
    comment?: string
  }
}

export type HarPage = {
  startedDateTime: string
  id: string
  title: string
  pageTimings: { onContentLoad: number; onLoad: number; comment?: string }
}

export type HarEntry = {
  pageref?: string
  startedDateTime: string
  time: number
  request: HarRequest
  response: HarResponse
  cache: Record<string, never>
  timings: HarTimings
  // Custom fields per HAR 1.2 §"Custom Fields" — MUST start with underscore.
  _source: UnifiedCapture["source"]
  _truncated?: boolean
  _initiator?: { cause?: number; tabId?: number; seq?: number }
}

export type HarRequest = {
  method: string
  url: string
  httpVersion: string
  cookies: HarCookie[]
  headers: HarHeader[]
  queryString: HarQueryParam[]
  postData?: { mimeType: string; text?: string; params?: HarParam[] }
  headersSize: number
  bodySize: number
}

export type HarResponse = {
  status: number
  statusText: string
  httpVersion: string
  cookies: HarCookie[]
  headers: HarHeader[]
  content: HarContent
  redirectURL: string
  headersSize: number
  bodySize: number
}

export type HarHeader = { name: string; value: string }
export type HarCookie = {
  name: string
  value: string
  path?: string
  domain?: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
}
export type HarQueryParam = { name: string; value: string }
export type HarParam = { name: string; value?: string; fileName?: string; contentType?: string }
export type HarContent = {
  size: number
  mimeType: string
  text?: string
  encoding?: "base64"
  compression?: number
}
export type HarTimings = {
  blocked: number
  dns: number
  connect: number
  send: number
  wait: number
  receive: number
  ssl: number
}

// MIME type prefixes that warrant base64 encoding (HAR `content.encoding: "base64"`).
// docs/HAR/12-content.md "Rules for text / encoding".
// MIME types we know are text. Anything else under application/* is treated
// as binary and base64-encoded into HAR content.text per the spec rule at
// docs/HAR/12-content.md ("Rules for text / encoding").
const TEXT_APPLICATION_SUBTYPES = new Set<string>([
  "json",
  "ld+json",
  "manifest+json",
  "vnd.api+json",
  "xml",
  "atom+xml",
  "rss+xml",
  "xhtml+xml",
  "javascript",
  "ecmascript",
  "x-javascript",
  "x-www-form-urlencoded",
  "graphql",
  "yaml",
  "x-yaml",
  "x-ndjson",
  "x-ldjson",
  "csp-report",
])

function isBinaryMime(mime: string | undefined): boolean {
  if (!mime) return false
  const m = mime.toLowerCase()
  // Anchor on the type/subtype only, ignore parameters like `;charset=...`.
  const slash = m.indexOf("/")
  if (slash < 0) return false
  const type = m.slice(0, slash)
  const subtype = m.slice(slash + 1).split(";")[0].trim()

  if (type === "text") return false
  if (type === "image" || type === "audio" || type === "video" || type === "font") return true
  if (type === "application") {
    if (TEXT_APPLICATION_SUBTYPES.has(subtype)) return false
    if (subtype.endsWith("+json") || subtype.endsWith("+xml")) return false
    // Everything else under application/* (octet-stream, pdf, zip, protobuf,
    // vendor types like vnd.yt-ump, vnd.apple.mpegurl, etc.) — treat as binary.
    return true
  }
  return false
}

// Map a small set of common HTTP status codes to canonical statusText.
// For everything else we emit "" which the HAR spec allows.
function statusTextFor(status: number): string {
  switch (status) {
    case 100: return "Continue"
    case 101: return "Switching Protocols"
    case 200: return "OK"
    case 201: return "Created"
    case 202: return "Accepted"
    case 204: return "No Content"
    case 206: return "Partial Content"
    case 301: return "Moved Permanently"
    case 302: return "Found"
    case 303: return "See Other"
    case 304: return "Not Modified"
    case 307: return "Temporary Redirect"
    case 308: return "Permanent Redirect"
    case 400: return "Bad Request"
    case 401: return "Unauthorized"
    case 403: return "Forbidden"
    case 404: return "Not Found"
    case 405: return "Method Not Allowed"
    case 408: return "Request Timeout"
    case 409: return "Conflict"
    case 410: return "Gone"
    case 413: return "Payload Too Large"
    case 415: return "Unsupported Media Type"
    case 418: return "I'm a teapot"
    case 422: return "Unprocessable Entity"
    case 429: return "Too Many Requests"
    case 500: return "Internal Server Error"
    case 501: return "Not Implemented"
    case 502: return "Bad Gateway"
    case 503: return "Service Unavailable"
    case 504: return "Gateway Timeout"
    default: return ""
  }
}

function isoFrom(ms: number): string {
  if (!ms) return new Date(0).toISOString()
  return new Date(ms).toISOString()
}

function headersToArray(headers: Record<string, string>): HarHeader[] {
  const out: HarHeader[] = []
  for (const [name, value] of Object.entries(headers)) {
    // Multiple values are joined with \n by the capture layer; split them
    // back into individual header rows so HAR consumers see them as the
    // browser did. docs/HAR/09-headers.md "Duplicate names are allowed".
    if (value.includes("\n")) {
      for (const v of value.split("\n")) out.push({ name, value: v })
    } else {
      out.push({ name, value })
    }
  }
  return out
}

function parseQueryString(url: string): HarQueryParam[] {
  try {
    const u = new URL(url)
    const out: HarQueryParam[] = []
    u.searchParams.forEach((value, name) => out.push({ name, value }))
    return out
  } catch {
    return []
  }
}

function parseRequestCookies(headers: Record<string, string>): HarCookie[] {
  const cookieHeader = headers["cookie"] || headers["Cookie"]
  if (!cookieHeader) return []
  const out: HarCookie[] = []
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=")
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name) out.push({ name, value })
  }
  return out
}

function parseSetCookieValue(setCookie: string): HarCookie | null {
  // Set-Cookie: name=value; Path=/; Domain=example.com; Expires=...; Secure; HttpOnly
  const parts = setCookie.split(";")
  if (parts.length === 0) return null
  const first = parts[0]
  const eq = first.indexOf("=")
  if (eq <= 0) return null
  const cookie: HarCookie = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim(),
  }
  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i].trim()
    const lower = attr.toLowerCase()
    if (lower === "secure") { cookie.secure = true; continue }
    if (lower === "httponly") { cookie.httpOnly = true; continue }
    const aEq = attr.indexOf("=")
    if (aEq <= 0) continue
    const k = attr.slice(0, aEq).trim().toLowerCase()
    const v = attr.slice(aEq + 1).trim()
    if (k === "path") cookie.path = v
    else if (k === "domain") cookie.domain = v
    else if (k === "expires") cookie.expires = v
  }
  return cookie
}

function parseResponseCookies(headers: Record<string, string>): HarCookie[] {
  // Capture layer joins multiple Set-Cookie values with \n.
  const sc = headers["set-cookie"] || headers["Set-Cookie"]
  if (!sc) return []
  const out: HarCookie[] = []
  for (const line of sc.split("\n")) {
    const cookie = parseSetCookieValue(line)
    if (cookie) out.push(cookie)
  }
  return out
}

function byteLengthOf(str: string): number {
  // TextEncoder.encode reports UTF-8 byte length — what HAR's content.size wants
  // (docs/HAR/12-content.md "size" field).
  return new TextEncoder().encode(str).byteLength
}

function maybeBase64(body: string, mime: string | undefined): { text: string; encoding?: "base64" } {
  if (!isBinaryMime(mime)) return { text: body }
  // The capture layer stored bytes as a JS string via Response.text() — that's
  // already lossy for true binary, but base64-encoding the lossy string at least
  // preserves what we have. Real binary fidelity requires a separate capture mode.
  // For Bun and modern browsers, btoa works on Latin-1 code points only — fall back
  // to TextEncoder + base64 over bytes when btoa throws.
  try {
    return { text: btoa(body), encoding: "base64" }
  } catch {
    const bytes = new TextEncoder().encode(body)
    let bin = ""
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
    return { text: btoa(bin), encoding: "base64" }
  }
}

function buildEntry(capture: UnifiedCapture): HarEntry {
  const queryString = parseQueryString(capture.url)
  const requestHeaders = headersToArray(capture.requestHeaders)
  const responseHeaders = headersToArray(capture.responseHeaders)
  const requestCookies = parseRequestCookies(capture.requestHeaders)
  const responseCookies = parseResponseCookies(capture.responseHeaders)

  const bodySize = capture.bodyBytes ?? byteLengthOf(capture.responseBody)
  const { text, encoding } = maybeBase64(capture.responseBody, capture.responseContentType)
  const mimeType = capture.responseContentType || "application/octet-stream"

  // Spec invariant docs/HAR/14-timings.md:
  //   entry.time === blocked + dns + connect + send + wait + receive   (when no -1)
  // We have only durationMs total. Synthesise send=0, wait=0.9*dur, receive=0.1*dur
  // and emit -1 for blocked/dns/connect/ssl. Sum of non-(-1) = wait + receive = dur.
  const total = capture.durationMs
  const wait = Math.floor(total * 0.9)
  const receive = total - wait
  const time = wait + receive
  const timings: HarTimings = {
    blocked: -1,
    dns: -1,
    connect: -1,
    send: 0,
    wait,
    receive,
    ssl: -1,
  }

  const entry: HarEntry = {
    startedDateTime: isoFrom(capture.startedAt),
    time,
    request: {
      method: capture.method,
      url: capture.url,
      httpVersion: "HTTP/1.1",
      cookies: requestCookies,
      headers: requestHeaders,
      queryString,
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: capture.status,
      statusText: statusTextFor(capture.status),
      httpVersion: "HTTP/1.1",
      cookies: responseCookies,
      headers: responseHeaders,
      content: {
        size: bodySize,
        mimeType,
        ...(text ? { text } : {}),
        ...(encoding ? { encoding } : {}),
      },
      redirectURL: "",
      headersSize: -1,
      bodySize,
    },
    cache: {},
    timings,
    _source: capture.source,
  }

  if (capture.truncated) entry._truncated = true
  if (capture.cause !== undefined || capture.tabId !== undefined || capture.seq !== undefined) {
    entry._initiator = {
      ...(capture.cause !== undefined ? { cause: capture.cause } : {}),
      ...(capture.tabId !== undefined ? { tabId: capture.tabId } : {}),
      ...(capture.seq !== undefined ? { seq: capture.seq } : {}),
    }
  }

  if (capture.requestPostData) {
    const reqContentType = capture.requestHeaders["content-type"] || capture.requestHeaders["Content-Type"] || "application/octet-stream"
    entry.request.postData = { mimeType: reqContentType, text: capture.requestPostData }
  }

  return entry
}

export function buildHar(captures: UnifiedCapture[], meta: ExportMetadata): HarDocument {
  const generatorVersion = meta.generatorVersion || "0.0.0"
  const doc: HarDocument = {
    log: {
      version: "1.2",
      creator: {
        name: meta.generatorName || "interceptor",
        version: generatorVersion,
      },
      entries: captures.map(buildEntry),
    },
  }
  if (meta.comment) doc.log.comment = meta.comment
  return doc
}
