import { describe, expect, test } from "bun:test"

import { runOverride } from "../cli/commands/override"

type OverrideAction = { type: string; [key: string]: unknown }
type OverrideSender = NonNullable<Parameters<typeof runOverride>[2]>
type SenderCall = {
  action: OverrideAction
  tabId?: number
  useWs?: boolean
  contextId?: string
}

function makeSender(calls: SenderCall[]): OverrideSender {
  return async (action, tabId, useWs, contextId) => {
    calls.push({ action, tabId, useWs, contextId })
    return { success: true }
  }
}

async function withMutedConsole(fn: () => Promise<void>): Promise<void> {
  const originalLog = console.log
  console.log = () => {}
  try {
    await fn()
  } finally {
    console.log = originalLog
  }
}

describe("runOverride", () => {
  test("passes context routing options when setting overrides", async () => {
    const calls: SenderCall[] = []

    await withMutedConsole(async () => {
      await runOverride(
        ["override", "*api*", "limit=50", "mode=debug"],
        { globalTabId: 7, useWs: true, contextId: "work" },
        makeSender(calls)
      )
    })

    expect(calls).toEqual([
      {
        action: {
          type: "set_net_overrides",
          rules: [
            {
              urlPattern: "*api*",
              queryAddOrReplace: { limit: "50", mode: "debug" },
            },
          ],
        },
        tabId: 7,
        useWs: true,
        contextId: "work",
      },
    ])
  })

  test("passes context routing options when clearing overrides", async () => {
    const calls: SenderCall[] = []

    await withMutedConsole(async () => {
      await runOverride(["override", "clear"], { contextId: "work" }, makeSender(calls))
    })

    expect(calls).toEqual([
      {
        action: { type: "clear_net_overrides" },
        tabId: undefined,
        useWs: undefined,
        contextId: "work",
      },
    ])
  })
})
