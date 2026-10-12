import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ELIGIBILITY_NOT_TESTED,
  eligibilityNote,
  eligibilityTested,
  federalFiscalYear,
  otherDisclosures,
  snapStandardsYears,
  standardsMismatch,
} from "./coverage";

const AZ_NOTE =
  "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".";
const FY_NOTE =
  "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.";
const NY_NOTE = "New York: the household's earned-income input was set from the earnings given (has earned income).";

const listed = Object.keys(ELIGIBILITY_NOT_TESTED);

describe("programs whose eligibility the rules don't test", () => {
  it("lists Arizona SNAP, as finbot-snap-demo's request builder does", () => {
    expect(ELIGIBILITY_NOT_TESTED["us-az-snap"]).toEqual({ state: "Arizona", program: "SNAP" });
    expect(eligibilityTested("us-az-snap")).toBe(false);
  });

  it("treats every other program, and no program, as tested", () => {
    for (const id of ["us-ny-snap", "us-co-snap", "us-fiit", "snap", "", null, undefined]) {
      expect(eligibilityTested(id)).toBe(true);
    }
    // Object prototype keys are not programs.
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(eligibilityTested(id)).toBe(true);
    }
  });

  it("is untested exactly for the listed programs (any string)", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom(...listed)), (id) => {
        expect(eligibilityTested(id)).toBe(!listed.includes(id));
        expect(eligibilityNote(id) === null).toBe(eligibilityTested(id));
      }),
    );
  });

  it("says plainly that the answer is not an eligibility determination", () => {
    expect(eligibilityNote("us-az-snap")).toBe(
      "Not an eligibility determination: Axiom's Arizona SNAP rules don't test eligibility yet. Read this as the amount if eligible.",
    );
    expect(eligibilityNote("us-ny-snap")).toBeNull();
    expect(eligibilityNote(null)).toBeNull();
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
  it("flags FY2026 standards used for October 2026", () => {
    expect(standardsMismatch([2026], "2026-10")).toEqual({ used: [2026], due: 2027 });
  });

  it("stays quiet when the standards match, are unknown, or the period is not a month", () => {
    expect(standardsMismatch([2026], "2026-09")).toBeNull();
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
          const mismatch = standardsMismatch(used, period);
          expect(mismatch !== null).toBe(used.some((y) => y !== due));
          if (mismatch) expect(mismatch).toEqual({ used, due });
        },
      ),
    );
  });
});

describe("disclosures the panel states itself", () => {
  it("drops finbot's Arizona note and standards note, which the panel says in its own words", () => {
    expect(otherDisclosures({ program: "us-az-snap", disclosures: [AZ_NOTE, FY_NOTE] })).toEqual([]);
  });

  it("keeps everything else as the chatbot wrote it", () => {
    expect(otherDisclosures({ program: "us-ny-snap", disclosures: [FY_NOTE, NY_NOTE] })).toEqual([NY_NOTE]);
    // An eligibility note on a program the panel has no note for stays.
    expect(otherDisclosures({ program: "us-ny-snap", disclosures: [AZ_NOTE] })).toEqual([AZ_NOTE]);
    // Reworded standards notes stay rather than vanish.
    const reworded = "Standards: FY2026 (not FY2027).";
    expect(otherDisclosures({ program: "us-az-snap", disclosures: [reworded] })).toEqual([reworded]);
  });

  it("only removes, never adds or reorders, and removes only what the panel replaces", () => {
    const disclosure = fc.oneof(fc.constantFrom(AZ_NOTE, FY_NOTE, NY_NOTE), fc.string());
    fc.assert(
      fc.property(
        fc.constantFrom("us-az-snap", "us-ny-snap", "us-co-snap"),
        fc.array(disclosure, { maxLength: 6 }),
        (program, disclosures) => {
          const kept = otherDisclosures({ program, disclosures });
          // A subsequence of the input.
          let i = 0;
          for (const d of disclosures) if (i < kept.length && kept[i] === d) i++;
          expect(i).toBe(kept.length);
          for (const dropped of disclosures.filter((d) => !kept.includes(d))) {
            const standards = snapStandardsYears([], [dropped]).length > 0;
            const eligibility = !eligibilityTested(program) && /test eligibility/i.test(dropped);
            expect(standards || eligibility).toBe(true);
          }
        },
      ),
    );
  });
});
