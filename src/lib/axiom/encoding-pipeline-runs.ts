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
  } | null;
  merged: "main" | "off main" | null;
  index: "indexed" | "missing" | "awaiting" | null;
  tests: "pass" | "fail" | "waived" | null;
  testsUrl: string | null;
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
    ...outcomeOf(attempt),
    runUrl: attempt.run_url,
    pr:
      attempt.pr_url && attempt.pr_state
        ? {
            label: attempt.pr_repo && attempt.pr_number ? `${attempt.pr_repo}#${attempt.pr_number}` : "PR",
            url: attempt.pr_url,
            state: attempt.pr_state,
            error: clip(attempt.pr_check_error ?? null),
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
  key: string;
  label: string;
  /** Runs that reached this gate. */
  input: number;
  segments: FlowSegment[];
}

function gate(
  key: string,
  label: string,
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
    gate: { key, label, input: input.length, segments },
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
  add("approval", "Signing approval", input, [
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
  add("run", "Encode run", input, [
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
  add("pr", "Pull request", input, [
    { key: "opened", label: "PR opened", kind: "continue", test: (r) => r.pr !== null },
    { key: "none", label: "No PR", kind: "loss", test: (r) => r.pr === null },
  ]);
  add("review", "Review", input, [
    { key: "merged", label: "Merged", kind: "continue", test: (r) => r.pr?.state === "merged" },
    { key: "open", label: "In review", kind: "pending", test: (r) => r.pr?.state === "draft" || r.pr?.state === "open" },
    { key: "closed", label: "Closed", kind: "loss", test: (r) => r.pr?.state === "closed" },
  ]);
  add("main", "Default branch", input, [
    { key: "main", label: "Into main", kind: "continue", test: (r) => r.merged === "main" },
    { key: "off", label: "Off main", kind: "loss", test: (r) => r.merged === "off main" },
  ]);
  add("index", "Index", input, [
    { key: "indexed", label: "Indexed", kind: "continue", test: (r) => r.index === "indexed" },
    { key: "awaiting", label: "Awaiting the index", kind: "pending", test: (r) => r.index === "awaiting" },
    { key: "missing", label: "Missing from the index", kind: "loss", test: (r) => r.index === "missing" },
  ]);
  add("tests", "Tests on main", input, [
    { key: "pass", label: "Tests pass", kind: "continue", test: (r) => r.tests === "pass" },
    { key: "pending", label: "No result yet", kind: "pending", test: (r) => r.tests === null || r.tests === "waived" },
    { key: "fail", label: "Tests fail", kind: "loss", test: (r) => r.tests === "fail" },
  ]);
  return gates;
}
