/**
 * cli/transport.ts — sendCommand (Unix socket / TCP) and sendCommandWs (WebSocket)
 */

import { IPC_PORT, IS_WIN, SOCKET_PATH, WS_PORT } from "../shared/platform"

export const INTERCEPTOR_TIMEOUT_MS = parseInt(process.env.INTERCEPTOR_TIMEOUT || "15000")

// Speech permission prompts are async and user-bounded; 15s is too short
// for first-time `listen start` / `vad start`. 60s covers the documented
// user-prompt UX while preserving the normal timeout for other verbs.
const ACTION_TIMEOUT_OVERRIDES_MS: Record<string, number> = {
  macos_listen: 60_000,
  macos_vad: 60_000,
}

function pickTimeoutForAction(actionType: string): number {
  return ACTION_TIMEOUT_OVERRIDES_MS[actionType] ?? INTERCEPTOR_TIMEOUT_MS
}

// Branch the timeout hint on `macos_*` so bridge commands don't get a
// Chrome/Brave-extension troubleshooting hint.
function timeoutMessage(actionType: string, ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (actionType.startsWith("macos_")) {
    return `timeout: no response for '${actionType}' after ${seconds}s. The macOS bridge may be waiting on a TCC permission prompt (Microphone / Speech Recognition for listen/vad, Screen Recording for screenshot/capture/vision). Check System Settings → Privacy & Security.`
  }
  return `timeout: no response for '${actionType}' after ${seconds}s. Ensure Chrome/Brave is open with the Interceptor extension loaded.`
}

export type Action = { type: string; [key: string]: unknown }
export type DaemonResult = { success: boolean; error?: string; data?: unknown; tabId?: number }
export type DaemonResponse = {
  id: string
  result: DaemonResult
}

export function sendCommand(action: Action, tabId?: number, contextId?: string): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const shortId = id.slice(0, 8)
    process.stderr.write(`[${shortId}] → ${action.type}\n`)
    let buffer = Buffer.alloc(0)
    let resolved = false
    let socketRef: Bun.Socket<undefined> | null = null

    const timeoutMs = pickTimeoutForAction(action.type)
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        if (socketRef) try { socketRef.end() } catch {}
        reject(new Error(timeoutMessage(action.type, timeoutMs)))
      }
    }, timeoutMs)

    const socketHandlers: Bun.SocketHandler<undefined> = {
      open(socket: Bun.Socket<undefined>) {
        socketRef = socket
        const payload = JSON.stringify({ id, action, ...(tabId !== undefined && { tabId }), ...(contextId !== undefined && { contextId }) })
        const encoded = Buffer.from(payload, "utf-8")
        const header = Buffer.alloc(4)
        header.writeUInt32LE(encoded.byteLength, 0)
        socket.write(Buffer.concat([header, encoded]))
      },
      data(socket: Bun.Socket<undefined>, raw: Buffer<ArrayBufferLike>) {
        buffer = Buffer.concat([buffer, Buffer.from(raw)])
        if (buffer.length >= 4) {
          const msgLen = buffer.readUInt32LE(0)
          if (msgLen > 0 && msgLen <= 1024 * 1024 && buffer.length >= 4 + msgLen) {
            const json = buffer.subarray(4, 4 + msgLen).toString("utf-8")
            clearTimeout(timer)
            try {
              resolved = true
              resolve(JSON.parse(json) as DaemonResponse)
            } catch {
              resolved = true
              reject(new Error("invalid response from daemon"))
            }
            socket.end()
          }
        }
      },
      close(_socket: Bun.Socket<undefined>) {
        clearTimeout(timer)
        if (!resolved) {
          reject(new Error("connection closed before response"))
        }
      },
      connectError(_socket: Bun.Socket<undefined>, _err: Error) {
        clearTimeout(timer)
        reject(new Error("daemon not running. Open Chrome with the Interceptor extension loaded."))
      },
      error(_socket: Bun.Socket<undefined>, err: Error) {
        clearTimeout(timer)
        reject(err)
      }
    }

    const connectPromise = IS_WIN
      ? Bun.connect({ hostname: "127.0.0.1", port: IPC_PORT, socket: socketHandlers })
      : Bun.connect({ unix: SOCKET_PATH, socket: socketHandlers })

    void connectPromise.catch(() => {})
  })
}

export function sendCommandWs(action: Action, tabId?: number, contextId?: string): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const shortId = id.slice(0, 8)
    process.stderr.write(`[${shortId}] →ws ${action.type}\n`)

    const timeoutMs = pickTimeoutForAction(action.type)
    const timer = setTimeout(() => {
      reject(new Error(`timeout: no response for '${action.type}' after ${timeoutMs / 1000}s via WebSocket.`))
    }, timeoutMs)

    const ws = new WebSocket(`ws://localhost:${WS_PORT}`)
    ws.onopen = () => {
      ws.send(JSON.stringify({ id, action, ...(tabId !== undefined && { tabId }), ...(contextId !== undefined && { contextId }) }))
    }
    ws.onmessage = (event) => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(typeof event.data === "string" ? event.data : "") as DaemonResponse)
      } catch {
        reject(new Error("invalid response from daemon via WebSocket"))
      }
      ws.close()
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error("WebSocket connection failed to daemon"))
    }
    ws.onclose = () => {
      clearTimeout(timer)
    }
  })
}
