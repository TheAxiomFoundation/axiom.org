import { describe, expect, it } from "vitest";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import {
  bundleIndex,
  bundleMemberships,
  designation,
  measureDocument,
  moduleSources,
  provisionCounts,
  tierCounts,
  tiersLabel,
  type BundleFileDocument,
  type ModuleSource,
} from "./program-bundles";

const AT = "2026-10-06T12:00:00Z";

const doc = (overrides: Partial<BundleFileDocument> = {}): BundleFileDocument => ({
  key: "us/statute/7/2014",
  name: "7 USC 2014",
  layer: "federal",
  part: "Income",
  citation_path: "us/statute/7/2014",
  source_url: null,
  sources: ["plan", "policyengine-references"],
  scope: "in",
  ...overrides,
});

// 7 USC 2014: (a) and (b) are leaves; (c) holds (c)(1) and (c)(2).
const nodes = [
  { path: "us/statute/7/2014", child_count: 3 },
  { path: "us/statute/7/2014/a", child_count: 0 },
  { path: "us/statute/7/2014/b", child_count: 0 },
  { path: "us/statute/7/2014/c", child_count: 2 },
  { path: "us/statute/7/2014/c/1", child_count: 0 },
  { path: "us/statute/7/2014/c/2", child_count: 0 },
];
const module = (path: string, yaml?: string): ModuleSource => ({ module: path, sources: [path], yaml });

describe("moduleSources", () => {
  it("takes a statute or regulation module's own path, and a policy module's declared non-law sources", () => {
    expect(moduleSources({ citation_path: "us/statute/7/2014/a", declared_sources: ["us/statute/7/2014"] })).toEqual([
      "us/statute/7/2014/a",
    ]);
    // A tax pipeline that cites 26 USC 1402 does not encode 1402.
    expect(
      moduleSources({
        citation_path: "us-az/policy/des/faa5/x",
        declared_sources: ["us-az/manual/des/faa5/x/block-3", "us/statute/26/1402"],
      })
    ).toEqual(["us-az/manual/des/faa5/x/block-3"]);
  });
});

describe("designation", () => {
  it("names a paragraph inside its section as a module writes it", () => {
    expect(designation("us/regulation/7/273/9/a/1", "us/regulation/7/273/9")).toBe("273.9(a)(1)");
    expect(designation("us/statute/7/2015/e/3", "us/statute/7/2015/e")).toBe("2015(e)(3)");
    expect(designation("us/statute/7/2015", "us/statute/7/2015")).toBeNull();
  });
});

describe("measureDocument", () => {
  it("counts only text-bearing provisions, each in one state, adding up to all of them", () => {
    const row = measureDocument(
      "us-az/snap",
      "full",
      doc(),
      {
        nodes,
        // (a) encoded whole; (c) encoded whole, so (c)(1) and (c)(2) are; a module below (b) leaves it partly.
        modules: [module("us/statute/7/2014/a"), module("us/statute/7/2014/c"), module("us/statute/7/2014/b/2")],
        attempts: [],
      },
      AT
    );
    expect(row.provisions).toBe(4);
    expect(provisionCounts(row)).toEqual({ encoded: 3, partly: 1, in_progress: 0, failed: 0, not_started: 0 });
    expect(row).toMatchObject({ status: "partly", modules: 3, units: [] });
  });

  it("marks provisions with a running or failed newest run, and lists them", () => {
    const row = measureDocument(
      "us-az/snap",
      "full",
      doc(),
      {
        nodes,
        modules: [module("us/statute/7/2014/a")],
        attempts: [
          pipelineAttempt({ id: "1", citation: "us/statute/7/2014/b", run_status: "in_progress", run_conclusion: null }),
          // A run on (c) touches both its provisions.
          pipelineAttempt({ id: "2", citation: "us/statute/7/2014/c", dispatched_at: "2026-10-02T00:00:00Z" }),
        ],
      },
      AT
    );
    expect(provisionCounts(row)).toEqual({ encoded: 1, partly: 0, in_progress: 1, failed: 2, not_started: 0 });
    expect(row.open_provisions.map((p) => [p.path, p.state])).toEqual([
      ["us/statute/7/2014/c/1", "failed"],
      ["us/statute/7/2014/c/2", "failed"],
      ["us/statute/7/2014/b", "in_progress"],
    ]);
  });

  it("is complete when every provision is encoded, and not in the corpus when the corpus lacks it", () => {
    const whole = measureDocument("b", "full", doc(), { nodes, modules: [module("us/statute/7/2014")], attempts: [] }, AT);
    expect(whole.status).toBe("complete");
    const missing = measureDocument("b", "full", doc(), { nodes: [], modules: [], attempts: [] }, AT);
    expect(missing).toMatchObject({ in_corpus: false, provisions: 0, status: "not_in_corpus" });
    const excluded = measureDocument("b", "full", doc({ scope: "excluded", reason: "Back-year table" }), null, AT);
    expect(excluded).toMatchObject({ status: null, reason: "Back-year table" });
  });

  it("grades each provision PolicyEngine cites by the parity rule", () => {
    const row = measureDocument(
      "us-az/snap",
      "screener",
      doc({
        cited: [
          { path: "us/statute/7/2014/a", references: 2, part: "Income" },
          { path: "us/statute/7/2014/c/1", references: 1, part: "Deductions" },
          { path: "us/statute/7/2014/c/2", references: 1, part: "Deductions" },
          { path: "us/statute/7/2014/b", references: 1, part: "Income" },
        ],
      }),
      {
        nodes,
        modules: [module("us/statute/7/2014/a"), module("us/statute/7/2014/c", "source: 7 U.S.C. 2014(c)(1) income")],
        attempts: [pipelineAttempt({ id: "9", citation: "us/statute/7/2014/b", run_status: "in_progress", run_conclusion: null })],
      },
      AT
    );
    expect(row.units.map((u) => [u.path, u.state, u.part])).toEqual([
      ["us/statute/7/2014/a", "encoded", "Income"],
      ["us/statute/7/2014/c/1", "encoded", "Deductions"],
      ["us/statute/7/2014/c/2", "partly", "Deductions"],
      ["us/statute/7/2014/b", "in_progress", "Income"],
    ]);
    expect(row.units[1].detail).toBe("us/statute/7/2014/c names 2014(c)(1)");
    expect(row.units[2].detail).toBe("us/statute/7/2014/c does not name 2014(c)(2)");
  });

  it("makes a cited document without cited provisions one unit, graded by its provisions", () => {
    const poms = measureDocument(
      "b",
      "screener",
      doc({ key: "us/statute/7/2014", cited: undefined, part: "Assets" }),
      { nodes, modules: [module("us/statute/7/2014/a")], attempts: [] },
      AT
    );
    expect(poms.units).toMatchObject([{ path: "us/statute/7/2014", state: "partly", part: "Assets", detail: "1 of 4 provisions encoded" }]);
    const web = measureDocument(
      "b",
      "screener",
      doc({ key: "https://fns.usda.gov/x", citation_path: null, source_url: "https://fns.usda.gov/x", part: "Deductions" }),
      null,
      AT
    );
    expect(web.units).toMatchObject([{ path: null, url: "https://fns.usda.gov/x", state: "not_in_corpus" }]);
  });

  it("counts a provision whose newest run reached the index as encoded", () => {
    const row = measureDocument(
      "b",
      "full",
      doc(),
      {
        nodes,
        modules: [],
        attempts: [mergedAttempt({ id: "5", citation: "us/statute/7/2014/a", synced_at: "2026-10-03T00:00:00Z", index_status: "indexed" })],
      },
      AT
    );
    expect(provisionCounts(row).encoded).toBe(1);
  });
});

describe("tierCounts", () => {
  it("adds up documents, provisions and cited units by state", () => {
    const rows = [
      measureDocument("b", "screener", doc({ cited: [{ path: "us/statute/7/2014/a", references: 1 }] }), { nodes, modules: [module("us/statute/7/2014/a")], attempts: [] }, AT),
      measureDocument("b", "screener", doc({ key: "k2", citation_path: "us/statute/7/2017" }), { nodes: [], modules: [], attempts: [] }, AT),
      measureDocument("b", "screener", doc({ key: "k3", scope: "excluded", reason: "Secondary source: not law" }), null, AT),
    ];
    const counts = tierCounts(rows);
    expect(counts).toMatchObject({ documents: 2, excluded: 1, provisions: 4, units: 2 });
    expect(counts.byStatus).toEqual({ complete: 0, partly: 1, not_started: 0, not_in_corpus: 1 });
    expect(counts.byProvisionState).toEqual({ encoded: 1, partly: 0, in_progress: 0, failed: 0, not_started: 3 });
    expect(counts.byUnitState).toMatchObject({ encoded: 1, not_in_corpus: 1 });
  });
});

describe("bundleMemberships", () => {
  const bundles = [
    {
      id: "us-az/snap",
      title: "Arizona SNAP",
      tiers: [
        { id: "screener" as const, title: "Screener-level parity", definition: "", membership: {} },
        { id: "full" as const, title: "Full document bundle", definition: "", membership: {} },
      ],
    },
  ];
  const rows = [
    { bundle_id: "us-az/snap", tier: "screener" as const, name: "7 USC 2014", scope: "in" as const, citation_path: "us/statute/7/2014" },
    { bundle_id: "us-az/snap", tier: "screener" as const, name: "FAA5 medical", scope: "in" as const, citation_path: "us-az/manual/des/faa5/med" },
    { bundle_id: "us-az/snap", tier: "full" as const, name: "FAA5 medical", scope: "in" as const, citation_path: "us-az/manual/des/faa5/med" },
    { bundle_id: "us-az/snap", tier: "full" as const, name: "CA", scope: "excluded" as const, citation_path: "us-az/manual/des/faa5/ca" },
  ];
  const index = bundleIndex(bundles, rows);

  it("names the bundle and every tier whose document holds the citation", () => {
    const [membership] = bundleMemberships("us-az/manual/des/faa5/med/block-2", index);
    expect(membership).toMatchObject({ bundle_id: "us-az/snap", bundle_title: "Arizona SNAP" });
    expect(tiersLabel(membership)).toBe("Tiers 1, 2");
    expect(tiersLabel(bundleMemberships("us/statute/7/2014/e/6/A", index)[0])).toBe("Tier 1");
  });

  it("leaves out excluded documents and paths that only share a prefix", () => {
    expect(bundleMemberships("us-az/manual/des/faa5/ca", index)).toEqual([]);
    expect(bundleMemberships("us/statute/7/20145", index)).toEqual([]);
  });
});
