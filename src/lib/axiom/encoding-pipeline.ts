/**
 * The encoding pipeline, end to end: every encoding followed from the fleet
 * to a rule that compiles and runs. Most rows are targeted re-encode
 * dispatches; the rest are modules merged outside the pipeline and modules
 * the encoder wrote inside another citation's run (see attemptSource).
 *
 * Rows come from encodings.pipeline_attempts, rebuilt on a schedule by
 * scripts/collect-encoding-pipeline.mjs. Everything here is a pure
 * derivation over those rows, so a new stage rule never needs a backfill.
 */

import { normalizeCitation } from "./ops-citations";

/**
 * Where a row comes from. A dispatch is a targeted re-encode run (its id is
 * the GitHub run id, or `pr:<repo>#<n>` for a manifest PR whose run is gone).
 * An outside row is one module file a PR merged into the default branch
 * without a dispatch (`pr:<repo>#<n>:<module path>`). A dependent row is a
 * module the encoder wrote inside another citation's run, a source or a
 * dependent module (`dep:<encoder record id>`).
 */
export type AttemptSource = "dispatch" | "outside" | "dependent";

const OUTSIDE_ID_RE = /^pr:([^#]+)#(\d+):(.+)$/;

export function attemptSource(attempt: Pick<PipelineAttempt, "id">): AttemptSource {
  if (attempt.id.startsWith("dep:")) return "dependent";
  if (OUTSIDE_ID_RE.test(attempt.id)) return "outside";
  return "dispatch";
}

/** Whether a row is a dispatch: only dispatches count in run statistics. */
export function isDispatch(attempt: Pick<PipelineAttempt, "id">): boolean {
  return attemptSource(attempt) === "dispatch";
}

/** The row id of one module file a PR merged outside the pipeline. */
export function outsideAttemptId(repo: string, number: number, path: string): string {
  return `pr:${repo}#${number}:${path}`;
}

/** An outside row's PR and module file, from its id. */
export function outsideIdParts(id: string): { repo: string; number: number; path: string } | null {
  const match = id.match(OUTSIDE_ID_RE);
  return match ? { repo: match[1], number: Number(match[2]), path: match[3] } : null;
}

/** The row id of a module the encoder wrote inside another citation's run. */
export function dependentAttemptId(recordId: string): string {
  return `dep:${recordId}`;
}

const DEPENDENT_QUEUE_PREFIX = "dependent:";

/** A dependent row's queue tag: the run it was encoded in. */
export function dependentQueueRef(hostRunId: string): string {
  return `${DEPENDENT_QUEUE_PREFIX}${hostRunId}`;
}

/** The run a dependent row was encoded in, or null for any other row. */
export function dependentHostId(attempt: Pick<PipelineAttempt, "id" | "queue_ref">): string | null {
  if (attemptSource(attempt) !== "dependent") return null;
  return attempt.queue_ref?.startsWith(DEPENDENT_QUEUE_PREFIX)
    ? attempt.queue_ref.slice(DEPENDENT_QUEUE_PREFIX.length)
    : null;
}

/**
 * When a row happened, for ordering: a dispatch's dispatch, a dependent
 * module's record, and for a PR merged outside the pipeline its merge, the
 * moment it changed the default branch.
 */
export function attemptTime(attempt: PipelineAttempt): string {
  if (attemptSource(attempt) === "outside") return attempt.finished_at ?? attempt.pr_merged_at ?? attempt.dispatched_at;
  return attempt.dispatched_at;
}

/** One targeted re-encode dispatch (or another encoding, see attemptSource) and every stage it has reached. */
export interface PipelineAttempt {
  id: string;
  citation: string;
  jurisdiction: string | null;
  queue_ref: string | null;
  run_url: string;
  run_attempt: number | null;
  dispatched_at: string;
  started_at: string | null;
  finished_at: string | null;
  run_status: string;
  run_conclusion: string | null;
  failed_step: string | null;
  failure_source: string | null;
  encoder_run_id: string | null;
  encoder_status: string | null;
  encoder_error: string | null;
  encoder_error_rule: string | null;
  generation_attempts: number | null;
  cost_usd: number | null;
  pr_repo: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "draft" | "open" | "merged" | "closed" | null;
  pr_base_branch: string | null;
  pr_targets_default: boolean | null;
  pr_created_at: string | null;
  pr_merged_at: string | null;
  pr_closed_at: string | null;
  pr_checks: "success" | "failure" | "pending" | "none" | null;
  pr_review: "approved" | "changes_requested" | "review_required" | "none" | null;
  module_paths: string[];
  synced_at: string | null;
  index_status: "indexed" | "missing" | null;
  compile_status: string | null;
  compile_checked_at: string | null;
  compile_error: string | null;
  collected_at: string;
  /** Head commit's failed checks, by name, without the aggregate "validate / validate". */
  pr_failed_checks?: string[] | null;
  /** How many of the head commit's checks were cancelled before finishing. */
  pr_cancelled_checks?: number | null;
  /** Users or teams a review is requested from. */
  pr_requested_reviewers?: string[] | null;
  pr_merge_commit?: string | null;
  /** For a PR merged into a side branch: that branch's own PR into the
   *  default branch (head = the side branch), which carries the change
   *  there. Once it merged, the attempt counts as merged into the default
   *  branch at its merge commit and time (see reachedMain). */
  pr_via_number?: number | null;
  pr_via_url?: string | null;
  pr_via_state?: "draft" | "open" | "merged" | "closed" | null;
  pr_via_merged_at?: string | null;
  pr_via_merge_commit?: string | null;
  /** The module's jurisdiction validation (compile, companion tests,
   *  source-unit rules) on the default branch at a commit with the merge. */
  tests_status?: "pass" | "fail" | "waived" | null;
  tests_checked_at?: string | null;
  tests_run_url?: string | null;
  /** The axiom-oracles comparison: match, explained (only dispositioned
   *  engine or bridge differences), disagree, or stale (compared an earlier
   *  version of the module). */
  oracle_status?: "match" | "explained" | "disagree" | "stale" | null;
  oracle_report?: string | null;
  oracle_engine?: string | null;
  oracle_checked_at?: string | null;
  /** Who started the run (GitHub's triggering actor). */
  dispatched_by?: string | null;
  /** When the encode job's first step ran: after the production-signing approval. */
  encode_started_at?: string | null;
  /** How far a cancelled run got: approval, before_job, or running. */
  cancel_stage?: "approval" | "before_job" | "running" | null;
  /** When the run's jobs were read (once per run). */
  jobs_checked_at?: string | null;
  /** The axiom-encode commit the run used, and the package version there. */
  encoder_sha?: string | null;
  encoder_version?: string | null;
  /** What an open PR's first failing check printed, and that check's job id. */
  pr_check_error?: string | null;
  pr_check_job_id?: number | null;
  /** The encode job's parts, in seconds: checkouts and builds before the
   *  encode step, the step itself, and packaging, signing, and the PR after it. */
  setup_seconds?: number | null;
  encode_seconds?: number | null;
  publish_seconds?: number | null;
  /** When the run's steps were read for those times (once per run). */
  steps_read_at?: string | null;
  /** When the first successful index sync after the merge finished. */
  indexed_at?: string | null;
  /** When the module's validation shard first finished at the merge commit on main. */
  tests_first_at?: string | null;
  /** When that first shard run started, and how it ended. */
  tests_first_started_at?: string | null;
  tests_first_status?: "pass" | "fail" | null;
  /** That first shard run's page. */
  tests_first_run_url?: string | null;
  /** Each try of the encode loop, from the encoder's own record. */
  tries?: PipelineTry[] | null;
  /** The encode loop's own clock, from the encoder's record (axiom-encode 0.2.2157 on). */
  encode_loop?: EncodeLoopTiming | null;
}

/** One try of the encode loop: the model that wrote the candidate, its time and cost, and what sent it back. */
export interface PipelineTry {
  attempt: number;
  model: string | null;
  /** The model's own time on this try, in milliseconds. */
  ms: number | null;
  cost: number | null;
  ok: boolean;
  /** The first check that failed this try's candidate. */
  error: string | null;
  /** When the try started, and its whole time with its checks (encoder 0.2.2157 on). */
  startedAt?: string;
  wallMs?: number;
  /** What the try did, in order and back to back; the phases add up to its whole time. */
  phases?: PipelineTryPhase[];
}

/** One phase of a try: what the encoder did, for how long, and a check phase's time by tool. */
export interface PipelineTryPhase {
  /** The encoder's phase name: model_call, candidate_validation, overlay_validation, ... */
  name: string;
  ms: number;
  /** A check phase's time by tool (ci_test_cases, rules_engine_compile, ...), the rest under "other". */
  tools?: Record<string, number>;
}

/** One encoder process's loop: its start and whole time, and its time before, between, and after the tries. */
export interface EncodeLoopTiming {
  startedAt: string | null;
  wallMs: number;
  setupMs: number | null;
  triesMs: number | null;
  betweenMs: number | null;
  finalizeMs: number | null;
}

/** Where one attempt sits. Main-line stages first, then the ways out. */
export type PipelineStage =
  | "encoding"
  | "review"
  | "awaiting_sync"
  | "indexed"
  | "runs"
  | "verified"
  | "encode_failed"
  | "no_pr"
  | "closed"
  | "merged_off_main"
  | "not_indexed"
  | "compile_failed"
  | "tests_failing"
  | "oracle_disagrees";

/** Stage names and what they mean, shared by /ops and the journey page. */
export interface StageCopy {
  label: string;
  /** What the stage means and when an item there counts as stuck. */
  description: string;
}

export const STAGE_COPY: Record<PipelineStage, StageCopy> = {
  encoding: {
    label: "Encoding",
    description: "Dispatched runs still going. Stuck after 3 hours.",
  },
  review: {
    label: "In review",
    description:
      "Signed manifest PRs not yet merged, by what holds them: CI, a review, or the merge itself. Stuck after 3 days.",
  },
  awaiting_sync: {
    label: "Merged",
    description:
      "Merged into the default branch; the next index sync picks them up. Stuck after 8 hours.",
  },
  indexed: {
    label: "In the index",
    description:
      "In the index, waiting for its jurisdiction's validation on main to confirm this version. Stuck after 36 hours.",
  },
  runs: {
    label: "Runs",
    description:
      "The nightly axiom-api engine sweep compiles and runs it (with default inputs); its jurisdiction's validation on main has not confirmed it yet. Stuck after 36 hours.",
  },
  verified: {
    label: "Tests pass",
    description:
      "Its jurisdiction's validation on main (compile, companion tests, source-unit rules) passes at a commit that includes the merge, and the axiom-api engine sweep found no error if it has checked. Companion tests are written with the encoding, so this checks consistency, not an outside answer.",
  },
  encode_failed: {
    label: "Last encode failed",
    description:
      "The citation's most recent dispatch failed (or the encoder failed its module inside another citation's run), by the step that stopped it and the first validator rule.",
  },
  no_pr: {
    label: "Encoded, no PR",
    description:
      "Runs that finished without opening a PR, and modules encoded inside another citation's run that its PR does not carry.",
  },
  closed: {
    label: "PR closed unmerged",
    description: "Signed manifest PRs closed without merging.",
  },
  merged_off_main: {
    label: "Merged off main",
    description:
      "Merged into a branch other than the repo's default; they reach the index only once that branch merges into it.",
  },
  not_indexed: {
    label: "Missing from the index",
    description:
      "Merged into the default branch, but a later sync left them out (for example, a repo kept off the index).",
  },
  compile_failed: {
    label: "Fails to compile",
    description:
      "The nightly axiom-api engine sweep can't compile or run a merged module, even when its own repo's checks pass.",
  },
  tests_failing: {
    label: "Fails validation on main",
    description:
      "Its jurisdiction's validation on main fails at a commit that includes the merge.",
  },
  oracle_disagrees: {
    label: "Disagrees with an oracle",
    description:
      "An axiom-oracles comparison of this version (PolicyEngine, TAXSIM, ...) has a mismatch that is unexplained or blamed on the encoding.",
  },
};

export const FAILED_COMPILE_STATUSES = new Set([
  "compile_error",
  "exec_error",
  "closure_error",
]);

/**
 * Whether a merged attempt reached the repo's default branch: its PR merged
 * into it, or into a side branch whose own PR then merged into it.
 */
export function reachedMain(attempt: PipelineAttempt): boolean {
  return (
    attempt.pr_state === "merged" &&
    (attempt.pr_targets_default !== false || attempt.pr_via_state === "merged")
  );
}

/** When the attempt's change reached the default branch: its own merge, or its side branch's. */
export function mainMergedAt(attempt: PipelineAttempt): string | null {
  if (!reachedMain(attempt)) return null;
  return attempt.pr_targets_default === false ? (attempt.pr_via_merged_at ?? null) : attempt.pr_merged_at;
}

/** The side branch's own PR, as "rulespec-us#911". */
export function viaPrLabel(attempt: PipelineAttempt): string | null {
  if (attempt.pr_via_number == null) return null;
  return `${attempt.pr_repo ?? ""}#${attempt.pr_via_number}`;
}

/** Where a merge went: the default branch, a side branch its own PR took on, or a side branch only. */
export function mergeDetail(attempt: PipelineAttempt): string {
  const into = `Into ${attempt.pr_base_branch}`;
  if (attempt.pr_targets_default !== false) return into;
  const via = viaPrLabel(attempt);
  if (attempt.pr_via_state === "merged") return `${into}, then the default branch by ${via}`;
  if (attempt.pr_via_state === "open" || attempt.pr_via_state === "draft") {
    return `${into}; waits for ${via} to merge it into the default branch`;
  }
  return `${into}, not the default branch`;
}

export function attemptStage(attempt: PipelineAttempt): PipelineStage {
  if (attempt.pr_state === "merged") {
    if (!reachedMain(attempt)) return "merged_off_main";
    if (attempt.index_status === "missing") return "not_indexed";
    if (!attempt.synced_at) return "awaiting_sync";
    if (attempt.compile_status && FAILED_COMPILE_STATUSES.has(attempt.compile_status)) {
      return "compile_failed";
    }
    if (attempt.tests_status === "fail") return "tests_failing";
    if (attempt.oracle_status === "disagree") return "oracle_disagrees";
    // Validation on main compiles the module and runs its tests, so it is
    // enough on its own; the nightly engine sweep is an extra check that only
    // ever moves a module out, into compile_failed.
    if (attempt.tests_status === "pass") return "verified";
    if (attempt.compile_status === "ok") return "runs";
    return "indexed";
  }
  if (attempt.pr_state === "draft" || attempt.pr_state === "open") return "review";
  if (attempt.pr_state === "closed") return "closed";
  if (attempt.run_status !== "completed") return "encoding";
  if (attempt.run_conclusion === "success") return "no_pr";
  return "encode_failed";
}

/** When the attempt entered the stage it is in. */
export function stageSince(
  attempt: PipelineAttempt,
  stage: PipelineStage = attemptStage(attempt)
): string | null {
  switch (stage) {
    case "encoding":
      return attempt.started_at ?? attempt.dispatched_at;
    case "encode_failed":
    case "no_pr":
      return attempt.finished_at ?? attempt.dispatched_at;
    case "review":
      return attempt.pr_created_at;
    case "closed":
      return attempt.pr_closed_at;
    case "merged_off_main":
      return attempt.pr_merged_at;
    case "awaiting_sync":
    case "not_indexed":
      return mainMergedAt(attempt) ?? attempt.pr_merged_at;
    case "indexed":
    case "runs":
      return attempt.synced_at;
    case "compile_failed":
      return attempt.compile_checked_at ?? attempt.synced_at;
    // Since validation on main first gave the result it still gives; the
    // latest check says only when it was last confirmed.
    case "verified":
      return (attempt.tests_first_status === "pass" ? attempt.tests_first_at : null) ?? attempt.tests_checked_at ?? attempt.synced_at;
    case "tests_failing":
      return (attempt.tests_first_status === "fail" ? attempt.tests_first_at : null) ?? attempt.tests_checked_at ?? attempt.synced_at;
    case "oracle_disagrees":
      return attempt.oracle_checked_at ?? attempt.synced_at;
  }
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long an item can sit in a waiting stage before it counts as stuck.
 * Exits (a failed encode, a closed PR, ...) are stuck by definition;
 * "verified" is the finish line.
 */
export const STUCK_AFTER_MS: Partial<Record<PipelineStage, number>> = {
  encoding: 3 * HOUR_MS,
  review: 3 * DAY_MS,
  // The index syncs every 6 hours, and the collector triggers one after a merge.
  awaiting_sync: 8 * HOUR_MS,
  // Jurisdiction validation runs on every push to main and daily.
  indexed: 36 * HOUR_MS,
  // Jurisdiction validation runs on every push to main and daily.
  runs: 36 * HOUR_MS,
};

const EXIT_STAGES = new Set<PipelineStage>([
  "encode_failed",
  "no_pr",
  "closed",
  "merged_off_main",
  "not_indexed",
  "compile_failed",
  "tests_failing",
  "oracle_disagrees",
]);

export function isExitStage(stage: PipelineStage): boolean {
  return EXIT_STAGES.has(stage);
}

/**
 * Whether a citation's latest dispatch is stuck. A module whose validation is
 * waived has nothing left to wait for, so it never counts as stuck.
 */
export function citationIsStuck(state: CitationState, referenceMs: number): boolean {
  if (state.latest.tests_status === "waived" && (state.stage === "indexed" || state.stage === "runs")) {
    return false;
  }
  return isStuck(state.stage, state.since, referenceMs);
}

export function isStuck(
  stage: PipelineStage,
  since: string | null,
  referenceMs: number
): boolean {
  if (stage === "no_pr") return false;
  if (EXIT_STAGES.has(stage)) return true;
  const limit = STUCK_AFTER_MS[stage];
  if (limit === undefined || !since) return false;
  return referenceMs - Date.parse(since) > limit;
}

/** A citation's current place: its latest attempt, plus what came before. */
export interface CitationState {
  citation: string;
  jurisdiction: string | null;
  latest: PipelineAttempt;
  stage: PipelineStage;
  since: string | null;
  /** Its dispatches only: merges outside the pipeline and other runs' modules are not dispatches. */
  dispatches: number;
  /** Open or draft PRs across every dispatch of the citation. */
  openPrs: number;
  /** Whether any dispatch of the citation reached the index. */
  reachedIndex: boolean;
}

/** A dispatch cancelled before its encode job started: it never tried the citation. */
export function cancelledBeforeEncode(attempt: PipelineAttempt): boolean {
  return (
    attempt.run_conclusion === "cancelled" &&
    (attempt.cancel_stage === "approval" || attempt.cancel_stage === "before_job")
  );
}

/**
 * The attempt a citation's status comes from: its newest of every source
 * (by attemptTime, so a module merged by hand counts from its merge),
 * passing over dispatches cancelled before their encode job started while
 * an earlier attempt exists, so a cancelled re-dispatch does not hide what
 * came before it.
 */
export function statusAttempt(attempts: PipelineAttempt[]): PipelineAttempt | null {
  const sorted = [...attempts].sort(byTimeDesc);
  return sorted.find((attempt) => !cancelledBeforeEncode(attempt)) ?? sorted[0] ?? null;
}

export function citationStates(attempts: PipelineAttempt[]): CitationState[] {
  const byCitation = new Map<string, PipelineAttempt[]>();
  for (const attempt of attempts) {
    const list = byCitation.get(attempt.citation) ?? [];
    list.push(attempt);
    byCitation.set(attempt.citation, list);
  }
  return [...byCitation.entries()].map(([citation, list]) => {
    const latest = statusAttempt(list)!;
    const stage = attemptStage(latest);
    return {
      citation,
      jurisdiction: latest.jurisdiction,
      latest,
      stage,
      since: stageSince(latest, stage),
      dispatches: list.filter(isDispatch).length,
      openPrs: list.filter((a) => a.pr_state === "draft" || a.pr_state === "open")
        .length,
      reachedIndex: list.some((a) => a.synced_at !== null),
    };
  });
}

function byTimeDesc(a: PipelineAttempt, b: PipelineAttempt): number {
  return Date.parse(attemptTime(b)) - Date.parse(attemptTime(a));
}

/** Why an encode failed, grouped so one cause behind many flags stands out. */
export interface FailureReason {
  key: string;
  label: string;
  /** Which part of the pipeline raised it. */
  kind: "validator" | "encoder" | "workflow" | "run";
}

const ENCODER_STATUS_LABELS: Record<string, string> = {
  apply_blocked_validation: "Blocked by validation",
  apply_blocked_manifest: "Blocked by the signed manifest",
  apply_blocked_generation: "Generation failed",
};

/** Diagnostics bundles name steps by id; the jobs API by "job / step" name. */
const FAILED_STEP_LABELS: Record<string, string> = {
  encode_apply: "Encode, review, validate, and apply",
  repair_candidate: "Resolve trusted prior-run repair candidate",
  package_exact_generated_changes: "Package exact generated changes",
  verify_generated_provenance: "Verify generated provenance",
};

export function failedStepLabel(step: string): string {
  const known = FAILED_STEP_LABELS[step];
  if (known) return known;
  const name = step.split(" / ").at(-1)!.trim();
  if (!/^[a-z0-9_]+$/.test(name)) return name;
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CANCEL_LABELS: Record<NonNullable<PipelineAttempt["cancel_stage"]>, string> = {
  approval: "Cancelled while waiting for signing approval",
  before_job: "Cancelled before the encode job started",
  running: "Cancelled mid-run",
};

/** An encoder error without the module file it was raised for or the check that raised it. */
export function errorMessage(error: string): string {
  return error.replace(/^\S+\.ya?ml:\s*/, "").replace(/^(?:ci|compile|grounding|proof|oracle|review):\s*/, "");
}

/**
 * An error as the group runs failing the same way share: without the module
 * file it was raised for, the check that raised it, the exception's module
 * path, quoted or backticked values (citations, rule and test names, paths),
 * or numbers.
 */
export function errorGroupLabel(error: string): string {
  return checkErrorLabel(
    errorMessage(error)
      .replace(/^(?:[a-z_][\w]*\.)+(?=[A-Z]\w*(?:Error|Exception|Exit)\b)/, "")
      .replace(/`[^`]*`|'[^']*'|"[^"]*"/g, "…")
      // Before checkErrorLabel, so a long number is not taken for a hash.
      .replace(/\b\d+(?:\.\d+)*\b/g, "N")
  );
}

/**
 * The other module a run's failure came from: the target module applied,
 * and the error names a different module file (an import the encoder also
 * wrote), so the failure is that module's, not the target's.
 */
export function dependentModule(attempt: PipelineAttempt): string | null {
  if (attempt.encoder_status !== "apply_applied") return null;
  return attempt.encoder_error?.match(/^(\S+?\.ya?ml):/)?.[1] ?? null;
}

export function failureReason(attempt: PipelineAttempt): FailureReason {
  // A cancelled run's story is how far it got, not what it last logged.
  if (attempt.run_conclusion === "timed_out") {
    return { key: "run:timed_out", label: "Timed out", kind: "run" };
  }
  if (attempt.run_conclusion === "cancelled") {
    return attempt.cancel_stage
      ? { key: `cancel:${attempt.cancel_stage}`, label: CANCEL_LABELS[attempt.cancel_stage], kind: "run" }
      : { key: "run:cancelled", label: "Cancelled (not read yet)", kind: "run" };
  }
  const dependent = dependentModule(attempt);
  if (dependent) {
    return { key: `dependent:${dependent}`, label: `A dependent module failed: ${dependent}`, kind: "validator" };
  }
  if (attempt.encoder_error_rule) {
    return {
      key: `rule:${attempt.encoder_error_rule}`,
      label: attempt.encoder_error_rule,
      kind: "validator",
    };
  }
  // An issue or log error with no rule id: group by what it says, which
  // tells more than the encoder's status or the step that stopped the run.
  if (attempt.encoder_error) {
    const label = errorGroupLabel(attempt.encoder_error);
    return {
      key: `error:${label}`,
      label,
      kind: attempt.failure_source === "log" ? "encoder" : "validator",
    };
  }
  if (attempt.encoder_status && ENCODER_STATUS_LABELS[attempt.encoder_status]) {
    return {
      key: `status:${attempt.encoder_status}`,
      label: ENCODER_STATUS_LABELS[attempt.encoder_status],
      kind: "encoder",
    };
  }
  if (attempt.failed_step) {
    // Key by label so a step named by id and by job/step name groups once.
    const label = failedStepLabel(attempt.failed_step);
    return { key: `step:${label}`, label: `Failed at: ${label}`, kind: "workflow" };
  }
  // Never looked up yet: the collector works through causes in batches.
  if (!attempt.failure_source) {
    return { key: "run:pending", label: "Cause not looked up yet", kind: "run" };
  }
  return { key: "run:unknown", label: "No failure detail recorded", kind: "run" };
}

/** The step of a targeted encode run that stopped it, in run order. */
export type EncodeGate =
  | "dependent"
  | "budget"
  | "setup"
  | "generate"
  | "compile"
  | "validate"
  | "review"
  | "sign"
  | "publish"
  | "encode"
  | "cancelled"
  | "pending"
  | "unknown";

/** A failed run's outcome, named by the step that stopped it. */
export const ENCODE_GATE_LABELS: Record<EncodeGate, string> = {
  dependent: "A dependent module failed",
  budget: "Attempt budget used up",
  setup: "Failed in setup",
  generate: "Failed to generate",
  compile: "Failed the compile check",
  validate: "Failed validation",
  review: "Failed review",
  sign: "Failed to sign",
  publish: "Failed to open the PR",
  encode: "Failed in the encode step",
  cancelled: "Cancelled or timed out",
  pending: "Failed, cause not looked up yet",
  unknown: "Failed at an unknown step",
};

/** The validator's issue prefix: "<file>.yaml: <check>: ...", or the check alone ("compile: ..."). */
const ERROR_CHECK_RE = /^(?:\S+?\.ya?ml:\s*)?([a-z_-]+):/;
const ERROR_CHECK_GATES: Record<string, EncodeGate> = {
  ci: "validate",
  compile: "compile",
  grounding: "validate",
  proof: "validate",
  oracle: "validate",
  review: "review",
};

/** Workflow steps (by diagnostics id or job/step name) and the gate they belong to. */
const STEP_GATES: Array<[RegExp, EncodeGate]> = [
  [/budget/i, "budget"],
  [/repair[ _]candidate|checkout identities|corpus release|signing supervisor|compose runtime|routing|existing signed imports|source inputs/i, "setup"],
  [/package|provenance|commit[ _]reviewed/i, "sign"],
  [/pull request|publish_lane|push lane/i, "publish"],
  [/encode_apply|encode, review, validate, and apply/i, "encode"],
];

/** Encoder step ids a failure bundle names, by the station they belong to. */
const ENCODER_STEP_STATION: Record<string, string> = {
  encode_apply: "validate",
  repair_candidate: "validate",
  package_exact_generated_changes: "publish",
  verify_generated_provenance: "publish",
  finalize_signed_reencode_artifact: "publish",
};

/**
 * The station a failed workflow step belongs to. Workflow step names read
 * "<job> / <step>"; encoder step ids are bare. Anything else before the
 * encode step is setup. The ledger's gates and the event log's stations
 * both read it, so a new step name lands in the same place in both.
 */
export function failedStepStation(step: string): string {
  if (ENCODER_STEP_STATION[step]) return ENCODER_STEP_STATION[step];
  const name = step.includes(" / ") ? step.slice(step.lastIndexOf(" / ") + 3) : step;
  if (/^Encode, review, validate|dependent cascade/i.test(name)) return "validate";
  if (/pull request|^Push |^Package|^Sign/i.test(name)) return "publish";
  return "setup";
}

/** A station from failedStepStation, as the gate a failed run's label names. */
const STATION_GATES: Record<string, EncodeGate> = { setup: "setup", validate: "validate", publish: "sign" };

export function encodeGate(attempt: PipelineAttempt): EncodeGate {
  if (attempt.run_conclusion === "cancelled" || attempt.run_conclusion === "timed_out") {
    return "cancelled";
  }
  if (dependentModule(attempt)) return "dependent";
  const check = attempt.encoder_error?.match(ERROR_CHECK_RE)?.[1];
  if (check && ERROR_CHECK_GATES[check]) return ERROR_CHECK_GATES[check];
  if (attempt.encoder_status === "apply_blocked_generation") return "generate";
  if (attempt.encoder_status === "apply_blocked_manifest") return "sign";
  if (attempt.encoder_error_rule || attempt.encoder_status === "apply_blocked_validation") {
    return "validate";
  }
  if (attempt.failed_step) {
    for (const [pattern, gate] of STEP_GATES) {
      if (pattern.test(attempt.failed_step)) return gate;
    }
    // A step the list does not name still has a place in the run: before
    // the encode step it is setup (fetching the corpus, migrations).
    return STATION_GATES[failedStepStation(attempt.failed_step)] ?? "setup";
  }
  return attempt.failure_source ? "unknown" : "pending";
}

/** What holds a signed manifest PR that has not merged. */
export type ReviewHold =
  | "ci_cancelled"
  | "ci_failing_own"
  | "ci_failing_other"
  | "ci_failing"
  | "ci_pending"
  | "changes_requested"
  | "draft"
  | "awaiting_review"
  | "approved";

export const REVIEW_HOLD_LABELS: Record<ReviewHold, string> = {
  ci_cancelled: "CI cancelled before finishing",
  ci_failing_own: "Fails its own checks",
  ci_failing_other: "Blocked by another jurisdiction's failing check",
  ci_failing: "Fails CI",
  ci_pending: "CI still running",
  changes_requested: "Changes requested",
  draft: "Draft, CI passed, not marked ready",
  awaiting_review: "Awaiting review",
  approved: "Approved, not merged",
};

/** "validate / validate (us-az)" → "us-az"; null for checks that are not a shard. */
export function checkJurisdiction(name: string): string | null {
  return name.match(/^validate \/ validate \(([^)]+)\)$/)?.[1] ?? null;
}

export function reviewHold(attempt: PipelineAttempt): ReviewHold {
  if (attempt.pr_review === "changes_requested") return "changes_requested";
  if (attempt.pr_checks === "failure") {
    const failed = attempt.pr_failed_checks;
    if (!failed) return "ci_failing";
    if (failed.length === 0) {
      return (attempt.pr_cancelled_checks ?? 0) > 0 ? "ci_cancelled" : "ci_failing";
    }
    // A failing check outside the jurisdiction shards (build, lint) is the PR's own.
    const own = failed.some((name) => {
      const shard = checkJurisdiction(name);
      return shard === null || shard === attempt.jurisdiction;
    });
    return own ? "ci_failing_own" : "ci_failing_other";
  }
  if (attempt.pr_checks === "pending") return "ci_pending";
  if (attempt.pr_review === "approved") return "approved";
  if (attempt.pr_state === "draft") return "draft";
  return "awaiting_review";
}

export interface StageSummary {
  stage: PipelineStage;
  /** Citations whose latest dispatch sits here. */
  count: number;
  stuck: number;
  oldestSince: string | null;
  citations: CitationState[];
}

/** Citations of one stage grouped by a derived key, largest group first. */
export interface CitationGroup {
  key: string;
  label: string;
  count: number;
  citations: CitationState[];
}

export function groupCitations(
  states: CitationState[],
  keyOf: (state: CitationState) => string,
  labelOf: (key: string) => string
): CitationGroup[] {
  const groups = new Map<string, CitationGroup>();
  for (const state of states) {
    const key = keyOf(state);
    const group = groups.get(key) ?? { key, label: labelOf(key), count: 0, citations: [] };
    group.count += 1;
    group.citations.push(state);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );
}

export interface FailureGroup extends FailureReason {
  count: number;
  latestAt: string | null;
  citations: CitationState[];
}

export interface WeeklyThroughput {
  /** Monday 00:00 UTC of the week. */
  weekStart: string;
  /** Dispatches only, as are encoded and merged. */
  dispatched: number;
  encoded: number;
  merged: number;
  /** PRs merged into a default branch outside the pipeline (each PR once, however many modules). */
  outside: number;
}

/** Citations whose latest attempt is not a dispatch, by where it came from. */
export interface SourceCounts {
  outside: number;
  dependent: number;
}

export interface PipelineSummary {
  collectedAt: string | null;
  /** The first dispatch and the count of dispatches (other rows are not dispatches). */
  firstDispatchAt: string | null;
  dispatchCount: number;
  citationCount: number;
  /** Citations whose stage comes from a merge outside the pipeline or another citation's run. */
  sources: SourceCounts;
  stages: Record<PipelineStage, StageSummary>;
  /** Open PRs beyond the first for a citation (re-dispatches that never closed the old PR). */
  duplicatePrs: number;
  /** Encode failures of each citation's latest dispatch, largest group first. */
  failures: FailureGroup[];
  /** The same failures by the step of the run that stopped them. */
  gates: CitationGroup[];
  /** Citations in review by what holds their PR. */
  holds: CitationGroup[];
  /** Every dispatch's failure (not just latest) over the last FAILURE_WINDOW_DAYS. */
  /** Finished runs of the window that failed; cancelled runs and budget stops are left out of both. */
  recentFailureRate: { failed: number; finished: number; leftOut: number } | null;
  weekly: WeeklyThroughput[];
}

export const ALL_STAGES: PipelineStage[] = [
  "encoding",
  "review",
  "awaiting_sync",
  "indexed",
  "runs",
  "verified",
  "encode_failed",
  "no_pr",
  "closed",
  "merged_off_main",
  "not_indexed",
  "compile_failed",
  "tests_failing",
  "oracle_disagrees",
];

const FAILURE_WINDOW_DAYS = 14;
const WEEKS_SHOWN = 8;

export function summarizePipeline(
  attempts: PipelineAttempt[],
  referenceMs: number
): PipelineSummary {
  const states = citationStates(attempts);
  const stages = Object.fromEntries(
    ALL_STAGES.map((stage) => [
      stage,
      { stage, count: 0, stuck: 0, oldestSince: null, citations: [] } as StageSummary,
    ])
  ) as Record<PipelineStage, StageSummary>;

  let duplicatePrs = 0;
  const sources: SourceCounts = { outside: 0, dependent: 0 };
  const failureGroups = new Map<string, FailureGroup>();
  for (const state of states) {
    const source = attemptSource(state.latest);
    if (source !== "dispatch") sources[source] += 1;
    const summary = stages[state.stage];
    summary.count += 1;
    summary.citations.push(state);
    if (citationIsStuck(state, referenceMs)) summary.stuck += 1;
    if (
      state.since &&
      (!summary.oldestSince || Date.parse(state.since) < Date.parse(summary.oldestSince))
    ) {
      summary.oldestSince = state.since;
    }
    duplicatePrs += Math.max(0, state.openPrs - 1);
    if (state.stage === "encode_failed") {
      const reason = failureReason(state.latest);
      const group = failureGroups.get(reason.key) ?? {
        ...reason,
        count: 0,
        latestAt: null,
        citations: [],
      };
      group.count += 1;
      group.citations.push(state);
      if (state.since && (!group.latestAt || state.since > group.latestAt)) {
        group.latestAt = state.since;
      }
      failureGroups.set(reason.key, group);
    }
  }
  // Waiting stages list their oldest first (the stuck end); exits their newest.
  for (const summary of Object.values(stages)) {
    summary.citations.sort(bySinceAsc);
    if (isExitStage(summary.stage)) summary.citations.reverse();
  }
  for (const group of failureGroups.values()) {
    group.citations.sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
  }

  // Run statistics count dispatches only; the citation views above count every source.
  const dispatches = attempts.filter(isDispatch);
  const dispatchTimes = dispatches.map((a) => a.dispatched_at).sort();
  const collectedTimes = attempts.map((a) => a.collected_at).sort();

  return {
    collectedAt: collectedTimes.at(-1) ?? null,
    firstDispatchAt: dispatchTimes[0] ?? null,
    dispatchCount: dispatches.length,
    citationCount: states.length,
    sources,
    stages,
    duplicatePrs,
    failures: [...failureGroups.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    ),
    gates: groupCitations(
      stages.encode_failed.citations,
      (state) => encodeGate(state.latest),
      (key) => ENCODE_GATE_LABELS[key as EncodeGate]
    ),
    holds: groupCitations(
      stages.review.citations,
      (state) => reviewHold(state.latest),
      (key) => REVIEW_HOLD_LABELS[key as ReviewHold]
    ),
    recentFailureRate: recentFailureRate(dispatches, referenceMs),
    weekly: weeklyThroughput(attempts, referenceMs),
  };
}

function bySinceAsc(a: CitationState, b: CitationState): number {
  return (a.since ?? "").localeCompare(b.since ?? "");
}

function recentFailureRate(
  attempts: PipelineAttempt[],
  referenceMs: number
): PipelineSummary["recentFailureRate"] {
  const since = referenceMs - FAILURE_WINDOW_DAYS * DAY_MS;
  let failed = 0;
  let finished = 0;
  let leftOut = 0;
  for (const attempt of attempts) {
    if (attempt.run_status !== "completed" || !attempt.finished_at) continue;
    if (Date.parse(attempt.finished_at) < since) continue;
    if (attempt.run_conclusion === "skipped") continue;
    // A cancelled run and a run the attempt budget stopped say nothing about
    // how the encoder does: neither counts as finished or failed.
    if (
      attempt.run_conclusion === "cancelled" ||
      (attempt.run_conclusion !== "success" && encodeGate(attempt) === "budget")
    ) {
      leftOut += 1;
      continue;
    }
    finished += 1;
    if (attempt.run_conclusion !== "success") failed += 1;
  }
  return finished > 0 ? { failed, finished, leftOut } : null;
}

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStartUtc(ms: number): number {
  const date = new Date(ms);
  const day = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
}

export function weeklyThroughput(
  attempts: PipelineAttempt[],
  referenceMs: number,
  weeks = WEEKS_SHOWN
): WeeklyThroughput[] {
  const lastWeek = weekStartUtc(referenceMs);
  const rows: WeeklyThroughput[] = [];
  const index = new Map<number, WeeklyThroughput>();
  for (let i = weeks - 1; i >= 0; i--) {
    const start = lastWeek - i * 7 * DAY_MS;
    const row = {
      weekStart: new Date(start).toISOString(),
      dispatched: 0,
      encoded: 0,
      merged: 0,
      outside: 0,
    };
    rows.push(row);
    index.set(start, row);
  }
  const bump = (value: string | null, key: keyof Omit<WeeklyThroughput, "weekStart">) => {
    if (!value) return;
    const row = index.get(weekStartUtc(Date.parse(value)));
    if (row) row[key] += 1;
  };
  // A PR merged outside the pipeline has a row per module it changed; it counts once.
  const outsidePrs = new Set<string>();
  for (const attempt of attempts) {
    const source = attemptSource(attempt);
    if (source === "outside") {
      const parts = outsideIdParts(attempt.id);
      const key = parts ? `${parts.repo}#${parts.number}` : attempt.id;
      if (!outsidePrs.has(key) && reachedMain(attempt)) {
        outsidePrs.add(key);
        bump(mainMergedAt(attempt), "outside");
      }
      continue;
    }
    if (source !== "dispatch") continue;
    bump(attempt.dispatched_at, "dispatched");
    if (attempt.run_conclusion === "success") bump(attempt.finished_at, "encoded");
    if (reachedMain(attempt)) bump(mainMergedAt(attempt), "merged");
  }
  return rows;
}

/**
 * A citation's every attempt, newest first, for the journey view: under
 * every spelling of it (`us-nc:manual/...` and `us-nc/manual/...`), as the
 * ledger counts them.
 */
export function citationJourney(
  attempts: PipelineAttempt[],
  citation: string
): PipelineAttempt[] {
  const wanted = normalizeCitation(citation);
  return attempts.filter((a) => a.citation === citation || normalizeCitation(a.citation) === wanted).sort(byTimeDesc);
}

/** Each dispatch's citation by its run id, to name the run a dependent module was encoded in. */
export function hostCitations(attempts: PipelineAttempt[]): Map<string, string> {
  const hosts = new Map<string, string>();
  for (const attempt of attempts) if (isDispatch(attempt)) hosts.set(attempt.id, attempt.citation);
  return hosts;
}

export interface JourneyStep {
  key: "dispatched" | "encoded" | "pr" | "merged" | "indexed" | "compiled" | "tested" | "oracle";
  label: string;
  at: string | null;
  state: "done" | "active" | "failed" | "pending";
  detail: string | null;
  href: string | null;
}

/** One dispatch as an ordered list of pipeline steps. */
export function journeySteps(attempt: PipelineAttempt): JourneyStep[] {
  const stage = attemptStage(attempt);
  const failedEncode = stage === "encode_failed";
  const encodeDone = attempt.run_conclusion === "success" || attempt.pr_state !== null;
  const merged = attempt.pr_state === "merged";
  const reason = failedEncode ? failureReason(attempt) : null;

  return [
    {
      key: "dispatched",
      label: "Dispatched",
      at: attempt.dispatched_at,
      state: "done",
      detail: dispatchDetail(attempt),
      href: attempt.run_url,
    },
    {
      key: "encoded",
      label: "Encoded",
      at: attempt.finished_at,
      state: encodeDone
        ? "done"
        : stage === "encoding"
          ? "active"
          : failedEncode
            ? "failed"
            : "pending",
      detail: failedEncode
        ? failedEncodeDetail(attempt, reason!)
        : attempt.generation_attempts
          ? `${attempt.generation_attempts} generation attempt${attempt.generation_attempts === 1 ? "" : "s"}`
          : stage === "no_pr"
            ? "Finished without opening a PR"
            : null,
      href: attempt.run_url,
    },
    {
      key: "pr",
      label: "Pull request",
      at: attempt.pr_created_at,
      state: attempt.pr_state === null
        ? "pending"
        : attempt.pr_state === "closed"
          ? "failed"
          : merged
            ? "done"
            : "active",
      detail: attempt.pr_state === null
        ? null
        : attempt.pr_state === "draft" || attempt.pr_state === "open"
          ? [REVIEW_HOLD_LABELS[reviewHold(attempt)], reviewDetail(attempt)]
              .filter(Boolean)
              .join(" — ")
          : [
              capitalize(attempt.pr_state),
              attempt.pr_checks && attempt.pr_checks !== "none" ? `checks ${attempt.pr_checks}` : null,
              attempt.pr_review && attempt.pr_review !== "none"
                ? attempt.pr_review.replaceAll("_", " ")
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
      href: attempt.pr_url,
    },
    {
      key: "merged",
      label: "Merged",
      at: attempt.pr_merged_at,
      state: merged ? (reachedMain(attempt) ? "done" : "failed") : "pending",
      detail: merged && attempt.pr_base_branch ? mergeDetail(attempt) : null,
      href: attempt.pr_url,
    },
    {
      key: "indexed",
      label: "In the index",
      at: attempt.synced_at,
      state: attempt.synced_at
        ? "done"
        : attempt.index_status === "missing"
          ? "failed"
          : stage === "awaiting_sync"
            ? "active"
            : "pending",
      detail: attempt.index_status === "missing"
        ? "A sync ran after the merge without these modules"
        : attempt.synced_at && attempt.module_paths.length
          ? `${attempt.module_paths.length} module${attempt.module_paths.length === 1 ? "" : "s"}`
          : null,
      href: null,
    },
    {
      key: "compiled",
      label: "Compiles and runs",
      at: attempt.compile_checked_at,
      // The engine sweep is an extra check: never what a module waits on.
      state: attempt.compile_status === "ok"
        ? "done"
        : attempt.compile_status && FAILED_COMPILE_STATUSES.has(attempt.compile_status)
          ? "failed"
          : "pending",
      detail: attempt.compile_error ??
        (attempt.compile_status === "skipped"
          ? attempt.module_paths.length === 0
            ? "No module changed"
            : "Not checked (composition)"
          : attempt.synced_at && !attempt.compile_status
            ? "Not checked by the axiom-api engine sweep yet"
            : null),
      href: null,
    },
    {
      key: "tested",
      label: "Tests pass on main",
      at: attempt.tests_checked_at ?? null,
      state: attempt.tests_status === "pass"
        ? "done"
        : attempt.tests_status === "fail"
          ? "failed"
          : (stage === "indexed" || stage === "runs") && attempt.tests_status !== "waived"
            ? "active"
            : "pending",
      detail: attempt.tests_status === "pass"
        ? "Its jurisdiction's validation passes on main"
        : attempt.tests_status === "fail"
          ? "Its jurisdiction's validation fails on main"
          : attempt.tests_status === "waived"
            ? "Skipped: an active known-validation-gaps waiver"
            : null,
      href: attempt.tests_run_url ?? null,
    },
    {
      key: "oracle",
      label: "Matches an oracle",
      at: attempt.oracle_status && attempt.oracle_status !== "stale"
        ? attempt.oracle_checked_at ?? null
        : null,
      state: attempt.oracle_status === "match" || attempt.oracle_status === "explained"
        ? "done"
        : attempt.oracle_status === "disagree"
          ? "failed"
          : "pending",
      detail: attempt.oracle_status
        ? [oracleLabel(attempt), attempt.oracle_report].filter(Boolean).join(" — ")
        : attempt.pr_state === "merged"
          ? "No oracle report covers it"
          : null,
      // Attempts retain a filename, so this detail link follows the live report branch.
      href: attempt.oracle_report
        ? `https://github.com/TheAxiomFoundation/axiom-oracles/blob/oracle-data/dashboard/public/data/${attempt.oracle_report}`
        : null,
    },
  ];
}

/** Where an attempt started: its queue, an ad hoc dispatch, a merge outside the pipeline, or another citation's run. */
function dispatchDetail(attempt: PipelineAttempt): string {
  switch (attemptSource(attempt)) {
    case "outside":
      return ["Merged outside the pipeline", attempt.dispatched_by].filter(Boolean).join(" · ");
    case "dependent":
      return "Encoded in another citation's run";
    default:
      return attempt.queue_ref && !attempt.queue_ref.startsWith("adhoc") ? `Queue ${attempt.queue_ref}` : "Ad hoc dispatch";
  }
}

/**
 * What stopped a failed encode, in full: the step, then the error as the
 * encoder wrote it. The group the error falls in is made from that message,
 * so it is left out where the message follows; a validator rule the message
 * does not name stays in front of it. Without a message, the group and how
 * far a cancelled run got.
 */
function failedEncodeDetail(attempt: PipelineAttempt, reason: FailureReason): string {
  const gate = ENCODE_GATE_LABELS[encodeGate(attempt)];
  const message = attempt.encoder_error ? errorMessage(attempt.encoder_error) : null;
  if (message) {
    const rule = attempt.encoder_error_rule && !message.includes(attempt.encoder_error_rule) ? attempt.encoder_error_rule : null;
    return `${gate}: ${[rule, message].filter(Boolean).join(" — ")}`;
  }
  return [`${gate}: ${reason.label}`, cancellationDetail(attempt)].filter(Boolean).join(" — ");
}

const ORACLE_ENGINE_LABELS: Record<string, string> = {
  policyengine: "PolicyEngine",
  euromod: "EUROMOD",
  taxsim: "TAXSIM",
  snapqc: "SNAP QC",
  spsm: "SPSM",
};

/** The oracle comparison in a few words, or null when no report covers it. */
export function oracleLabel(attempt: PipelineAttempt): string | null {
  if (!attempt.oracle_status) return null;
  const engine =
    ORACLE_ENGINE_LABELS[attempt.oracle_engine ?? ""] ?? attempt.oracle_engine ?? "an oracle";
  switch (attempt.oracle_status) {
    case "match":
      return `Matches ${engine}`;
    case "explained":
      return `Matches ${engine}, differences explained`;
    case "disagree":
      return `Disagrees with ${engine}`;
    case "stale":
      return capitalize(`${engine} report predates this version`);
  }
}

/** Which checks fail, how many were cancelled, and whom a review waits on. */
export function reviewDetail(attempt: PipelineAttempt): string | null {
  const parts: string[] = [];
  const failed = attempt.pr_failed_checks ?? [];
  if (failed.length > 0) {
    const shown = failed.slice(0, 3).join(", ");
    parts.push(`failing: ${shown}${failed.length > 3 ? ` and ${failed.length - 3} more` : ""}`);
  }
  const cancelled = attempt.pr_cancelled_checks ?? 0;
  if (cancelled > 0) parts.push(`${cancelled} check${cancelled === 1 ? "" : "s"} cancelled`);
  const reviewers = attempt.pr_requested_reviewers ?? [];
  if (reviewers.length > 0) parts.push(`waiting on ${reviewers.join(", ")}`);
  else if (reviewHold(attempt) === "awaiting_review") parts.push("no reviewer requested");
  return parts.length ? parts.join(" · ") : null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** One citation as the /ops pipeline view lists it: small and serializable. */
export interface PipelineItem {
  citation: string;
  jurisdiction: string | null;
  stage: PipelineStage;
  since: string | null;
  stuck: boolean;
  dispatches: number;
  openPrs: number;
  reachedIndex: boolean;
  /** Where the latest attempt came from: a dispatch, a merge outside the pipeline, or another citation's run. */
  source: AttemptSource;
  runUrl: string;
  prUrl: string | null;
  prLabel: string | null;
  prState: PipelineAttempt["pr_state"];
  prChecks: PipelineAttempt["pr_checks"];
  prReview: PipelineAttempt["pr_review"];
  prBaseBranch: string | null;
  /** For a failed encode, the step of the run that stopped it. */
  gate: string | null;
  /** The oracle comparison, when a report covers the module. */
  oracle: string | null;
  testsRunUrl: string | null;
  /** Why it stopped, in a few words (failure group, what holds a PR, ...). */
  reason: string | null;
  /** The first validator issue, apply or compile error, or a PR's failing checks. */
  detail: string | null;
}

export interface PipelineStageView {
  count: number;
  stuck: number;
  oldestSince: string | null;
  items: PipelineItem[];
}

export interface PipelineFailureView {
  key: string;
  label: string;
  kind: FailureReason["kind"];
  count: number;
  latestAt: string | null;
  items: PipelineItem[];
}

/** A stage's citations grouped by a derived key (step, hold). */
export interface PipelineGroupView {
  key: string;
  label: string;
  count: number;
  items: PipelineItem[];
}

export interface PipelineView {
  collectedAt: string | null;
  /** When the compile sweep last checked a merged module; null until it has. */
  compileCheckedAt: string | null;
  firstDispatchAt: string | null;
  dispatchCount: number;
  citationCount: number;
  /** Citations whose stage comes from a merge outside the pipeline or another citation's run. */
  sources: SourceCounts;
  stages: Record<PipelineStage, PipelineStageView>;
  duplicatePrs: number;
  failures: PipelineFailureView[];
  /** Failed encodes by the step that stopped them. */
  gates: PipelineGroupView[];
  /** Citations in review by what holds their PR. */
  holds: PipelineGroupView[];
  recentFailureRate: PipelineSummary["recentFailureRate"];
  weekly: WeeklyThroughput[];
  approval: ApprovalSummary;
}

export const VIEW_ITEMS_PER_STAGE = 60;
const VIEW_ITEMS_PER_FAILURE = 30;

/** GitHub's run statuses before a runner picks the job up. */
const RUN_WAITING_LABELS: Record<string, string> = {
  waiting: "Waiting for deployment approval",
  queued: "Queued for a runner",
  requested: "Queued for a runner",
  pending: "Queued for a runner",
};

function itemReason(state: CitationState): string | null {
  const latest = state.latest;
  switch (state.stage) {
    case "encoding":
      return RUN_WAITING_LABELS[latest.run_status] ?? null;
    case "encode_failed":
      return failureReason(latest).label;
    case "review":
      return REVIEW_HOLD_LABELS[reviewHold(latest)];
    case "tests_failing":
      return "Fails its jurisdiction's validation on main";
    case "runs":
      return latest.tests_status === "waived"
        ? "Validation waived on main (known gap)"
        : "Waiting for its jurisdiction's validation on main";
    case "verified":
    case "oracle_disagrees":
      return oracleLabel(latest) ?? "No oracle report covers it";
    case "compile_failed":
      return latest.compile_status?.replaceAll("_", " ") ?? null;
    case "merged_off_main": {
      if (!latest.pr_base_branch) return null;
      const waits = latest.pr_via_state === "open" || latest.pr_via_state === "draft";
      return `Merged into ${latest.pr_base_branch}${waits ? `; waits for ${viaPrLabel(latest)}` : ""}`;
    }
    case "not_indexed":
      return "Not in the index after a later sync";
    default:
      return null;
  }
}

/**
 * What a failing check printed, with file paths and commit hashes elided:
 * the part PRs failing the same way share.
 */
export function checkErrorLabel(message: string): string {
  return message
    .replace(/\S*\/\S*/g, "…")
    .replace(/\b[0-9a-f]{7,40}\b/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

function itemDetail(state: CitationState): string | null {
  const latest = state.latest;
  if (state.stage === "compile_failed") return latest.compile_error;
  if (state.stage === "encode_failed") return latest.encoder_error ?? cancellationDetail(latest);
  if (state.stage === "review") {
    const printed = latest.pr_check_error ? checkErrorLabel(latest.pr_check_error) : null;
    return [printed, reviewDetail(latest)].filter(Boolean).join(" · ") || null;
  }
  return null;
}

export function pipelineItem(state: CitationState, referenceMs: number): PipelineItem {
  const latest = state.latest;
  return {
    citation: state.citation,
    jurisdiction: state.jurisdiction,
    stage: state.stage,
    since: state.since,
    stuck: citationIsStuck(state, referenceMs),
    dispatches: state.dispatches,
    openPrs: state.openPrs,
    reachedIndex: state.reachedIndex,
    source: attemptSource(latest),
    runUrl: latest.run_url,
    prUrl: latest.pr_url,
    prLabel: latest.pr_repo && latest.pr_number ? `${latest.pr_repo}#${latest.pr_number}` : null,
    prState: latest.pr_state,
    prChecks: latest.pr_checks,
    prReview: latest.pr_review,
    prBaseBranch: latest.pr_base_branch,
    gate: state.stage === "encode_failed" ? ENCODE_GATE_LABELS[encodeGate(latest)] : null,
    oracle: oracleLabel(latest),
    testsRunUrl: latest.tests_run_url ?? null,
    reason: itemReason(state),
    detail: itemDetail(state),
  };
}

/** The whole pipeline, trimmed to what /ops renders. */
export function pipelineView(
  attempts: PipelineAttempt[],
  referenceMs: number
): PipelineView {
  const summary = summarizePipeline(attempts, referenceMs);
  const stages = Object.fromEntries(
    ALL_STAGES.map((stage) => {
      const s = summary.stages[stage];
      return [
        stage,
        {
          count: s.count,
          stuck: s.stuck,
          oldestSince: s.oldestSince,
          items: s.citations
            .slice(0, VIEW_ITEMS_PER_STAGE)
            .map((state) => pipelineItem(state, referenceMs)),
        },
      ];
    })
  ) as Record<PipelineStage, PipelineStageView>;
  const compileTimes = attempts
    .map((a) => a.compile_checked_at)
    .filter((value): value is string => value !== null)
    .sort();
  return {
    collectedAt: summary.collectedAt,
    compileCheckedAt: compileTimes.at(-1) ?? null,
    firstDispatchAt: summary.firstDispatchAt,
    dispatchCount: summary.dispatchCount,
    citationCount: summary.citationCount,
    sources: summary.sources,
    stages,
    duplicatePrs: summary.duplicatePrs,
    failures: summary.failures.map((group) => ({
      key: group.key,
      label: group.label,
      kind: group.kind,
      count: group.count,
      latestAt: group.latestAt,
      items: group.citations
        .slice(0, VIEW_ITEMS_PER_FAILURE)
        .map((state) => pipelineItem(state, referenceMs)),
    })),
    gates: groupView(summary.gates, referenceMs),
    holds: groupView(summary.holds, referenceMs),
    recentFailureRate: summary.recentFailureRate,
    weekly: summary.weekly,
    approval: approvalSummary(attempts, referenceMs),
  };
}

function groupView(groups: CitationGroup[], referenceMs: number): PipelineGroupView[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    count: group.count,
    items: group.citations
      .slice(0, VIEW_ITEMS_PER_FAILURE)
      .map((state) => pipelineItem(state, referenceMs)),
  }));
}

/** The stage with the most stuck citations: where to look first. */
export function bottleneckStage(view: PipelineView): PipelineStage | null {
  let best: PipelineStage | null = null;
  for (const stage of ALL_STAGES) {
    const stuck = view.stages[stage].stuck;
    if (stuck > 0 && (!best || stuck > view.stages[best].stuck)) best = stage;
  }
  return best;
}

/**
 * A compact age: 12m, 5h, 3d, 7w. Whole units only, rounded down, as the
 * page's "ago" times and durations are, so an age and a duration side by
 * side never disagree by a rounding.
 */
export function ageLabel(since: string | null, referenceMs: number): string | null {
  if (!since) return null;
  const minutes = Math.max(0, referenceMs - Date.parse(since)) / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.floor(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 14) return `${Math.floor(days)}d`;
  return `${Math.floor(days / 7)}w`;
}

/** A compact duration: 45m, 3h 12m, 4d, in whole units rounded down. */
export function durationLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** How long a run waited and who dispatched it, for a cancelled run. */
export function cancellationDetail(attempt: PipelineAttempt): string | null {
  if (attempt.run_conclusion !== "cancelled" && attempt.run_conclusion !== "timed_out") {
    return null;
  }
  const parts: string[] = [];
  if (attempt.finished_at) {
    const ran = Date.parse(attempt.finished_at) - Date.parse(attempt.dispatched_at);
    parts.push(
      attempt.cancel_stage === "approval"
        ? `waited ${durationLabel(ran)} for signing approval`
        : `ran ${durationLabel(ran)}`
    );
  }
  if (attempt.dispatched_by) parts.push(`dispatched by ${attempt.dispatched_by}`);
  return parts.length ? capitalize(parts.join(" · ")) : null;
}

export interface ApprovalSummary {
  /** Runs waiting for the production-signing approval now. */
  waitingNow: number;
  oldestWaitingSince: string | null;
  /** Runs dispatched in the last APPROVAL_WINDOW_DAYS whose encode job started. */
  approved: { count: number; medianMs: number | null; p90Ms: number | null };
  /** Every cancelled or timed-out dispatch, by how far it got. */
  cancellations: Array<{ key: string; label: string; count: number }>;
  cancelledWhileWaiting: { count: number; overAnHour: number; medianMs: number | null };
}

const APPROVAL_WINDOW_DAYS = 14;

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** The signing-approval gate across every dispatch, not just each citation's latest (other rows never wait at it). */
export function approvalSummary(
  rows: PipelineAttempt[],
  referenceMs: number
): ApprovalSummary {
  const attempts = rows.filter(isDispatch);
  const since = referenceMs - APPROVAL_WINDOW_DAYS * DAY_MS;
  const waiting = attempts.filter((a) => a.run_status === "waiting");
  const waits = attempts
    .filter((a) => a.encode_started_at && Date.parse(a.dispatched_at) >= since)
    .map((a) => Date.parse(a.encode_started_at!) - Date.parse(a.dispatched_at))
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);
  const cancelled = attempts.filter(
    (a) => a.run_conclusion === "cancelled" || a.run_conclusion === "timed_out"
  );
  const counts = new Map<string, { key: string; label: string; count: number }>();
  for (const attempt of cancelled) {
    const reason = failureReason(attempt);
    const entry = counts.get(reason.key) ?? { key: reason.key, label: reason.label, count: 0 };
    entry.count += 1;
    counts.set(reason.key, entry);
  }
  const waitedThenCancelled = cancelled
    .filter((a) => a.cancel_stage === "approval" && a.finished_at)
    .map((a) => Date.parse(a.finished_at!) - Date.parse(a.dispatched_at))
    .sort((a, b) => a - b);
  return {
    waitingNow: waiting.length,
    oldestWaitingSince: waiting.map((a) => a.dispatched_at).sort()[0] ?? null,
    approved: {
      count: waits.length,
      medianMs: quantile(waits, 0.5),
      p90Ms: quantile(waits, 0.9),
    },
    cancellations: [...counts.values()].sort((a, b) => b.count - a.count),
    cancelledWhileWaiting: {
      count: waitedThenCancelled.length,
      overAnHour: waitedThenCancelled.filter((ms) => ms > HOUR_MS).length,
      medianMs: quantile(waitedThenCancelled, 0.5),
    },
  };
}

export function journeyHref(citation: string): string {
  return `/ops/journey?citation=${encodeURIComponent(citation)}`;
}
