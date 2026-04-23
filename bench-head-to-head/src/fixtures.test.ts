import { describe, expect, test } from "bun:test"
import { FIXTURE_PAGES, validateFixtureHtml } from "./fixtures"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const FIXTURE_ROOT = join(import.meta.dir, "..", "fixtures")

describe("fixture validation", () => {
  test("accepts every shipped fixture file", () => {
    for (const page of FIXTURE_PAGES) {
      const html = readFileSync(join(FIXTURE_ROOT, ...page.file.split("/")), "utf-8")
      expect(validateFixtureHtml(page, html)).toBeNull()
    }
  })

  test("rejects Bun error pages", () => {
    const errorHtml = "<html><body><div id=\"__bun__error-root\"></div><a>Want help?</a></body></html>"
    expect(validateFixtureHtml(FIXTURE_PAGES[0], errorHtml)).toContain("Bun error page")
  })
})
