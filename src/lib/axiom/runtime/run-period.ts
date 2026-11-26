/**
 * The month a run-by-root calculation computes. The runtime reads it as
 * `household.period`; without one it picks its own default month, which
 * can predate every version of a rule that takes effect later (42 U.S.C.
 * 1396a(xx) starts in 2027, so a run at the default month fails with
 * "no formula version"). Shared by the viewer, which reads it from the
 * `period=` URL value and the run panel's month field, and the calculate
 * route, which refuses anything else.
 */

/** A calendar month "YYYY-MM", the value shape of `<input type="month">`
 *  and of the runtime's monthly periods. */
export const RUN_PERIOD_RE = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;

/** The run period a `period=` URL value or month field names, or null
 *  when it is absent or not a month (never a guess). */
export function parseRunPeriod(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  return RUN_PERIOD_RE.test(value) ? value : null;
}

/** The engine's refusal in its two spellings: the WASM and CLI runners
 *  print it ("derived `credit` has no formula version at 2026-11-01"); the
 *  remote /run-compiled runner debug-formats it
 *  (`Eval(MissingDerivedFormulaVersion { derived: "credit", at: … })`),
 *  quotes JSON-escaped once axiom-api relays that HTTP body. */
const COVERAGE_PRINTED_RE = /derived `([^`]+)` has no formula version at /;
const COVERAGE_DEBUG_RE = /MissingDerivedFormulaVersion \{ derived: \\*"([^"\\]+)\\*"/;

/** Whether a runtime refusal says a rule has no version at the month the
 *  run asked for. The user fixes that by choosing another month, so the
 *  viewer shows the root's refusal as a run error and keeps the run panel,
 *  Month field included, rather than blocking the run. */
export function isRunPeriodCoverageRefusal(message: string | null | undefined): boolean {
  const text = message ?? "";
  return /has no formula version at /.test(text) || COVERAGE_DEBUG_RE.test(text);
}

/** The rule a coverage refusal names, or null when it names none: a traced
 *  run drops that rule and retries. */
export function runPeriodCoverageRule(message: string | null | undefined): string | null {
  const text = message ?? "";
  return (COVERAGE_PRINTED_RE.exec(text) ?? COVERAGE_DEBUG_RE.exec(text))?.[1] ?? null;
}
