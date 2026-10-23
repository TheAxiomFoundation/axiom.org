/**
 * The /ops ledger: every dispatch grouped the way the encoding ledger reads,
 * by jurisdiction, source document, and section, each section with its
 * latest status and every run behind it. Built from the pipeline's run rows,
 * so failures with no encoder record count too, and so do modules merged
 * outside the pipeline and modules encoded inside another citation's run.
 */

import { causeHeadline, type RunRow } from "./encoding-pipeline-runs";

export { causeHeadline };
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
  /** The document's own citation path (`us/statute/26`), shown beside its title; null when the key is not a path. */
  path: string | null;
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
  if (!pr) return { status: "Without a PR", tone: "failed" };
  if (pr.state === "draft" || pr.state === "open") return { status: "In review", tone: "waiting" };
  if (pr.state === "closed") return { status: "PR closed", tone: "failed" };
  if (latest.merged === "off main") {
    return latest.via?.state === "open" || latest.via?.state === "draft"
      ? { status: `In a side branch, waits for ${latest.via.label}`, tone: "waiting" }
      : { status: "Merged into another branch", tone: "failed" };
  }
  if (latest.tests === "pass") return { status: "Tests pass", tone: "done" };
  if (latest.tests === "fail") return { status: "Tests fail", tone: "failed" };
  if (latest.index === "missing") return { status: "Not indexed", tone: "failed" };
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
    // Newest first by when each happened: a PR merged outside the pipeline counts from its merge.
    const sorted = [...runs].sort((a, b) => (b.at ?? b.dispatchedAt).localeCompare(a.at ?? a.dispatchedAt));
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
      lastAt: latest.at ?? latest.dispatchedAt,
      runs: sorted,
    };
    const title = documentPath ? labels[documentPath]?.trim() || null : null;
    const document = documents.get(key) ?? {
      key,
      title: title ?? documentIdentifier(key),
      titled: !!title,
      path: documentPath,
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

/**
 * The `count` most recently active documents across every jurisdiction,
 * each under its own jurisdiction's heading, in the ledger's order: a page
 * of the ledger, so a jurisdiction with a newer document is not held back
 * until every document of a busier one has shown.
 */
export function newestDocuments(ledger: LedgerJurisdiction[], count: number): LedgerJurisdiction[] {
  const shown = new Set(
    ledger
      .flatMap((jurisdiction) => jurisdiction.documents)
      .sort(newest)
      .slice(0, Math.max(0, count))
  );
  return ledger
    .map((jurisdiction) => ({ ...jurisdiction, documents: jurisdiction.documents.filter((document) => shown.has(document)) }))
    .filter((jurisdiction) => jurisdiction.documents.length > 0);
}

/** A section's runs in a few lines: how many, where and why each stopped, and the latest. */
export interface SectionOverview {
  runs: number;
  /** How many of them failed. */
  failed: number;
  /** How many were cancelled or timed out: stopped by a person or the clock, not by a failure. */
  cancelled: number;
  lastAt: string;
  /**
   * Where each run stopped and why, one line per pair, largest first: its
   * status as a section's status reads ("Failed the compile check"), and for
   * a failed run the cause's headline (`cause`) and one full message
   * (`detail`). Runs failing the same way count together by their cause's
   * group; a line whose runs all give one message heads it with that message.
   */
  stops: Array<{ key: string; label: string; cause: string | null; tone: LedgerTone; count: number; detail: string | null }>;
  latest: RunRow;
}

function counted<T extends { count: number; label: string }>(groups: Map<string, T>): T[] {
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function sectionOverview(section: LedgerSection): SectionOverview {
  const runs = section.runs;
  const stops = new Map<string, SectionOverview["stops"][number]>();
  const messages = new Map<string, Set<string>>();
  let failed = 0;
  let cancelled = 0;
  for (const run of runs) {
    const { status, tone } = sectionStatus(run);
    if (run.outcome === "failed") failed++;
    if (run.outcome === "cancelled") cancelled++;
    const group = run.causeGroup ?? run.cause;
    const headline = group ? causeHeadline(group) : null;
    const key = `${status}|${headline ?? ""}`;
    const stop = stops.get(key) ?? { key, label: status, cause: headline, tone, count: 0, detail: null };
    stop.count += 1;
    stop.detail ??= run.cause;
    stops.set(key, stop);
    if (run.cause) messages.set(key, (messages.get(key) ?? new Set<string>()).add(run.cause));
  }
  // One message behind a line: its own words, values and all, rather than the group's.
  for (const [key, said] of messages) {
    if (said.size === 1) stops.get(key)!.cause = causeHeadline([...said][0]);
  }
  return {
    runs: runs.length,
    failed,
    cancelled,
    lastAt: runs[0].at ?? runs[0].dispatchedAt,
    stops: counted(stops),
    latest: runs[0],
  };
}

/** One run as a mark in a section's history row. */
export interface RunMark {
  id: string;
  tone: LedgerTone | "cancelled";
  /** What a hover says: when, and how it ended. */
  title: string;
  url: string;
}

/**
 * An open section in a few lines, for the question "why is this not encoded
 * yet, and what is next?": whether it is encoded, what is happening now with
 * the one link to act on, the failures that come back (two runs or more),
 * and every run as a mark, oldest first.
 */
export interface SectionBrief {
  encoded: boolean;
  /** "Encoded · merged rulespec-us#1448 · tests pass", or "Not encoded yet · 11 runs since 2026-09-03, none merged". */
  headline: string;
  /** What is happening now and the next step; null once the section is encoded and nothing is open. */
  now: { text: string; link: { label: string; url: string } | null } | null;
  /** Failures more than one run hit, most first. */
  repeated: Array<{ label: string; cause: string | null; detail: string | null; count: number; url: string }>;
  marks: RunMark[];
}

const day = (iso: string) => iso.slice(0, 10);

/** The next step for a section, from its latest run: approve it, open the failure, or open the PR. */
function nextStep(latest: RunRow): SectionBrief["now"] {
  const run = (label: string) => ({ label, url: latest.runUrl });
  switch (latest.outcome) {
    case "waiting":
      return { text: latest.outcomeLabel, link: run(/approval/i.test(latest.outcomeLabel) ? "Approve on GitHub ↗" : "Open the run ↗") };
    case "running":
      return { text: latest.outcomeLabel, link: run("Open the run ↗") };
    case "failed":
      return {
        text: latest.cause ? `${latest.outcomeLabel}: ${causeHeadline(latest.cause)}` : latest.outcomeLabel,
        link: run("Open the failed run ↗"),
      };
    case "cancelled":
      return { text: latest.outcomeLabel, link: run("Open the run ↗") };
  }
  const { status, tone } = sectionStatus(latest);
  if (tone === "done") return null;
  const pr = latest.pr ? { label: `${latest.pr.label} ↗`, url: latest.pr.url } : null;
  if (latest.merged === "off main" && latest.via?.url) return { text: status, link: { label: `${latest.via.label} ↗`, url: latest.via.url } };
  if (latest.tests === "fail" && latest.testsUrl) return { text: status, link: { label: "Open the tests ↗", url: latest.testsUrl } };
  return { text: status, link: pr };
}

export function sectionBrief(section: LedgerSection): SectionBrief {
  const runs = section.runs;
  const latest = runs[0];
  const done = runs.find((run) => sectionStatus(run).tone === "done");
  const merged = runs.filter((run) => run.merged === "main").length;
  const oldest = runs[runs.length - 1];
  const headline = done
    ? ["Encoded", done.pr ? `merged ${done.pr.label}` : null, "tests pass"].filter(Boolean).join(" · ")
    : `Not encoded yet · ${runs.length} ${runs.length === 1 ? "run" : "runs"}${runs.length > 1 ? ` since ${day(oldest.at ?? oldest.dispatchedAt)}` : ""}, ${merged ? `${merged} merged` : "none merged"}`;

  // A failure that came back: the same stop and cause in two runs or more,
  // with the newest run that hit it to open.
  const repeated = sectionOverview(section)
    .stops.filter((stop) => stop.tone === "failed" && stop.count >= 2)
    .map((stop) => {
      const hit = runs.find((run) => {
        const group = run.causeGroup ?? run.cause;
        return `${sectionStatus(run).status}|${group ? causeHeadline(group) : ""}` === stop.key;
      });
      return { label: stop.label, cause: stop.cause, detail: stop.detail, count: stop.count, url: (hit ?? latest).runUrl };
    });

  const marks = [...runs].reverse().map((run): RunMark => {
    const { status, tone } = sectionStatus(run);
    return {
      id: run.id,
      tone: run.outcome === "cancelled" ? "cancelled" : tone,
      title: `${day(run.at ?? run.dispatchedAt)} · ${status}${run.cause ? `: ${causeHeadline(run.cause)}` : ""}`,
      url: run.pr && run.outcome === "encoded" ? run.pr.url : run.runUrl,
    };
  });

  return { encoded: !!done, headline, now: done && latest === done ? null : nextStep(latest), repeated, marks };
}
