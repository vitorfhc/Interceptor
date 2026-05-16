/**
 * test/exports-unify.test.ts
 *
 * shared/exports/unify.ts converts capture-source-specific shapes into the
 * UnifiedCapture[] shape the encoders consume. These tests pin the mapping
 * so future changes are caught.
 */

import { describe, expect, test } from "bun:test"
import { fromPassive, fromMonitorArtifacts, type PassiveNetEntry } from "../shared/exports/unify"
import type { MonitorNetArtifact } from "../shared/monitor-artifacts"

describe("fromPassive — PassiveNetEntry[] → UnifiedCapture[]", () => {
  const entries: PassiveNetEntry[] = [
    {
      url: "https://example.com/a",
      method: "GET",
      status: 200,
      body: "hi",
      type: "fetch",
      timestamp: 1_000_000,
      contentType: "text/plain",
      truncated: false,
      requestHeaders: { accept: "*/*" },
      responseHeaders: { "content-type": "text/plain" },
    },
    {
      url: "https://example.com/b",
      method: "POST",
      status: 201,
      body: "created",
      type: "xhr",
      timestamp: 1_000_100,
      contentType: "application/json",
    },
    {
      url: "https://example.com/c",
      method: "GET",
      status: 200,
      body: "stream",
      type: "sse",
      timestamp: 1_000_200,
      truncated: true,
    },
  ]

  const out = fromPassive(entries)

  test("each entry maps 1:1", () => {
    expect(out.length).toBe(entries.length)
  })

  test("source is derived from `type`", () => {
    expect(out[0].source).toBe("fetch")
    expect(out[1].source).toBe("xhr")
    expect(out[2].source).toBe("sse")
  })

  test("captured headers ride through", () => {
    expect(out[0].requestHeaders).toEqual({ accept: "*/*" })
    expect(out[0].responseHeaders).toEqual({ "content-type": "text/plain" })
    // missing headers fall back to empty objects
    expect(out[1].requestHeaders).toEqual({})
    expect(out[1].responseHeaders).toEqual({})
  })

  test("truncated flag preserved", () => {
    expect(out[0].truncated).toBe(false)
    expect(out[2].truncated).toBe(true)
  })

  test("timestamp populates both startedAt and endedAt (we don't know real start)", () => {
    expect(out[0].startedAt).toBe(entries[0].timestamp)
    expect(out[0].endedAt).toBe(entries[0].timestamp)
    expect(out[0].durationMs).toBe(0)
  })
})

describe("fromMonitorArtifacts — MonitorNetArtifact[] → UnifiedCapture[]", () => {
  const artifacts: MonitorNetArtifact[] = [
    {
      sid: "session-1",
      seq: 5,
      tid: 42,
      cause: 3,
      kind: "fetch",
      url: "https://example.com/api",
      method: "GET",
      status: 200,
      contentType: "application/json",
      truncated: false,
      bodyBytes: 17,
      bodyPreview: '{"ok":true}',
    },
  ]

  const out = fromMonitorArtifacts(artifacts)

  test("source is always 'monitor'", () => {
    expect(out[0].source).toBe("monitor")
  })

  test("cause / tabId / seq / bodyBytes flow through", () => {
    expect(out[0].cause).toBe(3)
    expect(out[0].tabId).toBe(42)
    expect(out[0].seq).toBe(5)
    expect(out[0].bodyBytes).toBe(17)
  })

  test("responseBody comes from bodyPreview", () => {
    expect(out[0].responseBody).toBe('{"ok":true}')
  })
})
