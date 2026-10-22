import { describe, expect, it } from "vitest";
import type { BundleDocumentRow } from "@/lib/axiom/program-bundles";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";
import { documentTiles, programTiles } from "./program-tiles";

const summary = (id: string, provisions: number, encoded: number): BundleSummary => ({
  id,
  title: `${id.split("/")[1].toUpperCase()}: bundle`,
  program: id.split("/")[1],
  jurisdiction: id.split("/")[0],
  counts: { full: { provisions, byProvisionState: { encoded, unvalidated: 0 } } } as BundleSummary["counts"],
});

describe("programTiles", () => {
  it("takes the federal layer out of each state, and links each bundle to the Programs tab", () => {
    const [snap] = programTiles([summary("us-or/snap", 30, 6), summary("us/snap", 20, 5)]);
    expect(snap.title).toBe("SNAP");
    expect(snap.bundles.map((b) => [b.label, b.documents, b.done, b.href])).toEqual([
      ["Federal", 20, 5, "/ops?tab=programs&bundle=us/snap"],
      ["OR", 10, 1, "/ops?tab=programs&bundle=us-or/snap"],
    ]);
    expect([snap.documents, snap.done, snap.href]).toEqual([30, 6, "/ops?tab=programs&bundle=us/snap"]);
  });
});

describe("documentTiles", () => {
  it("prefers the full tier, and opens each document's journey", () => {
    const row = (tier: "screener" | "full", key: string): BundleDocumentRow =>
      ({
        key,
        tier,
        name: key,
        part: "Eligibility",
        status: null,
        provisions: 4,
        encoded_provisions: 1,
        unvalidated_provisions: 1,
        partly_provisions: 0,
        deferred_provisions: 0,
        provisions_in_progress: 0,
        provisions_failed: 0,
        runs: 2,
        latest_citation: null,
        citation_path: `us/statute/${key}`,
      }) as unknown as BundleDocumentRow;
    const tiles = documentTiles([row("screener", "a"), row("full", "b")]);
    expect(tiles.map((t) => [t.key, t.status, t.encoded, t.href])).toEqual([["b", "not_started", 2, "/ops/journey?citation=us%2Fstatute%2Fb"]]);
  });
});
