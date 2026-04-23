import type { AgentFinalMessage, CommandPolicy, ConditionDef, UsageMetrics } from "./types"

function splitShell(command: string): string[] {
  return command
    .split(/\n|&&|\|\||;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, ""))
}

function matchesPrefix(command: string, prefix: string): boolean {
  const candidates = prefix.includes(" ") ? [prefix] : [prefix, `/bin/zsh -lc ${prefix}`, `zsh -lc ${prefix}`]
  return splitShell(command).some((segment) => candidates.some((candidate) => segment === candidate || segment.includes(candidate + " ") || segment.endsWith(candidate)))
}

function checkPolicy(policy: CommandPolicy | undefined, commands: string[]): string | null {
  return checkPolicyWithTools(policy, commands, [])
}

function checkPolicyWithTools(policy: CommandPolicy | undefined, commands: string[], toolTypes: string[]): string | null {
  if (!policy) return null
  if (policy.maxCommands !== undefined && commands.length > policy.maxCommands) {
    return `Command count ${commands.length} exceeded max ${policy.maxCommands}`
  }
  if ((policy.requireAnyPrefix ?? []).length > 0) {
    const matched = commands.some((command) => (policy.requireAnyPrefix ?? []).some((prefix) => matchesPrefix(command, prefix)))
    if (!matched) return `No command matched required prefixes: ${(policy.requireAnyPrefix ?? []).join(", ")}`
  }
  if ((policy.requireEveryCommandPrefix ?? []).length > 0) {
    for (const command of commands) {
      const matched = (policy.requireEveryCommandPrefix ?? []).some((prefix) => matchesPrefix(command, prefix))
      if (!matched) return `Command did not match required prefixes: ${command}`
    }
  }
  for (const toolType of toolTypes) {
    if ((policy.forbidToolTypes ?? []).includes(toolType)) {
      return `Forbidden tool type detected: ${toolType}`
    }
  }
  for (const command of commands) {
    if ((policy.forbidAnyPrefix ?? []).some((prefix) => matchesPrefix(command, prefix))) {
      return `Forbidden command prefix detected: ${command}`
    }
    if ((policy.forbidSubstrings ?? []).some((piece) => command.includes(piece))) {
      return `Forbidden command substring detected: ${command}`
    }
  }
  return null
}

export function validateCommandPolicy(condition: ConditionDef, usage: UsageMetrics): string | null {
  return checkPolicyWithTools(condition.commandPolicy, usage.command_log, usage.tool_log)
}

const LOCAL_LEAK_PATTERNS = [
  /\bfixtures\//i,
  /\bconfig\/tasks-/i,
  /\bsrc\/server\.ts\b/i,
  /\bREADME\.md\b/i,
  /\bSKILL\.md\b/i,
]

export function validateFinalAnswerPolicy(final: AgentFinalMessage): string | null {
  const combined = [final.answer, ...(final.evidence ?? [])].join("\n")
  const leaked = LOCAL_LEAK_PATTERNS.find((pattern) => pattern.test(combined))
  return leaked ? `Final answer references local benchmark source: ${leaked}` : null
}
