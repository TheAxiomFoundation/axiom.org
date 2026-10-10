import { describe, expect, it } from "vitest";
import { olderVersion, screenerParity, type ComparisonReport } from "./screener-parity";

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
      },
      source
    );
    expect(none.eligible_matching).toBe(0);
  });

  it("does not weigh households when the report lists only some mismatches", () => {
    const cut = screenerParity({ ...report, dashboard_truncation: { shown_mismatches: 2, total_mismatches: 3 } }, source);
    expect(cut.eligible_matching).toBeNull();
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
