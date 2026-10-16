/**
 * Screener-level parity: the headline of a bundle's screener tier. Read from
 * the axiom-oracles comparison report the bundle names (Axiom against
 * PolicyEngine on a state's survey households): how many of the households
 * either engine finds eligible get the same eligibility and benefit from
 * both, and how many mismatches are Axiom's to fix.
 *
 * Households where neither engine finds anyone eligible match trivially, so
 * the headline leaves them out. Shares weigh households as the report's own
 * rates do: by survey weight in a weighted report, once each in an unweighted
 * one (its comparison weight is its household count).
 */

/** The parts of an axiom-oracles comparison report (axiom.comparison_report.v2) this reads. */
export interface ComparisonReport {
  case_count?: number;
  aggregates?: Array<{
    concept?: string;
    comparison?: string;
    description?: string;
    comparison_count?: number;
    /** The households' total weight: their count when the report is unweighted. */
    comparison_weight?: number;
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
    kind?: string;
    disposition?: { disposition?: string; linked_issue?: string | null } | null;
  }>;
  dashboard_truncation?: {
    total_case_rows?: number;
    shown_case_rows?: number;
    shown_mismatches?: number;
    total_mismatches?: number;
  };
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
    /** The reference the run compared against, where engines.versions does not name it. */
    oracle?: { policyengine_us?: string };
  };
}

/** Where a bundle's comparison lives: the bundle file's screener membership.comparison. */
export interface ComparisonSource {
  repo: string;
  suite: string;
  report: string;
  /** When the report file was last committed: the run's date when the report records none. */
  committed_at?: string | null;
}

/** One row of encodings.program_bundles.parity. */
export interface ScreenerParity {
  suite: string;
  report_url: string;
  generated_at: string | null;
  /** Where generated_at comes from: the report itself, or (a report that records no date) its file's newest commit. */
  dated_by?: "report" | "commit" | null;
  /** manual or ci, as the report records it. */
  run_kind: string | null;
  /** The leg could not run and re-stamped an earlier report. */
  reemitted: boolean;
  /** The reference version the run compared against. */
  policyengine_us: string | null;
  rulespec_sha: string | null;
  /** Every RuleSpec repo the run read, at its commit. */
  rulespecs?: Array<{ repo: string; sha: string }>;
  /** The shares weigh households by survey weight (true) or once each (false); null when the report does not say. */
  weighted?: boolean | null;
  /** Survey households compared, and how many match on every output. */
  households: number;
  households_matching: number;
  /** Households with at least one mismatched output; null when the report lists only some mismatches. */
  households_mismatched?: number | null;
  /** Share of households (weighted) each engine finds eligible. */
  eligible_policyengine: number | null;
  eligible_axiom: number | null;
  /**
   * Of the households either engine finds eligible (weighted), the share
   * that gets the same eligibility and benefit from both: the headline.
   */
  eligible_matching: number | null;
  /** Mismatched outputs (one per household and output), and those that are Axiom's to fix: unexplained or an encoding gap. */
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
  // Each mismatching household and the kinds of its mismatches, from the
  // mismatch list (which names every one when the report is not cut) and the
  // case rows (which a report may leave out).
  const kinds = new Map<string, Set<string>>();
  const note = (id: string, kind: string | undefined) => kinds.set(id, (kinds.get(id) ?? new Set()).add(kind ?? ""));
  for (const m of report.mismatches ?? []) if (m.case_id) note(m.case_id, m.kind);
  for (const c of cases) for (const m of c.mismatches ?? []) note(c.case_id, m.kind);

  const eligibility = (report.aggregates ?? []).find((a) => a.comparison === "eligibility");
  // Unweighted when the households' total weight is their count: each counts once.
  const weighted =
    eligibility?.comparison_weight != null && eligibility.comparison_count != null
      ? Math.abs(eligibility.comparison_weight - eligibility.comparison_count) > 1e-6
      : null;
  const caseWeights = new Map<string, number>();
  for (const c of cases) if (c.metadata?.household_weight != null) caseWeights.set(c.case_id, c.metadata.household_weight);
  const weightOf = (id: string) => caseWeights.get(id) ?? (weighted === false ? 1 : null);
  const truncation = report.dashboard_truncation;
  // Every mismatching household must be listed to weigh them.
  const complete = !truncation || truncation.shown_mismatches === truncation.total_mismatches;
  let eligibleMatching: number | null = null;
  if (eligibility && complete) {
    let rightOnly = 0;
    // Both engines find them eligible, but another output disagrees.
    let otherOnly = 0;
    let weighable = true;
    for (const [id, found] of kinds) {
      const weight = weightOf(id);
      // A weighted report that gives no weight for a mismatching household: no share rather than a wrong one.
      if (weight == null) {
        weighable = false;
        break;
      }
      if (found.has("eligibility_right_only")) rightOnly += weight;
      else if (![...found].some((k) => k.startsWith("eligibility_"))) otherOnly += weight;
    }
    if (weighable) {
      const policyengine = eligibility.right_positive_weight ?? 0;
      const axiom = eligibility.left_positive_weight ?? 0;
      const both = Math.max(0, policyengine - rightOnly);
      const either = policyengine + axiom - both;
      eligibleMatching = either > 0 ? Math.max(0, both - otherOnly) / either : null;
    }
  }

  const counts = report.summary?.dispositioned?.counts ?? {};
  const issues = new Map<string, number>();
  for (const m of report.mismatches ?? []) {
    const url = m.disposition?.linked_issue;
    if (url) issues.set(url, (issues.get(url) ?? 0) + 1);
  }
  const versions = report.engines?.versions ?? {};
  const dated = report.provenance?.generated_at ?? null;
  return {
    suite: source.suite,
    report_url: `https://github.com/${source.repo}/blob/main/${source.report}`,
    generated_at: dated ?? source.committed_at ?? null,
    dated_by: dated ? "report" : source.committed_at ? "commit" : null,
    run_kind: report.provenance?.run_kind ?? null,
    reemitted: report.provenance?.reemitted_report === true,
    policyengine_us: versions.policyengine_us ?? report.provenance?.oracle?.policyengine_us ?? null,
    rulespec_sha: report.provenance?.rulespecs?.[0]?.sha ?? null,
    rulespecs: (report.provenance?.rulespecs ?? []).flatMap((r) => (r.sha ? [{ repo: r.repo ?? "", sha: r.sha }] : [])),
    weighted,
    households,
    households_matching: Math.max(0, households - kinds.size),
    households_mismatched: complete ? kinds.size : null,
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

/** A run older than this is stale, whatever reference version it compared against. */
export const STALE_RUN_DAYS = 30;

/** Whether a run is stale by its age: older than STALE_RUN_DAYS days. */
export function staleRun(generatedAt: string | null, referenceMs: number): boolean {
  const at = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  return Number.isFinite(at) && referenceMs - at > STALE_RUN_DAYS * 86_400_000;
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
