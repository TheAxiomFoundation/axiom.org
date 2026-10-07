"use client";

import { Fragment, useEffect, useState } from "react";
import styles from "./ops-dashboard.module.css";
import { relativeTime } from "./ops-dashboard";
import { RunTimeline } from "./run-timeline";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { journeyHref } from "@/lib/axiom/encoding-pipeline";
import { scopeSearch, type PipelineScope } from "@/lib/axiom/encoding-pipeline-insights";
import { runTimeline, type RunRow } from "@/lib/axiom/encoding-pipeline-runs";
import {
  bundleMemberships,
  bundleProgram,
  membershipDetail,
  tiersLabel,
  type BundleIndexEntry,
} from "@/lib/axiom/program-bundles";
import {
  causeHeadline,
  runLedger,
  sectionOverview,
  type LedgerDocument,
  type LedgerJurisdiction,
  type LedgerSection,
  type LedgerTone,
} from "@/lib/axiom/run-ledger";

/** What /ops/runs returns: every run in the scope, and its citations' names and source documents. */
interface RunsPayload {
  rows: RunRow[];
  labels?: Record<string, string>;
  documentPaths?: Record<string, string>;
  /** Program bundle documents that hold some run's citation. */
  bundles?: BundleIndexEntry[];
}

/** Documents shown before "Show more", as the encoding ledger always showed. */
const DOCUMENTS_SHOWN = 10;
/** Groups an overview list shows before "+N more". */
const OVERVIEW_GROUPS = 4;

const TONE_CLASS: Record<LedgerTone, string> = {
  done: styles.completed,
  waiting: styles.inprogress,
  failed: styles.flagged,
};

const TONE_DOT: Record<LedgerTone, string> = {
  done: "bg-[var(--color-success)]",
  waiting: "bg-[var(--color-accent)]",
  failed: "bg-[var(--color-warning)]",
};

/** Letters and digits only, to tell a real name from one that echoes its designator ("Page 2", "page-2"). */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The first `count` documents across jurisdictions, each jurisdiction keeping its own. */
function firstDocuments(ledger: LedgerJurisdiction[], count: number): LedgerJurisdiction[] {
  let left = count;
  return ledger
    .map((jurisdiction) => {
      const documents = jurisdiction.documents.slice(0, Math.max(0, left));
      left -= documents.length;
      return { ...jurisdiction, documents };
    })
    .filter((jurisdiction) => jurisdiction.documents.length > 0);
}

/**
 * The encoding ledger built from every run (failures that left no encoder
 * record included): by jurisdiction, source document, and section, each
 * section with its provision, its latest status, its runs, and when it last
 * ran. A section drops down an overview of its runs (how many, where they
 * ended, why they failed, the latest) with the latest run's timeline, and
 * the journey page holds every run.
 */
export function PipelineLedger({
  scope,
  scopeName,
  referenceMs,
}: {
  scope: PipelineScope | null;
  /** Shown in the subtitle when the page is narrowed to a jurisdiction. */
  scopeName: string | null;
  referenceMs: number;
}) {
  const [payload, setPayload] = useState<RunsPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(DOCUMENTS_SHOWN);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const query = scopeSearch(scope);
  useEffect(() => {
    let live = true;
    fetch(`/ops/runs${query}`)
      .then((response) => {
        if (!response.ok) throw new Error(`runs: ${response.status}`);
        return response.json() as Promise<RunsPayload>;
      })
      .then(
        (loaded) => live && setPayload(loaded),
        () => live && setFailed(true)
      );
    return () => {
      live = false;
    };
  }, [query]);

  const ledger = payload ? runLedger(payload.rows, payload.labels, payload.documentPaths) : [];
  const documentCount = ledger.reduce((total, jurisdiction) => total + jurisdiction.documents.length, 0);

  return (
    <section aria-label="Latest encodings" className={styles.ledger}>
      <div className={styles.ledgerHeader}>
        <div>
          <p className={styles.eyebrow}>Encoding ledger</p>
          <h2>Latest encodings</h2>
          <p>
            {scopeName ? `${scopeName}: every run` : "Every run"}, grouped by jurisdiction and document. Open a
            section for its runs.
          </p>
        </div>
      </div>
      {failed ? (
        <p className="text-sm text-[var(--color-ink-secondary)]">The ledger could not load. Try again later.</p>
      ) : !payload ? (
        <p className="text-sm text-[var(--color-ink-secondary)]">Loading runs…</p>
      ) : documentCount === 0 ? (
        <p className="text-sm text-[var(--color-ink-secondary)]">No runs recorded in this scope yet.</p>
      ) : (
        <>
          <Table className={styles.ledgerTable}>
            <TableHeader>
              <TableRow className="border-b border-[var(--color-rule)] hover:bg-transparent">
                <TableHead className="h-8 w-[34%] px-0 font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Section
                </TableHead>
                <TableHead className="h-8 px-2 font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Provision
                </TableHead>
                <TableHead className="h-8 w-40 px-2 font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Bundle
                </TableHead>
                <TableHead className="h-8 w-36 px-2 font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Status
                </TableHead>
                <TableHead className="h-8 w-16 px-2 text-right font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Runs
                </TableHead>
                <TableHead className="h-8 w-20 px-0 text-right font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Last run
                </TableHead>
              </TableRow>
            </TableHeader>
            {firstDocuments(ledger, shown).map((jurisdiction) => (
              <TableBody key={jurisdiction.code}>
                <TableRow className="hover:bg-transparent">
                  <TableHead colSpan={6} scope="rowgroup" className={styles.jurisdictionBand}>
                    {jurisdiction.name}
                  </TableHead>
                </TableRow>
                {jurisdiction.documents.map((document) => (
                  <DocumentSections
                    key={document.key}
                    document={document}
                    referenceMs={referenceMs}
                    bundles={payload?.bundles ?? []}
                    openSection={openSection}
                    onSection={(citation) => setOpenSection((open) => (open === citation ? null : citation))}
                  />
                ))}
              </TableBody>
            ))}
          </Table>
          {documentCount > shown && (
            <button
              type="button"
              className={styles.ledgerMore}
              onClick={() => setShown((count) => count + DOCUMENTS_SHOWN)}
            >
              Show {Math.min(DOCUMENTS_SHOWN, documentCount - shown)} more documents
            </button>
          )}
        </>
      )}
    </section>
  );
}

function DocumentSections({
  document,
  referenceMs,
  bundles,
  openSection,
  onSection,
}: {
  document: LedgerDocument;
  referenceMs: number;
  /** Bundle documents, to name the bundle and tier each section belongs to. */
  bundles: BundleIndexEntry[];
  openSection: string | null;
  onSection: (citation: string) => void;
}) {
  return (
    <>
      <TableRow className="border-b border-[var(--color-rule)] hover:bg-transparent">
        <TableCell colSpan={6} className={styles.documentBand}>
          <span
            className="text-sm font-semibold text-[var(--color-ink)]"
            title={document.titled ? undefined : "Document identifier; source title not yet indexed"}
          >
            {document.title}
          </span>
        </TableCell>
      </TableRow>
      {document.sections.map((section) => {
        const open = openSection === section.citation;
        const label =
          section.label && plain(section.label) !== plain(section.designator) && section.label !== document.title
            ? section.label
            : "";
        return (
          <Fragment key={section.citation}>
            <TableRow className="border-b border-[var(--color-rule-subtle)] hover:bg-[var(--color-rule-subtle)]">
              <TableCell className="py-1.5 pl-5 pr-2 align-baseline font-mono whitespace-normal break-all">
                <button
                  type="button"
                  className={styles.ledgerToggle}
                  aria-expanded={open}
                  aria-label={`Runs of ${section.citation}`}
                  onClick={() => onSection(section.citation)}
                >
                  <span aria-hidden>{open ? "▾" : "▸"}</span>
                </button>
                <a
                  href={journeyHref(section.citation)}
                  title={section.citation}
                  className="text-[var(--color-ink)] no-underline hover:underline"
                >
                  {section.designator}
                </a>
              </TableCell>
              <TableCell className="px-2 py-1.5 align-baseline whitespace-normal text-[var(--color-ink-secondary)]">
                {label}
              </TableCell>
              <TableCell className="px-2 py-1.5 align-baseline">
                <span className={styles.ledgerBundles}>
                  {bundleMemberships(section.citation, bundles).map((membership) => (
                    <a
                      key={membership.bundle_id}
                      className={styles.ledgerBundle}
                      href={`/ops/bundles/${membership.bundle_id}`}
                      aria-label={`${membership.bundle_title} · ${tiersLabel(membership)}`}
                      title={membershipDetail(membership)}
                    >
                      {bundleProgram(membership)}
                      <span>{tiersLabel(membership)}</span>
                    </a>
                  ))}
                </span>
              </TableCell>
              <TableCell className="px-2 py-1.5 align-baseline whitespace-nowrap">
                <span className={`${styles.status} ${TONE_CLASS[section.tone]}`} data-tone={section.tone}>
                  <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT[section.tone]}`} />
                  <span className="text-[var(--color-ink-secondary)]">{section.status}</span>
                </span>
              </TableCell>
              <TableCell className="px-2 py-1.5 text-right align-baseline font-mono tabular-nums text-[var(--color-ink-muted)]">
                {section.runs.length}
              </TableCell>
              <TableCell className="px-0 py-1.5 text-right align-baseline whitespace-nowrap text-[var(--color-ink-muted)]">
                {relativeTime(section.lastAt, referenceMs)}
              </TableCell>
            </TableRow>
            {open && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className={styles.ledgerRunCell}>
                  <SectionRuns section={section} referenceMs={referenceMs} />
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * One overview list, count first: "2  Failed to compile — Axiom rules engine
 * compile failed", the largest few until "+N more" opens the rest. A row's
 * tooltip holds a full message.
 */
function CountList({
  title,
  groups,
}: {
  title: string;
  groups: Array<{ label: string; count: number; cause?: string | null; detail?: string | null }>;
}) {
  const [all, setAll] = useState(false);
  const more = groups.length - OVERVIEW_GROUPS;
  return (
    <div>
      <p className={styles.ledgerLabel}>{title}</p>
      <ul className={styles.ledgerCounts} aria-label={title}>
        {(all ? groups : groups.slice(0, OVERVIEW_GROUPS)).map((group) => (
          <li key={`${group.label}|${group.cause ?? ""}`} title={group.detail ?? group.label}>
            <span className={styles.ledgerCount}>{group.count}</span>
            <span>
              <span className={styles.ledgerStop}>{group.label}</span>
              {group.cause && <span className={styles.ledgerCause}> — {group.cause}</span>}
            </span>
          </li>
        ))}
        {more > 0 && (
          <li>
            <span />
            <button type="button" className={styles.ledgerShowMore} aria-expanded={all} onClick={() => setAll((open) => !open)}>
              {all ? "Show fewer" : `+${more} more`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Every run of a section, one line each, newest first; a line opens its run's timeline. */
function RunLines({ runs, referenceMs }: { runs: RunRow[]; referenceMs: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ol className={styles.ledgerRuns} aria-label="Every run">
      {runs.map((run) => (
        <li key={run.id}>
          <div className={styles.ledgerRunLine}>
            <button
              type="button"
              className={styles.ledgerToggle}
              aria-expanded={open === run.id}
              aria-label={`Timeline of ${run.citation}, run ${run.id}`}
              onClick={() => setOpen((current) => (current === run.id ? null : run.id))}
            >
              <span aria-hidden>{open === run.id ? "▾" : "▸"}</span>
            </button>
            <span title={run.dispatchedAt}>{relativeTime(run.dispatchedAt, referenceMs)}</span>
            {run.encoder && <span className="font-mono">{run.encoder}</span>}
            <a href={run.runUrl} target="_blank" rel="noreferrer" data-outcome={run.outcome}>
              {run.outcomeLabel}
            </a>
            {run.cause && <span title={run.cause}>{causeHeadline(run.cause)}</span>}
            {run.pr && (
              <a href={run.pr.url} target="_blank" rel="noreferrer">
                {run.pr.label} · {run.pr.state}
              </a>
            )}
          </div>
          {open === run.id && <RunTimeline timeline={runTimeline(run, referenceMs)} showStopped={false} />}
        </li>
      ))}
    </ol>
  );
}

/** An open section: how many runs, where and why each stopped, the latest run's timeline, and every run on request. */
function SectionRuns({ section, referenceMs }: { section: LedgerSection; referenceMs: number }) {
  const [everyRun, setEveryRun] = useState(false);
  const overview = sectionOverview(section);
  const latest = overview.latest;
  const failedShare =
    overview.failed === 0 ? null : overview.failed === overview.runs ? "all failed" : `${overview.failed} failed`;
  return (
    <div className={styles.ledgerOverview}>
      {/* One run: its own line says it all. */}
      {overview.runs > 1 && (
        <>
          <p className={styles.ledgerSummary}>
            <strong>{overview.runs} runs</strong>
            {failedShare && <span>{failedShare}</span>}
            <span>latest {relativeTime(overview.lastAt, referenceMs)}</span>
          </p>
          <CountList title="Where each run stopped, and why" groups={overview.stops} />
        </>
      )}
      <p className={styles.ledgerLatest}>
        <span className={styles.ledgerLabel}>{overview.runs === 1 ? "The run" : "Latest run"}</span>
        <span title={latest.dispatchedAt}>{relativeTime(latest.dispatchedAt, referenceMs)}</span>
        <a href={latest.runUrl} target="_blank" rel="noreferrer" data-outcome={latest.outcome}>
          {latest.outcomeLabel}
        </a>
        {latest.tries && (
          <span>
            {latest.tries.length} {latest.tries.length === 1 ? "try" : "tries"}
          </span>
        )}
        {latest.cause && <span title={latest.cause}>{causeHeadline(latest.cause)}</span>}
        {latest.pr && (
          <a href={latest.pr.url} target="_blank" rel="noreferrer">
            {latest.pr.label} · {latest.pr.state}
          </a>
        )}
      </p>
      <RunTimeline timeline={runTimeline(latest, referenceMs)} showStopped={false} />
      {overview.runs > 1 && (
        <button
          type="button"
          className={styles.ledgerShowMore}
          aria-expanded={everyRun}
          onClick={() => setEveryRun((open) => !open)}
        >
          {everyRun ? "Hide the runs" : `Show all ${overview.runs} runs`}
        </button>
      )}
      {everyRun && <RunLines runs={section.runs} referenceMs={referenceMs} />}
    </div>
  );
}
