import type { AgentFinalMessage, GradeResult, TaskDef } from "./types"

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function looksLikeFailureAnswer(answer: string): boolean {
  const lower = normalize(answer)
  return [
    "could not",
    "couldn't",
    "cannot",
    "can't",
    "unable to",
    "failed to",
    "did not",
    "broken",
    "blank state",
    "not validate",
    "no final answer",
  ].some((piece) => lower.includes(piece))
}

function includesAll(answer: string, expected: string[]): boolean {
  const lower = normalize(answer)
  return expected.every((piece) => lower.includes(piece.toLowerCase()))
}

function includesAny(answer: string, expected: string[]): boolean {
  const lower = normalize(answer)
  return expected.some((piece) => lower.includes(piece.toLowerCase()))
}

export function deterministicGrade(task: TaskDef, final: AgentFinalMessage): GradeResult | null {
  const expected = task.validator.expected ?? []
  if (!final.answer.trim()) {
    return {
      pass: false,
      score: 0,
      reason: "Answer was empty.",
      mode: "deterministic",
    }
  }
  switch (task.validator.type) {
    case "text_in_answer":
      return {
        pass: !looksLikeFailureAnswer(final.answer) && includesAny(final.answer, expected),
        score: !looksLikeFailureAnswer(final.answer) && includesAny(final.answer, expected) ? 1 : 0,
        reason: !looksLikeFailureAnswer(final.answer) && includesAny(final.answer, expected)
          ? `Answer included expected text: ${expected.join(", ")}`
          : looksLikeFailureAnswer(final.answer)
            ? "Answer included failure language, so expected text was not treated as a valid pass."
            : `Answer missing expected text: ${expected.join(", ")}`,
        mode: "deterministic",
      }
    case "text_all_of_in_answer":
      return {
        pass: !looksLikeFailureAnswer(final.answer) && includesAll(final.answer, expected),
        score: !looksLikeFailureAnswer(final.answer) && includesAll(final.answer, expected) ? 1 : 0,
        reason: !looksLikeFailureAnswer(final.answer) && includesAll(final.answer, expected)
          ? `Answer included all expected text fragments.`
          : looksLikeFailureAnswer(final.answer)
            ? "Answer included failure language, so the expected fragments were not treated as a valid pass."
            : `Answer did not include all expected fragments: ${expected.join(", ")}`,
        mode: "deterministic",
      }
    case "text_any_of_in_answer":
      return {
        pass: !looksLikeFailureAnswer(final.answer) && includesAny(final.answer, expected),
        score: !looksLikeFailureAnswer(final.answer) && includesAny(final.answer, expected) ? 1 : 0,
        reason: !looksLikeFailureAnswer(final.answer) && includesAny(final.answer, expected)
          ? `Answer included one of the accepted text fragments.`
          : looksLikeFailureAnswer(final.answer)
            ? "Answer included failure language, so accepted fragments were not treated as a valid pass."
            : `Answer did not include any accepted fragment: ${expected.join(", ")}`,
        mode: "deterministic",
      }
    case "requires_judge":
      return null
  }
}
