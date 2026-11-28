import { supabaseCorpus, type Rule } from "@/lib/supabase";
import type { TreeNode } from "@/lib/tree-data";
import type {
  NavigationDocTypeResult,
  NavigationIndexChildrenParams,
  NavigationIndexChildrenResult,
  NavigationIndexPrefixRowsParams,
  NavigationNodeRow,
} from "./types";
import { NAVIGATION_NODES_VIEW } from "./table";

const NAVIGATION_PAGE_SIZE = 100;
const NAVIGATION_QUERY_TIMEOUT_MS = 5000;
const DOC_TYPE_DISCOVERY_LIMIT = 5000;
const DOC_TYPE_SCAN_LIMIT = 200;
const DOC_TYPE_SCAN_TIMEOUT_MS = 1500;
// Canonical doc_type slugs the corpus uses as root nodes. Probed in parallel
// to avoid a heavy `parent_path IS NULL` scan on large jurisdictions (us,
// us-ca) where the scan times out. A best-effort small scan still runs to
// catch novel doc_types; add new ones here once they appear.
const DOC_TYPE_DISCOVERY_CANDIDATES = [
  "form",
  "guidance",
  "legislation",
  "manual",
  "policy",
  "regulation",
  "rulemaking",
  "statute",
];

export class NavigationIndexUnavailableError extends Error {
  constructor(message = "Navigation index is temporarily unavailable.") {
    super(message);
    this.name = "NavigationIndexUnavailableError";
  }
}

export class NavigationIndexMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationIndexMissingError";
  }
}

export async function getNavigationDocTypes(
  jurisdiction: string,
  encodedOnly: boolean
): Promise<NavigationDocTypeResult> {
  // Run the candidate probes and a small best-effort scan in parallel. The
  // probes are tiny indexed (jurisdiction, doc_type) lookups that usually
  // complete quickly; the scan catches novel doc_types not in the candidate
  // list. Both tolerate individual failures so one slow query cannot
  // poison the whole response, but if *every* probe and the scan failed we
  // surface unavailable rather than pretending the jurisdiction is empty.
  const [probed, scanned] = await Promise.all([
    probeNavigationDocTypes(jurisdiction, encodedOnly),
    scanNavigationDocTypes(jurisdiction, encodedOnly),
  ]);

  const docTypeSet = new Set<string>(probed.docTypes);
  if (scanned) for (const docType of scanned) docTypeSet.add(docType);
  const docTypes = Array.from(docTypeSet).sort();

  if (docTypes.length === 0) {
    if (probed.allFailed && scanned === null) {
      throw new NavigationIndexUnavailableError();
    }
    if (!encodedOnly) {
      throw new NavigationIndexMissingError(
        `Navigation index has no document types for ${jurisdiction}.`
      );
    }
  }

  return { docTypes };
}

async function scanNavigationDocTypes(
  jurisdiction: string,
  encodedOnly: boolean
): Promise<string[] | null> {
  let query = supabaseCorpus
    .from(NAVIGATION_NODES_VIEW)
    .select("doc_type,path,has_rulespec,encoded_descendant_count")
    .eq("jurisdiction", jurisdiction)
    .is("parent_path", null)
    .order("doc_type")
    .limit(DOC_TYPE_SCAN_LIMIT);

  if (encodedOnly) {
    query = query.or("has_rulespec.eq.true,encoded_descendant_count.gt.0");
  }

  const result = await withTimeout(query, DOC_TYPE_SCAN_TIMEOUT_MS);
  if (!result || result.error) return null;

  const rows = (result.data ?? []) as Array<{
    doc_type?: string | null;
    path?: string | null;
  }>;
  return rows
    .map((row) => navigationRootSegment(row.path, row.doc_type))
    .filter((docType): docType is string => Boolean(docType));
}

async function probeNavigationDocTypes(
  jurisdiction: string,
  encodedOnly: boolean
): Promise<{ docTypes: string[]; allFailed: boolean }> {
  // Each probe is best-effort: a slow or failing probe contributes no
  // candidate rather than failing the whole request. Large jurisdictions
  // (us, us-ca) can otherwise have one slow indexed lookup poison the
  // entire root navigation response. The caller still needs to tell
  // "everything failed" apart from "everything returned empty", so we
  // report both pieces.
  const outcomes = await Promise.all(
    DOC_TYPE_DISCOVERY_CANDIDATES.map(async (docType) => {
      let query = supabaseCorpus
        .from(NAVIGATION_NODES_VIEW)
        .select("doc_type,path,has_rulespec,encoded_descendant_count")
        .eq("jurisdiction", jurisdiction)
        .eq("doc_type", docType)
        .is("parent_path", null)
        .limit(1);

      if (encodedOnly) {
        query = query.or("has_rulespec.eq.true,encoded_descendant_count.gt.0");
      }

      const result = await withTimeout(query, NAVIGATION_QUERY_TIMEOUT_MS);
      if (!result || result.error) {
        return { docType: null, failed: true };
      }

      const [row] = (result.data ?? []) as Array<{
        doc_type?: string | null;
        path?: string | null;
      }>;
      return {
        docType: row ? navigationRootSegment(row.path, row.doc_type) : null,
        failed: false,
      };
    })
  );

  const docTypes = outcomes
    .map((outcome) => outcome.docType)
    .filter((docType): docType is string => Boolean(docType));
  const allFailed =
    outcomes.length > 0 && outcomes.every((outcome) => outcome.failed);
  return { docTypes, allFailed };
}

export async function getProvisionCoveredDocTypes(
  jurisdiction: string,
  docTypes: string[]
): Promise<Set<string>> {
  if (docTypes.length === 0) return new Set();

  const covered = new Set<string>();

  // Per-docType coverage checks are best-effort: a slow or failing check
  // is treated as "assume covered" so that one slow query cannot strip an
  // otherwise valid doc_type from the root navigation. The navigation
  // index already vouches for the doc_type's existence; this lookup just
  // filters orphaned entries that have no matching provisions.
  const checks = await Promise.all(
    docTypes.map(async (docType) => {
      const docTypeResult = await withTimeout(
        supabaseCorpus
          .from("current_provisions")
          .select("doc_type")
          .eq("jurisdiction", jurisdiction)
          .eq("doc_type", docType)
          .limit(1),
        NAVIGATION_QUERY_TIMEOUT_MS
      );
      if (!docTypeResult || docTypeResult.error) return docType;

      const docTypeRows = (docTypeResult.data ?? []) as Array<{
        doc_type: string | null;
      }>;
      if (docTypeRows.some((row) => row.doc_type === docType)) {
        return docType;
      }

      const path = `${jurisdiction}/${docType}`;
      const result = await withTimeout(
        supabaseCorpus
          .from("current_provisions")
          .select("citation_path")
          .eq("jurisdiction", jurisdiction)
          .or(
            `citation_path.eq.${path},and(citation_path.gte.${path}/,citation_path.lt.${path}~)`
          )
          .limit(1),
        NAVIGATION_QUERY_TIMEOUT_MS
      );
      if (!result || result.error) return docType;

      const rows = (result.data ?? []) as Array<{
        citation_path: string | null;
      }>;
      return rows.some((row) => row.citation_path?.split("/")[1] === docType)
        ? docType
        : null;
    })
  );

  for (const docType of checks) {
    if (docType) covered.add(docType);
  }
  return covered;
}

export async function getNavigationIndexChildren({
  jurisdiction,
  docType,
  parentPath,
  encodedOnly,
  page,
}: NavigationIndexChildrenParams): Promise<NavigationIndexChildrenResult> {
  const from = page * NAVIGATION_PAGE_SIZE;
  const to = from + NAVIGATION_PAGE_SIZE - 1;

  // The page and, past the end, its count read the same children.
  const children = (head: boolean) => {
    let query = supabaseCorpus
      .from(NAVIGATION_NODES_VIEW)
      .select("*", { count: "exact", head })
      .eq("jurisdiction", jurisdiction)
      .eq("doc_type", docType);

    query =
      parentPath === null
        ? query.is("parent_path", null)
        : query.eq("parent_path", parentPath);

    if (encodedOnly) {
      query = query.or("has_rulespec.eq.true,encoded_descendant_count.gt.0");
    }
    return query;
  };

  // Siblings can share a sort_key, so path and then id break ties and give
  // every row one page whatever plan the database picks.
  const readPage = () =>
    withTimeout(
      children(false)
        .order("sort_key")
        .order("path")
        .order("id")
        .range(from, to),
      NAVIGATION_QUERY_TIMEOUT_MS
    );
  let result = await readPage();
  if (!result) throw new NavigationIndexUnavailableError();
  if (result.error) {
    // With an exact count, PostgREST answers a range that starts past the
    // last row with 416 (a stale or hand-typed ?page=). postgrest-js reads
    // the count only from a successful answer, so ask for it on its own.
    // Every other error is still the index failing.
    if (result.status !== 416) throw new NavigationIndexUnavailableError();
    const counted = await withTimeout(
      children(true),
      NAVIGATION_QUERY_TIMEOUT_MS
    );
    if (!counted || counted.error || !isRowCount(counted.count)) {
      throw new NavigationIndexUnavailableError();
    }
    if (counted.count <= from) {
      return { rows: [], total: counted.count, hasMore: false };
    }
    // Rows landed between the two reads, so the page exists now: read it
    // once more, and take any failure this time as the index failing.
    result = await readPage();
    if (!result || result.error) throw new NavigationIndexUnavailableError();
  }

  const rows = (result.data ?? []) as NavigationNodeRow[];
  const total = result.count ?? rows.length;

  return {
    rows,
    total,
    hasMore: (page + 1) * NAVIGATION_PAGE_SIZE < total,
  };
}

// A row count PostgREST actually sent. postgrest-js reads a Content-Range
// of */* (no total) as NaN.
function isRowCount(count: number | null): count is number {
  return Number.isSafeInteger(count) && (count as number) >= 0;
}

/** The last page of a level with `total` children; 0 when it has none. */
export function lastNavigationPage(total: number): number {
  return Math.max(0, Math.ceil(total / NAVIGATION_PAGE_SIZE) - 1);
}

export async function getNavigationIndexNode(
  path: string
): Promise<NavigationNodeRow | null> {
  // Not maybeSingle(): the index has shipped duplicate rows for a
  // path (us/statute/26 appeared twice after a partial re-ingestion,
  // one copy with a corrupted sort_key), and maybeSingle() turns
  // that into a 503 for the whole subtree. Order by sort_key
  // descending so the canonically-sorted row wins deterministically;
  // the duplicate itself is an upstream corpus bug.
  const result = await withTimeout(
    supabaseCorpus
      .from(NAVIGATION_NODES_VIEW)
      .select("*")
      .eq("path", path)
      .order("sort_key", { ascending: false })
      .limit(1),
    NAVIGATION_QUERY_TIMEOUT_MS
  );
  if (!result) throw new NavigationIndexUnavailableError();
  if (result.error) throw new NavigationIndexUnavailableError();
  const rows = (result.data ?? []) as NavigationNodeRow[];
  return rows[0] ?? null;
}

export async function getNavigationIndexPrefixRows({
  jurisdiction,
  docType,
  pathPrefix,
  encodedOnly,
}: NavigationIndexPrefixRowsParams): Promise<NavigationNodeRow[]> {
  let query = supabaseCorpus
    .from(NAVIGATION_NODES_VIEW)
    .select("*")
    .eq("jurisdiction", jurisdiction)
    .eq("doc_type", docType)
    .gte("path", `${pathPrefix}/`)
    .lt("path", `${pathPrefix}~`)
    .order("path")
    .limit(DOC_TYPE_DISCOVERY_LIMIT);

  if (encodedOnly) {
    query = query.or("has_rulespec.eq.true,encoded_descendant_count.gt.0");
  }

  const result = await withTimeout(query, NAVIGATION_QUERY_TIMEOUT_MS);
  if (!result) throw new NavigationIndexUnavailableError();
  if (result.error) throw new NavigationIndexUnavailableError();
  return (result.data ?? []) as NavigationNodeRow[];
}

export async function getProvisionForNavigationNode(
  node: NavigationNodeRow
): Promise<Rule | null> {
  let query = supabaseCorpus.from("current_provisions").select("*");
  query = node.provision_id
    ? query.eq("id", node.provision_id)
    : query.eq("citation_path", node.path);

  const result = await withTimeout(
    query.maybeSingle(),
    NAVIGATION_QUERY_TIMEOUT_MS
  );
  if (!result) throw new NavigationIndexUnavailableError();
  if (result.error) throw new NavigationIndexUnavailableError();
  return (result.data as Rule | null) ?? null;
}

export async function getProvisionByCitationPath(
  citationPath: string
): Promise<Rule | null> {
  const result = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*")
      .eq("citation_path", citationPath)
      .maybeSingle(),
    NAVIGATION_QUERY_TIMEOUT_MS
  );
  if (!result) throw new NavigationIndexUnavailableError();
  if (result.error) throw new NavigationIndexUnavailableError();
  return (result.data as Rule | null) ?? null;
}

export async function getResolvableNavigationNodeIds(
  rows: NavigationNodeRow[]
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();

  const provisionIds = Array.from(
    new Set(
      rows
        .map((row) => row.provision_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const citationPaths = Array.from(
    new Set(
      rows
        .map((row) => row.citation_path ?? row.path)
        .filter((path): path is string => Boolean(path))
    )
  );
  const matchedProvisionIds = new Set<string>();
  const matchedCitationPaths = new Set<string>();

  if (provisionIds.length > 0) {
    // Chunked: a single 200-value IN over long paths can blow the
    // statement timeout (observed on us/policy).
    for (let i = 0; i < provisionIds.length; i += 100) {
      const result = await withTimeout(
        supabaseCorpus
          .from("current_provisions")
          .select("id")
          .in("id", provisionIds.slice(i, i + 100)),
        NAVIGATION_QUERY_TIMEOUT_MS
      );
      if (!result) throw new NavigationIndexUnavailableError();
      if (result.error) throw new NavigationIndexUnavailableError();
      for (const row of (result.data ?? []) as Array<{ id: string | null }>) {
        if (row.id) matchedProvisionIds.add(row.id);
      }
    }
  }

  if (citationPaths.length > 0) {
    const filters = [
      ...citationPaths.map((path) => `citation_path.eq.${path}`),
      ...rows
        .filter((row) => row.has_children)
        .map((row) => {
          const path = row.citation_path ?? row.path;
          return `and(citation_path.gte.${path}/,citation_path.lt.${path}~)`;
        }),
    ];
    for (let i = 0; i < filters.length; i += 40) {
      const result = await withTimeout(
        supabaseCorpus
          .from("current_provisions")
          .select("citation_path")
          .or(filters.slice(i, i + 40).join(",")),
        NAVIGATION_QUERY_TIMEOUT_MS
      );
      if (!result) throw new NavigationIndexUnavailableError();
      if (result.error) throw new NavigationIndexUnavailableError();
      for (const row of (result.data ?? []) as Array<{
        citation_path: string | null;
      }>) {
        if (row.citation_path) matchedCitationPaths.add(row.citation_path);
      }
    }
  }

  const resolvable = new Set<string>();
  for (const row of rows) {
    const citationPath = row.citation_path ?? row.path;
    if (
      (row.provision_id && matchedProvisionIds.has(row.provision_id)) ||
      matchedCitationPaths.has(citationPath) ||
      Array.from(matchedCitationPaths).some((path) =>
        path.startsWith(`${citationPath}/`)
      )
    ) {
      resolvable.add(row.id);
    }
  }
  return resolvable;
}

export function navigationDocTypeToTreeNode(segment: string): TreeNode {
  return {
    segment,
    label:
      segment === "statute"
        ? "Statutes"
        : segment === "regulation"
          ? "Regulations"
          : formatGenericSegmentLabel(segment),
    hasChildren: true,
    nodeType: "doc_type",
  };
}

export function navigationRowToTreeNode(row: NavigationNodeRow): TreeNode {
  const rule = navigationRowToMinimalRule(row);
  return {
    segment: row.segment,
    label: row.label || row.segment,
    hasChildren: row.has_children,
    childCount: row.child_count > 0 ? row.child_count : undefined,
    rule,
    nodeType: "section",
    hasRuleSpec: row.has_rulespec || row.encoded_descendant_count > 0,
  };
}

function navigationRowToMinimalRule(row: NavigationNodeRow): Rule {
  const now = row.updated_at ?? row.created_at ?? "";
  return {
    id: row.provision_id ?? row.id,
    jurisdiction: row.jurisdiction,
    doc_type: row.doc_type,
    parent_id: null,
    level: row.depth,
    ordinal: null,
    heading: row.label,
    body: null,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: null,
    citation_path: row.citation_path ?? row.path,
    rulespec_path: null,
    has_rulespec: row.has_rulespec,
    created_at: now,
    updated_at: now,
  };
}

function formatGenericSegmentLabel(segment: string): string {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function navigationRootSegment(
  path: string | null | undefined,
  docType: string | null | undefined
): string | null {
  const parts = path?.split("/") ?? [];
  if (parts.length === 2) return parts[1] || null;
  return docType || null;
}

function withTimeout<T>(
  work: PromiseLike<T> | T,
  ms: number
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}
