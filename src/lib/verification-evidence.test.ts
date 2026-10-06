import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { enforcement, surfaces, usEvidenceRows } from "./verify-data";
import {
  countWord,
  formatCount,
  listJoin,
  PENDING_OUTPUTS,
  RULE_COVERAGE,
  ruleCoverageClause,
  SNAP_QC_REPLAYS,
  snapQcTotals,
  SOUTHMOD_CAVEATS,
  SOUTHMOD_FACTS,
  SOUTHMOD_MODELS,
  SOUTHMOD_SUITES,
  southmodAcknowledgement,
  southmodTotals,
  US_CONFORMANCE,
  type SouthmodSuite,
  type SnapQcReplay,
} from "./verification-evidence";

// The rows mirror files in axiom-oracles and rulespec-us at the commits
// each source names. These pins fail when a row changes without its total
// (or the reverse), so a refresh has to touch both.
describe("verification evidence: pinned totals", () => {
  it("US rule coverage: 14,030 of 34,810 rules on a compared program surface", () => {
    expect(RULE_COVERAGE.totalRules).toBe(34_810);
    expect(RULE_COVERAGE.rulesOnComparedSurface).toBe(14_030);
    expect(ruleCoverageClause()).toBe(
      "In September 2026, our coverage map tied 14,030 of our 34,810 US rules to a program that a live comparison exercises, though a comparison of a program does not check each of its rules",
    );
    expect(RULE_COVERAGE.source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("SNAP QC: 5,175 households in six states, Colorado 856", () => {
    expect(snapQcTotals()).toEqual({ states: 6, households: 5_175 });
    expect(SNAP_QC_REPLAYS.find((r) => r.state === "Colorado")?.households).toBe(856);
    // Texas runs from a branch, not rulespec-us main, so it is not counted.
    expect(SNAP_QC_REPLAYS.map((r) => r.state)).not.toContain("Texas");
  });

  it("SOUTHMOD: 40 suites, five countries, 242 of 245 match, 3 model gaps", () => {
    expect(southmodTotals()).toEqual({
      suites: 40,
      countries: 5,
      cases: 201,
      comparisons: 245,
      matches: 242,
      modelGaps: 3,
    });
    // Per-country tallies, which the rulespec debt issues of 2026-10-04 also
    // state (ug 64 of 64, zm 36 matching, gh 46 matches plus one finding).
    const byCountry = Object.fromEntries(
      SOUTHMOD_MODELS.map((m) => {
        const rows = SOUTHMOD_SUITES.filter((s) => s.suite.startsWith(`${m.prefix}-`));
        return [m.prefix, { ...southmodTotals(rows), countries: undefined }];
      }),
    );
    expect(byCountry.gh).toMatchObject({ suites: 9, comparisons: 47, matches: 46, modelGaps: 1 });
    expect(byCountry.ug).toMatchObject({ suites: 9, comparisons: 64, matches: 64, modelGaps: 0 });
    expect(byCountry.zm).toMatchObject({ suites: 8, comparisons: 36, matches: 36, modelGaps: 0 });
    expect(byCountry.et).toMatchObject({ suites: 6, comparisons: 34, matches: 32, modelGaps: 2 });
    expect(byCountry.rw).toMatchObject({ suites: 8, comparisons: 64, matches: 64, modelGaps: 0 });
  });

  it("every SOUTHMOD row is accounted for: each mismatch is a model gap", () => {
    for (const row of SOUTHMOD_SUITES) {
      expect(row.matches + row.modelGaps).toBe(row.comparisons);
      expect(row.cases).toBeGreaterThan(0);
      expect(row.comparisons).toBeGreaterThanOrEqual(row.cases);
    }
    expect(new Set(SOUTHMOD_SUITES.map((s) => s.suite)).size).toBe(SOUTHMOD_SUITES.length);
    // Every suite belongs to a named country model, and every model has suites.
    const prefixes = new Set(SOUTHMOD_SUITES.map((s) => s.suite.split("-")[0]));
    expect(prefixes).toEqual(new Set(SOUTHMOD_MODELS.map((m) => m.prefix)));
  });

  it("SOUTHMOD summary reads from the rows", () => {
    expect(SOUTHMOD_FACTS.summary).toBe(
      "40 suites compare our rules for Ghana, Uganda, Zambia, Ethiopia, and Rwanda: 242 of 245 comparisons match, and we attribute the other three to gaps in the models, with the arithmetic published.",
    );
  });
});

describe("verification evidence: SOUTHMOD caveats and acknowledgement", () => {
  it("states each caveat in its sentence", () => {
    for (const caveat of Object.values(SOUTHMOD_CAVEATS)) {
      expect(caveat.sentence).toContain(caveat.marker);
    }
  });

  it("only Rwanda lacks an input-data citation", () => {
    expect(SOUTHMOD_MODELS.filter((m) => m.data === null).map((m) => m.country)).toEqual(["Rwanda"]);
  });

  // Annex 1.2 of the SOUTHMOD_A4.0 Adhesion Agreement, fields filled in.
  it("fills in Annex 1.2: models, SOUTHMOD version, EUROMOD version", () => {
    const ack = southmodAcknowledgement();
    expect(ack).toMatch(
      /^The results presented here are based on the tax-benefit microsimulation models for Ghana \(GHAMOD\), Uganda \(UGAMOD\), Zambia \(MicroZAMOD\), Ethiopia \(ETMOD\), Rwanda \(RWAMOD\) in SOUTHMOD_A4\.0\. /,
    );
    expect(ack).toContain("The results presented here are based on EUROMOD version EM_Executable 1.0.0");
    expect(ack).toContain("are solely the Axiom Foundation's responsibility.");
    expect(ack).not.toMatch(/\[insert/i);
    for (const m of SOUTHMOD_MODELS) {
      if (m.data) expect(ack).toContain(`${m.model}: ${m.data}`);
    }
  });
});

// /verify's copy lives in verify-data.ts, which axiom.org#304 also edits, so
// it keeps literal strings. These pins hold them to the evidence rows.
describe("verification evidence: literal copy in verify-data.ts", () => {
  it("the pending-file count", () => {
    const line = enforcement.find((e) => e.startsWith("Coverage is tracked separately."));
    expect(line).toContain(
      `(${formatCount(PENDING_OUTPUTS.count)} US outputs in ${PENDING_OUTPUTS.month})`,
    );
  });

  it("the US conformance row", () => {
    const oracles = surfaces.find((s) => s.id === "oracles");
    expect(US_CONFORMANCE.unexplained).toBe(0);
    expect(US_CONFORMANCE.axiomAttributed).toBe(0);
    expect(oracles?.expect).toContain(
      `live suites cover ${US_CONFORMANCE.covered} of ${US_CONFORMANCE.inScope} in-scope PolicyEngine policies, so the US row is not yet conformant`,
    );
  });

  it("the Colorado SNAP QC row", () => {
    const co = SNAP_QC_REPLAYS.find((r) => r.state === "Colorado")!;
    const row = usEvidenceRows.find((r) => r.id === "co-snap-qc");
    expect(row?.scale).toBe(`${co.households} real FY 2024 administrative cases`);
    expect(row?.result).toContain(
      `All ${co.households} match at zero tolerance on the benefit Mathematica computes for USDA`,
    );
    expect(row?.result).toContain(
      `The maximum allotment matches USDA's FY 2024 table in all ${co.households}`,
    );
  });
});

// Invariants of the derivations, for any rows: totals are exact sums, so
// they do not depend on row order and add over concatenation; the rule
// coverage clause states the counts it is given and never claims that the
// rest of the rules had no comparison (the file does not measure that).
describe("verification evidence: invariants", () => {
  const suiteRow: fc.Arbitrary<SouthmodSuite> = fc
    .record({
      prefix: fc.constantFrom("gh", "ug", "zm", "et", "rw"),
      name: fc.string({ minLength: 1, maxLength: 6 }),
      cases: fc.nat(50),
      matches: fc.nat(50),
      modelGaps: fc.nat(5),
    })
    .map(({ prefix, name, cases, matches, modelGaps }) => ({
      suite: `${prefix}-${name}`,
      cases,
      comparisons: matches + modelGaps,
      matches,
      modelGaps,
    }));

  it("southmodTotals is order-free and additive", () => {
    fc.assert(
      fc.property(fc.array(suiteRow, { maxLength: 30 }), fc.array(suiteRow, { maxLength: 30 }), (a, b) => {
        const ta = southmodTotals(a);
        const tb = southmodTotals(b);
        expect(southmodTotals([...a].reverse())).toEqual(ta);
        const tab = southmodTotals([...a, ...b]);
        expect(tab.suites).toBe(ta.suites + tb.suites);
        expect(tab.comparisons).toBe(ta.comparisons + tb.comparisons);
        expect(tab.matches).toBe(ta.matches + tb.matches);
        expect(tab.modelGaps).toBe(ta.modelGaps + tb.modelGaps);
        expect(tab.matches + tab.modelGaps).toBe(tab.comparisons);
        expect(tab.countries).toBeLessThanOrEqual(ta.countries + tb.countries);
        expect(tab.countries).toBeLessThanOrEqual(5);
      }),
    );
  });

  it("snapQcTotals is order-free and additive", () => {
    const replay: fc.Arbitrary<SnapQcReplay> = fc.record({
      state: fc.string(),
      suite: fc.string(),
      households: fc.nat(5000),
    });
    fc.assert(
      fc.property(fc.array(replay, { maxLength: 20 }), fc.array(replay, { maxLength: 20 }), (a, b) => {
        const ta = snapQcTotals(a);
        const tb = snapQcTotals(b);
        expect(snapQcTotals([...a].reverse())).toEqual(ta);
        expect(snapQcTotals([...a, ...b])).toEqual({
          states: ta.states + tb.states,
          households: ta.households + tb.households,
        });
      }),
    );
  });

  it("the rule coverage clause states the on-surface count of the total, and no uncompared count", () => {
    expect(RULE_COVERAGE.rulesOnComparedSurface).toBeLessThanOrEqual(RULE_COVERAGE.totalRules);
    fc.assert(
      fc.property(fc.nat(100_000), fc.nat(100_000), (x, y) => {
        const totalRules = Math.max(x, y);
        const rulesOnComparedSurface = Math.min(x, y);
        const clause = ruleCoverageClause({ month: "May 2027", totalRules, rulesOnComparedSurface });
        expect(clause).toContain(
          `tied ${formatCount(rulesOnComparedSurface)} of our ${formatCount(totalRules)} US rules to a program that a live comparison exercises`,
        );
        expect(clause).toContain("does not check each of its rules");
        expect(clause).not.toMatch(/no comparison/i);
      }),
    );
  });

  it("listJoin keeps every item, in order, once", () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[A-Z][a-z]{1,8}$/), { minLength: 1, maxLength: 8 }), (items) => {
        const joined = listJoin(items);
        const back = joined.split(/, and |, | and /);
        expect(back).toEqual(items);
      }),
    );
  });

  it("countWord spells out zero to ten and formats the rest", () => {
    expect(countWord(3)).toBe("three");
    expect(countWord(6)).toBe("six");
    fc.assert(
      fc.property(fc.integer({ min: 11, max: 10_000_000 }), (n) => {
        expect(countWord(n)).toBe(formatCount(n));
      }),
    );
  });
});
