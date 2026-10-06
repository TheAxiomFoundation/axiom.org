import { readFile } from "node:fs/promises";
import { getSupabaseRestConfig, readSupabaseRows } from "@/lib/corpus-status";
import { bundleIndex, type BundleDocumentRow, type BundleIndexEntry, type BundleRow, type BundleSnapshotRow } from "./program-bundles";

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
  const file = process.env.AXIOM_OPS_BUNDLES_FILE;
  if (file && process.env.NODE_ENV === "development") {
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as BundlesFile;
      return {
        bundle: data.bundles.find((b) => b.id === id) ?? null,
        documents: data.documents.filter((d) => d.bundle_id === id),
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
          bundle_id: `eq.${id}`,
          order: "tier.asc,key.asc",
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

/**
 * Every bundle's in-scope documents, flattened for the reverse lookup from an
 * encoding to its bundles. Empty when the tables are not there yet, so pages
 * that show memberships simply show none.
 */
export async function getBundleIndex(): Promise<BundleIndexEntry[]> {
  const file = process.env.AXIOM_OPS_BUNDLES_FILE;
  if (file && process.env.NODE_ENV === "development") {
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as BundlesFile;
      return bundleIndex(data.bundles, data.documents);
    } catch {
      return [];
    }
  }
  const config = getSupabaseRestConfig();
  if (!config) return [];
  try {
    const [bundles, documents] = await Promise.all([
      readSupabaseRows<BundleRow>(config, "encodings", "program_bundles", { select: "id,title,tiers" }, { fresh: true }),
      readSupabaseRows<BundleDocumentRow>(
        config,
        "encodings",
        "program_bundle_documents",
        { select: "bundle_id,tier,name,scope,citation_path", scope: "eq.in", citation_path: "not.is.null", limit: "10000" },
        { fresh: true }
      ),
    ]);
    return bundleIndex(bundles, documents);
  } catch {
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
