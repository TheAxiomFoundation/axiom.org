import { describe, expect, it } from "vitest";
import { squarify } from "./treemap";

describe("squarify", () => {
  it("fills the rectangle with areas in proportion to the weights, largest first", () => {
    const cells = squarify(
      [6, 6, 4, 3, 2, 2, 1].map((weight, i) => ({ weight, item: `c${i}` })),
      { x: 0, y: 0, w: 600, h: 400 }
    );
    expect(cells.map((c) => c.item)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6"]);
    const total = cells.reduce((sum, c) => sum + c.w * c.h, 0);
    expect(total).toBeCloseTo(600 * 400);
    expect((cells[0].w * cells[0].h) / (cells[6].w * cells[6].h)).toBeCloseTo(6);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(-1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(600 + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(400 + 1e-9);
    }
  });

  it("drops weightless items and lays out nothing in an empty rectangle", () => {
    expect(squarify([{ weight: 0, item: "a" }, { weight: 2, item: "b" }], { x: 0, y: 0, w: 10, h: 10 }).map((c) => c.item)).toEqual(["b"]);
    expect(squarify([{ weight: 1, item: "a" }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
  });
});
