import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SectionReader } from "@/components/axiom/section/section-reader";
import {
  EXTERNAL_MATCH_CLOCK_SKEW_MS,
  EXTERNAL_MATCH_MAX_AGE_DAYS,
  declaredExternalComparisons,
  rfc3339Instant,
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
const MAX_AGE = EXTERNAL_MATCH_MAX_AGE_DAYS * DAY;
const SKEW = EXTERNAL_MATCH_CLOCK_SKEW_MS;
const pad = (value: number, width = 2) => String(value).padStart(width, "0");
/** The instant `ms` written with a UTC offset of `offsetMinutes` (0
 *  writes Z) and `extra` digits after the milliseconds, or, for a null
 *  offset, as UTC wall-clock time with no offset at all. */
const write = (ms: number, offsetMinutes: number | null, extra = "") => {
  const local = new Date(ms + (offsetMinutes ?? 0) * 60_000).toISOString().slice(0, 23) + extra;
  if (offsetMinutes === null) return local;
  if (offsetMinutes === 0) return `${local}Z`;
  const abs = Math.abs(offsetMinutes);
  return `${local}${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};
const at = (offsetMs: number) => write(NOW.getTime() + offsetMs, 0);
const atOffset = (offsetMs: number, hours: number) => write(NOW.getTime() + offsetMs, hours * 60);
const zoneless = (offsetMs: number) => write(NOW.getTime() + offsetMs, null);
/** NOW + offsetMs, mostly written in UTC, sometimes with another
 *  offset, sometimes with none. */
const written = (offsetMs: fc.Arbitrary<number>) =>
  fc.oneof(
    { weight: 4, arbitrary: offsetMs.map(at) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(offsetMs, fc.constantFrom(2, -5, 14, -12))
        .map(([ms, hours]) => atOffset(ms, hours)),
    },
    { weight: 1, arbitrary: offsetMs.map(zoneless) },
  );
// Timestamps naming an instant at most the clock-skew tolerance ahead
// of NOW: fresh, each edge of the window, just past the old edge,
// anywhere from two days before the window opens, in UTC or another
// offset. Also ones that name no instant, so never count: without an
// offset, unparseable, absent.
const observedNotAhead = fc.oneof(
  fc.constantFrom<string | null>(
    "2026-10-03T12:41:07.512Z",
    at(-MAX_AGE),
    at(-MAX_AGE - 1),
    at(0),
    at(1),
    at(SKEW),
    atOffset(-MAX_AGE, 14),
    atOffset(SKEW, -12),
    zoneless(0),
    zoneless(-DAY),
    "not a date",
    null,
  ),
  written(fc.integer({ min: -MAX_AGE - 2 * DAY, max: SKEW })),
  written(fc.integer({ min: -2 * SKEW, max: 2 * SKEW }).map((offsetMs) => offsetMs - MAX_AGE)),
);
// Any timestamp: the above, plus ones dated ahead of NOW on both sides
// of the tolerance, one millisecond past it, days ahead, decades ahead.
const observedAt = fc.oneof(
  { weight: 2, arbitrary: observedNotAhead },
  {
    weight: 1,
    arbitrary: fc.oneof(
      fc.constantFrom<string | null>(
        at(SKEW + 1),
        atOffset(SKEW + 1, 2),
        at(DAY),
        "2099-10-08T00:00:00.000Z",
      ),
      written(fc.integer({ min: -SKEW, max: 2 * SKEW })),
      written(fc.integer({ min: SKEW + 1, max: 2 * MAX_AGE })),
    ),
  },
);
const comparisonResultAt = (when: fc.Arbitrary<string | null>) =>
  fc.record({
    engine,
    status: fc.constantFrom("match", "diff", "known_difference", "errored", null) as fc.Arbitrary<
      ParityCaseSummary["comparisonResults"][number]["status"]
    >,
    observedAt: when,
    engineVersion: fc.constantFrom("2.9.0", "2.10.0", null),
  });
const parityCaseAt = (when: fc.Arbitrary<string | null>): fc.Arbitrary<ParityCaseSummary> =>
  fc
    .record({
      id: fc.string({ maxLength: 4 }),
      description: fc.constantFrom("", "Household A", "Household B"),
      program_id: programId,
      jurisdiction,
      comparisonResults: fc.array(comparisonResultAt(when), { maxLength: 4 }),
    })
    .map((item) => ({
      ...item,
      comparisonEngines: Array.from(new Set(item.comparisonResults.map((r) => r.engine))),
    }));
const scenarioAt = (when: fc.Arbitrary<string | null>) =>
  fc.record({
    programs: fc.array(program, { maxLength: 4 }),
    cases: fc.array(parityCaseAt(when), { maxLength: 8 }),
  });
const comparisonResult = comparisonResultAt(observedAt);
const parityCase = parityCaseAt(observedAt);
const scenario = scenarioAt(observedAt);

// Whether a timestamp ends in a UTC offset. Over the strings these
// generators make, that is exactly the RFC 3339 date-times.
const namesOffset = (observedAt: string) => /(?:Z|[+-]\d\d:\d\d)$/.test(observedAt);
// A result is current when it has a status and its timestamp names a
// UTC offset and lies in [now - 7 days, now + clock-skew tolerance],
// both ends included.
const current = (result: ParityCaseSummary["comparisonResults"][number], now: Date) => {
  if (result.status === null || result.observedAt === null) return false;
  if (!namesOffset(result.observedAt)) return false;
  const age = now.getTime() - Date.parse(result.observedAt);
  return age >= -SKEW && age <= MAX_AGE;
};

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
  it("shows a chip iff every latest result matches and its timestamp is within [now - 7 days, now + tolerance]", () => {
    const freshMatch = {
      engine: "policyengine",
      status: "match" as const,
      observedAt: NOW.toISOString() as string | null,
      engineVersion: "2.9.0",
    };
    const result = fc.oneof(
      { weight: 4, arbitrary: fc.constant(freshMatch) },
      // A match at any timestamp, so the window alone decides.
      { weight: 1, arbitrary: observedAt.map((when) => ({ ...freshMatch, observedAt: when })) },
      { weight: 1, arbitrary: comparisonResult.map((entry) => ({
        ...entry,
        engine: "policyengine",
      })) },
    );
    // Runs decided by one condition alone, counted so the generators
    // cannot drift away from either edge, or from offset-less
    // timestamps, unnoticed.
    const seen = { shown: 0, hiddenOnlyAsStale: 0, hiddenOnlyAsAhead: 0, hiddenOnlyAsNoOffset: 0 };
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
          // every comparison of every case must have a latest match
          // observed no more than 7 days ago and no more than 5 minutes
          // (clock skew) ahead of now. A timestamp without a UTC offset
          // names no instant, so it is within no window. The window is
          // written out here, not imported, so it cannot move with the
          // constants.
          const everyMatch = (accept: (observedAt: string) => boolean) =>
            resultsByCase.length > 0 && resultsByCase.every(
              (results) => results.length > 0 && results.every((entry) =>
                entry.status === "match" && entry.observedAt !== null &&
                accept(entry.observedAt),
              ),
            );
          const notStale = (observedAt: string) =>
            Date.parse(observedAt) >= NOW.getTime() - 7 * DAY;
          const notAhead = (observedAt: string) =>
            Date.parse(observedAt) <= NOW.getTime() + 5 * 60_000;
          const shouldShow = everyMatch(
            (when) => namesOffset(when) && notStale(when) && notAhead(when),
          );
          if (shouldShow) seen.shown += 1;
          else if (everyMatch((when) => namesOffset(when) && notAhead(when))) seen.hiddenOnlyAsStale += 1;
          else if (everyMatch((when) => namesOffset(when) && notStale(when))) seen.hiddenOnlyAsAhead += 1;
          else if (everyMatch((when) => notStale(when) && notAhead(when))) seen.hiddenOnlyAsNoOffset += 1;
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
    expect(seen.shown).toBeGreaterThan(0);
    expect(seen.hiddenOnlyAsStale).toBeGreaterThan(0);
    expect(seen.hiddenOnlyAsAhead).toBeGreaterThan(0);
    expect(seen.hiddenOnlyAsNoOffset).toBeGreaterThan(0);
  });

  it("counts a lone match from the tolerance before its timestamp until 7 days after it, whenever it was observed and whatever offset it is written in", () => {
    // The result depends only on now - timestamp, and is current over
    // one unbroken stretch of time: [timestamp - 5 minutes, timestamp + 7 days].
    // A timestamp without a UTC offset is never current. Digits past the
    // millisecond put the timestamp a fraction of a millisecond later,
    // which matters only at the newest edge.
    const elapsed = fc.oneof(
      fc.constantFrom(-5 * 60_000 - 1, -5 * 60_000, -1, 0, 1, 7 * DAY, 7 * DAY + 1),
      fc.integer({ min: -10 * 60_000, max: 10 * 60_000 }),
      fc.integer({ min: -14 * DAY, max: 14 * DAY }),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1971, 0, 1), max: Date.UTC(2100, 0, 1) }),
        elapsed,
        fc.constantFrom<number | null>(0, 0, 0, 2, -5, 14, -12, null),
        fc.constantFrom("", "", "000", "0001", "5", "999999"),
        (observedMs, elapsedMs, hours, extra) => {
          const outcome = declaredExternalComparisons(
            [{ programId: "co-snap", jurisdiction: "us-co" }],
            [{
              id: "a",
              description: "Household",
              program_id: "co-snap",
              jurisdiction: "us-co",
              comparisonEngines: ["policyengine"],
              comparisonResults: [{
                engine: "policyengine",
                status: "match",
                observedAt: write(observedMs, hours === null ? null : hours * 60, extra),
                engineVersion: "2.9.0",
              }],
            }],
            new Date(observedMs + elapsedMs),
          );
          // The timestamp is observedMs + f with 0 <= f < 1, and f > 0
          // exactly when a digit past the millisecond is nonzero.
          const later = /[1-9]/.test(extra);
          const notAhead = elapsedMs > -5 * 60_000 || (elapsedMs === -5 * 60_000 && !later);
          expect(outcome!.engines[0]!.matchingCaseCount).toBe(
            hours !== null && notAhead && elapsedMs <= 7 * DAY ? 1 : 0,
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  // Instants whose written years stay within four digits under any offset.
  const instant = fc.integer({ min: Date.UTC(1000, 0, 2), max: Date.UTC(9998, 11, 30) });
  const offsetMinutes = fc.oneof(
    fc.constantFrom(0, 0, 60, -300, 330, 345, -570, 780, 840, -720),
    fc.integer({ min: -(23 * 60 + 59), max: 23 * 60 + 59 }),
  );
  const extraDigits = fc.array(fc.constantFrom(..."0123456789"), { maxLength: 12 }).map((d) => d.join(""));

  it("reads every RFC 3339 date-time as the instant it names, as Date.parse does", () => {
    // Differential: an independent parser (V8's) agrees on the
    // millisecond for every valid date-time, whatever its offset or
    // case; finer digits only mark the instant as later. V8 itself
    // misreads some fractions of ten or more digits
    // (".0006000000" as 6 ms), so the comparison stops at nine.
    fc.assert(
      fc.property(instant, offsetMinutes, extraDigits, fc.boolean(), (ms, offset, extra, lower) => {
        const written = write(ms, offset, extra);
        const value = lower ? written.replace("T", "t").replace("Z", "z") : written;
        expect(rfc3339Instant(value)).toEqual({ ms, later: /[1-9]/.test(extra) });
        if (3 + extra.length <= 9) expect(Date.parse(value)).toBe(ms);
      }),
      { numRuns: 1000 },
    );
  });

  it("rejects a date-time with any field out of range", () => {
    // Start from a valid date-time that would count at its own instant,
    // then put one field out of range.
    const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    fc.assert(
      fc.property(
        instant,
        offsetMinutes,
        fc.constantFrom("month", "day", "hour", "minute", "second", "offsetHour", "offsetMinute"),
        fc.nat(),
        (ms, offset, field, pick) => {
          const local = new Date(ms + offset * 60_000);
          const fields = {
            year: local.getUTCFullYear(),
            month: local.getUTCMonth() + 1,
            day: local.getUTCDate(),
            hour: local.getUTCHours(),
            minute: local.getUTCMinutes(),
            second: local.getUTCSeconds(),
            offsetHour: Math.floor(Math.abs(offset) / 60),
            offsetMinute: Math.abs(offset) % 60,
          };
          const sign = offset < 0 ? "-" : "+";
          const assemble = (f: typeof fields) =>
            `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}` +
            `${sign}${pad(f.offsetHour)}:${pad(f.offsetMinute)}`;
          const count = (value: string) =>
            declaredExternalComparisons(
              [{ programId: "co-snap", jurisdiction: "us-co" }],
              [{
                id: "a",
                description: "Household",
                program_id: "co-snap",
                jurisdiction: "us-co",
                comparisonEngines: ["policyengine"],
                comparisonResults: [{ engine: "policyengine", status: "match", observedAt: value, engineVersion: null }],
              }],
              new Date(ms),
            )!.engines[0]!.matchingCaseCount;
          // Control: as written, it names `ms` to the second, so it counts.
          expect(count(assemble(fields))).toBe(1);
          const outOfRange = {
            month: [0, ...range(13, 99)],
            day: [0, ...range(daysIn(fields.year, fields.month) + 1, 99)],
            hour: range(24, 99),
            minute: range(60, 99),
            second: range(60, 99),
            offsetHour: range(24, 99),
            offsetMinute: range(60, 99),
          }[field];
          const value = assemble({ ...fields, [field]: outOfRange[pick % outOfRange.length] });
          expect(rfc3339Instant(value)).toBeNull();
          expect(count(value)).toBe(0);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("rejects any text before or after a valid date-time", () => {
    fc.assert(
      fc.property(
        instant,
        offsetMinutes,
        fc.string({ unit: "binary", minLength: 1, maxLength: 3 }),
        fc.boolean(),
        (ms, offset, text, before) => {
          const written = write(ms, offset);
          expect(rfc3339Instant(before ? text + written : written + text)).toBeNull();
        },
      ),
      { numRuns: 1000 },
    );
    // The case that showed the end anchor matters: Date.parse reads it.
    expect(Number.isNaN(Date.parse("2026-10-04T07:30:00Z\u0000"))).toBe(false);
    expect(rfc3339Instant("2026-10-04T07:30:00Z\u0000")).toBeNull();
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

  it("never gains matches as time passes, once no result is dated ahead of the clock", () => {
    // Intended exception, and the reason for the narrower generator: a
    // result dated further ahead than the tolerance is not current yet
    // and becomes current when the clock reaches it. Every timestamp
    // here names an instant at most the tolerance ahead of NOW, or
    // names none and never counts.
    const elapsed = fc.oneof(
      fc.integer({ min: 0, max: 30 }).map((days) => days * DAY),
      fc.integer({ min: 0, max: 30 * DAY }),
    );
    fc.assert(
      fc.property(scenarioAt(observedNotAhead), elapsed, ({ programs, cases }, elapsedMs) => {
        const before = declaredExternalComparisons(programs, cases, NOW);
        const after = declaredExternalComparisons(
          programs,
          cases,
          new Date(NOW.getTime() + elapsedMs),
        );
        before?.engines.forEach((entry, index) => {
          expect(after!.engines[index]!.matchingCaseCount).toBeLessThanOrEqual(
            entry.matchingCaseCount,
          );
        });
      }),
      { numRuns: 500 },
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
