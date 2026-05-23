import { describe, expect, test } from "bun:test"
import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  delayWithJitter,
  nextReconnectDelay,
} from "../extension/src/background/reconnect-lifecycle"

describe("extension reconnect lifecycle helpers", () => {
  test("starts reconnect backoff at one second", () => {
    expect(INITIAL_RECONNECT_DELAY_MS).toBe(1_000)
  })

  test("adds bounded jitter to the scheduled reconnect delay", () => {
    expect(delayWithJitter(1_000, () => 0)).toBe(1_000)
    expect(delayWithJitter(1_000, () => 1)).toBe(1_300)
  })

  test("doubles reconnect delay until the maximum", () => {
    expect(nextReconnectDelay(1_000)).toBe(2_000)
    expect(nextReconnectDelay(16_000)).toBe(30_000)
    expect(nextReconnectDelay(MAX_RECONNECT_DELAY_MS)).toBe(MAX_RECONNECT_DELAY_MS)
  })
})
