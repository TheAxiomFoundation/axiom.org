import { describe, expect, it } from "vitest";
import type { FlowModel, StationStats } from "@/lib/axiom/pipeline-flow";
import { bandWidth, laneLayout, lineEnds, stationStatus, timeShare } from "./flow-layout";

function station(id: string, rank: number, extra: Partial<StationStats> = {}): StationStats {
  return {
    id,
    label: id,
    description: "",
    cases: 10,
    ok: 10,
    failed: 0,
    cancelled: 0,
    waived: 0,
    yield: 1,
    tries: null,
    wip: 0,
    p50_ms: null,
    p95_ms: null,
    trend: { now: { finished: 0, ok: 0 }, before: { finished: 0, ok: 0 } },
    timed: true,
    timed_share: 1,
    failures: [],
    oldest: [],
    over_sla: 0,
    target: null,
    position: rank,
    rank,
    flow: { joined: 0, moved_on: 0, failed_here: 0, cancelled_here: 0, landed_here: 0, waiting_here: 0, wait_before_ms: null, exit_causes: [], wait_causes: [] },
    ...extra,
  };
}

describe("process map geometry", () => {
  it("scales bands linearly against the busiest station, never thinner than 2px", () => {
    expect(bandWidth(0, 100)).toBe(0);
    expect(bandWidth(100, 100)).toBe(72);
    expect(bandWidth(50, 100)).toBe(36);
    expect(bandWidth(1, 1000)).toBe(2);
  });

  it("places times on one log axis from a minute to a month", () => {
    expect(timeShare(null)).toBeNull();
    expect(timeShare(10_000)).toBe(0);
    expect(timeShare(60_000)).toBe(0);
    expect(timeShare(30 * 86_400_000)).toBe(1);
    expect(timeShare(3_600_000)).toBeCloseTo(0.38, 2);
  });

  it("orders where cases ended: landed, each station's exits, still in the line", () => {
    const flow = (failed: number, cancelled: number) => ({ ...station("x", 0).flow, failed_here: failed, cancelled_here: cancelled });
    const ends = lineEnds({
      stations: [station("a", 0, { label: "A", flow: flow(0, 0) }), station("b", 1, { label: "B", flow: flow(3, 1) })],
      totals: { cases: 10, landed: 5, failed: 3, cancelled: 1, open: 1 } as FlowModel["totals"],
    });
    expect(ends.map((e) => [e.key, e.cases])).toEqual([
      ["landed", 5],
      ["exit:b", 4],
      ["open", 1],
    ]);
  });
});

describe("stationStatus", () => {
  it("takes the worst alert, else good with a target, else neutral", () => {
    const s = station("v", 0);
    expect(stationStatus(s, [])).toBe("neutral");
    const targeted = station("v", 0, { target: { station: "v", min_yield: 0.5, max_p95_hours: null, max_wip: null, sla_hours: null } });
    expect(stationStatus(targeted, [])).toBe("good");
    const alert = (severity: "critical" | "warning") => ({ id: severity, rule: "x", severity, station: "v", title: "", detail: "", href: null });
    expect(stationStatus(targeted, [alert("warning")])).toBe("warning");
    expect(stationStatus(targeted, [alert("warning"), alert("critical")])).toBe("critical");
  });
});

describe("laneLayout", () => {
  it("puts a pip per station a case visited, in the pipeline's columns", () => {
    const visit = (station: string, outcome: "ok" | "fail") => ({
      station,
      start: "2026-01-01T00:00:00Z",
      end: null,
      outcome,
      rule_id: null,
      try_no: null,
      duration_ms: null,
      actor: null,
      cost_usd: null,
      message: null,
      reason: null,
      ref_url: null,
      waived: false,
    });
    const layout = laneLayout(
      [{ case_id: "1", start: "", source: "pipeline_attempts", end: "failed", visits: [visit("a", "ok"), visit("b", "fail"), visit("a", "ok"), visit("b", "fail")] }],
      ["a", "b"]
    );
    expect(layout.pips.map((p) => [p.station, p.visits, p.outcome])).toEqual([
      ["a", 2, "ok"],
      ["b", 2, "fail"],
    ]);
    expect(layout.links).toHaveLength(1);
  });
});
