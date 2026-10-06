import { describe, expect, it } from "vitest";
import { pipelineAttempt } from "@/test/pipeline-attempt";
import {
  documentType,
  bundleIndex,
  bundleMemberships,
  measureDocument,
  provisionCounts,
  tierCounts,
  tiersLabel,
  type BundleFileDocument,
  type ModuleFacts,
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
const module = (path: string, facts: Partial<ModuleFacts> = {}): ModuleFacts => ({
  module: path,
  sources: [path],
  cited: [path],
  deferred: [],
  rules: 1,
  waived: false,
  ...facts,
});

describe("measureDocument", () => {
  it("counts only text-bearing provisions, each in one state, adding up to all of them", () => {
    const row = measureDocument(
      "us-az/snap",
      "full",
      doc(),
      {
        nodes,
        // A rule cites (a); a rule cites (c), so (c)(1) and (c)(2) are encoded; a rule cites only part of (b).
        modules: [module("us/statute/7/2014/a"), module("us/statute/7/2014/c"), module("us/statute/7/2014/b/2")],
        attempts: [],
      },
      AT
    );
    expect(row.provisions).toBe(4);
    expect(provisionCounts(row)).toEqual({
      encoded: 3,
      unvalidated: 0,
      partly: 1,
      deferred: 0,
      in_progress: 0,
      failed: 0,
      not_started: 0,
    });
    expect(row).toMatchObject({ status: "partly", modules: 3, units: [] });
  });

  it("credits a provision only when a rule cites it, never a module's declared source", () => {
    const row = measureDocument(
      "b",
      "full",
      doc(),
      {
        nodes,
        modules: [
          // A module with no rules defers its whole source.
          module("us/statute/7/2014/a", { cited: [], deferred: ["us/statute/7/2014/a"], rules: 0 }),
          // A module that encodes (c) but defers (c)(2) leaves (c)(1) encoded and (c)(2) deferred.
          module("us/statute/7/2014/c", { deferred: ["us/statute/7/2014/c/2"] }),
          // A waived module's provision is encoded but not validated.
          module("us/statute/7/2014/b", { waived: true }),
        ],
        attempts: [],
      },
      AT
    );
    expect(provisionCounts(row)).toEqual({
      encoded: 1,
      unvalidated: 1,
      partly: 0,
      deferred: 2,
      in_progress: 0,
      failed: 0,
      not_started: 0,
    });
  });

  it("makes a provision with a deferred branch partly encoded", () => {
    // A CFR section is one corpus provision; its module defers a paragraph of it.
    const section = [{ path: "us/regulation/7/273/9", child_count: 0 }];
    const row = measureDocument(
      "b",
      "full",
      doc({ key: "us/regulation/7/273/9", citation_path: "us/regulation/7/273/9" }),
      {
        nodes: section,
        modules: [module("us/regulation/7/273/9", { deferred: ["us/regulation/7/273/9/d/6"] })],
        attempts: [],
      },
      AT
    );
    expect(row).toMatchObject({ partly_provisions: 1, encoded_provisions: 0, status: "partly" });
  });

  it("marks provisions with a running or failed newest run, and gives runs no credit", () => {
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
    expect(provisionCounts(row)).toMatchObject({ encoded: 1, in_progress: 1, failed: 2, not_started: 0 });
    expect(row.open_provisions.map((p) => [p.path, p.state])).toEqual([
      ["us/statute/7/2014/c/1", "failed"],
      ["us/statute/7/2014/c/2", "failed"],
      ["us/statute/7/2014/b", "in_progress"],
    ]);
  });

  it("is complete when every provision is encoded, and not in the corpus when the corpus lacks it", () => {
    const whole = measureDocument("b", "full", doc(), { nodes, modules: [module("us/statute/7/2014")], attempts: [] }, AT);
    expect(whole.status).toBe("complete");
    const waived = measureDocument(
      "b",
      "full",
      doc(),
      { nodes, modules: [module("us/statute/7/2014", { waived: true })], attempts: [] },
      AT
    );
    expect(waived.status).toBe("unvalidated");
    const missing = measureDocument("b", "full", doc(), { nodes: [], modules: [], attempts: [] }, AT);
    expect(missing).toMatchObject({ in_corpus: false, provisions: 0, status: "not_in_corpus" });
    const excluded = measureDocument("b", "full", doc({ scope: "excluded", reason: "Back-year table" }), null, AT);
    expect(excluded).toMatchObject({ status: null, reason: "Back-year table" });
  });

  it("grades each provision PolicyEngine cites by the rules that cite it", () => {
    const row = measureDocument(
      "us-az/snap",
      "screener",
      doc({
        cited: [
          { path: "us/statute/7/2014/a", references: 2, part: "Income" },
          { path: "us/statute/7/2014/c/1", references: 1, part: "Deductions" },
          { path: "us/statute/7/2014/c/2", references: 1, part: "Deductions" },
          { path: "us/statute/7/2014/b", references: 1, part: "Income" },
          { path: "us/statute/7/2014", references: 1, part: "Income" },
        ],
      }),
      {
        nodes,
        modules: [
          module("us/statute/7/2014/a"),
          // The (c) module's rules cite (c)(1) only, and defer (c)(2).
          module("us/statute/7/2014/c", { cited: ["us/statute/7/2014/c/1"], deferred: ["us/statute/7/2014/c/2"] }),
        ],
        attempts: [pipelineAttempt({ id: "9", citation: "us/statute/7/2014/b", run_status: "in_progress", run_conclusion: null })],
      },
      AT
    );
    expect(row.units.map((u) => [u.path, u.state, u.part])).toEqual([
      ["us/statute/7/2014/a", "encoded", "Income"],
      ["us/statute/7/2014/c/1", "encoded", "Deductions"],
      ["us/statute/7/2014/c/2", "deferred", "Deductions"],
      ["us/statute/7/2014/b", "in_progress", "Income"],
      // The whole section, as PolicyEngine cites it: rules cite parts of it.
      ["us/statute/7/2014", "partly", "Income"],
    ]);
    expect(row.units[1].detail).toBe("A rule in us/statute/7/2014/c cites it");
    expect(row.units[2].detail).toBe("Deferred by us/statute/7/2014/c");
    expect(row.units[4].name).toBe("7 USC 2014");
  });

  it("makes a cited document without cited provisions one unit, graded by its provisions", () => {
    const manual = measureDocument(
      "b",
      "screener",
      doc({ key: "us-az/manual/x", citation_path: "us-az/manual/x", cited: undefined, part: "Assets" }),
      {
        nodes: [
          { path: "us-az/manual/x", child_count: 2 },
          { path: "us-az/manual/x/block-1", child_count: 0 },
          { path: "us-az/manual/x/block-2", child_count: 0 },
        ],
        modules: [module("us-az/policy/x", { sources: ["us-az/manual/x/block-1"], cited: ["us-az/manual/x/block-1"] })],
        attempts: [],
      },
      AT
    );
    expect(manual.units).toMatchObject([{ path: "us-az/manual/x", state: "partly", part: "Assets" }]);
    const web = measureDocument(
      "b",
      "screener",
      doc({ key: "https://fns.usda.gov/x", citation_path: null, source_url: "https://fns.usda.gov/x", part: "Deductions" }),
      null,
      AT
    );
    expect(web.units).toMatchObject([{ path: null, url: "https://fns.usda.gov/x", state: "not_in_corpus" }]);
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
    expect(counts.byStatus).toEqual({ complete: 0, unvalidated: 0, partly: 1, not_started: 0, not_in_corpus: 1 });
    expect(counts.byProvisionState).toEqual({
      encoded: 1,
      unvalidated: 0,
      partly: 0,
      deferred: 0,
      in_progress: 0,
      failed: 0,
      not_started: 3,
    });
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

describe("documentType", () => {
  const type = (layer: string, citation_path: string | null, source_url: string | null = null) =>
    documentType({ layer, citation_path, source_url }).label;

  it("reads the kind from the citation path, and the layer apart", () => {
    expect(type("federal", "us/statute/7/2014")).toBe("Federal statutes and public laws");
    expect(type("federal", "us/regulation/7/273/9")).toBe("Federal regulations");
    expect(type("federal", "us/guidance/usda/fns/snap-fy2027-cola")).toBe("Federal guidance (FNS, HHS)");
    expect(type("federal", "us/manual/ssa/poms/si/01140.200")).toBe("Federal manuals (SSA POMS)");
    expect(type("state", "us-az/manual/des/faa5/x")).toBe("State policy manual");
    expect(type("state", "us-az/policy/des/x")).toBe("State plans, notices and waivers");
    expect(type("state", "us-az/statute/46")).toBe("State statutes");
  });

  it("reads a page the corpus does not hold by its address", () => {
    expect(type("federal", null, "https://www.congress.gov/119/plaws/publ21/PLAW-119publ21.pdf")).toBe(
      "Federal statutes and public laws"
    );
    expect(type("federal", null, "https://www.fns.usda.gov/snap/work-requirements")).toBe("Federal guidance (FNS, HHS)");
    expect(type("state", null, "https://www.fns.usda.gov/x/az-abawd-response-fy2025.pdf")).toBe("Federal letters to the state");
    expect(type("federal", null, "https://example.org/x")).toBe("Other documents");
  });

  it("orders federal law before the state's sources", () => {
    const order = (layer: string, path: string) => documentType({ layer, citation_path: path, source_url: null }).order;
    expect(order("federal", "us/statute/7/2014")).toBeLessThan(order("federal", "us/regulation/7/273/9"));
    expect(order("federal", "us/manual/ssa/x")).toBeLessThan(order("state", "us-az/statute/46"));
  });
});
