import { supabaseCorpus, supabaseEncodings } from "@/lib/supabase";
import {
  excludeGatedRows,
  isGatedJurisdiction,
} from "@/lib/axiom/rulespec/index-visibility";
import {
  EXTRA_JURISDICTION_LABELS,
  JURISDICTIONS_SEED,
} from "@/lib/axiom/jurisdictions-seed";

/**
 * Data assembly for the public /coverage page: the extent of the
 * corpus (documents by type, provisions) and of the encodings
 * (RuleSpec files), per jurisdiction.
 *
 * Sources, all release-pointer-backed and cheap:
 * - corpus.get_corpus_stats RPC — provision totals per jurisdiction.
 * - corpus.get_root_document_counts RPC — root rows of
 *   navigation_nodes (parent_path IS NULL) grouped by jurisdiction and
 *   doc_type in one call; roots are the documents (a USC title, a CFR
 *   part, a state act, an agency manual). Until that function exists
 *   the page falls back to one paged root query per jurisdiction. The
 *   per-jurisdiction queries are slow for the largest jurisdictions
 *   (us, us-il) and time out under fan-out, so a failed jurisdiction
 *   keeps its last good counts rather than reading as zero.
 * - encodings.rulespec_files — jurisdiction column sweep, counted
 *   locally (PostgREST aggregates are disabled). Also contributes
 *   jurisdictions that have encodings but no corpus release yet.
 */

export interface JurisdictionCoverage {
  slug: string;
  label: string;
  /** Root document counts by doc_type ("statute" → 225). */
  documents: Record<string, number>;
  documentTotal: number;
  provisionCount: number;
  encodingFileCount: number;
}

export interface CoverageData {
  totals: {
    jurisdictions: number;
    documents: number;
    provisions: number;
    encodingFiles: number;
  };
  /** Descending by count. */
  docTypeTotals: Array<{ type: string; count: number }>;
  /** Descending by provision count, encodings-only jurisdictions last. */
  jurisdictions: JurisdictionCoverage[];
}

const ROOT_DOCS_PAGE_SIZE = 1000;
const MAX_ROOT_DOC_PAGES = 10;
const SWEEP_PAGE_SIZE = 1000;
const MAX_SWEEP_PAGES = 30;
const CONCURRENCY = 8;
const CACHE_TTL_MS = 600_000;

/**
 * Process-local result cache, aligned with the page's 10-minute
 * revalidate. The assembly fans out ~60 queries; without this every
 * dev render and every ISR regeneration pays the full fan-out.
 * Failures are never cached.
 */
let cached: { at: number; value: CoverageData } | null = null;

/** Last successfully loaded root-document counts per jurisdiction.
 *  Outlives the result cache: when a refresh's per-jurisdiction query
 *  fails, the jurisdiction keeps these instead of dropping to zero and
 *  pulling the published total down with it. */
let lastGoodDocCounts = new Map<string, Record<string, number>>();

/** Test hook: module-level cache must reset between tests. */
export function _resetCoverageCache() {
  cached = null;
  lastGoodDocCounts = new Map();
}

/** Test hook: expire the result cache but keep the last good counts,
 *  as a 10-minute revalidation does. */
export function _expireCoverageCache() {
  cached = null;
}

function labelForSlug(slug: string): string {
  const seeded =
    JURISDICTIONS_SEED.find((j) => j.slug === slug)?.label ??
    EXTRA_JURISDICTION_LABELS[slug];
  if (seeded) return seeded;
  // Unseeded mirror slugs ("uk-kingston-upon-thames") — humanize
  // rather than leaking the raw slug into cards and shelves.
  return slug
    .split("-")
    .map((part, i) =>
      i === 0 && part.length <= 3
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

async function mapChunked<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

interface CorpusStats {
  provisions_count: number;
  jurisdictions: Array<{ jurisdiction: string; count: number }>;
}

async function loadCorpusStats(): Promise<CorpusStats | null> {
  const { data, error } = await supabaseCorpus.rpc("get_corpus_stats");
  if (error || !data) return null;
  return data as CorpusStats;
}

/** Root-document doc_type counts for every jurisdiction in one grouped
 *  call. Returns null when the function is unavailable (not yet
 *  migrated, or an outage) so the caller can fall back. */
async function loadAllRootDocCounts(): Promise<Map<
  string,
  Record<string, number>
> | null> {
  const { data, error } = await supabaseCorpus.rpc("get_root_document_counts");
  if (error || !Array.isArray(data)) return null;
  const counts = new Map<string, Record<string, number>>();
  for (const row of data as Array<{
    jurisdiction: string | null;
    doc_type: string | null;
    document_count: number | string | null;
  }>) {
    if (!row.jurisdiction || !row.doc_type) continue;
    const n = Number(row.document_count ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    const byType = counts.get(row.jurisdiction) ?? {};
    byType[row.doc_type] = (byType[row.doc_type] ?? 0) + n;
    counts.set(row.jurisdiction, byType);
  }
  return counts;
}

/** Root-document doc_type counts for one jurisdiction, paged (some
 *  flat corpora — us-il — have thousands of root documents). Returns
 *  null on query error so the caller can distinguish outage from
 *  zero. */
async function loadRootDocCounts(
  slug: string,
): Promise<Record<string, number> | null> {
  const counts: Record<string, number> = {};
  for (let page = 0; page < MAX_ROOT_DOC_PAGES; page++) {
    const { data, error } = await supabaseCorpus
      .from("navigation_nodes")
      .select("doc_type")
      .is("parent_path", null)
      .eq("jurisdiction", slug)
      .order("path", { ascending: true })
      .range(page * ROOT_DOCS_PAGE_SIZE, (page + 1) * ROOT_DOCS_PAGE_SIZE - 1);
    if (error) return page === 0 ? null : counts;
    const rows = (data ?? []) as Array<{ doc_type: string | null }>;
    for (const row of rows) {
      if (!row.doc_type) continue;
      counts[row.doc_type] = (counts[row.doc_type] ?? 0) + 1;
    }
    if (rows.length < ROOT_DOCS_PAGE_SIZE) return counts;
  }
  console.warn(
    `coverage: ${slug} root-document sweep hit its ${MAX_ROOT_DOC_PAGES}-page cap; counts are a floor`,
  );
  return counts;
}

/** Encoding-file counts per jurisdiction from the mirror. Two classes
 *  are excluded from the census:
 *  - Composed pipeline files ("*_pipeline.yaml", snake_case vs the
 *    kebab-case corpus-derived names): they stitch existing rules into
 *    end-to-end oracle-comparison pipelines rather than encode
 *    provisions.
 *  - Deferred files ("status: deferred"): grounded placeholders that
 *    declare outputs they could NOT encode yet — real files, but not
 *    finished encodings, so they'd inflate the count.
 *  - Program packages (bucket "programs") and EUROMOD bridges:
 *    assemblies over encoded rules for runtime/oracle surfaces, not
 *    provision encodings themselves. */
async function loadEncodingCounts(): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  for (let page = 0; page < MAX_SWEEP_PAGES; page++) {
    // ``excludeGatedRows`` filters on ``citation_path``; PostgREST
    // filters columns that are not in the projection, so the sweep
    // still selects only the jurisdiction it counts.
    const { data, error } = await excludeGatedRows(
      supabaseEncodings.from("rulespec_files").select("jurisdiction"),
    )
      // \_ keeps the underscore literal (LIKE treats bare _ as "any").
      .not("file_path", "ilike", "%\\_pipeline.yaml")
      .not("raw_yaml", "ilike", "%status: deferred%")
      .not("bucket", "eq", "programs")
      .not("file_path", "ilike", "%euromod%")
      .order("jurisdiction", { ascending: true })
      .range(page * SWEEP_PAGE_SIZE, (page + 1) * SWEEP_PAGE_SIZE - 1);
    if (error) return null;
    const rows = (data ?? []) as Array<{ jurisdiction: string | null }>;
    for (const row of rows) {
      if (!row.jurisdiction) continue;
      // A gated pilot family is not part of the published census.
      if (isGatedJurisdiction(row.jurisdiction)) continue;
      counts.set(row.jurisdiction, (counts.get(row.jurisdiction) ?? 0) + 1);
    }
    if (rows.length < SWEEP_PAGE_SIZE) return counts;
  }
  console.warn(
    `coverage: encoding sweep hit its ${MAX_SWEEP_PAGES}-page cap; counts are a floor`,
  );
  return counts;
}

/**
 * Assemble the page data. Returns null only when the corpus stats
 * backbone is unavailable; per-jurisdiction failures degrade to
 * missing document breakdowns rather than failing the page.
 */
export async function getCoverageData(): Promise<CoverageData | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  const [stats, encodingCounts] = await Promise.all([
    loadCorpusStats(),
    loadEncodingCounts(),
  ]);
  if (!stats) return null;

  const provisionBySlug = new Map(
    (stats.jurisdictions ?? []).map((j) => [j.jurisdiction, j.count]),
  );
  const slugs = new Set<string>(provisionBySlug.keys());
  for (const slug of encodingCounts?.keys() ?? []) slugs.add(slug);

  const corpusSlugs = [...slugs].filter((slug) => provisionBySlug.has(slug));
  const grouped = await loadAllRootDocCounts();
  const docCountsBySlug = new Map<string, Record<string, number> | null>();
  if (grouped) {
    for (const slug of corpusSlugs)
      docCountsBySlug.set(slug, grouped.get(slug) ?? {});
  } else {
    for (const [slug, counts] of await mapChunked(
      corpusSlugs,
      CONCURRENCY,
      async (slug) => {
        // One retry: the failures seen in production are timeouts on the
        // largest jurisdictions under fan-out, not persistent errors.
        const counts =
          (await loadRootDocCounts(slug)) ?? (await loadRootDocCounts(slug));
        return [slug, counts] as const;
      },
    )) {
      docCountsBySlug.set(slug, counts);
    }
  }
  for (const [slug, counts] of docCountsBySlug) {
    if (counts === null) {
      const previous = lastGoodDocCounts.get(slug);
      if (previous) docCountsBySlug.set(slug, previous);
    } else {
      lastGoodDocCounts.set(slug, counts);
    }
  }

  const jurisdictions: JurisdictionCoverage[] = [...slugs].map((slug) => {
    const documents = docCountsBySlug.get(slug) ?? {};
    return {
      slug,
      label: labelForSlug(slug),
      documents: documents ?? {},
      documentTotal: Object.values(documents ?? {}).reduce((a, b) => a + b, 0),
      provisionCount: provisionBySlug.get(slug) ?? 0,
      encodingFileCount: encodingCounts?.get(slug) ?? 0,
    };
  });
  jurisdictions.sort(
    (a, b) =>
      b.provisionCount - a.provisionCount ||
      b.encodingFileCount - a.encodingFileCount ||
      a.slug.localeCompare(b.slug),
  );

  const docTypeTotals = new Map<string, number>();
  for (const j of jurisdictions) {
    for (const [type, count] of Object.entries(j.documents)) {
      docTypeTotals.set(type, (docTypeTotals.get(type) ?? 0) + count);
    }
  }

  const data: CoverageData = {
    totals: {
      jurisdictions: jurisdictions.length,
      documents: jurisdictions.reduce((sum, j) => sum + j.documentTotal, 0),
      provisions: stats.provisions_count,
      encodingFiles: [...(encodingCounts?.values() ?? [])].reduce(
        (a, b) => a + b,
        0,
      ),
    },
    docTypeTotals: [...docTypeTotals.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    jurisdictions,
  };
  cached = { at: Date.now(), value: data };
  return data;
}
