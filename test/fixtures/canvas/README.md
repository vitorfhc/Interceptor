# Canvas Validation Fixtures

Use these pages to validate the canvas observer, OCR fallback, and direct mutation paths.

- `2d.html` — pure 2D text and rect operations
- `webgl.html` — simple WebGL rendering
- `offscreen.html` — OffscreenCanvas worker rendering
- `tainted.html` — attempts a cross-origin draw to produce a tainted canvas

Serve from the repo root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open:

```bash
interceptor open "http://127.0.0.1:8765/test/fixtures/canvas/2d.html"
interceptor open "http://127.0.0.1:8765/test/fixtures/canvas/webgl.html"
interceptor open "http://127.0.0.1:8765/test/fixtures/canvas/offscreen.html"
interceptor open "http://127.0.0.1:8765/test/fixtures/canvas/tainted.html"
```
