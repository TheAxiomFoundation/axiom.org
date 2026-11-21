import { describe, expect, it } from "vitest";
import { isRunPeriodCoverageRefusal, parseRunPeriod } from "./run-period";

describe("parseRunPeriod", () => {
  it("accepts a calendar month", () => {
    expect(parseRunPeriod("2027-01")).toBe("2027-01");
    expect(parseRunPeriod(" 2027-12 ")).toBe("2027-12");
  });

  it.each([null, undefined, "", "2027", "2027-1", "2027-13", "2027-00", "2027-01-01", "27-01", "2027-01x", "1800-01"])(
    "refuses %s rather than guessing",
    (raw) => {
      expect(parseRunPeriod(raw as string | null | undefined)).toBeNull();
    },
  );
});

describe("isRunPeriodCoverageRefusal", () => {
  it("recognizes the engine's no-version-at-this-month refusal", () => {
    expect(isRunPeriodCoverageRefusal("derived `credit` has no formula version at 2026-11-01")).toBe(true);
  });

  it.each([null, undefined, "", "unknown derived output: credit", "RuleSpec rule `credit` has no formula version"])(
    "does not treat %s as a month problem",
    (message) => {
      expect(isRunPeriodCoverageRefusal(message as string | null | undefined)).toBe(false);
    },
  );
});
