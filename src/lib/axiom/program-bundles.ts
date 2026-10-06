/**
 * Program bundles: the documents that make up each delivery tier of one
 * program in one jurisdiction (axiom-corpus manifests/program-bundles), and
 * how far each document has come. Membership comes from the bundle file;
 * progress is telemetry the collector reads from the served corpus, the
 * RuleSpec rule index and the encoding runs, so the two never drift.
 */
import { attemptStage, type PipelineAttempt, type PipelineStage } from "./encoding-pipeline";

export type BundleTierId = "screener" | "full";

/** One document of a tier, as the bundle file lists it. */
export interface BundleFileDocument {
  key: string;
  name?: string | null;
  layer?: string | null;
  citation_path: string | null;
  source_url: string | null;
  sources?: string[];
  references?: number;
  manifest?: string;
  scope: "in" | "excluded";
  reason?: string | null;
  /** The provisions PolicyEngine cites in this document. */
  cited?: Array<{ path: string; references: number }>;
}

export interface BundleFileTier {
  id: BundleTierId;
  title: string;
  definition: string;
  membership: Record<string, unknown>;
  notes?: string[];
  documents: BundleFileDocument[];
}

/** A bundle file: manifests/program-bundles/<jurisdiction>-<program>.yaml. */
export interface BundleFile {
  schema: string;
  id: string;
  program: string;
  jurisdiction: string;
  title: string;
  as_of: string;
  tiers: BundleFileTier[];
}

/** Where a document stands, from first to last. */
export type DocumentStatus = "not_in_corpus" | "not_encoded" | "partly_encoded" | "encoded";

export const DOCUMENT_STATUSES: DocumentStatus[] = ["encoded", "partly_encoded", "not_encoded", "not_in_corpus"];

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  encoded: "Encoded",
  partly_encoded: "Partly encoded",
  not_encoded: "No rules yet",
  not_in_corpus: "Not in the corpus",
};

/** One row of encodings.program_bundle_documents: a document and its measure. */
export interface BundleDocumentRow {
  bundle_id: string;
  tier: BundleTierId;
  key: string;
  name: string;
  layer: string;
  scope: "in" | "excluded";
  reason: string | null;
  citation_path: string | null;
  source_url: string | null;
  sources: string[];
  manifest: string | null;
  /** The corpus serves the citation path. */
  in_corpus: boolean;
  /** Provisions the corpus serves under the document, itself included. */
  provisions: number;
  /** Of those, the ones a rule cites, itself or below it. */
  encoded_provisions: number;
  /** Distinct rules that cite the document. */
  rules: number;
  /** PolicyEngine-cited provisions of the document: how many, how many a rule encodes, how many sit inside an encoded provision. */
  cited_total: number;
  cited_covered: number;
  cited_within: number;
  cited: CitedProvision[];
  /** Targeted encode runs for citations in the document, and the newest. */
  runs: number;
  latest_citation: string | null;
  latest_run_at: string | null;
  latest_stage: PipelineStage | null;
  latest_run_url: string | null;
  status: DocumentStatus | null;
  collected_at: string;
}

/** One row of encodings.program_bundles: the bundle file's header, per collector pass. */
export interface BundleRow {
  id: string;
  title: string;
  program: string;
  jurisdiction: string;
  as_of: string;
  tiers: Array<Pick<BundleFileTier, "id" | "title" | "definition" | "membership" | "notes">>;
  source: string | null;
  collected_at: string;
}

/** One row of encodings.program_bundle_snapshots: a tier's counts on one day. */
export interface BundleSnapshotRow {
  bundle_id: string;
  tier: BundleTierId;
  day: string;
  counts: TierCounts;
}

/**
 * A provision PolicyEngine cites, by how a rule reaches it: a rule encodes it
 * or a provision below it ("encoded"); a rule encodes only a provision above
 * it, which may or may not carry it ("within"); or no rule reaches it.
 */
export interface CitedProvision {
  path: string;
  references: number;
  state: "encoded" | "within" | "missing";
}

/** What the collector reads for one document. */
export interface DocumentTelemetry {
  /** Every corpus path under the document's citation path, itself included. */
  nodes: string[];
  /** Every provision path a rule cites under the document, with the rule. */
  ruleCitations: Array<{ citation_path: string; rule: string }>;
  /** Targeted encode runs whose citation is the document or under it. */
  attempts: PipelineAttempt[];
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** The nearest corpus node at or above a cited path, or null when none holds it. */
function holdingNode(path: string, nodes: Set<string>): string | null {
  for (let at = path; at; at = at.slice(0, Math.max(0, at.lastIndexOf("/")))) {
    if (nodes.has(at)) return at;
    if (!at.includes("/")) break;
  }
  return null;
}

export function documentStatus(row: Pick<BundleDocumentRow, "scope" | "in_corpus" | "provisions" | "encoded_provisions">): DocumentStatus | null {
  if (row.scope === "excluded") return null;
  if (!row.in_corpus) return "not_in_corpus";
  if (row.encoded_provisions === 0) return "not_encoded";
  return row.encoded_provisions < row.provisions ? "partly_encoded" : "encoded";
}

/**
 * A document's measure. A provision counts as encoded when a rule cites it or
 * a provision below it, or its module encodes one; a path deeper than the
 * corpus splits counts toward the deepest provision that holds it. A
 * PolicyEngine-cited provision is encoded when a rule reaches it or a
 * provision below it, and "within" when a rule reaches only a provision above
 * it in the same document.
 */
export function measureDocument(
  bundleId: string,
  tier: BundleTierId,
  doc: BundleFileDocument,
  telemetry: DocumentTelemetry | null,
  collectedAt: string
): BundleDocumentRow {
  const root = doc.citation_path;
  const nodes = new Set(telemetry?.nodes ?? []);
  const inCorpus = Boolean(root && nodes.has(root));
  const citations = (telemetry?.ruleCitations ?? []).filter((c) => root && under(c.citation_path, root));
  const encoded = new Set<string>();
  for (const citation of citations) {
    const node = holdingNode(citation.citation_path, nodes);
    if (node) encoded.add(node);
  }
  const cited: CitedProvision[] = (doc.cited ?? []).map(({ path, references }) => ({
    path,
    references,
    state: citations.some((c) => under(c.citation_path, path))
      ? "encoded"
      : citations.some((c) => root && under(c.citation_path, root) && under(path, c.citation_path))
        ? "within"
        : "missing",
  }));
  const attempts = [...(telemetry?.attempts ?? [])]
    .filter((a) => root && a.citation && under(a.citation, root))
    .sort((a, b) => b.dispatched_at.localeCompare(a.dispatched_at));
  const latest = attempts[0] ?? null;
  const row: BundleDocumentRow = {
    bundle_id: bundleId,
    tier,
    key: doc.key,
    name: doc.name ?? doc.key,
    layer: doc.layer ?? (root?.startsWith("us/") ? "federal" : "state"),
    scope: doc.scope,
    reason: doc.scope === "excluded" ? (doc.reason ?? null) : null,
    citation_path: root,
    source_url: doc.source_url,
    sources: doc.sources ?? [],
    manifest: doc.manifest ?? null,
    in_corpus: inCorpus,
    provisions: inCorpus ? nodes.size : 0,
    encoded_provisions: inCorpus ? encoded.size : 0,
    rules: new Set(citations.map((c) => c.rule)).size,
    cited_total: cited.length,
    cited_covered: cited.filter((c) => c.state === "encoded").length,
    cited_within: cited.filter((c) => c.state === "within").length,
    cited,
    runs: attempts.length,
    latest_citation: latest?.citation ?? null,
    latest_run_at: latest?.dispatched_at ?? null,
    latest_stage: latest ? attemptStage(latest) : null,
    latest_run_url: latest?.run_url ?? null,
    status: null,
    collected_at: collectedAt,
  };
  row.status = documentStatus(row);
  return row;
}

export interface TierCounts {
  documents: number;
  excluded: number;
  byStatus: Record<DocumentStatus, number>;
  provisions: number;
  encodedProvisions: number;
  citedTotal: number;
  citedCovered: number;
  citedWithin: number;
  rules: number;
}

export function tierCounts(rows: BundleDocumentRow[]): TierCounts {
  const inScope = rows.filter((r) => r.scope === "in");
  const byStatus = Object.fromEntries(DOCUMENT_STATUSES.map((s) => [s, 0])) as Record<DocumentStatus, number>;
  for (const row of inScope) if (row.status) byStatus[row.status]++;
  const sum = (f: (r: BundleDocumentRow) => number) => inScope.reduce((total, r) => total + f(r), 0);
  return {
    documents: inScope.length,
    excluded: rows.length - inScope.length,
    byStatus,
    provisions: sum((r) => r.provisions),
    encodedProvisions: sum((r) => r.encoded_provisions),
    citedTotal: sum((r) => r.cited_total),
    citedCovered: sum((r) => r.cited_covered),
    citedWithin: sum((r) => r.cited_within),
    rules: sum((r) => r.rules),
  };
}

/** A family of documents, for grouping the map: what kind of source, at which level. */
export function documentGroup(row: Pick<BundleDocumentRow, "citation_path" | "layer">): string {
  const path = row.citation_path ?? "";
  const level = row.layer === "state" ? "State" : "Federal";
  if (!path) return `${level} sources not in the corpus`;
  const kind = path.split("/")[1];
  if (kind === "statute") return `${level} statutes`;
  if (kind === "regulation") return `${level} regulations`;
  if (kind === "manual") return `${level} manuals`;
  if (kind === "policy") return `${level} state plans`;
  if (kind === "form") return `${level} forms`;
  return `${level} guidance`;
}

/** One in-scope bundle document, as the reverse lookup from an encoding needs it. */
export interface BundleIndexEntry {
  bundle_id: string;
  bundle_title: string;
  tier: BundleTierId;
  /** 1 for the first tier in the bundle file, 2 for the next. */
  tier_index: number;
  tier_title: string;
  document: string;
  citation_path: string;
}

/** A bundle that holds a citation, with every tier it sits in. */
export interface BundleMembership {
  bundle_id: string;
  bundle_title: string;
  tiers: Array<{ tier: BundleTierId; index: number; title: string; document: string }>;
}

/** The in-scope documents of every bundle, flattened for the reverse lookup. */
export function bundleIndex(bundles: BundleRow[], documents: BundleDocumentRow[]): BundleIndexEntry[] {
  const byId = new Map(bundles.map((b) => [b.id, b]));
  return documents.flatMap((doc) => {
    const bundle = byId.get(doc.bundle_id);
    const tierIndex = bundle ? bundle.tiers.findIndex((t) => t.id === doc.tier) : -1;
    if (!bundle || tierIndex < 0 || doc.scope !== "in" || !doc.citation_path) return [];
    return [
      {
        bundle_id: bundle.id,
        bundle_title: bundle.title,
        tier: doc.tier,
        tier_index: tierIndex + 1,
        tier_title: bundle.tiers[tierIndex].title,
        document: doc.name,
        citation_path: doc.citation_path,
      },
    ];
  });
}

/**
 * The bundles whose documents hold an encoding's citation: a document holds
 * it when its citation path is the citation or a provision above it.
 */
export function bundleMemberships(citation: string, index: BundleIndexEntry[]): BundleMembership[] {
  const out = new Map<string, BundleMembership>();
  for (const entry of index) {
    if (citation !== entry.citation_path && !citation.startsWith(`${entry.citation_path}/`)) continue;
    const membership = out.get(entry.bundle_id) ?? { bundle_id: entry.bundle_id, bundle_title: entry.bundle_title, tiers: [] };
    if (!membership.tiers.some((t) => t.tier === entry.tier)) {
      membership.tiers.push({ tier: entry.tier, index: entry.tier_index, title: entry.tier_title, document: entry.document });
    }
    out.set(entry.bundle_id, membership);
  }
  return [...out.values()]
    .map((m) => ({ ...m, tiers: m.tiers.sort((a, b) => a.index - b.index) }))
    .sort((a, b) => a.bundle_title.localeCompare(b.bundle_title));
}

/** "Tier 1" or "Tiers 1, 2". */
export function tiersLabel(membership: BundleMembership): string {
  const indexes = membership.tiers.map((t) => t.index);
  return `${indexes.length === 1 ? "Tier" : "Tiers"} ${indexes.join(", ")}`;
}
