import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { indexableRoots, isAppGatedRoot } from "./indexable-roots.mjs";
import { discoverRoots } from "./rulespec-discovery.mjs";


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

const ORG_REPOS =
  "https://api.github.com/orgs/TheAxiomFoundation/repos?per_page=100&type=all&sort=pushed";

function registryUrl(repo: string) {
  return `https://raw.githubusercontent.com/TheAxiomFoundation/${repo}/main/.axiom/registry.toml`;
}

function treeUrl(repo: string) {
  return `https://api.github.com/repos/TheAxiomFoundation/${repo}/git/trees/main`;
}

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

const REPOS = [
  { name: "rulespec-us", default_branch: "main", archived: false },
  { name: "rulespec-xg", default_branch: "main", archived: false },
];

const TREES: Record<string, unknown> = {
  "rulespec-us": { tree: [{ path: "us", type: "tree" }] },
  "rulespec-xg": { tree: [{ path: "xg", type: "tree" }] },
};

/**
 * A GitHub stub whose ``.axiom/registry.toml`` reads behave as
 * ``markerFailure`` dictates. Discovery's own marker check fails OPEN,
 * so a failure here is exactly the state that admits a gated repo.
 */
function stubGitHub(markerFailure: "reject" | "http-500" | "none") {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === ORG_REPOS) return json(REPOS);
    if (url.endsWith("/.axiom/registry.toml")) {
      if (markerFailure === "reject") throw new Error("dns");
      if (markerFailure === "http-500") {
        return { ok: false, status: 500, text: async () => "" };
      }
      const gated = url === registryUrl("rulespec-xg");
      return {
        ok: true,
        status: 200,
        text: async () =>
          gated
            ? '[registry]\napp_visibility = "experimental"\n'
            : "[registry]\nowner = \"axiom\"\n",
      };
    }
    for (const repo of Object.keys(TREES)) {
      if (url === treeUrl(repo)) return json(TREES[repo]);
    }
    return json({ tree: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("index-sync visibility gate", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gates a root by repo and by family", () => {
    expect(isAppGatedRoot({ repo: "rulespec-xg", jurisdiction: "xg" })).toBe(
      true
    );
    // A gated family's directory appearing inside some other repo is
    // caught by the family half of the check.
    expect(isAppGatedRoot({ repo: "rulespec-us", jurisdiction: "xg" })).toBe(
      true
    );
    expect(isAppGatedRoot({ repo: "rulespec-us", jurisdiction: "us" })).toBe(
      false
    );
    // Illinois is a US state, not Israel.
    expect(isAppGatedRoot({ repo: "rulespec-us", jurisdiction: "us-il" })).toBe(
      false
    );
    // A repo the map does not know at all still indexes — the index is
    // meant to pick a new country up before repo-map.ts is edited.
    expect(isAppGatedRoot({ repo: "rulespec-gh", jurisdiction: "gh" })).toBe(
      false
    );
  });

  it("reports every refused root instead of dropping it silently", () => {
    const skipped: Array<{ repo: string }> = [];
    const kept = indexableRoots(
      [
        { repo: "rulespec-us", jurisdiction: "us", prefix: "us" },
        { repo: "rulespec-xg", jurisdiction: "xg", prefix: "xg" },
      ],
      (root) => skipped.push(root)
    );

    expect(kept.map((root) => root.jurisdiction)).toEqual(["us"]);
    expect(skipped.map((root) => root.repo)).toEqual(["rulespec-xg"]);
  });

  it("survives a caller that passes no skip callback", () => {
    expect(
      indexableRoots([{ repo: "rulespec-xg", jurisdiction: "xg" }])
    ).toEqual([]);
  });

  for (const failure of ["reject", "http-500"] as const) {
    it(`still refuses rulespec-xg when the marker request ${failure === "reject" ? "throws" : "returns 500"}`, async () => {
      // The exact hole: discoverRoots' marker check fails OPEN (a
      // GitHub hiccup must not blank a live country), so one bad
      // registry.toml read admits the gated pilot into discovery — and
      // the six-hourly sync would then write its rows into
      // encodings.rulespec_files, where the app's database-backed
      // readers, not the GitHub readers, decide what is served.
      stubGitHub(failure);

      const discovered = await discoverRoots();
      expect(discovered.map((root) => root.jurisdiction).sort()).toEqual([
        "us",
        "xg",
      ]);

      expect(
        indexableRoots(discovered).map((root) => root.jurisdiction)
      ).toEqual(["us"]);
    });
  }

  it("keeps every root when the marker reads succeed and only il is gated", async () => {
    stubGitHub("none");

    const discovered = await discoverRoots();
    // Discovery already dropped rulespec-xg on its own marker here.
    expect(discovered.map((root) => root.jurisdiction)).toEqual(["us"]);
    expect(indexableRoots(discovered).map((root) => root.jurisdiction)).toEqual(
      ["us"]
    );
  });
});
