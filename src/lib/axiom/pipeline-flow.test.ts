import { describe, expect, it } from "vitest";
import { attemptEvents, type PipelineEvent } from "./pipeline-events";
import { agentBrief, caseDetail, citationLanes, formatDuration, mineFlow, quantile } from "./pipeline-flow";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");

const tryOf = (attempt: number, ok: boolean, rule?: string) => ({
  attempt,
  model: "m",
  ms: 1000,
  cost: 0.01,
  ok,
  error: ok ? null : `x.yaml: ci: [${rule}] no`,
});

function log(): PipelineEvent[] {
  const attempts = [
    // Two runs that loop on tests, then deferral, and give up.
    pipelineAttempt({ id: "1", citation: "us/a", failed_step: "encode_apply", tries: [tryOf(1, false, "r:tests"), tryOf(2, false, "r:deferral")] }),
    pipelineAttempt({ id: "2", citation: "us/a", failed_step: "encode_apply", tries: [tryOf(1, false, "r:tests"), tryOf(2, false, "r:tests")] }),
    // One that passes on its second try and lands.
    mergedAttempt({
      id: "3",
      citation: "us/b",
      encode_started_at: "2026-09-20T10:01:00Z",
      tries: [tryOf(1, false, "r:tests"), tryOf(2, true)],
      indexed_at: "2026-09-21T12:00:00Z",
      index_status: "indexed",
      tests_status: "pass",
      tests_first_at: "2026-09-21T10:00:00Z",
      compile_status: "ok",
      compile_checked_at: "2026-09-22T03:00:00Z",
    }),
    // One cancelled at the approval, one still waiting there.
    pipelineAttempt({ id: "4", citation: "us/c", run_conclusion: "cancelled", cancel_stage: "approval" }),
    pipelineAttempt({ id: "5", citation: "dk/d", jurisdiction: "dk", run_status: "queued", run_conclusion: null, finished_at: null }),
  ];
  return attempts.flatMap(attemptEvents);
}

describe("mineFlow", () => {
  const model = mineFlow(log(), {
    now: NOW,
    days: 30,
    targets: [{ station: "validate", min_yield: 0.9, max_p95_hours: null, max_wip: null, sla_hours: null }],
    workflows: [{ label: "Release activation", grade: "failing", url: "https://x", detail: "Last run failed" }],
    deadlines: [{ label: "1,944 rulespec-us validation waivers expire", at: "2026-12-21T00:00:00Z", href: null }],
  });

  it("orders stations by the flow, not by a fixed list", () => {
    const ids = model.stations.map((s) => s.id);
    expect(ids.slice(0, 5)).toEqual(["dispatch", "approval", "setup", "generate", "validate"]);
    expect(ids.indexOf("merge")).toBeLessThan(ids.indexOf("index"));
  });

  it("finds the encode loop as a back edge and counts its tries", () => {
    const back = model.edges.find((e) => e.from === "validate" && e.to === "generate")!;
    expect(back.loop).toBe(true);
    expect(back.cases).toBe(3);
    const validate = model.stations.find((s) => s.id === "validate")!;
    expect(validate.tries).toEqual({ total: 6, ok: 1 });
    expect(validate.ok).toBe(1);
    expect(validate.failed).toBe(2);
  });

  it("ends cases in sinks and counts what waits", () => {
    expect(Object.fromEntries(model.sinks.map((s) => [s.id, s.cases]))).toEqual({ "exit:landed": 1, "exit:failed": 2, "exit:cancelled": 1 });
    expect(model.stations.find((s) => s.id === "approval")!.wip).toBe(1);
    expect(model.totals.landed).toBe(1);
  });

  it("builds the issue ladder: what persisted, what replaced a fixed rule, what passed", () => {
    const tests = model.ladder.rules.find((r) => r.rule_id === "r:tests")!;
    expect(tests.occurrences).toBe(4);
    expect(tests.persisted).toBe(1);
    expect(tests.fixed).toBe(1);
    expect(tests.followed_by).toEqual([{ rule_id: "r:deferral", count: 1 }]);
    expect(model.ladder.nodes.find((n) => n.id === "passed@2")?.cases).toBe(1);
    expect(model.ladder.nodes.find((n) => n.rule_id === "gave up")?.cases).toBe(2);
  });

  it("raises alerts from targets, workflows and deadlines, worst first", () => {
    const rules = model.alerts.map((a) => a.rule);
    expect(rules).toContain("workflow_red");
    expect(rules).toContain("deadline_near");
    expect(model.alerts[0].severity).toBe("critical");
    // Validate has only 3 finished cases: below the 10 a yield alert needs.
    expect(rules).not.toContain("yield_below_target");
  });

  it("scopes to a jurisdiction and those under it", () => {
    const dk = mineFlow(log(), { now: NOW, days: 30, jurisdiction: "dk" });
    expect(dk.totals.cases).toBe(1);
  });

  it("writes an agent brief with the alerts, stations and rules", () => {
    const brief = agentBrief(model, "https://axiom.org");
    expect(brief).toContain("# Encoding pipeline brief");
    expect(brief).toContain("Release activation is failing");
    expect(brief).toContain("`r:tests`");
    expect(brief).toContain("| Validate |");
  });
});

describe("citation lanes and case detail", () => {
  it("lists every case of a citation newest first, and one case with its visits", () => {
    const events = log();
    const lanes = citationLanes(events, "us/a");
    expect(lanes.map((l) => l.case_id).sort()).toEqual(["1", "2"]);
    expect(lanes[0].end).toBe("failed at Validate");
    const detail = caseDetail(events, "3")!;
    expect(detail.citation).toBe("us/b");
    expect(detail.end).toBe("landed");
    expect(detail.visits.filter((v) => v.station === "validate")).toHaveLength(2);
    expect(caseDetail(events, "missing")).toBeNull();
  });
});

describe("helpers", () => {
  it("quantile and formatDuration", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(3 * 3_600_000)).toBe("3.0h");
    expect(formatDuration(3 * 86_400_000)).toBe("3.0d");
  });
});
