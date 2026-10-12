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
 *
 * us-az-snap: rulespec-us-az's composition
 * policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation
 * defines snap_eligible as the input na_budgetary_unit_is_eligible, and its
 * summary says these bridge values "remain inputs until the full Arizona NA
 * eligibility chain is encoded". finbot's src/lib/catalog-overlay.ts says
 * every household shows as eligible; the live chatbot returned "holds" for
 * a household that set nothing about eligibility (2026-10-12).
 */
export const ELIGIBILITY_NOT_TESTED: Readonly<Record<string, { state: string; program: string }>> = {
  "us-az-snap": { state: "Arizona", program: "SNAP" },
};

/** False for a program listed above; true otherwise, an unknown program included. */
export function eligibilityTested(programId: string | null | undefined): boolean {
  return !programId || !Object.hasOwn(ELIGIBILITY_NOT_TESTED, programId);
}

/** The panel's note for a program whose eligibility isn't tested; null when it is. */
export function eligibilityNote(programId: string | null | undefined): string | null {
  if (!programId || eligibilityTested(programId)) return null;
  const { state, program } = ELIGIBILITY_NOT_TESTED[programId];
  return `Not an eligibility determination: Axiom's ${state} ${program} rules don't test eligibility yet. Read this as the amount if eligible.`;
}

/**
 * USDA FNS sets SNAP maximum allotments, deductions and income standards
 * once a year, for the federal fiscal year that starts October 1
 * (https://www.fna.usda.gov/snap/allotment/cola). A computation's
 * standards year comes from the USDA documents its outputs cite
 * (us:policies/usda/snap/fy-2026-cola/...), else from the chatbot's own
 * disclosure, "SNAP figures use FY2026 standards; ..." (finbot-snap-demo
 * src/lib/catalog-overlay.ts, programDisclosures).
 */
const COLA_LEGAL_ID = /^us:policies\/usda\/snap\/fy-(\d{4})-cola\//;
const STANDARDS_DISCLOSURE = /^SNAP figures use FY ?(\d{4}) standards\b/;
/** finbot's wording for a program listed in ELIGIBILITY_NOT_TESTED. */
const ELIGIBILITY_DISCLOSURE = /\b(?:doesn't|does not) test eligibility\b/i;

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

/** When the standards used aren't the period's own fiscal year: which were used and which apply. */
export function standardsMismatch(
  used: readonly number[],
  period: string | null | undefined,
): { used: number[]; due: number } | null {
  const due = federalFiscalYear(period);
  if (due === null || used.length === 0 || used.every((year) => year === due)) return null;
  return { used: [...used], due };
}

/**
 * The chatbot's disclosures the panel doesn't already say in its own words.
 * The panel states the eligibility note (for a program listed above) and
 * the standards year (when it parsed one), so it drops finbot's versions of
 * those two; any other disclosure shows as the chatbot wrote it.
 */
export function otherDisclosures(computation: {
  program: string;
  disclosures: readonly string[];
}): string[] {
  const tested = eligibilityTested(computation.program);
  return computation.disclosures.filter(
    (text) => !STANDARDS_DISCLOSURE.test(text) && (tested || !ELIGIBILITY_DISCLOSURE.test(text)),
  );
}
