/**
 * test/exports-json-envelope.test.ts
 *
 * Round-trip and schema-shape tests for the native JSON export envelope.
 */

import { describe, expect, test } from "bun:test"
import { buildJsonEnvelope } from "../shared/exports/json-envelope"
import type { UnifiedCapture, ExportMetadata, InterceptorExport } from "../shared/exports/types"

const META: ExportMetadata = {
  generatorName: "interceptor",
  generatorVersion: "9.9.9",
  generatedAt: new Date("2026-05-16T17:00:00.000Z"),
  source: "net-log",
}

function fixture(): UnifiedCapture[] {
  return [
    {
      url: "https://example.com/api",
      method: "GET",
      status: 200,
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_100,
      durationMs: 100,
      source: "fetch",
      requestHeaders: { accept: "application/json" },
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"hello":"world"}',
      responseContentType: "application/json",
      truncated: false,
    },
    {
      url: "https://example.com/icon.png",
      method: "GET",
      status: 200,
      startedAt: 1_700_000_001_000,
      endedAt: 1_700_000_001_050,
      durationMs: 50,
      source: "fetch",
      requestHeaders: {},
      responseHeaders: { "content-type": "image/png" },
      responseBody: "raw bytes",
      responseContentType: "image/png",
      truncated: false,
    },
    {
      url: "https://example.com/stream",
      method: "POST",
      status: 200,
      startedAt: 1_700_000_002_000,
      endedAt: 1_700_000_002_500,
      durationMs: 500,
      source: "sse",
      requestHeaders: {},
      responseHeaders: { "content-type": "text/event-stream" },
      responseBody: "data: 1\n\n",
      responseContentType: "text/event-stream",
      truncated: true,
    },
  ]
}

describe("JSON envelope export", () => {
  test("schemaVersion is the literal 1.0.0", () => {
    const out = buildJsonEnvelope(fixture(), META)
    expect(out.schemaVersion).toBe("1.0.0")
  })

  test("generator block reflects the metadata", () => {
    const out = buildJsonEnvelope(fixture(), META)
    expect(out.generator.name).toBe("interceptor")
    expect(out.generator.version).toBe("9.9.9")
    expect(out.generator.generatedAt).toBe("2026-05-16T17:00:00.000Z")
  })

  test("source is 'net-log' or 'monitor-export'", () => {
    const out = buildJsonEnvelope(fixture(), META)
    expect(out.source).toBe("net-log")
  })

  test("entries.length matches captures.length", () => {
    const captures = fixture()
    const out = buildJsonEnvelope(captures, META)
    expect(out.entries.length).toBe(captures.length)
  })

  test("round-trip JSON.parse(JSON.stringify(out)) is deep equal", () => {
    const out = buildJsonEnvelope(fixture(), META)
    const rt = JSON.parse(JSON.stringify(out)) as InterceptorExport
    expect(rt).toEqual(out)
  })

  test("base64 encoding applied to binary MIME prefixes", () => {
    const out = buildJsonEnvelope(fixture(), META)
    const png = out.entries[1]
    expect(png.response.content.mimeType).toBe("image/png")
    expect(png.response.content.encoding).toBe("base64")
    expect(png.response.content.text).toBeDefined()
    // base64 charset
    expect(png.response.content.text!).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  test("truncated flag propagates", () => {
    const out = buildJsonEnvelope(fixture(), META)
    expect(out.entries[0].response.truncated).toBe(false)
    expect(out.entries[2].response.truncated).toBe(true)
  })

  test("ISO 8601 startedAt", () => {
    const out = buildJsonEnvelope(fixture(), META)
    for (const e of out.entries) {
      expect(new Date(e.startedAt).toISOString()).toBe(e.startedAt)
    }
  })

  test("session metadata flows through when provided", () => {
    const out = buildJsonEnvelope([], {
      ...META,
      source: "monitor-export",
      session: {
        sid: "abc-123",
        startedAt: "2026-05-16T17:00:00.000Z",
        rootTabId: 42,
        counts: { evt: 100, mut: 50, net: 25, nav: 5 },
      },
    })
    expect(out.source).toBe("monitor-export")
    expect(out.session?.sid).toBe("abc-123")
    expect(out.session?.counts?.net).toBe(25)
  })
})
