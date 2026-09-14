import { describe, expect, it, vi } from "vitest";

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

import { getLandingJurisdictions } from "@/lib/axiom/landing-jurisdictions";
import { parseAppVisibility } from "@/lib/axiom/registry-visibility";
import {
  RULESPEC_COUNTRY_SLUGS,
  RULESPEC_REPOS,
  getRuleSpecRepoLocation,
  isAppReadableJurisdiction,
  isRuleSpecRepoInAppReadList,
} from "@/lib/axiom/repo-map";
import {
  isGatedJurisdiction,
  withoutGatedRows,
} from "@/lib/axiom/rulespec/index-visibility";

describe("the two visibility states", () => {
  it("parses the registry marker, defaulting to public", () => {
    expect(
      parseAppVisibility('[registry]\napp_visibility = "experimental"\n')
    ).toBe("experimental");
    expect(parseAppVisibility('[registry]\napp_visibility = "public"\n')).toBe(
      "public"
    );
    expect(parseAppVisibility('[registry]\napp_visibility = "secret"\n')).toBe(
      "public"
    );
    expect(parseAppVisibility(null)).toBe("public");
  });

  it("reads a public family and never a gated one", () => {
    expect(isAppReadableJurisdiction("il")).toBe(true);
    expect(isAppReadableJurisdiction("il-tlv")).toBe(true);
    expect(isAppReadableJurisdiction("xg")).toBe(false);
    expect(isRuleSpecRepoInAppReadList("rulespec-il")).toBe(true);
    expect(isRuleSpecRepoInAppReadList("rulespec-xg")).toBe(false);
    expect(getRuleSpecRepoLocation("il")).toEqual({ repo: "rulespec-il", prefix: "il" });
    expect(getRuleSpecRepoLocation("xg")).toBeNull();
  });

  it("indexes public families and presents the pending pilot beside them", () => {
    expect(RULESPEC_REPOS).toContain("rulespec-il");
    expect(RULESPEC_REPOS).not.toContain("rulespec-xg");
    expect(RULESPEC_COUNTRY_SLUGS).toEqual(expect.arrayContaining(["il", "xg"]));
    const slugs = getLandingJurisdictions().map((j) => j.slug);
    expect(slugs).toContain("il");
    expect(slugs).toContain("xg");
  });

  it("drops gated rows from every read", () => {
    const rows = [
      { citation_path: "il/statute/income-tax-ordinance/section-121" },
      { citation_path: "xg/statute/act/section-1" },
      { citation_path: "us-il/statute/x/section-1" },
    ];
    expect(isGatedJurisdiction("xg")).toBe(true);
    expect(isGatedJurisdiction("il")).toBe(false);
    expect(withoutGatedRows(rows, (r) => r.citation_path).map((r) => r.citation_path)).toEqual([
      "il/statute/income-tax-ordinance/section-121",
      "us-il/statute/x/section-1",
    ]);
  });
});
