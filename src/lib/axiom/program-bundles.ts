/**
 * Program bundles: the documents that make up each delivery tier of one
 * program in one jurisdiction (axiom-corpus manifests/program-bundles), and
 * how far each has come. Membership comes from the bundle file; progress is
 * telemetry the collector reads from the served corpus, the RuleSpec module
 * mirror and the encoding runs, so the two never drift.
 *
 * A provision counts as encoded only when a rule cites it: a module's
 * declared source is not proof, since a module can defer branches of its
 * source or hold no rules at all (the encoder's completeness check is off by
 * default). So each text-bearing provision (a corpus leaf) is:
 * - encoded: a rule cites it or a provision above it, and nothing at or under
 *   it is deferred; "unvalidated" when every such module merged under a
 *   validation waiver;
 * - partly encoded: rules cite only parts of it, or a branch of it is
 *   deferred (a CFR section is one corpus leaf, so most land here);
 * - deferred: a module defers it and no rule cites it;
 * - in progress or failed: by its newest targeted encode run (runs give no
 *   credit);
 * - not started: the rest.
 * A screener unit (a provision PolicyEngine cites) is graded the same way.
 */
import { attemptStage, type PipelineAttempt, type PipelineStage } from "./encoding-pipeline";
import type { ScreenerParity } from "./screener-parity";

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
  /** Why a known source is listed though the corpus does not hold it yet. */
  note?: string | null;
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
export type ProvisionState = "encoded" | "unvalidated" | "partly" | "deferred" | "in_progress" | "failed" | "not_started";

export const PROVISION_STATES: ProvisionState[] = [
  "encoded",
  "unvalidated",
  "partly",
  "deferred",
  "in_progress",
  "failed",
  "not_started",
];

export const PROVISION_LABELS: Record<ProvisionState, string> = {
  encoded: "Encoded",
  unvalidated: "Encoded, not validated",
  partly: "Partly encoded",
  deferred: "Deferred",
  in_progress: "In progress",
  failed: "Failed",
  not_started: "Not started",
};

/** Where one screener unit (a provision PolicyEngine cites) stands. */
export type UnitState =
  | "encoded"
  | "unvalidated"
  | "partly"
  | "deferred"
  | "in_progress"
  | "failed"
  | "not_encoded"
  | "not_in_corpus";

export const UNIT_STATES: UnitState[] = [
  "encoded",
  "unvalidated",
  "partly",
  "deferred",
  "in_progress",
  "failed",
  "not_encoded",
  "not_in_corpus",
];

export const UNIT_LABELS: Record<UnitState, string> = {
  encoded: "Encoded",
  unvalidated: "Encoded, not validated",
  partly: "Partly encoded",
  deferred: "Deferred",
  in_progress: "In progress",
  failed: "Failed",
  not_encoded: "Not encoded",
  not_in_corpus: "Not in the corpus",
};

/** Where a whole document stands. */
export type DocumentStatus = "complete" | "unvalidated" | "partly" | "not_started" | "not_in_corpus";

export const DOCUMENT_STATUSES: DocumentStatus[] = ["complete", "unvalidated", "partly", "not_started", "not_in_corpus"];

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  complete: "Complete",
  unvalidated: "Complete, not validated",
  partly: "Partly encoded",
  not_started: "Not started",
  not_in_corpus: "Not in the corpus",
};

const UNDER_WAY: PipelineStage[] = ["encoding", "review", "awaiting_sync", "not_indexed"];
const FAILED: PipelineStage[] = ["encode_failed", "no_pr", "closed", "merged_off_main"];

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
  /** Why it has that state: the module whose rule cites it, what defers it, or the gap. */
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
  note: string | null;
  citation_path: string | null;
  source_url: string | null;
  sources: string[];
  manifest: string | null;
  /** The corpus serves the citation path. */
  in_corpus: boolean;
  /** Text-bearing provisions under the document, and how many are in each state. */
  provisions: number;
  encoded_provisions: number;
  unvalidated_provisions: number;
  partly_provisions: number;
  deferred_provisions: number;
  provisions_in_progress: number;
  provisions_failed: number;
  /** The provisions in progress or failed, newest run first. */
  open_provisions: OpenProvision[];
  /** Distinct modules with a rule that cites the document. */
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
  /** The screener tier's headline, from the comparison its membership names; null without one. */
  parity: ScreenerParity | null;
  /** The newest policyengine-us version published on PyPI when the collector ran. */
  policyengine_latest: string | null;
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
 * What a RuleSpec module encodes, read from its YAML (program-bundles-modules.ts):
 * the provisions it declares as its source, the provisions its rules cite,
 * the provisions it defers, and whether it merged under a validation waiver.
 */
export interface ModuleFacts {
  module: string;
  sources: string[];
  cited: string[];
  deferred: string[];
  rules: number;
  waived: boolean;
}

/** What the collector reads for one document. */
export interface DocumentTelemetry {
  /** Every corpus provision under the document's citation path, itself included. */
  nodes: Array<{ path: string; child_count: number }>;
  /** The modules whose rules cite, or whose outputs defer, a provision in the document or above it. */
  modules: ModuleFacts[];
  /** Targeted encode runs whose citation is in the document. */
  attempts: PipelineAttempt[];
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const strictlyUnder = (path: string, root: string) => path.startsWith(`${root}/`);

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

/** A run under way or failed; any other stage gives no state, and no credit. */
function runState(run: PipelineAttempt | null): "in_progress" | "failed" | null {
  if (!run) return null;
  const stage = attemptStage(run);
  return UNDER_WAY.includes(stage) ? "in_progress" : FAILED.includes(stage) ? "failed" : null;
}

interface Grade {
  state: "encoded" | "unvalidated" | "partly" | "deferred" | null;
  detail: string | null;
}

/**
 * How the modules reach one path. A rule citing it or a provision above it
 * encodes it, unless something at or under it is deferred; rules citing only
 * provisions under it, or a deferred branch under a cited path, make it
 * partly encoded; a deferral at or above it, with no rule citing it, defers it.
 */
function grade(path: string, modules: ModuleFacts[]): Grade {
  const covering = modules.filter((m) => m.cited.some((c) => under(path, c)));
  const below = modules.filter((m) => m.cited.some((c) => strictlyUnder(c, path)));
  const deferredAbove = modules.find((m) => m.deferred.some((d) => under(path, d)));
  const deferredBelow = modules.find((m) => m.deferred.some((d) => strictlyUnder(d, path)));
  if (covering.length) {
    if (deferredAbove) return { state: "deferred", detail: `Deferred by ${deferredAbove.module}` };
    if (deferredBelow) return { state: "partly", detail: `${deferredBelow.module} defers part of it` };
    const validated = covering.find((m) => !m.waived);
    return validated
      ? { state: "encoded", detail: `A rule in ${validated.module} cites it` }
      : { state: "unvalidated", detail: `${covering[0].module} merged under a validation waiver` };
  }
  if (below.length) return { state: "partly", detail: `Rules in ${below[0].module} cite parts of it` };
  if (deferredAbove) return { state: "deferred", detail: `Deferred by ${deferredAbove.module}` };
  if (deferredBelow) return { state: "partly", detail: `${deferredBelow.module} defers part of it` };
  return { state: null, detail: null };
}

function documentStatus(
  row: Pick<
    BundleDocumentRow,
    "scope" | "in_corpus" | "provisions" | "encoded_provisions" | "unvalidated_provisions" | "partly_provisions"
  >
): DocumentStatus | null {
  if (row.scope === "excluded") return null;
  if (!row.in_corpus) return "not_in_corpus";
  const encoded = row.encoded_provisions + row.unvalidated_provisions;
  if (row.provisions > 0 && encoded === row.provisions) return row.unvalidated_provisions ? "unvalidated" : "complete";
  return encoded + row.partly_provisions > 0 ? "partly" : "not_started";
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
  const attempts = [...(telemetry?.attempts ?? [])]
    .filter((a) => root && a.citation && under(a.citation, root))
    .sort((a, b) => b.dispatched_at.localeCompare(a.dispatched_at));

  const states = new Map<string, ProvisionState>();
  const open: OpenProvision[] = [];
  for (const leaf of leaves) {
    const { state } = grade(leaf, modules);
    if (state) {
      states.set(leaf, state);
      continue;
    }
    const run = newestRun(leaf, attempts);
    const ran = runState(run);
    if (run && ran) {
      states.set(leaf, ran);
      open.push({ path: leaf, state: ran, ...mark(run) });
    } else {
      states.set(leaf, "not_started");
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
        ...unitState(path, inCorpus, modules, leafStates, attempts),
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
    note: doc.note ?? null,
    citation_path: root,
    source_url: doc.source_url,
    sources: doc.sources ?? [],
    manifest: doc.manifest ?? null,
    in_corpus: inCorpus,
    provisions: leaves.length,
    encoded_provisions: count("encoded"),
    unvalidated_provisions: count("unvalidated"),
    partly_provisions: count("partly"),
    deferred_provisions: count("deferred"),
    provisions_in_progress: count("in_progress"),
    provisions_failed: count("failed"),
    open_provisions: open,
    modules: new Set(
      modules.filter((m) => root && m.cited.some((c) => under(c, root) || under(root, c))).map((m) => m.module)
    ).size,
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

/** A screener unit's state: by the rules that reach it, then by its provisions, then by its newest run. */
function unitState(
  path: string | null,
  inCorpus: boolean,
  modules: ModuleFacts[],
  leafStates: (path: string) => Array<ProvisionState | undefined>,
  attempts: PipelineAttempt[]
): Pick<ParityUnit, "state" | "detail" | "run"> {
  if (!path || !inCorpus) return { state: "not_in_corpus", detail: null, run: null };
  const { state, detail } = grade(path, modules);
  if (state) return { state, detail, run: null };
  // A whole cited document, or a path the corpus splits: by its provisions.
  const leaves = leafStates(path);
  const done = leaves.filter((s) => s === "encoded" || s === "unvalidated").length;
  if (leaves.length && done === leaves.length) {
    return { state: "encoded", detail: `All ${leaves.length} provisions encoded`, run: null };
  }
  if (leaves.some((s) => s === "encoded" || s === "unvalidated" || s === "partly")) {
    return { state: "partly", detail: `${done} of ${leaves.length} provisions encoded`, run: null };
  }
  const run = newestRun(path, attempts);
  const ran = runState(run);
  if (run && ran) return { state: ran, detail: null, run: mark(run) };
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
    | "provisions"
    | "encoded_provisions"
    | "unvalidated_provisions"
    | "partly_provisions"
    | "deferred_provisions"
    | "provisions_in_progress"
    | "provisions_failed"
  >
): Record<ProvisionState, number> {
  const known =
    row.encoded_provisions +
    row.unvalidated_provisions +
    row.partly_provisions +
    row.deferred_provisions +
    row.provisions_in_progress +
    row.provisions_failed;
  return {
    encoded: row.encoded_provisions,
    unvalidated: row.unvalidated_provisions,
    partly: row.partly_provisions,
    deferred: row.deferred_provisions,
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

type DocumentKind = "statute" | "regulation" | "guidance" | "manual" | "form" | "policy" | "other";

/** The document types, in reading order: federal law first, then the state's own sources. */
const DOCUMENT_TYPES: Array<{ layer: "federal" | "state"; kind: DocumentKind; label: string }> = [
  { layer: "federal", kind: "statute", label: "Federal statutes and public laws" },
  { layer: "federal", kind: "regulation", label: "Federal regulations" },
  { layer: "federal", kind: "guidance", label: "Federal guidance (FNS, HHS)" },
  { layer: "federal", kind: "manual", label: "Federal manuals (SSA POMS)" },
  { layer: "federal", kind: "form", label: "Federal forms" },
  { layer: "federal", kind: "policy", label: "Federal policy documents" },
  { layer: "state", kind: "statute", label: "State statutes" },
  { layer: "state", kind: "regulation", label: "State regulations" },
  { layer: "state", kind: "manual", label: "State policy manual" },
  { layer: "state", kind: "policy", label: "State plans, notices and waivers" },
  { layer: "state", kind: "guidance", label: "Federal letters to the state" },
];

const KINDS: DocumentKind[] = ["statute", "regulation", "guidance", "manual", "form", "policy"];

/** What kind of document a web page the corpus does not hold is, by its address. */
function urlKind(url: string): DocumentKind {
  if (/congress\.gov\/.+\/(plaws|bills)\/|govinfo\.gov\/.*(PLAW-|USCODE-)|law\.cornell\.edu\/uscode|uscode\.house\.gov/i.test(url))
    return "statute";
  if (/ecfr\.gov|law\.cornell\.edu\/cfr|federalregister\.gov|govinfo\.gov\/.*FR-/i.test(url)) return "regulation";
  if (/ssa\.gov\/poms|dbmefaapolicy\.azdes\.gov/i.test(url)) return "manual";
  if (/(fns|fna)\.usda\.gov|usda\.gov\/sites\/default\/files\/guidance|fns-prod\.azureedge|aspe\.hhs\.gov/i.test(url))
    return "guidance";
  return "other";
}

/**
 * A document's type for grouping: its layer and its kind (statute,
 * regulation, guidance, manual, form, policy), from the citation path's kind
 * segment, or from the address of a page the corpus does not hold.
 */
export function documentType(row: Pick<BundleDocumentRow, "layer" | "citation_path" | "source_url">): {
  key: string;
  label: string;
  order: number;
} {
  const segment = row.citation_path?.split("/")[1] ?? "";
  const kind: DocumentKind = (KINDS as string[]).includes(segment)
    ? (segment as DocumentKind)
    : row.citation_path
      ? "other"
      : urlKind(row.source_url ?? "");
  const layer = row.layer === "state" ? "state" : "federal";
  const index = DOCUMENT_TYPES.findIndex((t) => t.layer === layer && t.kind === kind);
  if (index < 0) return { key: `${layer}:other`, label: "Other documents", order: DOCUMENT_TYPES.length };
  return { key: `${layer}:${kind}`, label: DOCUMENT_TYPES[index].label, order: index };
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
