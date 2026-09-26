import { supabaseCorpus, type Rule } from "@/lib/supabase";
import { naturalCompare } from "@/lib/natural-sort";
import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";
import {
  JURISDICTIONS_SEED,
  synthesiseJurisdiction,
} from "@/lib/axiom/jurisdictions-seed";
import { chapterlessSectionAlias } from "@/lib/axiom/citation-path-aliases";
import { browseRootLevels } from "@/lib/axiom/browse-root-levels";

export type NodeType =
  | "jurisdiction"
  | "doc_type"
  | "title"
  | "section"
  | "act";

export interface TreeNode {
  /** URL segment: "us", "statute", "26", "1" */
  segment: string;
  /** Display label: "US Federal", "Title 26", "§ 1 — Tax imposed" */
  label: string;
  hasChildren: boolean;
  /** For count badges */
  childCount?: number;
  /** The underlying DB rule, if this node maps to one */
  rule?: Rule;
  nodeType: NodeType;
  /** Whether this node has RuleSpec coverage in corpus metadata or a rulespec-* repo. */
  hasRuleSpec?: boolean;
}

export interface TreeResult {
  nodes: TreeNode[];
  hasMore: boolean;
  total: number;
  /** Set when a citation-path resolves to a rule with no children (leaf node) */
  leafRule?: Rule;
  /** Set when a citation-path resolves to a rule that still has child nodes */
  currentRule?: Rule;
}

// ---- Flat jurisdiction config ----

export interface Jurisdiction {
  /** URL segment and DB jurisdiction ID: "us", "us-oh", "uk", "ca" */
  slug: string;
  /** Display label: "US Federal", "Ohio", "United Kingdom" */
  label: string;
  /** Whether rules use citation_path-based navigation */
  hasCitationPaths: boolean;
}

export const JURISDICTIONS: Jurisdiction[] = JURISDICTIONS_SEED;

/**
 * Resolve a URL slug into a Jurisdiction record. Falls through to a
 * synthesised record for well-formed but uncurated slugs (e.g. a new
 * US state we haven't labelled yet) so a direct URL or an incoming
 * reference still lands on the rule page instead of the Axiom
 * landing.
 */
export function getJurisdictionBySlug(
  slug: string
): Jurisdiction | undefined {
  const curated = JURISDICTIONS.find((j) => j.slug === slug);
  if (curated) return curated;
  return synthesiseJurisdiction(slug) ?? undefined;
}

// ---- Path resolution ----

export type AxiomPhase = "jurisdiction-picker" | "rule";

export interface ResolvedPath {
  phase: AxiomPhase;
  jurisdiction?: Jurisdiction;
  ruleSegments: string[];
}

export function resolveAxiomPath(segments: string[]): ResolvedPath {
  if (segments.length === 0) {
    return { phase: "jurisdiction-picker", ruleSegments: [] };
  }

  const jurisdiction = getJurisdictionBySlug(segments[0]);
  if (!jurisdiction) {
    return { phase: "jurisdiction-picker", ruleSegments: [] };
  }

  return {
    phase: "rule",
    jurisdiction,
    ruleSegments: segments.slice(1),
  };
}

// ---- Jurisdiction lookup ----

/** Look up jurisdiction config by DB ID (same as slug in flat model) */
export function getJurisdiction(
  id: string
): { id: string; label: string; hasCitationPaths: boolean } | undefined {
  const j = getJurisdictionBySlug(id);
  if (!j) return undefined;
  return { id: j.slug, label: j.label, hasCitationPaths: j.hasCitationPaths };
}

// ---- Display context for leaf nodes ----

export interface DisplayContext {
  rule: Rule;
  parentBody: string | null;
  siblings: Rule[];
  targetIndex: number;
}

export async function resolveDisplayContext(rule: Rule): Promise<DisplayContext> {
  if (!rule.parent_id) {
    return { rule, parentBody: null, siblings: [rule], targetIndex: 0 };
  }
  const parentResult = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*")
      .eq("id", rule.parent_id)
      .single(),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const parent = (parentResult?.data as Rule | null) ?? null;
  if (!parent) {
    return { rule, parentBody: null, siblings: [rule], targetIndex: 0 };
  }
  const siblingsResult = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*")
      .eq("parent_id", rule.parent_id)
      .order("ordinal"),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const siblings = (siblingsResult?.data || []) as Rule[];
  const targetIndex = siblings.findIndex((s) => s.id === rule.id);
  return {
    rule,
    parentBody: parent.body || null,
    siblings,
    targetIndex: targetIndex >= 0 ? targetIndex : 0,
  };
}

// ---- Pagination ----

const PAGE_SIZE = 100;
// Generous enough to survive cold starts (dev compile, cold
// serverless + cold Postgres) — 2.5s produced spurious "Navigation
// data is temporarily unavailable" on first loads.
const TREE_QUERY_TIMEOUT_MS = 6000;
const PREFIX_SCAN_PAGE_SIZE = 1000;
const PREFIX_SCAN_MAX_ROWS = 10000;
const ROOT_SCAN_PAGE_SIZE = 1000;
const ROOT_SCAN_MAX_ROWS = 10000;
const AXIOM_ROOT_NODE_LIMIT = 500;
const KNOWN_DOC_TYPES = [
  "statute",
  "regulation",
  "rulemaking",
  "policy",
  "legislation",
];

// ---- Query functions ----

/* v8 ignore start -- Supabase queries tested via integration/e2e */

export class TreeDataUnavailableError extends Error {
  constructor(message = "Navigation data is temporarily unavailable.") {
    super(message);
    this.name = "TreeDataUnavailableError";
  }
}

function hasNextPage(page: number, total: number): boolean {
  return (page + 1) * PAGE_SIZE < total;
}

function citationPrefixUpperBound(pathPrefix: string): string {
  return `${pathPrefix}~`;
}

function citationDepth(citationPath: string): number {
  let depth = 1;
  for (let i = 0; i < citationPath.length; i++) {
    if (citationPath[i] === "/") depth++;
  }
  return depth;
}

function withTimeout<T, F = T>(
  work: PromiseLike<T> | T,
  ms: number,
  fallback: F
): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

async function withTimeoutStatus<T>(
  work: PromiseLike<T> | T,
  ms: number
): Promise<
  | { status: "ok"; value: T }
  | { status: "timeout" }
  | { status: "error"; error: unknown }
> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: "timeout" }), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve({ status: "ok", value });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ status: "error", error });
      }
    );
  });
}

function sortRulesByOrdinalThenCitation(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    const aOrdinal = a.ordinal;
    const bOrdinal = b.ordinal;

    if (aOrdinal != null && bOrdinal != null && aOrdinal !== bOrdinal) {
      return aOrdinal - bOrdinal;
    }
    if (aOrdinal != null && bOrdinal == null) return -1;
    if (aOrdinal == null && bOrdinal != null) return 1;

    return naturalCompare(a.citation_path ?? a.id, b.citation_path ?? b.id);
  });
}

async function fetchDirectRootChildrenByCitationPrefix(
  pathPrefix: string
): Promise<{ rows: Rule[]; truncated: boolean }> {
  const expectedDepth = citationDepth(pathPrefix) + 1;
  const childPrefix = `${pathPrefix}/`;
  const upperBound = citationPrefixUpperBound(pathPrefix);
  const rows: Rule[] = [];
  let cursor = pathPrefix;

  while (rows.length < PREFIX_SCAN_MAX_ROWS) {
    const result = await withTimeout(
      supabaseCorpus
        .from("current_provisions")
        .select("*")
        .gte("citation_path", cursor)
        .lt("citation_path", upperBound)
        .order("citation_path")
        .limit(PREFIX_SCAN_PAGE_SIZE),
      TREE_QUERY_TIMEOUT_MS,
      null
    );
    if (!result) return { rows, truncated: true };
    const { data, error } = result;

    if (error || !data || data.length === 0) {
      return { rows, truncated: false };
    }

    let nextChild: Rule | null = null;
    for (const row of data as Rule[]) {
      if (
        row.citation_path &&
        row.citation_path.startsWith(childPrefix) &&
        citationDepth(row.citation_path) === expectedDepth
      ) {
        nextChild = row;
        break;
      }
    }

    if (!nextChild?.citation_path) {
      if (data.length < PREFIX_SCAN_PAGE_SIZE) {
        return { rows, truncated: false };
      }
      const lastPath = (data[data.length - 1] as Rule).citation_path;
      if (!lastPath || lastPath <= cursor) {
        return { rows, truncated: true };
      }
      cursor = `${lastPath}~`;
      continue;
    }

    rows.push(nextChild);

    // Jump past this child's entire subtree. ``<child>~`` sorts after
    // the child subtree while still allowing numeric siblings like 10
    // and 11 to follow a title bucket like 1.
    cursor = `${nextChild.citation_path}~`;

    if (cursor >= upperBound) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
}

/**
 * Fetch aggregate rule count for a list of DB jurisdiction IDs.
 * Used by JurisdictionPicker for count badges.
 */
export async function getJurisdictionCounts(
  dbIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(
    dbIds.map(async (id) => {
      const result = await withTimeout(
        supabaseCorpus
          .from("current_provisions")
          .select("*", { count: "exact", head: true })
          .eq("jurisdiction", id),
        TREE_QUERY_TIMEOUT_MS,
        null
      );
      counts.set(id, result?.count || 0);
    })
  );
  return counts;
}

export async function getDocTypeNodes(
  jurisdiction: string
): Promise<TreeNode[]> {
  // Do not discover root document types by sorting citation_path.
  // Large state corpora such as Illinois can statement-timeout on
  // ``order(citation_path)`` even though a simple existence check by
  // doc_type is fast. Query the known doc-type buckets directly, then
  // fall back to a bounded unsorted scan only for unexpected buckets.
  const discovered = await withTimeout(
    Promise.all(
      KNOWN_DOC_TYPES.map(async (segment) => {
        const rootPath = `${jurisdiction}/${segment}`;
        const { data: rootData } = await supabaseCorpus
          .from("current_provisions")
          .select("id")
          .eq("citation_path", rootPath)
          .limit(1);
        if (rootData && rootData.length > 0) return segment;

        const { data } = await supabaseCorpus
          .from("current_provisions")
          .select("citation_path")
          .eq("jurisdiction", jurisdiction)
          .eq("doc_type", segment)
          .is("parent_id", null)
          .limit(1);
        const citationPath = data?.[0]?.citation_path;
        const citationSegment = citationPath?.split("/")[1];
        return data &&
          data.length > 0 &&
          (!citationSegment || citationSegment === segment)
          ? segment
          : null;
      })
    ),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  if (!discovered) return fallbackDocTypeNodes(jurisdiction);

  const docTypes = new Set(
    discovered.filter((segment): segment is string => segment !== null)
  );

  if (docTypes.size === 0) {
    for (let offset = 0; offset < ROOT_SCAN_MAX_ROWS; offset += ROOT_SCAN_PAGE_SIZE) {
      const result = await withTimeout(
        supabaseCorpus
          .from("current_provisions")
          .select("doc_type")
          .eq("jurisdiction", jurisdiction)
          .is("parent_id", null)
          .range(offset, offset + ROOT_SCAN_PAGE_SIZE - 1),
        TREE_QUERY_TIMEOUT_MS,
        null
      );
      if (!result) return fallbackDocTypeNodes(jurisdiction);
      const { data } = result;

      if (!data || data.length === 0) break;

      for (const row of data) {
        if (row.doc_type) docTypes.add(row.doc_type);
      }

      if (data.length < ROOT_SCAN_PAGE_SIZE) break;
    }
  }

  return Array.from(docTypes)
    .sort(naturalCompare)
    .map((segment) => docTypeNode(segment));
}

function fallbackDocTypeNodes(jurisdiction: string): TreeNode[] {
  if (jurisdiction === "uk") return [docTypeNode("legislation")];
  if (jurisdiction === "ca") return [docTypeNode("statute")];
  if (jurisdiction === "us") {
    return ["regulation", "rulemaking", "statute"].map((segment) =>
      docTypeNode(segment)
    );
  }
  if (jurisdiction.startsWith("us-")) {
    return ["policy", "regulation", "statute"].map((segment) =>
      docTypeNode(segment)
    );
  }
  return KNOWN_DOC_TYPES.map((segment) => docTypeNode(segment));
}

async function fetchChildEntriesByCitationPrefix(
  pathPrefix: string
): Promise<Array<{ segment: string; rule?: Rule }>> {
  const [jurisdiction, docType] = pathPrefix.split("/");
  const childPrefix = `${pathPrefix}/`;
  const expectedDepth = citationDepth(pathPrefix) + 1;
  const upperBound = citationPrefixUpperBound(pathPrefix);
  const entries: Array<{ segment: string; rule?: Rule }> = [];
  const seen = new Set<string>();
  let cursor = childPrefix;

  while (entries.length < PREFIX_SCAN_MAX_ROWS && cursor < upperBound) {
    const result = await withTimeoutStatus(
      supabaseCorpus
        .from("current_provisions")
        .select("*")
        .eq("jurisdiction", jurisdiction)
        .eq("doc_type", docType)
        .gte("citation_path", cursor)
        .lt("citation_path", upperBound)
        .order("citation_path")
        .limit(PREFIX_SCAN_PAGE_SIZE),
      TREE_QUERY_TIMEOUT_MS
    );

    if (result.status !== "ok") {
      throw new TreeDataUnavailableError();
    }

    const { data, error } = result.value;
    if (error) throw new TreeDataUnavailableError();
    if (!data || data.length === 0) return entries;

    let nextSegment: string | null = null;
    let nextRule: Rule | undefined;
    for (const row of data as Rule[]) {
      if (!row.citation_path?.startsWith(childPrefix)) continue;
      const parts = row.citation_path.split("/");
      const segment = parts[expectedDepth - 1];
      if (!segment || seen.has(segment)) continue;
      nextSegment = segment;
      if (citationDepth(row.citation_path) === expectedDepth) {
        nextRule = row;
      }
      break;
    }

    if (!nextSegment) {
      if (data.length < PREFIX_SCAN_PAGE_SIZE) return entries;
      const lastPath = (data[data.length - 1] as Rule).citation_path;
      if (!lastPath || lastPath <= cursor) return entries;
      cursor = `${lastPath}~`;
      continue;
    }

    seen.add(nextSegment);
    entries.push(
      nextRule ? { segment: nextSegment, rule: nextRule } : { segment: nextSegment }
    );
    cursor = `${pathPrefix}/${nextSegment}~`;
  }

  return entries;
}

async function fetchRootLevelEntries(
  jurisdiction: string,
  docType: string
): Promise<Array<{ segment: string; rule?: Rule }>> {
  for (const level of browseRootLevels(jurisdiction, docType)) {
    const result = await withTimeoutStatus(
      supabaseCorpus
        .from("current_provisions")
        .select("*")
        .eq("jurisdiction", jurisdiction)
        .eq("doc_type", docType)
        .eq("level", level)
        .order("ordinal")
        .limit(AXIOM_ROOT_NODE_LIMIT),
      TREE_QUERY_TIMEOUT_MS
    );

    if (result.status !== "ok") continue;

    const { data, error } = result.value;
    if (error) continue;

    const entries = titleEntriesFromRootRows((data ?? []) as Rule[]);
    if (entries.length > 0) return entries;
  }

  return [];
}

function titleEntriesFromRootRows(
  rows: Rule[]
): Array<{ segment: string; rule?: Rule }> {
  const bySegment = new Map<string, { segment: string; rule?: Rule }>();
  for (const rule of rows) {
    if (!rule.citation_path) continue;
    const segment = rule.citation_path.split("/")[2];
    if (!segment) continue;
    const existing = bySegment.get(segment);
    if (
      !existing ||
      citationDepth(rule.citation_path) <
        citationDepth(existing.rule?.citation_path ?? "")
    ) {
      bySegment.set(segment, { segment, rule });
    }
  }
  return Array.from(bySegment.values()).sort((a, b) =>
    naturalCompare(a.segment, b.segment)
  );
}

function titleEntryToNode(
  entry: { segment: string; rule?: Rule },
  encodedPaths?: Set<string>
): TreeNode {
  return entry.rule
    ? ruleToSectionNode(entry.rule, encodedPaths)
    : titleNode(entry.segment);
}

function docTypeNode(segment: string): TreeNode {
  return {
    segment,
    label:
      segment === "statute"
        ? "Statutes"
        : segment === "regulation"
          ? "Regulations"
          : segment === "rulemaking"
            ? "Rulemaking"
          : formatGenericSegmentLabel(segment),
    hasChildren: true,
    nodeType: "doc_type" as const,
  };
}

export async function getTitleNodes(
  jurisdiction: string,
  _docType: string,
  encodedPaths?: Set<string>,
  encodedOnly?: boolean
): Promise<TreeNode[]> {
  const deterministicFallback = fallbackTitleSegments(jurisdiction, _docType);
  if (!encodedOnly && deterministicFallback.length > 0) {
    return deterministicFallback.map((title) => titleNode(title));
  }

  // When the encoded-only filter is on, derive the title list
  // directly from the encoded-paths set. It is small and authoritative,
  // and it avoids touching broad corpus navigation queries.
  if (encodedOnly && encodedPaths) {
    const encoded = new Set<string>();
    const docTypePrefix = `${_docType}/`;
    for (const p of encodedPaths) {
      if (!p.startsWith(docTypePrefix)) continue;
      const tail = p.slice(docTypePrefix.length);
      const firstSeg = tail.split("/")[0];
      if (firstSeg) encoded.add(firstSeg);
    }
    if (encoded.size === 0) return [];
    return Array.from(encoded)
      .sort(naturalCompare)
      .map((title) => titleNode(title));
  }

  const rootEntries = await fetchRootLevelEntries(jurisdiction, _docType);
  if (rootEntries.length > 0) {
    return rootEntries.map((entry) => titleEntryToNode(entry, encodedPaths));
  }

  const prefixEntries = await fetchChildEntriesByCitationPrefix(
    `${jurisdiction}/${_docType}`
  );
  return prefixEntries.map((entry) => titleEntryToNode(entry, encodedPaths));
}

function fallbackTitleSegments(jurisdiction: string, docType: string): string[] {
  if (jurisdiction === "us" && docType === "statute") {
    return Array.from({ length: 54 }, (_, index) => String(index + 1));
  }
  if (jurisdiction === "us" && docType === "regulation") {
    return Array.from({ length: 50 }, (_, index) => String(index + 1));
  }
  return [];
}

function titleNode(title: string, childCount?: number): TreeNode {
  return {
    segment: title,
    label: `Title ${title}`,
    hasChildren: true,
    ...(childCount !== undefined ? { childCount } : {}),
    nodeType: "title" as const,
  };
}

/**
 * Look up rules whose citation_path is ``<rule>.<...>`` — i.e. dotted
 * subsections that share a parent with ``rule`` in the corpus but
 * read as a subsection in the law's own numbering. Used to surface
 * CCR-style subsections (``4.401.1``, ``4.401.2``) under their
 * parent's page even though the corpus tree doesn't re-parent them.
 */
async function fetchDottedSubsectionSiblings(rule: Rule): Promise<Rule[]> {
  if (!rule.citation_path) return [];
  const lower = `${rule.citation_path}.`;
  const upper =
    lower.slice(0, -1) + String.fromCharCode(lower.charCodeAt(lower.length - 1) + 1);
  const result = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*")
      .gte("citation_path", lower)
      .lt("citation_path", upper)
      .order("citation_path"),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const data = result?.data;
  return (data ?? []) as Rule[];
}

function coloradoPolicyCanonicalAlias(pathPrefix: string): string | null {
  const parts = pathPrefix.split("/");
  if (parts[0] !== "us-co" || parts[1] !== "policy" || parts.length < 4) {
    return null;
  }
  const agency = parts[2];
  const page = parts[3];
  if (!agency || !page) return null;
  return ["us-co", "policy", `co-${agency}-${page}`, ...parts.slice(4)].join(
    "/"
  );
}

function canonicalCitationPathAlias(pathPrefix: string): string | null {
  return (
    chapterlessSectionAlias(pathPrefix) ??
    coloradoPolicyCanonicalAlias(pathPrefix)
  );
}

async function fetchColoradoPolicyAgencyNodes(
  pathPrefix: string,
  encodedPaths?: Set<string>,
  encodedOnly?: boolean
): Promise<TreeResult | null> {
  const parts = pathPrefix.split("/");
  if (parts[0] !== "us-co" || parts[1] !== "policy" || parts.length !== 3) {
    return null;
  }

  const agency = parts[2];
  const canonicalPrefix = `us-co/policy/co-${agency}-`;
  const canonicalUpperBound = `us-co/policy/co-${agency}~`;
  const rows: Rule[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < PREFIX_SCAN_MAX_ROWS; offset += PREFIX_SCAN_PAGE_SIZE) {
    const result = await withTimeout(
      supabaseCorpus
        .from("current_provisions")
        .select("*")
        .gte("citation_path", canonicalPrefix)
        .lt("citation_path", canonicalUpperBound)
        .order("citation_path")
        .range(offset, offset + PREFIX_SCAN_PAGE_SIZE - 1),
      TREE_QUERY_TIMEOUT_MS,
      null
    );
    if (!result) break;
    const { data } = result;

    if (!data || data.length === 0) break;

    for (const row of data as Rule[]) {
      if (
        row.citation_path &&
        row.parent_id === null &&
        citationDepth(row.citation_path) === 3 &&
        !seen.has(row.citation_path)
      ) {
        seen.add(row.citation_path);
        rows.push(row);
      }
    }

    if (data.length < PREFIX_SCAN_PAGE_SIZE) break;
  }

  if (rows.length === 0) return null;

  let nodes = sortRulesByOrdinalThenCitation(rows).map((rule) => {
    const node = ruleToSectionNode(rule, encodedPaths);
    const canonicalSegment =
      rule.citation_path?.split("/").pop() ?? node.segment;
    const virtualSegment = canonicalSegment.startsWith(`co-${agency}-`)
      ? canonicalSegment.slice(`co-${agency}-`.length)
      : canonicalSegment;
    return { ...node, segment: virtualSegment };
  });

  if (encodedOnly && encodedPaths) {
    nodes = nodes.filter((n) => {
      if (!n.rule?.citation_path) return false;
      return hasEncodedDescendant(
        encodedPaths,
        n.rule.citation_path.split("/").slice(1).join("/")
      );
    });
  }

  return {
    nodes,
    hasMore: false,
    total: nodes.length,
  };
}

export async function getSectionNodes(
  pathPrefix: string,
  page: number = 0,
  encodedPaths?: Set<string>,
  encodedOnly?: boolean
): Promise<TreeResult> {
  const parentResult = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*")
      .eq("citation_path", pathPrefix)
      .maybeSingle(),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const parentRule = parentResult?.data ?? null;

  if (parentRule) {
    // Encoded-only short-circuit: pull the encoded descendants
    // directly by their citation_path instead of walking the
    // corpus's parent_id tree. The corpus parents 7 CFR 273.3 under
    // ``subpart-B`` and the rulespec-us repo files it as bare
    // ``273/3.yaml``, so a path-prefix descendant check on the
    // subpart node never matches. Picking up the encoded paths
    // straight from the set produces the right list regardless.
    if (encodedOnly && encodedPaths) {
      const pathTail = pathPrefix.split("/").slice(1).join("/");
      const jurisdiction = pathPrefix.split("/")[0];
      const wantedTails = new Set<string>();
      for (const p of encodedPaths) {
        if (!p.startsWith(`${pathTail}/`)) continue;
        const remainder = p.slice(pathTail.length + 1);
        const firstSeg = remainder.split("/")[0];
        if (firstSeg) wantedTails.add(firstSeg);
      }
      if (wantedTails.size === 0) {
        return {
          nodes: [],
          hasMore: false,
          total: 0,
          currentRule: parentRule as Rule,
        };
      }
      const wantedPaths = Array.from(wantedTails).map(
        (t) => `${pathPrefix}/${t}`
      );
      const encodedRowsResult = await withTimeout(
        supabaseCorpus
          .from("current_provisions")
          .select("*")
          .in("citation_path", wantedPaths)
          .order("citation_path"),
        TREE_QUERY_TIMEOUT_MS,
        null
      );
      const encodedRows = encodedRowsResult?.data;
      const rules = (encodedRows ?? []) as Rule[];
      void jurisdiction;
      return {
        nodes: rules.map((r) => ruleToSectionNode(r, encodedPaths)),
        hasMore: false,
        total: rules.length,
        currentRule: parentRule as Rule,
      };
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const childrenResult = await withTimeout(
      supabaseCorpus
        .from("current_provisions")
        .select("*", { count: "exact" })
        .eq("parent_id", parentRule.id)
        .order("ordinal")
        .range(from, to),
      TREE_QUERY_TIMEOUT_MS,
      null
    );
    const data = childrenResult?.data;
    const count = childrenResult?.count;

    const rules = (data || []) as Rule[];
    const total = count || 0;

    // Leaf node: parentRule exists but has no parent_id-anchored
    // children. Before declaring it a leaf, look for citation-path
    // siblings that read like dotted subsections — the CCR encoder
    // stores ``4.401.1``, ``4.401.2`` as siblings of ``4.401`` under
    // the same regulation parent, even though the dotted form reads
    // as a subsection. Promote those to virtual children so the
    // reader gets a navigable subsection list.
    if (total === 0) {
      const dotted = await fetchDottedSubsectionSiblings(
        parentRule as Rule
      );
      if (dotted.length > 0) {
        return {
          nodes: dotted.map((r) => ruleToSectionNode(r, encodedPaths)),
          hasMore: false,
          total: dotted.length,
          currentRule: parentRule as Rule,
        };
      }
      return {
        nodes: [],
        hasMore: false,
        total: 0,
        leafRule: parentRule as Rule,
      };
    }

    const nodes = rules.map((r) => ruleToSectionNode(r, encodedPaths));

    return {
      nodes,
      hasMore: hasNextPage(page, total),
      total: encodedOnly ? nodes.length : total,
      currentRule: parentRule as Rule,
    };
  }

  const aliasPath = canonicalCitationPathAlias(pathPrefix);
  if (aliasPath && aliasPath !== pathPrefix) {
    return getSectionNodes(aliasPath, page, encodedPaths, encodedOnly);
  }

  const coloradoPolicyAgency = await withTimeout(
    fetchColoradoPolicyAgencyNodes(pathPrefix, encodedPaths, encodedOnly),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  if (coloradoPolicyAgency) {
    return coloradoPolicyAgency;
  }

  const { rows, truncated } = await withTimeout(
    fetchDirectRootChildrenByCitationPrefix(pathPrefix),
    TREE_QUERY_TIMEOUT_MS,
    { rows: [], truncated: true }
  );
  const sortedRules = sortRulesByOrdinalThenCitation(rows);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE;
  const pageRules = sortedRules.slice(from, to);

  let nodes = pageRules.map((r) => ruleToSectionNode(r));

  // Filter to nodes that have encoded descendants
  if (encodedOnly && encodedPaths) {
    nodes = nodes.filter((n) => {
      if (n.rule?.citation_path) {
        const parts = n.rule.citation_path.split("/");
        const withoutJurisdiction = parts.slice(1).join("/");
        return hasEncodedDescendant(encodedPaths, withoutJurisdiction);
      }
      return false;
    });
  }

  return {
    nodes,
    hasMore: truncated || to < sortedRules.length,
    total: encodedOnly ? nodes.length : sortedRules.length,
  };
}

/**
 * Fetch the citation paths of every encoded rule for a jurisdiction,
 * returned without the leading jurisdiction segment (so e.g.
 * ``us/statute/26/1`` becomes ``statute/26/1``). The "Encoded only"
 * filter narrows the tree to branches whose paths show up in this
 * set.
 *
 * The canonical source is the jurisdiction's ``rulespec-*`` GitHub repo
 * — that's the file-system of truth about what's been checked in,
 * regardless of whether ``has_rulespec`` has been backfilled in the
 * corpus DB. We layer in any corpus rows that already carry the flag
 * too, so an in-flight encoder run that sets ``has_rulespec=true``
 * before pushing the YAML still shows up.
 */
export async function getEncodedPaths(
  jurisdiction: string
): Promise<Set<string>> {
  const paths = new Set<string>();

  // Source 1: rulespec-* GitHub tree
  try {
    const files = await withTimeout(
      import("@/lib/axiom/rulespec/repo-listing").then(({ listEncodedFiles }) =>
        listEncodedFiles(jurisdiction)
      ),
      TREE_QUERY_TIMEOUT_MS,
      []
    );
    for (const f of files) {
      const parts = f.citationPath.split("/");
      paths.add(parts.slice(1).join("/"));
    }
  } catch {
    // Repo lookup failures fall through silently — corpus may still
    // surface some encoded paths via has_rulespec=true.
  }

  // Source 2: corpus.has_rulespec
  const result = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("citation_path")
      .eq("jurisdiction", jurisdiction)
      .eq("has_rulespec", true),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const data = result?.data;

  if (data) {
    for (const row of data) {
      if (row.citation_path) {
        const parts = row.citation_path.split("/");
        paths.add(parts.slice(1).join("/"));
      }
    }
  }
  return paths;
}

/**
 * Check if any encoded path starts with the given prefix.
 * Used to filter tree branches that contain at least one encoded rule.
 */
export function hasEncodedDescendant(
  encodedPaths: Set<string>,
  prefix: string
): boolean {
  for (const p of encodedPaths) {
    if (p === prefix || p.startsWith(prefix + "/")) return true;
  }
  return false;
}

function ruleToSectionNode(rule: Rule, encodedPaths?: Set<string>): TreeNode {
  const segment = rule.citation_path
    ? rule.citation_path.split("/").pop() || rule.id
    : rule.id;
  const parts = rule.citation_path?.split("/") ?? [];

  let label: string;
  if (rule.jurisdiction === "us-co" && parts[1] === "statute") {
    if (parts.length === 3) {
      label = rule.heading || "Colorado Revised Statutes";
    } else if (parts.length === 4) {
      label = rule.heading ? `§ ${segment} — ${rule.heading}` : `§ ${segment}`;
    } else {
      label = rule.heading ? `(${segment}) — ${rule.heading}` : `(${segment})`;
    }
  } else if (rule.jurisdiction === "us-co" && parts[1] === "regulation") {
    if (parts.length === 3) {
      label = rule.heading || segment.replace("-CCR-", " CCR ");
    } else if (parts.length === 4) {
      label = rule.heading ? `§ ${segment} — ${rule.heading}` : `§ ${segment}`;
    } else {
      label = rule.heading ? `(${segment}) — ${rule.heading}` : `(${segment})`;
    }
  } else {
    const isStatutePath = rule.citation_path?.includes("/statute/");
    label = isStatutePath
      ? rule.heading
        ? `§ ${segment} — ${rule.heading}`
        : `§ ${segment}`
      : rule.heading || formatGenericSegmentLabel(segment);
  }

  // Use has_rulespec from DB directly, or fall back to encoded paths set
  let hasRuleSpec = rule.has_rulespec;
  if (!hasRuleSpec && encodedPaths && rule.citation_path) {
    const parts = rule.citation_path.split("/");
    const withoutJurisdiction = parts.slice(1).join("/");
    hasRuleSpec = encodedPaths.has(withoutJurisdiction);
  }

  return {
    segment,
    label,
    hasChildren: true,
    rule,
    nodeType: "section" as const,
    ...(hasRuleSpec && { hasRuleSpec }),
  };
}

export async function getActNodes(
  jurisdiction: string,
  page: number = 0
): Promise<TreeResult> {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const result = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*", { count: "exact" })
      .eq("jurisdiction", jurisdiction)
      .is("parent_id", null)
      .order("heading")
      .range(from, to),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const data = result?.data;
  const count = result?.count;

  const rules = (data || []) as Rule[];
  const total = count || 0;

  return {
    nodes: rules.map((r) => ({
      segment: r.id,
      label: r.heading || "Untitled",
      hasChildren: true,
      rule: r,
      nodeType: "act" as const,
    })),
    hasMore: hasNextPage(page, total),
    total,
  };
}

export async function getChildrenByParentId(
  parentId: string,
  page: number = 0
): Promise<TreeResult> {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const result = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*", { count: "exact" })
      .eq("parent_id", parentId)
      .order("ordinal")
      .range(from, to),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const data = result?.data;
  const count = result?.count;

  const rules = (data || []) as Rule[];
  const total = count || 0;

  return {
    nodes: rules.map((r) => ({
      segment: r.id,
      label: r.heading || r.body?.slice(0, 80) || "Untitled",
      hasChildren: true,
      rule: r,
      nodeType: "section" as const,
    })),
    hasMore: hasNextPage(page, total),
    total,
  };
}

export async function getRuleById(id: string): Promise<Rule | null> {
  const result = await withTimeout(
    supabaseCorpus.from("current_provisions").select("*").eq("id", id).single(),
    TREE_QUERY_TIMEOUT_MS,
    null
  );
  const data = result?.data;
  const error = result?.error;

  if (error || !data) return null;
  return data as Rule;
}

/* v8 ignore stop */

// ---- Breadcrumb helpers ----

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export function buildBreadcrumbs(segments: string[]): BreadcrumbItem[] {
  // "/axiom" is the app landing on every host (localhost serves it
  // directly; the app/marketing hosts 308 it to the app root) — a
  // bare "/" would land readers on the marketing homepage.
  const items: BreadcrumbItem[] = [{ label: "Axiom", href: "/axiom" }];

  if (segments.length === 0) return items;

  const jurisdiction = getJurisdictionBySlug(segments[0]);
  if (!jurisdiction) return items;

  // Jurisdiction breadcrumb
  items.push({
    label: jurisdiction.label,
    href: `/${jurisdiction.slug}`,
  });

  // Rule segments start at index 1
  for (let i = 1; i < segments.length; i++) {
    const ruleIndex = i - 1;
    const href = "/" + segments.slice(0, i + 1).join("/");
    const label = formatRuleSegmentLabel(
      segments[i],
      ruleIndex,
      jurisdiction.slug,
      segments[i - 1],
      segments
    );
    items.push({ label, href });
  }

  return items;
}

function formatGenericSegmentLabel(segment: string): string {
  switch (segment) {
    case "legislation":
      return "Legislation";
    case "uksi":
      return "UK Statutory Instruments";
    case "ssi":
      return "Scottish Statutory Instruments";
    case "regulation":
    case "schedule":
    case "paragraph":
    case "article":
    case "section":
    case "part":
    case "chapter":
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    default:
      return segment
        .replace(/[-_]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => {
          const lower = part.toLowerCase();
          if (DISPLAY_ACRONYMS.has(lower)) return lower.toUpperCase();
          if (/^fy\d+$/i.test(part)) return part.toUpperCase();
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(" ");
  }
}

/** "26", "7", "25A" — the shapes USC/CFR title and part numbers take. */
function isNumericDesignator(segment: string): boolean {
  return /^\d+[A-Za-z]?$/.test(segment);
}

/**
 * Identifier-style segments ("Rule 35", "He-W 734.01") are shown
 * verbatim — the generic formatter would mangle their hyphens and
 * casing. Plain lowercase slugs ("tax", "he-w-700") still go through
 * the generic title-casing.
 */
function formatIdentifierSegmentLabel(segment: string): string {
  return /^[a-z0-9-]+$/.test(segment)
    ? formatGenericSegmentLabel(segment)
    : segment;
}

function formatRuleSegmentLabel(
  segment: string,
  ruleIndex: number,
  jurisdiction: string,
  previousSegment?: string,
  allSegments?: string[]
): string {
  if (jurisdiction === "us-co") {
    if (ruleIndex === 0) {
      if (segment === "statute") return "Statutes";
      if (segment === "regulation") return "Regulations";
      return formatGenericSegmentLabel(segment);
    }

    if (previousSegment === "statute" && segment === "crs") {
      return "Colorado Revised Statutes";
    }

    if (previousSegment === "regulation") {
      return segment.replace("-CCR-", " CCR ");
    }

    if (previousSegment?.includes("-CCR-")) {
      return `§ ${segment}`;
    }

    if (previousSegment === "crs") {
      return `§ ${segment}`;
    }

    if (previousSegment && /^\d[\d.-]*$/.test(previousSegment)) {
      return `(${segment})`;
    }

    return formatGenericSegmentLabel(segment);
  }

  if (jurisdiction === "uk") {
    if (ruleIndex === 0) {
      return formatGenericSegmentLabel(segment);
    }

    if (
      previousSegment &&
      ["regulation", "schedule", "paragraph", "article", "section", "part", "chapter"].includes(previousSegment)
    ) {
      return segment;
    }

    return formatGenericSegmentLabel(segment);
  }

  // Default path (us federal and similar): handle statute and regulation lanes
  const isRegulationLane =
    Array.isArray(allSegments) && allSegments[1] === "regulation";
  const isStatuteLane =
    Array.isArray(allSegments) && allSegments[1] === "statute";
  const isSourceDocumentLane =
    Array.isArray(allSegments) &&
    !["statute", "regulation"].includes(allSegments[1] ?? "");
  const isSubpart =
    typeof segment === "string" && segment.startsWith("subpart-");

  if (ruleIndex === 0) {
    if (segment === "statute") return "Statutes";
    if (segment === "regulation") return "Regulations";
    if (segment === "rulemaking") return "Rulemaking";
    return formatGenericSegmentLabel(segment);
  }

  if (isSourceDocumentLane) {
    return formatGenericSegmentLabel(segment);
  }

  if (ruleIndex === 1) {
    // Only numeric titles get the "Title N" prefix; identifier-style
    // segments ("Rule 35", "he-w-700", "tax") already read as labels.
    return isNumericDesignator(segment)
      ? `Title ${segment}`
      : formatIdentifierSegmentLabel(segment);
  }

  if (isRegulationLane) {
    if (ruleIndex === 2) {
      return isNumericDesignator(segment)
        ? `Part ${segment}`
        : formatIdentifierSegmentLabel(segment);
    }
    if (isSubpart) {
      return `Subpart ${segment.replace(/^subpart-/, "").toUpperCase()}`;
    }
    if (ruleIndex === 3) {
      // Section under part: e.g. us/regulation/7/273/9 → "§ 273.9"
      const partNum = allSegments?.[3] ?? "";
      return `§ ${partNum}.${segment}`;
    }
    if (ruleIndex === 4 && previousSegment?.startsWith("subpart-")) {
      // Section under subpart: e.g. us/regulation/7/273/subpart-d/9 → "§ 273.9"
      const partNum = allSegments?.[3] ?? "";
      return `§ ${partNum}.${segment}`;
    }
    return `(${segment})`;
  }

  if (isStatuteLane && ruleIndex === 2) {
    return `§ ${segment}`;
  }

  if (isStatuteLane && ruleIndex > 2) {
    return `(${segment})`;
  }

  return `§ ${segment}`;
}

// ---- UUID detection ----

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}
