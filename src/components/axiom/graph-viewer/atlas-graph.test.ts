import { describe, expect, it } from "vitest";
import { atlasGraph } from "./atlas-graph";
import type { ProgramGraph } from "./types";
describe("live atlas structure", () => {
 it("includes imported rules, inputs, and their real dependencies", () => {
  const graph = { rules: [{ legalId: "root#out", ruleDeps: ["import#rule"], inputDeps: [], relationDeps: [] }, { legalId: "import#rule", ruleDeps: [], inputDeps: ["import#input"], relationDeps: [] }], inputs: [{ legalId: "import#input" }], relations: [], ownOutputs: ["root#out"], terminalOutputs: ["root#out"] } as unknown as ProgramGraph;
  const preview = atlasGraph(graph);
  expect(preview.n).toBe(3);
  expect(preview.e).toEqual([[1,0],[2,1]]);
  expect(preview.p.every(point => point.every(value => Number.isFinite(value) && value >= 0 && value <= 1))).toBe(true);
  expect(preview.p[2]![0]).toBeLessThan(preview.p[0]![0]);
 });
 it("does not invent structure for an empty response", () => {
  expect(atlasGraph({ rules: [], inputs: [], relations: [], ownOutputs: [], terminalOutputs: [] }).n).toBe(0);
 });
});
