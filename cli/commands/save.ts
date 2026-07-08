/**
 * cli/commands/save.ts — page byte sink
 */

type Action = { type: string; [key: string]: unknown }

export function parseSaveCommand(filtered: string[]): Action {
  let out: string | undefined
  let chunkSizeRaw: string | undefined
  let world = "MAIN"
  const codeParts: string[] = []

  for (let i = 1; i < filtered.length; i++) {
    const arg = filtered[i]
    if (arg === "--") {
      codeParts.push(...filtered.slice(i + 1))
      break
    }

    const eq = arg.indexOf("=")
    if (eq > 2) {
      const name = arg.slice(0, eq)
      const value = arg.slice(eq + 1)
      if (name === "--out") {
        out = value
        continue
      }
      if (name === "--chunk-size") {
        chunkSizeRaw = value
        continue
      }
      if (name === "--timeout" || name === "--frame") {
        continue
      }
    }

    if (arg === "--out") {
      out = filtered[i + 1]
      if (i + 1 < filtered.length) i++
      continue
    }
    if (arg === "--chunk-size") {
      chunkSizeRaw = filtered[i + 1]
      if (i + 1 < filtered.length) i++
      continue
    }
    if (arg === "--timeout" || arg === "--frame") {
      if (i + 1 < filtered.length) i++
      continue
    }
    if (arg === "--isolated") {
      world = "ISOLATED"
      continue
    }
    if (arg === "--main" || arg === "--json" || arg === "--ws" || arg === "--no-ws" || arg === "--any-tab") {
      continue
    }

    codeParts.push(arg)
  }

  if (!out || out.startsWith("--")) {
    console.error("error: interceptor save requires --out <path>")
    process.exit(1)
  }

  const chunkSize = chunkSizeRaw ? parseInt(chunkSizeRaw, 10) : undefined
  const code = codeParts.join(" ")

  if (!code.trim()) {
    console.error("error: interceptor save requires a JavaScript expression")
    process.exit(1)
  }

  return {
    type: "binary_sink_save",
    out,
    code,
    world,
    ...(chunkSize && chunkSize > 0 ? { chunkSize } : {})
  }
}
