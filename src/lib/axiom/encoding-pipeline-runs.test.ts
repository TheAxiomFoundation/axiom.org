import { describe, expect, it } from "vitest";
import { dispatchFlow, runRow, runRows } from "./encoding-pipeline-runs";
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
      outcomeLabel: "Validation rules",
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
      pr: { label: "rulespec-us#42", state: "merged", error: null },
      merged: "main",
      index: "indexed",
      tests: "pass",
      testsUrl: "R",
    });
    expect(runRow(mergedAttempt({ index_status: "missing" })).index).toBe("missing");
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
        ["continue:Encoded:9", "pending:Running:1", "loss:Validation rules:2", "loss:Setup:1", "loss:Cancelled or timed out:1"],
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
