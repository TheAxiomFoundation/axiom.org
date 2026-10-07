import { describe, expect, it } from "vitest";
import { dispatchFlow, encodeParts, runRow, runRows, runTimeline, shortDuration, stepTimes, testsParts } from "./encoding-pipeline-runs";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

describe("runRow", () => {
  it("records a run's provenance and outcome", () => {
    const row = runRow(
      pipelineAttempt({
        id: "7",
        citation: "us-nc:manual/x",
        jurisdiction: "us-nc:manual",
        dispatched_by: "Pavel",
        encoder_version: "0.2.2087",
        dispatched_at: "2026-10-01T10:00:00Z",
        encode_started_at: "2026-10-01T10:02:00Z",
        finished_at: "2026-10-01T10:32:00Z",
        encoder_error: "a.yaml: ci: [complete-source-unit:tests] Companion tests do not demonstrate it",
        encoder_error_rule: "complete-source-unit:tests",
        failure_source: "diagnostics",
      })
    );
    expect(row).toMatchObject({
      id: "7",
      jurisdiction: "us-nc",
      by: "Pavel",
      encoder: "0.2.2087",
      approvalMs: 120_000,
      runMs: 1_800_000,
      outcome: "failed",
      outcomeLabel: "Failed validation",
      cause: "complete-source-unit:tests",
      pr: null,
      merged: null,
      index: null,
    });
  });

  it("names waiting, running, cancelled, and timed-out runs", () => {
    const label = (overrides: Parameters<typeof pipelineAttempt>[0]) => runRow(pipelineAttempt(overrides)).outcomeLabel;
    expect(label({ run_status: "waiting", run_conclusion: null })).toBe("Waiting for approval");
    expect(label({ run_status: "in_progress", run_conclusion: null })).toBe("Running");
    expect(label({ run_conclusion: "cancelled", cancel_stage: "approval" })).toBe("Cancelled at approval");
    expect(label({ run_conclusion: "cancelled", cancel_stage: "before_job" })).toBe("Cancelled before the run");
    expect(label({ run_conclusion: "cancelled", cancel_stage: "running" })).toBe("Cancelled mid-run");
    expect(label({ run_conclusion: "cancelled" })).toBe("Cancelled");
    expect(label({ run_conclusion: "timed_out" })).toBe("Timed out");
    // A failure not looked up yet has no cause to show.
    expect(runRow(pipelineAttempt({ failure_source: null })).cause).toBeNull();
  });

  it("follows a PR through the merge, the index, and the tests, and clips long text", () => {
    const merged = runRow(
      mergedAttempt({ synced_at: "2026-09-22T00:00:00Z", index_status: "indexed", tests_status: "pass", tests_run_url: "R" })
    );
    expect(merged).toMatchObject({
      outcome: "encoded",
      pr: {
        label: "rulespec-us#42",
        state: "merged",
        error: null,
        openedAt: "2026-09-20T10:29:00Z",
        mergedAt: "2026-09-21T09:00:00Z",
      },
      merged: "main",
      index: "indexed",
      tests: "pass",
      testsUrl: "R",
    });
    expect(runRow(mergedAttempt({ index_status: "missing" })).index).toBe("missing");
    expect(
      runRow(
        mergedAttempt({
          setup_seconds: 240,
          encode_seconds: 360,
          publish_seconds: 30,
          generation_attempts: 2,
          indexed_at: "I",
          tests_first_at: "T",
        })
      )
    ).toMatchObject({
      phases: { setupMs: 240_000, encodeMs: 360_000, publishMs: 30_000 },
      attempts: 2,
      indexedAt: "I",
      testsAt: "T",
    });
    // Off main, the index and the tests on main do not apply.
    expect(runRow(mergedAttempt({ pr_targets_default: false, indexed_at: "I" })).indexedAt).toBeNull();
    expect(runRow(mergedAttempt({})).index).toBe("awaiting");
    expect(runRow(mergedAttempt({ pr_targets_default: false })).merged).toBe("off main");
    const open = runRow(
      pipelineAttempt({ run_conclusion: "success", pr_state: "draft", pr_url: "u", pr_check_error: "x".repeat(400) })
    );
    expect(open.pr).toMatchObject({ label: "PR", state: "draft" });
    expect(open.pr?.error).toHaveLength(180);
  });

  it("lists runs newest first", () => {
    const rows = runRows([
      pipelineAttempt({ id: "a", dispatched_at: "2026-09-01T00:00:00Z" }),
      pipelineAttempt({ id: "b", dispatched_at: "2026-09-03T00:00:00Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("dispatchFlow", () => {
  it("counts each gate's runs from those that passed the gate before", () => {
    const rows = runRows([
      pipelineAttempt({ id: "w", run_status: "waiting", run_conclusion: null }),
      pipelineAttempt({ id: "c", run_conclusion: "cancelled", cancel_stage: "approval" }),
      pipelineAttempt({ id: "v1", encoder_error_rule: "rule-a", failure_source: "diagnostics" }),
      pipelineAttempt({ id: "v2", encoder_error_rule: "rule-a", failure_source: "diagnostics" }),
      pipelineAttempt({ id: "s", failed_step: "Verify immutable checkout identities", failure_source: "jobs" }),
      pipelineAttempt({ id: "m", run_conclusion: "cancelled", cancel_stage: "running" }),
      pipelineAttempt({ id: "r", run_status: "in_progress", run_conclusion: null }),
      pipelineAttempt({ id: "n", run_conclusion: "success" }),
      pipelineAttempt({ id: "o", run_conclusion: "success", pr_state: "open", pr_url: "u" }),
      pipelineAttempt({ id: "x", run_conclusion: "success", pr_state: "closed", pr_url: "u" }),
      mergedAttempt({ id: "off", pr_targets_default: false }),
      mergedAttempt({ id: "miss", index_status: "missing" }),
      mergedAttempt({ id: "wait" }),
      mergedAttempt({ id: "pass", synced_at: "S", index_status: "indexed", tests_status: "pass" }),
      mergedAttempt({ id: "fail", synced_at: "S", index_status: "indexed", tests_status: "fail" }),
      mergedAttempt({ id: "none", synced_at: "S", index_status: "indexed" }),
    ]);
    const flow = dispatchFlow(rows);
    const summary = flow.map((gate) => [gate.key, gate.input, gate.segments.map((s) => `${s.kind}:${s.label}:${s.count}`)]);
    expect(summary).toEqual([
      ["approval", 16, ["continue:Approved:14", "pending:Waiting:1", "loss:Cancelled at approval:1"]],
      [
        "run",
        14,
        ["continue:Encoded:9", "pending:Running:1", "loss:Failed validation:2", "loss:Failed in setup:1", "loss:Cancelled or timed out:1"],
      ],
      ["pr", 9, ["continue:PR opened:8", "loss:No PR:1"]],
      ["review", 8, ["continue:Merged:6", "pending:In review:1", "loss:Closed:1"]],
      ["main", 6, ["continue:Into main:5", "loss:Off main:1"]],
      ["index", 5, ["continue:Indexed:3", "pending:Awaiting the index:1", "loss:Missing from the index:1"]],
      ["tests", 3, ["continue:Tests pass:1", "pending:No result yet:1", "loss:Tests fail:1"]],
    ]);
    expect(flow[1].segments[2].ids.sort()).toEqual(["v1", "v2"]);
  });

  it("shows an empty gate when no run reached it", () => {
    const flow = dispatchFlow(runRows([pipelineAttempt({ run_conclusion: "cancelled", cancel_stage: "approval" })]));
    expect(flow.map((gate) => gate.input)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(flow[1].segments).toEqual([]);
  });
});

describe("stepTimes", () => {
  const MIN = 60_000;
  const at = (minutes: number) => new Date(Date.parse("2026-09-20T10:00:00Z") + minutes * MIN).toISOString();

  it("times the approval wait, the run by outcome, and review by where the PR went", () => {
    const run = (id: string, wait: number, length: number, conclusion: string) =>
      pipelineAttempt({ id, encode_started_at: at(wait), finished_at: at(wait + length), run_conclusion: conclusion });
    const rows = runRows([
      run("e1", 1, 10, "success"),
      run("e2", 3, 20, "success"),
      run("f1", 2, 5, "failure"),
      run("f2", 2, 15, "failure"),
      run("f3", 30, 60, "failure"),
      // A cancelled run, and a run from before job starts were recorded, leave the run times alone.
      run("c", 0, 99, "cancelled"),
      pipelineAttempt({ id: "old", encode_started_at: null }),
      mergedAttempt({ id: "m", pr_created_at: at(0), pr_merged_at: at(30) }),
      pipelineAttempt({ id: "x", run_conclusion: "success", pr_state: "closed", pr_url: "u", pr_created_at: at(0), pr_closed_at: at(12) }),
      pipelineAttempt({ id: "o", run_conclusion: "success", pr_state: "draft", pr_url: "u", pr_created_at: at(0) }),
    ]);
    const times = stepTimes(rows, Date.parse(at(60 * 24 * 2)));
    expect(times.map((step) => step.key)).toEqual(["approval", "run", "pr", "review", "main", "index", "tests"]);
    const summary = Object.fromEntries(
      times.map((step) => [step.key, step.timings.map((t) => `${t.label}:${t.runs}:${t.medianMs / MIN}:${t.slowMs}`)])
    );
    expect(summary).toEqual({
      approval: [":6:2:null"],
      run: ["Encoded:2:15:null", "Failed:3:15:null"],
      pr: [],
      review: ["Merged:1:30:null", "Closed:1:12:null", "Open now:1:2880:null"],
      main: [],
      index: [],
      tests: [],
    });
    expect(times[0]).toMatchObject({ label: "Signing approval", span: "dispatch → job start", untimed: null });
    expect(times.map((step) => step.untimed)).toEqual([null, null, "No wait", null, "No wait", "Not timed yet", "Not timed yet"]);
  });

  it("gives the slowest tenth once ten runs are timed", () => {
    const rows = runRows(
      Array.from({ length: 10 }, (_, i) =>
        pipelineAttempt({ id: `r${i}`, dispatched_at: at(0), encode_started_at: at(i + 1) })
      )
    );
    const [wait] = stepTimes(rows, 0)[0].timings;
    expect(wait).toEqual({ label: "", runs: 10, medianMs: 5.5 * MIN, slowMs: 9 * MIN });
  });
});

describe("post-merge times", () => {
  it("times the first index sync and the first tests on main from the merge", () => {
    const rows = runRows([
      mergedAttempt({ id: "a", pr_merged_at: "2026-09-21T09:00:00Z", indexed_at: "2026-09-21T09:40:00Z", tests_first_at: "2026-09-21T09:12:00Z" }),
      mergedAttempt({ id: "b", pr_merged_at: "2026-09-21T09:00:00Z", indexed_at: "2026-09-21T15:00:00Z" }),
      mergedAttempt({ id: "off", pr_targets_default: false, indexed_at: "2026-09-29T00:00:00Z" }),
    ]);
    const times = stepTimes(rows, 0);
    const index = times.find((step) => step.key === "index")!;
    const tests = times.find((step) => step.key === "tests")!;
    expect(index).toMatchObject({ untimed: null, span: "merge → index sync" });
    expect(index.timings).toEqual([{ label: "", runs: 2, medianMs: 200 * 60_000, slowMs: null }]);
    expect(tests.timings).toEqual([{ label: "", runs: 1, medianMs: 12 * 60_000, slowMs: null }]);
  });
});

describe("encodeParts", () => {
  const run = (id: string, conclusion: string, setup: number | null, encode: number | null, publish: number | null, tries: number | null) =>
    pipelineAttempt({
      id,
      run_conclusion: conclusion,
      setup_seconds: setup,
      encode_seconds: encode,
      publish_seconds: publish,
      generation_attempts: tries,
    });

  it("times setup past it, the encode loop by outcome, and publishing for encoded runs", () => {
    const { parts } = encodeParts(
      runRows([
        run("e1", "success", 240, 360, 30, 1),
        run("e2", "success", 300, 600, 40, 3),
        run("f1", "failure", 260, 1200, null, 4),
        // Stopped in setup: it does not shorten setup.
        run("f2", "failure", 20, null, null, null),
        run("c", "cancelled", 100, 100, null, null),
      ])
    );
    const summary = parts.map((part) => [part.key, part.timings.map((t) => `${t.label}:${t.runs}:${t.medianMs / 1000}`)]);
    expect(summary).toEqual([
      ["setup", [":3:260"]],
      ["encode", ["Encoded:2:480", "Failed:1:1200"]],
      ["model", []],
      ["checks", []],
      ["publish", [":2:35"]],
    ]);
  });

  it("counts the tries each encoded and failed run used", () => {
    const { tries } = encodeParts(
      runRows([
        run("e1", "success", null, null, null, 1),
        run("e2", "success", null, null, null, 3),
        run("f1", "failure", null, null, null, 4),
        run("f2", "failure", null, null, null, 4),
        run("f3", "failure", null, null, null, null),
        run("c", "cancelled", null, null, null, 2),
      ])
    );
    expect(tries).toEqual({ tries: [1, 2, 3, 4], encoded: [1, 0, 1, 0], failed: [0, 0, 0, 2], recorded: 4, finished: 5 });
  });

  it("says when no part is timed", () => {
    const { parts, tries } = encodeParts([]);
    expect(parts.map((part) => part.untimed)).toEqual(Array(5).fill("Not timed yet"));
    expect(tries).toEqual({ tries: [], encoded: [], failed: [], recorded: 0, finished: 0 });
  });
});

describe("testsParts", () => {
  it("splits the first tests on main into the wait and the run, and counts how they ended", () => {
    const merge = (id: string, started: string | null, finished: string | null, status: "pass" | "fail" | null) =>
      mergedAttempt({
        id,
        pr_merged_at: "2026-09-21T09:00:00Z",
        tests_first_started_at: started,
        tests_first_at: finished,
        tests_first_status: status,
      });
    const { parts, first } = testsParts(
      runRows([
        merge("a", "2026-09-21T09:16:00Z", "2026-09-21T11:07:00Z", "pass"),
        merge("b", "2026-09-21T10:32:00Z", "2026-09-21T11:37:00Z", "fail"),
        merge("c", null, "2026-09-21T12:00:00Z", null),
        mergedAttempt({ id: "off", pr_targets_default: false, tests_first_started_at: "2026-09-21T09:01:00Z", tests_first_status: "pass" }),
      ])
    );
    expect(parts.map((part) => [part.key, part.timings.map((t) => `${t.runs}:${t.medianMs / 60_000}`)])).toEqual([
      ["wait", ["2:54"]],
      ["run", ["2:88"]],
    ]);
    expect(first).toEqual({ pass: 1, fail: 1 });
    expect(testsParts([]).parts.map((part) => part.untimed)).toEqual(["Not timed yet", "Not timed yet"]);
  });
});

describe("runTimeline", () => {
  const MIN = 60_000;
  const at = (minutes: number) => new Date(Date.parse("2026-09-14T19:00:00Z") + minutes * MIN).toISOString();

  it("lays a merged run's parts on one clock, then times review, the index, and the tests on main", () => {
    const row = runRow(
      mergedAttempt({
        dispatched_at: at(0),
        encode_started_at: at(2),
        setup_seconds: 180,
        encode_seconds: 720,
        publish_seconds: 15,
        generation_attempts: 3,
        pr_created_at: at(17),
        pr_merged_at: at(42),
        indexed_at: at(42 + 240),
        index_status: "indexed",
        synced_at: at(42 + 240),
        tests_first_started_at: at(58),
        tests_first_at: at(169),
        tests_first_status: "fail",
        tests_status: "pass",
        tests_run_url: "T",
      })
    );
    const timeline = runTimeline(row, Date.parse(at(600)));
    expect(timeline.title).toBe("Dispatch to draft PR");
    expect(timeline.bars.map((bar) => [bar.label, bar.startMs / 1000, bar.ms / 1000, bar.state])).toEqual([
      ["Wait for approval", 0, 120, "done"],
      ["Setup", 120, 180, "done"],
      ["Encode loop · 3 tries", 300, 720, "done"],
      ["Sign and open the PR", 1020, 15, "done"],
    ]);
    expect(timeline.totalMs).toBe(1035_000);
    expect(timeline.stopped).toBeNull();
    expect(timeline.after.map((step) => [step.label, step.ms === null ? null : shortDuration(step.ms), step.state, step.detail])).toEqual([
      ["Review", "25m", "done", "Merged into main"],
      ["Index", "4h", "done", "Indexed"],
      ["Tests on main", "2h 7m", "done", "wait 16m · run 1h 51m · first result fail · latest pass"],
    ]);
  });

  it("marks where a run stopped, and falls back to one bar before its parts are recorded", () => {
    const failed = runTimeline(
      runRow(
        pipelineAttempt({
          dispatched_at: at(0),
          encode_started_at: at(1),
          setup_seconds: 200,
          encode_seconds: 1200,
          generation_attempts: 4,
          encoder_error_rule: "complete-source-unit:tests",
          encoder_error: "x [complete-source-unit:tests] y",
          failure_source: "diagnostics",
        })
      ),
      0
    );
    expect(failed.title).toBe("Dispatch to failure");
    expect(failed.bars.map((bar) => `${bar.label}:${bar.state}`)).toEqual([
      "Wait for approval:done",
      "Setup:done",
      "Encode loop · 4 tries:failed",
    ]);
    expect(failed.stopped).toBe("Failed validation: Completeness rule: tests");
    expect(failed.after).toEqual([]);
    // Before step times were recorded: the run as one bar.
    const early = runTimeline(runRow(pipelineAttempt({ dispatched_at: at(0), encode_started_at: at(1), finished_at: at(31), run_conclusion: "cancelled", cancel_stage: "running" })), 0);
    expect(early.bars.map((bar) => `${bar.label}:${bar.ms / MIN}:${bar.state}`)).toEqual(["Wait for approval:1:done", "Encode run:30:cancelled"]);
    expect(early.stopped).toBe("Cancelled mid-run");
    // Details a caller knows better replace the row's own.
    expect(runTimeline(runRow(pipelineAttempt({})), 0, { stopped: "Setup: checkout failed" }).stopped).toBe("Setup: checkout failed");
  });

  it("times a run still waiting or running up to now, and a PR still in review", () => {
    const waiting = runTimeline(runRow(pipelineAttempt({ dispatched_at: at(0), run_status: "waiting", run_conclusion: null })), Date.parse(at(45)));
    expect(waiting.bars.map((bar) => `${bar.label}:${bar.ms / MIN}:${bar.state}`)).toEqual(["Waiting for approval:45:running"]);
    expect(waiting.title).toBe("So far");
    const review = runTimeline(
      runRow(pipelineAttempt({ run_conclusion: "success", pr_state: "draft", pr_url: "u", pr_created_at: at(0), pr_check_error: "shard us fails" })),
      Date.parse(at(60 * 24 * 3))
    );
    expect(review.after).toEqual([
      { key: "review", label: "Review", ms: 3 * 24 * 60 * MIN, state: "waiting", detail: "In review so far · shard us fails", href: "u" },
    ]);
  });
});

describe("encode loop tries", () => {
  const tries = [
    { attempt: 1, model: "gpt-6-luna", ms: 37_000, cost: 0.0075, ok: false, error: "statutes/42/416/l.yaml: ci: [complete-source-unit:structure] Source branch (A) is neither encoded nor precisely deferred." },
    { attempt: 2, model: "gpt-6-sol", ms: 20_000, cost: 0.14, ok: true, error: null },
  ];

  it("shows each try in a run's timeline, with the model's time against the loop's", () => {
    const row = runRow(pipelineAttempt({ run_conclusion: "success", encode_started_at: "2026-09-20T10:01:00Z", setup_seconds: 180, encode_seconds: 600, tries }));
    expect(row.tries).toEqual(tries);
    const timeline = runTimeline(row, 0);
    expect(timeline.tries.map((t) => [t.attempt, t.model, t.ms, t.ok, t.headline])).toEqual([
      [1, "gpt-6-luna", 37_000, false, "Completeness rule: structure"],
      [2, "gpt-6-sol", 20_000, true, null],
    ]);
    expect([timeline.modelMs, timeline.loopMs]).toEqual([57_000, 600_000]);
    expect(runTimeline(runRow(pipelineAttempt({})), 0)).toMatchObject({ tries: [], modelMs: null });
  });

  it("times the model across a run's tries in the encode run's parts", () => {
    const { parts } = encodeParts(
      runRows([
        pipelineAttempt({ id: "e", run_conclusion: "success", tries }),
        pipelineAttempt({ id: "f", run_conclusion: "failure", tries: [{ ...tries[0], ms: 120_000 }] }),
        pipelineAttempt({ id: "n", run_conclusion: "failure" }),
      ])
    );
    const model = parts.find((part) => part.key === "model")!;
    expect(model.timings.map((t) => `${t.label}:${t.runs}:${t.medianMs / 1000}`)).toEqual(["Encoded:1:57", "Failed:1:120"]);
  });
});

describe("timed tries", () => {
  // Dispatched 10:00:00, approved 10:01:00, setup 2m: the encode step's bar runs from 3m to 13m.
  const tries = [
    {
      attempt: 1,
      model: "gpt-6-luna",
      ms: 40_000,
      cost: 0.01,
      ok: false,
      error: "statutes/7/2012/j.yaml: ci: Test input assignment missing: x",
      startedAt: "2026-09-20T10:03:20Z",
      wallMs: 160_000,
      phases: [
        { name: "prepare", ms: 5_000 },
        { name: "model_call", ms: 40_000 },
        { name: "candidate_validation", ms: 100_000, tools: { ci_test_cases: 70_000, rules_engine_compile: 20_000, other: 10_000 } },
        { name: "retry_handoff", ms: 15_000 },
      ],
    },
    {
      attempt: 2,
      model: "gpt-6-sol",
      ms: 45_000,
      cost: 0.2,
      ok: true,
      error: null,
      startedAt: "2026-09-20T10:06:10Z",
      wallMs: 300_000,
      phases: [
        { name: "prepare", ms: 5_000 },
        { name: "model_call", ms: 45_000 },
        { name: "overlay_validation", ms: 250_000, tools: { ci_test_cases: 200_000, other: 50_000 } },
      ],
    },
  ];
  const loop = { startedAt: "2026-09-20T10:03:00Z", wallMs: 500_000, setupMs: 20_000, triesMs: 460_000, betweenMs: 10_000, finalizeMs: 10_000 };
  const attempt = (overrides = {}) =>
    pipelineAttempt({
      run_conclusion: "success",
      encode_started_at: "2026-09-20T10:01:00Z",
      setup_seconds: 120,
      encode_seconds: 600,
      tries,
      encode_loop: loop,
      ...overrides,
    });

  it("places each try's phases on the run's clock, inside the encode step", () => {
    const timeline = runTimeline(runRow(attempt()), 0);
    expect(timeline.tries[0].phases.map((p) => [p.name, p.kind, p.part, p.startMs / 1000, p.ms / 1000])).toEqual([
      ["prepare", "other", null, 200, 5],
      ["model_call", "model", null, 205, 40],
      ["candidate_validation", "checks", "candidate", 245, 100],
      ["retry_handoff", "other", null, 345, 15],
    ]);
    expect(timeline.tries.map((t) => t.wallMs)).toEqual([160_000, 300_000]);
    expect(timeline.tries[0].phases[2].tools.map((t) => t.label)).toEqual(["test cases", "compile", "other"]);
    // A try that the runner's clock puts before the step starts at the step's bar.
    const early = runTimeline(runRow(attempt({ tries: [{ ...tries[0], startedAt: "2026-09-20T10:02:00Z" }] })), 0);
    expect(early.tries[0].phases[0].startMs).toBe(180_000);
  });

  it("splits the loop's time by kind, the checks by part and tool, and the time outside the tries", () => {
    const { split } = runTimeline(runRow(attempt()), 0);
    expect(split!.kinds.map((k) => [k.kind, k.ms / 1000])).toEqual([
      ["model", 85],
      ["checks", 350],
      ["other", 25],
    ]);
    const checks = split!.kinds[1];
    expect(checks.parts.map((p) => [p.label, p.ms / 1000])).toEqual([
      ["the candidate", 100],
      ["dependent modules", 250],
    ]);
    expect(checks.tools.map((t) => [t.label, t.ms / 1000])).toEqual([
      ["test cases", 270],
      ["compile", 20],
      ["other", 60],
    ]);
    expect(split!.outsideMs).toBe(140_000);
    expect(split!.outside.map((o) => `${o.label} ${o.ms / 1000}`)).toEqual([
      "before the first try 20",
      "between tries 10",
      "after the last try 10",
      "other work in the step 100",
    ]);
    // Without the loop's clock the time outside the tries stays one figure.
    expect(runTimeline(runRow(attempt({ encode_loop: null })), 0).split).toMatchObject({ outsideMs: 140_000, outside: [] });
  });

  it("leaves runs without timed tries as before", () => {
    const untimed = tries.map(({ startedAt: _s, wallMs: _w, phases: _p, ...rest }) => rest);
    const timeline = runTimeline(runRow(attempt({ tries: untimed, encode_loop: null })), 0);
    expect(timeline.split).toBeNull();
    expect(timeline.tries.map((t) => [t.wallMs, t.phases.length])).toEqual([
      [null, 0],
      [null, 0],
    ]);
  });

  it("times the checks across a run's tries in the encode run's parts", () => {
    const { parts } = encodeParts(runRows([attempt(), pipelineAttempt({ id: "old", run_conclusion: "success" })]));
    const checks = parts.find((part) => part.key === "checks")!;
    expect(checks.timings.map((t) => `${t.label}:${t.runs}:${t.medianMs / 1000}`)).toEqual(["Encoded:1:350"]);
  });
});
