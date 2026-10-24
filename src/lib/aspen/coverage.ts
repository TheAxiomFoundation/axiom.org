/**
 * Which saved rules checks didn't test eligibility, so the results never
 * count an amount from them as a household that qualifies. Phones saved
 * these checks until October 16, 2026 (see SavedCheck in results.ts).
 */

/**
 * Programs whose encoded eligibility verdict doesn't test the household.
 * Mirrors the programs finbot-snap-demo marks "does not test eligibility
 * yet" in src/lib/request-builder.ts (ASSISTANT_UNSETTABLE_INPUTS). The
 * gallery chatbot may not set those inputs, so they keep their defaults.
 *
 * us-az-snap: rulespec-us-az's composition
 * policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation
 * defines snap_eligible as the input na_budgetary_unit_is_eligible, and its
 * summary says these bridge values "remain inputs until the full Arizona NA
 * eligibility chain is encoded". finbot's src/lib/catalog-overlay.ts says
 * every household shows as eligible; the live chatbot returned "holds" for
 * a household that set nothing about eligibility (2026-10-12).
 */
export const ELIGIBILITY_NOT_TESTED: readonly string[] = ["us-az-snap"];

/**
 * True when the rules test the household's eligibility. A verdict saved
 * with the check wins, so a check saved before a program's eligibility is
 * encoded keeps reading "if eligible"; otherwise a listed program doesn't
 * test it. Unknown program: true.
 */
export function testsEligibility(check: { program: string | null; eligibilityTested?: boolean | null }): boolean {
  if (typeof check.eligibilityTested === "boolean") return check.eligibilityTested;
  return check.program === null || !ELIGIBILITY_NOT_TESTED.includes(check.program);
}
