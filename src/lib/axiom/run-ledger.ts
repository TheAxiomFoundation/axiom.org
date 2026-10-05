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
