import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { declaredExternalComparisons } from "./section-page";
import type { ParityCaseSummary } from "./runtime/api";

// Small alphabets so programs, jurisdictions, and engines collide often:
// the selection and per-engine counts can only go wrong when they do.
const programId = fc.constantFrom("co-snap", "snap", "eitc");
const jurisdiction = fc.constantFrom("us", "us-co", "us-ca");
const engine = fc.constantFrom("policyengine", "taxsim", "ukmod");
const program = fc.record({ programId, jurisdiction });
const parityCase: fc.Arbitrary<ParityCaseSummary> = fc.record({
  id: fc.string({ maxLength: 4 }),
  description: fc.constantFrom("", "Household A", "Household B"),
  program_id: programId,
  jurisdiction,
  comparisonEngines: fc.array(engine, { maxLength: 3 }),
});
const scenario = fc.record({
  programs: fc.array(program, { maxLength: 4 }),
  cases: fc.array(parityCase, { maxLength: 8 }),
});

const casesOf = (
  cases: ParityCaseSummary[],
  target: { programId: string; jurisdiction: string },
) =>
  cases.filter(
    (item) =>
      item.program_id === target.programId &&
      item.jurisdiction === target.jurisdiction,
  );

describe("declaredExternalComparisons invariants", () => {
  it("picks the first covering program whose cases declare any engine, or none", () => {
    fc.assert(
      fc.property(scenario, ({ programs, cases }) => {
        const expected = programs.find((target) =>
          casesOf(cases, target).some((item) => item.comparisonEngines.length > 0),
        );
        const result = declaredExternalComparisons(programs, cases);
        if (!expected) {
          expect(result).toBeNull();
          return;
        }
        expect(result).not.toBeNull();
        expect(result!.programId).toBe(expected.programId);
        expect(result!.jurisdiction).toBe(expected.jurisdiction);
      }),
    );
  });

  it("lists exactly the declared engines, each counting the cases that name it", () => {
    fc.assert(
      fc.property(scenario, ({ programs, cases }) => {
        const result = declaredExternalComparisons(programs, cases);
        if (!result) return;
        const own = casesOf(cases, result);
        const declared = new Set(own.flatMap((item) => item.comparisonEngines));
        expect(result.engines.map((entry) => entry.engine).sort()).toEqual(
          [...declared].sort(),
        );
        for (const entry of result.engines) {
          const naming = own.filter((item) =>
            item.comparisonEngines.includes(entry.engine),
          );
          expect(entry.caseCount).toBe(naming.length);
          expect(entry.caseCount).toBeGreaterThan(0);
          expect(entry.caseDescriptions).toEqual(
            naming.map((item) => item.description).filter(Boolean),
          );
        }
      }),
    );
  });

  it("does not depend on cases for programs outside the coverage list", () => {
    fc.assert(
      fc.property(scenario, parityCase, ({ programs, cases }, stray) => {
        fc.pre(
          !programs.some(
            (target) =>
              target.programId === stray.program_id &&
              target.jurisdiction === stray.jurisdiction,
          ),
        );
        expect(declaredExternalComparisons(programs, [...cases, stray])).toEqual(
          declaredExternalComparisons(programs, cases),
        );
      }),
    );
  });
});
