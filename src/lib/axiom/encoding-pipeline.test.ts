import { describe, expect, it } from "vitest";
import {
  ageLabel,
  attemptStage,
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
  summarizePipeline,
  VIEW_ITEMS_PER_STAGE,
  weeklyThroughput,
  weekStartUtc,
  type PipelineStage,
} from "./encoding-pipeline";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

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

  it("follows a merge through the index and the compile sweep", () => {
    expect(attemptStage(mergedAttempt({ pr_targets_default: false }))).toBe("merged_off_main");
    expect(attemptStage(mergedAttempt({ index_status: "missing" }))).toBe("not_indexed");
    expect(attemptStage(mergedAttempt())).toBe("awaiting_sync");
    const synced = { synced_at: "2026-09-21T12:17:00Z", index_status: "indexed" as const };
    expect(attemptStage(mergedAttempt(synced))).toBe("indexed");
    expect(attemptStage(mergedAttempt({ ...synced, compile_status: "skipped" }))).toBe("indexed");
    expect(attemptStage(mergedAttempt({ ...synced, compile_status: "ok" }))).toBe("runs");
    expect(attemptStage(mergedAttempt({ ...synced, compile_status: "exec_error" }))).toBe(
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
    expect(isStuck("runs", "2026-01-01T00:00:00Z", NOW)).toBe(false);
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
    expect(failureReason(pipelineAttempt({ run_conclusion: "cancelled" })).key).toBe("run:cancelled");
    expect(failureReason(pipelineAttempt({ run_conclusion: "timed_out" })).key).toBe("run:timed_out");
    expect(failureReason(pipelineAttempt()).key).toBe("run:unknown");
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
      .toEqual({ failed: 6, finished: 6 });
    expect(summarizePipeline([pipelineAttempt({ run_conclusion: "skipped" })], NOW).recentFailureRate)
      .toBeNull();
    expect(summarizePipeline([pipelineAttempt()], Date.parse("2027-01-01T00:00:00Z")).recentFailureRate)
      .toBeNull();
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
      { weekStart: "2026-09-21T00:00:00.000Z", dispatched: 1, encoded: 0, merged: 0 },
      { weekStart: "2026-09-28T00:00:00.000Z", dispatched: 1, encoded: 1, merged: 1 },
    ]);
  });
});

describe("journeySteps", () => {
  const states = (a: Parameters<typeof journeySteps>[0]) =>
    journeySteps(a).map((step) => step.state);

  it("stops a failed encode at the encode step with its reason", () => {
    const steps = journeySteps(pipelineAttempt({ encoder_error_rule: "rule-a", encoder_error: "detail" }));
    expect(steps.map((s) => s.state)).toEqual(["done", "failed", "pending", "pending", "pending", "pending"]);
    expect(steps[1].detail).toBe("rule-a — detail");
    expect(steps[0].detail).toBe("Ad hoc dispatch");
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
    expect(draft[2]).toMatchObject({ state: "active", detail: "Draft · checks failure · changes requested" });
    const open = journeySteps(pipelineAttempt({ generation_attempts: 3, pr_state: "open", pr_checks: "none", pr_review: "none" }));
    expect(open[1].detail).toBe("3 generation attempts");
    expect(open[2].detail).toBe("Open");
    expect(journeySteps(pipelineAttempt({ pr_state: "closed" }))[2].state).toBe("failed");
  });

  it("follows a merge to the finish line, or to where it stopped", () => {
    expect(states(mergedAttempt({ pr_targets_default: false, pr_base_branch: "codex/x" }))).toEqual(
      ["done", "done", "done", "failed", "pending", "pending"]
    );
    expect(journeySteps(mergedAttempt({ pr_targets_default: false, pr_base_branch: "codex/x" }))[3].detail)
      .toBe("Into codex/x, not the default branch");
    expect(journeySteps(mergedAttempt())[3].detail).toBe("Into main");
    expect(states(mergedAttempt()).slice(4)).toEqual(["active", "pending"]);
    const missing = journeySteps(mergedAttempt({ index_status: "missing" }));
    expect(missing[4]).toMatchObject({ state: "failed", detail: "A sync ran after the merge without these modules" });
    const indexed = { synced_at: "2026-09-21T12:00:00Z", index_status: "indexed" as const };
    expect(journeySteps(mergedAttempt(indexed))[4].detail).toBe("1 module");
    expect(journeySteps(mergedAttempt({ ...indexed, module_paths: ["a.yaml", "b.yaml"] }))[4].detail).toBe("2 modules");
    expect(states(mergedAttempt(indexed)).slice(4)).toEqual(["done", "active"]);
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
    expect(item("review")).toMatchObject({ prLabel: "rulespec-us#9", reason: null });
    expect(pipelineView([mergedAttempt({ pr_base_branch: null, pr_targets_default: false })], NOW).stages.merged_off_main.items[0].reason).toBeNull();
    expect(pipelineView([mergedAttempt({ synced_at: "S", compile_status: null }), mergedAttempt({ id: "x", citation: "c/x", synced_at: "S", compile_status: "compile_error" })], NOW).stages.compile_failed.items[0].reason).toBe("compile error");
  });

  it("never counts an unchecked module in the index as stuck", () => {
    const old = { synced_at: "2026-09-01T00:00:00Z", index_status: "indexed" as const };
    const view = pipelineView(
      [
        mergedAttempt({ id: "s", citation: "c/s", ...old, compile_status: "skipped" }),
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
});

describe("ageLabel and journeyHref", () => {
  it("formats compact ages", () => {
    expect(ageLabel(null, NOW)).toBeNull();
    expect(ageLabel("2026-09-30T12:00:00Z", NOW)).toBe("1m");
    expect(ageLabel("2026-09-30T11:15:00Z", NOW)).toBe("45m");
    expect(ageLabel("2026-09-29T12:00:00Z", NOW)).toBe("24h");
    expect(ageLabel("2026-09-25T12:00:00Z", NOW)).toBe("5d");
    expect(ageLabel("2026-08-10T12:00:00Z", NOW)).toBe("7w");
  });

  it("links a citation to its journey", () => {
    expect(journeyHref("us/statute/7/2017/a")).toBe("/ops/journey?citation=us%2Fstatute%2F7%2F2017%2Fa");
  });
});
