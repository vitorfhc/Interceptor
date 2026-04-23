import { describe, expect, test } from "bun:test"
import type { AgentFinalMessage, TaskDef } from "./types"
import { deterministicGrade } from "./validators"

describe("deterministic benchmark grading", () => {
  test("does not accept expected substrings inside a failure answer", () => {
    const task: TaskDef = {
      id: "S5",
      name: "Request Override",
      category: "network",
      kind: "fixture",
      prompt: "Report the resulting row count.",
      validator: {
        type: "text_in_answer",
        expected: ["5"],
      },
    }
    const final: AgentFinalMessage = {
      answer: "I could not validate a count=5 request override because the page was broken. The observed resulting row count was 0.",
      evidence: [],
    }

    const grade = deterministicGrade(task, final)
    expect(grade).not.toBeNull()
    expect(grade?.pass).toBe(false)
    expect(grade?.reason).toContain("failure language")
  })
})
