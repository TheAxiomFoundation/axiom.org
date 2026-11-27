import { describe, expect, it } from "vitest";
import { GRAPH_EDGES, GRAPH_NODES, type GraphNodeId } from "./data";
import { TALL, WIDE, graphEdgeD, type Layout } from "./layout";

// The preview's graph cards are centred on their points (gsap xPercent and
// yPercent -50) and drawn over the lines, so a line that passes under a
// card it does not join reads as running through that rule. A card's size
// here is an estimate from its longest line at the layout's monospace size
// (journey-digital.css: 11 px wide, 9.5 px tall, 0.6 em a character), plus
// its padding and border; its height covers its three lines (kind, label
// and value, at line-height 1.1), the gaps between them, padding and
// border, rounded up. Cards keep a CLEAR gap and the stage's sides a
// GUTTER, and a line stays LINE_CLEAR from any card it does not join. All
// of these are design pixels: the stage scales the whole layout to fit the
// viewport, so on a small screen each gap shrinks with it.
const CARD = { wide: { ch: 6.6, pad: 26, h: 62 }, tall: { ch: 5.7, pad: 20, h: 55 } } as const;
const CLEAR = 8;
const GUTTER = 20;
const LINE_CLEAR = 4;

function box(L: Layout, id: GraphNodeId) {
  const n = GRAPH_NODES.find((g) => g.id === id)!;
  const m = CARD[L.kind];
  const w = m.pad + m.ch * Math.max(n.label.length, n.value.length);
  const [x, y] = L.graph[id];
  return { x0: x - w / 2, y0: y - m.h / 2, x1: x + w / 2, y1: y + m.h / 2 };
}

function samples(d: string) {
  // one cubic from the source's centre to the target's
  expect(d).toMatch(/^M (-?[\d.]+ ){2}C (-?[\d.]+ -?[\d.]+, ){2}-?[\d.]+ -?[\d.]+$/);
  const nums = d.match(/-?[\d.]+/g)!.map(Number);
  expect(nums).toHaveLength(8);
  for (const v of nums) expect(Number.isFinite(v)).toBe(true);
  const [x0, y0, x1, y1, x2, y2, x3, y3] = nums;
  return Array.from({ length: 401 }, (_, i) => {
    const t = i / 400;
    const v = 1 - t;
    return [
      v ** 3 * x0 + 3 * v * v * t * x1 + 3 * v * t * t * x2 + t ** 3 * x3,
      v ** 3 * y0 + 3 * v * v * t * y1 + 3 * v * t * t * y2 + t ** 3 * y3,
    ];
  });
}

describe.each([WIDE, TALL])("the preview's $kind graph", (L) => {
  it("places a card for every node, on the stage, apart from the others", () => {
    expect(Object.keys(L.graph).sort()).toEqual(GRAPH_NODES.map((n) => n.id).sort());
    for (const n of GRAPH_NODES) {
      const b = box(L, n.id);
      expect(b.x0, n.id).toBeGreaterThanOrEqual(GUTTER);
      expect(b.x1, n.id).toBeLessThanOrEqual(L.W - GUTTER);
      expect(b.y0, n.id).toBeGreaterThanOrEqual(0);
      expect(b.y1, n.id).toBeLessThanOrEqual(L.H);
      for (const o of GRAPH_NODES) {
        if (o.id <= n.id) continue;
        const c = box(L, o.id);
        const apart = b.x1 + CLEAR <= c.x0 || c.x1 + CLEAR <= b.x0 || b.y1 + CLEAR <= c.y0 || c.y1 + CLEAR <= b.y0;
        expect(apart, `${n.id} / ${o.id}`).toBe(true);
      }
    }
  });

  it("draws no line under, or close by, a card it does not join", () => {
    expect(GRAPH_EDGES.length).toBeGreaterThan(0);
    for (const [a, b] of GRAPH_EDGES) {
      const pts = samples(graphEdgeD(L, a, b));
      for (const n of GRAPH_NODES) {
        if (n.id === a || n.id === b) continue;
        const c = box(L, n.id);
        const under = pts.some(
          ([x, y]) => x >= c.x0 - LINE_CLEAR && x <= c.x1 + LINE_CLEAR && y >= c.y0 - LINE_CLEAR && y <= c.y1 + LINE_CLEAR,
        );
        expect(under, `${a} → ${b} under ${n.id}`).toBe(false);
      }
    }
  });
});
