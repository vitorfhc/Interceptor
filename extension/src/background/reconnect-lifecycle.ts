export const INITIAL_RECONNECT_DELAY_MS = 1_000
export const MAX_RECONNECT_DELAY_MS = 30_000
export const RECONNECT_JITTER_RATIO = 0.3

export function delayWithJitter(delayMs: number, random = Math.random, jitterRatio = RECONNECT_JITTER_RATIO): number {
  return delayMs + random() * delayMs * jitterRatio
}

export function nextReconnectDelay(delayMs: number, maxMs = MAX_RECONNECT_DELAY_MS): number {
  return Math.min(delayMs * 2, maxMs)
}
