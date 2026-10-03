"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import type {
  AttemptRate,
  PipelineInsights,
  PipelineScope,
  RunStats,
  ScopeOption,
  VersionBin,
} from "@/lib/axiom/encoding-pipeline-insights";
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

const NO_SCOPES = { roots: [], within: [] };

export function OpsPipeline({
  view,
  insights = null,
  scope = null,
  scopes = NO_SCOPES,
  queued,
  corpus = null,
  referenceMs,
}: {
  view: PipelineView;
  insights?: PipelineInsights | null;
  /** The jurisdictions the view covers; null for all. */
  scope?: PipelineScope | null;
  scopes?: { roots: ScopeOption[]; within: ScopeOption[] };
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

      {scopes.roots.length > 1 && <ScopeBar scope={scope} scopes={scopes} />}
      {insights && <Funnel funnel={insights.funnel} />}

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
          views={[
            { id: "hold", label: "By hold", groups: view.holds },
            ...(insights?.checkErrors.length
              ? [{ id: "error", label: "By error", groups: insights.checkErrors }]
              : []),
          ]}
          onOpen={(group) => showGroup("In review", group, false)}
        />
        {insights && <RunsCard runs={insights.runs} />}
        {insights && <VersionsCard bins={insights.versions} />}
        <SigningApproval view={view} referenceMs={referenceMs} />
        <Throughput view={view} />
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
  const detail = item.detail
    ?.split(" · ")
    .filter((part) => part !== groupLabel)
    .join(" · ");
  return (
    <Row
      title={item.citation}
      href={journeyHref(item.citation)}
      why={why || null}
      detail={detail || null}
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

/** A URL for a scope, landing back on the pipeline section. */
function scopeHref(pathname: string, scope: PipelineScope | null): string {
  if (!scope) return `${pathname}#pipeline-title`;
  const query = new URLSearchParams({ j: scope.jurisdiction, ...(scope.only ? { only: "1" } : {}) });
  return `${pathname}?${query}#pipeline-title`;
}

/** Narrow every tile, card, and list to one jurisdiction. */
function ScopeBar({
  scope,
  scopes,
}: {
  scope: PipelineScope | null;
  scopes: { roots: ScopeOption[]; within: ScopeOption[] };
}) {
  const pathname = usePathname() ?? "/ops";
  const router = useRouter();
  const root = scope?.jurisdiction.split("-")[0] ?? null;
  const withinValue = scope && scope.jurisdiction !== root ? scope.jurisdiction : scope?.only ? `${root}:only` : "";
  return (
    <nav className={styles.scopes} aria-label="Jurisdiction">
      <Link href={scopeHref(pathname, null)} className={styles.scope} aria-current={!scope ? "page" : undefined}>
        All
      </Link>
      {scopes.roots.map((option) => (
        <Link
          key={option.jurisdiction}
          href={scopeHref(pathname, option)}
          className={styles.scope}
          aria-current={root === option.jurisdiction ? "page" : undefined}
        >
          {option.label}
          <span className={styles.scopeCount}>{number(option.citations)}</span>
        </Link>
      ))}
      {scopes.within.length > 0 && root && (
        <select
          className={styles.scopeSelect}
          aria-label={`Within ${root}`}
          value={withinValue}
          onChange={(event) => {
            const value = event.target.value;
            const option = scopes.within.find((o) => (o.only ? `${o.jurisdiction}:only` : o.jurisdiction) === value);
            router.push(scopeHref(pathname, option ?? { jurisdiction: root, only: false }));
          }}
        >
          <option value="">All of {root}</option>
          {scopes.within.map((option) => (
            <option
              key={`${option.jurisdiction}${option.only ? ":only" : ""}`}
              value={option.only ? `${option.jurisdiction}:only` : option.jurisdiction}
            >
              {option.label} ({number(option.citations)})
            </option>
          ))}
        </select>
      )}
    </nav>
  );
}

/** How many citations ever got how far, across all their dispatches. */
function Funnel({ funnel }: { funnel: PipelineInsights["funnel"] }) {
  const steps = [
    { label: "citations", value: funnel.citations },
    { label: "encoded", value: funnel.encoded },
    { label: "merged", value: funnel.merged },
    { label: "into main", value: funnel.mergedMain },
    { label: "passing on main", value: funnel.passing },
  ];
  return (
    <div className={styles.funnel}>
      <span className={styles.funnelLabel}>Ever reached</span>
      <ol aria-label="Citations that ever reached each point">
        {steps.map((step) => (
          <li key={step.label}>
            <strong>{number(step.value)}</strong> {step.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Success rates as bars on one 0–100% scale. */
function RateBars({ rows }: { rows: Array<{ key: string; label: string; rate: AttemptRate }> }) {
  return (
    <ul className={styles.bars}>
      {rows.map(({ key, label, rate }) => (
        <li key={key}>
          <div
            className={`${styles.bar} ${styles.barStatic} ${styles.rateBar}`}
            title={`${number(rate.success)} of ${number(rate.total)} succeeded`}
          >
            <span className={styles.barLabel}>
              {label}
              <span className={styles.barNote}> · {number(rate.total)}</span>
            </span>
            <span className={styles.barTrack} aria-hidden>
              <span
                className={styles.barFill}
                style={{ width: `${Math.max(1, percent(rate.success, rate.total))}%` }}
              />
            </span>
            <span className={styles.barCount}>{percent(rate.success, rate.total)}%</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What each dispatch yields: first attempts, retries, the citations re-run most, and cost. */
function RunsCard({ runs }: { runs: RunStats }) {
  const { firstAttempt, cost } = runs;
  return (
    <div className={styles.card} role="group" aria-label="Runs and retries">
      <div className={styles.cardHead}>
        <div>
          <h3>Runs and retries</h3>
          <p>Finished runs, not counting cancellations.</p>
        </div>
      </div>
      <div className={styles.stats}>
        <div className={styles.statBlock}>
          <span className={styles.statValue}>{percent(firstAttempt.success, firstAttempt.total)}%</span>
          <span className={styles.statLabel}>
            of citations encode on the first attempt ({number(firstAttempt.success)} of{" "}
            {number(firstAttempt.total)})
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statValue}>
            {cost.recorded > 0 ? `${percent(cost.onFailures, cost.total)}%` : "—"}
          </span>
          <span className={styles.statLabel}>
            {cost.recorded > 0
              ? `of recorded cost went to failed runs ($${cost.onFailures.toFixed(0)} of $${cost.total.toFixed(0)}; ${number(cost.recorded)} of ${number(cost.finished)} runs record a cost)`
              : "No run records its cost yet"}
          </span>
        </div>
      </div>
      {runs.byAttempt.length > 0 && (
        <>
          <p className={styles.miniLabel}>Success by attempt</p>
          <RateBars
            rows={runs.byAttempt.map((rate) => ({ key: rate.label, label: `${rate.label} attempt`, rate }))}
          />
        </>
      )}
      {runs.mostDispatched.length > 0 && (
        <>
          <p className={styles.miniLabel}>Dispatched most</p>
          <ul className={styles.ranked}>
            {runs.mostDispatched.map((entry) => (
              <li key={entry.citation}>
                <a href={journeyHref(entry.citation)} className={styles.citation}>
                  {entry.citation}
                </a>
                <span>
                  {number(entry.dispatches)} dispatches · {number(entry.successes)} encoded ·{" "}
                  {number(entry.merged)} merged
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Success across encoder releases, pooled so each bar has enough runs to compare. */
function VersionsCard({ bins }: { bins: VersionBin[] }) {
  return (
    <div className={styles.card} role="group" aria-label="By encoder version">
      <div className={styles.cardHead}>
        <div>
          <h3>By encoder version</h3>
          <p>Success of finished runs. Consecutive versions are pooled to at least 10 runs; newest last.</p>
        </div>
      </div>
      {bins.length === 0 ? (
        <p className={styles.empty}>No encoder versions recorded yet.</p>
      ) : (
        <RateBars
          rows={bins.map((bin) => ({
            key: `${bin.from}-${bin.to}`,
            label: bin.from === bin.to ? bin.from : `${bin.from} – ${bin.to.split(".").at(-1)}`,
            rate: { label: bin.to, success: bin.successes, total: bin.runs },
          }))}
        />
      )}
    </div>
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

