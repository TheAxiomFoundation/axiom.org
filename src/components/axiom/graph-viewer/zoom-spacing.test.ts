import { describe, expect, it } from "vitest";
import { anchorSpacing, spacingForZoom } from "./zoom-spacing";
describe("zoom spacing", () => {
  it("opens up the overview and tightens the close view with stable thresholds", () => {
    expect(spacingForZoom(.1, 1)).toBe(1.35);
    expect(spacingForZoom(.44, 1.35)).toBe(1.35);
    expect(spacingForZoom(.5, 1.35)).toBe(1.15);
    expect(spacingForZoom(.9, 1.15)).toBe(1);
    expect(spacingForZoom(.76, 1)).toBe(1);
  });
  it("adapts to a large graph at low absolute zoom without oscillating", () => {
    expect(spacingForZoom(.1, 1.35, .1)).toBe(1.35);
    expect(spacingForZoom(.22, 1.35, .1)).toBe(1.15);
    expect(spacingForZoom(.38, 1.15, .1)).toBe(1);
    expect(spacingForZoom(.32, 1, .1)).toBe(1);
    expect(spacingForZoom(.14, 1, .1)).toBe(1.35);
  });
  it("keeps the viewport anchor fixed and returns identical state within a band", () => {
    const previous = { scale: 1.35, x: 20, y: -30 };
    const anchor = { x: 800, y: 450 };
    const next = anchorSpacing(previous, 1, anchor);
    expect((anchor.x - previous.x) / previous.scale * next.scale + next.x).toBeCloseTo(anchor.x);
    expect((anchor.y - previous.y) / previous.scale * next.scale + next.y).toBeCloseTo(anchor.y);
    expect(anchorSpacing(next, 1, anchor)).toBe(next);
  });
});
