import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ELIGIBILITY_NOT_TESTED,
  eligibilityNote,
  federalFiscalYear,
  otherDisclosures,
  snapStandardsYears,
  standardsMismatch,
  testsEligibility,
} from "./coverage";

// finbot-snap-demo's wording (src/lib/catalog-overlay.ts, origin/main 87fa9db).
const AZ_NOTE =
  "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".";
const FY_NOTE =
  "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.";
const NY_NOTE = "New York: the household's earned-income input was set from the earnings given (has earned income).";
const CO_NOTE =
  "Axiom can't apply Colorado's broad-based categorical eligibility yet. A $0 for a household with gross income above the 130% limit but within the state's higher BBCE limit is not a determination; it may still qualify.";

describe("rules that don't test eligibility", () => {
  it("lists Arizona SNAP, as finbot-snap-demo's request builder does", () => {
    expect(ELIGIBILITY_NOT_TESTED).toEqual(["us-az-snap"]);
    expect(testsEligibility({ program: "us-az-snap" })).toBe(false);
  });

  it("treats every other program, and no program, as tested", () => {
    for (const program of ["us-ny-snap", "us-co-snap", "us-fiit", "snap", "", null]) {
      expect(testsEligibility({ program })).toBe(true);
    }
    for (const program of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(testsEligibility({ program })).toBe(true);
    }
    // BBCE and categorical-input limits are other limits, not "doesn't test eligibility".
    expect(testsEligibility({ program: "us-co-snap", disclosures: [CO_NOTE, FY_NOTE] })).toBe(true);
  });

  it("also catches a program whose result says it doesn't test eligibility", () => {
    expect(testsEligibility({ program: "us-xx-snap", disclosures: [AZ_NOTE] })).toBe(false);
    expect(testsEligibility({ program: "us-xx-snap", disclosures: ["Its rules don’t test eligibility yet."] })).toBe(false);
    expect(testsEligibility({ program: "us-xx-snap", disclosures: ["It does not test eligibility yet."] })).toBe(false);
  });

  it("keeps the verdict saved with a check, whatever the list says today", () => {
    expect(testsEligibility({ program: "us-az-snap", eligibilityTested: true })).toBe(true);
    expect(testsEligibility({ program: "us-ny-snap", eligibilityTested: false })).toBe(false);
    expect(testsEligibility({ program: "us-az-snap", eligibilityTested: null })).toBe(false);
  });

  it("is untested exactly for listed programs, programs that say so, or a saved false", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(...ELIGIBILITY_NOT_TESTED, "us-ny-snap")),
        fc.array(fc.oneof(fc.constantFrom(AZ_NOTE, FY_NOTE, NY_NOTE, CO_NOTE), fc.string()), { maxLength: 4 }),
        fc.constantFrom(true, false, null, undefined),
        (program, disclosures, eligibilityTested) => {
          const said = disclosures.some((d) => /\b(?:does|do)(?:n['\u2019]t| not) test eligibility\b/i.test(d));
          const expected = typeof eligibilityTested === "boolean" ? eligibilityTested : !ELIGIBILITY_NOT_TESTED.includes(program) && !said;
          expect(testsEligibility({ program, disclosures, eligibilityTested })).toBe(expected);
        },
      ),
    );
  });

  it("says plainly that the answer is not an eligibility determination", () => {
    expect(eligibilityNote({ program: "us-az-snap", displayName: "Arizona SNAP" })).toBe(
      "Not an eligibility determination: Axiom's Arizona SNAP rules don't test eligibility yet. Read this as the amount if eligible.",
    );
    expect(eligibilityNote({ program: "us-ny-snap", displayName: "New York SNAP" })).toBeNull();
  });
});

describe("federal fiscal years", () => {
  it("starts each fiscal year in October", () => {
    expect(federalFiscalYear("2026-09")).toBe(2026);
    expect(federalFiscalYear("2026-10")).toBe(2027);
    expect(federalFiscalYear("2026-12")).toBe(2027);
    expect(federalFiscalYear("2027-01")).toBe(2027);
  });

  it("has no fiscal year for a period that is not a month", () => {
    for (const period of ["2026", "2026-13", "2026-00", "2026-1", "Oct 2026", "", null, undefined]) {
      expect(federalFiscalYear(period)).toBeNull();
    }
  });

  it("puts October through the next September in one fiscal year, a year after October's", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 9998 }), fc.integer({ min: 0, max: 11 }), (year, offset) => {
        // offset 0 = October of `year`, 11 = September of `year + 1`.
        const month = ((9 + offset) % 12) + 1;
        const calendarYear = year + (offset >= 3 ? 1 : 0);
        const period = `${calendarYear}-${String(month).padStart(2, "0")}`;
        expect(federalFiscalYear(period)).toBe(year + 1);
      }),
    );
  });
});

describe("SNAP standards years", () => {
  it("reads the year from the USDA COLA documents the outputs cite", () => {
    expect(
      snapStandardsYears(
        [
          "us:policies/usda/snap/state-plan-composition#snap_benefit",
          "us:policies/usda/snap/fy-2026-cola/maximum-allotments#snap_maximum_allotment",
          "us:policies/usda/snap/fy-2026-cola/deductions#snap_standard_deduction",
          null,
        ],
        [],
      ),
    ).toEqual([2026]);
  });

  it("prefers cited documents to the chatbot's disclosure, and falls back to it", () => {
    expect(snapStandardsYears(["us:policies/usda/snap/fy-2027-cola/deductions#x"], [FY_NOTE])).toEqual([2027]);
    expect(snapStandardsYears(["us:statutes/7/2017/a#x"], [NY_NOTE, FY_NOTE])).toEqual([2026]);
    expect(snapStandardsYears([], [NY_NOTE])).toEqual([]);
  });

  it("ignores state documents and look-alike ids", () => {
    expect(
      snapStandardsYears(
        [
          "us-az:policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation#snap_eligible",
          "us:policies/usda/wic/fy-2026-cola/x#y",
          "xus:policies/usda/snap/fy-2026-cola/x#y",
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("returns each cited year once, oldest first", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 2000, max: 2099 }), { maxLength: 8 }), (years) => {
        const ids = years.map((y) => `us:policies/usda/snap/fy-${y}-cola/deductions#x`);
        const found = snapStandardsYears(ids, [FY_NOTE]);
        if (years.length === 0) expect(found).toEqual([2026]);
        else expect(found).toEqual([...new Set(years)].sort((a, b) => a - b));
      }),
    );
  });
});

describe("standards that don't match the period", () => {
  it("flags FY2026 standards used for October 2026, and says FY2027's aren't encoded when finbot says so", () => {
    expect(standardsMismatch([2026], "2026-10", [FY_NOTE])).toEqual({ used: [2026], due: 2027, notEncoded: true });
    expect(standardsMismatch([2026], "2026-10")).toEqual({ used: [2026], due: 2027, notEncoded: false });
    // finbot's note names FY2027; November 2027 is in FY2028, which it says nothing about.
    expect(standardsMismatch([2026], "2027-11", [FY_NOTE])).toEqual({ used: [2026], due: 2028, notEncoded: false });
  });

  it("stays quiet when the standards match, are unknown, or the period is not a month", () => {
    expect(standardsMismatch([2026], "2026-09", [FY_NOTE])).toBeNull();
    expect(standardsMismatch([], "2026-10")).toBeNull();
    expect(standardsMismatch([2026], "2026")).toBeNull();
    expect(standardsMismatch([2026], null)).toBeNull();
  });

  it("flags a period exactly when some standards year differs from its fiscal year", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 2020, max: 2030 }), { maxLength: 3 }),
        fc.integer({ min: 2019, max: 2030 }),
        fc.integer({ min: 1, max: 12 }),
        (used, year, month) => {
          const period = `${year}-${String(month).padStart(2, "0")}`;
          const due = federalFiscalYear(period)!;
          const mismatch = standardsMismatch(used, period, [FY_NOTE]);
          expect(mismatch !== null).toBe(used.some((y) => y !== due));
          if (mismatch) expect(mismatch).toEqual({ used, due, notEncoded: due === 2027 });
        },
      ),
    );
  });
});

describe("disclosures the panel states itself", () => {
  const az = { program: "us-az-snap", period: "2026-10" };

  it("drops finbot's Arizona note and, for a month, its standards note", () => {
    expect(otherDisclosures({ ...az, disclosures: [AZ_NOTE, FY_NOTE] })).toEqual([]);
    // Curly quotes and apostrophes are the same sentence.
    const curly = "Axiom\u2019s Arizona SNAP encoding doesn\u2019t test eligibility yet: every household shows as eligible, so read the amount as \u201cif eligible\u201d.";
    expect(otherDisclosures({ ...az, disclosures: [curly] })).toEqual([]);
  });

  it("keeps the standards note for a period that is not a month, where the panel can't compare years", () => {
    expect(otherDisclosures({ ...az, period: "2026", disclosures: [AZ_NOTE, FY_NOTE] })).toEqual([FY_NOTE]);
    expect(otherDisclosures({ ...az, period: null, disclosures: [FY_NOTE] })).toEqual([FY_NOTE]);
  });

  it("keeps an eligibility note with more in it, or one the panel doesn't replace", () => {
    const longer = "Arizona SNAP rules do not test eligibility yet. Shelter costs are not included in this amount.";
    // The result still reads as untested (the panel shows its note), and the extra limit stays.
    expect(testsEligibility({ program: "us-xx-snap", disclosures: [longer] })).toBe(false);
    expect(otherDisclosures({ program: "us-xx-snap", period: "2026-10", disclosures: [longer] })).toEqual([longer]);
    // A saved "tested" verdict means no panel note, so finbot's sentence stays.
    expect(otherDisclosures({ ...az, eligibilityTested: true, disclosures: [AZ_NOTE] })).toEqual([AZ_NOTE]);
  });

  it("keeps everything else as the chatbot wrote it", () => {
    expect(otherDisclosures({ ...az, program: "us-ny-snap", disclosures: [FY_NOTE, NY_NOTE, CO_NOTE] })).toEqual([NY_NOTE, CO_NOTE]);
    // A standards note with more added to it stays whole.
    const longer = `${FY_NOTE} Shelter caps also changed.`;
    expect(otherDisclosures({ ...az, disclosures: [longer] })).toEqual([longer]);
    // Reworded standards notes stay rather than vanish.
    const reworded = "Standards: FY2026 (not FY2027).";
    expect(otherDisclosures({ ...az, disclosures: [reworded] })).toEqual([reworded]);
    expect(otherDisclosures(az)).toEqual([]);
  });
});
