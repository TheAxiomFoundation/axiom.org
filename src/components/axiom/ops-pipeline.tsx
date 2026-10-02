"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import styles from "./ops-pipeline.module.css";
import {
  ageLabel,
  bottleneckStage,
  durationLabel,
  isExitStage,
  journeyHref,
  STAGE_COPY,
  type PipelineGroupView,
  type PipelineItem,
  type PipelineStage,
  type PipelineView,
  type WeeklyThroughput,
} from "@/lib/axiom/encoding-pipeline";
import type { QueuedSummary, QueueItemView } from "@/lib/axiom/encoding-queues";
import {
  CORPUS_STATUS_LABELS,
  type CorpusJurisdiction,
  type CorpusView,
} from "@/lib/axiom/corpus-releases";

/** The stages a citation moves through, in order, with a short status when nothing is stuck. */
const FLOW: Array<{ stage: PipelineStage; hint: string }> = [
  { stage: "encoding", hint: "running now" },
  { stage: "review", hint: "PR open" },
  { stage: "awaiting_sync", hint: "awaiting the index" },
  { stage: "indexed", hint: "awaiting validation" },
  { stage: "runs", hint: "tests unconfirmed" },
  { stage: "verified", hint: "passes on main" },
];

/** Where citations leave the main line, in pipeline order. */
const DROP_OUTS: PipelineStage[] = [
  "encode_failed",
  "no_pr",
  "closed",
  "merged_off_main",
  "not_indexed",
  "compile_failed",
  "tests_failing",
  "oracle_disagrees",
];

const number = (value: number) => value.toLocaleString("en-US");

/** A stage label mid-sentence: lowercase its first word, keep acronyms ("PR"). */
const inline = (label: string) =>
  label.replace(/^[A-Z](?![A-Z])/, (letter) => letter.toLowerCase());

/** A stage's citations, or one group of a breakdown. */
interface CitationListing {
  kind: "citations";
  title: string;
  description: string;
  items: PipelineItem[];
  count: number;
  newestFirst: boolean;
  /** The group's own label, which its rows need not repeat. */
  groupLabel?: string;
}

/** What the list panel shows: citations, the queue's items, or the corpus releases. */
type Listing = CitationListing | { kind: "queue" } | { kind: "corpus" };

export function OpsPipeline({
  view,
  queued,
  corpus = null,
  referenceMs,
}: {
  view: PipelineView;
  queued: QueuedSummary | null;
  corpus?: CorpusView | null;
  referenceMs: number;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottleneck = bottleneckStage(view);
  const shows = (title: string) => listing?.kind === "citations" && listing.title === title;

  // The list opens under the stage strip; bring it into view, since it may
  // open from a card further down the page.
  const show = (next: Listing) => {
    setListing(next);
    requestAnimationFrame(() => {
      const top = listRef.current?.getBoundingClientRect().top;
      if (top !== undefined && (top < 0 || top > window.innerHeight * 0.6)) {
        listRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    });
  };
  const showStage = (stage: PipelineStage) =>
    show({
      kind: "citations",
      title: STAGE_COPY[stage].label,
      description: STAGE_COPY[stage].description,
      items: view.stages[stage].items,
      count: view.stages[stage].count,
      newestFirst: isExitStage(stage),
    });
  const showGroup = (heading: string, group: PipelineGroupView, newestFirst: boolean) =>
    show({
      kind: "citations",
      title: `${heading}: ${group.label}`,
      description: "",
      items: group.items,
      count: group.count,
      newestFirst,
      groupLabel: group.label,
    });

  return (
    <section aria-labelledby="pipeline-title" className={styles.pipeline}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Pipeline</p>
          <h2 id="pipeline-title">Where every citation is</h2>
          <p className={styles.sub}>
            {number(view.citationCount)} citations · {number(view.dispatchCount)} dispatches
            {view.firstDispatchAt && ` since ${formatDay(view.firstDispatchAt)}`}
          </p>
        </div>
        {view.collectedAt && (
          <p className={styles.updated}>Updated {ageLabel(view.collectedAt, referenceMs)} ago</p>
        )}
      </header>

      {bottleneck && (
        <button
          type="button"
          className={styles.headline}
          onClick={() => showStage(bottleneck)}
        >
          <AlertTriangle size={14} aria-hidden />
          <span>
            Biggest bottleneck: <strong>{number(view.stages[bottleneck].stuck)}</strong>{" "}
            {inline(STAGE_COPY[bottleneck].label)}
          </span>
        </button>
      )}

      <ol
        className={`${styles.flow} ${corpus ? styles.flowWide : ""}`}
        aria-label="Pipeline stages"
      >
        {corpus && (
          <li>
            <button
              type="button"
              className={`${styles.tile} ${corpus.outOfSync > 0 ? styles.tileStuck : ""}`}
              aria-pressed={listing?.kind === "corpus"}
              onClick={() => show({ kind: "corpus" })}
            >
              <span className={styles.tileLabel}>Corpus</span>
              <span className={styles.tileValue}>{number(corpus.jurisdictions.length)}</span>
              <span className={styles.tileHint}>
                {corpus.outOfSync > 0 ? `${number(corpus.outOfSync)} out of sync` : "all in sync"}
              </span>
            </button>
          </li>
        )}
        <li>
          {queued ? (
            <button
              type="button"
              className={`${styles.tile} ${queued.blocked > 0 ? styles.tileStuck : ""}`}
              aria-pressed={listing?.kind === "queue"}
              onClick={() => show({ kind: "queue" })}
            >
              <span className={styles.tileLabel}>Queued</span>
              <span className={styles.tileValue}>{number(queued.pending)}</span>
              <span
                className={styles.tileHint}
                title={(queued.blocked ? queued.blockedNote?.note : queued.pausedReason) ?? undefined}
              >
                {queued.blocked > 0
                  ? `${number(queued.blocked)} blocked`
                  : queued.pausedReason
                    ? "paused"
                    : `${number(queued.inFlight)} in flight`}
              </span>
            </button>
          ) : (
            <div className={`${styles.tile} ${styles.static}`}>
              <span className={styles.tileLabel}>Queued</span>
              <span className={styles.tileValue}>—</span>
              <span className={styles.tileHint}>no queues</span>
            </div>
          )}
        </li>
        {FLOW.map(({ stage, hint }) => {
          const summary = view.stages[stage];
          const oldest = ageLabel(summary.oldestSince, referenceMs);
          const status =
            stage === "runs" && !view.compileCheckedAt && summary.count === 0
              ? "no engine sweep yet"
              : summary.stuck > 0
                ? `${number(summary.stuck)} stuck${oldest ? ` · ${oldest}` : ""}`
                : hint;
          return (
            <li key={stage}>
              <button
                type="button"
                className={`${styles.tile} ${summary.stuck > 0 ? styles.tileStuck : ""}`}
                aria-pressed={shows(STAGE_COPY[stage].label)}
                onClick={() => showStage(stage)}
              >
                <span className={styles.tileLabel}>{STAGE_COPY[stage].label}</span>
                <span className={styles.tileValue}>{number(summary.count)}</span>
                <span className={styles.tileHint}>{status}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={styles.dropouts}>
        <span className={styles.dropoutsLabel}>Dropped out</span>
        {DROP_OUTS.filter((stage) => view.stages[stage].count > 0).map((stage) => (
          <button
            key={stage}
            type="button"
            className={`${styles.dropout} ${stage === "no_pr" ? "" : styles.dropoutStuck}`}
            aria-pressed={shows(STAGE_COPY[stage].label)}
            onClick={() => showStage(stage)}
          >
            <strong>{number(view.stages[stage].count)}</strong>
            {inline(STAGE_COPY[stage].label)}
          </button>
        ))}
        {view.duplicatePrs > 0 && (
          <span className={styles.dropoutNote}>
            {number(view.duplicatePrs)} duplicate open PR{view.duplicatePrs === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {listing && (
        <div ref={listRef} className={styles.listAnchor}>
          {listing.kind === "citations" && (
            <CitationList listing={listing} referenceMs={referenceMs} onClose={() => setListing(null)} />
          )}
          {listing.kind === "queue" && queued && (
            <QueueList queued={queued} referenceMs={referenceMs} onClose={() => setListing(null)} />
          )}
          {listing.kind === "corpus" && corpus && (
            <CorpusList corpus={corpus} referenceMs={referenceMs} onClose={() => setListing(null)} />
          )}
        </div>
      )}

      <div className={styles.cards}>
        <Breakdown
          title="Why encodes fail"
          description={`${number(view.stages.encode_failed.count)} citations whose latest encode failed`}
          views={[
            { id: "step", label: "By step", groups: view.gates },
            { id: "rule", label: "By cause", groups: view.failures },
          ]}
          onOpen={(group) => showGroup("Failed", group, true)}
        />
        <Breakdown
          title="What holds PRs in review"
          description={`${number(view.stages.review.count)} citations with an open PR`}
          views={[{ id: "hold", label: "By hold", groups: view.holds }]}
          onOpen={(group) => showGroup("In review", group, false)}
        />
        <Throughput view={view} />
        <SigningApproval view={view} referenceMs={referenceMs} />
      </div>
    </section>
  );
}

/** Ranked groups of one stage, with a toggle when there is more than one way to cut it. */
function Breakdown({
  title,
  description,
  views,
  onOpen,
}: {
  title: string;
  description: string;
  views: Array<{ id: string; label: string; groups: PipelineGroupView[] }>;
  onOpen: (group: PipelineGroupView) => void;
}) {
  const [active, setActive] = useState(views[0].id);
  const current = views.find((v) => v.id === active) ?? views[0];
  const groups = current.groups.slice(0, 7);
  const max = groups[0]?.count ?? 0;
  return (
    <div className={styles.card} role="group" aria-label={title}>
      <div className={styles.cardHead}>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {views.length > 1 && (
          <div className={styles.toggle} role="group" aria-label={`${title} grouping`}>
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={v.id === current.id}
                onClick={() => setActive(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {groups.length === 0 ? (
        <p className={styles.empty}>Nothing here right now.</p>
      ) : (
        <ul className={styles.bars}>
          {groups.map((group) => (
            <li key={group.key}>
              <button type="button" className={styles.bar} onClick={() => onOpen(group)}>
                <span className={styles.barLabel} title={group.label}>
                  {group.label}
                </span>
                <span className={styles.barTrack} aria-hidden>
                  <span
                    className={styles.barFill}
                    style={{ width: `${Math.max(2, (group.count / max) * 100)}%` }}
                  />
                </span>
                <span className={styles.barCount}>{number(group.count)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The panel every list opens in, under the stage strip. */
function ListPanel({
  title,
  label,
  count,
  description,
  onClose,
  children,
}: {
  title: string;
  label: string;
  count: number;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.list} role="region" aria-label={label}>
      <div className={styles.listHead}>
        <div>
          <h3>
            {title}
            <span className={styles.listCount}>{number(count)}</span>
          </h3>
          {description && <p>{description}</p>}
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close list">
          <X size={16} aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}

function CitationList({
  listing,
  referenceMs,
  onClose,
}: {
  listing: CitationListing;
  referenceMs: number;
  onClose: () => void;
}) {
  const shown = listing.items.length;
  return (
    <ListPanel
      title={listing.title}
      label={`${listing.title} citations`}
      count={listing.count}
      description={listing.description}
      onClose={onClose}
    >
      {shown === 0 ? (
        <p className={styles.empty}>Nothing here right now.</p>
      ) : (
        <>
          {shown < listing.count && (
            <p className={styles.listNote}>
              {listing.newestFirst ? "Latest" : "Oldest"} {number(shown)} of{" "}
              {number(listing.count)}
            </p>
          )}
          <ul className={styles.items}>
            {listing.items.map((item) => (
              <ItemRow
                key={item.citation}
                item={item}
                referenceMs={referenceMs}
                groupLabel={listing.groupLabel}
              />
            ))}
          </ul>
        </>
      )}
    </ListPanel>
  );
}

/** One row of any list: what it is, why it is there, and where to look. */
function Row({
  title,
  href,
  why,
  detail,
  age,
  links,
  flags,
}: {
  title: string;
  href: string | null;
  why: string | null;
  detail: string | null;
  age: string | null;
  links: Array<{ label: string; href: string }>;
  flags: string | null;
}) {
  return (
    <li className={styles.item}>
      <div className={styles.itemMain}>
        {href ? (
          <a href={href} className={styles.citation}>
            {title}
          </a>
        ) : (
          <span className={styles.rowTitle}>{title}</span>
        )}
        {why && <span className={styles.itemWhy}>{why}</span>}
        {detail && (
          <span className={styles.itemDetail} title={detail}>
            {detail}
          </span>
        )}
      </div>
      <div className={styles.itemSide}>
        <span className={styles.age}>{age}</span>
        {links.length > 0 && (
          <span className={styles.itemLinks}>
            {links.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </span>
        )}
        {flags && <span className={styles.itemFlags}>{flags}</span>}
      </div>
    </li>
  );
}

function ItemRow({
  item,
  referenceMs,
  groupLabel,
}: {
  item: PipelineItem;
  referenceMs: number;
  groupLabel?: string;
}) {
  // Each row says why it is here, minus whatever the open group already says.
  const why = [item.stage === "encode_failed" ? item.gate : null, item.reason]
    .filter((part): part is string => !!part && part !== groupLabel)
    .join(" · ");
  const flags = [
    item.dispatches > 1 ? `${item.dispatches} dispatches` : null,
    item.openPrs > 1 ? `${item.openPrs} open PRs` : null,
    item.reachedIndex && !["indexed", "runs", "verified"].includes(item.stage)
      ? "an earlier version is in the index"
      : null,
    ["runs", "verified", "tests_failing"].includes(item.stage) ? item.oracle : null,
  ].filter(Boolean);
  return (
    <Row
      title={item.citation}
      href={journeyHref(item.citation)}
      why={why || null}
      detail={item.detail}
      age={ageLabel(item.since, referenceMs)}
      links={[
        item.prUrl
          ? { label: item.prLabel ?? "PR", href: item.prUrl }
          : { label: "run", href: item.runUrl },
        ...(item.testsRunUrl ? [{ label: "validation", href: item.testsRunUrl }] : []),
      ]}
      flags={flags.length > 0 ? flags.join(" · ") : null}
    />
  );
}

const QUEUE_GROUPS: Array<{ state: QueueItemView["state"]; title: string }> = [
  { state: "blocked", title: "Needs a person" },
  { state: "dispatched", title: "Run open" },
  { state: "retrying", title: "Retrying after a failed run" },
];

/** The dispatcher queues' items: what needs a person, what is running, what will retry. */
function QueueList({
  queued,
  referenceMs,
  onClose,
}: {
  queued: QueuedSummary;
  referenceMs: number;
  onClose: () => void;
}) {
  const totals: Record<QueueItemView["state"], number> = {
    blocked: queued.blocked,
    dispatched: queued.inFlight,
    retrying: queued.items.filter((item) => item.state === "retrying").length,
  };
  return (
    <ListPanel
      title="Queued"
      label="Queued items"
      count={queued.pending}
      description={[
        queued.pausedReason
          ? `Paused${queued.pausedReason === "Paused" ? "" : `: ${queued.pausedReason}`}; nothing new is dispatched.`
          : null,
        "Each item is sent to the targeted encode. A failed run is retried once; then the item waits for a person.",
      ]
        .filter(Boolean)
        .join(" ")}
      onClose={onClose}
    >
      {QUEUE_GROUPS.map(({ state, title }) => {
        const items = queued.items.filter((item) => item.state === state);
        if (items.length === 0) return null;
        // Items that share a reason sit under it once, in first-seen order.
        const clusters = new Map<string, QueueItemView[]>();
        for (const item of items) {
          const why = item.why ?? "";
          clusters.set(why, [...(clusters.get(why) ?? []), item]);
        }
        return (
          <section key={state} className={styles.listGroup} aria-label={title}>
            <h4>
              {title}
              <span className={styles.listCount}>{number(Math.max(totals[state], items.length))}</span>
            </h4>
            {[...clusters].map(([why, members]) => (
              <div key={why} className={styles.cluster}>
                {why && (
                  <p className={styles.clusterWhy}>
                    {why}
                    {members.length > 1 && (
                      <span className={styles.listCount}>{number(members.length)}</span>
                    )}
                  </p>
                )}
                <ul className={styles.items}>
                  {members.map((item) => (
                    <Row
                      key={`${item.queueId}/${item.citation}`}
                      title={item.citation}
                      href={journeyHref(item.citation)}
                      why={item.label}
                      detail={null}
                      age={ageLabel(item.lastAt, referenceMs)}
                      links={
                        item.prUrl
                          ? [{ label: "PR", href: item.prUrl }]
                          : item.runUrl
                            ? [{ label: "run", href: item.runUrl }]
                            : []
                      }
                      flags={item.attempts > 1 ? `${item.attempts} runs` : null}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {queued.notStarted.length > 0 && (
        <p className={styles.listNote}>
          Not started yet:{" "}
          {queued.notStarted
            .map(({ jurisdiction, count }) => `${jurisdiction} ${number(count)}`)
            .join(" · ")}
        </p>
      )}
    </ListPanel>
  );
}

/** A release name without its jurisdiction prefix: "us-rulespec-2026-09-14-x" reads "2026-09-14-x". */
function shortRelease(name: string, jurisdiction: string): string {
  return name.startsWith(`${jurisdiction}-rulespec-`)
    ? name.slice(jurisdiction.length + 10)
    : name.startsWith(`${jurisdiction}-`)
      ? name.slice(jurisdiction.length + 1)
      : name;
}

function corpusDetail(row: CorpusJurisdiction): string {
  const short = (name: string) => shortRelease(name, row.jurisdiction);
  return [
    row.serving ? `serving ${short(row.serving.release)}` : "serving nothing",
    row.newest.release !== row.serving?.release
      ? `newest ${short(row.newest.release)} (${number(row.newest.scopes)} scopes)`
      : null,
    row.encoder
      ? `encoder reads ${short(row.encoder.release)}${row.encoder.registered ? "" : " (not a registered release)"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Out-of-sync statuses, most actionable first. */
const CORPUS_GROUPS: Array<Exclude<CorpusJurisdiction["status"], "current">> = [
  "newer_not_active",
  "encoder_behind",
  "encoder_off",
  "not_serving",
];

/** Signed corpus releases per jurisdiction: what serves, what is newest, what the encoder reads. */
function CorpusList({
  corpus,
  referenceMs,
  onClose,
}: {
  corpus: CorpusView;
  referenceMs: number;
  onClose: () => void;
}) {
  const current = corpus.jurisdictions.filter((row) => row.status === "current");
  const { openPrs, lastPublish } = corpus;
  return (
    <ListPanel
      title="Corpus"
      label="Corpus releases"
      count={corpus.jurisdictions.length}
      description="Per jurisdiction: the signed corpus release the site serves, the newest one signed, and the one its encoder reads. axiom-corpus's publish workflow signs a release; a person activates it."
      onClose={onClose}
    >
      {(openPrs || lastPublish) && (
        <p className={styles.listNote}>
          {openPrs && (
            <a href={openPrs.url} target="_blank" rel="noreferrer">
              {number(openPrs.count)} open PR{openPrs.count === 1 ? "" : "s"} in axiom-corpus
              {openPrs.oldestAt && `, oldest ${ageLabel(openPrs.oldestAt, referenceMs)}`}
            </a>
          )}
          {openPrs && lastPublish && " · "}
          {lastPublish && (
            <a href={lastPublish.url} target="_blank" rel="noreferrer">
              Last publish {lastPublish.conclusion === "success" ? "succeeded" : "failed"}{" "}
              {ageLabel(lastPublish.at, referenceMs)} ago
            </a>
          )}
        </p>
      )}
      {CORPUS_GROUPS.map((status) => {
        // Most recently signed first: where work is happening now.
        const rows = corpus.jurisdictions
          .filter((row) => row.status === status)
          .sort((a, b) => b.newest.signedAt.localeCompare(a.newest.signedAt));
        if (rows.length === 0) return null;
        const title = CORPUS_STATUS_LABELS[status];
        return (
          <section key={status} className={styles.listGroup} aria-label={title}>
            <h4>
              {title}
              <span className={styles.listCount}>{number(rows.length)}</span>
            </h4>
            <ul className={styles.items}>
              {rows.map((row) => (
                <Row
                  key={row.jurisdiction}
                  title={`${row.name} · ${row.jurisdiction}`}
                  href={null}
                  why={corpusDetail(row)}
                  detail={null}
                  age={ageLabel(row.since, referenceMs)}
                  links={
                    row.encoder
                      ? [
                          {
                            label: "pin",
                            href: `https://github.com/TheAxiomFoundation/${row.encoder.repo}/blob/main/.axiom/toolchain.toml`,
                          },
                        ]
                      : []
                  }
                  flags={null}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {current.length > 0 && (
        <p className={styles.listNote}>
          Up to date: {current.map((row) => row.name).join(", ")}
        </p>
      )}
    </ListPanel>
  );
}

/** The production-signing approval: a human gate every encode waits at. */
function SigningApproval({ view, referenceMs }: { view: PipelineView; referenceMs: number }) {
  const { approval } = view;
  const waitingAge = ageLabel(approval.oldestWaitingSince, referenceMs);
  const max = approval.cancellations[0]?.count ?? 0;
  return (
    <div className={styles.card} role="group" aria-label="Signing approval">
      <div className={styles.cardHead}>
        <div>
          <h3>Signing approval</h3>
          <p>Each encode waits for a person to approve production signing.</p>
        </div>
      </div>
      <div className={styles.stats}>
        <div className={styles.statBlock}>
          <span className={styles.statValue}>
            {approval.approved.p90Ms !== null ? durationLabel(approval.approved.p90Ms) : "—"}
          </span>
          <span className={styles.statLabel}>
            slowest 10% of approvals, last 14 days
            {approval.approved.medianMs !== null &&
              ` (half within ${durationLabel(approval.approved.medianMs)})`}
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={`${styles.statValue} ${approval.waitingNow > 0 ? styles.warn : ""}`}>
            {number(approval.waitingNow)}
          </span>
          <span className={styles.statLabel}>
            waiting now{waitingAge && approval.waitingNow > 0 ? `, oldest ${waitingAge}` : ""}
          </span>
        </div>
      </div>
      {approval.cancellations.length > 0 && (
        <>
          <p className={styles.miniLabel}>Cancelled runs</p>
          <ul className={styles.bars}>
            {approval.cancellations.map((entry) => (
              <li key={entry.key}>
                <div className={`${styles.bar} ${styles.barStatic}`}>
                  <span className={styles.barLabel} title={entry.label}>
                    {entry.label
                      .replace(/^Cancelled /, "")
                      .replace(/^\((.*)\)$/, "$1")
                      .replace(/^(.)/, (c) => c.toUpperCase())}
                  </span>
                  <span className={styles.barTrack} aria-hidden>
                    <span
                      className={styles.barFill}
                      style={{ width: `${Math.max(2, (entry.count / max) * 100)}%` }}
                    />
                  </span>
                  <span className={styles.barCount}>{number(entry.count)}</span>
                </div>
              </li>
            ))}
          </ul>
          {approval.cancelledWhileWaiting.count > 0 && (
            <p className={styles.footnote}>
              {number(approval.cancelledWhileWaiting.overAnHour)} of{" "}
              {number(approval.cancelledWhileWaiting.count)} waited over an hour before being
              cancelled.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const SERIES: Array<{ key: keyof Omit<WeeklyThroughput, "weekStart">; label: string }> = [
  { key: "dispatched", label: "Dispatched" },
  { key: "encoded", label: "Encoded" },
  { key: "merged", label: "Merged" },
];

const CHART = { width: 560, height: 200, left: 34, right: 8, top: 18, bottom: 26 };

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= value / 2)! * magnitude;
  return Math.ceil(value / step) * step;
}

function columnPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

function Throughput({ view }: { view: PipelineView }) {
  const [hover, setHover] = useState<number | null>(null);
  const weeks = view.weekly;
  const geometry = useMemo(() => {
    const max = niceMax(Math.max(1, ...weeks.map((w) => w.dispatched)));
    const plotWidth = CHART.width - CHART.left - CHART.right;
    const plotHeight = CHART.height - CHART.top - CHART.bottom;
    const band = plotWidth / Math.max(1, weeks.length);
    const bar = Math.min(18, (band - 14) / SERIES.length - 2);
    const scale = (value: number) => (value / max) * plotHeight;
    return { max, plotHeight, band, bar, scale };
  }, [weeks]);
  const rate = view.recentFailureRate;
  const last = weeks.length - 1;

  return (
    <div className={styles.card} role="group" aria-label="Weekly throughput">
      <div className={styles.cardHead}>
        <div>
          <h3>Weekly throughput</h3>
          <p>Dispatched, encoded, and merged, by week.</p>
        </div>
      </div>
      {rate && (
        <div className={styles.stats}>
          <div className={styles.statBlock}>
            <span className={styles.statValue}>
              {Math.round((rate.failed / rate.finished) * 100)}%
            </span>
            <span className={styles.statLabel}>
              of runs failed, last 14 days ({number(rate.failed)} of {number(rate.finished)})
            </span>
          </div>
        </div>
      )}
      <ul className={styles.legend}>
        {SERIES.map((series, i) => (
          <li key={series.key}>
            <span className={styles.swatch} data-series={i + 1} aria-hidden />
            {series.label}
          </li>
        ))}
      </ul>
      <div className={styles.chartWrap}>
        <svg
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          className={styles.chart}
          role="img"
          aria-label="Weekly dispatches, encodes, and merges over the last eight weeks"
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((fraction) => {
            const y = CHART.top + geometry.plotHeight * (1 - fraction);
            return (
              <g key={fraction}>
                <line
                  x1={CHART.left}
                  x2={CHART.width - CHART.right}
                  y1={y}
                  y2={y}
                  className={styles.grid}
                />
                <text x={CHART.left - 6} y={y + 3} className={styles.tick} textAnchor="end">
                  {number(geometry.max * fraction)}
                </text>
              </g>
            );
          })}
          {weeks.map((week, w) => {
            const bandX = CHART.left + w * geometry.band;
            const groupWidth = SERIES.length * geometry.bar + (SERIES.length - 1) * 2;
            const startX = bandX + (geometry.band - groupWidth) / 2;
            const baseline = CHART.top + geometry.plotHeight;
            return (
              <g key={week.weekStart}>
                <rect
                  x={bandX}
                  y={CHART.top}
                  width={geometry.band}
                  height={geometry.plotHeight}
                  className={hover === w ? styles.bandHover : styles.band}
                  onMouseEnter={() => setHover(w)}
                />
                {SERIES.map((series, i) => {
                  const value = week[series.key];
                  const height = geometry.scale(value);
                  const x = startX + i * (geometry.bar + 2);
                  return (
                    <g key={series.key} pointerEvents="none">
                      {value > 0 && (
                        <path
                          d={columnPath(x, baseline - height, geometry.bar, height)}
                          className={styles.column}
                          data-series={i + 1}
                        />
                      )}
                      {w === last && (
                        <text
                          x={x + geometry.bar / 2}
                          y={baseline - height - 4}
                          textAnchor="middle"
                          className={styles.capLabel}
                        >
                          {number(value)}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text
                  x={bandX + geometry.band / 2}
                  y={CHART.height - 8}
                  textAnchor="middle"
                  className={styles.tick}
                >
                  {formatWeek(week.weekStart)}
                </text>
              </g>
            );
          })}
        </svg>
        {hover !== null && weeks[hover] && (
          <div
            className={styles.tooltip}
            style={{
              left: `${((CHART.left + (hover + 0.5) * geometry.band) / CHART.width) * 100}%`,
            }}
            role="status"
          >
            <strong>Week of {formatWeek(weeks[hover].weekStart)}</strong>
            {SERIES.map((series, i) => (
              <span key={series.key}>
                <span className={styles.swatch} data-series={i + 1} aria-hidden />
                {series.label} <b>{number(weeks[hover][series.key])}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <details className={styles.table}>
        <summary>Table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              {SERIES.map((series) => (
                <th key={series.key} scope="col">
                  {series.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.weekStart}>
                <th scope="row">{formatWeek(week.weekStart)}</th>
                {SERIES.map((series) => (
                  <td key={series.key}>{number(week[series.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function formatWeek(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

