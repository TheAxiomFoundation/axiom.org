import { describe, expect, it } from "vitest";
import {
  checkErrorLabel,
  errorGroupLabel,
  ageLabel,
  approvalSummary,
  attemptSource,
  attemptStage,
  attemptTime,
  dependentHostId,
  hostCitations,
  isDispatch,
  outsideAttemptId,
  outsideIdParts,
  cancellationDetail,
  durationLabel,
  checkJurisdiction,
  citationIsStuck,
  encodeGate,
  oracleLabel,
  reviewDetail,
  reviewHold,
  bottleneckStage,
  citationJourney,
  citationStates,
  failureReason,
  isExitStage,
  isStuck,
  journeyHref,
  journeySteps,
  pipelineView,
  stageSince,
  STAGE_COPY,
  statusAttempt,
  summarizePipeline,
  ENCODE_GATE_LABELS,
  VIEW_ITEMS_PER_STAGE,
  weeklyThroughput,
  weekStartUtc,
  type PipelineStage,
} from "./encoding-pipeline";
import { dependentAttempt, mergedAttempt, outsideAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");

describe("attemptStage", () => {
  const cases: Array<[PipelineStage, Parameters<typeof pipelineAttempt>[0]]> = [
    ["encoding", { run_status: "in_progress", run_conclusion: null, finished_at: null }],
    ["encode_failed", {}],
    ["no_pr", { run_conclusion: "success" }],
    ["review", { pr_state: "draft" }],
    ["review", { pr_state: "open" }],
    ["closed", { pr_state: "closed", pr_closed_at: "2026-09-22T00:00:00Z" }],
  ];
  it.each(cases)("places a run as %s", (stage, overrides) => {
    expect(attemptStage(pipelineAttempt(overrides))).toBe(stage);
  });

  it("follows a merge through the index, validation on main, and the engine sweep", () => {
    expect(attemptStage(mergedAttempt({ pr_targets_default: false }))).toBe("merged_off_main");
    expect(attemptStage(mergedAttempt({ index_status: "missing" }))).toBe("not_indexed");
    expect(attemptStage(mergedAttempt())).toBe("awaiting_sync");
    const synced = { synced_at: "2026-09-21T12:17:00Z", index_status: "indexed" as const };
    expect(attemptStage(mergedAttempt(synced))).toBe("indexed");
    expect(attemptStage(mergedAttempt({ ...synced, compile_status: "skipped" }))).toBe("indexed");
    expect(attemptStage(mergedAttempt({ ...synced, compile_status: "ok" }))).toBe("runs");
    // Validation on main is enough without the sweep; the sweep only adds failures.
    expect(attemptStage(mergedAttempt({ ...synced, tests_status: "pass" }))).toBe("verified");
    expect(attemptStage(mergedAttempt({ ...synced, compile_status: "exec_error", tests_status: "pass" }))).toBe(
      "compile_failed"
    );
  });
});

describe("stageSince", () => {
  it("reads the timestamp that opened the stage", () => {
    const running = pipelineAttempt({ run_status: "in_progress", finished_at: null });
    expect(stageSince(running)).toBe(running.started_at);
    expect(stageSince({ ...running, started_at: null })).toBe(running.dispatched_at);
    expect(stageSince(pipelineAttempt())).toBe("2026-09-20T10:30:00Z");
    expect(stageSince(pipelineAttempt({ finished_at: null }), "encode_failed")).toBe(
      "2026-09-20T10:00:00Z"
    );
    expect(stageSince(pipelineAttempt({ pr_state: "open", pr_created_at: "A" }))).toBe("A");
    expect(stageSince(pipelineAttempt({ pr_state: "closed", pr_closed_at: "B" }))).toBe("B");
    expect(stageSince(mergedAttempt())).toBe("2026-09-21T09:00:00Z");
    expect(stageSince(mergedAttempt({ synced_at: "C" }))).toBe("C");
    const failed = mergedAttempt({ synced_at: "C", compile_status: "compile_error" });
    expect(stageSince(failed)).toBe("C");
    expect(stageSince({ ...failed, compile_checked_at: "D" })).toBe("D");
  });
});

describe("isStuck", () => {
  it("counts exits as stuck, finished-without-PR as not, and waiting stages by age", () => {
    expect(isStuck("encode_failed", null, NOW)).toBe(true);
    expect(isStuck("no_pr", null, NOW)).toBe(false);
    expect(isStuck("verified", "2026-01-01T00:00:00Z", NOW)).toBe(false);
    expect(isStuck("runs", "2026-09-28T00:00:00Z", NOW)).toBe(true);
    expect(isStuck("review", null, NOW)).toBe(false);
    expect(isStuck("review", "2026-09-28T12:00:00Z", NOW)).toBe(false);
    expect(isStuck("review", "2026-09-26T12:00:00Z", NOW)).toBe(true);
    expect(isStuck("awaiting_sync", "2026-09-30T02:00:00Z", NOW)).toBe(true);
    expect(isExitStage("closed")).toBe(true);
    expect(isExitStage("review")).toBe(false);
  });
});

describe("citationStates", () => {
  it("keys each citation by its latest dispatch and counts open PRs", () => {
    const states = citationStates([
      mergedAttempt({ id: "1", dispatched_at: "2026-09-01T00:00:00Z", synced_at: "X" }),
      pipelineAttempt({ id: "2", dispatched_at: "2026-09-10T00:00:00Z", pr_state: "draft" }),
      pipelineAttempt({ id: "3", dispatched_at: "2026-09-12T00:00:00Z", pr_state: "open" }),
      pipelineAttempt({ id: "4", citation: "us/statute/26/32" }),
    ]);
    const snap = states.find((s) => s.citation === "us/statute/7/2017/a")!;
    expect(snap.latest.id).toBe("3");
    expect(snap.stage).toBe("review");
    expect(snap.dispatches).toBe(3);
    expect(snap.openPrs).toBe(2);
    expect(snap.reachedIndex).toBe(true);
    expect(states.find((s) => s.citation === "us/statute/26/32")!.reachedIndex).toBe(false);
  });

  it("reads the status past dispatches cancelled before their encode job, while an earlier one exists", () => {
    const merged = mergedAttempt({ id: "merged", dispatched_at: "2026-09-01T00:00:00Z" });
    const atApproval = pipelineAttempt({ id: "approval", dispatched_at: "2026-09-02T00:00:00Z", run_conclusion: "cancelled", cancel_stage: "approval" });
    const beforeJob = pipelineAttempt({ id: "job", dispatched_at: "2026-09-03T00:00:00Z", run_conclusion: "cancelled", cancel_stage: "before_job" });
    const [state] = citationStates([merged, atApproval, beforeJob]);
    expect([state.latest.id, state.stage, state.dispatches]).toEqual(["merged", "awaiting_sync", 3]);
    expect(statusAttempt([merged, atApproval, beforeJob])?.id).toBe("merged");
    // A run cancelled mid-run tried the citation: it stands.
    const midRun = pipelineAttempt({ id: "mid", dispatched_at: "2026-09-04T00:00:00Z", run_conclusion: "cancelled", cancel_stage: "running" });
    expect(statusAttempt([merged, midRun])?.id).toBe("mid");
    // With nothing before it, the cancelled dispatch is the status.
    expect(citationStates([atApproval])[0].latest.id).toBe("approval");
    expect(statusAttempt([])).toBeNull();
  });
});

describe("failureReason", () => {
  it("prefers the validator rule, then the encoder status, then the failed step", () => {
    expect(failureReason(pipelineAttempt({ encoder_error_rule: "complete-source-unit:tests" })))
      .toEqual({ key: "rule:complete-source-unit:tests", label: "complete-source-unit:tests", kind: "validator" });
    expect(failureReason(pipelineAttempt({ encoder_status: "apply_blocked_manifest" })).label)
      .toBe("Blocked by the signed manifest");
    expect(failureReason(pipelineAttempt({ encoder_status: "mystery", failed_step: "encode_apply" })).label)
      .toBe("Failed at: Encode, review, validate, and apply");
    expect(failureReason(pipelineAttempt({ failed_step: "Build / Provision signer" })).label)
      .toBe("Failed at: Provision signer");
    // The same step by diagnostics id and by job/step name groups once.
    expect(failureReason(pipelineAttempt({ failed_step: "encode_apply" })).key).toBe(
      failureReason(pipelineAttempt({ failed_step: "Queue re-encode / Encode, review, validate, and apply" })).key
    );
    expect(failureReason(pipelineAttempt({ failed_step: "stage_signed_bundle" })).label)
      .toBe("Failed at: Stage signed bundle");
    expect(failureReason(pipelineAttempt({ run_conclusion: "cancelled" }))).toMatchObject({
      key: "run:cancelled",
      label: "Cancelled (not read yet)",
    });
    expect(failureReason(pipelineAttempt({ run_conclusion: "cancelled", cancel_stage: "approval", encoder_error_rule: "x" })))
      .toMatchObject({ key: "cancel:approval", label: "Cancelled while waiting for signing approval" });
    expect(failureReason(pipelineAttempt({ run_conclusion: "cancelled", cancel_stage: "running" })).label).toBe("Cancelled mid-run");
    expect(failureReason(pipelineAttempt({ run_conclusion: "cancelled", cancel_stage: "before_job" })).label)
      .toBe("Cancelled before the encode job started");
    expect(failureReason(pipelineAttempt({ run_conclusion: "timed_out" })).key).toBe("run:timed_out");
    expect(failureReason(pipelineAttempt()).key).toBe("run:pending");
    expect(failureReason(pipelineAttempt({ failure_source: "jobs" })).key).toBe("run:unknown");
  });
});

describe("summarizePipeline", () => {
  const attempts = [
    pipelineAttempt({ id: "a", citation: "c/1", encoder_error_rule: "rule-a" }),
    pipelineAttempt({ id: "b", citation: "c/2", encoder_error_rule: "rule-a", finished_at: "2026-09-25T00:00:00Z" }),
    pipelineAttempt({ id: "c", citation: "c/3", failed_step: "encode_apply" }),
    pipelineAttempt({ id: "d", citation: "c/4", pr_state: "open", pr_created_at: "2026-09-01T00:00:00Z" }),
    pipelineAttempt({ id: "e", citation: "c/4", pr_state: "draft", pr_created_at: "2026-08-01T00:00:00Z", dispatched_at: "2026-08-01T00:00:00Z" }),
    pipelineAttempt({ id: "f", citation: "c/5", pr_state: "open", pr_created_at: "2026-09-29T00:00:00Z" }),
    pipelineAttempt({ id: "g", citation: "c/6", run_status: "in_progress", finished_at: null, run_conclusion: null, dispatched_at: "2026-09-29T00:00:00Z", collected_at: "2026-09-30T11:00:00Z" }),
  ];
  const summary = summarizePipeline(attempts, NOW);

  it("counts citations per stage with stuck totals and the oldest entry", () => {
    expect(summary.citationCount).toBe(6);
    expect(summary.dispatchCount).toBe(7);
    expect(summary.stages.encode_failed.count).toBe(3);
    expect(summary.stages.review).toMatchObject({ count: 2, stuck: 1, oldestSince: "2026-09-01T00:00:00Z" });
    expect(summary.stages.review.citations.map((c) => c.citation)).toEqual(["c/4", "c/5"]);
    expect(summary.duplicatePrs).toBe(1);
    expect(summary.collectedAt).toBe("2026-09-30T12:00:00Z");
    expect(summary.firstDispatchAt).toBe("2026-08-01T00:00:00Z");
  });

  it("groups failures, largest first, newest citation first", () => {
    expect(summary.failures.map((g) => [g.key, g.count])).toEqual([
      ["rule:rule-a", 2],
      ["step:Encode, review, validate, and apply", 1],
    ]);
    expect(summary.failures[0].citations[0].citation).toBe("c/2");
    expect(summary.failures[0].latestAt).toBe("2026-09-25T00:00:00Z");
    // Exits list the newest first.
    expect(summary.stages.encode_failed.citations[0].citation).toBe("c/2");
  });

  it("reports the recent failure rate over finished runs", () => {
    expect(summarizePipeline(attempts, Date.parse("2026-10-01T00:00:00Z")).recentFailureRate)
      .toEqual({ failed: 6, finished: 6, leftOut: 0 });
    expect(summarizePipeline([pipelineAttempt({ run_conclusion: "skipped" })], NOW).recentFailureRate)
      .toBeNull();
    expect(summarizePipeline([pipelineAttempt()], Date.parse("2027-01-01T00:00:00Z")).recentFailureRate)
      .toBeNull();
  });

  it("leaves cancelled runs and budget stops out of the failure rate", () => {
    const runs = [
      pipelineAttempt({ id: "ok", run_conclusion: "success" }),
      pipelineAttempt({ id: "fail", failed_step: "encode_apply" }),
      pipelineAttempt({ id: "timeout", run_conclusion: "timed_out" }),
      pipelineAttempt({ id: "cancel", run_conclusion: "cancelled" }),
      pipelineAttempt({ id: "budget", failed_step: "Check the citation attempt budget" }),
    ];
    expect(summarizePipeline(runs, Date.parse("2026-09-21T00:00:00Z")).recentFailureRate).toEqual({
      failed: 2,
      finished: 3,
      leftOut: 2,
    });
  });

  it("summarizes an empty pipeline", () => {
    const empty = summarizePipeline([], NOW);
    expect(empty.collectedAt).toBeNull();
    expect(empty.failures).toEqual([]);
  });
});

describe("weeklyThroughput", () => {
  it("buckets dispatches, successful encodes, and default-branch merges by UTC week", () => {
    expect(new Date(weekStartUtc(Date.parse("2026-09-30T12:00:00Z"))).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z"
    );
    const weeks = weeklyThroughput(
      [
        mergedAttempt({ dispatched_at: "2026-09-29T00:00:00Z", finished_at: "2026-09-29T01:00:00Z", pr_merged_at: "2026-09-30T00:00:00Z" }),
        mergedAttempt({ dispatched_at: "2026-09-22T00:00:00Z", finished_at: null, pr_targets_default: false, pr_merged_at: "2026-09-23T00:00:00Z" }),
        pipelineAttempt({ dispatched_at: "2025-01-01T00:00:00Z" }),
      ],
      NOW,
      2
    );
    expect(weeks).toEqual([
      { weekStart: "2026-09-21T00:00:00.000Z", dispatched: 1, encoded: 0, merged: 0, outside: 0 },
      { weekStart: "2026-09-28T00:00:00.000Z", dispatched: 1, encoded: 1, merged: 1, outside: 0 },
    ]);
  });
});

describe("journeySteps", () => {
  const states = (a: Parameters<typeof journeySteps>[0]) =>
    journeySteps(a).map((step) => step.state);

  it("stops a failed encode at the encode step with its reason", () => {
    const steps = journeySteps(pipelineAttempt({ encoder_error_rule: "rule-a", encoder_error: "detail" }));
    expect(steps.map((s) => s.state)).toEqual(["done", "failed", "pending", "pending", "pending", "pending", "pending", "pending"]);
    expect(steps[1].detail).toBe("Failed validation: rule-a — detail");
    expect(steps[0].detail).toBe("Ad hoc dispatch");
  });

  it("says a failure once: the message, without the group made from it", () => {
    const detail = (overrides: Parameters<typeof pipelineAttempt>[0]) => journeySteps(pipelineAttempt(overrides))[1].detail;
    expect(detail({ encoder_status: "apply_blocked_generation", encoder_error: "HTTP 404", failure_source: "log" })).toBe("Failed to generate: HTTP 404");
    expect(
      detail({
        failed_step: "Enforce failed-attempt budget / Enforce failed-attempt budget",
        encoder_error: "attempt-budget: citation=us/x streak=3 budget=3",
        failure_source: "log",
      })
    ).toBe("Attempt budget used up: attempt-budget: citation=us/x streak=3 budget=3");
    expect(detail({ failed_step: "package_exact_generated_changes", encoder_error: "ValueError: no manifest", failure_source: "log" })).toBe(
      "Failed to sign: ValueError: no manifest"
    );
    // A rule the message names already is not repeated in front of it.
    expect(
      detail({ encoder_error_rule: "complete-source-unit:tests", encoder_error: "a.yaml: ci: [complete-source-unit:tests] untested", failure_source: "diagnostics" })
    ).toBe("Failed validation: [complete-source-unit:tests] untested");
    // Without a message: the group, and how far a cancelled run got.
    expect(detail({ run_conclusion: "cancelled", cancel_stage: "approval", finished_at: "2026-09-20T13:00:00Z" })).toBe(
      "Cancelled or timed out: Cancelled while waiting for signing approval — Waited 3h for signing approval"
    );
  });

  it("shows a run in progress and a queued dispatch", () => {
    const running = pipelineAttempt({ run_status: "in_progress", run_conclusion: null, queue_ref: "snap:or-0001:abc" });
    expect(states(running).slice(0, 2)).toEqual(["done", "active"]);
    expect(journeySteps(running)[0].detail).toBe("Queue snap:or-0001:abc");
  });

  it("describes a success without a PR and a draft PR", () => {
    expect(journeySteps(pipelineAttempt({ run_conclusion: "success" }))[1].detail).toBe(
      "Finished without opening a PR"
    );
    const draft = journeySteps(
      pipelineAttempt({ run_conclusion: "success", generation_attempts: 1, pr_state: "draft", pr_checks: "failure", pr_review: "changes_requested" })
    );
    expect(draft[1].detail).toBe("1 generation attempt");
    expect(draft[2]).toMatchObject({ state: "active", detail: "Changes requested" });
    const open = journeySteps(pipelineAttempt({ generation_attempts: 3, pr_state: "open", pr_checks: "none", pr_review: "none" }));
    expect(open[1].detail).toBe("3 generation attempts");
    expect(open[2].detail).toBe("Awaiting review — no reviewer requested");
    expect(journeySteps(pipelineAttempt({ pr_state: "closed" }))[2].state).toBe("failed");
  });

  it("follows a merge to the finish line, or to where it stopped", () => {
    expect(states(mergedAttempt({ pr_targets_default: false, pr_base_branch: "codex/x" }))).toEqual(
      ["done", "done", "done", "failed", "pending", "pending", "pending", "pending"]
    );
    expect(journeySteps(mergedAttempt({ pr_targets_default: false, pr_base_branch: "codex/x" }))[3].detail)
      .toBe("Into codex/x, not the default branch");
    expect(journeySteps(mergedAttempt())[3].detail).toBe("Into main");
    expect(states(mergedAttempt()).slice(4)).toEqual(["active", "pending", "pending", "pending"]);
    const missing = journeySteps(mergedAttempt({ index_status: "missing" }));
    expect(missing[4]).toMatchObject({ state: "failed", detail: "A sync ran after the merge without these modules" });
    const indexed = { synced_at: "2026-09-21T12:00:00Z", index_status: "indexed" as const };
    expect(journeySteps(mergedAttempt(indexed))[4].detail).toBe("1 module");
    expect(journeySteps(mergedAttempt({ ...indexed, module_paths: ["a.yaml", "b.yaml"] }))[4].detail).toBe("2 modules");
    expect(states(mergedAttempt(indexed)).slice(4)).toEqual(["done", "pending", "active", "pending"]);
    expect(journeySteps(mergedAttempt(indexed))[5].detail).toBe("Not checked by the axiom-api engine sweep yet");
    expect(states(mergedAttempt({ ...indexed, tests_status: "pass" })).slice(5, 7)).toEqual(["pending", "done"]);
    expect(states(mergedAttempt({ ...indexed, compile_status: "ok" }))[5]).toBe("done");
    const failed = journeySteps(mergedAttempt({ ...indexed, compile_status: "compile_error", compile_error: "bad import" }));
    expect(failed[5]).toMatchObject({ state: "failed", detail: "bad import" });
    expect(journeySteps(mergedAttempt({ ...indexed, compile_status: "skipped" }))[5].detail).toBe(
      "Not checked (composition)"
    );
    expect(journeySteps(mergedAttempt({ ...indexed, compile_status: "skipped", module_paths: [] }))[5].detail).toBe(
      "No module changed"
    );
    expect(journeySteps(mergedAttempt({ pr_base_branch: null }))[3].detail).toBeNull();
  });
});

describe("pipelineView", () => {
  it("trims each stage to the view's item cap and marks the bottleneck", () => {
    const attempts = Array.from({ length: VIEW_ITEMS_PER_STAGE + 5 }, (_, i) =>
      pipelineAttempt({ id: String(i), citation: `c/${i}`, encoder_error_rule: "rule-a" })
    );
    attempts.push(
      mergedAttempt({ id: "m", citation: "c/m", synced_at: "S", compile_status: "compile_error", compile_error: "boom", compile_checked_at: "2026-09-30T07:00:00Z" }),
      mergedAttempt({ id: "o", citation: "c/o", pr_targets_default: false, pr_base_branch: "codex/x" }),
      mergedAttempt({ id: "n", citation: "c/n", index_status: "missing" }),
      pipelineAttempt({ id: "w", citation: "c/w", run_status: "waiting", run_conclusion: null }),
      pipelineAttempt({ id: "r", citation: "c/r", run_status: "in_progress", run_conclusion: null }),
      pipelineAttempt({ id: "p", citation: "c/p", pr_state: "open", pr_repo: "rulespec-us", pr_number: 9 })
    );
    const view = pipelineView(attempts, NOW);
    expect(view.stages.encode_failed.count).toBe(VIEW_ITEMS_PER_STAGE + 5);
    expect(view.stages.encode_failed.items).toHaveLength(VIEW_ITEMS_PER_STAGE);
    expect(view.failures[0].items).toHaveLength(30);
    expect(view.compileCheckedAt).toBe("2026-09-30T07:00:00Z");
    expect(bottleneckStage(view)).toBe("encode_failed");

    const item = (stage: PipelineStage) => view.stages[stage].items[0];
    expect(item("encode_failed")).toMatchObject({ reason: "rule-a", stuck: true });
    expect(item("compile_failed")).toMatchObject({ reason: "compile error", detail: "boom" });
    expect(item("merged_off_main").reason).toBe("Merged into codex/x");
    expect(item("not_indexed").reason).toBe("Not in the index after a later sync");
    expect(view.stages.encoding.items.map((i) => i.reason).sort()).toEqual([
      "Waiting for deployment approval",
      null,
    ].sort());
    expect(item("review")).toMatchObject({ prLabel: "rulespec-us#9", reason: "Awaiting review", detail: "no reviewer requested" });
    expect(pipelineView([mergedAttempt({ pr_base_branch: null, pr_targets_default: false })], NOW).stages.merged_off_main.items[0].reason).toBeNull();
    expect(pipelineView([mergedAttempt({ synced_at: "S", compile_status: null }), mergedAttempt({ id: "x", citation: "c/x", synced_at: "S", compile_status: "compile_error" })], NOW).stages.compile_failed.items[0].reason).toBe("compile error");
  });

  it("counts a module in the index as stuck only while validation could still confirm it", () => {
    const old = { synced_at: "2026-09-01T00:00:00Z", index_status: "indexed" as const };
    const view = pipelineView(
      [
        mergedAttempt({ id: "w", citation: "c/w", ...old, tests_status: "waived" }),
        mergedAttempt({ id: "u", citation: "c/u", ...old, compile_status: null }),
      ],
      NOW
    );
    expect(view.stages.indexed).toMatchObject({ count: 2, stuck: 1 });
  });

  it("has no bottleneck when nothing is stuck", () => {
    expect(bottleneckStage(pipelineView([pipelineAttempt({ run_conclusion: "success" })], NOW))).toBeNull();
  });
});

describe("citationJourney", () => {
  it("returns one citation's dispatches newest first", () => {
    const journey = citationJourney(
      [
        pipelineAttempt({ id: "old", dispatched_at: "2026-09-01T00:00:00Z" }),
        pipelineAttempt({ id: "new", dispatched_at: "2026-09-02T00:00:00Z" }),
        pipelineAttempt({ id: "other", citation: "us/statute/26/32" }),
      ],
      "us/statute/7/2017/a"
    );
    expect(journey.map((a) => a.id)).toEqual(["new", "old"]);
  });

  it("holds every spelling of the citation, as the ledger counts them", () => {
    const journey = citationJourney(
      [
        pipelineAttempt({ id: "colon", citation: "us-nc:manual/dhhs/fns/fns-170-notices/page-7", dispatched_at: "2026-09-01T00:00:00Z" }),
        pipelineAttempt({ id: "slash", citation: "us-nc/manual/dhhs/fns/fns-170-notices/page-7", dispatched_at: "2026-09-02T00:00:00Z" }),
        pipelineAttempt({ id: "cfr", citation: "us/regulations/7-cfr/273/4" }),
      ],
      "us-nc/manual/dhhs/fns/fns-170-notices/page-7"
    );
    expect(journey.map((a) => a.id)).toEqual(["slash", "colon"]);
    expect(citationJourney([pipelineAttempt({ id: "cfr", citation: "us/regulations/7-cfr/273/4" })], "us/regulation/7/273/4")).toHaveLength(1);
  });
});

describe("ageLabel and journeyHref", () => {
  it("formats compact ages", () => {
    expect(ageLabel(null, NOW)).toBeNull();
    expect(ageLabel("2026-09-30T12:00:00Z", NOW)).toBe("1m");
    expect(ageLabel("2026-09-30T11:15:00Z", NOW)).toBe("45m");
    expect(ageLabel("2026-09-29T12:00:00Z", NOW)).toBe("24h");
    expect(ageLabel("2026-09-25T12:00:00Z", NOW)).toBe("5d");
    expect(ageLabel("2026-08-10T12:00:00Z", NOW)).toBe("7w");
    // Whole units, rounded down, as "ago" times are.
    expect(ageLabel("2026-09-30T11:00:30Z", NOW)).toBe("59m");
    expect(ageLabel("2026-09-29T11:30:00Z", NOW)).toBe("24h");
    expect(ageLabel("2026-09-24T00:00:00Z", NOW)).toBe("6d");
  });

  it("links a citation to its journey", () => {
    expect(journeyHref("us/statute/7/2017/a")).toBe("/ops/journey?citation=us%2Fstatute%2F7%2F2017%2Fa");
  });
});

describe("encodeGate", () => {
  const gate = (overrides: Parameters<typeof pipelineAttempt>[0]) =>
    encodeGate(pipelineAttempt(overrides));

  it("reads the stopping step from the run, the encoder, and the failed step", () => {
    expect(gate({ run_conclusion: "cancelled" })).toBe("cancelled");
    expect(gate({ run_conclusion: "timed_out" })).toBe("cancelled");
    expect(gate({ encoder_error: "a.yaml: ci: [complete-source-unit:tests] x" })).toBe("validate");
    expect(gate({ encoder_error: "a.yaml: compile: Axiom rules engine compile failed" })).toBe("compile");
    expect(gate({ encoder_error: "a.yaml: review: rejected" })).toBe("review");
    expect(gate({ encoder_error: "a.yaml: mystery: x", encoder_status: "apply_blocked_generation" })).toBe("generate");
    expect(gate({ encoder_status: "apply_blocked_manifest" })).toBe("sign");
    expect(gate({ encoder_error_rule: "rule-a" })).toBe("validate");
    expect(gate({ encoder_status: "apply_blocked_validation" })).toBe("validate");
    expect(gate({ failed_step: "Enforce failed-attempt budget / Enforce failed-attempt budget" })).toBe("budget");
    expect(gate({ failed_step: "repair_candidate" })).toBe("setup");
    expect(gate({ failed_step: "Queue / Verify immutable checkout identities" })).toBe("setup");
    expect(gate({ failed_step: "package_exact_generated_changes" })).toBe("sign");
    expect(gate({ failed_step: "Queue / Push lane branch and open draft pull request" })).toBe("publish");
    expect(gate({ failed_step: "encode_apply" })).toBe("encode");
    // A step the list does not name lands by its place in the run: before the encode step is setup.
    expect(gate({ failed_step: "Queue / Fetch pinned corpus provision objects", failure_source: "log" })).toBe("setup");
    expect(gate({ failed_step: "retired_source_metadata_migration", failure_source: "log" })).toBe("setup");
    expect(gate({ failed_step: "finalize_signed_reencode_artifact", failure_source: "log" })).toBe("sign");
    expect(gate({ failed_step: "Queue / Validate dependent cascade", failure_source: "log" })).toBe("validate");
    expect(gate({ failure_source: "jobs" })).toBe("unknown");
    expect(gate({})).toBe("pending");
  });
});

describe("reviewHold", () => {
  const open = (overrides: Parameters<typeof pipelineAttempt>[0]) =>
    pipelineAttempt({ pr_state: "draft", pr_checks: "success", ...overrides });

  it("names what holds a PR, checks first", () => {
    expect(checkJurisdiction("validate / validate (us-az)")).toBe("us-az");
    expect(checkJurisdiction("build")).toBeNull();
    expect(reviewHold(open({ pr_review: "changes_requested", pr_checks: "failure" }))).toBe("changes_requested");
    expect(reviewHold(open({ pr_checks: "failure" }))).toBe("ci_failing");
    expect(reviewHold(open({ pr_checks: "failure", pr_failed_checks: [], pr_cancelled_checks: 3 }))).toBe("ci_cancelled");
    expect(reviewHold(open({ pr_checks: "failure", pr_failed_checks: [], pr_cancelled_checks: 0 }))).toBe("ci_failing");
    expect(reviewHold(open({ pr_checks: "failure", pr_failed_checks: ["validate / validate (us)"] }))).toBe("ci_failing_own");
    expect(reviewHold(open({ pr_checks: "failure", pr_failed_checks: ["validate / validate (us-ak)"] }))).toBe("ci_failing_other");
    expect(reviewHold(open({ pr_checks: "failure", pr_failed_checks: ["build", "validate / validate (us-ak)"] }))).toBe("ci_failing_own");
    expect(reviewHold(open({ pr_checks: "pending" }))).toBe("ci_pending");
    expect(reviewHold(open({ pr_review: "approved", pr_state: "open" }))).toBe("approved");
    expect(reviewHold(open({}))).toBe("draft");
    expect(reviewHold(open({ pr_state: "open" }))).toBe("awaiting_review");
  });

  it("details failing checks, cancellations, and reviewers", () => {
    expect(
      reviewDetail(
        open({
          pr_checks: "failure",
          pr_failed_checks: ["a", "b", "c", "d", "e"],
          pr_cancelled_checks: 1,
          pr_requested_reviewers: ["MaxGhenis", "team:core"],
        })
      )
    ).toBe("failing: a, b, c and 2 more · 1 check cancelled · waiting on MaxGhenis, team:core");
    expect(reviewDetail(open({ pr_checks: "failure", pr_failed_checks: ["a"], pr_cancelled_checks: 2 }))).toBe(
      "failing: a · 2 checks cancelled"
    );
    expect(reviewDetail(open({ pr_state: "open" }))).toBe("no reviewer requested");
    expect(reviewDetail(open({}))).toBeNull();
  });
});

describe("tests and oracle stages", () => {
  const indexed = { synced_at: "2026-09-21T12:00:00Z", index_status: "indexed" as const };

  it("places a merge by its tests on main and its oracle verdict", () => {
    const stage = (overrides: Parameters<typeof mergedAttempt>[0]) =>
      attemptStage(mergedAttempt({ ...indexed, ...overrides }));
    expect(stage({ compile_status: "ok", tests_status: "pass" })).toBe("verified");
    expect(stage({ compile_status: "ok", tests_status: "waived" })).toBe("runs");
    expect(stage({ compile_status: "ok", tests_status: "fail" })).toBe("tests_failing");
    expect(stage({ compile_status: "ok", tests_status: "pass", oracle_status: "disagree" })).toBe("oracle_disagrees");
    expect(stage({ compile_status: "ok", tests_status: "pass", oracle_status: "stale" })).toBe("verified");
    expect(stage({ compile_status: "skipped", tests_status: "pass" })).toBe("verified");
    expect(stage({ compile_status: "skipped" })).toBe("indexed");
    expect(stage({ compile_status: "compile_error", tests_status: "fail" })).toBe("compile_failed");
  });

  it("dates the stages from their checks", () => {
    const a = mergedAttempt({ ...indexed, compile_status: "ok", tests_status: "pass", tests_checked_at: "T" });
    expect(stageSince(a)).toBe("T");
    expect(stageSince({ ...a, tests_checked_at: null })).toBe(indexed.synced_at);
    const d = mergedAttempt({ ...indexed, compile_status: "ok", oracle_status: "disagree", oracle_checked_at: "O" });
    expect(stageSince(d)).toBe("O");
    expect(stageSince({ ...d, oracle_checked_at: null })).toBe(indexed.synced_at);
  });

  it("dates passing or failing tests from the first result that still holds, not the latest check", () => {
    const pass = mergedAttempt({ ...indexed, tests_status: "pass", tests_checked_at: "latest", tests_first_at: "first", tests_first_status: "pass" });
    expect(stageSince(pass)).toBe("first");
    // The first run failed: the pass is known only from the latest check.
    expect(stageSince({ ...pass, tests_first_status: "fail" })).toBe("latest");
    const fail = mergedAttempt({ ...indexed, tests_status: "fail", tests_checked_at: "latest", tests_first_at: "first", tests_first_status: "fail" });
    expect(stageSince(fail)).toBe("first");
    expect(stageSince({ ...fail, tests_first_status: "pass" })).toBe("latest");
  });

  it("never counts a waived module as stuck waiting for its tests", () => {
    const old = { ...indexed, synced_at: "2026-09-01T00:00:00Z", compile_status: "ok" };
    const [waived, waiting] = citationStates([
      mergedAttempt({ id: "w", citation: "c/w", ...old, tests_status: "waived" }),
      mergedAttempt({ id: "x", citation: "c/x", ...old }),
    ]);
    expect(citationIsStuck(waived, NOW)).toBe(false);
    expect(citationIsStuck(waiting, NOW)).toBe(true);
  });

  it("labels oracle verdicts by engine", () => {
    const label = (overrides: Parameters<typeof pipelineAttempt>[0]) => oracleLabel(pipelineAttempt(overrides));
    expect(label({})).toBeNull();
    expect(label({ oracle_status: "match", oracle_engine: "policyengine" })).toBe("Matches PolicyEngine");
    expect(label({ oracle_status: "explained", oracle_engine: "taxsim" })).toBe("Matches TAXSIM, differences explained");
    expect(label({ oracle_status: "match", oracle_engine: "euromod" })).toBe("Matches EUROMOD");
    expect(label({ oracle_status: "disagree", oracle_engine: "custom" })).toBe("Disagrees with custom");
    expect(label({ oracle_status: "stale", oracle_engine: null })).toBe("An oracle report predates this version");
  });

  it("shows tests and the oracle as journey steps", () => {
    const steps = (overrides: Parameters<typeof mergedAttempt>[0]) =>
      journeySteps(mergedAttempt({ ...indexed, compile_status: "ok", ...overrides })).slice(6);
    expect(steps({ tests_status: "pass", tests_run_url: "R" })[0]).toMatchObject({ state: "done", href: "R" });
    expect(steps({ tests_status: "fail" })[0].state).toBe("failed");
    expect(steps({ tests_status: "waived" })[0]).toMatchObject({
      state: "pending",
      detail: "Skipped: an active known-validation-gaps waiver",
    });
    expect(steps({})[0].state).toBe("active");
    expect(steps({ oracle_status: "match", oracle_engine: "policyengine", oracle_report: "axiom-policyengine-x.json" })[1]).toMatchObject({
      state: "done",
      detail: "Matches PolicyEngine — axiom-policyengine-x.json",
      href: "https://github.com/TheAxiomFoundation/axiom-oracles/blob/oracle-data/dashboard/public/data/axiom-policyengine-x.json",
    });
    expect(steps({ oracle_status: "disagree" })[1].state).toBe("failed");
    expect(steps({ oracle_status: "stale", oracle_checked_at: "O" })[1]).toMatchObject({ state: "pending", at: null });
    expect(steps({})[1].detail).toBe("No oracle report covers it");
    expect(journeySteps(pipelineAttempt())[7].detail).toBeNull();
  });

  it("groups failed encodes by step and review items by hold in the view", () => {
    const view = pipelineView(
      [
        pipelineAttempt({ id: "1", citation: "c/1", encoder_error: "a.yaml: ci: [r-a] x", encoder_error_rule: "r-a" }),
        pipelineAttempt({ id: "2", citation: "c/2", run_conclusion: "cancelled" }),
        pipelineAttempt({ id: "3", citation: "c/3", pr_state: "draft", pr_checks: "failure", pr_failed_checks: [], pr_cancelled_checks: 2 }),
        mergedAttempt({ id: "4", citation: "c/4", ...indexed, compile_status: "ok", tests_status: "pass", tests_run_url: "R", oracle_status: "match", oracle_engine: "policyengine" }),
        mergedAttempt({ id: "5", citation: "c/5", ...indexed, compile_status: "ok", tests_status: "waived" }),
        mergedAttempt({ id: "6", citation: "c/6", ...indexed, compile_status: "ok" }),
        mergedAttempt({ id: "7", citation: "c/7", ...indexed, compile_status: "ok", tests_status: "fail" }),
        mergedAttempt({ id: "8", citation: "c/8", ...indexed, compile_status: "ok", oracle_status: "disagree", oracle_engine: "taxsim" }),
        mergedAttempt({ id: "9", citation: "c/9", ...indexed, compile_status: "skipped", tests_status: "pass" }),
      ],
      NOW
    );
    expect(view.gates.map((g) => [g.label, g.count])).toEqual([
      ["Cancelled or timed out", 1],
      ["Failed validation", 1],
    ]);
    expect(view.holds).toMatchObject([{ key: "ci_cancelled", count: 1 }]);
    expect(view.stages.encode_failed.items.find((i) => i.citation === "c/1")?.gate).toBe("Failed validation");
    const verified = view.stages.verified.items.find((i) => i.citation === "c/4")!;
    expect(verified).toMatchObject({ oracle: "Matches PolicyEngine", reason: "Matches PolicyEngine", testsRunUrl: "R" });
    expect(view.stages.verified.items.find((i) => i.citation === "c/9")?.reason).toBe("No oracle report covers it");
    expect(view.stages.runs.items.map((i) => i.reason).sort()).toEqual([
      "Validation waived on main (known gap)",
      "Waiting for its jurisdiction's validation on main",
    ]);
    expect(view.stages.tests_failing.items[0].reason).toBe("Fails its jurisdiction's validation on main");
    expect(view.stages.oracle_disagrees.items[0].reason).toBe("Disagrees with TAXSIM");
  });
});

describe("signing approval and cancellations", () => {
  it("formats durations", () => {
    expect(durationLabel(-5)).toBe("0m");
    expect(durationLabel(45 * 60_000)).toBe("45m");
    expect(durationLabel(3 * 3_600_000)).toBe("3h");
    expect(durationLabel(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(durationLabel(96 * 3_600_000)).toBe("4d");
    // Rounded down, like the "ago" beside it: 26.9 days is 26d, as "26d ago" is.
    expect(durationLabel(26.9 * 24 * 3_600_000)).toBe("26d");
    expect(durationLabel(44.9 * 60_000)).toBe("44m");
  });

  it("names a compile failure apart from the nightly sweep's stage", () => {
    expect(ENCODE_GATE_LABELS.compile).toBe("Failed the compile check");
    expect(ENCODE_GATE_LABELS.compile).not.toBe(STAGE_COPY.compile_failed.label);
  });

  it("describes how long a cancelled run waited and who dispatched it", () => {
    const base = { run_conclusion: "cancelled", dispatched_at: "2026-09-30T00:00:00Z", finished_at: "2026-09-30T06:11:00Z" };
    expect(cancellationDetail(pipelineAttempt({ ...base, cancel_stage: "approval", dispatched_by: "github-actions[bot]" })))
      .toBe("Waited 6h 11m for signing approval · dispatched by github-actions[bot]");
    expect(cancellationDetail(pipelineAttempt({ ...base, cancel_stage: "running" }))).toBe("Ran 6h 11m");
    expect(cancellationDetail(pipelineAttempt({ ...base, finished_at: null }))).toBeNull();
    expect(cancellationDetail(pipelineAttempt())).toBeNull();
    const [item] = pipelineView([pipelineAttempt({ ...base, cancel_stage: "approval" })], NOW).stages.encode_failed.items;
    expect(item.detail).toBe("Waited 6h 11m for signing approval");
  });

  it("summarizes the approval gate over every dispatch", () => {
    const approved = (id: string, minutes: number) =>
      pipelineAttempt({ id, citation: `c/${id}`, run_conclusion: "success", dispatched_at: "2026-09-29T00:00:00Z", encode_started_at: new Date(Date.parse("2026-09-29T00:00:00Z") + minutes * 60_000).toISOString() });
    const summary = approvalSummary(
      [
        approved("a", 1),
        approved("b", 2),
        approved("c", 200),
        pipelineAttempt({ id: "old", dispatched_at: "2026-08-01T00:00:00Z", encode_started_at: "2026-08-01T05:00:00Z" }),
        pipelineAttempt({ id: "w", run_status: "waiting", run_conclusion: null, dispatched_at: "2026-09-28T04:00:00Z" }),
        pipelineAttempt({ id: "x", run_conclusion: "cancelled", cancel_stage: "approval", dispatched_at: "2026-09-20T00:00:00Z", finished_at: "2026-09-20T02:00:00Z" }),
        pipelineAttempt({ id: "y", run_conclusion: "cancelled", cancel_stage: "approval", dispatched_at: "2026-09-20T00:00:00Z", finished_at: "2026-09-20T00:10:00Z" }),
        pipelineAttempt({ id: "z", run_conclusion: "cancelled", cancel_stage: "running" }),
        pipelineAttempt({ id: "t", run_conclusion: "timed_out" }),
      ],
      NOW
    );
    expect(summary).toMatchObject({
      waitingNow: 1,
      oldestWaitingSince: "2026-09-28T04:00:00Z",
      approved: { count: 3, medianMs: 2 * 60_000, p90Ms: 200 * 60_000 },
      cancelledWhileWaiting: { count: 2, overAnHour: 1, medianMs: 2 * 3_600_000 },
    });
    expect(summary.cancellations.map((c) => [c.label, c.count])).toEqual([
      ["Cancelled while waiting for signing approval", 2],
      ["Cancelled mid-run", 1],
      ["Timed out", 1],
    ]);
    expect(approvalSummary([], NOW)).toMatchObject({ waitingNow: 0, oldestWaitingSince: null, approved: { medianMs: null, p90Ms: null } });
  });
});

describe("check errors", () => {
  it("label what a failing check printed without its paths or hashes", () => {
    expect(checkErrorLabel("- .axiom/x/y.json  manifest 0123456789ab   is stale")).toBe("- … manifest … is stale");
    const view = pipelineView(
      [
        pipelineAttempt({
          run_conclusion: "success",
          pr_state: "draft",
          pr_created_at: "2026-09-29T00:00:00Z",
          pr_checks: "failure",
          pr_failed_checks: ["validate / validate (dk)"],
          pr_check_error: "- dk/a.json does not match the running pinned encoder",
        }),
      ],
      Date.parse("2026-09-30T12:00:00Z")
    );
    expect(view.stages.review.items[0].detail).toBe(
      "- … does not match the running pinned encoder · failing: validate / validate (dk)"
    );
  });
});

describe("errors without a rule id", () => {
  it("group by what they say, without paths, names, quoted values, or numbers", () => {
    expect(
      errorGroupLabel(
        "axiom_encode.corpus_resolver.InvalidActiveCorpusSourceError: Active corpus source 'us-ok/statute/68-2355' is repealed"
      )
    ).toBe("InvalidActiveCorpusSourceError: Active corpus source … is repealed");
    expect(
      errorGroupLabel(
        "statutes/42/402/q.yaml: ci: Test case `auto_output_widow` output `benefit` expected decimal 12.3456789, got decimal 13."
      )
    ).toBe("Test case … output … expected decimal N, got decimal N.");
    const failed = (citation: string, error: string, extra: Partial<Parameters<typeof pipelineAttempt>[0]> = {}) =>
      pipelineAttempt({ citation, failure_source: "log", failed_step: "encode_apply", encoder_error: error, ...extra });
    const a = failed("us-nm/a", "ValueError: No local corpus source text found for 'us-nm/a'");
    const b = failed("us-ga/b", 'ValueError: No local corpus source text found for "us-ga/b"');
    expect(failureReason(a)).toEqual({
      key: "error:ValueError: No local corpus source text found for …",
      label: "ValueError: No local corpus source text found for …",
      kind: "encoder",
    });
    expect(failureReason(b).key).toBe(failureReason(a).key);
    // A bundle issue without a rule id groups by its text, ahead of the encoder's status.
    const issue = failed("us/c", "a.yaml: ci: Proof source evidence not found: rule `x` proof atom 2", {
      failure_source: "encoder_run",
      encoder_status: "apply_blocked_validation",
    });
    expect(failureReason(issue)).toEqual({
      key: "error:Proof source evidence not found: rule … proof atom N",
      label: "Proof source evidence not found: rule … proof atom N",
      kind: "validator",
    });
    // The step still says where it stopped.
    expect(encodeGate(a)).toBe(encodeGate(pipelineAttempt({ failure_source: "diagnostics", failed_step: "encode_apply" })));
    // A log that showed no error falls back to the step.
    expect(failureReason(pipelineAttempt({ failure_source: "log", failed_step: "encode_apply" })).kind).toBe("workflow");
  });
});

describe("attemptSource", () => {
  it("tells a dispatch, a merge outside the pipeline, and another citation's run apart by id", () => {
    expect(attemptSource({ id: "35909645917" })).toBe("dispatch");
    // A manifest PR whose run is gone stays a dispatch.
    expect(attemptSource({ id: "pr:rulespec-us#1500" })).toBe("dispatch");
    expect(attemptSource({ id: outsideAttemptId("rulespec-us", 900, "us/statutes/7/2017/a.yaml") })).toBe("outside");
    expect(attemptSource({ id: "dep:5e2a7c10" })).toBe("dependent");
    expect(isDispatch(pipelineAttempt())).toBe(true);
    expect(isDispatch(outsideAttempt())).toBe(false);
    expect(outsideIdParts(outsideAttempt().id)).toEqual({ repo: "rulespec-us", number: 900, path: "us/statutes/7/2017/a.yaml" });
    expect(outsideIdParts("pr:rulespec-us#1500")).toBeNull();
    expect(dependentHostId(dependentAttempt())).toBe("1001");
    expect(dependentHostId(pipelineAttempt({ queue_ref: "dependent:1001" }))).toBeNull();
  });

  it("orders a merge outside the pipeline by its merge", () => {
    expect(attemptTime(outsideAttempt())).toBe("2026-09-23T09:00:00Z");
    expect(attemptTime(dependentAttempt())).toBe("2026-09-20T10:20:00Z");
    expect(attemptTime(pipelineAttempt())).toBe("2026-09-20T10:00:00Z");
  });
});

describe("citation views with every source", () => {
  const citation = "us/statute/7/2017/a";
  // A failed dispatch, then a person's PR created before it but merged after it.
  const failed = pipelineAttempt({ id: "1001", citation, dispatched_at: "2026-09-22T12:00:00Z", finished_at: "2026-09-22T12:30:00Z" });
  const merged = outsideAttempt({ citation, synced_at: "2026-09-23T12:00:00Z", index_status: "indexed", tests_status: "pass" });

  it("takes a citation's stage from its latest attempt, a merge outside the pipeline included", () => {
    expect(statusAttempt([failed, merged])!.id).toBe(merged.id);
    const [state] = citationStates([failed, merged]);
    expect(state.stage).toBe("verified");
    // Only dispatches count as dispatches.
    expect(state.dispatches).toBe(1);
    expect(citationJourney([failed, merged], citation).map((a) => a.id)).toEqual([merged.id, failed.id]);
  });

  it("counts the citations it holds because of other sources, and runs dispatches only", () => {
    const view = pipelineView(
      [
        failed,
        merged,
        dependentAttempt({ citation: "us/statute/42/402/q" }),
        outsideAttempt({ id: outsideAttemptId("rulespec-us", 900, "us/statutes/7/2017/b.yaml"), citation: "us/statute/7/2017/b" }),
      ],
      NOW
    );
    expect(view.citationCount).toBe(3);
    expect(view.dispatchCount).toBe(1);
    expect(view.firstDispatchAt).toBe("2026-09-22T12:00:00Z");
    expect(view.sources).toEqual({ outside: 2, dependent: 1 });
    expect(view.stages.verified.count).toBe(1);
    expect(view.stages.encode_failed.count).toBe(1);
    expect(view.stages.encode_failed.items[0]).toMatchObject({ citation: "us/statute/42/402/q", source: "dependent", dispatches: 0 });
    expect(view.stages.verified.items[0]).toMatchObject({ source: "outside", prUrl: "https://github.com/TheAxiomFoundation/rulespec-us/pull/900" });
    // The failure rate and the approval gate count dispatches only.
    expect(view.recentFailureRate).toEqual({ failed: 1, finished: 1, leftOut: 0 });
    expect(view.approval.cancellations).toEqual([]);
  });

  it("counts a PR merged outside the pipeline once a week, beside the dispatch series", () => {
    const weeks = weeklyThroughput(
      [
        merged,
        outsideAttempt({ id: outsideAttemptId("rulespec-us", 900, "us/statutes/7/2017/b.yaml") }),
        outsideAttempt({ id: outsideAttemptId("rulespec-uk", 12, "uk/statutes/x.yaml"), pr_repo: "rulespec-uk", pr_number: 12 }),
        dependentAttempt({ run_conclusion: "success", dispatched_at: "2026-09-29T00:00:00Z", finished_at: "2026-09-29T00:00:00Z" }),
      ],
      NOW,
      2
    );
    expect(weeks).toEqual([
      { weekStart: "2026-09-21T00:00:00.000Z", dispatched: 0, encoded: 0, merged: 0, outside: 2 },
      { weekStart: "2026-09-28T00:00:00.000Z", dispatched: 0, encoded: 0, merged: 0, outside: 0 },
    ]);
  });

  it("starts each journey from where the attempt came from, and names the runs modules were encoded in", () => {
    expect(journeySteps(outsideAttempt())[0].detail).toBe("Merged outside the pipeline · MaxGhenis");
    expect(journeySteps(dependentAttempt())[0].detail).toBe("Encoded in another citation's run");
    expect(hostCitations([pipelineAttempt(), dependentAttempt()])).toEqual(new Map([["1001", "us/statute/7/2017/a"]]));
  });
});
