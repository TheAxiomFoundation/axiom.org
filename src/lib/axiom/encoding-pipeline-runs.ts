/**
 * The /ops pipeline per dispatch rather than per citation: one row for each
 * targeted encode run with its full provenance, and how all runs flow
 * through the gates between dispatch and tests passing on main.
 */

import {
  ENCODE_GATE_LABELS,
  encodeGate,
  failureReason,
  type PipelineAttempt,
} from "./encoding-pipeline";
import { attemptJurisdiction } from "./encoding-pipeline-insights";

export type RunOutcome = "encoded" | "failed" | "cancelled" | "running" | "waiting";

/** One dispatch and everything recorded about it. */
export interface RunRow {
  id: string;
  citation: string;
  jurisdiction: string;
  dispatchedAt: string;
  by: string | null;
  /** The axiom-encode package version the run used. */
  encoder: string | null;
  /** How long the run waited for the signing approval, when known. */
  approvalMs: number | null;
  /** From the approval (or the dispatch) to the run's end. */
  runMs: number | null;
  /** The encode job's parts: setup, the encode step, and publishing after it. */
  phases: { setupMs: number | null; encodeMs: number | null; publishMs: number | null };
  /** Generation attempts the encoder made, when its record says. */
  attempts: number | null;
  outcome: RunOutcome;
  /** In a few words: "Encoded", "Validation rules", "Cancelled at approval". */
  outcomeLabel: string;
  /** For a failure, what stopped it: the validator rule, step, or error. */
  cause: string | null;
  runUrl: string;
  pr: {
    label: string;
    url: string;
    state: "draft" | "open" | "merged" | "closed";
    /** What the PR's first failing check printed, if it fails. */
    error: string | null;
    openedAt: string | null;
    mergedAt: string | null;
    closedAt: string | null;
  } | null;
  merged: "main" | "off main" | null;
  index: "indexed" | "missing" | "awaiting" | null;
  tests: "pass" | "fail" | "waived" | null;
  testsUrl: string | null;
  /** When the first index sync after the merge finished. */
  indexedAt: string | null;
  /** When the module's validation first finished at the merge commit on main. */
  testsAt: string | null;
}

const CANCEL_OUTCOMES: Record<string, string> = {
  approval: "Cancelled at approval",
  before_job: "Cancelled before the run",
  running: "Cancelled mid-run",
};

function outcomeOf(attempt: PipelineAttempt): Pick<RunRow, "outcome" | "outcomeLabel" | "cause"> {
  if (attempt.run_status === "waiting") {
    return { outcome: "waiting", outcomeLabel: "Waiting for approval", cause: null };
  }
  if (attempt.run_status !== "completed") {
    return { outcome: "running", outcomeLabel: "Running", cause: null };
  }
  if (attempt.run_conclusion === "success") {
    return { outcome: "encoded", outcomeLabel: "Encoded", cause: null };
  }
  if (attempt.run_conclusion === "cancelled") {
    const label = (attempt.cancel_stage && CANCEL_OUTCOMES[attempt.cancel_stage]) ?? "Cancelled";
    return { outcome: "cancelled", outcomeLabel: label, cause: null };
  }
  if (attempt.run_conclusion === "timed_out") {
    return { outcome: "cancelled", outcomeLabel: "Timed out", cause: null };
  }
  const reason = failureReason(attempt);
  return {
    outcome: "failed",
    outcomeLabel: ENCODE_GATE_LABELS[encodeGate(attempt)],
    cause: reason.kind === "run" ? null : clip(reason.label),
  };
}

/** Long causes and check errors are cut here; the run and the PR hold the rest. */
const TEXT_MAX = 180;
const clip = (text: string | null) =>
  text && text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text;

const ms = (from: string | null | undefined, to: string | null | undefined) =>
  from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;

const secondsMs = (value: number | null | undefined) => (value == null ? null : value * 1000);

export function runRow(attempt: PipelineAttempt): RunRow {
  const merged =
    attempt.pr_state === "merged" ? (attempt.pr_targets_default === false ? "off main" : "main") : null;
  return {
    id: attempt.id,
    citation: attempt.citation,
    jurisdiction: attemptJurisdiction(attempt),
    dispatchedAt: attempt.dispatched_at,
    by: attempt.dispatched_by ?? null,
    encoder: attempt.encoder_version ?? null,
    approvalMs: ms(attempt.dispatched_at, attempt.encode_started_at),
    runMs: ms(attempt.encode_started_at ?? attempt.started_at, attempt.finished_at),
    phases: {
      setupMs: secondsMs(attempt.setup_seconds),
      encodeMs: secondsMs(attempt.encode_seconds),
      publishMs: secondsMs(attempt.publish_seconds),
    },
    attempts: attempt.generation_attempts,
    ...outcomeOf(attempt),
    runUrl: attempt.run_url,
    pr:
      attempt.pr_url && attempt.pr_state
        ? {
            label: attempt.pr_repo && attempt.pr_number ? `${attempt.pr_repo}#${attempt.pr_number}` : "PR",
            url: attempt.pr_url,
            state: attempt.pr_state,
            error: clip(attempt.pr_check_error ?? null),
            openedAt: attempt.pr_created_at,
            mergedAt: attempt.pr_merged_at,
            closedAt: attempt.pr_closed_at,
          }
        : null,
    merged,
    index:
      merged === "main"
        ? attempt.index_status === "missing"
          ? "missing"
          : attempt.synced_at
            ? "indexed"
            : "awaiting"
        : null,
    tests: attempt.tests_status ?? null,
    testsUrl: attempt.tests_run_url ?? null,
    indexedAt: merged === "main" ? (attempt.indexed_at ?? null) : null,
    testsAt: merged === "main" ? (attempt.tests_first_at ?? null) : null,
  };
}

/** Every dispatch, newest first. */
export function runRows(attempts: PipelineAttempt[]): RunRow[] {
  return attempts
    .map(runRow)
    .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt) || b.id.localeCompare(a.id));
}

/** Where the runs at one gate went: on to the next gate, out, or not yet. */
export interface FlowSegment {
  key: string;
  label: string;
  kind: "continue" | "loss" | "pending";
  count: number;
  ids: string[];
}

export interface FlowGate {
  key: GateKey;
  label: string;
  /** Runs that reached this gate. */
  input: number;
  segments: FlowSegment[];
}

/** The gates in order, and what each is called on the page. */
export const GATE_LABELS = {
  approval: "Signing approval",
  run: "Encode run",
  pr: "Pull request",
  review: "Review",
  main: "Default branch",
  index: "Index",
  tests: "Tests on main",
} as const;

export type GateKey = keyof typeof GATE_LABELS;

function gate(
  key: GateKey,
  input: RunRow[],
  parts: Array<{ key: string; label: string; kind: FlowSegment["kind"]; test: (row: RunRow) => boolean }>
): { gate: FlowGate; next: RunRow[] } {
  const segments = parts
    .map(({ key: part, label: partLabel, kind, test }) => {
      const rows = input.filter(test);
      return { key: `${key}:${part}`, label: partLabel, kind, count: rows.length, ids: rows.map((r) => r.id) };
    })
    .filter((segment) => segment.count > 0);
  const onward = new Set(segments.filter((s) => s.kind === "continue").flatMap((s) => s.ids));
  return {
    gate: { key, label: GATE_LABELS[key], input: input.length, segments },
    next: input.filter((row) => onward.has(row.id)),
  };
}

/**
 * How every dispatch moved through the gates, in order: the signing
 * approval, the encode run, the PR, review, the default branch, the index,
 * and the jurisdiction's tests on main. Each gate counts only the runs that
 * passed the one before it.
 */
export function dispatchFlow(rows: RunRow[]): FlowGate[] {
  const gates: FlowGate[] = [];
  let input = rows;
  const add = (...args: Parameters<typeof gate>) => {
    const { gate: result, next } = gate(...args);
    gates.push(result);
    input = next;
  };
  add("approval", input, [
    {
      key: "approved",
      label: "Approved",
      kind: "continue",
      test: (r) => r.outcome !== "waiting" && r.outcomeLabel !== "Cancelled at approval",
    },
    { key: "waiting", label: "Waiting", kind: "pending", test: (r) => r.outcome === "waiting" },
    { key: "cancelled", label: "Cancelled at approval", kind: "loss", test: (r) => r.outcomeLabel === "Cancelled at approval" },
  ]);
  // Failures by the step that stopped them, largest first.
  const failedAt = new Map<string, number>();
  for (const row of input) {
    if (row.outcome === "failed") failedAt.set(row.outcomeLabel, (failedAt.get(row.outcomeLabel) ?? 0) + 1);
  }
  add("run", input, [
    { key: "encoded", label: "Encoded", kind: "continue", test: (r) => r.outcome === "encoded" },
    { key: "running", label: "Running", kind: "pending", test: (r) => r.outcome === "running" },
    ...[...failedAt]
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => ({
        key: `failed:${label}`,
        label,
        kind: "loss" as const,
        test: (r: RunRow) => r.outcome === "failed" && r.outcomeLabel === label,
      })),
    { key: "cancelled", label: "Cancelled or timed out", kind: "loss", test: (r) => r.outcome === "cancelled" },
  ]);
  add("pr", input, [
    { key: "opened", label: "PR opened", kind: "continue", test: (r) => r.pr !== null },
    { key: "none", label: "No PR", kind: "loss", test: (r) => r.pr === null },
  ]);
  add("review", input, [
    { key: "merged", label: "Merged", kind: "continue", test: (r) => r.pr?.state === "merged" },
    { key: "open", label: "In review", kind: "pending", test: (r) => r.pr?.state === "draft" || r.pr?.state === "open" },
    { key: "closed", label: "Closed", kind: "loss", test: (r) => r.pr?.state === "closed" },
  ]);
  add("main", input, [
    { key: "main", label: "Into main", kind: "continue", test: (r) => r.merged === "main" },
    { key: "off", label: "Off main", kind: "loss", test: (r) => r.merged === "off main" },
  ]);
  add("index", input, [
    { key: "indexed", label: "Indexed", kind: "continue", test: (r) => r.index === "indexed" },
    { key: "awaiting", label: "Awaiting the index", kind: "pending", test: (r) => r.index === "awaiting" },
    { key: "missing", label: "Missing from the index", kind: "loss", test: (r) => r.index === "missing" },
  ]);
  add("tests", input, [
    { key: "pass", label: "Tests pass", kind: "continue", test: (r) => r.tests === "pass" },
    { key: "pending", label: "No result yet", kind: "pending", test: (r) => r.tests === null || r.tests === "waived" },
    { key: "fail", label: "Tests fail", kind: "loss", test: (r) => r.tests === "fail" },
  ]);
  return gates;
}

/** How long runs spent at one step: the median, and the slowest tenth when there are enough runs. */
export interface StepTiming {
  /** Which runs: "Encoded", "Merged"; empty when the step's runs are not split. */
  label: string;
  runs: number;
  medianMs: number;
  /** What the slowest 10% of runs took at least; null below TAIL_MIN_RUNS runs. */
  slowMs: number | null;
}

/** One timed part of the path: a gate, or a part of the encode run. */
export interface TimedStep {
  key: string;
  label: string;
  /** What is timed, in a few words: "dispatch → job start". */
  span: string;
  /** What is timed, from when to when, or why a step is not timed. */
  measures: string;
  /** Why a step has no times: it takes none, or the data cannot time it yet. */
  untimed: "No wait" | "Not timed yet" | null;
  timings: StepTiming[];
}

export interface StepTimes extends TimedStep {
  key: GateKey;
}

const TAIL_MIN_RUNS = 10;

function timing(label: string, values: Array<number | null>): StepTiming | null {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return {
    label,
    runs: sorted.length,
    medianMs: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    slowMs: sorted.length >= TAIL_MIN_RUNS ? sorted[Math.ceil(sorted.length * 0.9) - 1] : null,
  };
}

/**
 * How long each gate takes, in the flow's order. The index and the tests on
 * main are timed only for merges whose first sync and first validation the
 * collector recorded (from the 2026-10-05 step-times migration on).
 */
export function stepTimes(rows: RunRow[], referenceMs: number): StepTimes[] {
  const timed = (key: GateKey, span: string, measures: string, ...timings: Array<StepTiming | null>): StepTimes => ({
    key,
    label: GATE_LABELS[key],
    span,
    measures,
    untimed: null,
    timings: timings.filter((t): t is StepTiming => t !== null),
  });
  const untimed = (key: GateKey, span: string, why: NonNullable<StepTimes["untimed"]>, measures: string): StepTimes => ({
    key,
    label: GATE_LABELS[key],
    span,
    measures,
    untimed: why,
    timings: [],
  });
  // Only runs whose job start is known: before it was recorded, a run's time
  // counted from the workflow's start and so held the approval wait too.
  const jobTimed = rows.filter((row) => row.approvalMs !== null);
  const withPr = rows.filter((row) => row.pr?.openedAt);
  const prMs = (row: RunRow, end: string | null | undefined) => ms(row.pr?.openedAt, end);
  const now = new Date(referenceMs).toISOString();
  // Times from the merge, over merges into main whose time is recorded.
  const afterMerge = (key: GateKey, span: string, measures: string, none: string, end: (row: RunRow) => string | null) => {
    const time = timing("", rows.filter((row) => row.merged === "main").map((row) => ms(row.pr?.mergedAt, end(row))));
    return time ? timed(key, span, measures, time) : untimed(key, span, "Not timed yet", none);
  };
  return [
    timed(
      "approval",
      "dispatch → job start",
      "From the dispatch until a person approves the signing and the encode job starts.",
      timing("Wait", rows.map((row) => row.approvalMs))
    ),
    timed(
      "run",
      "job start → job end",
      "From the start of the encode job until it ends: setup, the encode and repair loop, signing, the PR.",
      timing("Encoded", jobTimed.filter((row) => row.outcome === "encoded").map((row) => row.runMs)),
      timing("Failed", jobTimed.filter((row) => row.outcome === "failed").map((row) => row.runMs))
    ),
    untimed("pr", "opened by the run", "No wait", "The encode run opens the draft PR before it ends."),
    timed(
      "review",
      "PR opened → merged or closed",
      "From the PR's opening until it merges or closes; PRs still open, until now.",
      timing("Merged", withPr.filter((row) => row.pr?.state === "merged").map((row) => prMs(row, row.pr?.mergedAt))),
      timing("Closed", withPr.filter((row) => row.pr?.state === "closed").map((row) => prMs(row, row.pr?.closedAt))),
      timing(
        "Open now",
        withPr.filter((row) => row.pr?.state === "draft" || row.pr?.state === "open").map((row) => prMs(row, now))
      )
    ),
    untimed("main", "set at the merge", "No wait", "The PR's base branch decides it at the merge."),
    afterMerge(
      "index",
      "merge → index sync",
      "From the merge until the first index sync after it finishes.",
      "No merge into main has its first index sync recorded yet.",
      (row) => row.indexedAt
    ),
    afterMerge(
      "tests",
      "merge → first tests on main",
      "From the merge until the module's validation first finishes at the merge commit on main.",
      "No merge into main has its first validation on main recorded yet.",
      (row) => row.testsAt
    ),
  ];
}

/** Generation attempts used, by count: how many runs needed one try, two, and so on. */
export interface TriesUsed {
  /** 1, 2, 3, ... up to the most any run used. */
  tries: number[];
  encoded: number[];
  failed: number[];
  /** Encoded and failed runs whose encoder record gives a count, and all of them. */
  recorded: number;
  finished: number;
}

/** Inside the encode run: its three parts, and how many tries the encode loop took. */
export interface EncodeParts {
  parts: TimedStep[];
  tries: TriesUsed;
}

export function encodeParts(rows: RunRow[]): EncodeParts {
  const finished = rows.filter((row) => row.outcome === "encoded" || row.outcome === "failed");
  // Setup is timed over runs that got past it, so a run stopped in setup does not shorten it.
  const pastSetup = finished.filter((row) => row.phases.encodeMs !== null);
  const part = (key: string, label: string, span: string, measures: string, ...timings: Array<StepTiming | null>): TimedStep => {
    const kept = timings.filter((t): t is StepTiming => t !== null);
    return { key, label, span, measures, untimed: kept.length ? null : "Not timed yet", timings: kept };
  };
  const parts = [
    part(
      "setup",
      "Setup",
      "checkouts, builds, input checks",
      "From the encode job's first step until the encode step starts: check out the repos, build the engine, verify and fetch the signed inputs.",
      timing("", pastSetup.map((row) => row.phases.setupMs))
    ),
    part(
      "encode",
      "Encode loop",
      "write, validate, repair, review",
      "The \"Encode, review, validate, and apply\" step: the model writes a candidate, the compile and completeness checks run, and failed checks go back as repair prompts, up to four tries, before a review.",
      timing("Encoded", finished.filter((row) => row.outcome === "encoded").map((row) => row.phases.encodeMs)),
      timing("Failed", finished.filter((row) => row.outcome === "failed").map((row) => row.phases.encodeMs))
    ),
    part(
      "publish",
      "Sign and open the PR",
      "package, sign, push, draft PR",
      "From the end of the encode step until the draft PR is open: verify provenance, package and sign the changes, push the branch.",
      timing("", finished.filter((row) => row.outcome === "encoded").map((row) => row.phases.publishMs))
    ),
  ];
  const counted = finished.filter((row) => row.attempts !== null && row.attempts > 0);
  const most = counted.reduce((max, row) => Math.max(max, row.attempts!), 0);
  const tries = Array.from({ length: most }, (_, i) => i + 1);
  const histogram = (outcome: RunOutcome) =>
    tries.map((n) => counted.filter((row) => row.outcome === outcome && row.attempts === n).length);
  return {
    parts,
    tries: {
      tries,
      encoded: histogram("encoded"),
      failed: histogram("failed"),
      recorded: counted.length,
      finished: finished.length,
    },
  };
}
