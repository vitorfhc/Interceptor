import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface FixturePage {
  path: string
  file: string
  markers: string[]
}

export const FIXTURE_PAGES: FixturePage[] = [
  { path: "/spa-lab/", file: "spa-lab/index.html", markers: ["SPA Lab", "Cedar summary: nested panel benchmark target"] },
  { path: "/network-lab/", file: "network-lab/index.html", markers: ["Network Lab", "bench-token-42"] },
  { path: "/editor-lab/", file: "editor-lab/index.html", markers: ["Editor Lab", "Scene note: generic profile benchmark note"] },
  { path: "/trusted-input-lab/", file: "trusted-input-lab/index.html", markers: ["Trusted Input Lab", "Trusted success: true"] },
  { path: "/replay-lab/", file: "replay-lab/index.html", markers: ["Replay Lab", "benchmark replay complete"] },
]

export function fixtureFilePath(fixtureRoot: string, page: FixturePage): string {
  return join(fixtureRoot, ...page.file.split("/"))
}

export function checkFixtureFiles(fixtureRoot: string): Record<string, boolean> {
  const checks: Record<string, boolean> = {}
  for (const page of FIXTURE_PAGES) {
    checks[page.path] = existsSync(fixtureFilePath(fixtureRoot, page))
  }
  return checks
}

export function validateFixtureHtml(page: FixturePage, html: string): string | null {
  if (html.includes("__bun__error-root") || html.includes("Want help?")) {
    return `fixture ${page.path} rendered a Bun error page`
  }
  for (const marker of page.markers) {
    if (!html.includes(marker)) return `missing marker '${marker}' for ${page.path}`
  }
  return null
}

export function validateFixtureFile(fixtureRoot: string, page: FixturePage): string | null {
  const path = fixtureFilePath(fixtureRoot, page)
  if (!existsSync(path)) return `missing fixture file: ${path}`
  return validateFixtureHtml(page, readFileSync(path, "utf-8"))
}
