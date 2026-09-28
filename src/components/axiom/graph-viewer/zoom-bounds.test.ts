import { describe, expect, it } from "vitest";
import { graphFitViewport, MAX_GRAPH_ZOOM } from "./zoom-bounds";
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
});
