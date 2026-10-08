/**
 * The /ops pipeline per dispatch rather than per citation: one row for each
 * targeted encode run with its full provenance, and how all runs flow
 * through the gates between dispatch and tests passing on main.
 */

import {
  durationLabel,
  ENCODE_GATE_LABELS,
  encodeGate,
  failureReason,
  type EncodeLoopTiming,
  type PipelineAttempt,
  type PipelineTry,
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
  /** Each try of the encode loop, when the encoder's record has them. */
  tries: PipelineTry[] | null;
  /** The encode loop's own clock, when the encoder's record has it. */
  loop: EncodeLoopTiming | null;
  outcome: RunOutcome;
  /** In a few words: "Encoded", "Failed validation", "Cancelled at approval". */
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
  /** When that first validation run started, and how it ended. */
  testsStartedAt: string | null;
  testsFirst: "pass" | "fail" | null;
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
    tries: attempt.tries ?? null,
    loop: attempt.encode_loop ?? null,
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
    testsStartedAt: merged === "main" ? (attempt.tests_first_started_at ?? null) : null,
    testsFirst: merged === "main" ? (attempt.tests_first_status ?? null) : null,
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
  main: "Main branch",
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
      timing("", rows.map((row) => row.approvalMs))
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

/** A part of a step, "Not timed yet" until a run records it. */
function timedPart(key: string, label: string, span: string, measures: string, ...timings: Array<StepTiming | null>): TimedStep {
  const kept = timings.filter((t): t is StepTiming => t !== null);
  return { key, label, span, measures, untimed: kept.length ? null : "Not timed yet", timings: kept };
}

/** The model's own time across a run's tries, when the encoder recorded it. */
const modelTime = (row: RunRow) => {
  const timed = (row.tries ?? []).filter((attempt) => attempt.ms !== null);
  return timed.length ? timed.reduce((sum, attempt) => sum + attempt.ms!, 0) : null;
};

/** The check phases' time across a run's tries, when the encoder recorded its phases. */
const checkTime = (row: RunRow) => {
  const phased = (row.tries ?? []).filter((attempt) => attempt.phases);
  if (!phased.length) return null;
  return phased.reduce(
    (sum, attempt) =>
      sum + attempt.phases!.filter((phase) => phaseKind(phase.name) === "checks").reduce((n, phase) => n + phase.ms, 0),
    0
  );
};

export function encodeParts(rows: RunRow[]): EncodeParts {
  const finished = rows.filter((row) => row.outcome === "encoded" || row.outcome === "failed");
  // Setup is timed over runs that got past it, so a run stopped in setup does not shorten it.
  const pastSetup = finished.filter((row) => row.phases.encodeMs !== null);
  const parts = [
    timedPart(
      "setup",
      "Setup",
      "checkouts, builds, input checks",
      "From the encode job's first step until the encode step starts: check out the repos, build the engine, verify and fetch the signed inputs.",
      timing("", pastSetup.map((row) => row.phases.setupMs))
    ),
    timedPart(
      "encode",
      "Encode loop",
      "write, validate, repair, review",
      "The \"Encode, review, validate, and apply\" step: the model writes a candidate, the compile and completeness checks run, and failed checks go back as repair prompts, up to four tries, before a review.",
      timing("Encoded", finished.filter((row) => row.outcome === "encoded").map((row) => row.phases.encodeMs)),
      timing("Failed", finished.filter((row) => row.outcome === "failed").map((row) => row.phases.encodeMs))
    ),
    timedPart(
      "model",
      "Model time",
      "the model writing, all tries",
      "The model's own time across the encode loop's tries, from the encoder's record (runs that have one). The rest of the loop is the checks and the review.",
      timing("Encoded", finished.filter((row) => row.outcome === "encoded").map(modelTime)),
      timing("Failed", finished.filter((row) => row.outcome === "failed").map(modelTime))
    ),
    timedPart(
      "checks",
      "Check time",
      "compile, tests, completeness, all tries",
      "The encoder's check phases across the encode loop's tries: the candidate's compile, static checks, test cases, and source completeness, and the validation of the modules that depend on it. Recorded by axiom-encode 0.2.2138 and later.",
      timing("Encoded", finished.filter((row) => row.outcome === "encoded").map(checkTime)),
      timing("Failed", finished.filter((row) => row.outcome === "failed").map(checkTime))
    ),
    timedPart(
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

/** Inside the tests on main: the wait for the shard, its run, and how the first one ended. */
export interface TestsParts {
  parts: TimedStep[];
  /** The first validation at each merge commit: how many passed and failed. */
  first: { pass: number; fail: number };
}

export function testsParts(rows: RunRow[]): TestsParts {
  const merges = rows.filter((row) => row.merged === "main");
  return {
    parts: [
      timedPart(
        "wait",
        "Wait to start",
        "merge → shard starts",
        "From the merge until the jurisdiction's validation shard starts at the merge commit: CI starting and waiting for a runner.",
        timing("", merges.map((row) => ms(row.pr?.mergedAt, row.testsStartedAt)))
      ),
      timedPart(
        "run",
        "Validation run",
        "shard start → end",
        "The validation shard at the merge commit, from start to end. It validates the whole jurisdiction, not only the merged module.",
        timing("", merges.map((row) => ms(row.testsStartedAt, row.testsAt)))
      ),
    ],
    first: {
      pass: merges.filter((row) => row.testsFirst === "pass").length,
      fail: merges.filter((row) => row.testsFirst === "fail").length,
    },
  };
}

/** Seconds under a minute; otherwise as the rest of /ops writes durations. */
export function shortDuration(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : durationLabel(ms);
}

/** One part of the encode run on the run's own clock, from its dispatch. */
export interface TimelineBar {
  key: "approval" | "setup" | "encode" | "publish" | "run";
  label: string;
  startMs: number;
  ms: number;
  state: "done" | "failed" | "cancelled" | "running";
}

/** One step after the PR opened: how long it took from the step before, and how it went. */
export interface TimelineStep {
  key: string;
  label: string;
  /** Null when the step is not timed. */
  ms: number | null;
  state: "done" | "failed" | "waiting";
  detail: string | null;
  href: string | null;
}

/** One try of the encode loop as a timeline shows it: the model, its own time and cost, and what failed it. */
export interface TimelineTry {
  attempt: number;
  model: string | null;
  ms: number | null;
  cost: number | null;
  ok: boolean;
  /** What sent the try back, in a few words; `error` is the full message. */
  headline: string | null;
  error: string | null;
  /** The try's whole time with its checks, when the encoder timed its phases. */
  wallMs: number | null;
  /** Its phases on the timeline's clock (from the dispatch); empty before the encoder timed them. */
  phases: TimelinePhase[];
}

/** What the encoder spends a try's time on: the model, the checks, or the work between them. */
export type PhaseKind = "model" | "checks" | "other";

/** One phase of a try on the timeline's clock. */
export interface TimelinePhase {
  name: string;
  label: string;
  kind: PhaseKind;
  /** For a check phase: whether it checked the candidate itself or the modules that depend on it. */
  part: CheckPart | null;
  startMs: number;
  ms: number;
  /** A check phase's time by tool, longest first. */
  tools: TimelineTool[];
}

export type CheckPart = "candidate" | "dependents";

export interface TimelineTool {
  name: string;
  label: string;
  ms: number;
}

/** Where the encode loop's time went, from the tries' phases: by kind, and around the tries. */
export interface LoopSplit {
  /** Model, checks, and other, in that order, summed over the timed tries; the checks also by part and tool. */
  kinds: Array<{
    kind: PhaseKind;
    label: string;
    ms: number;
    parts: Array<{ part: CheckPart; label: string; ms: number }>;
    tools: TimelineTool[];
  }>;
  /** The loop's time as shares that add up to it: the model, each part of the checks, other, outside the tries. */
  shares: LoopShare[];
  /** The encode step's time outside the tries, when the step was timed and every try has phases. */
  outsideMs: number | null;
  /** That time's parts, when the encoder's loop clock gives them. */
  outside: Array<{ label: string; ms: number }>;
}

/** One share of the encode loop's time, for its stacked bar and legend. */
export interface LoopShare {
  key: string;
  kind: PhaseKind | "outside";
  part: CheckPart | null;
  label: string;
  ms: number;
}

const PHASE_LABELS: Record<string, string> = {
  prepare: "Prepare the try",
  retained_candidate_preflight: "Recheck the kept candidate",
  model_call: "Model writes",
  stage_candidate: "Stage the candidate",
  repair_overlay: "Repair overlay",
  candidate_validation: "Check the candidate",
  review_model_call: "Model reviews",
  artifact_repair: "Repair artifacts",
  record_result: "Record the result",
  apply_repair: "Apply a repair",
  overlay_validation: "Check dependent modules",
  apply_write: "Write the files",
  retry_handoff: "Hand off to the next try",
  other: "Other",
};

const MODEL_PHASES = new Set(["model_call", "review_model_call"]);
const CHECK_PHASES = new Set(["retained_candidate_preflight", "candidate_validation", "overlay_validation"]);

export function phaseKind(name: string): PhaseKind {
  return MODEL_PHASES.has(name) ? "model" : CHECK_PHASES.has(name) ? "checks" : "other";
}

const KIND_LABELS: Record<PhaseKind, string> = { model: "model", checks: "checks", other: "other" };

const CHECK_PARTS: Record<string, CheckPart> = {
  retained_candidate_preflight: "candidate",
  candidate_validation: "candidate",
  overlay_validation: "dependents",
};

const PART_LABELS: Record<CheckPart, string> = { candidate: "the candidate", dependents: "dependent modules" };

const TOOL_LABELS: Record<string, string> = {
  rules_engine_compile: "compile",
  ci_static_checks: "static checks",
  ci_test_cases: "test cases",
  source_completeness_checks: "source completeness",
  policyengine_oracle: "PolicyEngine oracle",
  other: "other",
};

const phaseLabel = (name: string) => PHASE_LABELS[name] ?? name.replaceAll("_", " ");

function toolList(tools: Record<string, number> | undefined): TimelineTool[] {
  return Object.entries(tools ?? {})
    .filter(([, ms]) => ms > 0)
    .map(([name, ms]) => ({ name, label: TOOL_LABELS[name] ?? name.replaceAll("_", " "), ms }))
    .sort((a, b) => b.ms - a.ms);
}

/** Tool times summed across phases, longest first, "other" last. */
function mergeTools(lists: TimelineTool[][]): TimelineTool[] {
  const byName = new Map<string, TimelineTool>();
  for (const tool of lists.flat()) {
    const seen = byName.get(tool.name);
    byName.set(tool.name, seen ? { ...seen, ms: seen.ms + tool.ms } : { ...tool });
  }
  return [...byName.values()].sort((a, b) => (a.name === "other" ? 1 : b.name === "other" ? -1 : b.ms - a.ms));
}

/** One run from its dispatch: the encode run as bars on one clock, then the slower steps after the PR. */
export interface RunTimeline {
  title: string;
  totalMs: number;
  bars: TimelineBar[];
  /** The encode loop's tries, from the encoder's record; empty without one. */
  tries: TimelineTry[];
  /** The model's own time across the tries, and the encode loop's whole time, to tell writing from checking. */
  modelMs: number | null;
  loopMs: number | null;
  /** Where the loop's time went, once the encoder timed its tries' phases. */
  split: LoopSplit | null;
  /** What stopped a run that did not encode. */
  stopped: string | null;
  after: TimelineStep[];
}

/** Text a caller knows better than a run row: the journey page's details, by step. */
export interface TimelineDetails {
  stopped?: string | null;
  review?: string | null;
  index?: string | null;
  /** Steps to add after the tests on main, such as the compile sweep and the oracle. */
  extra?: TimelineStep[];
}

const TIMELINE_TITLES: Record<RunOutcome, string> = {
  encoded: "Dispatch to draft PR",
  failed: "Dispatch to failure",
  cancelled: "Dispatch until it stopped",
  running: "So far",
  waiting: "So far",
};

const LAST_BAR_STATE: Partial<Record<RunOutcome, TimelineBar["state"]>> = {
  failed: "failed",
  cancelled: "cancelled",
  running: "running",
};

/**
 * A run's timeline. The encode run is split by its job's parts once they are
 * recorded (one bar for the run before that), so the wait for approval, setup,
 * the encode loop, and signing read on one clock; the last bar of a run that
 * stopped carries how. After a PR opened come review, the index, and the
 * tests on main, each timed from the step before.
 */
export function runTimeline(row: RunRow, referenceMs: number, details: TimelineDetails = {}): RunTimeline {
  const bars: TimelineBar[] = [];
  const add = (key: TimelineBar["key"], label: string, ms: number | null) => {
    if (ms === null) return;
    const last = bars.at(-1);
    bars.push({ key, label, startMs: last ? last.startMs + last.ms : 0, ms, state: "done" });
  };
  const dispatched = Date.parse(row.dispatchedAt);
  if (row.outcome === "waiting") {
    add("approval", "Waiting for approval", Math.max(0, referenceMs - dispatched));
    bars[0].state = "running";
  } else {
    add("approval", "Wait for approval", row.approvalMs);
  }
  const { setupMs, encodeMs, publishMs } = row.phases;
  if (setupMs !== null || encodeMs !== null) {
    add("setup", "Setup", setupMs);
    const tries = row.attempts ? ` · ${row.attempts} ${row.attempts === 1 ? "try" : "tries"}` : "";
    add("encode", `Encode loop${tries}`, encodeMs);
    add("publish", "Sign and open the PR", publishMs);
  } else if (row.outcome === "running" && row.approvalMs !== null) {
    add("run", "Running", Math.max(0, referenceMs - dispatched - row.approvalMs));
  } else if (row.outcome !== "waiting") {
    add("run", "Encode run", row.runMs);
  }
  const lastBar = bars.at(-1);
  if (lastBar && LAST_BAR_STATE[row.outcome]) lastBar.state = LAST_BAR_STATE[row.outcome]!;
  const total = bars.reduce((end, bar) => Math.max(end, bar.startMs + bar.ms), 0);
  const title = TIMELINE_TITLES[row.outcome];
  const stopped =
    row.outcome === "failed" || row.outcome === "cancelled"
      ? (details.stopped ?? ([row.outcomeLabel, row.cause && causeText(row.cause)].filter(Boolean).join(": ") || null))
      : null;

  const after: TimelineStep[] = [];
  const pr = row.pr;
  if (pr?.openedAt) {
    const end = pr.mergedAt ?? (pr.state === "closed" ? pr.closedAt : null);
    after.push({
      key: "review",
      label: "Review",
      ms: ms(pr.openedAt, end ?? new Date(referenceMs).toISOString()),
      state: row.merged === "main" ? "done" : row.merged === "off main" || pr.state === "closed" ? "failed" : "waiting",
      detail:
        details.review ??
        (row.merged === "main"
          ? "Merged into main"
          : row.merged === "off main"
            ? "Merged into a side branch"
            : pr.state === "closed"
              ? "Closed without merging"
              : ["In review so far", pr.error].filter(Boolean).join(" · ")),
      href: pr.url,
    });
  }
  if (row.merged === "main" && pr?.mergedAt) {
    after.push({
      key: "index",
      label: "Index",
      ms: ms(pr.mergedAt, row.indexedAt),
      state: row.index === "indexed" ? "done" : row.index === "missing" ? "failed" : "waiting",
      detail:
        details.index ??
        (row.index === "indexed" ? "Indexed" : row.index === "missing" ? "Missing from the index" : "Waiting for the index"),
      href: null,
    });
    const wait = ms(pr.mergedAt, row.testsStartedAt);
    const run = ms(row.testsStartedAt, row.testsAt);
    const latest = row.tests && row.testsFirst && row.tests !== row.testsFirst ? `latest ${row.tests}` : null;
    after.push({
      key: "tests",
      label: "Tests on main",
      ms: ms(pr.mergedAt, row.testsAt),
      state: row.tests === "pass" || row.tests === "waived" ? "done" : row.tests === "fail" ? "failed" : "waiting",
      detail:
        [
          wait !== null ? `wait ${shortDuration(wait)}` : null,
          run !== null ? `run ${shortDuration(run)}` : null,
          row.testsFirst ? `first result ${row.testsFirst}` : null,
          latest,
          !row.testsFirst && row.tests ? `result ${row.tests}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "No result yet",
      href: row.testsUrl,
    });
    after.push(...(details.extra ?? []));
  }
  // A timed try sits on the timeline's clock at its own start: the clock counts from the dispatch.
  // It stays inside the encode step's bar (the runner's clock and GitHub's can differ by a little).
  const dispatched0 = Date.parse(row.dispatchedAt);
  const loopBar = bars.find((bar) => bar.key === "encode");
  const lane = loopBar ? { from: loopBar.startMs, to: loopBar.startMs + loopBar.ms } : { from: 0, to: total };
  const clamp = (at: number) => Math.min(Math.max(at, lane.from), lane.to);
  const tries: TimelineTry[] = (row.tries ?? []).map((attempt) => {
    const phases: TimelinePhase[] = [];
    if (attempt.phases && attempt.startedAt) {
      let at = Date.parse(attempt.startedAt) - dispatched0;
      for (const phase of attempt.phases) {
        const start = clamp(at);
        phases.push({
          name: phase.name,
          label: phaseLabel(phase.name),
          kind: phaseKind(phase.name),
          part: CHECK_PARTS[phase.name] ?? null,
          startMs: start,
          ms: clamp(at + phase.ms) - start,
          tools: toolList(phase.tools),
        });
        at += phase.ms;
      }
    }
    return {
      attempt: attempt.attempt,
      model: attempt.model,
      ms: attempt.ms,
      cost: attempt.cost,
      ok: attempt.ok,
      headline: attempt.error ? causeHeadline(attempt.error) : null,
      error: attempt.error,
      wallMs: attempt.phases ? (attempt.wallMs ?? null) : null,
      phases,
    };
  });
  const timed = tries.filter((attempt) => attempt.ms !== null);
  const modelMs = timed.length ? timed.reduce((sum, attempt) => sum + attempt.ms!, 0) : null;
  return {
    title,
    totalMs: total,
    bars,
    tries,
    modelMs,
    loopMs: row.phases.encodeMs,
    split: loopSplit(row, tries),
    stopped,
    after,
  };
}

/**
 * Where an encode loop's time went: the timed tries' phases by kind (with the
 * check phases' time by tool), then the encode step's time outside the tries.
 * The encoder's loop clock splits that into the time before the first try,
 * between tries, and after the last; the rest of the step is its other work
 * (other encoder passes over sources or dependents, and the signing helpers).
 */
function loopSplit(row: RunRow, tries: TimelineTry[]): LoopSplit | null {
  const source = (row.tries ?? []).filter((attempt) => attempt.phases);
  if (!source.length) return null;
  const phases = source.flatMap((attempt) => attempt.phases!);
  const kinds = (["model", "checks", "other"] as const).map((kind) => {
    const own = phases.filter((phase) => phaseKind(phase.name) === kind);
    const parts = (["candidate", "dependents"] as const)
      .map((part) => ({
        part,
        label: PART_LABELS[part],
        ms: own.filter((phase) => CHECK_PARTS[phase.name] === part).reduce((sum, phase) => sum + phase.ms, 0),
      }))
      .filter((part) => part.ms > 0);
    return {
      kind,
      label: KIND_LABELS[kind],
      ms: own.reduce((sum, phase) => sum + phase.ms, 0),
      parts: kind === "checks" ? parts : [],
      tools: kind === "checks" ? mergeTools(own.map((phase) => toolList(phase.tools))) : [],
    };
  });
  const stepMs = row.phases.encodeMs;
  const allTimed = source.length === tries.length;
  const triesMs = source.reduce((sum, attempt) => sum + (attempt.wallMs ?? 0), 0);
  const outsideMs = stepMs !== null && allTimed ? Math.max(0, stepMs - triesMs) : null;
  const outside: LoopSplit["outside"] = [];
  const loop = row.loop;
  if (outsideMs !== null && loop) {
    const add = (label: string, ms: number | null) => {
      if (ms !== null && ms >= 1000) outside.push({ label, ms });
    };
    add("before the first try", loop.setupMs);
    add("between tries", loop.betweenMs);
    add("after the last try", loop.finalizeMs);
    add("other work in the step", stepMs! - loop.wallMs > 0 ? stepMs! - loop.wallMs : null);
  }
  const [model, checks, other] = kinds;
  const shares: LoopShare[] = [
    { key: "model", kind: "model", part: null, label: "model", ms: model.ms },
    ...(checks.parts.length > 1
      ? checks.parts.map((part) => ({ key: part.part, kind: "checks" as const, part: part.part, label: `checks on ${part.label}`, ms: part.ms }))
      : [{ key: "checks", kind: "checks" as const, part: null, label: "checks", ms: checks.ms }]),
    { key: "other", kind: "other", part: null, label: "other", ms: other.ms },
    { key: "outside", kind: "outside", part: null, label: "outside the tries", ms: outsideMs ?? 0 },
  ];
  return { kinds, shares: shares.filter((share) => share.ms > 0), outsideMs, outside };
}

/** Prefixes that name where an error came from rather than what it says. */
const CAUSE_SOURCE_RE = /^(?:ci|compile|error|RuntimeError|ValueError|TypeError|KeyError|AssertionError):\s*/i;
const CAUSE_HEADLINE_MAX = 72;

const COMPLETENESS_RULE_RE = /^\[?complete-source-unit:([a-z0-9-]+)\]?\s*/i;

/** A cause without the file and the check it came from. */
function causeBody(cause: string): string {
  // A raw encoder message leads with its file ("statutes/42/402/q.yaml: ci: …").
  let text = cause.trim().replace(/^[\w./-]+\.ya?ml:\s*/i, "");
  while (CAUSE_SOURCE_RE.test(text)) text = text.replace(CAUSE_SOURCE_RE, "");
  return text;
}

/**
 * A failure cause in full, as a reader takes it: without the file and the
 * check it came from, and a completeness rule by its name.
 */
export function causeText(cause: string): string {
  const text = causeBody(cause);
  const rule = text.match(COMPLETENESS_RULE_RE);
  if (!rule) return text;
  const rest = text.slice(rule[0].length);
  return `Completeness rule: ${rule[1]}${rest ? ` — ${rest}` : ""}`;
}

/**
 * A failure cause in a few words: a completeness rule by its name, else the
 * message's own first clause without the file and the check it came from
 * ("ci: Ungrounded generated numeric literal: N does not…" is "Ungrounded
 * generated numeric literal"). Causes with one headline count together.
 */
/** A command-line tool's error: "jq: error: syntax error, unexpected …". */
const TOOL_ERROR_RE = /^([a-z][\w-]{1,20}):\s*error:\s*([\s\S]+)$/i;
/** An exception raised under its module path: "axiom_encode.corpus_resolver.CorpusLayoutError: …". */
const MODULE_EXCEPTION_RE = /^(?:[a-z_][\w]*\.)+([A-Z]\w*?)(Error|Exception):\s*/;

/** "CorpusLayout" as "Corpus layout". */
const words = (camel: string) => {
  const spaced = camel.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function causeHeadline(cause: string): string {
  const text = causeBody(cause);
  const rule = text.match(COMPLETENESS_RULE_RE);
  if (rule) return `Completeness rule: ${rule[1]}`;
  // A tool's error by the tool and its first clause: "jq: syntax error".
  const tool = text.match(TOOL_ERROR_RE);
  if (tool) return `${tool[1]}: ${tool[2].split(/[,:]\s/)[0].replace(/[.\s]+$/, "")}`;
  // An exception by its class in words: "Corpus layout error".
  const raised = text.match(MODULE_EXCEPTION_RE);
  if (raised) return `${words(raised[1])} ${raised[2].toLowerCase()}`;
  const clause = text.split(/:\s/)[0];
  const headline = (clause.length >= 12 ? clause : text).replace(/[.\s]+$/, "");
  return headline.length > CAUSE_HEADLINE_MAX ? `${headline.slice(0, CAUSE_HEADLINE_MAX - 1)}…` : headline;
}
