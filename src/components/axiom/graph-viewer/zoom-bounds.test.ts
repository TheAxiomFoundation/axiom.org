import { describe, expect, it } from "vitest";
import { FOCUS_MAX_ZOOM, graphFitViewport, MAX_GRAPH_ZOOM, READABLE_GRAPH_ZOOM, readableFocusViewport } from "./zoom-bounds";
describe("graph zoom bounds", () => {
  it("fits every box with padding, including negative coordinates", () => {
    const nodes = [{ position: { x: -500, y: -200 }, width: 200, height: 100 }, { position: { x: 2000, y: 1600 }, width: 300, height: 180 }];
    const fit = graphFitViewport(nodes, 800, 500)!;
    for (const node of nodes) {
      expect(node.position.x * fit.zoom + fit.x).toBeGreaterThan(0);
      expect(node.position.y * fit.zoom + fit.y).toBeGreaterThan(0);
      expect((node.position.x + node.width) * fit.zoom + fit.x).toBeLessThan(800);
      expect((node.position.y + node.height) * fit.zoom + fit.y).toBeLessThan(500);
    }
  });
  it("caps tiny graphs at reading scale and waits for usable dimensions", () => {
    const nodes = [{ position: { x: 0, y: 0 }, width: 100, height: 60 }];
    expect(graphFitViewport(nodes, 1400, 900)?.zoom).toBe(MAX_GRAPH_ZOOM);
    expect(graphFitViewport(nodes, 0, 900)).toBeNull();
    expect(graphFitViewport([], 800, 600)).toBeNull();
  });
  it("never frames a focus below reading scale; a tall lineage centres on its anchor", () => {
    const anchor = { position: { x: 0, y: 4000 }, width: 200, height: 80 };
    const tall = [{ position: { x: 0, y: 0 }, width: 200, height: 80 }, anchor, { position: { x: 0, y: 8000 }, width: 200, height: 80 }];
    const view = readableFocusViewport(tall, anchor, 1200, 800)!;
    expect(view.zoom).toBeGreaterThanOrEqual(READABLE_GRAPH_ZOOM);
    expect((anchor.position.x + 100) * view.zoom + view.x).toBeCloseTo(600);
    expect((anchor.position.y + 40) * view.zoom + view.y).toBeCloseTo(400);
    // The nearest feeder that fits joins the frame; the far one does not.
    const near = { position: { x: 0, y: 4300 }, width: 200, height: 80 };
    const framed = readableFocusViewport([...tall, near], anchor, 1200, 800)!;
    expect(framed.zoom).toBeGreaterThanOrEqual(READABLE_GRAPH_ZOOM);
    expect((near.position.y + 80) * framed.zoom + framed.y).toBeLessThan(800);
    expect(tall[2]!.position.y * framed.zoom + framed.y).toBeGreaterThan(800);
    const small = [anchor, { position: { x: 300, y: 4000 }, width: 200, height: 80 }];
    const smallView = readableFocusViewport(small, anchor, 1200, 800)!;
    const smallFit = graphFitViewport(small, 1200, 800)!;
    expect(smallView.zoom).toBe(Math.min(FOCUS_MAX_ZOOM, smallFit.zoom));
    expect((250 * smallView.zoom) + smallView.x).toBeCloseTo((250 * smallFit.zoom) + smallFit.x);
  });
});
