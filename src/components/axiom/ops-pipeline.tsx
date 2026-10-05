"use client";

import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import styles from "./ops-pipeline.module.css";
import {
  ageLabel,
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
import { jurisdictionName } from "@/lib/axiom/jurisdiction-names";
import {
  dispatchFlow,
  type FlowGate,
  type FlowSegment,
  type EncodeParts,
  type RunRow,
  type StepTimes,
  type TestsParts,
  type TimedStep,
  type TriesUsed,
} from "@/lib/axiom/encoding-pipeline-runs";

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
type Listing =
  | CitationListing
  | { kind: "queue" }
  | { kind: "corpus" }
  | { kind: "runs"; title: string; rows: RunRow[] };

type DetailsTab = "flow" | "log" | "cards";

const DETAILS_TABS: Array<{ id: DetailsTab; label: string }> = [
  { id: "flow", label: "Flow" },
  { id: "log", label: "Run log" },
  { id: "cards", label: "Breakdowns" },
];

/** The /ops/runs query for a scope. */
function scopeQuery(scope: PipelineScope | null): string {
  if (!scope) return "";
  return `?${new URLSearchParams({ j: scope.jurisdiction, ...(scope.only ? { only: "1" } : {}) })}`;
}

const NO_SCOPES = { roots: [], within: [] };

export function OpsPipeline({
  view,
  insights = null,
  scope = null,
  scopes = NO_SCOPES,
  queued,
  corpus = null,
  flow = null,
  times = null,
  parts = null,
  testParts = null,
  referenceMs,
}: {
  view: PipelineView;
  insights?: PipelineInsights | null;
  /** The jurisdictions the view covers; null for all. */
  scope?: PipelineScope | null;
  scopes?: { roots: ScopeOption[]; within: ScopeOption[] };
  queued: QueuedSummary | null;
  corpus?: CorpusView | null;
  /** Every dispatch's path through the gates, counts only; rows load on demand. */
  flow?: FlowGate[] | null;
  /** How long each of the flow's gates takes. */
  times?: StepTimes[] | null;
  /** The encode run's parts and the tries its encode loop used. */
  parts?: EncodeParts | null;
  /** The tests on main's parts and how the first ones ended. */
  testParts?: TestsParts | null;
  referenceMs: number;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>(flow ? "flow" : "cards");
  const runsRequest = useRef<Promise<RunRow[]> | null>(null);
  // Every dispatch in the scope, fetched once when the run log or a flow
  // segment first needs it.
  const loadRuns = useCallback(() => {
    runsRequest.current ??= fetch(`/ops/runs${scopeQuery(scope)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`runs: ${response.status}`);
        return response.json() as Promise<{ rows: RunRow[] }>;
      })
      .then((body) => body.rows)
      .catch((error: unknown) => {
        runsRequest.current = null;
        throw error;
      });
    return runsRequest.current;
  }, [scope]);
  const openSegment = (gate: FlowGate, segment: FlowSegment) =>
    loadRuns()
      .then((rows) => {
        const ids = new Set(
          dispatchFlow(rows)
            .find((g) => g.key === gate.key)
            ?.segments.find((s) => s.key === segment.key)?.ids ?? []
        );
        show({ kind: "runs", title: `${gate.label}: ${segment.label}`, rows: rows.filter((r) => ids.has(r.id)) });
      })
      .catch(() => undefined);
  const listRef = useRef<HTMLDivElement>(null);
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

  // The largest piles of stuck citations, wherever they sit: failed
  // encodes by the step that stopped them, PRs by what holds them, and the
  // ways out after a merge.
  const blockers: Blocker[] = [
    ...view.gates.map((group) => ({
      key: `gate:${group.key}`,
      label: group.label,
      where: "Encode",
      count: group.count,
      open: () => showGroup("Failed", group, true),
    })),
    ...view.holds.map((group) => ({
      key: `hold:${group.key}`,
      label: group.label,
      where: "Review",
      count: group.count,
      open: () => showGroup("In review", group, false),
    })),
    ...BLOCKER_STAGES.filter(({ stage }) => view.stages[stage].count > 0).map(({ stage, where }) => ({
      key: `stage:${stage}`,
      label: STAGE_COPY[stage].label,
      where,
      count: view.stages[stage].count,
      open: () => showStage(stage),
    })),
  ]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_BLOCKERS);

  return (
    <section aria-labelledby="pipeline-title" className={styles.pipeline}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Pipeline</p>
          <h2 id="pipeline-title">Where every citation is</h2>
          <p className={styles.sub}>
            {number(view.citationCount)} citations
            {view.firstDispatchAt && ` since ${formatDay(view.firstDispatchAt)}`}
            {view.collectedAt && ` · updated ${ageLabel(view.collectedAt, referenceMs)} ago`}
          </p>
        </div>
      </header>

      {scopes.roots.length > 1 && <ScopeBar scope={scope} scopes={scopes} />}

      {insights && (
        <SummaryFunnel
          funnel={insights.funnel}
          view={view}
          queued={queued}
          isOpen={shows}
          onStage={showStage}
          onQueue={() => show({ kind: "queue" })}
        />
      )}

      <div className={styles.summaryRow}>
        <TopBlockers blockers={blockers} />
        <TrendRows weeks={view.weekly} />
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
          {listing.kind === "runs" && (
            <RunList title={listing.title} rows={listing.rows} referenceMs={referenceMs} onClose={() => setListing(null)} />
          )}
        </div>
      )}

      <div className={styles.detailsHead}>
        <h3 id="pipeline-details-title">Details</h3>
      </div>

      <div id="pipeline-details" className={styles.details} aria-labelledby="pipeline-details-title">
          {flow && (
            <div className={styles.tabs} role="tablist" aria-label="Details view">
              {DETAILS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={detailsTab === tab.id}
                  className={styles.tab}
                  onClick={() => setDetailsTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          {flow && detailsTab === "flow" && <FlowView gates={flow} times={times} parts={parts} testParts={testParts} onOpen={openSegment} />}
          {flow && detailsTab === "log" && <RunLog load={loadRuns} referenceMs={referenceMs} />}
          {detailsTab === "cards" && (
          <>
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
          </>
          )}
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
          aria-label={`Within ${jurisdictionName(root)}`}
          value={withinValue}
          onChange={(event) => {
            const value = event.target.value;
            const option = scopes.within.find((o) => (o.only ? `${o.jurisdiction}:only` : o.jurisdiction) === value);
            router.push(scopeHref(pathname, option ?? { jurisdiction: root, only: false }));
          }}
        >
          <option value="">
            All ({number(scopes.roots.find((o) => o.jurisdiction === root)?.citations ?? 0)})
          </option>
          {scopes.within
            .filter((option) => option.only)
            .map((option) => (
              <option key={`${option.jurisdiction}:only`} value={`${option.jurisdiction}:only`}>
                {option.label} ({number(option.citations)})
              </option>
            ))}
          <optgroup label={root === "us" ? "States" : "Regions"}>
            {scopes.within
              .filter((option) => !option.only)
              .map((option) => (
                <option key={option.jurisdiction} value={option.jurisdiction}>
                  {option.label} ({number(option.citations)})
                </option>
              ))}
          </optgroup>
        </select>
      )}
    </nav>
  );
}

/** Where the stuck citations sit between two funnel steps, in a few words. */
const GAP_LABELS: Partial<Record<PipelineStage, string>> = {
  encoding: "running",
  encode_failed: "failed",
  review: "in review",
  no_pr: "no PR",
  closed: "closed",
  merged_off_main: "off main",
  awaiting_sync: "awaiting index",
  not_indexed: "not in index",
  indexed: "awaiting tests",
  runs: "tests unconfirmed",
  compile_failed: "compile fails",
  tests_failing: "tests fail",
  oracle_disagrees: "oracle disagrees",
};

/** The stages that sit between each pair of funnel steps. */
const GAPS: PipelineStage[][] = [
  ["encode_failed", "encoding"],
  ["review", "no_pr", "closed"],
  ["merged_off_main"],
  ["not_indexed", "awaiting_sync", "indexed", "runs", "compile_failed", "tests_failing", "oracle_disagrees"],
];

/**
 * How far citations ever got, as five large numbers, with the citations
 * stuck now between each pair of steps. A chip opens its citations.
 */
function SummaryFunnel({
  funnel,
  view,
  queued,
  isOpen,
  onStage,
  onQueue,
}: {
  funnel: PipelineInsights["funnel"];
  view: PipelineView;
  queued: QueuedSummary | null;
  isOpen: (title: string) => boolean;
  onStage: (stage: PipelineStage) => void;
  onQueue: () => void;
}) {
  const steps = [
    { label: "citations", value: funnel.citations },
    { label: "encoded", value: funnel.encoded },
    { label: "merged", value: funnel.merged },
    { label: "in main", value: funnel.mergedMain },
    { label: "tests pass", value: funnel.passing },
  ];
  return (
    <div className={styles.summaryFunnel}>
      <div className={styles.summaryFunnelHead}>
        <span className={styles.miniLabel}>Citations: how far each got</span>
        <Explain label="Citations: how far each got">
          Each number counts citations, not runs. A citation counts at a step if any of its runs got there, even if
          a later run failed. The chips show where the rest are now; click one to list them. The Flow tab counts
          runs.
        </Explain>
        {queued && queued.pending > 0 && (
          <button type="button" className={styles.gapChip} onClick={onQueue}>
            <strong>{number(queued.pending)}</strong> queued
          </button>
        )}
      </div>
      <ol className={styles.funnelSteps} aria-label="How far each citation got">
        {steps.map((step, index) => (
          <li key={step.label} className={styles.funnelStep}>
            <span className={styles.funnelValue}>{number(step.value)}</span>
            <span className={styles.funnelName}>{step.label}</span>
            {index < GAPS.length && (
              <span className={styles.funnelGap}>
                <span className={styles.funnelArrow} aria-hidden>
                  →
                </span>
                {GAPS[index]
                  .filter((stage) => view.stages[stage].count > 0)
                  .map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      className={`${styles.gapChip} ${isExitStage(stage) || view.stages[stage].stuck > 0 ? styles.gapChipStuck : ""}`}
                      aria-pressed={isOpen(STAGE_COPY[stage].label)}
                      title={STAGE_COPY[stage].description}
                      onClick={() => onStage(stage)}
                    >
                      <strong>{number(view.stages[stage].count)}</strong> {GAP_LABELS[stage]}
                    </button>
                  ))}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface Blocker {
  key: string;
  label: string;
  /** Where in the pipeline it holds citations. */
  where: string;
  count: number;
  open: () => void;
}

const TOP_BLOCKERS = 3;

/** Ways out after a merge, ranked against encode failures and review holds. */
const BLOCKER_STAGES: Array<{ stage: PipelineStage; where: string }> = [
  { stage: "no_pr", where: "Review" },
  { stage: "closed", where: "Review" },
  { stage: "merged_off_main", where: "Merge" },
  { stage: "not_indexed", where: "Index" },
  { stage: "compile_failed", where: "Main" },
  { stage: "tests_failing", where: "Main" },
  { stage: "oracle_disagrees", where: "Main" },
];

/** The largest piles of stuck citations; each opens its citations. */
function TopBlockers({ blockers }: { blockers: Blocker[] }) {
  return (
    <div className={styles.summaryCard} role="group" aria-label="Top blockers">
      <div className={styles.cardHead}>
        <h3 className={styles.miniLabel}>Top blockers</h3>
        <Explain label="Top blockers">
          The biggest groups of stuck citations, and the step that holds them. Click one to list its citations.
        </Explain>
      </div>
      {blockers.length === 0 ? (
        <p className={styles.empty}>Nothing is stuck.</p>
      ) : (
        <ol className={styles.blockers}>
          {blockers.map((blocker) => (
            <li key={blocker.key}>
              <button type="button" className={styles.blocker} onClick={blocker.open}>
                <span className={styles.blockerWhere}>{blocker.where}</span>
                <span className={styles.blockerLabel} title={blocker.label}>
                  {blocker.label}
                </span>
                <span className={styles.blockerCount}>{number(blocker.count)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Each series' last eight weeks as a row of small bars, with the count of
 * the last full week (the current week has only just begun).
 */
function TrendRows({ weeks }: { weeks: WeeklyThroughput[] }) {
  const full = weeks.length > 1 ? weeks.length - 2 : weeks.length - 1;
  return (
    <div className={styles.summaryCard} role="group" aria-label="Weekly trend">
      <div className={styles.cardHead}>
        <h3 className={styles.miniLabel}>Weekly</h3>
        <Explain label="Weekly">
          Runs dispatched, runs encoded, and PRs merged in each of the last {weeks.length} weeks. The number is the
          last full week.
        </Explain>
      </div>
      <ul className={styles.trendRows}>
        {SERIES.map((series, i) => {
          const values = weeks.map((week) => week[series.key]);
          const max = Math.max(1, ...values);
          return (
            <li key={series.key} className={styles.trendRow}>
              <span className={styles.trendName}>{series.label}</span>
              <span className={styles.spark} aria-hidden>
                {weeks.map((week) => (
                  <span
                    key={week.weekStart}
                    className={styles.sparkBar}
                    data-series={i + 1}
                    style={{ height: `${Math.max(4, (week[series.key] / max) * 100)}%` }}
                    title={`Week of ${formatWeek(week.weekStart)}: ${number(week[series.key])}`}
                  />
                ))}
              </span>
              <span className={styles.trendValue}>
                {number(values[full] ?? 0)}
              </span>
            </li>
          );
        })}
      </ul>
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

const SEGMENT_CLASS: Record<FlowSegment["kind"], string> = {
  continue: styles.segContinue,
  pending: styles.segPending,
  loss: styles.segLoss,
};

/**
 * Every dispatch through the gates, one row per gate: a bar of the runs that
 * reached it, split into those that went on, those still waiting, and those
 * lost there. Each part opens its runs.
 */
/** Seconds under a minute; otherwise as the rest of the page writes durations. */
function shortDuration(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : durationLabel(ms);
}

/**
 * A "?" that opens a short note on what something means, so the page shows
 * names and numbers and explains them only when asked. Closes on a click
 * elsewhere or Escape, and opens leftward when it would run off the screen.
 */
function Explain({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !note.current || !root.current) return;
    const width = note.current.getBoundingClientRect().width;
    setAlignRight(root.current.getBoundingClientRect().left + width > window.innerWidth - 16);
  }, [open]);
  return (
    <span ref={root} className={styles.explain}>
      <button
        type="button"
        className={styles.explainButton}
        aria-label={`What ${label} means`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open && (
        <span ref={note} id={id} role="note" className={styles.explainNote} data-align={alignRight ? "right" : undefined}>
          {children}
        </span>
      )}
    </span>
  );
}

/** A heading with its "?". */
function PartHead({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className={styles.flowPartHead}>
      <h4 id={id}>{title}</h4>
      <Explain label={title}>{children}</Explain>
    </div>
  );
}

/** One timed step: its name and typical time; what it measures, how many runs, and the slowest 10% behind its "?". */
function TimedCell({ step }: { step: TimedStep }) {
  return (
    <li className={styles.timeStep}>
      <div className={styles.cellHead}>
        <span className={styles.tileLabel}>{step.label}</span>
        <Explain label={step.label}>
          {step.measures}
          {step.timings.length > 0 && (
            <span className={styles.explainList}>
              {step.timings.map((timing) => (
                <span key={timing.label}>
                  {timing.label ? `${timing.label}: ` : ""}
                  {number(timing.runs)} {timing.runs === 1 ? "run" : "runs"}
                  {timing.slowMs !== null && `, the slowest 10% ${shortDuration(timing.slowMs)} or more`}
                </span>
              ))}
            </span>
          )}
        </Explain>
      </div>
      {step.timings.length === 0 ? (
        <span className={styles.timeNone}>{step.untimed ?? "No runs timed"}</span>
      ) : (
        <dl className={styles.timeStats}>
          {step.timings.map((timing) => (
            <div key={timing.label}>
              {timing.label && <dt>{timing.label}</dt>}
              <dd>{shortDuration(timing.medianMs)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/** One run's path, read left to right: how long each step takes. */
function StepTimeRow({ steps }: { steps: StepTimes[] }) {
  return (
    <section className={styles.flowPart} aria-labelledby="flow-times-title">
      <PartHead id="flow-times-title" title="Time per step">
        The typical time (median) one run spends at each step, in order. Open a step&apos;s ? for what it
        measures, how many runs it counts, and how long the slowest 10% take.
      </PartHead>
      <ol className={styles.timeSteps}>
        {steps.map((step) => (
          <TimedCell key={step.key} step={step} />
        ))}
      </ol>
    </section>
  );
}

/** How many generation attempts encoded and failed runs used. */
function TriesTable({ tries }: { tries: TriesUsed }) {
  return (
    <div className={styles.timeStep}>
      <div className={styles.cellHead}>
        <span className={styles.tileLabel}>Tries used</span>
        <Explain label="Tries used">
          How many tries the encode loop needed: each try writes the encoding again from the checks&apos; feedback,
          up to four. From the encoder&apos;s own record, which {number(tries.recorded)} of {number(tries.finished)}{" "}
          finished runs have.
        </Explain>
      </div>
      {tries.tries.length === 0 ? (
        <span className={styles.timeNone}>Not recorded yet</span>
      ) : (
        <table className={styles.triesTable}>
          <thead>
            <tr>
              <th scope="col">Tries</th>
              {tries.tries.map((n) => (
                <th key={n} scope="col">
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["encoded", "failed"] as const).map((outcome) => (
              <tr key={outcome}>
                <th scope="row">{outcome === "encoded" ? "Encoded" : "Failed"}</th>
                {tries[outcome].map((count, i) => (
                  <td key={tries.tries[i]}>{number(count)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A step opened up into its parts, with one more cell beside them. */
function PartsRow({
  id,
  title,
  note,
  parts,
  extra,
}: {
  id: string;
  title: string;
  note: ReactNode;
  parts: TimedStep[];
  extra: ReactNode;
}) {
  return (
    <section className={styles.flowPart} aria-labelledby={id}>
      <PartHead id={id} title={title}>
        {note}
      </PartHead>
      <div className={styles.partsRow}>
        <ol className={styles.partsSteps}>
          {parts.map((part) => (
            <TimedCell key={part.key} step={part} />
          ))}
        </ol>
        {extra}
      </div>
    </section>
  );
}

/** How the first validation at each merge commit ended. */
function FirstResult({ first }: { first: TestsParts["first"] }) {
  return (
    <div className={styles.timeStep}>
      <div className={styles.cellHead}>
        <span className={styles.tileLabel}>First result</span>
        <Explain label="First result">
          How the first validation at each merge commit ended. A later run on main can end differently; the bars
          below count the latest result.
        </Explain>
      </div>
      {first.pass + first.fail === 0 ? (
        <span className={styles.timeNone}>Not recorded yet</span>
      ) : (
        <dl className={styles.timeStats}>
          <div>
            <dt>Pass</dt>
            <dd>{number(first.pass)}</dd>
          </div>
          <div>
            <dt>Fail</dt>
            <dd>{number(first.fail)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function FlowView({
  gates,
  times,
  parts,
  testParts,
  onOpen,
}: {
  gates: FlowGate[];
  times: StepTimes[] | null;
  parts: EncodeParts | null;
  testParts: TestsParts | null;
  onOpen: (gate: FlowGate, segment: FlowSegment) => void;
}) {
  return (
    <>
      {times && <StepTimeRow steps={times} />}
      {parts && (
        <PartsRow
          id="flow-parts-title"
          title="Inside the encode run"
          note="The encode run is one GitHub Actions job in three parts: setup, the encode loop, then signing and opening the PR."
          parts={parts.parts}
          extra={<TriesTable tries={parts.tries} />}
        />
      )}
      {testParts && (
        <PartsRow
          id="flow-tests-title"
          title="Inside the tests on main"
          note="After a merge, CI on main validates the module's jurisdiction at the merge commit: first the wait for that validation to start, then the run itself."
          parts={testParts.parts}
          extra={<FirstResult first={testParts.first} />}
        />
      )}
      <section className={styles.flowPart} aria-labelledby="flow-gates-title">
        <PartHead id="flow-gates-title" title="Where runs go">
          Each bar is one step, with the number of runs that reached it: the runs that passed the step before.
          The solid part went on, grey is still waiting, and the shaded part stopped there. Click a part to list
          its runs.
        </PartHead>
        <ol className={styles.flowGates} aria-label="Dispatches through each gate">
          {gates.map((gate) => (
            <li key={gate.key} className={styles.flowGate}>
              <div className={styles.flowGateHead}>
                <span className={styles.flowGateName}>{gate.label}</span>
                <span className={styles.flowGateIn}>
                  {number(gate.input)} {gate.input === 1 ? "run" : "runs"}
                </span>
              </div>
              {gate.input === 0 ? (
                <p className={styles.empty}>No runs reached this gate.</p>
              ) : (
                <>
                  <div className={styles.flowBar} aria-hidden>
                    {gate.segments.map((segment) => (
                      <span
                        key={segment.key}
                        className={`${styles.flowSeg} ${SEGMENT_CLASS[segment.kind]}`}
                        style={{ flexGrow: segment.count }}
                        title={`${segment.label}: ${number(segment.count)}`}
                      />
                    ))}
                  </div>
                  <div className={styles.flowLegend}>
                    {gate.segments.map((segment) => (
                      <button
                        key={segment.key}
                        type="button"
                        className={styles.flowChip}
                        onClick={() => onOpen(gate, segment)}
                      >
                        <span className={`${styles.flowDot} ${SEGMENT_CLASS[segment.kind]}`} aria-hidden />
                        {segment.label}
                        <strong>{number(segment.count)}</strong>
                        <span className={styles.flowShare}>{percent(segment.count, gate.input)}%</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

/** One run's provenance in a line: when, by whom, which encoder, how long it waited and ran. */
function runProvenance(row: RunRow): string {
  return [
    `dispatched ${formatDay(row.dispatchedAt)}`,
    row.by ? `by ${row.by}` : null,
    row.encoder ? `encoder ${row.encoder}` : null,
    row.approvalMs !== null ? `approval ${durationLabel(row.approvalMs)}` : null,
    row.runMs !== null ? `run ${durationLabel(row.runMs)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function runWhere(row: RunRow): string | null {
  if (!row.pr) return null;
  const parts = [
    row.merged ? `merged ${row.merged === "main" ? "into main" : "off main"}` : `PR ${row.pr.state}`,
    row.index === "indexed" ? "indexed" : row.index === "missing" ? "missing from the index" : null,
    row.tests ? `tests ${row.tests}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

const RUN_LIST_MAX = 60;

/** The runs behind one part of the flow, newest first. */
function RunList({
  title,
  rows,
  referenceMs,
  onClose,
}: {
  title: string;
  rows: RunRow[];
  referenceMs: number;
  onClose: () => void;
}) {
  const shown = rows.slice(0, RUN_LIST_MAX);
  return (
    <ListPanel title={title} label={`${title} runs`} count={rows.length} description="" onClose={onClose}>
      {rows.length === 0 ? (
        <p className={styles.empty}>Nothing here right now.</p>
      ) : (
        <>
          {shown.length < rows.length && (
            <p className={styles.listNote}>
              Latest {number(shown.length)} of {number(rows.length)}. The run log has all of them.
            </p>
          )}
          <ul className={styles.items}>
            {shown.map((row) => (
              <Row
                key={row.id}
                title={row.citation}
                href={journeyHref(row.citation)}
                why={[row.outcomeLabel, row.cause].filter(Boolean).join(" · ")}
                detail={runProvenance(row)}
                age={ageLabel(row.dispatchedAt, referenceMs)}
                links={[
                  { label: "run", href: row.runUrl },
                  ...(row.pr ? [{ label: row.pr.label, href: row.pr.url }] : []),
                ]}
                flags={runWhere(row)}
              />
            ))}
          </ul>
        </>
      )}
    </ListPanel>
  );
}

const LOG_PAGE = 50;

const CSV_COLUMNS: Array<[string, (row: RunRow) => string | number | null]> = [
  ["dispatched_at", (r) => r.dispatchedAt],
  ["citation", (r) => r.citation],
  ["jurisdiction", (r) => r.jurisdiction],
  ["dispatched_by", (r) => r.by],
  ["encoder_version", (r) => r.encoder],
  ["approval_seconds", (r) => (r.approvalMs === null ? null : Math.round(r.approvalMs / 1000))],
  ["run_seconds", (r) => (r.runMs === null ? null : Math.round(r.runMs / 1000))],
  ["outcome", (r) => r.outcome],
  ["outcome_label", (r) => r.outcomeLabel],
  ["cause", (r) => r.cause],
  ["run_url", (r) => r.runUrl],
  ["pr", (r) => r.pr?.label ?? null],
  ["pr_url", (r) => r.pr?.url ?? null],
  ["pr_state", (r) => r.pr?.state ?? null],
  ["pr_check_error", (r) => r.pr?.error ?? null],
  ["merged", (r) => r.merged],
  ["index", (r) => r.index],
  ["tests", (r) => r.tests],
  ["tests_url", (r) => r.testsUrl],
];

export function runsCsv(rows: RunRow[]): string {
  const cell = (value: string | number | null) => {
    if (value === null) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    CSV_COLUMNS.map(([name]) => name).join(","),
    ...rows.map((row) => CSV_COLUMNS.map(([, read]) => cell(read(row))).join(",")),
  ].join("\n");
}

/** Every dispatch with its full provenance: filter, read, export. */
function RunLog({ load, referenceMs }: { load: () => Promise<RunRow[]>; referenceMs: number }) {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("");
  const [encoder, setEncoder] = useState("");
  const [limit, setLimit] = useState(LOG_PAGE);
  useEffect(() => {
    let live = true;
    load().then(
      (loaded) => live && setRows(loaded),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, [load]);
  if (failed) return <p className={styles.empty}>The run log could not load. Try again later.</p>;
  if (!rows) return <p className={styles.empty}>Loading runs…</p>;

  const outcomes = [...new Set(rows.map((r) => r.outcomeLabel))].sort();
  const encoders = [...new Set(rows.map((r) => r.encoder).filter((v): v is string => !!v))].sort(
    (a, b) => b.localeCompare(a, undefined, { numeric: true })
  );
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (!needle || row.citation.toLowerCase().includes(needle)) &&
      (!outcome || row.outcomeLabel === outcome) &&
      (!encoder || row.encoder === encoder)
  );
  const download = () => {
    const url = URL.createObjectURL(new Blob([runsCsv(filtered)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "encode-runs.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={styles.runLog}>
      <div className={styles.logFilters}>
        <input
          type="search"
          className={styles.logSearch}
          placeholder="Search citations"
          aria-label="Search citations"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(LOG_PAGE);
          }}
        />
        <select
          className={styles.scopeSelect}
          aria-label="Outcome"
          value={outcome}
          onChange={(event) => {
            setOutcome(event.target.value);
            setLimit(LOG_PAGE);
          }}
        >
          <option value="">All outcomes</option>
          {outcomes.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={styles.scopeSelect}
          aria-label="Encoder version"
          value={encoder}
          onChange={(event) => {
            setEncoder(event.target.value);
            setLimit(LOG_PAGE);
          }}
        >
          <option value="">All encoder versions</option>
          {encoders.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
        <span className={styles.logCount}>
          {number(filtered.length)} of {number(rows.length)} runs
        </span>
        <button type="button" className={styles.logExport} onClick={download}>
          Export CSV
        </button>
      </div>
      <div className={styles.logTableWrap}>
        <table className={styles.logTable}>
          <thead>
            <tr>
              <th scope="col">Dispatched</th>
              <th scope="col">Citation</th>
              <th scope="col">Encoder</th>
              <th scope="col">Approval</th>
              <th scope="col">Run</th>
              <th scope="col">Outcome</th>
              <th scope="col">PR</th>
              <th scope="col">After merge</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((row) => (
              <tr key={row.id}>
                <td title={row.dispatchedAt}>
                  {ageLabel(row.dispatchedAt, referenceMs)} ago
                  {row.by && <span className={styles.logSub}>{row.by}</span>}
                </td>
                <td className={styles.logCitation}>
                  <a href={journeyHref(row.citation)}>{row.citation}</a>
                </td>
                <td className={styles.logMono}>{row.encoder ?? "—"}</td>
                <td>{row.approvalMs === null ? "—" : durationLabel(row.approvalMs)}</td>
                <td>{row.runMs === null ? "—" : durationLabel(row.runMs)}</td>
                <td className={styles.logOutcome} data-outcome={row.outcome}>
                  <a href={row.runUrl} target="_blank" rel="noreferrer">
                    {row.outcomeLabel}
                  </a>
                  {row.cause && (
                    <span className={styles.logSub} title={row.cause}>
                      {row.cause}
                    </span>
                  )}
                </td>
                <td>
                  {row.pr ? (
                    <>
                      <a href={row.pr.url} target="_blank" rel="noreferrer">
                        {row.pr.label}
                      </a>
                      <span className={styles.logSub} title={row.pr.error ?? undefined}>
                        {row.pr.state}
                        {row.pr.error ? ` · ${row.pr.error}` : ""}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {row.merged ? (
                    <>
                      {row.merged === "main" ? "main" : "off main"}
                      <span className={styles.logSub}>
                        {[row.index, row.tests ? `tests ${row.tests}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <button type="button" className={styles.logMore} onClick={() => setLimit(limit + LOG_PAGE)}>
          Show {number(Math.min(LOG_PAGE, filtered.length - limit))} more
        </button>
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

