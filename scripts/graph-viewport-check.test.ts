/* The viewport check's timing, on a virtual clock. The gate it guards
   can regress in a way that only shows late: with an anchor that never
   lands, the tour starts on the first poll past its wait (see
   tour-timing.ts), 8-odd seconds after the nodes. A check that stops
   watching sooner would pass the very 820px regression it exists to
   catch — a peer review reproduced exactly that against an earlier
   version of this script. */
import { describe, expect, it } from "vitest";
import {
  ANCHOR_POLL_MS,
  ANCHOR_WAIT_MS,
  TOUR_AUTOSTART_WINDOW_MS,
} from "../src/components/axiom/tour/tour-timing";
import {
  checkViewports,
  passes,
  SETTLE_MS,
  TOUR_WATCH_MS,
  type CheckBrowser,
  type CheckPage,
  type Measured,
  type Viewport,
} from "./graph-viewport-check.lib";

type Scene = { notice: boolean; popoverAt: number | null };

const TALL: Omit<Measured, "noticeShown" | "tourShown"> = {
  root: 900,
  shell: 812,
  panel: 812,
  wrap: 724,
  canvas: 722,
  flow: 722,
  nodes: 11,
};

/** A browser on a virtual clock: the nodes land at t=0 and a tour card
 *  appears `popoverAt` ms later (never, when null). Each context
 *  records the clock at which it closed — how long the check watched. */
function fakeBrowser(sceneFor: (viewport: Viewport) => Scene) {
  const watched: number[] = [];
  const browser: CheckBrowser = {
    async newContext({ viewport }) {
      const scene = sceneFor(viewport);
      let clock = 0;
      const measure = (): Measured => ({
        ...TALL,
        noticeShown: scene.notice,
        tourShown: scene.popoverAt !== null && clock >= scene.popoverAt,
      });
      const page: CheckPage = {
        on() {},
        async goto() {},
        async waitForSelector(selector, { timeout }) {
          if (selector === ".react-flow__node") return;
          if (selector !== ".driver-popover") throw new Error(`unexpected selector ${selector}`);
          if (scene.popoverAt !== null && scene.popoverAt <= clock + timeout) {
            clock = Math.max(clock, scene.popoverAt);
            return;
          }
          clock += timeout;
          throw new Error(`Timeout ${timeout}ms exceeded waiting for ${selector}`);
        },
        async waitForTimeout(ms) {
          clock += ms;
        },
        evaluate: (async () => measure()) as CheckPage["evaluate"],
      };
      return {
        async newPage() {
          return page;
        },
        async close() {
          watched.push(clock);
        },
      };
    },
  };
  return { browser, watched };
}

const WIDE: Viewport = { width: 821, height: 900 };
const NARROW: Viewport = { width: 820, height: 900 };
const FALLBACK_AT = ANCHOR_WAIT_MS + ANCHOR_POLL_MS;

describe("the watch window", () => {
  it("covers the tour's whole auto-start window with a margin", () => {
    expect(TOUR_AUTOSTART_WINDOW_MS).toBe(FALLBACK_AT);
    expect(TOUR_WATCH_MS).toBeGreaterThan(TOUR_AUTOSTART_WINDOW_MS);
  });
});

describe("under the notice", () => {
  it("catches a tour that opens at the anchor fallback", async () => {
    const { browser, watched } = fakeBrowser(() => ({ notice: true, popoverAt: FALLBACK_AT }));
    const { rows, failed } = await checkViewports(browser, "http://plane.test", [NARROW]);
    expect(failed).toBe(true);
    expect(rows[0]).toMatchObject({ viewport: "820×900", noticeShown: true, tourShown: true, result: "FAIL" });
    expect(watched[0]).toBeGreaterThanOrEqual(FALLBACK_AT);
  });

  it("passes when no card opens, and only after watching the whole window", async () => {
    const { browser, watched } = fakeBrowser(() => ({ notice: true, popoverAt: null }));
    const { rows, failed } = await checkViewports(browser, "http://plane.test", [NARROW]);
    expect(failed).toBe(false);
    expect(rows[0]).toMatchObject({ noticeShown: true, tourShown: false, result: "ok" });
    expect(watched[0]).toBe(TOUR_WATCH_MS + SETTLE_MS);
  });
});

describe("above the boundary", () => {
  it("passes a card that opens at the fallback and fails when none opens", async () => {
    const late = fakeBrowser(() => ({ notice: false, popoverAt: FALLBACK_AT }));
    expect((await checkViewports(late.browser, "http://plane.test", [WIDE])).rows[0]).toMatchObject({
      viewport: "821×900",
      tourShown: true,
      result: "ok",
    });
    const never = fakeBrowser(() => ({ notice: false, popoverAt: null }));
    const { rows, failed } = await checkViewports(never.browser, "http://plane.test", [WIDE]);
    expect(failed).toBe(true);
    expect(rows[0]).toMatchObject({ tourShown: false, result: "FAIL" });
  });

  it("does not wait past a card that opens at once", async () => {
    const { browser, watched } = fakeBrowser(() => ({ notice: false, popoverAt: 400 }));
    await checkViewports(browser, "http://plane.test", [WIDE]);
    expect(watched[0]).toBe(400 + SETTLE_MS);
  });
});

describe("the canvas rules still hold", () => {
  const seen: Measured = { ...TALL, noticeShown: false, tourShown: true };
  it("fails a short canvas or an empty graph", () => {
    expect(passes(seen)).toBe(true);
    expect(passes({ ...seen, canvas: 2, flow: 0 })).toBe(false);
    expect(passes({ ...seen, nodes: 0 })).toBe(false);
    expect(passes({ ...seen, canvas: null, flow: null })).toBe(false);
  });
});
