/**
 * shared/exports/unify.ts — convert raw capture sources into UnifiedCapture[].
 *
 * Two source shapes are handled:
 *   - PassiveCapturedEntry[] from `interceptor net log` (the in-page buffer).
 *   - MonitorNetArtifact[] from `interceptor monitor export <sid>` (persisted to net.jsonl).
 *
 * The output UnifiedCapture is the single input shape consumed by the HAR,
 * pcapng, and JSON envelope encoders.
 */

import type { UnifiedCapture, CaptureSource } from "./types"
import type { MonitorNetArtifact, MonitorEvent } from "../monitor-artifacts"

/**
 * Passive net-log entry shape (mirrors extension/src/content/net-buffer.ts).
 * Duplicated here to keep this module free of any direct extension imports.
 */
export type PassiveNetEntry = {
  url: string
  method: string
  status: number
  body: string
  type: string                              // "fetch" | "xhr" | "sse"
  timestamp: number
  tabUrl?: string
  contentType?: string
  truncated?: boolean
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
}

function entryTypeToSource(type: string): CaptureSource {
  if (type === "xhr") return "xhr"
  if (type === "sse") return "sse"
  return "fetch"
}

export function fromPassive(entries: PassiveNetEntry[]): UnifiedCapture[] {
  return entries.map((e) => ({
    url: e.url,
    method: e.method,
    status: e.status,
    // Passive surface only records completion time; we don't know real start.
    // Encoders that need a start time will treat startedAt === endedAt as
    // "duration unknown — synthesise zero".
    startedAt: e.timestamp,
    endedAt: e.timestamp,
    durationMs: 0,
    source: entryTypeToSource(e.type),
    requestHeaders: e.requestHeaders || {},
    responseHeaders: e.responseHeaders || {},
    responseBody: typeof e.body === "string" ? e.body : "",
    responseContentType: e.contentType,
    truncated: Boolean(e.truncated),
  }))
}

/**
 * Convert a monitor session's events.jsonl stream (filtered to fetch/xhr/sse
 * rows) into UnifiedCapture[]. Optionally enriches each row with the body
 * preview from net.jsonl via the `cause` match key when available.
 *
 * This is the right entry point for `interceptor monitor export <sid> --format <...>`
 * because the events stream carries the full timeline of network rows whereas
 * net.jsonl is only populated when `--with-bodies` recording was on.
 */
export function fromMonitorEvents(
  events: MonitorEvent[],
  artifacts?: MonitorNetArtifact[],
): UnifiedCapture[] {
  // Build two indexes into the body archive:
  //   - bySeq matches an event to its body artifact by event-sequence number.
  //     This is the precise match (each event has a unique `s` within a session),
  //     covers autonomous events that have no `cause`.
  //   - byCause stays as a fallback for older sessions whose artifacts only
  //     carry `cause` (early monitor recordings before --persist-bodies).
  const bySeq = new Map<number, MonitorNetArtifact>()
  const byCause = new Map<number, MonitorNetArtifact>()
  if (artifacts) {
    for (const a of artifacts) {
      if (typeof a.seq === "number") bySeq.set(a.seq, a)
      if (a.cause !== undefined) byCause.set(a.cause, a)
    }
  }

  const out: UnifiedCapture[] = []
  for (const ev of events) {
    if (ev.event !== "fetch" && ev.event !== "xhr" && ev.event !== "sse") continue

    const cause = typeof ev.cause === "number" ? ev.cause : undefined
    const seq = typeof ev.s === "number" ? ev.s : undefined
    const artifact = (seq !== undefined ? bySeq.get(seq) : undefined)
      || (cause !== undefined ? byCause.get(cause) : undefined)

    const url = typeof ev.u === "string" ? ev.u : ""
    const method = typeof ev.m === "string" ? ev.m : "GET"
    const status = typeof ev.st === "number" ? ev.st : 0
    const ts = typeof ev.t === "number" ? ev.t : 0
    const contentType =
      typeof ev.ct === "string"
        ? ev.ct
        : artifact?.contentType

    const bodyPreview =
      typeof ev.bp === "string"
        ? ev.bp
        : artifact?.bodyPreview || ""

    const truncated = Boolean(ev.trn ?? artifact?.truncated ?? false)
    const bodyBytes = typeof ev.bz === "number" ? ev.bz : artifact?.bodyBytes

    out.push({
      url,
      method,
      status,
      startedAt: ts,
      endedAt: ts,
      durationMs: 0,
      source: ev.event === "xhr" ? "xhr" : ev.event === "sse" ? "sse" : "fetch",
      requestHeaders: {},
      responseHeaders: contentType ? { "content-type": contentType } : {},
      responseBody: bodyPreview,
      responseContentType: contentType,
      truncated,
      cause,
      tabId: typeof ev.tid === "number" ? ev.tid : undefined,
      seq: typeof ev.s === "number" ? ev.s : undefined,
      bodyBytes,
    })
  }
  return out
}

export function fromMonitorArtifacts(artifacts: MonitorNetArtifact[]): UnifiedCapture[] {
  return artifacts.map((a) => ({
    url: a.url,
    method: a.method || "GET",
    status: a.status ?? 0,
    // MonitorNetArtifact does not record timestamps directly — the parent
    // event stream owns timing. Encoders that need it will use 0 and emit
    // sentinel timing values per the HAR mapping table.
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    source: "monitor",
    requestHeaders: {},
    responseHeaders: {},
    responseBody: a.bodyPreview || "",
    responseContentType: a.contentType,
    truncated: Boolean(a.truncated),
    cause: a.cause,
    tabId: a.tid,
    seq: a.seq,
    bodyBytes: a.bodyBytes,
  }))
}
