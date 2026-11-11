import { describe, expect, it } from "vitest";
import { attemptEvents, type PipelineEvent } from "./pipeline-events";
import { agentBrief, caseDetail, caseOracle, encodeState, causeOrigin, causeText, citationLanes, formatDuration, inJurisdiction, mineFlow, quantile, rankStations, retryCutoff, ruleWords, splitMessage, trendSentence, type FlowEdge } from "./pipeline-flow";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import { ingestEvents, type IngestInputs } from "./pipeline-ingest";

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
    // Each failure keeps its latest error text and its latest cases, one per citation.
    const validateTests = model.stations.find((s) => s.id === "validate")!.failures.find((f) => f.rule_id === "r:tests")!;
    expect(validateTests.message).toBe("x.yaml: ci: [r:tests] no");
    expect(validateTests.examples.map((x) => x.citation).sort()).toEqual(["us/a", "us/b"]);
    // Under 10 failed tries: not ranked as stubborn yet.
    expect(model.ladder.stubborn).toEqual([]);
  });

  it("sorts the failed cases into failure classes by the visit each failed at", () => {
    // Cases 1 and 2 failed validation on a named rule; case 4 was cancelled, which is no failure.
    expect(model.failure_classes).toEqual([
      {
        id: "rejected",
        label: "Validator rejected the output",
        owner: "Encoder or validator",
        cases: 2,
        basis: { encoder: 0, rule: 2, text: 0 },
        causes: [
          { station: "validate", cause: "r:deferral", cases: 1 },
          { station: "validate", cause: "r:tests", cases: 1 },
        ],
      },
    ]);
  });

  it("takes a failure class the encoder recorded on the event first", () => {
    const events = log().map((e) => (e.case_id === "1" && e.kind === "fail" ? { ...e, attrs: { ...e.attrs, failure_class: { class: "dependency", subclass: null } } } : e));
    const rows = mineFlow(events, { now: NOW, days: 30 }).failure_classes;
    // Equal counts keep the class order.
    expect(rows.map((r) => [r.id, r.cases, r.basis.encoder])).toEqual([
      ["rejected", 1, 0],
      ["dependency", 1, 1],
    ]);
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

  it("says where each station's cases came from and went, and why they left", () => {
    const at = (id: string) => model.stations.find((s) => s.id === id)!.flow;
    expect(at("dispatch")).toMatchObject({ joined: 5, moved_on: 5 });
    // Two runs fail at Validate on their last try's rule; one is cancelled at the approval.
    expect(at("validate")).toMatchObject({ failed_here: 2, cancelled_here: 0 });
    expect(at("validate").exit_causes.map((c) => [c.cause, c.cases, c.origin])).toEqual([
      ["r:deferral", 1, "validator"],
      ["r:tests", 1, "validator"],
    ]);
    expect(at("approval")).toMatchObject({ cancelled_here: 1, waiting_here: 1 });
    expect(at("approval").exit_causes[0]).toMatchObject({ cause: "cancel:approval", origin: "cancel" });
    expect(at("approval").wait_causes[0]).toMatchObject({ cause: "wait:approval", cases: 1 });
    expect(at("compile").landed_here).toBe(1);
    // A case ends at one station: the exits add up to the sinks.
    const exits = model.stations.reduce((n, s) => n + s.flow.failed_here + s.flow.cancelled_here, 0);
    expect(exits).toBe(model.totals.failed + model.totals.cancelled);
  });

  it("narrows the line to one kind of case and counts each kind", () => {
    const outside = attemptEvents(
      mergedAttempt({ id: "pr:rulespec-us#9:statutes/x.yaml", citation: "us/x", indexed_at: "2026-09-21T12:00:00Z", index_status: "indexed", tests_status: "pass" })
    );
    const both = [...log(), ...outside];
    const all = mineFlow(both, { now: NOW, days: 30 });
    expect(all.populations).toEqual({ all: 6, runs: 5, prs: 1, modules: 0 });
    const prs = mineFlow(both, { now: NOW, days: 30, population: "prs" });
    expect(prs.population).toBe("prs");
    expect(prs.totals.cases).toBe(1);
    expect(prs.stations[0].flow.joined).toBe(1);
  });

  it("writes an agent brief with the alerts, stations and rules", () => {
    const brief = agentBrief(model, "https://axiom.org");
    expect(brief).toContain("# Encoding pipeline brief");
    expect(brief).toContain("Release activation is failing");
    expect(brief).toContain("5 runs dispatched, 1 merged (20%)");
    expect(brief).toContain("| Validate |");
    expect(brief).toContain("## How much these numbers can see");
    expect(brief).toContain("## Where cases leave the line, and why (all cases)");
    expect(brief).toContain("`r:tests` (Validator check)");
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
  it("splitMessage separates the file from what the check said, and ruleWords reads an id", () => {
    expect(splitMessage("statutes/7/1.yaml: ci: [complete-source-unit:tests] Source branch (a) is not tested.")).toEqual({
      file: "statutes/7/1.yaml",
      text: "Source branch (a) is not tested.",
    });
    expect(splitMessage("Axiom rules engine compile failed")).toEqual({ file: null, text: "Axiom rules engine compile failed" });
    expect(ruleWords("complete-source-unit:numeric-recall")).toBe("Complete source unit: numeric recall");
    expect(ruleWords("proof-source-evidence-not-found-rule")).toBe("Proof source evidence not found rule");
  });

  it("causeOrigin names the system behind a reason from its prefix", () => {
    expect(causeOrigin("complete-source-unit:tests")).toBe("validator");
    expect(causeOrigin("check:build")).toBe("ci_check");
    expect(causeOrigin("infra:no-pr")).toBe("workflow");
    expect(causeOrigin("compile:compile_error")).toBe("compile");
    expect(causeOrigin("text:proof-source-evidence")).toBe("encoder_text");
    expect(causeOrigin("cancel:setup")).toBe("cancel");
    expect(causeOrigin("unknown")).toBe("unknown");
    expect(causeOrigin(null)).toBe("unknown");
    expect(causeText("cancel:approval")).toBe("Cancelled while it waited for the signing approval");
    expect(causeText("cancel:merge")).toBe("Cancelled at Merge");
    expect(causeText("wait:tests")).toBe("No reason recorded");
    expect(causeText("complete-source-unit:tests")).toBeNull();
  });

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

describe("rankStations", () => {
  const edge = (from: string, to: string, cases = 5): FlowEdge => ({ from, to, cases, median_wait_ms: null, loop: false });

  it("puts a line station that nothing reaches in the window after the stations before it", () => {
    const stations = ["dispatch", "setup", "merge", "compile", "oracle"].map((id) => ({ id, cases: 5 }));
    const rank = rankStations(stations, [edge("dispatch", "setup"), edge("setup", "merge"), edge("merge", "compile")]);
    expect(rank.get("oracle")).toBe(4);
    expect(rank.get("dispatch")).toBe(0);
  });

  it("leaves the entry station and stations off the line where the edges put them", () => {
    const stations = ["dispatch", "setup", "custom"].map((id) => ({ id, cases: 5 }));
    const rank = rankStations(stations, [edge("dispatch", "setup")]);
    expect([rank.get("dispatch"), rank.get("setup"), rank.get("custom")]).toEqual([0, 1, 0]);
  });
});

describe("mineFlow with corpus releases", () => {
  const hour = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const base = Date.parse("2026-09-20T00:00:00Z");
  // Four releases, each published an hour after its commit and pinned a day later.
  const releases: IngestInputs = {
    releases: [1, 2, 3, 4].map((i) => ({ name: `us-rulespec-r${i}`, signedAt: iso(base + i * hour) })),
    runs: [1, 2, 3, 4].map((i) => ({
      id: i,
      url: `https://github.com/run/${i}`,
      headSha: `s${i}`,
      commitAt: iso(base + i * hour),
      commitMessage: `Merge pull request #${i} from x`,
      createdAt: iso(base + i * hour + 60_000),
      updatedAt: iso(base + (i + 1) * hour),
      conclusion: "success",
    })),
    prs: {},
    activations: [],
    pins: [1, 2, 3, 4].map((i) => ({ repo: "rulespec-us", release: `us-rulespec-r${i}`, at: iso(base + (i + 25) * hour), ref_url: null })),
    toActivate: [],
  };
  const events = [...log(), ...ingestEvents(releases)];
  const model = mineFlow(events, { now: NOW, days: 30, unmeasured: { target_gate: "gate not live yet", release_pin: "ignored: it has events" } });

  it("ranks the corpus line before the encode line, and shows a station with no event only with a reason", () => {
    const ids = model.stations.map((s) => s.id);
    expect(ids.slice(0, 5)).toEqual(["corpus_ingest", "release_publish", "release_pin", "dispatch", "approval"]);
    const gate = model.stations.find((s) => s.id === "target_gate")!;
    expect(gate).toMatchObject({ cases: 0, unmeasured: "gate not live yet", timed: false });
    expect(ids.indexOf("target_gate")).toBeGreaterThan(ids.indexOf("setup"));
    expect(model.stations.find((s) => s.id === "release_pin")?.unmeasured).toBeUndefined();
    expect(model.trust.unmeasured).toEqual([{ station: "target_gate", reason: "gate not live yet" }]);
    expect(model.trust.untimed).not.toContain("target_gate");
  });

  it("times a release station from three releases, and counts the pin lag", () => {
    const pin = model.stations.find((s) => s.id === "release_pin")!;
    expect(pin).toMatchObject({ cases: 4, ok: 4, timed: true, p50_ms: 24 * hour });
    expect(model.stations.find((s) => s.id === "release_publish")).toMatchObject({ timed: true, cases: 4 });
    // Corpus ingest without the PRs: points, not measured.
    expect(model.trust.untimed).toContain("corpus_ingest");
  });

  it("keeps releases out of the totals, sinks and populations, and in every path", () => {
    const encodes = mineFlow(log(), { now: NOW, days: 30 });
    expect(model.totals).toEqual(encodes.totals);
    expect(model.sinks).toEqual(encodes.sinks);
    expect(model.populations).toEqual(encodes.populations);
    expect(model.trust.releases).toBe(4);
    const runs = mineFlow(events, { now: NOW, days: 30, population: "runs" });
    expect(runs.stations.find((s) => s.id === "release_pin")?.cases).toBe(4);
  });

  it("names the release and gate reasons and their sources", () => {
    expect(causeText("release:not-pinned")).toBe("Not pinned in its rulespec repo yet");
    expect(causeText("release:not-activated")).toBe("Signed, not activated yet");
    expect(causeText("release:publish-failure")).toBe("Publish run failed");
    expect(causeText("release:publish-timed_out")).toBe("Publish run timed out");
    expect(causeText("gate:pre-encode-blocked")).toBe("Stopped by the pre-encode gate");
    expect(causeOrigin("release:not-pinned")).toBe("corpus_release");
    expect(causeOrigin("gate:pre-encode-blocked")).toBe("target_gate");
  });

  it("tells agents which stations are not measured, and how many releases there were", () => {
    const brief = agentBrief(model, "https://axiom.org");
    expect(brief).toContain("Not measured: Target gate (gate not live yet).");
    expect(brief).toContain("4 corpus releases in the window.");
    expect(brief).toContain("not measured: gate not live yet");
  });
});

describe("inJurisdiction", () => {
  it("covers the jurisdictions under a scope, or with only the scope itself", () => {
    expect(inJurisdiction("us-ca", "us")).toBe(true);
    expect(inJurisdiction("us-ca", "us", true)).toBe(false);
    expect(inJurisdiction("us", "us", true)).toBe(true);
    expect(inJurisdiction("usx", "us")).toBe(false);
    expect(inJurisdiction(null, "us")).toBe(false);
    expect(inJurisdiction("dk", null, true)).toBe(true);
  });
});

describe("where cases wait now", () => {
  const open = (id: string, citation: string, overrides: Parameters<typeof pipelineAttempt>[0] = {}) =>
    pipelineAttempt({
      id,
      citation,
      run_conclusion: "success",
      encode_seconds: 60,
      pr_repo: "rulespec-us",
      pr_number: Number(id),
      pr_url: `https://github.com/x/pull/${id}`,
      pr_state: "open",
      pr_created_at: "2026-09-20T10:29:00Z",
      pr_checks: "success",
      pr_review: "none",
      ...overrides,
    });
  const events = [
    open("11", "us/behind-old", { pr_created_at: "2026-09-10T10:29:00Z", dispatched_at: "2026-09-10T10:00:00Z", finished_at: "2026-09-10T10:28:00Z", pr_merge_state: "BEHIND", pr_commit_count: 3 }),
    open("12", "us/behind-new", { pr_merge_state: "BEHIND" }),
    open("13", "us/draft", { pr_state: "draft" }),
    open("14", "us/ci", { pr_checks: "pending" }),
    pipelineAttempt({ id: "15", citation: "us/queued", run_status: "queued", run_conclusion: null, finished_at: null }),
    // Failed checks on PRs that are still open, and one that was closed.
    open("16", "us/red-a", { pr_state: "draft", pr_checks: "failure", pr_failed_checks: ["validate / validate (us)"] }),
    open("17", "us/red-b", { pr_state: "draft", pr_checks: "failure", pr_failed_checks: ["validate / validate (us)"] }),
    open("18", "us/red-c", { pr_state: "draft", pr_checks: "failure", pr_failed_checks: ["guards"] }),
    open("19", "us/red-closed", { pr_state: "closed", pr_closed_at: "2026-09-21T00:00:00Z", pr_checks: "failure", pr_failed_checks: ["guards"] }),
  ].flatMap(attemptEvents);
  const model = mineFlow(events, { now: NOW, days: 30, targets: [{ station: "review", min_yield: null, max_p95_hours: null, max_wip: null, sla_hours: 24 * 15 }] });

  it("groups open cases by station and reason, most cases first, with the oldest of each", () => {
    expect(model.waiting.slice(0, 2).map((w) => [w.station, w.cause, w.cases])).toEqual([
      ["pr_checks", "check:failed-pr-open", 3],
      ["review", "merge:behind-base", 2],
    ]);
    // Failed with the PR still open: listed, with the checks that failed, and not counted as WIP.
    expect(model.waiting[0]).toMatchObject({ failed: true, runs: 3, detail: "2 × validate / validate (us); 1 × guards" });
    expect(model.stations.find((s) => s.id === "pr_checks")!.wip).toBe(1);
    const behind = model.waiting[1];
    expect(behind).toMatchObject({ runs: 2, over_sla: 1 });
    expect(Date.parse(behind.since)).toBe(Date.parse("2026-09-10T10:29:00Z"));
    expect(behind.oldest.map((o) => o.citation)).toEqual(["us/behind-old", "us/behind-new"]);
    expect(behind.detail).toContain("2 branch updates so far");
    const causes = model.waiting.map((w) => `${w.station}/${w.cause}`);
    expect(causes).toEqual(expect.arrayContaining(["review/review:draft", "pr_checks/check:pending", "approval/wait:approval"]));
    // Every open case is in exactly one group; the closed PR is in none.
    expect(model.waiting.reduce((sum, w) => sum + w.cases, 0)).toBe(8);
  });

  it("puts the same table in the agent brief, and has words for each reason", () => {
    const brief = agentBrief(model, "https://axiom.org");
    expect(brief).toContain("## Where cases wait now");
    expect(brief).toContain("`merge:behind-base`");
    expect(brief).toContain("us/behind-old");
    for (const cause of ["merge:behind-base", "review:draft", "check:pending", "check:failed-pr-open", "review:no-reviewer-requested", "review:approval-not-on-head", "tests:no-verdict", "publish:artifact-only"]) {
      expect(causeText(cause)).not.toBe(cause);
    }
  });
});

describe("what a run recorded: typed checks, no encode, and the oracle state", () => {
  const typed = {
    attempt: 1,
    model: "m",
    ms: 1000,
    cost: 0.01,
    ok: false,
    error: "x.yaml: ci: [complete-source-unit:structure] no",
    checks: [
      { id: "complete-source-unit:structure/branch-unencoded", gate: "ci", n: 2 },
      { id: "compile:rules-engine/failed", gate: "compile", n: 1 },
    ],
    checksMore: 1,
  };
  const landed = { indexed_at: "2026-09-21T12:00:00Z", index_status: "indexed" as const, tests_status: "waived" as const, tests_first_at: "2026-09-21T13:00:00Z", compile_status: "ok" as const, compile_checked_at: "2026-09-22T03:00:00Z" };
  const events = [
    // Failed with a typed try, then one that names no typed check.
    pipelineAttempt({ id: "1", citation: "us/a", failed_step: "encode_apply", tries: [typed, tryOf(2, false, "r:tests")] }),
    pipelineAttempt({ id: "2", citation: "us/b", failed_step: "encode_apply", tries: [{ ...typed, checksMore: undefined }] }),
    // Cancelled at the approval, and failed in setup: no encode ran.
    pipelineAttempt({ id: "3", citation: "us/c", run_conclusion: "cancelled", cancel_stage: "approval" }),
    pipelineAttempt({ id: "4", citation: "us/d", encode_started_at: "2026-09-20T10:01:00Z", failed_step: "Queue protected signed RuleSpec re-encode / Verify immutable checkout identities" }),
    // The encode step ran with no try record (a run from before the encoder synced its tries).
    pipelineAttempt({ id: "5", citation: "us/e", encode_started_at: "2026-09-20T10:01:00Z", encode_seconds: 12, failed_step: "encode_apply" }),
    // Still waiting for the approval.
    pipelineAttempt({ id: "6", citation: "us/f", run_status: "queued", run_conclusion: null, finished_at: null }),
    // Merged: one pending in the ledger, one no oracle compares, one compared.
    mergedAttempt({ id: "7", citation: "us/g", tries: [tryOf(1, true)], ...landed, oracle_status: "pending" }),
    mergedAttempt({ id: "8", citation: "us/h", tries: [tryOf(1, true)], ...landed }),
    mergedAttempt({ id: "9", citation: "us/i", tries: [tryOf(1, true)], ...landed, oracle_status: "match", oracle_checked_at: "2026-09-22T00:00:00Z", oracle_engine: "policyengine" }),
  ].flatMap(attemptEvents);
  const model = mineFlow(events, { now: NOW, days: 30 });

  it("keeps a failed try's typed checks on its visit", () => {
    const fail = caseDetail(events, "1")!.visits.find((v) => v.station === "validate" && v.try_no === 1)!;
    expect(fail.rule_id).toBe("complete-source-unit:structure");
    expect(fail.checks).toEqual(typed.checks);
    expect(fail.checks_more).toBe(1);
    expect(caseDetail(events, "1")!.visits.find((v) => v.station === "validate" && v.try_no === 2)).not.toHaveProperty("checks");
    // An event that lists ids only (another writer's attrs.checks) still reads.
    const idsOnly = events.map((e) => (e.case_id === "2" && e.attrs.check_detail ? { ...e, attrs: { checks: e.attrs.checks } } : e));
    expect(caseDetail(idsOnly, "2")!.visits.find((v) => v.station === "validate")!.checks).toEqual([
      { id: "complete-source-unit:structure/branch-unencoded", gate: null, n: null },
      { id: "compile:rules-engine/failed", gate: null, n: null },
    ]);
  });

  it("counts the typed checks that failed tries, with their gates", () => {
    expect(model.typed_checks).toEqual([
      { id: "compile:rules-engine/failed", gate: "compile", tries: 2, cases: 2 },
      { id: "complete-source-unit:structure/branch-unencoded", gate: "ci", tries: 2, cases: 2 },
    ]);
    const brief = agentBrief(model, "https://axiom.org");
    expect(brief).toContain("## Typed checks that failed tries");
    expect(brief).toContain("- `compile:rules-engine/failed` (gate compile): 2 tries in 2 cases");
  });

  it("says when no encode ran, and where the run stopped", () => {
    const state = (id: string) => caseDetail(events, id)!.encode;
    expect(state("1")).toEqual({ state: "tries", label: "Tries recorded" });
    expect(state("3")).toEqual({ state: "no_encode", label: "No encode ran: cancelled at Signing approval" });
    expect(state("4")).toEqual({ state: "no_encode", label: "No encode ran: failed at Setup (infra:verify-immutable-checkout-identities)" });
    expect(state("5").state).toBe("no_try_record");
    expect(state("5").label).toMatch(/^No try recorded: the encode step ran/);
    expect(state("6")).toEqual({ state: "not_yet", label: "Not at the encode step yet" });
    expect(encodeState([{ station: "merge", outcome: "ok", actor: null, rule_id: null }]).state).toBe("outside");
  });

  it("gives a merged case an oracle state: compared, pending, or none", () => {
    expect(caseDetail(events, "7")!.oracle).toMatchObject({ state: "pending" });
    expect(caseDetail(events, "7")!.oracle!.label).toContain("oracle-coverage-pending.yaml");
    expect(caseDetail(events, "8")!.oracle).toEqual({ state: "none", label: "No oracle compares this module" });
    expect(caseDetail(events, "9")!.oracle).toMatchObject({ state: "compared" });
    expect(caseDetail(events, "1")!.oracle).toBeNull();
    // A pending or uncompared module still lands: the state is not a wait.
    expect(caseDetail(events, "7")!.end).toBe("landed");
    expect(caseDetail(events, "8")!.end).toBe("landed");
    // A merge event from before the state was recorded says nothing.
    expect(caseOracle([{ station: "merge", outcome: "ok" }])).toBeNull();
  });

  it("counts all three in what the numbers can see", () => {
    expect(model.trust).toMatchObject({
      dispatched: 9,
      with_typed_checks: 2,
      no_encode: 2,
      no_try_record: 1,
      oracle: { merged: 3, compared: 1, pending: 1, none: 1, unknown: 0 },
    });
    const brief = agentBrief(model, "https://axiom.org");
    expect(brief).toContain("2 typed checks (rule id and gate) on a failed try");
    expect(brief).toContain("2 ran no encode (the run ended before the encode step); 1 ran the encode step with no try record");
    expect(brief).toContain("Of 3 merged: 1 compared by an oracle, 1 pending (listed in oracle-coverage-pending.yaml), 1 with no oracle.");
  });
});
