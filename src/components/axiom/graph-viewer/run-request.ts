import { fileLegalIdOf } from "./citations";
import type { LegalId, ProgramGraph } from "./types";

/**
 * The calculate request for a run: compose mode speaks the
 * run-by-root shape — every value the user typed travels verbatim
 * as `facts` — while package programs keep their coordinates and
 * `values`. One pure builder so the round trip is testable.
 *
 * `people` extends the compose shape for multi-member households:
 * facts stay the first person (and the unit) exactly as before, and
 * each additional member travels as `people.person_N` with their own
 * Person-level answers. Omitted entirely for the single-filer case,
 * so an upstream that predates the shape sees an unchanged request.
 */
export function buildRunRequestBody(
  composeFocus: string | null,
  program: { jurisdiction: string; programId: string } | null,
  scenario: Record<string, number | boolean>,
  variables: string[],
  people?: Record<string, Record<string, number | boolean>>,
): Record<string, unknown> {
  if (composeFocus) {
    return {
      root: fileLegalIdOf(composeFocus),
      facts: scenario,
      ...(people && Object.keys(people).length > 0 ? { people } : {}),
      variables,
    };
  }
  return {
    jurisdiction: program?.jurisdiction ?? "us",
    program_id: program?.programId ?? "",
    values: scenario,
    variables,
  };
}

/**
 * A stable identity for "the values a run computed": entries sorted
 * by name so insertion order never fakes an edit. The viewer keeps
 * the key of the LAST explicit run; a differing key of the current
 * scenario marks the results sheet stale — it never fires a run.
 */
export function scenarioKey(
  scenario: Record<string, number | boolean>,
): string {
  return JSON.stringify(
    Object.entries(scenario).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Where a run's trace walk starts: the graph's terminal outputs plus
 * every derived rule nothing in the graph consumes. A served program
 * graph is pruned to what its outputs exercise, and its terminal list
 * can come back empty (every SNAP package) — walking from it alone
 * asked the engine for nothing, so only the default outputs ran lit.
 */
export function traceRootIds(graph: ProgramGraph): LegalId[] {
  const consumed = new Set(graph.rules.flatMap((rule) => rule.ruleDeps));
  const frontier = graph.rules
    .filter((rule) => rule.kind === "derived" && !consumed.has(rule.legalId))
    .map((rule) => rule.legalId);
  return [...new Set([...graph.terminalOutputs, ...frontier])];
}

/** The calculate endpoint's cap on traced variables per request. */
export const TRACE_BATCH_SIZE = 96;

export interface RunPayload {
  outputs: Record<string, number | string | boolean | null>;
  trace: Array<{
    variable: string;
    value: unknown;
    instances?: Array<{ entity_id: string; value: unknown }>;
  }>;
}

/**
 * Fold a follow-up batch's trace into the primary run. The primary
 * wins every overlap — both batches evaluate the same facts, so an
 * overlap only ever repeats a value the primary already holds.
 */
export function mergeRunBatches<T extends RunPayload>(primary: T, extra: RunPayload): T {
  const traced = new Set(primary.trace.map((entry) => entry.variable));
  return {
    ...primary,
    outputs: { ...extra.outputs, ...primary.outputs },
    trace: [...primary.trace, ...extra.trace.filter((entry) => !traced.has(entry.variable))],
  };
}
