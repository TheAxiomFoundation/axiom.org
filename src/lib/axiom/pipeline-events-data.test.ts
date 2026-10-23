import { afterEach, describe, expect, it, vi } from "vitest";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import { getCitationEvents } from "./pipeline-events-data";
import { getPipelineAttempts } from "./encoding-pipeline-data";
import { stationOrderOf } from "./pipeline-flow";

vi.mock("./encoding-pipeline-data", () => ({ getPipelineAttempts: vi.fn() }));
vi.mock("@/lib/corpus-status", () => ({ getSupabaseRestConfig: () => null, readSupabaseRows: vi.fn() }));

afterEach(() => vi.mocked(getPipelineAttempts).mockReset());

describe("getCitationEvents", () => {
  it("derives only that citation's attempts while the table is missing", async () => {
    vi.mocked(getPipelineAttempts).mockResolvedValue({
      attempts: [mergedAttempt({ id: "a" }), pipelineAttempt({ id: "b", citation: "us/other" })],
      available: true,
      error: null,
    });
    const result = await getCitationEvents("us/statute/7/2017/a");
    expect(result.origin).toBe("derived");
    expect(new Set(result.events.map((e) => e.case_id))).toEqual(new Set(["a"]));
  });
});

describe("stationOrderOf", () => {
  it("keeps the line's order, then adds unknown stations as they appear", () => {
    const events = [{ station: "zeta" }, { station: "validate" }, { station: "alpha" }] as Parameters<typeof stationOrderOf>[0];
    const order = stationOrderOf(events);
    expect(order.slice(0, 5)).toEqual(["dispatch", "approval", "setup", "generate", "validate"]);
    expect(order.slice(-2)).toEqual(["zeta", "alpha"]);
  });
});
