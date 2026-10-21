import { describe, expect, it } from "vitest";
import type { FlowEdge, StationStats } from "@/lib/axiom/pipeline-flow";
import { ladderLayout, laneLayout, pipelineLayout, stationStatus } from "./flow-layout";

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
    weekly: [],
    failures: [],
    oldest: [],
    over_sla: 0,
    target: null,
    position: rank,
    rank,
    ...extra,
  };
}

const edge = (from: string, to: string, cases: number, loop = false): FlowEdge => ({ from, to, cases, median_wait_ms: null, loop });

describe("pipelineLayout", () => {
  const ids = "abcdefghij".split("");
  const layout = pipelineLayout({
    stations: ids.map((id, i) => station(id, i)),
    edges: [
      ...ids.slice(1).map((id, i) => edge(ids[i], id, 100)),
      edge("d", "c", 40, true),
      edge("c", "c", 5),
      edge("j", "a", 1, true),
      edge("c", "exit:failed", 30),
      edge("j", "exit:landed", 60),
    ],
    sinks: [
      { id: "exit:failed", label: "Failed", cases: 30 },
      { id: "exit:landed", label: "Landed", cases: 60 },
    ],
  });

  it("lays ten stations on a serpentine of two rows", () => {
    const at = Object.fromEntries(layout.stations.map((p) => [p.id, p]));
    expect(at.a.row).toBe(0);
    expect(at.e.row).toBe(0);
    expect(at.f.row).toBe(1);
    // The second row runs back: its first station sits under the first row's last.
    expect(at.f.x).toBe(at.e.x);
    expect(at.j.x).toBe(at.a.x);
  });

  it("routes edges by geometry and kind, keeps self loops on the node and drops noise", () => {
    const byId = Object.fromEntries(layout.edges.map((e) => [`${e.from}>${e.to}`, e]));
    expect(byId["a>b"]).toMatchObject({ kind: "main", sourceHandle: "s-r", targetHandle: "t-l" });
    expect(byId["f>g"]).toMatchObject({ kind: "main", sourceHandle: "s-l", targetHandle: "t-r" });
    expect(byId["e>f"]).toMatchObject({ sourceHandle: "s-b", targetHandle: "t-t" });
    expect(byId["d>c"].kind).toBe("loop");
    expect(byId["c>exit:failed"].kind).toBe("exit");
    expect(byId["j>a"]).toBeUndefined();
    expect(layout.selfLoops.get("c")).toBe(5);
    expect(layout.sinks.map((s) => s.sink).sort()).toEqual(["exit:failed", "exit:landed"]);
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

describe("laneLayout and ladderLayout", () => {
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

  it("stacks rules down each try column with the ends last", () => {
    const placed = ladderLayout({
      nodes: [
        { id: "gave up@2", rule_id: "gave up", try_no: 2, cases: 9 },
        { id: "r@2", rule_id: "r", try_no: 2, cases: 1 },
        { id: "other@2", rule_id: "other", try_no: 2, cases: 5 },
        { id: "r@1", rule_id: "r", try_no: 1, cases: 3 },
      ],
      edges: [],
      max_try: 2,
      rules: [],
      cases: 3,
    });
    const col2 = placed.filter((n) => n.try_no === 2).sort((a, b) => a.y - b.y).map((n) => n.rule_id);
    expect(col2).toEqual(["r", "other", "gave up"]);
    expect(placed.find((n) => n.id === "r@1")!.x).toBe(0);
  });
});
