/**
 * The /ops ledger: every dispatch grouped the way the encoding ledger reads,
 * by jurisdiction, source document, and section, each section with its
 * latest status and every run behind it. Built from the pipeline's run rows,
 * so failures with no encoder record count too.
 */

import type { RunRow } from "./encoding-pipeline-runs";
import { ownLevelName } from "./jurisdiction-names";
import {
  corpusPathForDocumentKey,
  deepestLabelForCitation,
  documentIdentifier,
  documentKeyFromCitation,
  parseCitation,
  sectionLabelForCitation,
  sectionWithinDocument,
} from "./ops-citations";

export type LedgerTone = "done" | "failed" | "waiting";

export interface LedgerSection {
  citation: string;
  /** Where in its document: "273/4", or the document's own name for a document-level run. */
  designator: string;
  label: string | null;
  status: string;
  tone: LedgerTone;
  lastAt: string;
  /** Newest first. */
  runs: RunRow[];
}

export interface LedgerDocument {
  key: string;
  /** The source's title, or a readable identifier while its title is not indexed. */
  title: string;
  titled: boolean;
  lastAt: string;
  sections: LedgerSection[];
}

export interface LedgerJurisdiction {
  code: string;
  name: string;
  lastAt: string;
  documents: LedgerDocument[];
}

/** A section's status, from its latest run: how far that run got, or what stopped it. */
export function sectionStatus(latest: RunRow): { status: string; tone: LedgerTone } {
  switch (latest.outcome) {
    case "waiting":
    case "running":
      return { status: latest.outcomeLabel, tone: "waiting" };
    case "failed":
    case "cancelled":
      return { status: latest.outcomeLabel, tone: "failed" };
  }
  const pr = latest.pr;
  if (!pr) return { status: "No PR", tone: "failed" };
  if (pr.state === "draft" || pr.state === "open") return { status: "In review", tone: "waiting" };
  if (pr.state === "closed") return { status: "PR closed", tone: "failed" };
  if (latest.merged === "off main") return { status: "Merged off main", tone: "failed" };
  if (latest.tests === "pass") return { status: "Tests pass", tone: "done" };
  if (latest.tests === "fail") return { status: "Tests fail", tone: "failed" };
  if (latest.index === "missing") return { status: "Not in the index", tone: "failed" };
  return { status: "In main", tone: "waiting" };
}

const newest = <T extends { lastAt: string }>(a: T, b: T) => b.lastAt.localeCompare(a.lastAt);

/**
 * Group runs by jurisdiction, document, and section, newest activity first
 * at every level. A citation's source document comes from the corpus when
 * known (`documentPaths`), else from the citation's own shape.
 */
export function runLedger(
  rows: RunRow[],
  labels: Record<string, string> = {},
  documentPaths: Record<string, string> = {}
): LedgerJurisdiction[] {
  const bySection = new Map<string, RunRow[]>();
  for (const row of rows) bySection.set(row.citation, [...(bySection.get(row.citation) ?? []), row]);

  const documents = new Map<string, LedgerDocument & { jurisdiction: string }>();
  for (const [citation, runs] of bySection) {
    const sorted = [...runs].sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
    const latest = sorted[0];
    const known = documentPaths[citation];
    const key = known ? known.replace("/", ":") : documentKeyFromCitation(citation);
    const documentPath = corpusPathForDocumentKey(key);
    const { scope, segments } = parseCitation(citation);
    const citationPath = [scope, ...segments].join("/");
    const within =
      documentPath && citationPath === documentPath
        ? "(document)"
        : documentPath && citationPath.startsWith(`${documentPath}/`)
          ? citationPath.slice(documentPath.length + 1)
          : sectionWithinDocument(citation, key);
    const isDocument = within === "(document)";
    const section: LedgerSection = {
      citation,
      designator: isDocument ? (key.split("/").pop() ?? key) : within,
      label: isDocument ? deepestLabelForCitation(citation, labels) : sectionLabelForCitation(citation, labels),
      ...sectionStatus(latest),
      lastAt: latest.dispatchedAt,
      runs: sorted,
    };
    const title = documentPath ? labels[documentPath]?.trim() || null : null;
    const document = documents.get(key) ?? {
      key,
      title: title ?? documentIdentifier(key),
      titled: !!title,
      lastAt: section.lastAt,
      sections: [],
      jurisdiction: latest.jurisdiction,
    };
    document.sections.push(section);
    if (section.lastAt > document.lastAt) document.lastAt = section.lastAt;
    documents.set(key, document);
  }

  const jurisdictions = new Map<string, LedgerJurisdiction>();
  for (const { jurisdiction: code, ...document } of documents.values()) {
    document.sections.sort(newest);
    const group = jurisdictions.get(code) ?? { code, name: ownLevelName(code), lastAt: document.lastAt, documents: [] };
    group.documents.push(document);
    if (document.lastAt > group.lastAt) group.lastAt = document.lastAt;
    jurisdictions.set(code, group);
  }
  return [...jurisdictions.values()]
    .map((group) => ({ ...group, documents: group.documents.sort(newest) }))
    .sort(newest);
}

/** A section's runs in a few lines: how many and over what span, how they ended, why they failed, and the latest. */
export interface SectionOverview {
  runs: number;
  firstAt: string;
  lastAt: string;
  /** The oldest and newest encoder versions its runs used, when recorded. */
  encoders: { from: string; to: string } | null;
  /** Where each run ended, as a section's status reads, largest first. */
  ended: Array<{ label: string; tone: LedgerTone; count: number }>;
  /** What stopped the runs that failed, by headline, largest first; `detail` is one full message. */
  causes: Array<{ label: string; count: number; detail: string }>;
  latest: RunRow;
}

/** Prefixes that name where an error came from rather than what it says. */
const CAUSE_SOURCE_RE = /^(?:ci|compile|error|RuntimeError|ValueError|TypeError|KeyError|AssertionError):\s*/i;
const CAUSE_HEADLINE_MAX = 72;

/**
 * A failure cause in a few words: a completeness rule by its name, else the
 * message's own first clause without where it came from ("ci: Ungrounded
 * generated numeric literal: N does not…" is "Ungrounded generated numeric
 * literal"). Causes with one headline count together.
 */
export function causeHeadline(cause: string): string {
  const rule = cause.match(/^complete-source-unit:([a-z0-9-]+)$/i);
  if (rule) return `Completeness rule: ${rule[1]}`;
  let text = cause.trim();
  while (CAUSE_SOURCE_RE.test(text)) text = text.replace(CAUSE_SOURCE_RE, "");
  const clause = text.split(/:\s/)[0];
  const headline = (clause.length >= 12 ? clause : text).replace(/[.\s]+$/, "");
  return headline.length > CAUSE_HEADLINE_MAX ? `${headline.slice(0, CAUSE_HEADLINE_MAX - 1)}…` : headline;
}

function counted<T extends { count: number; label: string }>(groups: Map<string, T>): T[] {
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function sectionOverview(section: LedgerSection): SectionOverview {
  const runs = section.runs;
  const ended = new Map<string, { label: string; tone: LedgerTone; count: number }>();
  const causes = new Map<string, { label: string; count: number; detail: string }>();
  for (const run of runs) {
    const { status, tone } = sectionStatus(run);
    ended.set(status, { label: status, tone, count: (ended.get(status)?.count ?? 0) + 1 });
    if (run.cause) {
      const label = causeHeadline(run.cause);
      const known = causes.get(label);
      causes.set(label, { label, count: (known?.count ?? 0) + 1, detail: known?.detail ?? run.cause });
    }
  }
  const versions = runs
    .map((run) => run.encoder)
    .filter((version): version is string => !!version)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    runs: runs.length,
    firstAt: runs.at(-1)!.dispatchedAt,
    lastAt: runs[0].dispatchedAt,
    encoders: versions.length ? { from: versions[0], to: versions.at(-1)! } : null,
    ended: counted(ended),
    causes: counted(causes),
    latest: runs[0],
  };
}
