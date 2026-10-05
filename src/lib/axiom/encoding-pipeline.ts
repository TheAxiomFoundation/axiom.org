/**
 * The encoding pipeline, end to end: every targeted re-encode dispatch
 * followed from the fleet to a rule that compiles and runs.
 *
 * Rows come from encodings.pipeline_attempts, rebuilt on a schedule by
 * scripts/collect-encoding-pipeline.mjs. Everything here is a pure
 * derivation over those rows, so a new stage rule never needs a backfill.
 */

/** One targeted re-encode dispatch and every stage it has reached. */
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
  /** When the module's validation shard finished at the merge commit on main. */
  tests_first_at?: string | null;
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
      "The citation's most recent dispatch failed, by the step that stopped it and the first validator rule.",
  },
  no_pr: {
    label: "Encoded, no PR",
    description: "Runs that finished without opening a PR.",
  },
  closed: {
    label: "PR closed unmerged",
    description: "Signed manifest PRs closed without merging.",
  },
  merged_off_main: {
    label: "Merged off main",
    description:
      "Merged into a branch other than the repo's default, so they never reach the index.",
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

export function attemptStage(attempt: PipelineAttempt): PipelineStage {
  if (attempt.pr_state === "merged") {
    if (attempt.pr_targets_default === false) return "merged_off_main";
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
    case "awaiting_sync":
    case "not_indexed":
      return attempt.pr_merged_at;
    case "indexed":
    case "runs":
      return attempt.synced_at;
    case "compile_failed":
      return attempt.compile_checked_at ?? attempt.synced_at;
    case "verified":
    case "tests_failing":
      return attempt.tests_checked_at ?? attempt.synced_at;
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

/** A citation's current place: its latest dispatch, plus what came before. */
export interface CitationState {
  citation: string;
  jurisdiction: string | null;
  latest: PipelineAttempt;
  stage: PipelineStage;
  since: string | null;
  dispatches: number;
  /** Open or draft PRs across every dispatch of the citation. */
  openPrs: number;
  /** Whether any dispatch of the citation reached the index. */
  reachedIndex: boolean;
}

export function citationStates(attempts: PipelineAttempt[]): CitationState[] {
  const byCitation = new Map<string, PipelineAttempt[]>();
  for (const attempt of attempts) {
    const list = byCitation.get(attempt.citation) ?? [];
    list.push(attempt);
    byCitation.set(attempt.citation, list);
  }
  return [...byCitation.entries()].map(([citation, list]) => {
    const sorted = [...list].sort(byDispatchedDesc);
    const latest = sorted[0];
    const stage = attemptStage(latest);
    return {
      citation,
      jurisdiction: latest.jurisdiction,
      latest,
      stage,
      since: stageSince(latest, stage),
      dispatches: list.length,
      openPrs: list.filter((a) => a.pr_state === "draft" || a.pr_state === "open")
        .length,
      reachedIndex: list.some((a) => a.synced_at !== null),
    };
  });
}

function byDispatchedDesc(a: PipelineAttempt, b: PipelineAttempt): number {
  return Date.parse(b.dispatched_at) - Date.parse(a.dispatched_at);
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

/**
 * An error as the group runs failing the same way share: without the module
 * file it was raised for, the exception's module path, quoted or backticked
 * values (citations, rule and test names, paths), or numbers.
 */
export function errorGroupLabel(error: string): string {
  return checkErrorLabel(
    error
      .replace(/^\S+\.ya?ml:\s*/, "")
      .replace(/^(?:[a-z_][\w]*\.)+(?=[A-Z]\w*(?:Error|Exception|Exit)\b)/, "")
      .replace(/`[^`]*`|'[^']*'|"[^"]*"/g, "…")
      // Before checkErrorLabel, so a long number is not taken for a hash.
      .replace(/\b\d+(?:\.\d+)*\b/g, "N")
  );
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

export const ENCODE_GATE_LABELS: Record<EncodeGate, string> = {
  budget: "Attempt budget used up",
  setup: "Setup",
  generate: "Generate",
  compile: "Compile",
  validate: "Validation rules",
  review: "Review",
  sign: "Sign and package",
  publish: "Open the PR",
  encode: "Inside the encode step (no detail)",
  cancelled: "Cancelled or timed out",
  pending: "Cause not looked up yet",
  unknown: "No detail recorded",
};

/** The validator's issue prefix: "<file>.yaml: <check>: ...". */
const ERROR_CHECK_RE = /^\S+?\.ya?ml:\s*([a-z_-]+):/;
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
  [/repair[ _]candidate|checkout identities|corpus release|signing supervisor|compose runtime|routing|existing signed imports/i, "setup"],
  [/package|provenance|commit[ _]reviewed/i, "sign"],
  [/pull request|publish_lane|push lane/i, "publish"],
  [/encode_apply|encode, review, validate, and apply/i, "encode"],
];

export function encodeGate(attempt: PipelineAttempt): EncodeGate {
  if (attempt.run_conclusion === "cancelled" || attempt.run_conclusion === "timed_out") {
    return "cancelled";
  }
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
  dispatched: number;
  encoded: number;
  merged: number;
}

export interface PipelineSummary {
  collectedAt: string | null;
  firstDispatchAt: string | null;
  dispatchCount: number;
  citationCount: number;
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
  recentFailureRate: { failed: number; finished: number } | null;
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
  const failureGroups = new Map<string, FailureGroup>();
  for (const state of states) {
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

  const dispatchTimes = attempts.map((a) => a.dispatched_at).sort();
  const collectedTimes = attempts.map((a) => a.collected_at).sort();

  return {
    collectedAt: collectedTimes.at(-1) ?? null,
    firstDispatchAt: dispatchTimes[0] ?? null,
    dispatchCount: attempts.length,
    citationCount: states.length,
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
    recentFailureRate: recentFailureRate(attempts, referenceMs),
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
  for (const attempt of attempts) {
    if (attempt.run_status !== "completed" || !attempt.finished_at) continue;
    if (Date.parse(attempt.finished_at) < since) continue;
    if (attempt.run_conclusion === "skipped") continue;
    finished += 1;
    if (attempt.run_conclusion !== "success") failed += 1;
  }
  return finished > 0 ? { failed, finished } : null;
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
    };
    rows.push(row);
    index.set(start, row);
  }
  const bump = (value: string | null, key: keyof Omit<WeeklyThroughput, "weekStart">) => {
    if (!value) return;
    const row = index.get(weekStartUtc(Date.parse(value)));
    if (row) row[key] += 1;
  };
  for (const attempt of attempts) {
    bump(attempt.dispatched_at, "dispatched");
    if (attempt.run_conclusion === "success") bump(attempt.finished_at, "encoded");
    if (attempt.pr_state === "merged" && attempt.pr_targets_default !== false) {
      bump(attempt.pr_merged_at, "merged");
    }
  }
  return rows;
}

/** A citation's every dispatch, newest first, for the journey view. */
export function citationJourney(
  attempts: PipelineAttempt[],
  citation: string
): PipelineAttempt[] {
  return attempts.filter((a) => a.citation === citation).sort(byDispatchedDesc);
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
      detail: attempt.queue_ref && !attempt.queue_ref.startsWith("adhoc")
        ? `Queue ${attempt.queue_ref}`
        : "Ad hoc dispatch",
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
        ? [
            `${ENCODE_GATE_LABELS[encodeGate(attempt)]}: ${reason?.label}`,
            attempt.encoder_error ?? cancellationDetail(attempt),
          ]
            .filter(Boolean)
            .join(" — ")
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
      state: merged
        ? attempt.pr_targets_default === false
          ? "failed"
          : "done"
        : "pending",
      detail: merged && attempt.pr_base_branch
        ? attempt.pr_targets_default === false
          ? `Into ${attempt.pr_base_branch}, not the default branch`
          : `Into ${attempt.pr_base_branch}`
        : null,
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
      href: attempt.oracle_report
        ? `https://github.com/TheAxiomFoundation/axiom-oracles/blob/main/dashboard/public/data/${attempt.oracle_report}`
        : null,
    },
  ];
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
    case "merged_off_main":
      return latest.pr_base_branch ? `Merged into ${latest.pr_base_branch}` : null;
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

/** A compact age: 12m, 5h, 3d, 7w. */
export function ageLabel(since: string | null, referenceMs: number): string | null {
  if (!since) return null;
  const minutes = Math.max(0, referenceMs - Date.parse(since)) / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 14) return `${Math.round(days)}d`;
  return `${Math.round(days / 7)}w`;
}

/** A compact duration: 45m, 3h 12m, 4d. */
export function durationLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.round(hours / 24)}d`;
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

/** The signing-approval gate across every dispatch, not just each citation's latest. */
export function approvalSummary(
  attempts: PipelineAttempt[],
  referenceMs: number
): ApprovalSummary {
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
