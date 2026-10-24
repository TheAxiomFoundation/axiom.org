import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ELIGIBILITY_NOT_TESTED, testsEligibility } from "./coverage";

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
  });

  it("keeps the verdict saved with a check, whatever the list says today", () => {
    expect(testsEligibility({ program: "us-az-snap", eligibilityTested: true })).toBe(true);
    expect(testsEligibility({ program: "us-ny-snap", eligibilityTested: false })).toBe(false);
    expect(testsEligibility({ program: "us-az-snap", eligibilityTested: null })).toBe(false);
  });

  it("is untested exactly for listed programs or a saved false", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(...ELIGIBILITY_NOT_TESTED, "us-ny-snap"), fc.constant(null)),
        fc.constantFrom(true, false, null, undefined),
        (program, eligibilityTested) => {
          const expected =
            typeof eligibilityTested === "boolean" ? eligibilityTested : program === null || !ELIGIBILITY_NOT_TESTED.includes(program);
          expect(testsEligibility({ program, eligibilityTested })).toBe(expected);
        },
      ),
    );
  });
});
