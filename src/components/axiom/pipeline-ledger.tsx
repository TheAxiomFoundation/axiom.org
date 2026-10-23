"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./ops-dashboard.module.css";
import { relativeTime } from "./ops-dashboard";
import { Explain } from "./explain";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeSearch, type PipelineScope } from "@/lib/axiom/encoding-pipeline-insights";
import type { RunRow } from "@/lib/axiom/encoding-pipeline-runs";
import {
  bundleHref,
  bundleMemberships,
  bundleProgram,
  membershipDetail,
  tiersLabel,
  type BundleIndexEntry,
} from "@/lib/axiom/program-bundles";
import {
  newestDocuments,
  runLedger,
  sectionBrief,
  type LedgerDocument,
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
  /** When the collector last read these runs. */
  collectedAt?: string | null;
}

/** Documents shown before "Show more", as the encoding ledger always showed. */
const DOCUMENTS_SHOWN = 10;

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

/** What a section's status says, by its dot's color. */
function StatusLegend() {
  return (
    <Explain label="Status">
      <span className="font-sans text-xs normal-case tracking-normal text-[var(--color-ink-secondary)]">
        A section&apos;s status is how far its latest run got, or what stopped it. A module merged outside the
        pipeline, or encoded inside another citation&apos;s run, counts as a run of its section.
      </span>
      <span className="grid gap-1 font-sans text-xs normal-case tracking-normal text-[var(--color-ink-secondary)]">
        <span>
          <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT.done}`} />
          Done: tests pass. Merged into main, and its jurisdiction&apos;s validation on main passes.
        </span>
        <span>
          <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT.waiting}`} />
          Going: waiting for approval, running, in review, or in main and waiting for the index and the tests.
        </span>
        <span>
          <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT.failed}`} />
          Stopped: the step that failed the run (&quot;Failed validation&quot;), a cancellation, no PR, a closed PR,
          a merge off main, failing tests, or missing from the index.
        </span>
      </span>
    </Explain>
  );
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
            {payload?.collectedAt && (
              <>
                {" "}
                <span title={payload.collectedAt}>Updated {relativeTime(payload.collectedAt, referenceMs)}.</span>
              </>
            )}
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
                <TableHead className={`${styles.ledgerWide} h-8 px-2 font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]`}>
                  Provision
                </TableHead>
                <TableHead className={`${styles.ledgerWide} h-8 w-40 px-2 font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]`}>
                  Bundle
                </TableHead>
                <TableHead className="h-8 w-36 px-2 font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    Status
                    <StatusLegend />
                  </span>
                </TableHead>
                <TableHead className={`${styles.ledgerWide} h-8 w-16 px-2 text-right font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]`}>
                  Runs
                </TableHead>
                <TableHead className="h-8 w-20 px-0 text-right font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Last run
                </TableHead>
              </TableRow>
            </TableHeader>
            {newestDocuments(ledger, shown).map((jurisdiction) => (
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
          {document.path && document.path !== document.title && (
            <span className="ml-2 font-mono text-[11px] text-[var(--color-ink-muted)]">{document.path}</span>
          )}
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
            <TableRow
              className="cursor-pointer border-b border-[var(--color-rule-subtle)] hover:bg-[var(--color-rule-subtle)]"
              // The whole row opens the section's runs, except its own links (the bundle chips).
              onClick={(event) => {
                if (!(event.target as Element).closest("a, button")) onSection(section.citation);
              }}
            >
              <TableCell className="py-1.5 pl-5 pr-2 align-baseline font-mono whitespace-normal break-words">
                <button
                  type="button"
                  className={styles.ledgerToggle}
                  aria-expanded={open}
                  aria-label={`Runs of ${section.citation}`}
                  title={section.citation}
                  onClick={() => onSection(section.citation)}
                >
                  <ChevronRight size={14} aria-hidden className={styles.ledgerChevron} />
                  <span>{section.designator}</span>
                </button>
                {/* On a phone the Provision column is hidden; its name sits under the citation. */}
                {label && <span className={styles.ledgerNarrowLabel}>{label}</span>}
              </TableCell>
              <TableCell className={`${styles.ledgerWide} px-2 py-1.5 align-baseline whitespace-normal text-[var(--color-ink-secondary)]`}>
                {label}
              </TableCell>
              <TableCell className={`${styles.ledgerWide} px-2 py-1.5 align-baseline`}>
                <span className={styles.ledgerBundles}>
                  {bundleMemberships(section.citation, bundles).map((membership) => (
                    <a
                      key={membership.bundle_id}
                      className={styles.ledgerBundle}
                      href={bundleHref(membership.bundle_id)}
                      aria-label={`${membership.bundle_title} · ${tiersLabel(membership)}`}
                      title={membershipDetail(membership)}
                    >
                      {bundleProgram(membership)}
                      <span>{tiersLabel(membership)}</span>
                    </a>
                  ))}
                </span>
              </TableCell>
              <TableCell className={`${styles.ledgerStatus} px-2 py-1.5 align-baseline whitespace-nowrap`}>
                <span className={`${styles.status} ${TONE_CLASS[section.tone]}`} data-tone={section.tone}>
                  <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT[section.tone]}`} />
                  <span className="text-[var(--color-ink-secondary)]">{section.status}</span>
                </span>
              </TableCell>
              <TableCell className={`${styles.ledgerWide} px-2 py-1.5 text-right align-baseline font-mono tabular-nums text-[var(--color-ink-muted)]`}>
                {section.runs.length}
              </TableCell>
              <TableCell className="px-0 py-1.5 text-right align-baseline whitespace-nowrap text-[var(--color-ink-muted)]">
                {relativeTime(section.lastAt, referenceMs)}
              </TableCell>
            </TableRow>
            {open && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className={styles.ledgerRunCell}>
                  <SectionRuns section={section} />
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
 * An open section, for the question "why is this not encoded yet, and what
 * is next?": whether it is encoded, what happens now with the one link to
 * act on, the failures that came back, every run as a mark, and the journey
 * for the full history.
 */
function SectionRuns({ section }: { section: LedgerSection }) {
  const brief = sectionBrief(section);
  return (
    <div className={styles.ledgerOverview}>
      <p className={styles.ledgerSummary} data-encoded={brief.encoded || undefined}>
        <strong>{brief.headline}</strong>
      </p>
      {brief.now && (
        <p className={styles.ledgerNow}>
          <span className={styles.ledgerLabel}>Now</span>
          <span>{brief.now.text}</span>
          {brief.now.link && (
            <a href={brief.now.link.url} target="_blank" rel="noreferrer">
              {brief.now.link.label}
            </a>
          )}
        </p>
      )}
      {brief.repeated.length > 0 && (
        <div className={styles.ledgerNow}>
          <span className={styles.ledgerLabel}>Keeps failing on</span>
          <ul className={styles.ledgerRepeats}>
            {brief.repeated.map((r) => (
              <li key={`${r.label}|${r.cause ?? ""}`} title={r.detail ?? undefined}>
                <span>
                  {r.label}
                  {r.cause ? ` — ${r.cause}` : ""} ({r.count} runs)
                </span>
                <a href={r.url} target="_blank" rel="noreferrer">
                  latest ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.ledgerNow}>
        <span className={styles.ledgerLabel}>Runs</span>
        <span className={styles.ledgerMarks} role="list" aria-label="Every run, oldest first">
          {brief.marks.map((mark) => (
            <a
              key={mark.id}
              role="listitem"
              href={mark.url}
              target="_blank"
              rel="noreferrer"
              className={styles.ledgerMark}
              data-tone={mark.tone}
              title={mark.title}
              aria-label={mark.title}
            />
          ))}
        </span>
        <a href={`/ops/journey?citation=${encodeURIComponent(section.citation)}`}>Full history →</a>
      </p>
    </div>
  );
}
