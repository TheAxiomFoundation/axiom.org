import type { ExportArm, ExportModel, PolicyBenchExport } from "@/lib/aspen/free-plan-export";
import type { PilotChange } from "@/lib/aspen/content";

/**
 * MOCK DATA for tests only: an invented export in the shape PolicyBench's
 * scripts/aspen_export.py writes, not results and not derived from any run.
 * Four mock models on 48 amounts in 20 mock households, two of them on mock
 * free plans, listed after the others so the converter has to reorder them.
 */
const N = 48;
const arm = (k: number, lo: number, hi: number): ExportArm => ({ k, n: N, pct: (100 * k) / N, lo, hi });
// The paired change in points, with an interval `below` and `above` it.
function change(fromK: number, toK: number, below = 15, above = 15): PilotChange {
  const points = (100 * (toK - fromK)) / N;
  return { points, lo: points - below, hi: points + above };
}

function mockModel(id: string, freePlan: string | null, k: { alone: number; web: number; tool: number; both: number }, toolSpread = 15): ExportModel {
  return {
    model: `Mock model ${id.toUpperCase()}`,
    id: `mock-${id}`,
    group: freePlan ? "free-plan" : "other",
    freePlan,
    freePlanBasis: freePlan ? `MOCK: the default on ${freePlan}` : "MOCK: a comparison model",
    households: 20,
    partialBatches: [],
    runDates: ["2026-10-23", "2026-10-24"],
    arms: {
      alone: arm(k.alone, 10, 40),
      web: arm(k.web, 15, 50),
      tool: arm(k.tool, 40, 95),
      both: arm(k.both, 40, 95),
    },
    missing: { alone: 0, web: 0, tool: 0, both: 0 },
    vsAlone: { web: change(k.alone, k.web), tool: change(k.alone, k.tool, toolSpread, toolSpread), both: change(k.alone, k.both) },
    benefits: { alone: { k: 1, n: 3 }, web: { k: 1, n: 3 }, tool: { k: 3, n: 3 }, both: { k: 3, n: 3 } },
  };
}

export const MOCK_POLICYBENCH_EXPORT: PolicyBenchExport = {
  households: 20,
  engine: "policyengine-us 0.0.0-mock",
  // PolicyBench's one-size wording (aspen_export.py caveat_text), for the mock's size and noise width.
  caveat:
    "Preliminary internal pilot: 20 households sampled from PolicyEngine's microdata, 48 nonzero dollar amounts per model and setting. The models were called through their APIs with our prompt, not used in the free chat apps, and a change of less than about 15 points between settings is within noise at this size.",
  models: [
    mockModel("c", null, { alone: 30, web: 33, tool: 44, both: 45 }),
    mockModel("a", "Mock Free", { alone: 10, web: 15, tool: 38, both: 39 }),
    mockModel("d", null, { alone: 25, web: 29, tool: 41, both: 42 }),
    // B's change from no tools to the tool, 12.5 points, has an interval that includes zero: -4 to 29.
    mockModel("b", "Mock Chat Free", { alone: 18, web: 21, tool: 24, both: 27 }, 16.5),
  ],
  source: { scriptCommit: "0000000mock", scriptTreeDirty: false, generatedAtUtc: "2026-10-24T03:30:00Z" },
};
