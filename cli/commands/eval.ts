/**
 * cli/commands/eval.ts — eval
 */

type Action = { type: string; [key: string]: unknown }

export function parseEvalCommand(filtered: string[]): Action {
  let world = "ISOLATED"
  const codeParts: string[] = []

  for (let i = 1; i < filtered.length; i++) {
    const arg = filtered[i]
    if (arg === "--") {
      codeParts.push(...filtered.slice(i + 1))
      break
    }
    if (arg === "--main") {
      world = "MAIN"
      continue
    }
    const eq = arg.indexOf("=")
    if (eq > 2) {
      const name = arg.slice(0, eq)
      if (name === "--timeout" || name === "--frame") continue
    }
    if (arg === "--timeout" || arg === "--frame") {
      if (i + 1 < filtered.length) i++
      continue
    }
    if (arg === "--json" || arg === "--no-ws" || arg === "--ws" || arg === "--any-tab") {
      continue
    }
    codeParts.push(arg)
  }

  const code = codeParts.join(" ")
  return { type: "evaluate", code, world }
}
