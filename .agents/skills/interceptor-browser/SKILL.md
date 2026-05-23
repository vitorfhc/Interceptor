---
name: interceptor-browser
description: "Drive a real signed-in Chrome / Brave session via the `interceptor` CLI — read pages, click and type, navigate, observe network, automate rich editors (Canva / Google Docs / Slides), record and replay flows. Use compound commands (open, read, act, inspect) over low-level verbs. Structured reads over screenshots. Supports named contexts (--context <id>) for routing commands to a specific browser profile when multiple are connected. Workflows: VerifyDeploy (open URL and confirm rendering), ReadAndExtract (page + SPA state), DriveRichEditor (Canva/Docs/Slides scene workflow), OverrideXhr (request mutation), RecordAndReplay (monitor flow + export plan), ScreenshotForVlm (VLM-budgeted screenshot), MultiPageCompare (multi-page fact comparison). USE WHEN verify deploy, check page, read DOM, click, type, fill form, drive editor, override request, record flow, replay flow, screenshot for VLM, browser automation, SPA extraction, compare pages, multi-page comparison, designed by X vs Y, facts across N pages, cross-account testing, multi-profile routing. NOT FOR native macOS apps (use interceptor-macos), OS dialogs, browser chrome, or multi-page scraping at scale (use a crawler)."
metadata:
  short-description: Drive a real signed-in Chrome / Brave session via the interceptor CLI
---

# Interceptor Browser

Agent-operator skill for the Browser surface of Interceptor. Use the `interceptor` CLI (no prefix) to drive a live Chrome / Brave session: pages, network, scene graph, monitor, screenshots. For native macOS apps load `interceptor-macos` instead.

Constitutional rules (Input Layer Priority, Screenshot defaults, Surface Decision, `--json` discipline) live in [AGENTS.md](../../../AGENTS.md). This file is a dispatcher to the **Workflows** and **references** below — it does not restate the rules.

## Fast Path

```bash
interceptor status                        # 1. Confirm daemon + extension are alive
interceptor open "https://example.com"    # 2. Compound open: tab + wait + tree + text
interceptor read                          # 3. Current state (re-read after any mutation)
interceptor act e5                        # 4. Click ref e5 (refs come from `read`)
interceptor act e7 "example user"         # 5. Type into ref e7
interceptor inspect                       # 6. Tree + text + network in one read
```

Inside this repo without `interceptor` on PATH, use `./dist/interceptor ...`.

## Workflows

Each workflow is a complete self-contained "you are doing X" procedure. Open the file when the task matches.

| Workflow | When to invoke |
|---|---|
| [`Workflows/VerifyDeploy.md`](Workflows/VerifyDeploy.md) | "Verify the deploy", "check that X works on the page", reproducing a bug before touching code |
| [`Workflows/ReadAndExtract.md`](Workflows/ReadAndExtract.md) | Compound page read + SPA state extraction — pull a specific value off a page |
| [`Workflows/DriveRichEditor.md`](Workflows/DriveRichEditor.md) | Canva, Google Docs, Google Slides, design-tool layer manipulation — anything where DOM refs aren't enough |
| [`Workflows/OverrideXhr.md`](Workflows/OverrideXhr.md) | Mutate a request before it hits the server — change params, force a status, throttle |
| [`Workflows/RecordAndReplay.md`](Workflows/RecordAndReplay.md) | Learn a real user flow, export a replay plan, run it back |
| [`Workflows/ScreenshotForVlm.md`](Workflows/ScreenshotForVlm.md) | Take a screenshot the model will actually understand — VLM-budgeted, WebP, on-disk |
| [`Workflows/MultiPageCompare.md`](Workflows/MultiPageCompare.md) | Compare facts across multiple pages (e.g. "who designed Python vs JavaScript") — sequential `open --text-only` per page |

## References

| File | Topic |
|---|---|
| [`references/browser-and-network.md`](references/browser-and-network.md) | Command selection, SPA extraction, request overrides, SSE capture, page-world `eval --main` cautions |
| [`references/rich-editors.md`](references/rich-editors.md) | Canva, Google Docs, Google Slides behavior, canvas-rendered editor input, WebGL camera apps, blob export capture |
| [`references/monitor-and-replay.md`](references/monitor-and-replay.md) | Monitor session behavior, replay-plan generation, cross-tab/focus-follow notes |
| [`references/command-catalog.md`](references/command-catalog.md) | Full browser command surface with flags and examples |
| [`references/screenshot-policy.md`](references/screenshot-policy.md) | VLM-aware screenshot budget table; agent-default recipe |

## When To Switch Surfaces

If the target is **outside the page** — a native dialog, browser chrome (URL bar, profile picker), Save/Open file picker, OS notification, or any non-browser macOS app — load `interceptor-macos` instead. Decision table is in [AGENTS.md § Surface Decision](../../../AGENTS.md#surface-decision).

## Do Not Default To Troubleshooting

- User wants a browser task completed → run Interceptor commands.
- User wants Interceptor fixed, installed, or explained → that's a separate task; ask before diving into repo state.
- Inside the Interceptor repo, use this skill for live browser validation, not as the primary source of repo-development instructions.
