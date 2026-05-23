# Browser Command Catalog

Full surface for `interceptor` (no prefix). Reference doc — load when you need flag-level detail. For task procedures, see `Workflows/`. For the input-layer routing rules, see `browser-and-network.md`.

## Open + Read

```bash
interceptor open <url>                             # Open + wait + tree + text
interceptor open <url> --full | --tree-only | --text-only
interceptor open <url> --timeout 15000
interceptor open <url> --reuse                     # Navigate latest Interceptor-group tab instead of creating

interceptor read                                   # Current page tree + text
interceptor read e12 [--tree-only | --text-only]   # Scoped sub-tree
interceptor read --markdown [--text-only]          # Page text rendered as markdown (preserves headings, **bold**, lists, tables)
interceptor read --include-style
interceptor read --include-frames                  # Descend into iframes
interceptor read e2_7 --include-frames --tree-only # Framed ref
interceptor text --markdown                        # Standalone markdown dump
interceptor text e12 --markdown                    # Element rendered as markdown
```

`--reuse` for long automation — without it, dead tabs accumulate. Reading strategy: start with `read`/`open`, not a screenshot. Re-read after every mutating action.

**`--markdown` is a SWAP for `--text-only`, not an extra command.** It renders the same content with structure preserved (`<strong>` → `**bold**`, `<h1-6>` → `#`/`##`/..., lists, tables). Use it *instead of* plain `--text-only` when the task asks for the "exact text" / "exact summary" of a section, or the page has visually emphasized text near plain descriptive copy — markdown lets you tell the real answer from decoy or instructional prose. **Never run both modes** — pick one and commit. Skip markdown for raw fact lookups (single date, name, number) where flat text is enough.

## Find + Act

```bash
interceptor find "Submit"
interceptor find "Email" --role textbox

interceptor act e7                                 # Click + read after
interceptor act e9 "example user"                  # Type into field
interceptor act e11 --keys "Enter"
interceptor act e15 --trusted                      # HID-sourced click; page sees isTrusted: true. ESCALATION ONLY.
interceptor act e20 --no-read
```

**After `act --trusted` reports success, read the page once and commit.** Do not re-execute the same click via a different surface (`interceptor macos click ...`, manual coordinates, etc.) to "verify" — the page's own state is the verification, and the trusted event is the same trusted event regardless of which surface posted it. Escalating to a different surface to redo a successful browser action is the most common way to blow the command budget. `interceptor macos` remains the right surface for native-app tasks; this rule only constrains within-task redo behavior on the browser.

`find` uses semantic + text matching — faster than scanning a big tree. Low-level actions when `act` is not enough:

```bash
interceptor click e7
interceptor type e9 "..."
interceptor keys "Meta+K"
interceptor select e12 "Option label"
interceptor hover e3 | drag e4 e8 | dblclick e5 | rightclick e5
```

## Inspection + Network

```bash
interceptor inspect                                # Tree + text + passive network
interceptor inspect --net-only
interceptor inspect --filter api
```

Passive network (preferred over CDP):

```bash
interceptor net log [--filter <p>] [--since 30s] [--limit 100]
interceptor net headers [--filter <p>]
interceptor net clear
```

Overrides (declarativeNetRequest — no debugger banner):

```bash
interceptor override "*api/search*" status=500
interceptor override "*api/search*" delay=1000
interceptor override "*api/search*" status=200 body='{"results":[]}'
interceptor override clear
```

CDP only when passive `net` is insufficient:

```bash
interceptor network on | log | off
interceptor network override "*api*" status=500
```

SSE:

```bash
interceptor sse streams | log | tail
```

## Canvas

```bash
interceptor canvas list | status | model | routes
interceptor canvas log [N] [--kind fillText]
interceptor canvas objects [N] [--kind text]
```

Pixels only when observer data is insufficient:

```bash
interceptor canvas read 1 [--format png] [--region 10,20,300,120] [--webgl]
interceptor canvas diff 1
interceptor canvas ocr 1                           # Experimental — fallback only
```

Canvas indexes are DOM canvas indexes.

## Scene (rich editors)

For Canva, Google Docs/Slides/Sheets. Run `scene profile` first.

```bash
interceptor scene profile [--verbose]
interceptor scene list [--type text]
interceptor scene hit 400 300
interceptor scene click | dblclick | select | cursor-to <scene-ref>
interceptor scene selected
interceptor scene text <scene-ref> [--with-html]
interceptor scene insert "New text"

interceptor scene slide list | current | goto 3
interceptor scene notes | render | zoom 100
```

For canvas-rendered editor input and camera apps, see `rich-editors.md`.

## Navigation + Tabs

```bash
interceptor navigate <url>
interceptor back
interceptor forward
interceptor scroll down
interceptor wait 1000
interceptor wait-stable

interceptor tabs
interceptor tab new <url>
interceptor tab switch <tab-id>
interceptor tab close <tab-id>
interceptor window list
interceptor window new
```

Use `--tab <id>` for a specific tab; `--any-tab` only when explicitly authorized.

## Cookies / Storage / History / Bookmarks

```bash
interceptor cookies example.com
interceptor cookies set '{"url":"https://example.com","name":"sid","value":"..."}'
interceptor cookies delete https://example.com sid

interceptor storage <key>
interceptor storage set <key> <value>
interceptor storage delete <key>
interceptor storage <key> --session                # sessionStorage instead

interceptor history "search term"
interceptor bookmarks "query"
interceptor bookmarks tree
```

## Headers

Tab-scoped request-header rewrites:

```bash
interceptor headers add x-debug 1
interceptor headers remove x-debug
interceptor headers clear
```

## Batch + Raw

```bash
interceptor batch '[{"type":"click","ref":"e5"},{"type":"wait","ms":500},{"type":"extract_text"}]'
interceptor batch '<json>' --stop-on-error
interceptor batch '<json>' --timeout 30000

interceptor raw '{"type":"any_action","key":"value"}'
```

`raw` sends any action verbatim — prefer named commands first.

## Contexts (multi-browser isolation)

```bash
interceptor contexts                                # List IDs of all connected browser contexts
interceptor --context <id> read                     # Route command to a specific profile
interceptor --context <id> open <url>
interceptor --context <id> act e7 "value"
```

Each browser profile auto-generates a stable UUID on first run (stored in `chrome.storage.local`). `contexts` lists all currently connected IDs. Without `--context`, commands auto-route only when exactly one context is connected; zero or multiple connected contexts fail fast and require `--context <id>`.

Primary use case: two Chrome profiles logged in to different accounts simultaneously (cross-account security testing, multi-tenant verification).

## Capabilities + Reload

```bash
interceptor capabilities                            # Available input layers
interceptor reload                                  # After extension changes during dev
```

## Eval (escape hatch)

```bash
interceptor eval --main "document.title"
interceptor eval --main "window.__APP_STATE__"
```

Use only when no built-in command exposes what you need. Strict-CSP sites may trigger an automatic reload/retry on first attempt.

## Output mode

Output is plain text by default — that is the format the LLM consumes. Use `--json` only when piping into a script or another tool that needs a machine-parseable contract. Structured JSON costs more tokens and reduces comprehension on prose-trained models.
