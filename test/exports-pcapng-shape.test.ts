/**
 * test/exports-pcapng-shape.test.ts
 *
 * Validates the binary layout of shared/exports/pcapng.ts against the
 * draft-tuexen-opsawg-pcapng-03 block format (docs/pcapng/*.md).
 *
 * Key invariants:
 *   - Byte 0..3 is the SHB block type 0x0A0D0D0A (written little-endian since
 *     the file is LE, but the magic is a palindromic byte sequence).
 *   - Byte-Order Magic at offset 8..11 == 0x1A2B3C4D (LE → 4D 3C 2B 1A on disk).
 *   - Major 1, Minor 0 at offsets 12 / 14.
 *   - Every block's leading Block Total Length === its trailing Block Total Length.
 *   - File length === sum of every block's Block Total Length.
 *   - One SHB, N IDBs (one per distinct origin), 2 EPBs per capture.
 */

import { describe, expect, test } from "bun:test"
import { buildPcapng } from "../shared/exports/pcapng"
import type { UnifiedCapture, ExportMetadata } from "../shared/exports/types"

const META: ExportMetadata = {
  generatorName: "interceptor",
  generatorVersion: "9.9.9",
  generatedAt: new Date(0),
  source: "net-log",
}

const BLOCK_TYPE_SHB = 0x0a0d0d0a
const BLOCK_TYPE_IDB = 0x00000001
const BLOCK_TYPE_EPB = 0x00000006

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

/** Walk the blocks. Returns array of {type, length, offset}. */
function walkBlocks(bytes: Uint8Array): Array<{ type: number; length: number; offset: number }> {
  const out: Array<{ type: number; length: number; offset: number }> = []
  let offset = 0
  while (offset + 8 <= bytes.byteLength) {
    const type = readUint32LE(bytes, offset)
    const length = readUint32LE(bytes, offset + 4)
    if (length < 12 || length % 4 !== 0 || offset + length > bytes.byteLength) break
    // Leading length must equal trailing length.
    const trailingLen = readUint32LE(bytes, offset + length - 4)
    if (trailingLen !== length) {
      throw new Error(`block at offset ${offset}: leading length ${length} != trailing ${trailingLen}`)
    }
    out.push({ type, length, offset })
    offset += length
  }
  return out
}

function syntheticCaptures(): UnifiedCapture[] {
  // Two captures on origin A, one on origin B → 2 IDBs + (2+1)*2 = 6 EPBs.
  return [
    {
      url: "https://a.example.com/x",
      method: "GET",
      status: 200,
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_050,
      durationMs: 50,
      source: "fetch",
      requestHeaders: { accept: "application/json" },
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"a":1}',
      responseContentType: "application/json",
      truncated: false,
    },
    {
      url: "https://a.example.com/y",
      method: "POST",
      status: 201,
      startedAt: 1_700_000_001_000,
      endedAt: 1_700_000_001_100,
      durationMs: 100,
      source: "xhr",
      requestHeaders: { "content-type": "application/json" },
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"b":2}',
      responseContentType: "application/json",
      truncated: false,
    },
    {
      url: "https://b.example.com/z",
      method: "GET",
      status: 200,
      startedAt: 1_700_000_002_000,
      endedAt: 1_700_000_002_020,
      durationMs: 20,
      source: "fetch",
      requestHeaders: {},
      responseHeaders: { "content-type": "text/plain" },
      responseBody: "hi",
      responseContentType: "text/plain",
      truncated: false,
    },
  ]
}

describe("pcapng export — binary shape", () => {
  const bytes = buildPcapng(syntheticCaptures(), META)

  test("file starts with the SHB block-type magic", () => {
    expect(bytes[0]).toBe(0x0a)
    expect(bytes[1]).toBe(0x0d)
    expect(bytes[2]).toBe(0x0d)
    expect(bytes[3]).toBe(0x0a)
  })

  test("byte-order magic at offset 8 is 0x1A2B3C4D (little-endian)", () => {
    const magic = readUint32LE(bytes, 8)
    expect(magic).toBe(0x1a2b3c4d)
  })

  test("SHB version is 1.0", () => {
    const major = readUint16LE(bytes, 12)
    const minor = readUint16LE(bytes, 14)
    expect(major).toBe(1)
    expect(minor).toBe(0)
  })

  test("walk yields one SHB + 2 IDBs + 6 EPBs", () => {
    const blocks = walkBlocks(bytes)
    const shb = blocks.filter((b) => b.type === BLOCK_TYPE_SHB)
    const idb = blocks.filter((b) => b.type === BLOCK_TYPE_IDB)
    const epb = blocks.filter((b) => b.type === BLOCK_TYPE_EPB)
    expect(shb.length).toBe(1)
    expect(idb.length).toBe(2)
    expect(epb.length).toBe(6)
  })

  test("total file length == sum of block lengths", () => {
    const blocks = walkBlocks(bytes)
    const sum = blocks.reduce((acc, b) => acc + b.length, 0)
    expect(sum).toBe(bytes.byteLength)
  })

  test("every block's total length is a multiple of 4 (alignment rule)", () => {
    const blocks = walkBlocks(bytes)
    for (const b of blocks) {
      expect(b.length % 4).toBe(0)
    }
  })

  test("first block after the SHB is an IDB (file layout rule)", () => {
    const blocks = walkBlocks(bytes)
    expect(blocks[1].type).toBe(BLOCK_TYPE_IDB)
  })

  test("empty capture list still produces a valid SHB + at-least-one-IDB file", () => {
    const emptyBytes = buildPcapng([], META)
    const blocks = walkBlocks(emptyBytes)
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    expect(blocks[0].type).toBe(BLOCK_TYPE_SHB)
    // At minimum one IDB to keep readers happy.
    expect(blocks.some((b) => b.type === BLOCK_TYPE_IDB)).toBe(true)
  })

  test("EPB Captured Packet Length is non-zero and equals Original Packet Length", () => {
    const blocks = walkBlocks(bytes)
    const epbs = blocks.filter((b) => b.type === BLOCK_TYPE_EPB)
    for (const epb of epbs) {
      const bodyStart = epb.offset + 8
      const capLen = readUint32LE(bytes, bodyStart + 12)
      const origLen = readUint32LE(bytes, bodyStart + 16)
      expect(capLen).toBeGreaterThan(0)
      expect(capLen).toBe(origLen)
    }
  })

  test("first EPB's first 14 bytes after the fixed-length EPB fields are a valid Ethernet+IPv4 header start", () => {
    const blocks = walkBlocks(bytes)
    const firstEpb = blocks.find((b) => b.type === BLOCK_TYPE_EPB)!
    const packetStart = firstEpb.offset + 8 + 20  // skip 4+4+4+4+4 fixed fields
    // Ethernet dst mac is bytes [packetStart..packetStart+6); skip to ethertype @ +12
    const ethertype = (bytes[packetStart + 12] << 8) | bytes[packetStart + 13]
    expect(ethertype).toBe(0x0800) // IPv4
    // IPv4 version + IHL byte = 0x45 (version 4, IHL 5)
    expect(bytes[packetStart + 14]).toBe(0x45)
    // Protocol byte at IP header offset 9 (i.e. packetStart + 14 + 9) = TCP (6)
    expect(bytes[packetStart + 14 + 9]).toBe(6)
  })
})
