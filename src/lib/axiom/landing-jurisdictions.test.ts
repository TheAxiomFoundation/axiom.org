import { describe, expect, it } from "vitest";

import { getLandingJurisdictions } from "./landing-jurisdictions";

describe("getLandingJurisdictions", () => {
  it("includes Belgium regions and communities before corpus navigation ingestion lands", () => {
    const slugs = getLandingJurisdictions().map((jurisdiction) => jurisdiction.slug);

    expect(slugs).toContain("be");
    expect(slugs).toContain("be-bru");
    expect(slugs).toContain("be-vlg");
    expect(slugs).toContain("be-wal");
    expect(slugs).toContain("be-dg");
  });

  it("includes every country whose family has a published rulespec repo", () => {
    const slugs = getLandingJurisdictions().map((jurisdiction) => jurisdiction.slug);

    for (const slug of ["us", "uk", "be", "ca", "nz"]) {
      expect(slugs).toContain(slug);
    }
  });

  it("surfaces Israel as a pending country before its encodings land", () => {
    // il has a repo family (rulespec-il) but no corpus rows yet, so the
    // landing renders it as a dimmed "pending" tile rather than hiding
    // it — the same path nz took. Illinois (us-il) is a separate slug
    // and keeps its own state tile.
    const jurisdictions = getLandingJurisdictions();
    const slugs = jurisdictions.map((jurisdiction) => jurisdiction.slug);

    expect(slugs).toContain("il");
    expect(slugs).toContain("us-il");
    expect(jurisdictions.find((j) => j.slug === "il")).toEqual({
      slug: "il",
      label: "Israel",
      hasCitationPaths: true,
    });
    expect(jurisdictions.find((j) => j.slug === "us-il")?.label).toBe(
      "Illinois"
    );
  });

  it("keeps US territories hidden until stats confirm they exist", () => {
    const uncountedSlugs = getLandingJurisdictions().map(
      (jurisdiction) => jurisdiction.slug
    );
    const countedSlugs = getLandingJurisdictions(new Set(["us-pr"])).map(
      (jurisdiction) => jurisdiction.slug
    );

    expect(uncountedSlugs).not.toContain("us-pr");
    expect(countedSlugs).toContain("us-pr");
  });
});
