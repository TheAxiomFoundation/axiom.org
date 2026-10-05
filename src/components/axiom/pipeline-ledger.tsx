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
}

/** Documents shown before "Show more", as the encoding ledger always showed. */
const DOCUMENTS_SHOWN = 10;
/** Groups an overview line lists before "+N more". */
const OVERVIEW_GROUPS = 4;
/** A failure cause in an overview, cut to this length; its tooltip holds the rest. */
const CAUSE_CHARS = 64;

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
                  <TableHead colSpan={5} scope="rowgroup" className={styles.jurisdictionBand}>
                    {jurisdiction.name}
                  </TableHead>
                </TableRow>
                {jurisdiction.documents.map((document) => (
                  <DocumentSections
                    key={document.key}
                    document={document}
                    referenceMs={referenceMs}
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
  openSection,
  onSection,
}: {
  document: LedgerDocument;
  referenceMs: number;
  openSection: string | null;
  onSection: (citation: string) => void;
}) {
  return (
    <>
      <TableRow className="border-b border-[var(--color-rule)] hover:bg-transparent">
        <TableCell colSpan={5} className={styles.documentBand}>
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
                <TableCell colSpan={5} className={styles.ledgerRunCell}>
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

const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** One overview line's groups: the largest few, then how many more. */
function Groups({ groups }: { groups: Array<{ label: string; count: number; tone?: LedgerTone }> }) {
  return (
    <>
      {groups.slice(0, OVERVIEW_GROUPS).map((group) => (
        <span key={group.label} title={group.label}>
          {group.tone && (
            <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT[group.tone]}`} />
          )}
          {clip(group.label, CAUSE_CHARS)} <strong className={styles.ledgerCount}>{group.count}</strong>
        </span>
      ))}
      {groups.length > OVERVIEW_GROUPS && <span>+{groups.length - OVERVIEW_GROUPS} more</span>}
    </>
  );
}

/** An open section: its runs in a few lines, the latest run's timeline, and a link to every run. */
function SectionRuns({ section, referenceMs }: { section: LedgerSection; referenceMs: number }) {
  const overview = sectionOverview(section);
  const latest = overview.latest;
  return (
    <>
      <dl className={styles.ledgerOverview} aria-label={`Runs of ${section.citation}`}>
        <div>
          <dt>Runs</dt>
          <dd>
            <span>
              <strong className={styles.ledgerCount}>{overview.runs}</strong>{" "}
              {overview.runs === 1
                ? relativeTime(overview.lastAt, referenceMs)
                : `from ${relativeTime(overview.firstAt, referenceMs)} to ${relativeTime(overview.lastAt, referenceMs)}`}
            </span>
            {overview.encoders && (
              <span className="font-mono">
                {overview.encoders.from === overview.encoders.to
                  ? overview.encoders.to
                  : `${overview.encoders.from} → ${overview.encoders.to}`}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Ended</dt>
          <dd>
            <Groups groups={overview.ended} />
          </dd>
        </div>
        {overview.causes.length > 0 && (
          <div>
            <dt>Causes</dt>
            <dd>
              <Groups groups={overview.causes} />
            </dd>
          </div>
        )}
        <div>
          <dt>Latest</dt>
          <dd>
            <span title={latest.dispatchedAt}>{relativeTime(latest.dispatchedAt, referenceMs)}</span>
            <a href={latest.runUrl} target="_blank" rel="noreferrer" data-outcome={latest.outcome}>
              {latest.outcomeLabel}
            </a>
            {latest.cause && (
              <span className={styles.ledgerRunCause} title={latest.cause}>
                {latest.cause}
              </span>
            )}
            {latest.pr && (
              <a href={latest.pr.url} target="_blank" rel="noreferrer">
                {latest.pr.label} · {latest.pr.state}
              </a>
            )}
          </dd>
        </div>
      </dl>
      <div className={styles.ledgerTimeline}>
        <RunTimeline timeline={runTimeline(latest, referenceMs)} />
      </div>
      <a className={styles.ledgerAll} href={journeyHref(section.citation)}>
        {overview.runs === 1 ? "This run on the journey page" : `All ${overview.runs} runs, each with its timeline`} →
      </a>
    </>
  );
}
