import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  parseTreeEntries,
  citationPathToFilePath,
  listEncodedFiles,
  listRuleSpecJurisdictions,
  fetchEncodedFile,
  findEncodedDescendants,
} from "./repo-listing";
import { _resetRawFetchCache } from "./raw-cache";

describe("parseTreeEntries", () => {
  // A jurisdiction subtree (``git/trees/main:us``) — rooted at the
  // jurisdiction directory, so its paths are already bucket-rooted.
  const TREE = {
    tree: [
      { path: "README.md", type: "blob" },
      { path: "statutes/26/3101/a.yaml", type: "blob" },
      { path: "statutes/26/3101/a.test.yaml", type: "blob" },
      { path: "statutes/26/3101/b/1.yaml", type: "blob" },
      { path: "regulations/7-cfr/273/9.yaml", type: "blob" },
      { path: "policies/usda/snap/fy-2026-cola/deductions.yaml", type: "blob" },
      { path: ".axiom/encoding-manifests/statutes/26/3101/a.json", type: "blob" },
      { path: "sources/slices/foo.meta.yaml", type: "blob" },
      { path: "statutes/26", type: "tree" },
    ],
  };

  it("returns one record per encoding YAML, ignoring tests/meta/manifests/markdown/non-blobs", () => {
    const out = parseTreeEntries(TREE, "us");
    expect(out.map((f) => f.filePath)).toEqual([
      "policies/usda/snap/fy-2026-cola/deductions.yaml",
      "regulations/7-cfr/273/9.yaml",
      "statutes/26/3101/a.yaml",
      "statutes/26/3101/b/1.yaml",
    ]);
  });

  it("renames repo buckets back to the citation_path dialect", () => {
    const out = parseTreeEntries(TREE, "us");
    expect(out.find((f) => f.bucket === "statutes")?.citationPath).toBe(
      "us/statute/26/3101/a"
    );
    expect(out.find((f) => f.bucket === "policies")?.citationPath).toBe(
      "us/policy/usda/snap/fy-2026-cola/deductions"
    );
  });

  it("drops the -cfr suffix on federal regulation titles", () => {
    const out = parseTreeEntries(TREE, "us");
    expect(out.find((f) => f.bucket === "regulations")?.citationPath).toBe(
      "us/regulation/7/273/9"
    );
  });

  it("preserves the bucket label so the UI can group / badge entries", () => {
    const out = parseTreeEntries(TREE, "us");
    expect(new Set(out.map((f) => f.bucket))).toEqual(
      new Set(["statutes", "regulations", "policies"])
    );
  });

  it("returns an empty list when the body is missing or invalid", () => {
    expect(parseTreeEntries(null, "us")).toEqual([]);
    expect(parseTreeEntries({}, "us")).toEqual([]);
    expect(parseTreeEntries({ tree: "no" } as never, "us")).toEqual([]);
  });

  it("skips root-level YAML files — repo config, not encodings", () => {
    // rulespec-ca keeps its proof-obligation ratchet at the repo root;
    // treating its filename as a bucket fabricated the unresolvable
    // citation path ca/known-missing-money-atoms.
    const out = parseTreeEntries(
      {
        tree: [
          { path: "known-missing-money-atoms.yaml", type: "blob" },
          { path: "policies/cra/t1-2025/canada-workers-benefit.yaml", type: "blob" },
        ],
      },
      "ca"
    );
    expect(out.map((f) => f.citationPath)).toEqual([
      "ca/policy/cra/t1-2025/canada-workers-benefit",
    ]);
  });

  it("leaves the bucket alone for unknown top-level dirs (e.g. UK legislation/)", () => {
    const out = parseTreeEntries(
      {
        tree: [
          {
            path: "legislation/uksi/2002/1792/regulation/4A/2.yaml",
            type: "blob",
          },
        ],
      },
      "uk"
    );
    expect(out[0].citationPath).toBe(
      "uk/legislation/uksi/2002/1792/regulation/4A/2"
    );
    expect(out[0].bucket).toBe("legislation");
  });
});

describe("citationPathToFilePath", () => {
  it("translates the doc-type segment back to the repo bucket", () => {
    expect(citationPathToFilePath("us/statute/26/3101/a")).toBe(
      "statutes/26/3101/a.yaml"
    );
    expect(citationPathToFilePath("us-co/regulation/10-CCR-2506-1/4.401")).toBe(
      "regulations/10-CCR-2506-1/4.401.yaml"
    );
    expect(citationPathToFilePath("us/policy/usda/snap/x")).toBe(
      "policies/usda/snap/x.yaml"
    );
  });

  it("leaves unknown buckets alone", () => {
    expect(citationPathToFilePath("uk/legislation/uksi/2002/1792")).toBe(
      "legislation/uksi/2002/1792.yaml"
    );
  });

  it("returns null when the citation path lacks a bucket segment", () => {
    expect(citationPathToFilePath("us")).toBeNull();
  });
});

describe("listEncodedFiles", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
  });

  it("returns an empty list for a jurisdiction without a published repo", async () => {
    expect(await listEncodedFiles("fr")).toEqual([]);
  });

  it("returns an empty list when the GitHub API responds non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 })
    );
    expect(await listEncodedFiles("us")).toEqual([]);
  });

  it("returns an empty list when the fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    expect(await listEncodedFiles("us")).toEqual([]);
  });

  it("fetches the jurisdiction subtree and parses encoding YAMLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tree: [
          { path: "statutes/26/3101/a.yaml", type: "blob" },
          { path: "statutes/26/3101/a.test.yaml", type: "blob" },
          { path: "README.md", type: "blob" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await listEncodedFiles("us");
    expect(out).toHaveLength(1);
    expect(out[0].citationPath).toBe("us/statute/26/3101/a");
    // Scopes to the federal subtree of the shared rulespec-us monorepo.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-us/git/trees/main:us?recursive=1",
      expect.anything()
    );
  });

  it("scopes a state to its own directory in the shared monorepo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tree: [{ path: "regulations/mpp/63-300/1.yaml", type: "blob" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await listEncodedFiles("us-ca");
    expect(out.map((f) => f.citationPath)).toEqual([
      "us-ca/regulation/mpp/63-300/1",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-us/git/trees/main:us-ca?recursive=1",
      expect.anything()
    );
  });

  it("scopes Belgian regions to their directories in rulespec-be", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tree: [{ path: "statutes/gift_tax/rate_scale.yaml", type: "blob" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await listEncodedFiles("be-bru");
    expect(out.map((f) => f.citationPath)).toEqual([
      "be-bru/statute/gift_tax/rate_scale",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-be/git/trees/main:be-bru?recursive=1",
      expect.anything()
    );
  });

  it("lists nothing from a mapped repo the app must not read", async () => {
    // rulespec-il is mapped as a family (so Israel gets a pending
    // landing tile) but carries app_visibility = "experimental" in its
    // .axiom/registry.toml, and discoverRoots() skips gated repos.
    // Before the gate landed here, the same mapping made a pilot YAML
    // listable and servable through the runtime readers while the
    // search index and the drift check still excluded it — pilot
    // encodings browsable before promotion.
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/.axiom/registry.toml")
        ? {
            ok: true,
            status: 200,
            text: async () => '[registry]\napp_visibility = "experimental"\n',
          }
        : {
            ok: true,
            json: async () => ({
              tree: [
                {
                  path: "statutes/income-tax-ordinance/section-121.yaml",
                  type: "blob",
                },
              ],
            }),
          }
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await listEncodedFiles("il")).toEqual([]);
    expect(await findEncodedDescendants("il/statute/income-tax-ordinance")).toEqual(
      []
    );
    // The registered gate is synchronous and fails closed, so the
    // gated repo is never even asked about.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists nothing from a listed repo that has gated itself upstream", async () => {
    // The live half of the gate: a repo on the read list that flips its
    // own marker between app deploys stops being listable immediately,
    // the same contract discoverRoots() keeps.
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/.axiom/registry.toml")
        ? {
            ok: true,
            status: 200,
            text: async () => '[registry]\napp_visibility = "experimental"\n',
          }
        : {
            ok: true,
            json: async () => ({
              tree: [{ path: "statutes/income-tax-act-2007/CD-1.yaml", type: "blob" }],
            }),
          }
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await listEncodedFiles("nz")).toEqual([]);
    expect(
      fetchMock.mock.calls.map(([url]: [string]) => url)
    ).toEqual([
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-nz/main/.axiom/registry.toml",
    ]);
  });

  it("lists a root-layout repo from its whole tree, skipping repo plumbing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tree: [
          { path: "policies/cra/t4127-2026/claim-codes.yaml", type: "blob" },
          { path: "policies/cra/t4127-2026/claim-codes.test.yaml", type: "blob" },
          // Plumbing beside the buckets: manifest config and corpus
          // source slices are plain YAML but not encodings.
          { path: ".axiom/repository-structure.yaml", type: "blob" },
          { path: "sources/cra/t4127-2026/claim-codes.yaml", type: "blob" },
          { path: "README.md", type: "blob" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await listEncodedFiles("ca");
    expect(out.map((f) => f.citationPath)).toEqual([
      "ca/policy/cra/t4127-2026/claim-codes",
    ]);
    // Root-layout repos have no jurisdiction-dir prefix - the whole
    // (single-jurisdiction) repo tree is the listing.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-ca/git/trees/main?recursive=1",
      expect.anything()
    );
  });
});

describe("listRuleSpecJurisdictions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
  });

  it("returns the jurisdiction directories present across the monorepos, skipping non-jurisdiction dirs", async () => {
    const byUrl: Record<string, unknown> = {
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-us/git/trees/main": {
        tree: [
          { path: "us", type: "tree" },
          { path: "us-ca", type: "tree" },
          { path: "programs", type: "tree" },
          { path: ".github", type: "tree" },
          { path: "README.md", type: "blob" },
        ],
      },
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-uk/git/trees/main": {
        tree: [{ path: "uk", type: "tree" }],
      },
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-be/git/trees/main": {
        tree: [
          { path: "be", type: "tree" },
          { path: "be-bru", type: "tree" },
          { path: "sources", type: "tree" },
        ],
      },
      // Root-layout repo: buckets at the repo root count as the repo's
      // single jurisdiction; plumbing dirs alone would not.
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-ca/git/trees/main": {
        tree: [
          { path: ".axiom", type: "tree" },
          { path: "sources", type: "tree" },
          { path: "policies", type: "tree" },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () => byUrl[url],
      }))
    );
    const slugs = await listRuleSpecJurisdictions();
    expect(new Set(slugs)).toEqual(
      new Set(["us", "us-ca", "uk", "be", "be-bru", "ca"])
    );
  });

  it("does not report a root-layout repo whose root has only plumbing dirs", async () => {
    const byUrl: Record<string, unknown> = {
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-us/git/trees/main": {
        tree: [],
      },
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-uk/git/trees/main": {
        tree: [],
      },
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-be/git/trees/main": {
        tree: [],
      },
      "https://api.github.com/repos/TheAxiomFoundation/rulespec-ca/git/trees/main": {
        tree: [
          { path: ".axiom", type: "tree" },
          { path: ".github", type: "tree" },
          { path: "sources", type: "tree" },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () => byUrl[url],
      }))
    );
    expect(await listRuleSpecJurisdictions()).toEqual([]);
  });

  it("skips a jurisdiction directory whose family the app must not read", async () => {
    // A gated family's directory appearing inside a repo the app does
    // read must not reach the encoded index — the index would name a
    // jurisdiction whose files listEncodedFiles then refuses to serve.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("rulespec-us")
            ? {
                tree: [
                  { path: "us", type: "tree" },
                  { path: "il", type: "tree" },
                ],
              }
            : { tree: [] },
      }))
    );
    expect(await listRuleSpecJurisdictions()).toEqual(["us"]);
  });

  it("skips a repo that has gated itself upstream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/.axiom/registry.toml")) {
          return url.includes("rulespec-uk")
            ? {
                ok: true,
                status: 200,
                text: async () => '[registry]\napp_visibility = "experimental"\n',
              }
            : { ok: false, status: 404 };
        }
        return {
          ok: true,
          json: async () => ({
            tree: [
              { path: url.includes("rulespec-uk") ? "uk" : "us", type: "tree" },
            ],
          }),
        };
      })
    );
    const slugs = await listRuleSpecJurisdictions();
    expect(slugs).toContain("us");
    expect(slugs).not.toContain("uk");
  });

  it("tolerates a repo whose tree request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("rulespec-us")
          ? { ok: true, json: async () => ({ tree: [{ path: "us", type: "tree" }] }) }
          : { ok: false, status: 404 }
      )
    );
    expect(await listRuleSpecJurisdictions()).toEqual(["us"]);
  });
});

describe("fetchEncodedFile", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
  });

  it("returns null when the jurisdiction has no published repo", async () => {
    expect(await fetchEncodedFile("fr/statute/foo/bar")).toBeNull();
  });

  it("returns null when the citation path can't be mapped to a file", async () => {
    expect(await fetchEncodedFile("us")).toBeNull();
  });

  it("returns null for a 404 from raw.githubusercontent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchEncodedFile("us/statute/26/9999/z")).toBeNull();
  });

  it("fetches the prefixed monorepo URL and returns a bucket-rooted file path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "format: rulespec/v1\n",
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchEncodedFile("us/statute/26/3101/a");
    expect(out).toEqual({
      filePath: "statutes/26/3101/a.yaml",
      content: "format: rulespec/v1\n",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us/statutes/26/3101/a.yaml",
      expect.anything()
    );
  });

  it("prefixes state encodings with the state directory", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "format: rulespec/v1\n",
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchEncodedFile("us-ny/statute/tax/606/d");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us-ny/statutes/tax/606/d.yaml",
      expect.anything()
    );
  });

  it("returns null when the fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("dns"))
    );
    expect(await fetchEncodedFile("us/statute/26/3101/a")).toBeNull();
  });

  it("refuses to serve a YAML from a repo the app must not read", async () => {
    // Holding an exact citation path is not a way around the gate: the
    // pilot encoding stays unservable until rulespec-il is promoted.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "format: rulespec/v1\n",
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fetchEncodedFile("il/statute/income-tax-ordinance/section-121")
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to serve a YAML from a listed repo that has gated itself", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/.axiom/registry.toml")
        ? {
            ok: true,
            status: 200,
            text: async () => '[registry]\napp_visibility = "experimental"\n',
          }
        : { ok: true, status: 200, text: async () => "format: rulespec/v1\n" }
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchEncodedFile("nz/statute/income-tax-act-2007/CD-1")).toBeNull();
    expect(
      fetchMock.mock.calls.map(([url]: [string]) => url)
    ).toEqual([
      "https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-nz/main/.axiom/registry.toml",
    ]);
  });
});

describe("findEncodedDescendants", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
  });

  it("filters to YAMLs strictly under the requested citation prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tree: [
            { path: "statutes/26/3101/a.yaml", type: "blob" },
            { path: "statutes/26/3101/b/1.yaml", type: "blob" },
            { path: "statutes/26/3101/b/2.yaml", type: "blob" },
            { path: "statutes/26/63/c/5.yaml", type: "blob" },
          ],
        }),
      })
    );
    const out = await findEncodedDescendants("us/statute/26/3101");
    expect(out.map((f) => f.citationPath)).toEqual([
      "us/statute/26/3101/a",
      "us/statute/26/3101/b/1",
      "us/statute/26/3101/b/2",
    ]);
  });

  it("excludes a YAML at the exact citation path (only strict descendants)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tree: [
            { path: "statutes/26/3101.yaml", type: "blob" },
            { path: "statutes/26/3101/a.yaml", type: "blob" },
          ],
        }),
      })
    );
    const out = await findEncodedDescendants("us/statute/26/3101");
    expect(out.map((f) => f.citationPath)).toEqual(["us/statute/26/3101/a"]);
  });

  it("returns an empty list for a citation_path with no jurisdiction segment", async () => {
    expect(await findEncodedDescendants("")).toEqual([]);
  });

  it("returns an empty list for a jurisdiction without a published repo", async () => {
    expect(await findEncodedDescendants("fr/statute/foo")).toEqual([]);
  });
});
