import type { PipelineAttempt } from "@/lib/axiom/encoding-pipeline";

/** A finished, PR-less dispatch; override fields to place it in a stage. */
export function pipelineAttempt(overrides: Partial<PipelineAttempt> = {}): PipelineAttempt {
  return {
    id: "1001",
    citation: "us/statute/7/2017/a",
    jurisdiction: "us",
    queue_ref: "adhoc:adhoc:adhoc",
    run_url: "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/1001",
    run_attempt: 1,
    dispatched_at: "2026-09-20T10:00:00Z",
    started_at: "2026-09-20T10:00:30Z",
    finished_at: "2026-09-20T10:30:00Z",
    run_status: "completed",
    run_conclusion: "failure",
    failed_step: null,
    failure_source: null,
    encoder_run_id: null,
    encoder_status: null,
    encoder_error: null,
    encoder_error_rule: null,
    generation_attempts: null,
    cost_usd: null,
    pr_repo: null,
    pr_number: null,
    pr_url: null,
    pr_state: null,
    pr_base_branch: null,
    pr_targets_default: null,
    pr_created_at: null,
    pr_merged_at: null,
    pr_closed_at: null,
    pr_checks: null,
    pr_review: null,
    module_paths: [],
    synced_at: null,
    index_status: null,
    compile_status: null,
    compile_checked_at: null,
    compile_error: null,
    collected_at: "2026-09-30T12:00:00Z",
    ...overrides,
  };
}

/** One module a person's PR merged into the default branch outside the pipeline. */
export function outsideAttempt(overrides: Partial<PipelineAttempt> = {}): PipelineAttempt {
  return pipelineAttempt({
    id: "pr:rulespec-us#900:us/statutes/7/2017/a.yaml",
    queue_ref: "outside",
    run_url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/900",
    run_attempt: null,
    dispatched_at: "2026-09-22T08:00:00Z",
    started_at: null,
    finished_at: "2026-09-23T09:00:00Z",
    run_conclusion: "success",
    dispatched_by: "MaxGhenis",
    pr_repo: "rulespec-us",
    pr_number: 900,
    pr_url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/900",
    pr_state: "merged",
    pr_base_branch: "main",
    pr_targets_default: true,
    pr_created_at: "2026-09-22T08:00:00Z",
    pr_merged_at: "2026-09-23T09:00:00Z",
    pr_checks: "none",
    pr_review: "none",
    module_paths: ["us/statutes/7/2017/a.yaml"],
    ...overrides,
  });
}

/** A module the encoder wrote inside run 1001 (another citation's run), from its own record. */
export function dependentAttempt(overrides: Partial<PipelineAttempt> = {}): PipelineAttempt {
  return pipelineAttempt({
    id: "dep:5e2a7c10",
    citation: "us/statute/42/402/q",
    queue_ref: "dependent:1001",
    run_attempt: null,
    dispatched_at: "2026-09-20T10:20:00Z",
    started_at: null,
    finished_at: "2026-09-20T10:20:00Z",
    run_conclusion: "failure",
    encoder_run_id: "5e2a7c10",
    encoder_status: "apply_blocked_validation",
    encoder_error: "statutes/42/402/q.yaml: compile: Axiom rules engine compile failed: unknown field `values`",
    failure_source: "encoder_run",
    generation_attempts: 4,
    cost_usd: 0.4,
    ...overrides,
  });
}

/** A dispatch whose PR merged into the default branch at `merged`. */
export function mergedAttempt(overrides: Partial<PipelineAttempt> = {}): PipelineAttempt {
  return pipelineAttempt({
    run_conclusion: "success",
    pr_repo: "rulespec-us",
    pr_number: 42,
    pr_url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/42",
    pr_state: "merged",
    pr_base_branch: "main",
    pr_targets_default: true,
    pr_created_at: "2026-09-20T10:29:00Z",
    pr_merged_at: "2026-09-21T09:00:00Z",
    pr_checks: "success",
    pr_review: "none",
    module_paths: ["us/statutes/7/2017/a.yaml"],
    ...overrides,
  });
}
