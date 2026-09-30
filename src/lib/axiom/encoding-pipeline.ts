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
}

/** Where one attempt sits. Main-line stages first, then the ways out. */
export type PipelineStage =
  | "encoding"
  | "review"
  | "awaiting_sync"
  | "indexed"
  | "runs"
  | "encode_failed"
  | "no_pr"
  | "closed"
  | "merged_off_main"
  | "not_indexed"
  | "compile_failed";

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
      "Signed manifest PRs waiting for review and merge. Stuck after 3 days.",
  },
  awaiting_sync: {
    label: "Merged",
    description:
      "Merged into the default branch; the next index sync picks them up. Stuck after 8 hours.",
  },
  indexed: {
    label: "In the index",
    description:
      "In the index; the nightly compile sweep has not checked this version yet.",
  },
  runs: {
    label: "Runs",
    description: "The compile sweep compiles and runs every merged module.",
  },
  encode_failed: {
    label: "Last encode failed",
    description:
      "The citation's most recent dispatch failed, grouped by the first validator rule or failed step.",
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
    description: "The nightly compile sweep fails on a merged module.",
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
    if (attempt.compile_status === "ok") return "runs";
    if (attempt.compile_status && FAILED_COMPILE_STATUSES.has(attempt.compile_status)) {
      return "compile_failed";
    }
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
  }
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long an item can sit in a waiting stage before it counts as stuck.
 * Exits (a failed encode, a closed PR, ...) are stuck by definition; "runs"
 * is the finish line.
 */
export const STUCK_AFTER_MS: Partial<Record<PipelineStage, number>> = {
  encoding: 3 * HOUR_MS,
  review: 3 * DAY_MS,
  // The index syncs every 6 hours, and the collector triggers one after a merge.
  awaiting_sync: 8 * HOUR_MS,
  // The compile sweep runs nightly.
  indexed: 36 * HOUR_MS,
};

const EXIT_STAGES = new Set<PipelineStage>([
  "encode_failed",
  "no_pr",
  "closed",
  "merged_off_main",
  "not_indexed",
  "compile_failed",
]);

export function isExitStage(stage: PipelineStage): boolean {
  return EXIT_STAGES.has(stage);
}

/**
 * Whether a citation's latest dispatch is stuck. A module the compile sweep
 * does not check (a composition, or a merge that changed no module) has
 * nothing left to wait for, so it never counts as stuck in the index.
 */
export function citationIsStuck(state: CitationState, referenceMs: number): boolean {
  if (state.stage === "indexed" && state.latest.compile_status === "skipped") return false;
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

export function failureReason(attempt: PipelineAttempt): FailureReason {
  if (attempt.encoder_error_rule) {
    return {
      key: `rule:${attempt.encoder_error_rule}`,
      label: attempt.encoder_error_rule,
      kind: "validator",
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
  if (attempt.run_conclusion === "cancelled") {
    return { key: "run:cancelled", label: "Cancelled", kind: "run" };
  }
  if (attempt.run_conclusion === "timed_out") {
    return { key: "run:timed_out", label: "Timed out", kind: "run" };
  }
  return { key: "run:unknown", label: "No failure detail recorded", kind: "run" };
}

export interface StageSummary {
  stage: PipelineStage;
  /** Citations whose latest dispatch sits here. */
  count: number;
  stuck: number;
  oldestSince: string | null;
  citations: CitationState[];
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
  "encode_failed",
  "no_pr",
  "closed",
  "merged_off_main",
  "not_indexed",
  "compile_failed",
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
  key: "dispatched" | "encoded" | "pr" | "merged" | "indexed" | "compiled";
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
        ? [reason?.label, attempt.encoder_error].filter(Boolean).join(" — ")
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
        : [
            attempt.pr_state === "draft" ? "Draft" : capitalize(attempt.pr_state),
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
      state: attempt.compile_status === "ok"
        ? "done"
        : attempt.compile_status && FAILED_COMPILE_STATUSES.has(attempt.compile_status)
          ? "failed"
          : stage === "indexed"
            ? "active"
            : "pending",
      detail: attempt.compile_error ??
        (attempt.compile_status === "skipped"
          ? attempt.module_paths.length === 0
            ? "No module changed"
            : "Not checked (composition)"
          : null),
      href: null,
    },
  ];
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
  /** Why it stopped, in a few words (failure group, compile status, ...). */
  reason: string | null;
  /** The first validator issue, apply error, or compile error. */
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
  recentFailureRate: PipelineSummary["recentFailureRate"];
  weekly: WeeklyThroughput[];
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

function itemDetail(state: CitationState): string | null {
  const latest = state.latest;
  if (state.stage === "compile_failed") return latest.compile_error;
  if (state.stage === "encode_failed") return latest.encoder_error;
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
    recentFailureRate: summary.recentFailureRate,
    weekly: summary.weekly,
  };
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

export function journeyHref(citation: string): string {
  return `/ops/journey?citation=${encodeURIComponent(citation)}`;
}
