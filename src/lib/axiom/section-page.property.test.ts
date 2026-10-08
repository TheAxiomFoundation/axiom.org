import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SectionReader } from "@/components/axiom/section/section-reader";
import {
  EXTERNAL_MATCH_MAX_AGE_DAYS,
  declaredExternalComparisons,
  type SectionPageData,
} from "./section-page";
import type { ParityCaseSummary } from "./runtime/api";

vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn() }),
}));

// Small alphabets so programs, jurisdictions, and engines collide often:
// the selection and per-engine counts can only go wrong when they do.
const programId = fc.constantFrom("co-snap", "snap", "eitc");
const jurisdiction = fc.constantFrom("us", "us-co", "us-ca");
const engine = fc.constantFrom("policyengine", "taxsim", "ukmod");
const program = fc.record({ programId, jurisdiction });
const NOW = new Date("2026-10-04T08:00:00.000Z");
const DAY = 86_400_000;
// Fresh, exactly at the window's edge, just past it, unparseable, absent.
const observedAt = fc.constantFrom<string | null>(
  "2026-10-03T12:41:07.512Z",
  new Date(NOW.getTime() - EXTERNAL_MATCH_MAX_AGE_DAYS * DAY).toISOString(),
  new Date(NOW.getTime() - EXTERNAL_MATCH_MAX_AGE_DAYS * DAY - 1).toISOString(),
  "not a date",
  null,
);
const comparisonResult = fc.record({
  engine,
  status: fc.constantFrom("match", "diff", "known_difference", "errored", null) as fc.Arbitrary<
    ParityCaseSummary["comparisonResults"][number]["status"]
  >,
  observedAt,
  engineVersion: fc.constantFrom("2.9.0", "2.10.0", null),
});
const parityCase: fc.Arbitrary<ParityCaseSummary> = fc
  .record({
    id: fc.string({ maxLength: 4 }),
    description: fc.constantFrom("", "Household A", "Household B"),
    program_id: programId,
    jurisdiction,
    comparisonResults: fc.array(comparisonResult, { maxLength: 4 }),
  })
  .map((item) => ({
    ...item,
    comparisonEngines: Array.from(new Set(item.comparisonResults.map((r) => r.engine))),
  }));

const current = (result: ParityCaseSummary["comparisonResults"][number], now: Date) =>
  result.status !== null &&
  result.observedAt !== null &&
  !Number.isNaN(Date.parse(result.observedAt)) &&
  now.getTime() - Date.parse(result.observedAt) <= EXTERNAL_MATCH_MAX_AGE_DAYS * DAY;
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

// A section with an encoding, so comparison visibility is exercised
// independently of the existing no-encoding hide rule.
const readerData: SectionPageData = {
  citationPath: "us/statute/26/32",
  root: {
    id: "root",
    jurisdiction: "us",
    doc_type: "statute",
    parent_id: null,
    level: 3,
    ordinal: 32,
    heading: "Earned income",
    body: null,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: null,
    citation_path: "us/statute/26/32",
    rulespec_path: null,
    has_rulespec: true,
    created_at: "",
    updated_at: "",
  },
  breadcrumbs: [],
  provisions: [],
  intro: null,
  bodyChunks: [],
  toc: [],
  rootRefs: [],
  encoding: null,
  encodedRules: [{ name: "eitc", kind: "derived", anchors: [] }],
  programs: [],
  ruleFiles: {},
  citedByFiles: [],
  citedByOverflow: 0,
  focusAnchor: null,
  prev: null,
  next: null,
  truncated: false,
  encodedCoverage: null,
  externalComparisons: null,
};

describe("declaredExternalComparisons invariants", () => {
  it("shows a chip iff every latest result matches and is fresh", () => {
    const result = fc.oneof(
      { weight: 3, arbitrary: fc.constant({
        engine: "policyengine",
        status: "match" as const,
        observedAt: NOW.toISOString(),
        engineVersion: "2.9.0",
      }) },
      { weight: 1, arbitrary: comparisonResult.map((entry) => ({
        ...entry,
        engine: "policyengine",
      })) },
    );
    fc.assert(
      fc.property(
        fc.array(fc.array(result, { maxLength: 3 }), { maxLength: 4 }),
        (resultsByCase) => {
          const cases: ParityCaseSummary[] = resultsByCase.map((results, index) => ({
            id: String(index),
            description: "Household",
            program_id: "co-snap",
            jurisdiction: "us-co",
            comparisonEngines: ["policyengine"],
            comparisonResults: results,
          }));
          // Independent oracle: empty declarations/results are hidden;
          // every comparison of every case must have a fresh latest match.
          const shouldShow = resultsByCase.length > 0 && resultsByCase.every(
            (results) => results.length > 0 && results.every((entry) =>
              entry.status === "match" && entry.observedAt !== null &&
              Date.parse(entry.observedAt) >= NOW.getTime() - 7 * DAY,
            ),
          );
          const html = renderToStaticMarkup(createElement(SectionReader, {
            data: {
              ...readerData,
              externalComparisons: declaredExternalComparisons(
                [{ programId: "co-snap", jurisdiction: "us-co" }], cases, NOW,
              ),
            },
          }));
          expect(html.includes("Matches PolicyEngine")).toBe(shouldShow);
          expect(html).not.toContain("PolicyEngine comparison");
          if (shouldShow) {
            const text = document.createElement("div");
            text.innerHTML = html;
            expect(text.textContent).toContain(
              `${cases.length} of ${cases.length} ${cases.length === 1 ? "case" : "cases"}`,
            );
          }
        },
      ),
      { numRuns: 500, seed: 2991020 },
    );
  });

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

  it("counts a case as matching iff every comparison with the engine is a current match", () => {
    fc.assert(
      fc.property(scenario, ({ programs, cases }) => {
        const result = declaredExternalComparisons(programs, cases, NOW);
        if (!result) return;
        for (const entry of result.engines) {
          const naming = casesOf(cases, result).filter((item) =>
            item.comparisonEngines.includes(entry.engine),
          );
          const matched = naming.filter((item) => {
            const own = item.comparisonResults.filter((r) => r.engine === entry.engine);
            return own.length > 0 && own.every((r) => current(r, NOW) && r.status === "match");
          });
          expect(entry.matchingCaseCount).toBe(matched.length);
          expect(entry.matchingCaseCount).toBeLessThanOrEqual(entry.caseCount);
          const times = matched.flatMap((item) =>
            item.comparisonResults
              .filter((r) => r.engine === entry.engine)
              .map((r) => Date.parse(r.observedAt!)),
          );
          if (matched.length === 0) {
            expect(entry.matchingAsOf).toBeNull();
            expect(entry.matchingEngineVersions).toEqual([]);
          } else {
            expect(Date.parse(entry.matchingAsOf!)).toBe(Math.min(...times));
          }
          const results = naming.flatMap((item) =>
            item.comparisonResults.filter((r) => r.engine === entry.engine),
          );
          const counts = entry.resultCounts;
          expect(counts.match + counts.known_difference + counts.diff + counts.errored + counts.none).toBe(
            results.length,
          );
          expect(counts.none).toBe(results.filter((r) => !current(r, NOW)).length);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("never gains matches as time passes", () => {
    fc.assert(
      fc.property(scenario, fc.integer({ min: 0, max: 30 }), ({ programs, cases }, days) => {
        const before = declaredExternalComparisons(programs, cases, NOW);
        const after = declaredExternalComparisons(
          programs,
          cases,
          new Date(NOW.getTime() + days * DAY),
        );
        before?.engines.forEach((entry, index) => {
          expect(after!.engines[index]!.matchingCaseCount).toBeLessThanOrEqual(
            entry.matchingCaseCount,
          );
        });
      }),
    );
  });

  it("orders engines by first declaration across the program's cases", () => {
    fc.assert(
      fc.property(scenario, ({ programs, cases }) => {
        const result = declaredExternalComparisons(programs, cases);
        if (!result) return;
        const order: string[] = [];
        for (const item of casesOf(cases, result)) {
          for (const engine of item.comparisonEngines) {
            if (!order.includes(engine)) order.push(engine);
          }
        }
        expect(result.engines.map((entry) => entry.engine)).toEqual(order);
      }),
    );
  });
});
