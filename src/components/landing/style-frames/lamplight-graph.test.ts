import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE, GRAPH_EDGES, GRAPH_NODES } from "../journey-digital/data";
import { HERO_DOT, HERO_EDGES, HERO_IDS, HERO_INDEX, LEVEL, P2, RULE_LINES } from "./lamplight-graph";

const IDS = GRAPH_NODES.map((n) => n.id).sort();

describe("the Lamplight film's rule graph", () => {
  // The graph scene once read a local position table and crashed on a
  // node it did not list; every scene now takes its places from here.
  it("places every node of the shared graph in each scene, and no other", () => {
    for (const table of [LEVEL, P2, RULE_LINES, HERO_DOT]) expect(Object.keys(table).sort()).toEqual(IDS);
    expect([...HERO_IDS].sort()).toEqual(IDS);
  });

  it("reads node places only from lamplight-graph.ts", () => {
    for (const file of ["lamplight.ts", "lamplight2.ts"]) {
      const src = readFileSync(join(process.cwd(), "src/components/landing/style-frames", file), "utf8");
      expect(src, file).not.toMatch(/\b(imp2014|impUsda|impTfp)\s*:/);
    }
  });

  it("draws each wire from a shallower card to a deeper one", () => {
    for (const [a, b] of GRAPH_EDGES) expect(LEVEL[b], `${a} → ${b}`).toBeGreaterThan(LEVEL[a]);
  });

  it("keeps cards of one depth apart in the graph scene", () => {
    for (const a of IDS) {
      for (const b of IDS) {
        if (a >= b || LEVEL[a] !== LEVEL[b]) continue;
        const [ax, ay] = P2[a];
        const [bx, by] = P2[b];
        expect(Math.abs(ay - by) >= 100 || Math.abs(ax - bx) >= 400, `${a} / ${b}`).toBe(true);
      }
    }
  });

  it("flies each rule block from the code lines its rule spans", () => {
    const lines = new Set(CODE.filter((r) => "n" in r).map((r) => (r as { n: number }).n));
    for (const n of GRAPH_NODES) {
      const [l0, l1] = RULE_LINES[n.id];
      expect(l0, n.id).toBe(n.line);
      expect(l1, n.id).toBeGreaterThanOrEqual(l0);
      expect(lines.has(l0) && lines.has(l1), n.id).toBe(true);
    }
  });

  it("wires the registry's cluster as the graph is wired", () => {
    expect(HERO_EDGES).toEqual(GRAPH_EDGES.map(([a, b]) => [HERO_INDEX[a], HERO_INDEX[b]]));
    expect(HERO_EDGES.map(([a, b]) => [HERO_IDS[a], HERO_IDS[b]])).toEqual(GRAPH_EDGES);
  });

  // A wire that crossed a dot it does not join would read as passing
  // through that rule.
  it("keeps every dot of the cluster off the wires it does not join", () => {
    for (const [a, b] of GRAPH_EDGES) {
      const [x1, y1] = HERO_DOT[a];
      const [x2, y2] = HERO_DOT[b];
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (const id of IDS) {
        if (id === a || id === b) continue;
        const [x, y] = HERO_DOT[id];
        const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (len * len)));
        const dist = Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)));
        expect(dist, `${a} → ${b} near ${id}`).toBeGreaterThan(0.035);
      }
    }
  });
});
