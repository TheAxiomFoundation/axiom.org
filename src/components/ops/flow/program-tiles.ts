import { bundleHref, distinctByDocument, type BundleDocumentRow } from "@/lib/axiom/program-bundles";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";
import type { DocumentTile, ProgramTile } from "./level-canvases";

/**
 * A tile per program and a tile per bundle, for the programs map. A state's
 * stored counts add the federal layer; the tile takes it back out, so each
 * tile shows its own layer and the program's total counts every document once.
 */
export function programTiles(summaries: BundleSummary[]): ProgramTile[] {
  const own = (b: BundleSummary, federal: BundleSummary | undefined) => {
    const full = b.counts.full;
    const fed = federal && federal.id !== b.id ? federal.counts.full : undefined;
    const provisions = (full?.provisions ?? 0) - (fed?.provisions ?? 0);
    const done = (s: typeof full) => (s?.byProvisionState?.encoded ?? 0) + (s?.byProvisionState?.unvalidated ?? 0);
    return { provisions: Math.max(0, provisions), done: Math.max(0, done(full) - done(fed)) };
  };
  const byProgram = new Map<string, BundleSummary[]>();
  for (const b of summaries) byProgram.set(b.program, [...(byProgram.get(b.program) ?? []), b]);
  return [...byProgram.entries()]
    .map(([program, list]) => {
      const federal = list.find((b) => b.jurisdiction === "us");
      const bundles = list
        .sort((a, b) => (a === federal ? -1 : b === federal ? 1 : a.jurisdiction.localeCompare(b.jurisdiction)))
        .map((b) => {
          const m = own(b, federal);
          return {
            id: b.id,
            label: b === federal ? "Federal" : b.jurisdiction.replace(/^us-/, "").toUpperCase(),
            done: m.done,
            documents: m.provisions,
            href: bundleHref(b.id),
          };
        });
      const documents = bundles.reduce((s, b) => s + b.documents, 0);
      const done = bundles.reduce((s, b) => s + b.done, 0);
      const title = (federal?.title ?? program).split(":")[0];
      return { id: program, title, bundles, documents, done, href: bundleHref(federal?.id ?? list[0].id) };
    })
    .sort((a, b) => b.documents - a.documents);
}

/** A tile per document of one bundle (its full tier when it has one), each opening its citation's journey. */
export function documentTiles(documents: BundleDocumentRow[]): DocumentTile[] {
  const full = documents.filter((d) => d.tier === "full");
  return distinctByDocument(full.length ? full : documents).map((d): DocumentTile => {
    const citation = d.latest_citation ?? d.citation_path;
    return {
      key: d.key,
      name: d.name,
      part: d.part,
      status: d.status ?? "not_started",
      provisions: d.provisions,
      encoded: d.encoded_provisions + d.unvalidated_provisions,
      runs: d.runs,
      href: citation ? `/ops/journey?citation=${encodeURIComponent(citation)}` : null,
    };
  });
}
