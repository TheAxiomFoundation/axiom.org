import { describe, expect, it } from "vitest";
import { isRunPeriodCoverageRefusal, parseRunPeriod, runPeriodCoverageRule } from "./run-period";

// The remote /run-compiled runner formats the engine error with `{e:?}`,
// and axiom-api relays its HTTP body inside the message.
const debugRefusal = (rule: string) => `engine error: Eval(MissingDerivedFormulaVersion { derived: "${rule}", at: 2026-11-01 })`;
const relayedRefusal = (rule: string) => `Remote compiled runtime returned HTTP 422: ${JSON.stringify({ detail: debugRefusal(rule) })}`;

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

  it("recognizes the remote runner's debug form of the same refusal", () => {
    expect(isRunPeriodCoverageRefusal(debugRefusal("credit"))).toBe(true);
    expect(isRunPeriodCoverageRefusal(relayedRefusal("credit"))).toBe(true);
  });

  it.each([
    null,
    undefined,
    "",
    "unknown derived output: credit",
    "RuleSpec rule `credit` has no formula version",
    'engine error: Eval(UnknownDerived("credit"))',
    `Remote compiled runtime returned HTTP 422: ${JSON.stringify({ detail: 'engine error: Eval(UnknownDerived("credit"))' })}`,
  ])(
    "does not treat %s as a month problem",
    (message) => {
      expect(isRunPeriodCoverageRefusal(message as string | null | undefined)).toBe(false);
    },
  );
});

describe("runPeriodCoverageRule", () => {
  it.each([
    ["derived `phase_in` has no formula version at 2026-11-01", "phase_in"],
    [debugRefusal("phase_in"), "phase_in"],
    [relayedRefusal("phase_in"), "phase_in"],
  ])("names the rule %s refuses", (message, rule) => {
    expect(runPeriodCoverageRule(message)).toBe(rule);
  });

  it.each([null, "", "unknown derived output: phase_in", 'engine error: Eval(UnknownDerived("phase_in"))'])(
    "names no rule for %s",
    (message) => {
      expect(runPeriodCoverageRule(message)).toBeNull();
    },
  );
});
