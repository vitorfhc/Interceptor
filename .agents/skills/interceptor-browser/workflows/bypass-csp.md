# Workflow: Run JS a page's CSP is blocking

Use when: `interceptor eval` returns `error: page CSP blocks eval`; an injected inline `<script>`, `eval`/`new Function`, or an XSS/PoC payload won't run on a target; or you need page-origin JS to run reliably on a strict-CSP site (repeated evals, cooking overlays, PoC verification).

## 1. Know WHICH CSP is blocking you — only one is fixable with `csp off`

Two different policies can throw a "CSP blocks eval" error, and they have different fixes:

- **Default `interceptor eval` (ISOLATED world)** is blocked by the **extension's own content-script CSP** (`script-src 'self' 'wasm-unsafe-eval'` — no `unsafe-eval`). This is a fixed extension policy, **not the page's CSP**. The CLI's `error: page CSP blocks eval` message is misleading here, and **`csp off` does NOT help**.
  - **Fix:** add `--main` to run in the page world.
- **`interceptor eval --main` (MAIN world)** is subject to the **page's** CSP. On a strict page (no `unsafe-eval`), the first `--main` eval auto-triggers the reactive per-tab strip (strip header → reload that one tab → retry). It works, but reloads a tab per call and only helps `eval` — not inline `<script>` / event handlers / PoC execution.
  - **Fix for reliability or non-eval injection:** `interceptor csp off` up front.

Rule of thumb: **got `page CSP blocks eval`? add `--main` first.** Still blocked, or you need inline/handler/PoC execution? **`interceptor csp off`.**

## 2. Diagnose what the page actually sends (don't assume)

A same-origin `fetch` is an XHR response, so it returns the server's true CSP, unaffected by the `main_frame`-scoped strip rule:

```bash
interceptor eval --main 'fetch(location.href,{cache:"no-store"}).then(r=>({csp:r.headers.get("content-security-policy"),cspReportOnly:r.headers.get("content-security-policy-report-only")}))'
```

Read the result carefully — these confounders make injection tests lie:

- **`content-security-policy` is null but `content-security-policy-report-only` is set** → the page **reports** violations but **blocks nothing**. Your injection runs regardless; the header only matters for reporting. (e.g. `www.google.com`'s homepage.)
- **`script-src` contains `'unsafe-eval'`** → `eval --main` works with no strip needed.
- **`script-src` contains `'strict-dynamic'`** → DOM-inserted scripts (`createElement("script")` + `append`) are **allowed even without a nonce**; only *parser-inserted* inline scripts and inline event handlers are blocked. So "did my appended `<script>` run?" is NOT a reliable block test on these sites.

## 3. Disable CSP, do your work, restore

```bash
interceptor csp off        # strips CSP on every tab (open + future); reloads open tabs so it's live now
# ... eval --main / inject inline <script> / run the PoC ...
interceptor csp on         # restore
```

Browser-global, session-only. `--no-reload` skips the reload storm (each tab applies it on its next navigation). Full scope/lifetime details: `references/command-catalog.md` § CSP.

## 4. Verify at the HEADER level, not the injection level

Injection success is a weak signal (strict-dynamic, report-only, and `unsafe-inline` all confound it). Use a **`securitypolicyviolation` event** as the oracle: it fires whenever the header is live (even report-only) and stops once the header is stripped. Run it before and after `csp off`:

```bash
interceptor eval --main '(()=>new Promise(res=>{var got=null;document.addEventListener("securitypolicyviolation",e=>got=e.violatedDirective,{once:true});var b=document.createElement("button");b.setAttribute("onclick","1");document.documentElement.appendChild(b);b.click();b.remove();setTimeout(()=>res({violationFired:!!got,directive:got}),300);}))()'
```

- Baseline → `violationFired:true` (CSP header live on this document).
- After `csp off` + a fresh load (`interceptor navigate <url>`) → `violationFired:false` (header stripped).
- After `csp on` + fresh load → `violationFired:true` again.

## Gotchas

- `csp off` strips **header**-delivered CSP only — a `<meta http-equiv="Content-Security-Policy">` baked into the HTML is not removed.
- A DNR header rule only affects **future** responses, so already-open tabs must reload (`csp off` does this by default) — reading the same already-loaded document won't reflect the change until it reloads.
- `alert()` / `confirm()` / `prompt()` from `eval --main` open a modal that **freezes the extension's message channel** until dismissed. In automation, set a DOM marker and read it back (`document.documentElement.setAttribute(...)` → read via a follow-up eval) instead of alerting.
