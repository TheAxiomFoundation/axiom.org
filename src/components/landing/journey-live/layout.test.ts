import { describe, expect, it } from "vitest";
import { CAPTIONS } from "../journey-lamplight/captions";
import { CODE, GRAPH_NODES, MARKS } from "../journey-digital/data";
import { CLUSTERS } from "../registry-snapshot";
import {
  CAPTION_OPEN, OPEN, PAGE, SPINE7, SPINES, TARGET_CELL, cellAt, GRID,
  AMBER, CAPTION_AT, CODE_CARD, DH, DRAFT, DW, GATE_X, HERO, NODE_AT, NODE_FIRE, NODE_H, NODE_W, SOURCE_CARD,
  STATUTE_CARD, U, USER_CARD, USERS, clusterAt, draftX, panFor, rowIndex, seg,
} from "./layout";

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
    inside(CODE_CARD.x, CODE_CARD.y, CODE_CARD.w, CODE_CARD.h, "code card");
    for (const n of GRAPH_NODES) {
      const b = n.id === "regular" ? HERO : { w: NODE_W, h: NODE_H };
      inside(NODE_AT[n.id].x, NODE_AT[n.id].y, b.w, b.h, `node ${n.id}`);
    }
    for (const c of CLUSTERS) {
      const p = clusterAt(c);
      inside(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2, `cluster ${c.id}`);
    }
    inside(AMBER.x - AMBER.r, AMBER.y - AMBER.r, AMBER.r * 2, AMBER.r * 2, "amber");
    inside(SOURCE_CARD.x, SOURCE_CARD.y, SOURCE_CARD.w, SOURCE_CARD.h, "source");
    USERS.forEach((_, i) => inside(USER_CARD.x, USER_CARD.y0 + i * USER_CARD.gap, USER_CARD.w, USER_CARD.h, `user ${i}`));
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
