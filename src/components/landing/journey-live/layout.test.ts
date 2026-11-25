import { describe, expect, it } from "vitest";
import { CAPTIONS } from "../journey-lamplight/captions";
import { CODE, GRAPH_EDGES, GRAPH_NODES, MARKS } from "../journey-digital/data";
import { CLUSTERS } from "../registry-snapshot";
import {
  CAPTION_OPEN, OPEN, REST_AT, WALK, WALK_CUT, toClock, toScroll, PAGE, SPINE7, SPINES, TARGET_CELL, cellAt, GRID,
  AMBER, ASIDE, ASIDES, CAPTION_AT, CODE_CARD, DH, DRAFT, DW, GATE_H, GATE_W, GATE_X, GATE_Y, NODE_AT, NODE_FIRE, RAIL, SOURCE_CARD,
  STATUTE_CARD, U, USER_CARD, USERS, USES_Y, asideY, clusterAt, draftX, edgeD, nodeBox, panFor, rowIndex, seg,
} from "./layout";
import { nextStop, prevStop, stepAt } from "./deck-clock";

describe("journey-live layout", () => {
  it("finds every marked line and every graph node's line in the code card", () => {
    for (const m of MARKS) expect(rowIndex(m.line), `mark ${m.id}`).toBeGreaterThanOrEqual(0);
    for (const n of GRAPH_NODES) expect(rowIndex(n.line), `node ${n.id}`).toBeGreaterThanOrEqual(0);
    expect(rowIndex(27)).toBeGreaterThanOrEqual(0);
  });

  it("keeps the code card's pan inside the code", () => {
    for (const r of CODE) {
      if (!("n" in r)) continue;
      const p = panFor(r.n);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(CODE.length * 26);
    }
  });

  it("places every element on the stage", () => {
    const inside = (x: number, y: number, w: number, h: number, what: string) => {
      expect(x, what).toBeGreaterThanOrEqual(0);
      expect(y, what).toBeGreaterThanOrEqual(0);
      expect(x + w, what).toBeLessThanOrEqual(DW);
      expect(y + h, what).toBeLessThanOrEqual(DH);
    };
    inside(STATUTE_CARD.x, STATUTE_CARD.y, STATUTE_CARD.w, 1, "statute");
    GATE_X.forEach((_, i) => inside(draftX(i), DRAFT.y, DRAFT.w, DRAFT.h, `draft at gate ${i}`));
    ASIDES.forEach((a, i) => inside(ASIDE.x, asideY(i), ASIDE.w, ASIDE.h, `aside ${a.id}`));
    inside(CODE_CARD.x, CODE_CARD.y, CODE_CARD.w, CODE_CARD.h, "code card");
    for (const n of GRAPH_NODES) {
      const b = nodeBox(n.id);
      inside(NODE_AT[n.id].x, NODE_AT[n.id].y, b.w, b.h, `node ${n.id}`);
    }
    for (const c of CLUSTERS) {
      const p = clusterAt(c);
      inside(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2, `cluster ${c.id}`);
    }
    inside(AMBER.x - AMBER.r, AMBER.y - AMBER.r, AMBER.r * 2, AMBER.r * 2, "amber");
    inside(SOURCE_CARD.x, SOURCE_CARD.y, SOURCE_CARD.w, SOURCE_CARD.h, "source");
    USERS.forEach((_, i) => inside(USER_CARD.x, USER_CARD.y0 + i * USER_CARD.gap, USER_CARD.w, USER_CARD.h, `user ${i}`));
    inside(USER_CARD.x, USES_Y, 1, 11, "potential uses heading");
  });

  // The steps off the rail sit apart from the rail, its gates and the
  // draft that stops at checks, so nothing draws them as part of the
  // sequence a draft must pass.
  it("keeps the steps off the rail clear of the rail, the gates and the draft", () => {
    const last = GATE_X.length - 1;
    expect(ASIDE.x).toBeGreaterThan(RAIL.x1);
    expect(ASIDE.x).toBeGreaterThan(GATE_X[last] + GATE_W / 2);
    expect(ASIDE.x).toBeGreaterThan(draftX(last) + DRAFT.w);
    expect(asideY(0)).toBeGreaterThan(GATE_Y + GATE_H);
    ASIDES.forEach((_, i) => {
      if (i > 0) expect(asideY(i)).toBeGreaterThanOrEqual(asideY(i - 1) + ASIDE.h);
    });
  });

  it("sets the potential uses heading above the first branch", () => {
    expect(USES_Y + 11).toBeLessThan(USER_CARD.y0);
  });

  // An edge is a cubic from its source's right side to its target's left
  // side. Sampled along its length, it must not pass behind a card it
  // does not join (the cards are opaque and drawn over the lines), and the
  // output's two inputs, $182 and $24, must reach it at different points.
  it("draws every edge clear of the cards it does not join, and the output's two inputs apart", () => {
    const pts = (d: string) => {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = d.match(/-?[\d.]+/g)!.map(Number);
      return Array.from({ length: 201 }, (_, i) => {
        const t = i / 200;
        const v = 1 - t;
        return [
          v ** 3 * x0 + 3 * v * v * t * x1 + 3 * v * t * t * x2 + t ** 3 * x3,
          v ** 3 * y0 + 3 * v * v * t * y1 + 3 * v * t * t * y2 + t ** 3 * y3,
        ];
      });
    };
    for (const [a, b] of GRAPH_EDGES) {
      for (const n of GRAPH_NODES) {
        if (n.id === a || n.id === b) continue;
        const { x, y } = NODE_AT[n.id];
        const { w, h } = nodeBox(n.id);
        for (const [px, py] of pts(edgeD(a, b))) {
          expect(px >= x && px <= x + w && py >= y && py <= y + h, `${a}→${b} under ${n.id}`).toBe(false);
        }
      }
    }
    const end = (d: string) => d.trim().split(/[\s,]+/).slice(-2).join(" ");
    expect(end(edgeD("before", "regular"))).not.toBe(end(edgeD("minimum", "regular")));
    const into = GRAPH_EDGES.filter(([, b]) => b === "regular").map(([a]) => a).sort();
    expect(into).toEqual(["before", "minimum"]);
  });

  it("places the opening on the stage: one Title 7 spine, the page, the target cell", () => {
    expect(SPINES.filter((sp) => sp.title7)).toHaveLength(1);
    for (const sp of SPINES) {
      expect(sp.x + sp.w).toBeLessThanOrEqual(DW);
      expect(sp.y).toBeGreaterThanOrEqual(0);
    }
    expect(SPINE7.w).toBeGreaterThan(0);
    expect(PAGE.x + PAGE.w).toBeLessThanOrEqual(DW);
    expect(PAGE.y + PAGE.h).toBeLessThanOrEqual(DH);
    expect(TARGET_CELL.x).toBeGreaterThan(0);
    expect(TARGET_CELL.x + TARGET_CELL.w).toBeLessThan(DW);
    expect(TARGET_CELL.y + TARGET_CELL.h).toBeLessThan(DH);
  });

  it("draws the corpus nearer rows larger and lower", () => {
    const far = cellAt(0, 0);
    const near = cellAt(0, GRID.rows - 1);
    expect(near.w).toBeGreaterThan(far.w);
    expect(near.y).toBeGreaterThan(far.y);
  });

  it("starts the opening's captions in order, before beat 4", () => {
    CAPTION_OPEN.forEach((at, i) => {
      expect(at).toBeLessThan(OPEN);
      if (i > 0) expect(at).toBeGreaterThan(CAPTION_OPEN[i - 1]);
    });
  });

  it("keeps the draft clear of the statute card", () => {
    expect(draftX(0)).toBeGreaterThan(STATUTE_CARD.x + STATUTE_CARD.w);
  });

  it("gives each live caption its beat, in order, inside the timeline", () => {
    expect(CAPTION_AT).toHaveLength(CAPTIONS.length - 3);
    CAPTION_AT.forEach((at, i) => {
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(U.end);
      if (i > 0) expect(at).toBeGreaterThan(CAPTION_AT[i - 1]);
    });
  });

  it("fires each graph node after the nodes it reads, within the flow", () => {
    expect(NODE_FIRE.net).toBeGreaterThan(NODE_FIRE.imp2014);
    expect(NODE_FIRE.contrib).toBeGreaterThan(Math.max(NODE_FIRE.net, NODE_FIRE.rate30));
    expect(NODE_FIRE.minimum).toBeGreaterThan(Math.max(NODE_FIRE.impUsda, NODE_FIRE.size2, NODE_FIRE.rate8));
    expect(NODE_FIRE.before).toBeGreaterThan(Math.max(NODE_FIRE.impUsda, NODE_FIRE.contrib));
    expect(NODE_FIRE.regular).toBeGreaterThan(Math.max(NODE_FIRE.before, NODE_FIRE.minimum));
    for (const f of Object.values(NODE_FIRE)) expect(U.flow[0] + f).toBeLessThan(U.flow[1]);
  });

  it("clamps seg to 0..1", () => {
    expect(seg(-1, 0, 1)).toBe(0);
    expect(seg(0.5, 0, 1)).toBe(0.5);
    expect(seg(2, 0, 1)).toBe(1);
  });
});

describe("the walk's faster clock", () => {
  it("plays the walk in fewer screens and leaves the rest in place", () => {
    expect(WALK_CUT).toBeGreaterThan(0);
    expect(WALK_CUT).toBeLessThan(WALK);
    expect(toClock(0)).toBe(0);
    expect(toClock(WALK - WALK_CUT)).toBeCloseTo(WALK);
    expect(toClock(OPEN - WALK_CUT)).toBeCloseTo(OPEN);
  });
  it("is continuous, rising, and has an inverse", () => {
    let last = -0.01;
    for (let x = 0; x <= 8; x += 0.05) {
      const s = toClock(x);
      expect(s).toBeGreaterThan(last);
      expect(s - last).toBeLessThan(0.2);
      expect(toScroll(s)).toBeCloseTo(x);
      last = s;
    }
  });
});

describe("the deck's rests", () => {
  const starts = [...CAPTION_OPEN, ...CAPTION_AT.map((a) => a + OPEN)];
  it("has one rest for each step, inside that step, before its words go", () => {
    expect(REST_AT).toHaveLength(starts.length);
    REST_AT.forEach((at, j) => {
      expect(at).toBeGreaterThan(starts[j] + 0.25);
      if (j < starts.length - 1) expect(at).toBeLessThanOrEqual(starts[j + 1] - 0.2);
      expect(stepAt(starts, at)).toBe(j);
    });
    expect(REST_AT[REST_AT.length - 1]).toBe(OPEN + U.end);
  });
  it("steps forward and back through the rests", () => {
    expect(nextStop(REST_AT, 0)).toBe(REST_AT[0]);
    expect(nextStop(REST_AT, REST_AT[0])).toBe(REST_AT[1]);
    expect(nextStop(REST_AT, REST_AT[7])).toBe(REST_AT[7]);
    expect(prevStop(REST_AT, REST_AT[0])).toBe(0);
    expect(prevStop(REST_AT, REST_AT[3])).toBe(REST_AT[2]);
    expect(prevStop(REST_AT, REST_AT[3] - 0.5)).toBe(REST_AT[2]);
  });
});
