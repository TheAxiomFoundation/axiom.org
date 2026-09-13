/* Headless-Chromium check that the rule canvas renders at a usable
   height across viewport widths — the pixel counterpart of
   src/components/axiom/graph-viewer/canvas-height.test.ts.

   A fresh load at 900×971 once left .irg-wrap 2px tall and React Flow
   0px, nodes present in the DOM but no canvas to see them on. This
   loads one composed graph at each width, waits for the nodes, and
   measures the height chain. It also holds the tour to the notice's
   boundary: above 820px the first tour card must open, and under the
   notice (820px and below) none may — the tour once gated on the
   site's 767px phone breakpoint, so 768–820px showed both. Each width
   is watched through the tour's whole auto-start window, so a card
   that would open late (an anchor that never lands) is still seen.

     bun scripts/graph-viewport-check.mjs                  # http://localhost:3742
     bun scripts/graph-viewport-check.mjs --url https://axiom.org
     bun scripts/graph-viewport-check.mjs --path "/app?compose=us%3A..."

   Exit 0 when every viewport passes, 1 otherwise. Uses Playwright's
   Chromium like scripts/capture-demo-posters.mjs (one-time setup:
   `bunx playwright install chromium`). The measurement lives in
   graph-viewport-check.lib.ts, where graph-viewport-check.test.ts
   drives it with a fake browser on a virtual clock. */
import { chromium } from "playwright";
import { checkViewports, DEFAULT_PATH, MIN_CANVAS_PX } from "./graph-viewport-check.lib.ts";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const base = (args.get("url") ?? "http://localhost:3742").replace(/\/$/, "");
const url = base + (args.get("path") ?? DEFAULT_PATH);

const browser = await chromium.launch();
let result;
try {
  result = await checkViewports(browser, url);
} finally {
  await browser.close();
}

console.log(url);
console.table(result.rows);
if (result.failed) {
  console.error(
    `FAIL: a canvas measured under ${MIN_CANVAS_PX}px, rendered no nodes, or the tour disagreed with the small-screen notice (open under it, or missing above it) — see the table.`,
  );
  process.exit(1);
}
console.log(
  `ok: canvas ≥ ${MIN_CANVAS_PX}px with nodes at every viewport; the tour opens above the notice's boundary and never under it`,
);
