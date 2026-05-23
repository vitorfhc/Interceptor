/**
 * cli/global-flags.ts — global CLI flag filtering shared by index and tests
 */

export function buildFilteredArgs(args: string[]): string[] {
  const skipIndices = new Set<number>()

  args.forEach((arg, index) => {
    if (arg === "--ws" || arg === "--any-tab") skipIndices.add(index)
  })

  const tabIdx = args.indexOf("--tab")
  if (tabIdx !== -1) {
    skipIndices.add(tabIdx)
    if (args[tabIdx + 1] !== undefined) skipIndices.add(tabIdx + 1)
  }

  const ctxIdx = args.indexOf("--context")
  if (ctxIdx !== -1) {
    skipIndices.add(ctxIdx)
    if (args[ctxIdx + 1] !== undefined) skipIndices.add(ctxIdx + 1)
  }

  return args.filter((arg, index) => {
    if (skipIndices.has(index)) return false
    if (arg === "--json") return index > 1
    return true
  })
}
