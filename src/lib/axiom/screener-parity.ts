/**
 * Screener-level parity: the headline of a bundle's screener tier. Read from
 * the axiom-oracles comparison report the bundle names (Axiom against
 * PolicyEngine on a state's survey households): how many of the households
 * either engine finds eligible get the same eligibility and benefit from
 * both, and how many mismatches are Axiom's to fix.
 *
 * Households where neither engine finds anyone eligible match trivially, so
 * the headline leaves them out. Shares are survey-weighted, as the report's
 * own rates are.
 */

/** The parts of an axiom-oracles comparison report (axiom.comparison_report.v2) this reads. */
export interface ComparisonReport {
  case_count?: number;
  aggregates?: Array<{
    concept?: string;
    comparison?: string;
    description?: string;
    comparison_count?: number;
    mismatch_count?: number;
    left_positive_weight?: number;
    right_positive_weight?: number;
    left_positive_rate?: number;
    right_positive_rate?: number;
  }>;
  cases?: Array<{
    case_id: string;
    mismatches?: Array<{ concept?: string; kind?: string }>;
    metadata?: { household_weight?: number };
  }>;
  mismatches?: Array<{
    case_id?: string;
    concept?: string;
    disposition?: { disposition?: string; linked_issue?: string | null } | null;
  }>;
  dashboard_truncation?: { total_case_rows?: number; shown_mismatches?: number; total_mismatches?: number };
  summary?: {
    mismatch_count?: number;
    dispositioned?: { counts?: Record<string, number>; unexplained_count?: number } | null;
  };
  engines?: { versions?: Record<string, string> };
  provenance?: {
    generated_at?: string;
    run_kind?: string;
    reemitted_report?: boolean;
    rulespecs?: Array<{ repo?: string; sha?: string }>;
  };
}

/** Where a bundle's comparison lives: the bundle file's screener membership.comparison. */
export interface ComparisonSource {
  repo: string;
  suite: string;
  report: string;
}

/** One row of encodings.program_bundles.parity. */
export interface ScreenerParity {
  suite: string;
  report_url: string;
  generated_at: string | null;
  /** manual or ci, as the report records it. */
  run_kind: string | null;
  /** The leg could not run and re-stamped an earlier report. */
  reemitted: boolean;
  policyengine_us: string | null;
  rulespec_sha: string | null;
  /** Survey households compared, and how many match on every output. */
  households: number;
  households_matching: number;
  /** Share of households (weighted) each engine finds eligible. */
  eligible_policyengine: number | null;
  eligible_axiom: number | null;
  /**
   * Of the households either engine finds eligible (weighted), the share
   * that gets the same eligibility and benefit from both: the headline.
   */
  eligible_matching: number | null;
  /** Mismatches, and those that are Axiom's to fix: unexplained or an encoding gap. */
  mismatches: number;
  axiom_errors: number;
  by_disposition: Record<string, number>;
  /** The issues that hold the dispositioned mismatches, most first. */
  issues: Array<{ url: string; mismatches: number }>;
  /** Each compared output: households that disagree on it. */
  outputs: Array<{ concept: string; description: string; mismatches: number }>;
}

const AXIOM_TO_FIX = ["unexplained", "axiom_encoding_gap"];

export function screenerParity(report: ComparisonReport, source: ComparisonSource): ScreenerParity {
  const households = report.case_count ?? report.dashboard_truncation?.total_case_rows ?? 0;
  const cases = report.cases ?? [];
  const mismatched = new Set((report.mismatches ?? []).map((m) => m.case_id).filter(Boolean));
  for (const c of cases) if (c.mismatches?.length) mismatched.add(c.case_id);

  const eligibility = (report.aggregates ?? []).find((a) => a.comparison === "eligibility");
  const truncation = report.dashboard_truncation;
  // Every mismatching household must be listed to weigh them.
  const complete = !truncation || truncation.shown_mismatches === truncation.total_mismatches;
  let eligibleMatching: number | null = null;
  if (eligibility && complete) {
    const weight = (c: (typeof cases)[number]) => c.metadata?.household_weight ?? 0;
    const kinds = (c: (typeof cases)[number]) => (c.mismatches ?? []).map((m) => m.kind ?? "");
    const policyengine = eligibility.right_positive_weight ?? 0;
    const axiom = eligibility.left_positive_weight ?? 0;
    const rightOnly = cases.filter((c) => kinds(c).includes("eligibility_right_only")).reduce((t, c) => t + weight(c), 0);
    const both = Math.max(0, policyengine - rightOnly);
    const either = policyengine + axiom - both;
    // Both engines find them eligible, but another output disagrees.
    const otherOnly = cases
      .filter((c) => c.mismatches?.length && !kinds(c).some((k) => k.startsWith("eligibility_")))
      .reduce((t, c) => t + weight(c), 0);
    eligibleMatching = either > 0 ? Math.max(0, both - otherOnly) / either : null;
  }

  const counts = report.summary?.dispositioned?.counts ?? {};
  const issues = new Map<string, number>();
  for (const m of report.mismatches ?? []) {
    const url = m.disposition?.linked_issue;
    if (url) issues.set(url, (issues.get(url) ?? 0) + 1);
  }
  const versions = report.engines?.versions ?? {};
  return {
    suite: source.suite,
    report_url: `https://github.com/${source.repo}/blob/main/${source.report}`,
    generated_at: report.provenance?.generated_at ?? null,
    run_kind: report.provenance?.run_kind ?? null,
    reemitted: report.provenance?.reemitted_report === true,
    policyengine_us: versions.policyengine_us ?? null,
    rulespec_sha: report.provenance?.rulespecs?.[0]?.sha ?? null,
    households,
    households_matching: Math.max(0, households - mismatched.size),
    eligible_policyengine: eligibility?.right_positive_rate != null ? eligibility.right_positive_rate / 100 : null,
    eligible_axiom: eligibility?.left_positive_rate != null ? eligibility.left_positive_rate / 100 : null,
    eligible_matching: eligibleMatching,
    mismatches: report.summary?.mismatch_count ?? (report.mismatches ?? []).length,
    axiom_errors: AXIOM_TO_FIX.reduce((t, k) => t + (counts[k] ?? 0), 0),
    by_disposition: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)),
    issues: [...issues.entries()].map(([url, mismatches]) => ({ url, mismatches })).sort((a, b) => b.mismatches - a.mismatches),
    outputs: (report.aggregates ?? []).map((a) => ({
      concept: a.concept ?? "",
      description: a.description ?? a.concept ?? "",
      mismatches: a.mismatch_count ?? 0,
    })),
  };
}

/** Whether a version string is older than another: 1.767.3 is older than 2.29.10. */
export function olderVersion(version: string | null, newest: string | null): boolean {
  if (!version || !newest) return false;
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(version), parts(newest)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}
