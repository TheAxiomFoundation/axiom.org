/**
 * What a rules check doesn't decide yet, so the rules panel and the
 * results board never show an untested answer as a determination.
 * Plain data and string helpers: the rules route, the panel and the
 * results summary all read them.
 */

/**
 * Programs whose encoded eligibility verdict doesn't test the household.
 * Mirrors the programs finbot-snap-demo marks "does not test eligibility
 * yet" in src/lib/request-builder.ts (ASSISTANT_UNSETTABLE_INPUTS). The
 * gallery chatbot may not set those inputs, so they keep their defaults.
 * A computation whose own disclosures say the same counts too (see
 * testsEligibility), so a program finbot adds later is caught before this
 * list catches up.
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

/** Any disclosure saying the rules don't test eligibility, any apostrophe: enough to mark a result untested. */
const ELIGIBILITY_DISCLOSURE = /\b(?:does|do)(?:n['\u2019]t| not) test eligibility\b/i;
/** finbot's whole Arizona-style sentence (catalog-overlay.ts) and nothing more: what the panel's note restates. */
const ELIGIBILITY_DISCLOSURE_WHOLE =
  /^Axiom['\u2019]s [^:]+ encoding (?:doesn['\u2019]t|does not) test eligibility yet: every household shows as eligible, so read the amount as ["\u201c]if eligible["\u201d]\.$/;

/**
 * True when the rules test the household's eligibility. A verdict saved
 * with the check wins, so a check saved before a program's eligibility is
 * encoded keeps reading "if eligible"; otherwise a listed program, or a
 * result whose disclosures say so, doesn't test it. Unknown program: true.
 */
export function testsEligibility(check: {
  program: string | null;
  disclosures?: readonly string[] | null;
  eligibilityTested?: boolean | null;
}): boolean {
  if (typeof check.eligibilityTested === "boolean") return check.eligibilityTested;
  if (check.program !== null && ELIGIBILITY_NOT_TESTED.includes(check.program)) return false;
  return !(check.disclosures ?? []).some((text) => ELIGIBILITY_DISCLOSURE.test(text));
}

/** The panel's note for a computation whose eligibility isn't tested; null when it is. */
export function eligibilityNote(check: {
  program: string;
  displayName: string;
  disclosures?: readonly string[] | null;
  eligibilityTested?: boolean | null;
}): string | null {
  if (testsEligibility(check)) return null;
  return `Not an eligibility determination: Axiom's ${check.displayName} rules don't test eligibility yet. Read this as the amount if eligible.`;
}

/**
 * USDA adjusts SNAP's maximum allotments, deductions and income standards
 * at the start of each federal fiscal year, October 1
 * (https://www.fna.usda.gov/snap/allotment/cola). A computation's
 * standards year comes from the USDA documents its outputs cite
 * (us:policies/usda/snap/fy-2026-cola/...), else from the chatbot's own
 * disclosure, "SNAP figures use FY2026 standards; ..." (finbot-snap-demo
 * src/lib/catalog-overlay.ts, programDisclosures).
 */
const COLA_LEGAL_ID = /^us:policies\/usda\/snap\/fy-(\d{4})-cola\//;
const STANDARDS_DISCLOSURE = /^SNAP figures use FY ?(\d{4}) standards\b/;
/** finbot's whole standards disclosure and nothing more: the year used, and a later year not yet encoded. */
const STANDARDS_DISCLOSURE_WHOLE =
  /^SNAP figures use FY ?(\d{4}) standards; FY ?(\d{4}) standards took effect October 1, \d{4} and are not encoded yet\.$/;

/** "2026-10" → 2027: the federal fiscal year runs October to September. Null for any other period. */
export function federalFiscalYear(period: string | null | undefined): number | null {
  const match = period?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return Number(match[1]) + (month >= 10 ? 1 : 0);
}

function years(texts: readonly (string | null)[], pattern: RegExp): number[] {
  return texts.flatMap((text) => {
    const match = text?.match(pattern);
    return match ? [Number(match[1])] : [];
  });
}

/** The fiscal years of the SNAP standards a computation used, oldest first; empty when it names none. */
export function snapStandardsYears(legalIds: readonly (string | null)[], disclosures: readonly string[]): number[] {
  const cited = years(legalIds, COLA_LEGAL_ID);
  const found = cited.length ? cited : years(disclosures, STANDARDS_DISCLOSURE);
  return [...new Set(found)].sort((a, b) => a - b);
}

/**
 * When the standards used aren't the period's own fiscal year: which were
 * used, which apply, and whether the chatbot says the ones that apply
 * aren't encoded yet.
 */
export function standardsMismatch(
  used: readonly number[],
  period: string | null | undefined,
  disclosures: readonly string[] = [],
): { used: number[]; due: number; notEncoded: boolean } | null {
  const due = federalFiscalYear(period);
  if (due === null || used.length === 0 || used.every((year) => year === due)) return null;
  const notEncoded = disclosures.some((text) => Number(text.match(STANDARDS_DISCLOSURE_WHOLE)?.[2]) === due);
  return { used: [...used], due, notEncoded };
}

/**
 * The chatbot's disclosures the panel doesn't replace with its own words.
 * A disclosure goes only when it is one of finbot's two known sentences,
 * whole, and the panel says the same thing itself:
 * - the eligibility sentence, when the panel shows its eligibility note
 *   (testsEligibility false, saved verdict included);
 * - the standards sentence, when the period is a month: the panel compares
 *   the standards year with the month's fiscal year and, when they differ,
 *   says so, including "not encoded yet" (standardsMismatch). When they
 *   match, the sentence is about a later fiscal year, not this period.
 * Anything else, including either sentence with more added, stays as the
 * chatbot wrote it.
 */
export function otherDisclosures(computation: {
  program: string | null;
  period: string | null;
  disclosures?: readonly string[] | null;
  eligibilityTested?: boolean | null;
}): string[] {
  const monthly = federalFiscalYear(computation.period) !== null;
  const noted = !testsEligibility(computation);
  return (computation.disclosures ?? []).filter(
    (text) => !(noted && ELIGIBILITY_DISCLOSURE_WHOLE.test(text)) && !(monthly && STANDARDS_DISCLOSURE_WHOLE.test(text)),
  );
}
