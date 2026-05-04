# log-viewer

Log viewer, mainly for Serilog. Single-page, no build step — open `log-viewer.html` in any modern browser.

## Layout

```text
log-viewer.html      # entry point
css/styles.css       # base styles + design tokens (Logbook aesthetic)
css/reports.css      # report-modal-specific styles
js/parser.js         # pure helpers (UMD: browser global + Node require)
js/logViewer.js      # the LogViewer class and DOM wiring
tests/parser.test.js # Node test harness for js/parser.js
```

## Running tests

Requires Node 18+. The test runner uses Node's built-in `node:test` — no install.

```bash
node --test "tests/*.test.js"
```

Tests cover the pure helpers in `js/parser.js` (path/exception normalization,
formatters, health thresholds). The DOM-bound code in `js/logViewer.js` is
verified by hand in the browser.
