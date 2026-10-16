import { describe, expect, it } from "vitest";
import { olderVersion, screenerParity, staleRun, type ComparisonReport } from "./screener-parity";

const source = { repo: "TheAxiomFoundation/axiom-oracles", suite: "az-snap-ecps", report: "dashboard/public/data/r.json" };
const issue = "https://github.com/TheAxiomFoundation/rulespec-us/issues/1116";

// Four households, weights 10, 20, 30 and 40. PolicyEngine finds the first
// three eligible (weight 60), Axiom the second and third (weight 50). The
// first is eligible in PolicyEngine only; the second differs on the benefit.
const report: ComparisonReport = {
  case_count: 4,
  aggregates: [
    {
      concept: "us:statutes/7/2014/o#snap_eligible",
      comparison: "eligibility",
      description: "SNAP eligibility",
      mismatch_count: 1,
      right_positive_weight: 60,
      left_positive_weight: 50,
      right_positive_rate: 60,
      left_positive_rate: 50,
    },
    { concept: "us:statutes/7/2014/u#snap_benefit", comparison: "amount", description: "SNAP benefit amount", mismatch_count: 2 },
  ],
  cases: [
    {
      case_id: "h1",
      metadata: { household_weight: 10 },
      mismatches: [{ kind: "eligibility_right_only" }, { kind: "amount_difference" }],
    },
    { case_id: "h2", metadata: { household_weight: 20 }, mismatches: [{ kind: "amount_difference" }] },
  ],
  mismatches: [
    { case_id: "h1", disposition: { disposition: "axiom_encoding_gap", linked_issue: issue } },
    { case_id: "h1", disposition: { disposition: "axiom_encoding_gap", linked_issue: issue } },
    { case_id: "h2", disposition: { disposition: "upstream_engine_gap", linked_issue: null } },
  ],
  dashboard_truncation: { total_case_rows: 4, shown_mismatches: 3, total_mismatches: 3 },
  summary: { mismatch_count: 3, dispositioned: { counts: { axiom_encoding_gap: 2, upstream_engine_gap: 1, unexplained: 0 } } },
  engines: { versions: { policyengine_us: "1.767.3" } },
  provenance: { generated_at: "2026-07-28T22:20:39Z", run_kind: "manual", rulespecs: [{ sha: "c13cdf7" }] },
};

describe("screenerParity", () => {
  it("measures the households either engine finds eligible, leaving out trivial matches", () => {
    const parity = screenerParity(report, source);
    // Eligible in either engine: weight 60. Both, and every output the same: only h3 (30).
    expect(parity.eligible_matching).toBeCloseTo(0.5);
    expect(parity).toMatchObject({
      households: 4,
      households_matching: 2,
      eligible_policyengine: 0.6,
      eligible_axiom: 0.5,
      mismatches: 3,
      axiom_errors: 2,
      by_disposition: { axiom_encoding_gap: 2, upstream_engine_gap: 1 },
      issues: [{ url: issue, mismatches: 2 }],
      policyengine_us: "1.767.3",
      run_kind: "manual",
      report_url: "https://github.com/TheAxiomFoundation/axiom-oracles/blob/main/dashboard/public/data/r.json",
    });
    expect(parity.outputs.map((o) => [o.description, o.mismatches])).toEqual([
      ["SNAP eligibility", 1],
      ["SNAP benefit amount", 2],
    ]);
  });

  it("gives no share when Axiom finds nobody eligible and PolicyEngine does: 0%", () => {
    const none = screenerParity(
      {
        ...report,
        aggregates: [{ ...report.aggregates![0], left_positive_weight: 0, right_positive_weight: 10 }],
        cases: [report.cases![0]],
        mismatches: report.mismatches!.filter((m) => m.case_id === "h1"),
      },
      source
    );
    expect(none.eligible_matching).toBe(0);
  });

  it("does not weigh households when the report lists only some mismatches", () => {
    const cut = screenerParity({ ...report, dashboard_truncation: { shown_mismatches: 2, total_mismatches: 3 } }, source);
    expect(cut.eligible_matching).toBeNull();
    expect(cut.households_mismatched).toBeNull();
  });

  it("counts each household once in an unweighted report, from its mismatch list when it shows no case rows", () => {
    // Colorado's shape: 186 households eligible in both, no case rows, one benefit mismatch.
    const colorado: ComparisonReport = {
      case_count: 1072,
      aggregates: [
        {
          comparison: "eligibility",
          comparison_count: 1072,
          comparison_weight: 1072,
          left_positive_weight: 186,
          right_positive_weight: 186,
          left_positive_rate: 17.35,
          right_positive_rate: 17.35,
        },
      ],
      cases: [],
      mismatches: [
        {
          case_id: "ecps-spm-50970",
          concept: "us:statutes/7/2014/u#snap_benefit",
          kind: "amount_difference",
          disposition: { disposition: "explained_residual" },
        },
      ],
      dashboard_truncation: { total_case_rows: 1072, shown_case_rows: 0, shown_mismatches: 1, total_mismatches: 1 },
      summary: { mismatch_count: 1, dispositioned: { counts: { explained_residual: 1 } } },
      provenance: { generated_at: "2026-07-26T07:07:01Z", oracle: { policyengine_us: "1.705.1" } },
    };
    const parity = screenerParity(colorado, source);
    expect(parity.eligible_matching).toBeCloseTo(185 / 186);
    expect(parity).toMatchObject({ weighted: false, households_mismatched: 1, policyengine_us: "1.705.1", dated_by: "report" });
    // A weighted report that gives no weight for a mismatching household: no share rather than a wrong one.
    const weighted = screenerParity(
      { ...colorado, aggregates: [{ ...colorado.aggregates![0], comparison_weight: 3_482_952 }] },
      source
    );
    expect(weighted).toMatchObject({ eligible_matching: null, weighted: true });
  });

  it("dates a report that records no date by its file's newest commit, and names its RuleSpec commits", () => {
    const undated = screenerParity({ ...report, provenance: undefined }, { ...source, committed_at: "2026-07-01T21:32:18Z" });
    expect(undated).toMatchObject({ generated_at: "2026-07-01T21:32:18Z", dated_by: "commit" });
    expect(screenerParity(report, source)).toMatchObject({ dated_by: "report", rulespecs: [{ repo: "", sha: "c13cdf7" }] });
  });
});

describe("staleRun", () => {
  it("marks a run older than 30 days", () => {
    const now = Date.parse("2026-10-14T00:00:00Z");
    expect(staleRun("2026-07-28T22:20:39Z", now)).toBe(true);
    expect(staleRun("2026-10-01T00:00:00Z", now)).toBe(false);
    expect(staleRun(null, now)).toBe(false);
  });
});

describe("olderVersion", () => {
  it("compares release numbers part by part", () => {
    expect(olderVersion("1.767.3", "2.29.10")).toBe(true);
    expect(olderVersion("2.29.10", "2.29.10")).toBe(false);
    expect(olderVersion("2.29.11", "2.29.10")).toBe(false);
    expect(olderVersion(null, "2.29.10")).toBe(false);
  });
});
