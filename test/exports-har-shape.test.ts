/**
 * test/exports-har-shape.test.ts
 *
 * Validates that shared/exports/har.ts produces a HAR 1.2 document whose
 * shape matches the spec invariants documented in docs/HAR/*.md. No external
 * validator — the test enforces every required-field invariant inline.
 */

import { describe, expect, test } from "bun:test"
import { buildHar } from "../shared/exports/har"
import type { UnifiedCapture, ExportMetadata } from "../shared/exports/types"

const META: ExportMetadata = {
  generatorName: "interceptor",
  generatorVersion: "9.9.9",
  generatedAt: new Date(0),
  source: "net-log",
}

function syntheticCaptures(): UnifiedCapture[] {
  return [
    {
      url: "https://example.com/api/users?limit=10",
      method: "GET",
      status: 200,
      startedAt: 1_000_000,
      endedAt: 1_000_100,
      durationMs: 100,
      source: "fetch",
      requestHeaders: { accept: "application/json", cookie: "sid=abc; lang=en" },
      responseHeaders: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": "newsid=xyz; Path=/; HttpOnly\nflag=on; Path=/; Secure",
      },
      responseBody: '{"ok":true}',
      responseContentType: "application/json; charset=utf-8",
      truncated: false,
    },
    {
      url: "https://example.com/img/logo.png",
      method: "GET",
      status: 200,
      startedAt: 1_000_200,
      endedAt: 1_000_250,
      durationMs: 50,
      source: "fetch",
      requestHeaders: {},
      responseHeaders: { "content-type": "image/png" },
      responseBody: "ÿØÿà",      // pretend binary
      responseContentType: "image/png",
      truncated: false,
    },
    {
      url: "https://example.com/stream",
      method: "POST",
      status: 200,
      startedAt: 1_000_300,
      endedAt: 1_000_900,
      durationMs: 600,
      source: "sse",
      requestHeaders: { accept: "text/event-stream" },
      responseHeaders: { "content-type": "text/event-stream" },
      responseBody: "event: tick\ndata: 1\n\n",
      responseContentType: "text/event-stream",
      truncated: true,
    },
  ]
}

describe("HAR export — shape and invariants", () => {
  const captures = syntheticCaptures()
  const har = buildHar(captures, META)

  test("log.version is the literal '1.2'", () => {
    expect(har.log.version).toBe("1.2")
  })

  test("log.creator carries the interceptor name and version we passed", () => {
    expect(har.log.creator.name).toBe("interceptor")
    expect(har.log.creator.version).toBe("9.9.9")
  })

  test("entries.length matches captures.length", () => {
    expect(har.log.entries.length).toBe(captures.length)
  })

  test("every entry has request, response, cache, timings", () => {
    for (const e of har.log.entries) {
      expect(e.request).toBeDefined()
      expect(e.response).toBeDefined()
      expect(e.cache).toBeDefined()
      expect(e.timings).toBeDefined()
    }
  })

  test("entry.time === sum of non-(-1) timings (docs/HAR/14-timings.md invariant)", () => {
    for (const e of har.log.entries) {
      const t = e.timings
      const fields: number[] = [t.blocked, t.dns, t.connect, t.send, t.wait, t.receive, t.ssl]
      const sum = fields.reduce((acc, v) => (v >= 0 ? acc + v : acc), 0)
      expect(e.time).toBe(sum)
    }
  })

  test("request.queryString is parsed from the URL search params", () => {
    const first = har.log.entries[0]
    expect(first.request.queryString.length).toBe(1)
    expect(first.request.queryString[0]).toEqual({ name: "limit", value: "10" })
  })

  test("request.cookies are parsed from the Cookie header", () => {
    const first = har.log.entries[0]
    expect(first.request.cookies.length).toBe(2)
    expect(first.request.cookies[0].name).toBe("sid")
    expect(first.request.cookies[0].value).toBe("abc")
    expect(first.request.cookies[1].name).toBe("lang")
  })

  test("response.cookies parses multi-value Set-Cookie (joined by \\n upstream)", () => {
    const first = har.log.entries[0]
    expect(first.response.cookies.length).toBe(2)
    expect(first.response.cookies[0].name).toBe("newsid")
    expect(first.response.cookies[0].httpOnly).toBe(true)
    expect(first.response.cookies[1].name).toBe("flag")
    expect(first.response.cookies[1].secure).toBe(true)
  })

  test("response.headers is populated (non-empty for entries with captured headers)", () => {
    const first = har.log.entries[0]
    expect(first.response.headers.length).toBeGreaterThan(0)
    // The Set-Cookie was joined with \n by the upstream capture layer; the
    // encoder splits it back into two separate header rows so HAR consumers
    // see them as the browser did.
    const setCookieRows = first.response.headers.filter((h) => h.name === "set-cookie")
    expect(setCookieRows.length).toBe(2)
  })

  test("binary response bodies get base64 encoding", () => {
    const png = har.log.entries[1]
    expect(png.response.content.mimeType).toBe("image/png")
    expect(png.response.content.encoding).toBe("base64")
    // text should be base64 — at minimum non-empty and only base64 chars.
    expect(png.response.content.text).toBeDefined()
    expect(png.response.content.text!).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  test("response.content.size is the UTF-8 byte length", () => {
    const first = har.log.entries[0]
    const expected = new TextEncoder().encode('{"ok":true}').byteLength
    expect(first.response.content.size).toBe(expected)
  })

  test("_source custom field reflects the UnifiedCapture source", () => {
    expect(har.log.entries[0]._source).toBe("fetch")
    expect(har.log.entries[2]._source).toBe("sse")
  })

  test("_truncated custom field set only on truncated entries", () => {
    expect(har.log.entries[0]._truncated).toBeUndefined()
    expect(har.log.entries[2]._truncated).toBe(true)
  })

  test("custom fields start with underscore (docs/HAR/15 rule)", () => {
    for (const e of har.log.entries) {
      for (const key of Object.keys(e)) {
        const harDefined = new Set([
          "pageref",
          "startedDateTime",
          "time",
          "request",
          "response",
          "cache",
          "timings",
          "serverIPAddress",
          "connection",
          "comment",
        ])
        if (!harDefined.has(key)) {
          expect(key.startsWith("_")).toBe(true)
        }
      }
    }
  })

  test("statusText maps known codes", () => {
    expect(har.log.entries[0].response.statusText).toBe("OK")
  })

  test("startedDateTime is ISO 8601", () => {
    for (const e of har.log.entries) {
      expect(new Date(e.startedDateTime).toISOString()).toBe(e.startedDateTime)
    }
  })
})
