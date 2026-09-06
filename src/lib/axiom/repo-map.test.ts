import { describe, it, expect, afterEach } from "vitest";
import {
  getRuleSpecRepoForJurisdiction,
  getRuleSpecRepoLocation,
  gitHubApiHeaders,
  isAppReadableJurisdiction,
  isRuleSpecRepoInAppReadList,
  ruleSpecFamilyAppVisibility,
  ruleSpecFamilyForJurisdiction,
  ruleSpecRawFileUrl,
  ruleSpecRawFileUrlForLocation,
  ruleSpecBlobUrl,
  ruleSpecRepoTreeUrl,
  ruleSpecRepoSubtreeApiUrl,
  ruleSpecRepoRootTreeApiUrl,
  RULESPEC_FAMILIES,
  RULESPEC_REPOS,
  RULESPEC_COUNTRY_SLUGS,
} from "./repo-map";
import { JURISDICTIONS_SEED } from "./jurisdictions-seed";

/**
 * Drift guard: adding a repo family is a three-part change (repo map,
 * seed label, and the family entry itself). These assertions fail the
 * PR when one part is missing — the gap that left New Zealand's 36
 * encodings invisible to the app.
 */
describe("RULESPEC_COUNTRY_SLUGS", () => {
  it("lists one country slug per family, gated repos included", () => {
    // Presentation, not the read list: every family the map knows gets
    // a country tile, including a country whose repo is still a gated
    // pilot (it renders as "pending" rather than vanishing).
    expect(RULESPEC_COUNTRY_SLUGS).toEqual([
      "us",
      "uk",
      "be",
      "ca",
      "nz",
      "il",
    ]);
    expect(RULESPEC_COUNTRY_SLUGS).toHaveLength(RULESPEC_FAMILIES.length);
  });

  it("maps every country slug back to its repo", () => {
    for (const [i, slug] of RULESPEC_COUNTRY_SLUGS.entries()) {
      expect(getRuleSpecRepoForJurisdiction(slug)).toBe(
        RULESPEC_FAMILIES[i].repo
      );
    }
  });

  it("has a jurisdictions-seed label for every country slug", () => {
    const seedSlugs = new Set(JURISDICTIONS_SEED.map((j) => j.slug));
    for (const slug of RULESPEC_COUNTRY_SLUGS) {
      expect(seedSlugs, `add "${slug}" to jurisdictions-seed.ts`).toContain(
        slug
      );
    }
  });

  it("is not derived from the read list, so a gated country keeps its tile", () => {
    // The defect this pins: RULESPEC_COUNTRY_SLUGS used to be
    // RULESPEC_REPOS.map(...), so a mapped-but-gated country was
    // missing from the country row and fell through to the anonymous
    // "Other" chips with no pending label at all.
    expect(RULESPEC_COUNTRY_SLUGS).toContain("il");
    expect(RULESPEC_REPOS).not.toContain("rulespec-il");
    expect(RULESPEC_COUNTRY_SLUGS.length).toBeGreaterThan(
      RULESPEC_REPOS.length
    );
  });
});

describe("RULESPEC_REPOS", () => {
  it("is the read list: public families only", () => {
    // rulespec-il is a bounded pilot carrying
    // app_visibility = "experimental" in its .axiom/registry.toml.
    // discoverRoots() skips gated repos, so a RULESPEC_REPOS entry
    // would also fail scripts/check-rulespec-drift.mjs ("listed in
    // RULESPEC_REPOS but discovery found no encodings"). Promote the
    // family entry here only once rulespec-il is public and populated.
    expect(RULESPEC_REPOS).toEqual([
      "rulespec-us",
      "rulespec-uk",
      "rulespec-be",
      "rulespec-ca",
      "rulespec-nz",
    ]);
    for (const repo of RULESPEC_REPOS) {
      expect(isRuleSpecRepoInAppReadList(repo)).toBe(true);
    }
    expect(isRuleSpecRepoInAppReadList("rulespec-il")).toBe(false);
    expect(isRuleSpecRepoInAppReadList("rulespec-nowhere")).toBe(false);
  });
});

describe("family visibility", () => {
  it("reports the registered app_visibility for a slug and its children", () => {
    expect(ruleSpecFamilyAppVisibility("us")).toBe("public");
    expect(ruleSpecFamilyAppVisibility("us-ny")).toBe("public");
    expect(ruleSpecFamilyAppVisibility("il")).toBe("experimental");
    expect(ruleSpecFamilyAppVisibility("il-tlv")).toBe("experimental");
    expect(ruleSpecFamilyAppVisibility("fr")).toBeNull();
  });

  it("refuses to read a gated family, and everything outside a family", () => {
    expect(isAppReadableJurisdiction("us")).toBe(true);
    expect(isAppReadableJurisdiction("ca")).toBe(true);
    expect(isAppReadableJurisdiction("il")).toBe(false);
    expect(isAppReadableJurisdiction("fr")).toBe(false);
  });

  it("still resolves the gated family, so the landing and drift check can place it", () => {
    // Presentation and the drift check need "whose encodings would
    // these be?" answered for a repo the app must not read.
    expect(ruleSpecFamilyForJurisdiction("il")).toEqual({
      slug: "il",
      repo: "rulespec-il",
      appVisibility: "experimental",
    });
    expect(getRuleSpecRepoForJurisdiction("il")).toBe("rulespec-il");
  });
});

describe("getRuleSpecRepoForJurisdiction", () => {
  it("maps every jurisdiction family to its shared monorepo", () => {
    const expected: Record<string, string> = {
      us: "rulespec-us",
      "us-al": "rulespec-us",
      "us-ca": "rulespec-us",
      // States added to the monorepo with no prior per-state repo still
      // resolve — the prefix logic is open, not a hand-maintained list.
      "us-az": "rulespec-us",
      "us-nh": "rulespec-us",
      "us-oh": "rulespec-us",
      uk: "rulespec-uk",
      "uk-kingston-upon-thames": "rulespec-uk",
      be: "rulespec-be",
      "be-bru": "rulespec-be",
      "be-vlg": "rulespec-be",
      "be-wal": "rulespec-be",
      "be-dg": "rulespec-be",
      ca: "rulespec-ca",
      nz: "rulespec-nz",
      il: "rulespec-il",
    };
    for (const [slug, repo] of Object.entries(expected)) {
      expect(getRuleSpecRepoForJurisdiction(slug)).toBe(repo);
    }
  });

  it("keeps Israel (il) and Illinois (us-il) on separate families", () => {
    // ``il`` is ISO 3166-1 Israel; Illinois is the ``us-il`` state slug.
    // A prefix mix-up here would route Illinois encodings at rulespec-il.
    expect(getRuleSpecRepoForJurisdiction("il")).toBe("rulespec-il");
    expect(getRuleSpecRepoForJurisdiction("us-il")).toBe("rulespec-us");
    expect(getRuleSpecRepoLocation("us-il")).toEqual({
      repo: "rulespec-us",
      prefix: "us-il",
    });
  });

  it("returns null for jurisdictions outside a published repo family", () => {
    expect(getRuleSpecRepoForJurisdiction("fr")).toBeNull();
    expect(getRuleSpecRepoForJurisdiction("nope")).toBeNull();
    expect(getRuleSpecRepoForJurisdiction("")).toBeNull();
  });
});

describe("getRuleSpecRepoLocation", () => {
  it("returns the repo and the jurisdiction-dir prefix", () => {
    expect(getRuleSpecRepoLocation("us")).toEqual({
      repo: "rulespec-us",
      prefix: "us",
    });
    expect(getRuleSpecRepoLocation("us-ca")).toEqual({
      repo: "rulespec-us",
      prefix: "us-ca",
    });
    expect(getRuleSpecRepoLocation("uk")).toEqual({
      repo: "rulespec-uk",
      prefix: "uk",
    });
    expect(getRuleSpecRepoLocation("be-bru")).toEqual({
      repo: "rulespec-be",
      prefix: "be-bru",
    });
  });

  it("refuses to locate a gated family, so no URL builder can address it", () => {
    // The defect this pins: mapping rulespec-il made every builder and
    // reader that funnels through the location resolve a repo the app
    // must not read, so a pilot YAML was addressable (and listable,
    // and servable) before promotion.
    expect(getRuleSpecRepoLocation("il")).toBeNull();
    expect(ruleSpecRepoTreeUrl("il")).toBeNull();
    expect(
      ruleSpecRawFileUrl("il", "statutes/income-tax-ordinance/section-121.yaml")
    ).toBeNull();
    expect(
      ruleSpecBlobUrl("il", "statutes/income-tax-ordinance/section-121.yaml")
    ).toBeNull();
  });

  it("keeps the layout Israel will use once the pilot is promoted", () => {
    // rulespec-il is scaffolded like rulespec-nz: buckets under
    // ``il/``. Flipping the family entry to "public" is the whole
    // promotion, so pin the shape the flip will produce.
    expect(
      ruleSpecRawFileUrlForLocation(
        { repo: "rulespec-il", prefix: "il" },
        "statutes/income-tax-ordinance/section-121.yaml"
      )
    ).toBe(
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-il/main/il/statutes/income-tax-ordinance/section-121.yaml"
    );
    expect(ruleSpecFamilyForJurisdiction("il")?.rootLayout).toBeUndefined();
  });

  it("returns an empty prefix for root-layout single-jurisdiction repos", () => {
    // rulespec-ca keeps its buckets at the repo root (no canada/ dir).
    expect(getRuleSpecRepoLocation("ca")).toEqual({
      repo: "rulespec-ca",
      prefix: "",
    });
  });

  it("returns null for unsupported jurisdictions", () => {
    expect(getRuleSpecRepoLocation("fr")).toBeNull();
  });
});

describe("URL builders inject the monorepo jurisdiction-dir prefix", () => {
  it("builds raw file URLs for federal and state bucket-rooted paths", () => {
    expect(ruleSpecRawFileUrl("us", "statutes/26/32.yaml")).toBe(
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us/statutes/26/32.yaml"
    );
    expect(
      ruleSpecRawFileUrl("us-ca", "regulations/mpp/63-300/1.yaml")
    ).toBe(
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us-ca/regulations/mpp/63-300/1.yaml"
    );
  });

  it("builds blob URLs for the human-facing View on GitHub link", () => {
    expect(ruleSpecBlobUrl("us", "statutes/26/32.yaml")).toBe(
      "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/us/statutes/26/32.yaml"
    );
  });

  it("builds prefix-free URLs for root-layout repos", () => {
    expect(ruleSpecRawFileUrl("ca", "policies/cra/t4127-2026/claim-codes.yaml")).toBe(
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-ca/main/policies/cra/t4127-2026/claim-codes.yaml"
    );
    expect(ruleSpecBlobUrl("ca", "policies/cra/t4127-2026/claim-codes.yaml")).toBe(
      "https://github.com/TheAxiomFoundation/rulespec-ca/blob/main/policies/cra/t4127-2026/claim-codes.yaml"
    );
    expect(ruleSpecRepoTreeUrl("ca")).toBe(
      "https://github.com/TheAxiomFoundation/rulespec-ca/tree/main"
    );
  });

  it("builds a tree URL pointing at the jurisdiction directory", () => {
    expect(ruleSpecRepoTreeUrl("us-ny")).toBe(
      "https://github.com/TheAxiomFoundation/rulespec-us/tree/main/us-ny"
    );
  });

  it("builds the recursive subtree git-trees API URL for a jurisdiction", () => {
    expect(ruleSpecRepoSubtreeApiUrl("rulespec-us", "us")).toBe(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-us/git/trees/main:us?recursive=1"
    );
    expect(ruleSpecRepoSubtreeApiUrl("rulespec-us", "us-ca")).toBe(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-us/git/trees/main:us-ca?recursive=1"
    );
    // Root-layout repos list the whole (single-jurisdiction) repo tree.
    expect(ruleSpecRepoSubtreeApiUrl("rulespec-ca", "")).toBe(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-ca/git/trees/main?recursive=1"
    );
  });

  it("builds the top-level (non-recursive) git-trees API URL for a repo", () => {
    expect(ruleSpecRepoRootTreeApiUrl("rulespec-uk")).toBe(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-uk/git/trees/main"
    );
  });

  it("returns null from the file/blob/tree builders for unsupported jurisdictions", () => {
    expect(ruleSpecRawFileUrl("fr", "statutes/1.yaml")).toBeNull();
    expect(ruleSpecBlobUrl("fr", "statutes/1.yaml")).toBeNull();
    expect(ruleSpecRepoTreeUrl("fr")).toBeNull();
  });
});

describe("gitHubApiHeaders", () => {
  const original = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
  };
  afterEach(() => {
    process.env.GITHUB_TOKEN = original.GITHUB_TOKEN;
    process.env.GH_TOKEN = original.GH_TOKEN;
  });

  it("sends only the Accept header when no token is configured", () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    expect(gitHubApiHeaders()).toEqual({
      Accept: "application/vnd.github+json",
    });
  });

  it("authenticates when a token is configured", () => {
    delete process.env.GH_TOKEN;
    process.env.GITHUB_TOKEN = "secret-token";
    expect(gitHubApiHeaders()).toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer secret-token",
    });
  });
});
