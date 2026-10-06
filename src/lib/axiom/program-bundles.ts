/**
 * Program bundles: the documents that make up each delivery tier of one
 * program in one jurisdiction (axiom-corpus manifests/program-bundles), and
 * how far each has come. Membership comes from the bundle file; progress is
 * telemetry the collector reads from the served corpus, the RuleSpec module
 * mirror and the encoding runs, so the two never drift.
 *
 * Two measures, each truthful about what it counts:
 *
 * - A document's provisions: its text-bearing provisions in the corpus (the
 *   leaves; a heading that only holds others is not counted). A provision is
 *   encoded when a module's declared source is the provision or one above it
 *   (the module claims it whole, and the encoder's completeness rules make it
 *   encode or defer every branch), partly encoded when a module's source sits
 *   below it (the corpus does not split it as finely as the module).
 * - A screener tier's units: each provision PolicyEngine cites, as its
 *   parity model reads it. Encoded when a module encodes it, or a module for
 *   a section above it names it ("273.9(a)(1)"); partly encoded when that
 *   module does not name it, or only part of it is encoded.
 */
import { attemptStage, type PipelineAttempt, type PipelineStage } from "./encoding-pipeline";

export type BundleTierId = "screener" | "full";

/** One document of a tier, as the bundle file lists it. */
export interface BundleFileDocument {
  key: string;
  name?: string | null;
  layer?: string | null;
  /** The part of the program it feeds: a calculation part, or a manual part. */
  part?: string | null;
  citation_path: string | null;
  source_url: string | null;
  sources?: string[];
  references?: number;
  manifest?: string;
  scope: "in" | "excluded";
  reason?: string | null;
  /** The provisions PolicyEngine cites in this document, and the part each feeds. */
  cited?: Array<{ path: string; references: number; part?: string | null }>;
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
  /** The parts of the program, in reading order: the matrix's rows. */
  parts: string[];
  tiers: BundleFileTier[];
}

/** Where one provision stands; every text-bearing provision has exactly one. */
export type ProvisionState = "encoded" | "partly" | "in_progress" | "failed" | "not_started";

export const PROVISION_STATES: ProvisionState[] = ["encoded", "partly", "in_progress", "failed", "not_started"];

export const PROVISION_LABELS: Record<ProvisionState, string> = {
  encoded: "Encoded",
  partly: "Partly encoded",
  in_progress: "In progress",
  failed: "Failed",
  not_started: "Not started",
};

/** Where one screener unit (a provision PolicyEngine cites) stands. */
export type UnitState = "encoded" | "partly" | "in_progress" | "failed" | "not_encoded" | "not_in_corpus";

export const UNIT_STATES: UnitState[] = ["encoded", "partly", "in_progress", "failed", "not_encoded", "not_in_corpus"];

export const UNIT_LABELS: Record<UnitState, string> = {
  encoded: "Encoded",
  partly: "Partly encoded",
  in_progress: "In progress",
  failed: "Failed",
  not_encoded: "Not encoded",
  not_in_corpus: "Not in the corpus",
};

/** Where a whole document stands. */
export type DocumentStatus = "complete" | "partly" | "not_started" | "not_in_corpus";

export const DOCUMENT_STATUSES: DocumentStatus[] = ["complete", "partly", "not_started", "not_in_corpus"];

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  complete: "Complete",
  partly: "Partly encoded",
  not_started: "Not started",
  not_in_corpus: "Not in the corpus",
};

const IN_INDEX: PipelineStage[] = ["indexed", "runs", "verified", "compile_failed", "tests_failing", "oracle_disagrees"];
const UNDER_WAY: PipelineStage[] = ["encoding", "review", "awaiting_sync", "not_indexed"];

/** The newest run that touches a provision, as the drill-down shows it. */
export interface RunMark {
  stage: PipelineStage;
  /** The run's own citation, for its journey. */
  citation: string;
  at: string;
}

/** A provision whose newest run is under way or failed. */
export interface OpenProvision extends RunMark {
  path: string;
  state: "in_progress" | "failed";
}

/** One screener unit: a provision PolicyEngine cites, or a cited document as a whole. */
export interface ParityUnit {
  key: string;
  name: string;
  path: string | null;
  url: string | null;
  part: string;
  references: number;
  state: UnitState;
  /** Why it has that state: the module that encodes or names it, or the gap. */
  detail: string | null;
  run: RunMark | null;
}

/** One row of encodings.program_bundle_documents: a document and its measure. */
export interface BundleDocumentRow {
  bundle_id: string;
  tier: BundleTierId;
  key: string;
  name: string;
  layer: string;
  part: string;
  scope: "in" | "excluded";
  reason: string | null;
  citation_path: string | null;
  source_url: string | null;
  sources: string[];
  manifest: string | null;
  /** The corpus serves the citation path. */
  in_corpus: boolean;
  /** Text-bearing provisions under the document, and how many are in each state. */
  provisions: number;
  encoded_provisions: number;
  partly_provisions: number;
  provisions_in_progress: number;
  provisions_failed: number;
  /** The provisions in progress or failed, newest run first. */
  open_provisions: OpenProvision[];
  /** Distinct modules whose source is in the document. */
  modules: number;
  /** The screener tier's units in this document; empty in other tiers. */
  units: ParityUnit[];
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
  parts: string[];
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

/** A RuleSpec module: its path, the provisions it declares as its source, and its YAML when read. */
export interface ModuleSource {
  module: string;
  sources: string[];
  yaml?: string | null;
}

const isLaw = (path: string) => ["statute", "regulation"].includes(path.split("/")[1]);

/**
 * The provisions a module encodes. A statute or regulation module's own path
 * is its provision (7 USC 2014(a) is us/statute/7/2014/a). A policy module
 * (us-az/policy/...) encodes the manual, guidance or form provision it
 * declares as its module source; a statute or regulation it builds on stays
 * that law's own modules' to encode, so a tax pipeline that cites 26 USC 1402
 * does not encode 1402.
 */
export function moduleSources(row: { citation_path: string; declared_sources: string[] }): string[] {
  if (isLaw(row.citation_path)) return [row.citation_path];
  return row.declared_sources.filter((source) => !isLaw(source));
}

/** What the collector reads for one document. */
export interface DocumentTelemetry {
  /** Every corpus provision under the document's citation path, itself included. */
  nodes: Array<{ path: string; child_count: number }>;
  /** The modules whose source is in the document or above it. */
  modules: ModuleSource[];
  /** Targeted encode runs whose citation is in the document. */
  attempts: PipelineAttempt[];
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const strictlyUnder = (path: string, root: string) => path.startsWith(`${root}/`);

/**
 * The marker a section's module uses for a paragraph inside it, as the parity
 * model reads it: us/regulation/7/273/9/a/1 under .../273/9 is "273.9(a)(1)";
 * us/statute/7/2015/e/3 under .../2015/e is "2015(e)(3)".
 */
export function designation(cited: string, parent: string): string | null {
  if (!strictlyUnder(cited, parent)) return null;
  const c = cited.split("/");
  if (c[1] === "statute" && c.length >= 4) return c[3] + c.slice(4).map((d) => `(${d})`).join("");
  if (c[1] === "regulation" && c.length >= 5) return `${c[3]}.${c[4]}` + c.slice(5).map((d) => `(${d})`).join("");
  return null;
}

/** The newest run that touches a path: at it, above it, or below it. */
function newestRun(path: string, attempts: PipelineAttempt[]): PipelineAttempt | null {
  let newest: PipelineAttempt | null = null;
  for (const attempt of attempts) {
    if (!attempt.citation || !(under(path, attempt.citation) || strictlyUnder(attempt.citation, path))) continue;
    if (!newest || attempt.dispatched_at > newest.dispatched_at) newest = attempt;
  }
  return newest;
}

const mark = (attempt: PipelineAttempt): RunMark => ({
  stage: attemptStage(attempt),
  citation: attempt.citation,
  at: attempt.dispatched_at,
});

function documentStatus(row: Pick<BundleDocumentRow, "scope" | "in_corpus" | "provisions" | "encoded_provisions" | "partly_provisions">): DocumentStatus | null {
  if (row.scope === "excluded") return null;
  if (!row.in_corpus) return "not_in_corpus";
  if (row.provisions > 0 && row.encoded_provisions === row.provisions) return "complete";
  return row.encoded_provisions + row.partly_provisions > 0 ? "partly" : "not_started";
}

/** A document's measure, and in the screener tier its parity units. */
export function measureDocument(
  bundleId: string,
  tier: BundleTierId,
  doc: BundleFileDocument,
  telemetry: DocumentTelemetry | null,
  collectedAt: string
): BundleDocumentRow {
  const root = doc.citation_path;
  const nodes = telemetry?.nodes ?? [];
  const inCorpus = Boolean(root && nodes.some((n) => n.path === root));
  const leaves = inCorpus ? nodes.filter((n) => n.child_count === 0).map((n) => n.path) : [];
  const modules = telemetry?.modules ?? [];
  const sources = modules.flatMap((m) => m.sources.map((source) => ({ source, module: m })));
  const attempts = [...(telemetry?.attempts ?? [])]
    .filter((a) => root && a.citation && under(a.citation, root))
    .sort((a, b) => b.dispatched_at.localeCompare(a.dispatched_at));

  // Each leaf's state.
  const states = new Map<string, ProvisionState>();
  const open: OpenProvision[] = [];
  for (const leaf of leaves) {
    if (sources.some((s) => under(leaf, s.source))) {
      states.set(leaf, "encoded");
      continue;
    }
    if (sources.some((s) => strictlyUnder(s.source, leaf))) {
      states.set(leaf, "partly");
      continue;
    }
    const run = newestRun(leaf, attempts);
    const stage = run ? attemptStage(run) : null;
    if (run && stage && !IN_INDEX.includes(stage)) {
      const state = UNDER_WAY.includes(stage) ? "in_progress" : "failed";
      states.set(leaf, state);
      open.push({ path: leaf, state, ...mark(run) });
    } else {
      states.set(leaf, run ? "encoded" : "not_started");
    }
  }
  open.sort((a, b) => b.at.localeCompare(a.at));
  const count = (state: ProvisionState) => [...states.values()].filter((s) => s === state).length;
  const leafStates = (path: string) => leaves.filter((leaf) => under(leaf, path)).map((leaf) => states.get(leaf));

  const units: ParityUnit[] = [];
  if (tier === "screener" && doc.scope === "in") {
    const cited = doc.cited?.length
      ? doc.cited
      : [{ path: root ?? "", references: doc.references ?? 0, part: doc.part ?? null }];
    for (const c of cited) {
      const path = c.path || null;
      units.push({
        key: path ?? doc.key,
        name: path && path !== root ? `${doc.name ?? doc.key} ${path.slice((root ?? "").length)}` : (doc.name ?? doc.key),
        path,
        url: path ? null : doc.source_url,
        part: c.part ?? doc.part ?? "Other",
        references: c.references,
        ...unitState(path, inCorpus, sources, leafStates, attempts),
      });
    }
  }

  const latest = attempts[0] ?? null;
  const row: BundleDocumentRow = {
    bundle_id: bundleId,
    tier,
    key: doc.key,
    name: doc.name ?? doc.key,
    layer: doc.layer ?? (root?.startsWith("us/") ? "federal" : "state"),
    part: doc.part ?? "Other",
    scope: doc.scope,
    reason: doc.scope === "excluded" ? (doc.reason ?? null) : null,
    citation_path: root,
    source_url: doc.source_url,
    sources: doc.sources ?? [],
    manifest: doc.manifest ?? null,
    in_corpus: inCorpus,
    provisions: leaves.length,
    encoded_provisions: count("encoded"),
    partly_provisions: count("partly"),
    provisions_in_progress: count("in_progress"),
    provisions_failed: count("failed"),
    open_provisions: open,
    modules: new Set(sources.filter((s) => root && under(s.source, root)).map((s) => s.module.module)).size,
    units,
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

/** A screener unit's state, by the parity rule, then its leaves, then its newest run. */
function unitState(
  path: string | null,
  inCorpus: boolean,
  sources: Array<{ source: string; module: ModuleSource }>,
  leafStates: (path: string) => Array<ProvisionState | undefined>,
  attempts: PipelineAttempt[]
): Pick<ParityUnit, "state" | "detail" | "run"> {
  if (!path || !inCorpus) return { state: "not_in_corpus", detail: null, run: null };
  const exact = sources.find((s) => s.source === path);
  if (exact) return { state: "encoded", detail: `Encoded by ${exact.module.module}`, run: null };
  // A module for a section above it: credit only when the module names it.
  const above = sources
    .filter((s) => strictlyUnder(path, s.source))
    .sort((a, b) => b.source.length - a.source.length)[0];
  if (above) {
    const marker = designation(path, above.source);
    if (!marker) return { state: "encoded", detail: `Inside ${above.module.module}`, run: null };
    if (above.module.yaml?.includes(marker)) {
      return { state: "encoded", detail: `${above.module.module} names ${marker}`, run: null };
    }
    return { state: "partly", detail: `${above.module.module} does not name ${marker}`, run: null };
  }
  const leaves = leafStates(path);
  const encoded = leaves.filter((s) => s === "encoded").length;
  if (leaves.length && encoded === leaves.length) {
    return { state: "encoded", detail: `All ${leaves.length} provisions encoded`, run: null };
  }
  if (sources.some((s) => strictlyUnder(s.source, path)) || leaves.some((s) => s === "encoded" || s === "partly")) {
    return { state: "partly", detail: `${encoded} of ${leaves.length} provisions encoded`, run: null };
  }
  const run = newestRun(path, attempts);
  const stage = run ? attemptStage(run) : null;
  if (run && stage && !IN_INDEX.includes(stage)) {
    return { state: UNDER_WAY.includes(stage) ? "in_progress" : "failed", detail: null, run: mark(run) };
  }
  return { state: "not_encoded", detail: null, run: run ? mark(run) : null };
}

export interface TierCounts {
  documents: number;
  excluded: number;
  byStatus: Record<DocumentStatus, number>;
  provisions: number;
  /** Provisions by state; they add up to the provisions. */
  byProvisionState: Record<ProvisionState, number>;
  /** Screener units by state; they add up to the units. */
  units: number;
  byUnitState: Record<UnitState, number>;
}

/** A document's provisions by state; they add up to its provisions. */
export function provisionCounts(
  row: Pick<
    BundleDocumentRow,
    "provisions" | "encoded_provisions" | "partly_provisions" | "provisions_in_progress" | "provisions_failed"
  >
): Record<ProvisionState, number> {
  const known = row.encoded_provisions + row.partly_provisions + row.provisions_in_progress + row.provisions_failed;
  return {
    encoded: row.encoded_provisions,
    partly: row.partly_provisions,
    in_progress: row.provisions_in_progress,
    failed: row.provisions_failed,
    not_started: Math.max(0, row.provisions - known),
  };
}

export function tierCounts(rows: BundleDocumentRow[]): TierCounts {
  const inScope = rows.filter((r) => r.scope === "in");
  const byStatus = Object.fromEntries(DOCUMENT_STATUSES.map((s) => [s, 0])) as Record<DocumentStatus, number>;
  for (const row of inScope) if (row.status) byStatus[row.status]++;
  const byProvisionState = Object.fromEntries(PROVISION_STATES.map((s) => [s, 0])) as Record<ProvisionState, number>;
  for (const row of inScope) {
    const counts = provisionCounts(row);
    for (const state of PROVISION_STATES) byProvisionState[state] += counts[state];
  }
  const units = inScope.flatMap((r) => r.units);
  const byUnitState = Object.fromEntries(UNIT_STATES.map((s) => [s, 0])) as Record<UnitState, number>;
  for (const unit of units) byUnitState[unit.state]++;
  return {
    documents: inScope.length,
    excluded: rows.length - inScope.length,
    byStatus,
    provisions: inScope.reduce((total, r) => total + r.provisions, 0),
    byProvisionState,
    units: units.length,
    byUnitState,
  };
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
export function bundleIndex(
  bundles: Array<Pick<BundleRow, "id" | "title" | "tiers">>,
  documents: Array<Pick<BundleDocumentRow, "bundle_id" | "tier" | "name" | "scope" | "citation_path">>
): BundleIndexEntry[] {
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
    if (!under(citation, entry.citation_path)) continue;
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
