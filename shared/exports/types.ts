/**
 * shared/exports/types.ts — types shared by the HAR, pcapng, and JSON envelope encoders.
 *
 * Pure types only. No I/O. Safe to import from CLI, daemon, or (in principle) extension code.
 *
 * Format references:
 *   - HAR 1.2: http://www.softwareishard.com/blog/har-12-spec/
 *   - pcapng:  https://www.ietf.org/archive/id/draft-tuexen-opsawg-pcapng-03.html
 *   - The JSON envelope shape is defined here (this file) and consumed by
 *     `shared/exports/json-envelope.ts` — `schemaVersion` is the contract.
 */

export type ExportFormat = "text" | "json" | "har" | "pcapng" | "plan"

export type CaptureSource = "fetch" | "xhr" | "sse" | "cdp" | "monitor"

/**
 * UnifiedCapture is the single input shape every encoder consumes. It's
 * produced by unify.ts from either passive net-log entries or persisted
 * monitor session artifacts.
 */
export type UnifiedCapture = {
  url: string
  method: string
  status: number
  startedAt: number              // wall-clock ms; equal to endedAt when only completion time is known
  endedAt: number                // wall-clock ms (Date.now at capture event)
  durationMs: number             // endedAt - startedAt; 0 when only completion is known
  source: CaptureSource

  requestHeaders: Record<string, string>     // empty record if not captured
  responseHeaders: Record<string, string>    // empty record if not captured

  responseBody: string                       // empty string if not captured / SSE-only
  responseContentType?: string
  truncated: boolean

  // optional fields (CDP source)
  requestPostData?: string
  // optional fields (monitor source)
  cause?: number
  tabId?: number
  seq?: number
  bodyBytes?: number             // monitor artifacts store byte count even when body preview was trimmed
}

/**
 * Native JSON envelope. Schema-versioned and self-describing.
 * Shipped by `interceptor net log --format json` and `interceptor monitor export --format json`.
 */
export type InterceptorExport = {
  schemaVersion: "1.0.0"
  generator: {
    name: "interceptor"
    version: string
    generatedAt: string          // ISO 8601
  }
  source: "net-log" | "monitor-export"
  session?: {
    sid: string
    startedAt: string            // ISO 8601
    endedAt?: string
    rootTabId?: number
    instruction?: string
    counts?: { evt: number; mut: number; net: number; nav: number }
  }
  entries: InterceptorEntry[]
}

export type InterceptorEntry = {
  url: string
  method: string
  status: number
  startedAt: string              // ISO 8601
  endedAt?: string
  durationMs?: number
  source: CaptureSource
  request: {
    headers: Record<string, string>
    postData?: { mimeType: string; text?: string; encoding?: "base64" }
  }
  response: {
    headers: Record<string, string>
    contentType?: string
    content: {
      mimeType: string
      sizeBytes: number
      text?: string
      encoding?: "base64"
    }
    truncated: boolean
  }
  cause?: { idx: number; ref?: string; role?: string; name?: string }
  tabId?: number
  seq?: number
}

/**
 * Options for the unify functions and the encoder dispatch.
 */
export type ExportMetadata = {
  generatorName?: string         // default "interceptor"
  generatorVersion?: string      // package.json version
  generatedAt?: Date             // default new Date()
  source: "net-log" | "monitor-export"
  session?: InterceptorExport["session"]
  // Free-form comment ferried into HAR `log.comment` / pcapng SHB `opt_comment`.
  comment?: string
}
