/**
 * shared/exports/pcapng.ts — UnifiedCapture[] → pcapng bytes.
 *
 * Implements the block layout from draft-tuexen-opsawg-pcapng-03
 * (https://www.ietf.org/archive/id/draft-tuexen-opsawg-pcapng-03.html).
 * All multi-octet integers are little-endian; the Section Header Block
 * declares this via Byte-Order Magic 0x1A2B3C4D.
 *
 * One Section Header Block (SHB), one Interface Description Block (IDB) per
 * distinct origin, two Enhanced Packet Blocks (EPB) per captured request
 * (one outbound for the request, one inbound for the response). Packet Data
 * is a synthetic Ethernet + IPv4 + TCP + HTTP/1.1 frame — pcapng requires
 * link-layer bytes per the EPB's LinkType.
 *
 * Synthetic-flow choices (Interceptor never sees real wire packets, so we
 * fabricate a plausible flow that Wireshark's HTTP dissector can read):
 *   - Client MAC `02:00:00:00:00:01`, server MAC `02:00:00:00:00:02`.
 *   - Client IP `10.0.0.1`, server IP `10.0.0.2 + (originHash % 250)`.
 *   - Source port = `0xC000 + (index % 0x3FFF)`. Dest port 80.
 *   - TCP seq starts at 0 per flow, advances by payload bytes.
 *   - IP/TCP checksums set to 0 (Wireshark dissects with a "not validated" note).
 *   - Bodies > PCAPNG_MAX_FRAME_PAYLOAD are split across multiple EPBs so
 *     each frame stays within the IDB's declared snap length.
 */

import type { UnifiedCapture, ExportMetadata } from "./types"

// Block type codes (docs/pcapng/02-block-types.md).
const BLOCK_TYPE_SHB = 0x0a0d0d0a
const BLOCK_TYPE_IDB = 0x00000001
const BLOCK_TYPE_EPB = 0x00000006

// SHB byte-order magic (docs/pcapng/06-section-header-block.md).
const BYTE_ORDER_MAGIC = 0x1a2b3c4d

// LinkType codes (https://www.tcpdump.org/linktypes.html).
const LINKTYPE_ETHERNET = 1

// Option codes (docs/pcapng/04-options.md + docs/pcapng/06-section-header-block.md + docs/pcapng/07-interface-description-block.md + docs/pcapng/08-enhanced-packet-block.md).
const OPT_ENDOFOPT = 0
const OPT_COMMENT = 1
const SHB_HARDWARE = 2
const SHB_OS = 3
const SHB_USERAPPL = 4
const IF_NAME = 2
const IF_DESCRIPTION = 3
const IF_TSRESOL = 9
const EPB_FLAGS = 2

// EPB Flags Word direction bits (docs/pcapng/08-enhanced-packet-block.md Table "Flags Word").
const EPB_FLAGS_OUTBOUND = 0b10
const EPB_FLAGS_INBOUND = 0b01

// Pad an octet count up to the next 32-bit boundary.
function pad4(n: number): number {
  return (n + 3) & ~3
}

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * OptionBuilder accumulates option records into a single byte array, then
 * appends the mandatory opt_endofopt terminator on .finish().
 */
class OptionBuilder {
  private parts: Uint8Array[] = []

  add(code: number, value: Uint8Array): this {
    const padded = pad4(value.byteLength)
    const buf = new ArrayBuffer(4 + padded)
    const dv = new DataView(buf)
    dv.setUint16(0, code, true)
    dv.setUint16(2, value.byteLength, true)
    new Uint8Array(buf).set(value, 4)
    // Padding bytes are zero by ArrayBuffer default.
    this.parts.push(new Uint8Array(buf))
    return this
  }

  addString(code: number, value: string): this {
    return this.add(code, utf8(value))
  }

  addUint8(code: number, value: number): this {
    return this.add(code, new Uint8Array([value & 0xff]))
  }

  addUint32(code: number, value: number): this {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setUint32(0, value >>> 0, true)
    return this.add(code, new Uint8Array(buf))
  }

  finish(): Uint8Array {
    // opt_endofopt: code 0, length 0, no value.
    const end = new Uint8Array(4)
    return concat([...this.parts, end])
  }

  isEmpty(): boolean {
    return this.parts.length === 0
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function buildBlock(blockType: number, body: Uint8Array): Uint8Array {
  // General Block Structure (docs/pcapng/01-general-block-structure.md):
  // type(4) + total_length(4) + body(pad4) + total_length(4)
  const paddedBodyLen = pad4(body.byteLength)
  const totalLength = 4 + 4 + paddedBodyLen + 4
  const buf = new ArrayBuffer(totalLength)
  const u8 = new Uint8Array(buf)
  const dv = new DataView(buf)
  dv.setUint32(0, blockType >>> 0, true)
  dv.setUint32(4, totalLength, true)
  u8.set(body, 8)
  // padding zeros are default
  dv.setUint32(totalLength - 4, totalLength, true)
  return u8
}

function buildSHB(meta: ExportMetadata): Uint8Array {
  // SHB body: byte_order_magic(4) + major(2) + minor(2) + section_length(8) + options
  const opts = new OptionBuilder()
    .addString(SHB_HARDWARE, `${typeof process !== "undefined" ? process.platform : "unknown"} ${typeof process !== "undefined" ? process.arch : ""}`.trim())
    .addString(SHB_OS, typeof process !== "undefined" && process.versions ? `bun ${process.versions.bun || "?"} node ${process.versions.node || "?"}` : "unknown")
    .addString(SHB_USERAPPL, `${meta.generatorName || "interceptor"} ${meta.generatorVersion || "0.0.0"}`)

  if (meta.comment) opts.addString(OPT_COMMENT, meta.comment)
  const optsBytes = opts.finish()

  const bodyLen = 4 + 2 + 2 + 8 + optsBytes.byteLength
  const body = new ArrayBuffer(bodyLen)
  const dv = new DataView(body)
  dv.setUint32(0, BYTE_ORDER_MAGIC >>> 0, true)
  dv.setUint16(4, 1, true)         // major version
  dv.setUint16(6, 0, true)         // minor version
  // section length = -1 (unknown, streaming): 0xFFFFFFFFFFFFFFFF as two LE 32-bit halves
  dv.setUint32(8, 0xffffffff, true)
  dv.setUint32(12, 0xffffffff, true)
  new Uint8Array(body).set(optsBytes, 16)
  return buildBlock(BLOCK_TYPE_SHB, new Uint8Array(body))
}

// tshark's default snapshot length is 262144 bytes; packets larger than this
// fail with "appears to be damaged or corrupt". Cap synthetic frames so they
// fit. Headers + framing eat 14 + 20 + 20 = 54 bytes; budget the payload.
const PCAPNG_SNAPLEN = 262144
const PCAPNG_MAX_FRAME_PAYLOAD = PCAPNG_SNAPLEN - 14 - 20 - 20

function buildIDB(originName: string, originDescription: string): Uint8Array {
  // IDB body: linktype(2) + reserved(2) + snaplen(4) + options
  const opts = new OptionBuilder()
    .addString(IF_NAME, originName)
    .addString(IF_DESCRIPTION, originDescription)
    .addUint8(IF_TSRESOL, 9) // nanosecond resolution: MSB=0, value=9 ⇒ 10^-9 s
  const optsBytes = opts.finish()

  const bodyLen = 2 + 2 + 4 + optsBytes.byteLength
  const body = new ArrayBuffer(bodyLen)
  const dv = new DataView(body)
  dv.setUint16(0, LINKTYPE_ETHERNET, true)
  dv.setUint16(2, 0, true)         // reserved
  dv.setUint32(4, PCAPNG_SNAPLEN, true)  // declared snap length matches what we emit
  new Uint8Array(body).set(optsBytes, 8)
  return buildBlock(BLOCK_TYPE_IDB, new Uint8Array(body))
}

function buildEPB(
  interfaceId: number,
  timestampMs: number,
  packetData: Uint8Array,
  direction: "outbound" | "inbound",
): Uint8Array {
  // EPB body:
  //   interface_id(4) + ts_high(4) + ts_low(4) + cap_len(4) + orig_len(4)
  //   + packet_data(pad4) + options
  const tsNs = BigInt(timestampMs) * 1_000_000n
  const tsHigh = Number((tsNs >> 32n) & 0xffffffffn)
  const tsLow = Number(tsNs & 0xffffffffn)
  const capLen = packetData.byteLength

  const opts = new OptionBuilder()
    .addUint32(EPB_FLAGS, direction === "outbound" ? EPB_FLAGS_OUTBOUND : EPB_FLAGS_INBOUND)
  const optsBytes = opts.finish()

  const paddedPacketLen = pad4(capLen)
  const bodyLen = 4 + 4 + 4 + 4 + 4 + paddedPacketLen + optsBytes.byteLength
  const body = new ArrayBuffer(bodyLen)
  const dv = new DataView(body)
  const u8 = new Uint8Array(body)
  dv.setUint32(0, interfaceId >>> 0, true)
  dv.setUint32(4, tsHigh >>> 0, true)
  dv.setUint32(8, tsLow >>> 0, true)
  dv.setUint32(12, capLen, true)
  dv.setUint32(16, capLen, true)   // original packet length === captured (we don't truncate)
  u8.set(packetData, 20)
  // packet data padding already zero-filled
  u8.set(optsBytes, 20 + paddedPacketLen)
  return buildBlock(BLOCK_TYPE_EPB, new Uint8Array(body))
}

/* --- Synthetic L2/L3/L4 framing ----------------------------------------- */

function originHash(url: string): number {
  let h = 5381
  try {
    const u = new URL(url)
    const s = u.host
    for (let i = 0; i < s.length; i++) {
      h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
    }
  } catch {
    for (let i = 0; i < url.length; i++) {
      h = ((h * 33) ^ url.charCodeAt(i)) >>> 0
    }
  }
  return h >>> 0
}

function buildEthernetFrame(srcMac: number[], dstMac: number[], payload: Uint8Array): Uint8Array {
  // 14-byte Ethernet II header (no VLAN, no FCS): dst(6) + src(6) + ethertype(2 BE)
  const buf = new Uint8Array(14 + payload.byteLength)
  buf.set(dstMac, 0)
  buf.set(srcMac, 6)
  buf[12] = 0x08  // ethertype IPv4 = 0x0800 (BE: 0x08, 0x00)
  buf[13] = 0x00
  buf.set(payload, 14)
  return buf
}

function buildIPv4Header(srcIp: number[], dstIp: number[], tcpLen: number): Uint8Array {
  // 20-byte IPv4 header (no options). All multi-byte big-endian (network order).
  const totalLen = 20 + tcpLen
  const buf = new Uint8Array(20)
  buf[0] = 0x45                              // Version 4, IHL 5 (20 bytes)
  buf[1] = 0x00                              // DSCP/ECN
  buf[2] = (totalLen >> 8) & 0xff
  buf[3] = totalLen & 0xff
  buf[4] = 0; buf[5] = 0                     // identification
  buf[6] = 0x40; buf[7] = 0                  // flags=DF, fragment offset 0
  buf[8] = 64                                // TTL
  buf[9] = 6                                 // protocol = TCP
  buf[10] = 0; buf[11] = 0                   // checksum 0 (Wireshark flags as not validated)
  buf.set(srcIp, 12)
  buf.set(dstIp, 16)
  return buf
}

function buildTcpSegment(
  srcPort: number,
  dstPort: number,
  seq: number,
  ack: number,
  flags: number,
  windowSize: number,
  payload: Uint8Array,
): Uint8Array {
  // 20-byte TCP header (no options): srcPort(2) + dstPort(2) + seq(4) + ack(4) + offset/flags(2) + window(2) + checksum(2) + urgent(2) + payload
  const headerLen = 20
  const buf = new Uint8Array(headerLen + payload.byteLength)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  dv.setUint16(0, srcPort, false)            // big-endian
  dv.setUint16(2, dstPort, false)
  dv.setUint32(4, seq >>> 0, false)
  dv.setUint32(8, ack >>> 0, false)
  // data offset = 5 (5*4=20 bytes), reserved 0, flags
  buf[12] = 0x50
  buf[13] = flags & 0xff
  dv.setUint16(14, windowSize, false)
  dv.setUint16(16, 0, false)                 // checksum 0
  dv.setUint16(18, 0, false)                 // urgent pointer
  buf.set(payload, headerLen)
  return buf
}

function statusLineFor(status: number): string {
  // Re-use the HAR statusText map by hand to avoid an import cycle with har.ts.
  const map: Record<number, string> = {
    100: "Continue", 101: "Switching Protocols",
    200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 206: "Partial Content",
    301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified",
    307: "Temporary Redirect", 308: "Permanent Redirect",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
    413: "Payload Too Large", 415: "Unsupported Media Type", 418: "I'm a teapot",
    422: "Unprocessable Entity", 429: "Too Many Requests",
    500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
    503: "Service Unavailable", 504: "Gateway Timeout",
  }
  return map[status] || ""
}

function buildHttpRequestBytes(capture: UnifiedCapture): Uint8Array {
  let url: URL
  try { url = new URL(capture.url) } catch { url = new URL("http://invalid.local" + capture.url) }
  const path = url.pathname + url.search
  const host = url.host
  const lines: string[] = [`${capture.method} ${path} HTTP/1.1`, `Host: ${host}`]
  for (const [name, value] of Object.entries(capture.requestHeaders)) {
    if (name.toLowerCase() === "host") continue
    for (const v of value.split("\n")) lines.push(`${name}: ${v}`)
  }
  lines.push("")  // header/body separator
  const head = lines.join("\r\n") + "\r\n"
  const body = capture.requestPostData || ""
  return concat([utf8(head), utf8(body)])
}

function buildHttpResponseBytes(capture: UnifiedCapture): Uint8Array {
  const statusText = statusLineFor(capture.status)
  const lines: string[] = [`HTTP/1.1 ${capture.status} ${statusText}`]
  for (const [name, value] of Object.entries(capture.responseHeaders)) {
    for (const v of value.split("\n")) lines.push(`${name}: ${v}`)
  }
  // If the capture lacks a content-length header, synthesise one so Wireshark
  // displays the body cleanly.
  const hasContentLength = Object.keys(capture.responseHeaders).some((k) => k.toLowerCase() === "content-length")
  const bodyBytes = utf8(capture.responseBody)
  if (!hasContentLength) lines.push(`Content-Length: ${bodyBytes.byteLength}`)
  lines.push("")
  const head = lines.join("\r\n") + "\r\n"
  return concat([utf8(head), bodyBytes])
}

type FlowState = {
  clientSeq: number
  serverSeq: number
  srcPort: number
}

const FLOW_BASE_PORT = 0xc000

export function buildPcapng(captures: UnifiedCapture[], meta: ExportMetadata): Uint8Array {
  const blocks: Uint8Array[] = []

  // 1. SHB
  blocks.push(buildSHB(meta))

  // 2. One IDB per distinct origin. Track origin → interfaceId.
  const originToIface = new Map<string, number>()
  const ifaceOrigin: { host: string; description: string }[] = []
  for (const c of captures) {
    let host = "unknown"
    let description = c.url
    try {
      const u = new URL(c.url)
      host = u.host || "unknown"
      description = `${u.protocol}//${u.host}`
    } catch {}
    if (!originToIface.has(host)) {
      const ifaceId = ifaceOrigin.length
      originToIface.set(host, ifaceId)
      ifaceOrigin.push({ host, description })
    }
  }
  // If there were no captures, emit one anonymous IDB so the file remains valid.
  if (ifaceOrigin.length === 0) {
    ifaceOrigin.push({ host: "empty", description: "no captures" })
    originToIface.set("empty", 0)
  }
  for (const { host, description } of ifaceOrigin) {
    blocks.push(buildIDB(`interceptor-${host}`, description))
  }

  // 3. Two EPBs per capture: request (outbound), response (inbound).
  // Per-origin flow state advances TCP seq numbers correctly.
  const flowState = new Map<string, FlowState>()
  let captureIndex = 0
  for (const c of captures) {
    let host = "unknown"
    try { host = new URL(c.url).host } catch {}
    const ifaceId = originToIface.get(host) ?? 0

    let flow = flowState.get(host)
    if (!flow) {
      flow = {
        clientSeq: 0,
        serverSeq: 0,
        srcPort: FLOW_BASE_PORT + (captureIndex % 0x3fff),
      }
      flowState.set(host, flow)
    }
    captureIndex++

    const hash = originHash(c.url)
    const serverOctet = 2 + (hash % 250)
    const clientIp = [10, 0, 0, 1]
    const serverIp = [10, 0, 0, serverOctet]
    const clientMac = [0x02, 0x00, 0x00, 0x00, 0x00, 0x01]
    const serverMac = [0x02, 0x00, 0x00, 0x00, 0x00, 0x02]

    // Helper: emit one or more EPBs for an HTTP payload, splitting at the
    // PCAPNG_MAX_FRAME_PAYLOAD boundary so each synthetic frame fits inside the
    // IDB's declared snap length (avoids tshark's "cap_len > snaplen" abort).
    const emitFrames = (
      payload: Uint8Array,
      srcMac: number[], dstMac: number[],
      srcIp: number[], dstIp: number[],
      srcPort: number, dstPort: number,
      seqRef: { value: number }, ackRef: { value: number },
      tsMs: number, dir: "outbound" | "inbound",
    ) => {
      let offset = 0
      while (offset < payload.byteLength) {
        const remain = payload.byteLength - offset
        const chunkLen = Math.min(remain, PCAPNG_MAX_FRAME_PAYLOAD)
        const chunk = payload.subarray(offset, offset + chunkLen)
        const tcp = buildTcpSegment(srcPort, dstPort, seqRef.value, ackRef.value, 0x18, 65535, chunk)
        const ip = buildIPv4Header(srcIp, dstIp, tcp.byteLength)
        const eth = buildEthernetFrame(srcMac, dstMac, concat([ip, tcp]))
        blocks.push(buildEPB(ifaceId, tsMs, eth, dir))
        seqRef.value = (seqRef.value + chunkLen) >>> 0
        offset += chunkLen
      }
      // Edge case: zero-byte payload — still emit one minimal frame so the
      // request/response pairing is visible in tools.
      if (payload.byteLength === 0) {
        const tcp = buildTcpSegment(srcPort, dstPort, seqRef.value, ackRef.value, 0x18, 65535, new Uint8Array(0))
        const ip = buildIPv4Header(srcIp, dstIp, tcp.byteLength)
        const eth = buildEthernetFrame(srcMac, dstMac, concat([ip, tcp]))
        blocks.push(buildEPB(ifaceId, tsMs, eth, dir))
      }
    }

    const clientSeqRef = { value: flow.clientSeq }
    const serverSeqRef = { value: flow.serverSeq }

    // Request: client → server, ACK+PSH (0x18). Single frame in practice
    // (request bodies are small in our captures), but the splitter handles it.
    const reqHttp = buildHttpRequestBytes(c)
    emitFrames(
      reqHttp, clientMac, serverMac, clientIp, serverIp,
      flow.srcPort, 80, clientSeqRef, serverSeqRef,
      c.startedAt || Date.now(), "outbound",
    )

    // Response: server → client. Video chunks (847 KB / 1.6 MB / 877 KB) get
    // split into multiple frames, each ≤ PCAPNG_MAX_FRAME_PAYLOAD.
    const respHttp = buildHttpResponseBytes(c)
    emitFrames(
      respHttp, serverMac, clientMac, serverIp, clientIp,
      80, flow.srcPort, serverSeqRef, clientSeqRef,
      c.endedAt || c.startedAt || Date.now(), "inbound",
    )

    flow.clientSeq = clientSeqRef.value
    flow.serverSeq = serverSeqRef.value
  }

  return concat(blocks)
}
