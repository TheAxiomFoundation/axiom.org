import { readFile, stat } from "node:fs/promises";
import { getSupabaseRestConfig, readSupabaseRows } from "@/lib/corpus-status";
import {
  bundleIndex,
  type BundleDocumentRow,
  type BundleIndexEntry,
  type BundleRow,
  type BundleSnapshotRow,
  type BundleTierId,
  type TierCounts,
} from "./program-bundles";

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

export interface ProgramBundleData {
  bundle: BundleRow | null;
  documents: BundleDocumentRow[];
  snapshots: BundleSnapshotRow[];
  /** False when the tables are not there yet (migration not applied). */
  available: boolean;
  error: string | null;
}

interface BundlesFile {
  bundles: BundleRow[];
  documents: BundleDocumentRow[];
  snapshots: BundleSnapshotRow[];
}

/**
 * One bundle with its documents and daily snapshots, from the tables
 * scripts/collect-program-bundles.mjs writes.
 *
 * In development, AXIOM_OPS_BUNDLES_FILE may point at a collector dry run
 * (`bun scripts/collect-program-bundles.mjs --out <file>`), so the page can
 * be built before the tables exist.
 */
export async function getProgramBundle(id: string): Promise<ProgramBundleData> {
  // A state's bundle is its own layer and the program's federal layer together.
  const ids = layerIds(id);
  const file = process.env.AXIOM_OPS_BUNDLES_FILE;
  if (file && process.env.NODE_ENV === "development") {
    try {
      const data = await readBundlesFile(file);
      return {
        bundle: data.bundles.find((b) => b.id === id) ?? null,
        documents: data.documents.filter((d) => ids.includes(d.bundle_id)),
        snapshots: data.snapshots.filter((s) => s.bundle_id === id),
        available: true,
        error: null,
      };
    } catch (error) {
      return { bundle: null, documents: [], snapshots: [], available: false, error: message(error) };
    }
  }

  const config = getSupabaseRestConfig();
  if (!config) return { bundle: null, documents: [], snapshots: [], available: false, error: null };
  try {
    const [bundles, snapshots] = await Promise.all([
      readSupabaseRows<BundleRow>(config, "encodings", "program_bundles", { select: "*", id: `eq.${id}` }, { fresh: true }),
      readSupabaseRows<BundleSnapshotRow>(
        config,
        "encodings",
        "program_bundle_snapshots",
        { select: "*", bundle_id: `eq.${id}`, order: "day.asc" },
        { fresh: true }
      ),
    ]);
    const documents: BundleDocumentRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await readSupabaseRows<BundleDocumentRow>(
        config,
        "encodings",
        "program_bundle_documents",
        {
          select: "*",
          bundle_id: `in.(${ids.map((b) => `"${b}"`).join(",")})`,
          order: "bundle_id.asc,tier.asc,key.asc",
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        },
        { fresh: true }
      );
      documents.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return { bundle: bundles[0] ?? null, documents, snapshots, available: true, error: null };
  } catch (error) {
    const text = message(error);
    // PostgREST answers 404 for a table it does not know.
    if (/returned 404/.test(text)) return { bundle: null, documents: [], snapshots: [], available: false, error: null };
    return { bundle: null, documents: [], snapshots: [], available: false, error: text };
  }
}

/** The bundles whose rows make up a bundle's page: a state's own and its program's federal layer. */
export function layerIds(id: string): string[] {
  const [jurisdiction, program] = id.split("/");
  return jurisdiction === "us" || !program ? [id] : [id, `us/${program}`];
}

/** Every path a citation sits under, itself included: the document paths that can hold it. */
function citationAncestors(citations: string[]): string[] {
  const out = new Set<string>();
  for (const citation of citations) {
    const parts = citation.split("/");
    for (let n = 2; n <= parts.length; n++) out.add(parts.slice(0, n).join("/"));
  }
  return [...out];
}

// The dry-run file is tens of megabytes: read it once per change.
let cachedFile: { path: string; mtimeMs: number; data: BundlesFile } | null = null;
async function readBundlesFile(path: string): Promise<BundlesFile> {
  const { mtimeMs } = await stat(path);
  if (cachedFile?.path === path && cachedFile.mtimeMs === mtimeMs) return cachedFile.data;
  const data = JSON.parse(await readFile(path, "utf8")) as BundlesFile;
  cachedFile = { path, mtimeMs, data };
  return data;
}

/**
 * The in-scope bundle documents that hold any of the citations (a document
 * whose path is the citation or one above it), flattened for the reverse
 * lookup from an encoding to its bundles. Empty when the tables are not there
 * yet, so pages that show memberships simply show none.
 */
export async function getBundleIndex(citations: string[]): Promise<BundleIndexEntry[]> {
  const paths = citationAncestors(citations);
  if (!paths.length) return [];
  const file = process.env.AXIOM_OPS_BUNDLES_FILE;
  if (file && process.env.NODE_ENV === "development") {
    try {
      const data = await readBundlesFile(file);
      const wanted = new Set(paths);
      return bundleIndex(
        data.bundles,
        data.documents.filter((d) => d.scope === "in" && d.citation_path && wanted.has(d.citation_path))
      );
    } catch {
      return [];
    }
  }
  const config = getSupabaseRestConfig();
  if (!config) return [];
  try {
    const documents: BundleDocumentRow[] = [];
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100).map((p) => `"${p}"`).join(",");
      documents.push(
        ...(await readSupabaseRows<BundleDocumentRow>(
          config,
          "encodings",
          "program_bundle_documents",
          { select: "bundle_id,tier,name,scope,citation_path", scope: "eq.in", citation_path: `in.(${batch})` },
          { fresh: true }
        ))
      );
    }
    const ids = [...new Set(documents.map((d) => d.bundle_id))];
    if (!ids.length) return [];
    const bundles = await readSupabaseRows<BundleRow>(
      config,
      "encodings",
      "program_bundles",
      { select: "id,title,tiers", id: `in.(${ids.map((b) => `"${b}"`).join(",")})` },
      { fresh: true }
    );
    return bundleIndex(bundles, documents);
  } catch {
    return [];
  }
}

/** One bundle at a glance, for the /ops grid of programs and states. */
export interface BundleSummary {
  id: string;
  title: string;
  program: string;
  jurisdiction: string;
  counts: Partial<Record<BundleTierId, TierCounts>>;
}

/**
 * Every bundle with its tiers' counts (a state's with the federal layer
 * included), as the collector stored them. Empty when the tables are not there.
 */
export async function getBundleSummaries(): Promise<BundleSummary[]> {
  const pick = (b: BundleRow): BundleSummary => ({
    id: b.id,
    title: b.title,
    program: b.program,
    jurisdiction: b.jurisdiction,
    counts: b.counts ?? {},
  });
  const file = process.env.AXIOM_OPS_BUNDLES_FILE;
  if (file && process.env.NODE_ENV === "development") {
    try {
      return (await readBundlesFile(file)).bundles.map(pick);
    } catch {
      return [];
    }
  }
  const config = getSupabaseRestConfig();
  if (!config) return [];
  try {
    const rows = await readSupabaseRows<BundleRow>(
      config,
      "encodings",
      "program_bundles",
      { select: "id,title,program,jurisdiction,counts", order: "id.asc", limit: "2000" },
      { fresh: true }
    );
    return rows.map(pick);
  } catch {
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
