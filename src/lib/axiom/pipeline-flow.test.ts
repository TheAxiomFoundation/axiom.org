import { describe, expect, it } from "vitest";
import { attemptEvents, type PipelineEvent } from "./pipeline-events";
import { agentBrief, caseDetail, citationLanes, formatDuration, mineFlow, quantile, retryCutoff, trendSentence } from "./pipeline-flow";
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

  it("finds the rules that come back on the next try, and the cases that recovered", () => {
    const tests = model.ladder.rules.find((r) => r.rule_id === "r:tests")!;
    expect(tests.occurrences).toBe(4);
    expect(tests.persisted).toBe(1);
    expect(tests.fixed).toBe(1);
    expect(tests.stick_rate).toBe(0.5);
    expect(tests.recovered).toBe(1);
    expect(tests.followed_by).toEqual([{ rule_id: "r:deferral", count: 1 }]);
    // Under 10 failed tries: not ranked as stubborn yet.
    expect(model.ladder.stubborn).toEqual([]);
  });

  it("measures the retry loop: pass rate and cost by try", () => {
    expect(model.retry?.judge).toBe("validate");
    expect(model.retry?.work).toBe("generate");
    expect(model.retry?.steps.map((s) => [s.label, s.tries, s.passed, s.cost_usd])).toEqual([
      ["1", 3, 0, 0.03],
      ["2", 3, 1, 0.03],
    ]);
  });

  it("puts the cost and failures on looping citations", () => {
    const busy = mineFlow(
      Array.from({ length: 4 }, (_, i) =>
        attemptEvents(pipelineAttempt({ id: `L${i}`, citation: "us/loop", failed_step: "encode_apply", tries: [tryOf(1, false, "r:x")] }))
      ).flat(),
      { now: NOW, days: 30 }
    );
    expect(busy.looping).toEqual([expect.objectContaining({ citation: "us/loop", cases: 4, failed_visits: 4, cost_usd: 0.04, rules: ["r:x"] })]);
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

  it("counts dispatches, merges and what waits, and says where the data is blind", () => {
    expect(model.totals).toMatchObject({ dispatched: 5, dispatched_merged: 1, waiting: 1 });
    expect(model.totals.dispatch_to_merge_p50_ms).toBe(Date.parse("2026-09-21T09:00:00Z") - Date.parse("2026-09-20T10:00:00Z"));
    expect(model.trust).toMatchObject({ dispatched: 5, with_tries: 3, with_cost: 3, with_issue_list: 0 });
    expect(model.trust.untimed).toContain("pr_checks");
    const prChecks = model.stations.find((s) => s.id === "pr_checks")!;
    expect(prChecks.timed).toBe(false);
    expect(prChecks.p50_ms).toBeNull();
  });

  it("writes an agent brief with the alerts, stations and rules", () => {
    const brief = agentBrief(model, "https://axiom.org");
    expect(brief).toContain("# Encoding pipeline brief");
    expect(brief).toContain("Release activation is failing");
    expect(brief).toContain("5 runs dispatched, 1 merged (20%)");
    expect(brief).toContain("| Validate |");
    expect(brief).toContain("## How much these numbers can see");
    expect(brief.indexOf("## Alerts")).toBeLessThan(brief.indexOf("## Stations"));
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

describe("ruleTrends and followPairs", () => {
  // Ten citations, each run twice two weeks apart; the rule sticks on re-run in 6 of 10.
  const runs = Array.from({ length: 10 }, (_, i) => [
    pipelineAttempt({ id: `a${i}`, citation: `us/c${i}`, dispatched_at: "2026-09-01T10:00:00Z", failed_step: "encode_apply", tries: [tryOf(1, false, "r:x"), tryOf(2, false, "r:y")] }),
    pipelineAttempt({ id: `b${i}`, citation: `us/c${i}`, dispatched_at: "2026-09-15T10:00:00Z", failed_step: "encode_apply", tries: i < 6 ? [tryOf(1, false, "r:x"), tryOf(2, false, "r:x")] : [tryOf(1, false, "r:z"), tryOf(2, false, "r:w")] }),
    pipelineAttempt({ id: `c${i}`, citation: `us/d${i}`, dispatched_at: "2026-09-25T10:00:00Z", failed_step: "encode_apply", tries: [tryOf(1, false, "r:q"), tryOf(2, false, "r:v")] }),
  ]).flat();
  const events: PipelineEvent[] = [
    ...runs.flatMap(attemptEvents),
    { ...attemptEvents(runs[0])[0], id: "pr:axiom-encode#5/validate/change/r:x", case_id: "pr:axiom-encode#5", citation: "axiom-encode", station: "validate", kind: "change", at: "2026-09-08T00:00:00Z", rule_id: "r:x", source: "encoder_change", message: "Fix x", ref_url: "https://x/5", attrs: { number: 5 } },
  ];
  const m = mineFlow(events, { now: NOW, days: 60 });

  it("compares a rule week by week, on re-runs of the same citation, and marks the PRs that name it", () => {
    const x = m.trends.find((t) => t.rule_id === "r:x")!;
    expect(x.rerun).toEqual({ citations: 10, still: 6 });
    expect(x.changes).toEqual([{ at: "2026-09-08T00:00:00Z", number: 5, title: "Fix x", ref_url: "https://x/5" }]);
    // Change events are not cases.
    expect(m.totals.cases).toBe(30);
  });

  it("finds a rule that follows another's fix more often than usual", () => {
    // x is fixed 10 times and y follows every time; y appears new in 10 of 30 steps.
    const xy = m.follows.find((f) => f.fixed === "r:x" && f.next === "r:y");
    expect(xy).toMatchObject({ count: 10, share: 1, lift: 3 });
  });
});

describe("helpers", () => {
  it("retryCutoff finds the try from which every later try passes under 5%", () => {
    const step = (try_no: number, tries: number, passed: number) => ({ try_no, label: String(try_no), tries, passed, cost_usd: tries / 10, models: [] });
    const cut = retryCutoff([step(1, 368, 40), step(2, 339, 37), step(3, 295, 25), step(4, 261, 8)]);
    expect([cut?.from.try_no, cut?.tries, cut?.passed]).toEqual([4, 261, 8]);
    expect(retryCutoff([step(1, 10, 5), step(2, 10, 5)])).toBeNull();
  });

  it("trendSentence compares this week with the week before", () => {
    expect(trendSentence({ now: { finished: 0, ok: 0 }, before: { finished: 0, ok: 0 } })).toBe("No dated finishes in the last two weeks.");
    expect(trendSentence({ now: { finished: 20, ok: 5 }, before: { finished: 10, ok: 5 } })).toBe("10 more finished than the week before; yield down from 50% to 25%.");
    expect(trendSentence({ now: { finished: 10, ok: 5 }, before: { finished: 10, ok: 5 } })).toBe("Same volume as the week before; yield steady at 50%.");
  });

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
