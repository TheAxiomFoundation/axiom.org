/**
 * The /ops ledger: every dispatch grouped the way the encoding ledger reads,
 * by jurisdiction, source document, and section, each section with its
 * latest status and every run behind it. Built from the pipeline's run rows,
 * so failures with no encoder record count too, and so do modules merged
 * outside the pipeline and modules encoded inside another citation's run.
 */

import { inPin, type PrLink, type PrLinks } from "./pr-links";
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
  /**
   * The section whose run encoded this one as a module (its latest run's
   * host), when that section is in the same document; it lists right above.
   */
  encodedWith: string | null;
  /** The section whose run encoded this one, when it lists in another document: a line links to it. */
  encodedIn: { citation: string; name: string; document: string | null } | null;
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
  if (pr.state === "draft" || pr.state === "open") {
    // What holds the PR, from GitHub: its checks first, then its review.
    if (pr.checks === "failure") return { status: "PR checks fail", tone: "failed" };
    if (pr.review === "changes_requested") return { status: "Changes requested", tone: "failed" };
    return { status: "In review", tone: "waiting" };
  }
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
      encodedWith: latest.source === "dependent" ? (latest.host?.citation ?? null) : null,
      encodedIn: null,
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

  for (const document of documents.values()) document.sections = withModulesUnderHost(document.sections.sort(newest));
  // A host in another document: its place there, and that document's title.
  const named = new Map<string, { name: string; document: string }>();
  for (const document of documents.values()) {
    for (const section of document.sections) named.set(section.citation, { name: section.designator, document: document.title });
  }
  for (const document of documents.values()) {
    for (const section of document.sections) {
      if (section.encodedIn) Object.assign(section.encodedIn, named.get(section.encodedIn.citation));
    }
  }

  const jurisdictions = new Map<string, LedgerJurisdiction>();
  for (const { jurisdiction: code, ...document } of documents.values()) {
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
 * Each module right under the section whose run encoded it, in that
 * section's place; a module whose host is not in the document stays a
 * section of its own.
 */
function withModulesUnderHost(sections: LedgerSection[]): LedgerSection[] {
  const byCitation = new Map(sections.map((section) => [section.citation, section]));
  // One level: a host that is itself a module elsewhere keeps its own place.
  const hostOf = (section: LedgerSection) => {
    const host = section.encodedWith ? byCitation.get(section.encodedWith) : undefined;
    return host && host !== section && !(host.encodedWith && byCitation.has(host.encodedWith)) ? host.citation : null;
  };
  const out: LedgerSection[] = [];
  for (const section of sections) {
    if (hostOf(section)) continue;
    // Encoded in a run listed elsewhere: a line under the row names that run's section.
    const elsewhere = section.encodedWith && section.encodedWith !== section.citation ? section.encodedWith : null;
    out.push({ ...section, encodedWith: null, encodedIn: elsewhere ? { citation: elsewhere, name: elsewhere, document: null } : null });
    out.push(...sections.filter((module) => hostOf(module) === section.citation).sort((a, b) => a.citation.localeCompare(b.citation)));
  }
  return out;
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

/**
 * Why a run stopped, in a few words: its own cause's headline, or for a PR
 * whose checks fail, the cluster their log names (check-clusters.ts).
 */
function stopCause(run: RunRow): string | null {
  const group = run.causeGroup ?? run.cause;
  if (group) return causeHeadline(group);
  return run.pr?.checks === "failure" ? run.pr.cluster : null;
}

/** A PR's failing checks: how many, and what their log printed. */
function failingChecks(run: RunRow): string | null {
  const pr = run.pr;
  if (pr?.checks !== "failure") return null;
  const count = pr.failing ? `${pr.failing} ${pr.failing === 1 ? "check fails" : "checks fail"}` : "Checks fail";
  return pr.error ? `${count}: ${shortPaths(pr.error)}` : count;
}

/** A log line with each repo path as its file name, and no list dash: the hover holds the rest. */
function shortPaths(text: string): string {
  return text.replace(/^- /, "").replace(/(?:\.?[\w.-]+\/)+([\w.-]+\.(?:json|ya?ml|py))\b/g, "$1");
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
    const headline = stopCause(run);
    const key = `${status}|${headline ?? ""}`;
    const stop = stops.get(key) ?? { key, label: status, cause: headline, tone, count: 0, detail: null };
    stop.count += 1;
    stop.detail ??= run.cause ?? failingChecks(run);
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
  /**
   * What is happening now and the next step; null once the section is encoded
   * and nothing is open. For an encoded section, a later run is a re-encode.
   */
  now: { text: string; link: { label: string; url: string } | null } | null;
  /** Failures more than one run hit since the last run that passed, most first. */
  repeated: Array<{ label: string; cause: string | null; detail: string | null; count: number; url: string }>;
  /** The latest run's PR checks, when they fail: how many, and what their log printed. */
  checks: string | null;
  /** What holds the latest run's open PR, from GitHub's records (pr-links.ts); null when it is not held or not read. */
  blocked: BlockedBrief | null;
  marks: RunMark[];
}

const day = (iso: string) => iso.slice(0, 10);
/** "Oct 26", in UTC. */
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

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
  if (latest.pr?.checks === "failure") {
    const also = latest.pr.review === "changes_requested" ? " · changes requested" : "";
    return { text: `${status}${latest.pr.cluster ? `: ${latest.pr.cluster}` : ""}${also}`, link: pr };
  }
  if (latest.merged === "off main" && latest.via?.url) return { text: status, link: { label: `${latest.via.label} ↗`, url: latest.via.url } };
  if (latest.tests === "fail" && latest.testsUrl) return { text: status, link: { label: "Open the tests ↗", url: latest.testsUrl } };
  return { text: status, link: pr };
}

export interface BlockedBrief {
  /** When the PR opened. */
  since: string;
  review: PrLinks["review"];
  comments: PrLinks["comments"];
  /** Linked items still open: what the PR waits on, its own links first. */
  waits: PrLink[];
  /** Merged encoder fixes the PR's repo's pin has not reached. */
  unpinned: PrLink[];
  /** The rest: merged or closed. */
  done: PrLink[];
  pin: string | null;
}

/** An open PR that its checks or its review hold, with what GitHub links to it. */
function blockedBrief(latest: RunRow): BlockedBrief | null {
  const pr = latest.pr;
  if (!pr?.links || (pr.state !== "open" && pr.state !== "draft") || sectionStatus(latest).tone !== "failed") return null;
  const { links, pin } = pr.links;
  const open = (link: PrLink) => link.state === "open" || link.state === "draft";
  const unpinned = links.filter((link) => inPin(link, pin) === false);
  return {
    since: pr.openedAt ?? latest.at,
    review: pr.links.review,
    comments: pr.links.comments,
    waits: links.filter(open).sort((a, b) => a.step - b.step),
    unpinned,
    done: links.filter((link) => !open(link) && !unpinned.includes(link)),
    pin,
  };
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

  // A failure that came back while the section is stuck: the same stop and
  // cause in two runs or more since its last run that passed, with the newest
  // run that hit it to open. Once a run passes, what failed before is history.
  const passed = runs.findIndex((run) => run.outcome === "encoded");
  const stuck = passed < 0 ? runs : runs.slice(0, passed);
  const repeated = (stuck.length < 2 ? [] : sectionOverview({ ...section, runs: stuck }).stops)
    .filter((stop) => stop.tone === "failed" && stop.count >= 2)
    .map((stop) => {
      const hit = stuck.find((run) => `${sectionStatus(run).status}|${stopCause(run) ?? ""}` === stop.key);
      return { label: stop.label, cause: stop.cause, detail: stop.detail, count: stop.count, url: (hit ?? latest).runUrl };
    });

  const marks = [...runs].reverse().map((run): RunMark => {
    const { status, tone } = sectionStatus(run);
    return {
      id: run.id,
      tone: run.outcome === "cancelled" ? "cancelled" : tone,
      title: `${day(run.at ?? run.dispatchedAt)} · ${status}${stopCause(run) ? `: ${stopCause(run)}` : ""}`,
      url: run.pr && run.outcome === "encoded" ? run.pr.url : run.runUrl,
    };
  });

  return { encoded: !!done, headline, now: done ? reencode(latest, done) : nextStep(latest), repeated, checks: done ? null : failingChecks(latest), blocked: done ? null : blockedBrief(latest), marks };
}

/** For an encoded section: a later run is a re-encode, and its outcome does not undo the merged encoding. */
function reencode(latest: RunRow, done: RunRow): SectionBrief["now"] {
  if (latest === done) return null;
  const step = nextStep(latest);
  if (!step) return null;
  // The headline already says the section is encoded; this line only says what the later run did.
  return { text: `Re-encode on ${shortDay(latest.at ?? latest.dispatchedAt)} — ${lower(step.text)}`, link: step.link };
}

/**
 * The modules one run encoded: the run's own citation first, then each
 * module encoded inside it, by citation. A run that encoded one module
 * gives just that row. `rows` holds every row, so a module whose section is
 * out of scope still shows. The run is the host's row (its stages, its PR);
 * null when the host is not among the rows.
 */
export function runModules(row: RunRow, rows: RunRow[]): { run: RunRow | null; modules: RunRow[] } {
  const hostId = row.source === "dependent" ? row.host?.id : row.id;
  if (!hostId) return { run: null, modules: [row] };
  const run = row.source === "dependent" ? (rows.find((r) => r.id === hostId) ?? null) : row;
  const inside = rows.filter((r) => r.source === "dependent" && r.host?.id === hostId).sort((a, b) => a.citation.localeCompare(b.citation));
  return { run, modules: run ? [run, ...inside] : inside.length ? inside : [row] };
}
