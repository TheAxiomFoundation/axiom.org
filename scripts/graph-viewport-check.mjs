/* Headless-Chromium check that the rule canvas renders at a usable
   height across viewport widths — the pixel counterpart of
   src/components/axiom/graph-viewer/canvas-height.test.ts.

   A fresh load at 900×971 once left .irg-wrap 2px tall and React Flow
   0px, nodes present in the DOM but no canvas to see them on. This
   loads one composed graph at each width, waits for the nodes, and
   measures the height chain.

     bun scripts/graph-viewport-check.mjs                  # http://localhost:3742
     bun scripts/graph-viewport-check.mjs --url https://axiom.org
     bun scripts/graph-viewport-check.mjs --path "/app?compose=us%3A..."

   Exit 0 when every viewport passes, 1 otherwise. Uses Playwright's
   Chromium like scripts/capture-demo-posters.mjs (one-time setup:
   `bunx playwright install chromium`). */
import { chromium } from "playwright";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const base = (args.get("url") ?? "http://localhost:3742").replace(/\/$/, "");
const path =
  args.get("path") ?? "/app?compose=il%3Astatutes%2Fincome-tax-ordinance%2Fsection-121";
const url = base + path;

/* Widths straddle the two breakpoints that shape the canvas: 900px
   (styles.css's stacked layout, where the collapse lived) and 820px
   (plane.css's small-screen notice). */
const VIEWPORTS = [
  { width: 1400, height: 900 },
  { width: 940, height: 971 },
  { width: 901, height: 971 },
  { width: 900, height: 971 },
  { width: 821, height: 900 },
  { width: 640, height: 900 },
  { width: 390, height: 844 },
];
const MIN_CANVAS_PX = 300;

const browser = await chromium.launch();

let failed = false;
const rows = [];
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForSelector(".react-flow__node", { timeout: 90_000 });
    // Let the fit-view settle after the nodes land.
    await page.waitForTimeout(1200);
    const measured = await page.evaluate(() => {
      const h = (sel) => document.querySelector(sel)?.offsetHeight ?? null;
      const notice = document.querySelector(".small-screen-notice");
      return {
        root: h(".graph-viewer-root"),
        shell: h(".graph-viewer-root .app-shell"),
        panel: h(".graph-viewer-root .viewer-panel"),
        wrap: h(".graph-viewer-root .irg-wrap"),
        canvas: h(".graph-viewer-root .irg-canvas"),
        flow: h(".graph-viewer-root .react-flow"),
        nodes: document.querySelectorAll(".react-flow__node").length,
        noticeShown: notice ? getComputedStyle(notice).position === "fixed" : false,
      };
    });
    await context.close();
    const ok =
      measured.nodes > 0 &&
      (measured.canvas ?? 0) >= MIN_CANVAS_PX &&
      (measured.flow ?? 0) >= MIN_CANVAS_PX;
    if (!ok) failed = true;
    rows.push({
      viewport: `${viewport.width}×${viewport.height}`,
      ...measured,
      result: ok ? "ok" : "FAIL",
    });
  }
} finally {
  await browser.close();
}

console.log(url);
console.table(rows);
if (failed) {
  console.error(
    `FAIL: a canvas measured under ${MIN_CANVAS_PX}px or rendered no nodes — see the table.`,
  );
  process.exit(1);
}
console.log(`ok: canvas ≥ ${MIN_CANVAS_PX}px with nodes at every viewport`);
