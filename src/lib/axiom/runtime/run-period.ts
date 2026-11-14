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
