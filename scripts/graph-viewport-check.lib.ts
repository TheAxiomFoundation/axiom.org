/* The measurement behind scripts/graph-viewport-check.mjs, written
   against the sliver of a browser it needs so that
   graph-viewport-check.test.ts can drive it with a fake on a virtual
   clock — the timing is the part worth testing. */
import { TOUR_AUTOSTART_WINDOW_MS } from "../src/components/axiom/tour/tour-timing";

export type Viewport = { width: number; height: number };

export type Measured = {
  root: number | null;
  shell: number | null;
  panel: number | null;
  wrap: number | null;
  canvas: number | null;
  flow: number | null;
  nodes: number;
  noticeShown: boolean;
  tourShown: boolean;
};

export type Row = Measured & { viewport: string; result: "ok" | "FAIL" };

export interface CheckPage {
  on(event: "pageerror", handler: (error: Error) => void): unknown;
  goto(url: string, options: { waitUntil: "networkidle"; timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
}

export interface CheckContext {
  newPage(): Promise<CheckPage>;
  close(): Promise<void>;
}

/** Playwright's Browser, or a test's stand-in. */
export interface CheckBrowser {
  newContext(options: { viewport: Viewport }): Promise<CheckContext>;
}

export const DEFAULT_PATH =
  "/app?compose=il%3Astatutes%2Fincome-tax-ordinance%2Fsection-121";

/* Widths straddle the two breakpoints that shape the canvas: 900px
   (styles.css's stacked layout, where the collapse lived) and 820px
   (plane.css's small-screen notice, which is also the Plane's tour
   gate — src/components/axiom/graph-viewer/plane-breakpoints.ts). */
export const VIEWPORTS: Viewport[] = [
  { width: 1400, height: 900 },
  { width: 940, height: 971 },
  { width: 901, height: 971 },
  { width: 900, height: 971 },
  { width: 821, height: 900 },
  { width: 820, height: 900 },
  { width: 640, height: 900 },
  { width: 390, height: 844 },
];

export const MIN_CANVAS_PX = 300;

/* How long to watch for the first tour card once the nodes are up.
   The tour polls its anchors from mount and, when one never lands,
   starts on the first tick past its wait — so a card can follow the
   nodes by up to that whole window. Watch all of it: above the
   boundary the card must show up in it, and under the notice it must
   not, however late it would have opened. The margin covers the
   surface re-mounting its poll as the launcher closes. */
export const TOUR_WATCH_MS = TOUR_AUTOSTART_WINDOW_MS + 2000;

/* Fit-view settle once the card, or its absence, is known. */
export const SETTLE_MS = 1200;

export async function measureViewport(
  browser: CheckBrowser,
  url: string,
  viewport: Viewport,
): Promise<Measured> {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForSelector(".react-flow__node", { timeout: 90_000 });
    await page
      .waitForSelector(".driver-popover", { timeout: TOUR_WATCH_MS })
      .catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    return await page.evaluate(() => {
      const h = (sel: string) =>
        (document.querySelector(sel) as HTMLElement | null)?.offsetHeight ?? null;
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
        tourShown: !!document.querySelector(".driver-popover"),
      };
    });
  } finally {
    await context.close();
  }
}

/** The canvas is tall and populated, and the tour agrees with the
 *  notice: open above the boundary, absent under it. */
export function passes(measured: Measured): boolean {
  return (
    measured.nodes > 0 &&
    (measured.canvas ?? 0) >= MIN_CANVAS_PX &&
    (measured.flow ?? 0) >= MIN_CANVAS_PX &&
    measured.tourShown !== measured.noticeShown
  );
}

export async function checkViewports(
  browser: CheckBrowser,
  url: string,
  viewports: Viewport[] = VIEWPORTS,
): Promise<{ rows: Row[]; failed: boolean }> {
  const rows: Row[] = [];
  let failed = false;
  for (const viewport of viewports) {
    const measured = await measureViewport(browser, url, viewport);
    const ok = passes(measured);
    if (!ok) failed = true;
    rows.push({
      viewport: `${viewport.width}×${viewport.height}`,
      ...measured,
      result: ok ? "ok" : "FAIL",
    });
  }
  return { rows, failed };
}
