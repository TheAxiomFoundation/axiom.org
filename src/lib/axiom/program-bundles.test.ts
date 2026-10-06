import { describe, expect, it } from "vitest";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import {
  bundleIndex,
  bundleMemberships,
  documentGroup,
  measureDocument,
  tierCounts,
  provisionCounts,
  tiersLabel,
  type BundleFileDocument,
} from "./program-bundles";

const AT = "2026-10-06T12:00:00Z";

const doc = (overrides: Partial<BundleFileDocument> = {}): BundleFileDocument => ({
  key: "us/statute/7/2014",
  name: "7 USC 2014",
  layer: "federal",
  citation_path: "us/statute/7/2014",
  source_url: null,
  sources: ["plan", "policyengine-references"],
  scope: "in",
  ...overrides,
});

const tree = ["us/statute/7/2014", "us/statute/7/2014/a", "us/statute/7/2014/b", "us/statute/7/2014/c"];

describe("measureDocument", () => {
  it("counts a provision encoded when a rule cites it or a deeper path the corpus does not split", () => {
    const row = measureDocument(
      "us-az/snap",
      "screener",
      doc(),
      {
        nodes: tree,
        ruleCitations: [
          // A module's own path, deeper than the corpus: counts toward 2014(a).
          { citation_path: "us/statute/7/2014/a/1", rule: "a#x" },
          { citation_path: "us/statute/7/2014/c", rule: "c#y" },
          { citation_path: "us/statute/7/2014/c", rule: "c#z" },
          // Another section never counts.
          { citation_path: "us/statute/7/2015/e", rule: "e#w" },
        ],
        attempts: [],
      },
      AT
    );
    expect(row).toMatchObject({ in_corpus: true, provisions: 4, encoded_provisions: 2, rules: 3, status: "partly_encoded" });
  });

  it("grades each PolicyEngine-cited provision: encoded, inside an encoded provision, or not", () => {
    const row = measureDocument(
      "us-az/snap",
      "screener",
      doc({
        cited: [
          { path: "us/statute/7/2014/a", references: 2 },
          { path: "us/statute/7/2014/b/1", references: 1 },
          { path: "us/statute/7/2014/c", references: 1 },
        ],
      }),
      {
        nodes: tree,
        ruleCitations: [
          { citation_path: "us/statute/7/2014/a/1", rule: "a#x" },
          { citation_path: "us/statute/7/2014/b", rule: "b#y" },
        ],
        attempts: [],
      },
      AT
    );
    expect(row.cited.map((c) => c.state)).toEqual(["encoded", "within", "missing"]);
    expect(row).toMatchObject({ cited_total: 3, cited_covered: 1, cited_within: 1 });
  });

  it("marks a document the corpus does not serve, and takes no measure from it", () => {
    const row = measureDocument("us-az/snap", "screener", doc(), { nodes: [], ruleCitations: [], attempts: [] }, AT);
    expect(row).toMatchObject({ in_corpus: false, provisions: 0, status: "not_in_corpus" });
    const web = measureDocument(
      "us-az/snap",
      "screener",
      doc({ key: "https://www.fns.usda.gov/snap/work-requirements", citation_path: null, source_url: "https://www.fns.usda.gov/snap/work-requirements" }),
      null,
      AT
    );
    expect(web).toMatchObject({ in_corpus: false, status: "not_in_corpus", source_url: "https://www.fns.usda.gov/snap/work-requirements" });
  });

  it("keeps an excluded document's reason and gives it no status", () => {
    const row = measureDocument(
      "us-az/snap",
      "screener",
      doc({ scope: "excluded", reason: "Back-year table: not current law" }),
      null,
      AT
    );
    expect(row).toMatchObject({ scope: "excluded", reason: "Back-year table: not current law", status: null });
  });

  it("takes the newest encode run under the document", () => {
    const row = measureDocument(
      "us-az/snap",
      "screener",
      doc(),
      {
        nodes: tree,
        ruleCitations: [],
        attempts: [
          pipelineAttempt({ id: "1", citation: "us/statute/7/2014/a", dispatched_at: "2026-10-01T00:00:00Z" }),
          pipelineAttempt({ id: "2", citation: "us/statute/7/2014/c", dispatched_at: "2026-10-03T00:00:00Z", run_url: "r2" }),
          pipelineAttempt({ id: "3", citation: "us/statute/7/2015", dispatched_at: "2026-10-05T00:00:00Z" }),
        ],
      },
      AT
    );
    expect(row).toMatchObject({ runs: 2, latest_citation: "us/statute/7/2014/c", latest_run_url: "r2", latest_stage: "encode_failed" });
  });
});

describe("provision states", () => {
  it("gives every provision one state from the rule index and its latest run, adding up to all provisions", () => {
    const nodes = [...tree, "us/statute/7/2014/d", "us/statute/7/2014/e"];
    const row = measureDocument(
      "us-az/snap",
      "screener",
      doc(),
      {
        nodes,
        ruleCitations: [{ citation_path: "us/statute/7/2014/a", rule: "a#x" }],
        attempts: [
          // Encoded already: a newer failed run does not undo it.
          pipelineAttempt({ id: "1", citation: "us/statute/7/2014/a", dispatched_at: "2026-10-04T00:00:00Z" }),
          // Running now.
          pipelineAttempt({ id: "2", citation: "us/statute/7/2014/b/1", run_status: "in_progress", run_conclusion: null }),
          // Failed, then failed again: one failed provision.
          pipelineAttempt({ id: "3", citation: "us/statute/7/2014/c", dispatched_at: "2026-10-01T00:00:00Z" }),
          pipelineAttempt({ id: "4", citation: "us/statute/7/2014/c", dispatched_at: "2026-10-02T00:00:00Z" }),
          // Merged and indexed, though no rule cites this exact path yet.
          mergedAttempt({ id: "5", citation: "us/statute/7/2014/d", synced_at: "2026-10-03T00:00:00Z", index_status: "indexed" }),
        ],
      },
      AT
    );
    expect(provisionCounts(row)).toEqual({ encoded: 2, in_progress: 1, failed: 1, not_started: 2 });
    expect(row.open_provisions.map((p) => [p.path, p.state, p.stage])).toEqual([
      ["us/statute/7/2014/c", "failed", "encode_failed"],
      ["us/statute/7/2014/b", "in_progress", "encoding"],
    ]);
    expect(row.open_provisions[1].citation).toBe("us/statute/7/2014/b/1");
  });
});

describe("tierCounts", () => {
  it("counts documents in scope by status, and adds their provisions and cited provisions", () => {
    const rows = [
      measureDocument("b", "screener", doc(), { nodes: tree, ruleCitations: [{ citation_path: "us/statute/7/2014", rule: "r" }], attempts: [] }, AT),
      measureDocument("b", "screener", doc({ key: "k2", citation_path: "us/statute/7/2017" }), { nodes: [], ruleCitations: [], attempts: [] }, AT),
      measureDocument("b", "screener", doc({ key: "k3", scope: "excluded", reason: "Secondary source: not law" }), null, AT),
    ];
    const counts = tierCounts(rows);
    expect(counts).toMatchObject({ documents: 2, excluded: 1, provisions: 4, encodedProvisions: 1 });
    expect(counts.byStatus).toEqual({ encoded: 0, partly_encoded: 1, not_encoded: 0, not_in_corpus: 1 });
    expect(counts.byProvisionState).toEqual({ encoded: 1, in_progress: 0, failed: 0, not_started: 3 });
  });
});

describe("documentGroup", () => {
  it("groups by level and kind of source", () => {
    expect(documentGroup({ citation_path: "us/regulation/7/273/9", layer: "federal" })).toBe("Federal regulations");
    expect(documentGroup({ citation_path: "us-az/manual/des/faa5/x", layer: "state" })).toBe("State manuals");
    expect(documentGroup({ citation_path: null, layer: "federal" })).toBe("Federal sources not in the corpus");
  });
});

describe("bundleMemberships", () => {
  const bundles = [
    {
      id: "us-az/snap",
      title: "Arizona SNAP",
      program: "snap",
      jurisdiction: "us-az",
      as_of: "2026-10-06",
      tiers: [
        { id: "screener" as const, title: "Screener-level parity", definition: "", membership: {} },
        { id: "full" as const, title: "Full document bundle", definition: "", membership: {} },
      ],
      source: null,
      collected_at: AT,
    },
  ];
  const rows = [
    measureDocument("us-az/snap", "screener", doc(), null, AT),
    measureDocument("us-az/snap", "screener", doc({ key: "faa5/med", name: "FAA5 medical", citation_path: "us-az/manual/des/faa5/med" }), null, AT),
    measureDocument("us-az/snap", "full", doc({ key: "faa5/med", name: "FAA5 medical", citation_path: "us-az/manual/des/faa5/med" }), null, AT),
    measureDocument("us-az/snap", "full", doc({ key: "faa5/ca", citation_path: "us-az/manual/des/faa5/ca", scope: "excluded", reason: "not SNAP" }), null, AT),
  ];
  const index = bundleIndex(bundles, rows);

  it("names the bundle and every tier whose document holds the citation", () => {
    const [membership] = bundleMemberships("us-az/manual/des/faa5/med/block-2", index);
    expect(membership).toMatchObject({ bundle_id: "us-az/snap", bundle_title: "Arizona SNAP" });
    expect(membership.tiers.map((t) => [t.index, t.document])).toEqual([
      [1, "FAA5 medical"],
      [2, "FAA5 medical"],
    ]);
    expect(tiersLabel(membership)).toBe("Tiers 1, 2");
    expect(tiersLabel(bundleMemberships("us/statute/7/2014/e/6/A", index)[0])).toBe("Tier 1");
  });

  it("leaves out excluded documents and paths that only share a prefix", () => {
    expect(bundleMemberships("us-az/manual/des/faa5/ca", index)).toEqual([]);
    expect(bundleMemberships("us/statute/7/20145", index)).toEqual([]);
  });
});
