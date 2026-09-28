import { describe, expect, it, vi } from "vitest";

import {
  GATED_FAMILY_SLUGS,
  excludeGatedRows,
  isGatedCitationPath,
  isGatedJurisdiction,
  jurisdictionOfCitationPath,
  readableJurisdictionHints,
  withoutGatedRows,
} from "./index-visibility";


// A synthetic gated ("xg") family: with every real family public, the
// gate has no live instance to test against.
vi.mock("@/lib/axiom/rulespec-families", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/axiom/rulespec-families")>();
  return {
    ...actual,
    RULESPEC_FAMILIES: Object.freeze([
      ...actual.RULESPEC_FAMILIES,
      { slug: "xg", repo: "rulespec-xg", appVisibility: "experimental" },
    ]),
  };
});
vi.mock("@/lib/axiom/jurisdictions-seed", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/axiom/jurisdictions-seed")>();
  return {
    ...actual,
    JURISDICTIONS_SEED: [
      ...actual.JURISDICTIONS_SEED,
      { slug: "xg", label: "Xgated", hasCitationPaths: true },
    ],
  };
});

/** Minimal chainable stand-in for the PostgREST builder's ``not``. */
function notSpy() {
  const calls: unknown[][] = [];
  const builder = {
    not(column: string, operator: string, value: unknown) {
      calls.push([column, operator, value]);
      return this;
    },
  };
  return { builder, calls };
}

describe("registered-visibility gate for the encodings index", () => {
  it("lists exactly the families the repo map registers experimental", () => {
    // Today that is Israel's pilot. The assertion is on the *shape* —
    // a family flipped to public must drop out of here without anyone
    // editing this test's expectations by hand.
    expect([...GATED_FAMILY_SLUGS]).toEqual(["xg"]);
  });

  it("gates a pilot family and its sub-jurisdictions", () => {
    expect(isGatedJurisdiction("xg")).toBe(true);
    expect(isGatedJurisdiction("xg-tlv")).toBe(true);
  });

  it("does not gate a public family, an unknown slug, or an empty one", () => {
    // The deny-list is the whole point: the index deliberately carries
    // jurisdictions with no repo-map family (the gh/ng gap), and an
    // allow-list here would blank them.
    expect(isGatedJurisdiction("us")).toBe(false);
    expect(isGatedJurisdiction("gh")).toBe(false);
    expect(isGatedJurisdiction("")).toBe(false);
    expect(isGatedJurisdiction(null)).toBe(false);
    expect(isGatedJurisdiction(undefined)).toBe(false);
  });

  it("keeps Illinois readable — us-il is a US state, not Israel", () => {
    expect(isGatedJurisdiction("us-il")).toBe(false);
    expect(isGatedCitationPath("us-il/statute/35/200")).toBe(false);
  });

  it("reads the jurisdiction out of a citation path", () => {
    expect(jurisdictionOfCitationPath("us/statute/26/32")).toBe("us");
    expect(jurisdictionOfCitationPath("xg")).toBe("xg");
    expect(jurisdictionOfCitationPath("")).toBeNull();
    // A leading slash yields an empty first segment, not a jurisdiction.
    expect(jurisdictionOfCitationPath("/statute/26/32")).toBeNull();
    expect(jurisdictionOfCitationPath(null)).toBeNull();
    expect(isGatedCitationPath("xg/statute/income-tax-ordinance/section-121"))
      .toBe(true);
    expect(isGatedCitationPath("us/statute/26/32")).toBe(false);
    expect(isGatedCitationPath(null)).toBe(false);
  });

  it("drops gated rows and keeps the rest", () => {
    const rows = [
      { citation_path: "us/statute/26/32" },
      { citation_path: "xg/statute/income-tax-ordinance/section-121" },
      { citation_path: "us-il/statute/35/200" },
      { citation_path: null },
    ];
    expect(withoutGatedRows(rows, (row) => row.citation_path)).toEqual([
      { citation_path: "us/statute/26/32" },
      { citation_path: "us-il/statute/35/200" },
      { citation_path: null },
    ]);
  });

  it("narrows jurisdiction hints, and reports when nothing readable is left", () => {
    expect(readableJurisdictionHints([])).toEqual([]);
    expect(readableJurisdictionHints(["us", "xg"])).toEqual(["us"]);
    // Every hint gated → null, so the caller answers empty instead of
    // dropping the filter and querying every jurisdiction.
    expect(readableJurisdictionHints(["xg"])).toBeNull();
    expect(readableJurisdictionHints(new Set(["xg", "xg-tlv"]))).toBeNull();
  });

  it("excludes gated families in the query, on the citation path", () => {
    const { builder, calls } = notSpy();
    expect(excludeGatedRows(builder)).toBe(builder);
    // Country directory and any sub-jurisdiction directory, matched on
    // the never-null conflict key rather than the nullable
    // ``jurisdiction`` column (a not.-predicate would drop nulls too).
    expect(calls).toEqual([
      ["citation_path", "like", "xg/%"],
      ["citation_path", "like", "xg-%"],
    ]);
  });

  it("filters a caller-named column when the row is keyed differently", () => {
    const { builder, calls } = notSpy();
    excludeGatedRows(builder, "module_citation_path");
    expect(calls).toEqual([
      ["module_citation_path", "like", "xg/%"],
      ["module_citation_path", "like", "xg-%"],
    ]);
  });
});
