"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Workflow } from "lucide-react";
import styles from "./ops-pipeline.module.css";
import {
  ageLabel,
  bottleneckStage,
  isExitStage,
  journeyHref,
  STAGE_COPY,
  type PipelineGroupView,
  type PipelineItem,
  type PipelineStage,
  type PipelineView,
  type WeeklyThroughput,
} from "@/lib/axiom/encoding-pipeline";
import type { QueuedSummary } from "@/lib/axiom/encoding-queues";


interface FlowColumn {
  stage: PipelineStage;
  hint: string;
  exits: PipelineStage[];
}

const FLOW: FlowColumn[] = [
  { stage: "encoding", hint: "running now", exits: ["encode_failed", "no_pr"] },
  { stage: "review", hint: "PR open", exits: ["closed"] },
  {
    stage: "awaiting_sync",
    hint: "waiting for the index",
    exits: ["merged_off_main", "not_indexed"],
  },
  { stage: "indexed", hint: "compile not checked", exits: [] },
  { stage: "runs", hint: "tests not confirmed", exits: ["compile_failed"] },
  { stage: "verified", hint: "passes on main", exits: ["tests_failing", "oracle_disagrees"] },
];

const number = (value: number) => value.toLocaleString("en-US");

export function OpsPipeline({
  view,
  queued,
  referenceMs,
}: {
  view: PipelineView;
  queued: QueuedSummary | null;
  referenceMs: number;
}) {
  const bottleneck = bottleneckStage(view);
  const [selected, setSelected] = useState<PipelineStage>(bottleneck ?? "review");

  return (
    <section aria-labelledby="pipeline-title" className={styles.pipeline}>
      <div className={styles.head}>
        <div>
          <p className={styles.eyebrow}>
            <Workflow size={12} aria-hidden /> Pipeline
          </p>
          <h2 id="pipeline-title">Where the work is</h2>
          <p className={styles.sub}>
            {number(view.citationCount)} citations across {number(view.dispatchCount)}{" "}
            dispatches
            {view.firstDispatchAt && ` since ${formatDay(view.firstDispatchAt)}`}, followed
            from the encoder to a rule that runs. Each citation sits where its latest
            dispatch is.
            {view.collectedAt && ` Refreshed ${ageLabel(view.collectedAt, referenceMs)} ago.`}
          </p>
        </div>
        {bottleneck && (
          <button
            type="button"
            className={styles.bottleneck}
            onClick={() => setSelected(bottleneck)}
          >
            <AlertTriangle size={14} aria-hidden />
            <span>
              Biggest pile: <strong>{number(view.stages[bottleneck].stuck)}</strong>{" "}
              {STAGE_COPY[bottleneck].label.toLowerCase()}
            </span>
          </button>
        )}
      </div>

      <ol className={styles.flow} aria-label="Pipeline stages">
        <li className={styles.column}>
          <div className={`${styles.tile} ${styles.static}`}>
            <span className={styles.tileLabel}>Queued</span>
            <span className={styles.tileValue}>
              {queued ? number(queued.pending) : "—"}
            </span>
            <span className={styles.tileHint}>
              {queued
                ? queued.pausedReason
                  ? "paused"
                  : `${number(queued.inFlight)} in flight`
                : "no durable queues"}
            </span>
          </div>
          {queued && queued.blocked > 0 && (
            <div>
              <p className={`${styles.exitNote} ${styles.warnNote}`}>
                <AlertTriangle size={11} aria-hidden /> {number(queued.blocked)} blocked
                until a person requeues {queued.blocked === 1 ? "it" : "them"}
              </p>
              {queued.blockedNote && (
                <p className={styles.pauseNote}>
                  {queued.blockedNote.count === queued.blocked
                    ? "All: "
                    : `${number(queued.blockedNote.count)}: `}
                  {queued.blockedNote.note}
                </p>
              )}
            </div>
          )}
          {queued?.pausedReason && (
            <p className={styles.pauseNote}>{queued.pausedReason}</p>
          )}
        </li>
        {FLOW.map((column) => (
          <li key={column.stage} className={styles.column}>
            <StageTile
              stage={column.stage}
              hint={
                column.stage === "runs" && !view.compileCheckedAt
                  ? "sweep not running yet"
                  : column.hint
              }
              view={view}
              referenceMs={referenceMs}
              selected={selected === column.stage}
              onSelect={setSelected}
            />
            {column.exits
              .filter((exit) => view.stages[exit].count > 0)
              .map((exit) => (
                <ExitChip
                  key={exit}
                  stage={exit}
                  view={view}
                  selected={selected === exit}
                  onSelect={setSelected}
                />
              ))}
            {column.stage === "review" && view.duplicatePrs > 0 && (
              <p className={styles.exitNote}>
                +{number(view.duplicatePrs)} duplicate open PR
                {view.duplicatePrs === 1 ? "" : "s"}
              </p>
            )}
          </li>
        ))}
      </ol>

      <div className={styles.lower}>
        <StageDetail stage={selected} view={view} referenceMs={referenceMs} />
        <Throughput view={view} />
      </div>
    </section>
  );
}

function StageTile({
  stage,
  hint,
  view,
  referenceMs,
  selected,
  onSelect,
}: {
  stage: PipelineStage;
  hint: string;
  view: PipelineView;
  referenceMs: number;
  selected: boolean;
  onSelect: (stage: PipelineStage) => void;
}) {
  const summary = view.stages[stage];
  const oldest = ageLabel(summary.oldestSince, referenceMs);
  return (
    <button
      type="button"
      className={`${styles.tile} ${summary.stuck > 0 ? styles.tileStuck : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(stage)}
    >
      <span className={styles.tileLabel}>{STAGE_COPY[stage].label}</span>
      <span className={styles.tileValue}>{number(summary.count)}</span>
      <span className={styles.tileHint}>
        {summary.stuck > 0 ? (
          <>
            <AlertTriangle size={11} aria-hidden /> {number(summary.stuck)} stuck
            {oldest && ` · oldest ${oldest}`}
          </>
        ) : (
          hint
        )}
      </span>
    </button>
  );
}

function ExitChip({
  stage,
  view,
  selected,
  onSelect,
}: {
  stage: PipelineStage;
  view: PipelineView;
  selected: boolean;
  onSelect: (stage: PipelineStage) => void;
}) {
  const neutral = stage === "no_pr";
  return (
    <button
      type="button"
      className={`${styles.exit} ${neutral ? "" : styles.exitStuck}`}
      aria-pressed={selected}
      onClick={() => onSelect(stage)}
    >
      <span className={styles.exitArrow} aria-hidden>
        ↳
      </span>
      <strong>{number(view.stages[stage].count)}</strong>
      <span>{STAGE_COPY[stage].label.toLowerCase()}</span>
    </button>
  );
}

interface GroupSet {
  id: string;
  title: string;
  groups: PipelineGroupView[];
}

/** The breakdowns a stage's detail panel offers, most telling first. */
function groupSetsFor(stage: PipelineStage, view: PipelineView): GroupSet[] {
  if (stage === "encode_failed") {
    return [
      { id: "gate", title: "Where they stopped", groups: view.gates },
      { id: "reason", title: "Why they failed", groups: view.failures },
    ];
  }
  if (stage === "review") {
    return [{ id: "hold", title: "What holds them", groups: view.holds }];
  }
  return [];
}

function StageDetail({
  stage,
  view,
  referenceMs,
}: {
  stage: PipelineStage;
  view: PipelineView;
  referenceMs: number;
}) {
  const [selection, setSelection] = useState<{ set: string; key: string } | null>(null);
  const summary = view.stages[stage];
  const sets = groupSetsFor(stage, view);
  const active =
    selection &&
    sets
      .find((set) => set.id === selection.set)
      ?.groups.find((group) => group.key === selection.key);
  const items = active ? active.items : summary.items;
  const shownOf = active ? active.count : summary.count;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <h3>
          {STAGE_COPY[stage].label}
          <span className={styles.detailCount}>{number(summary.count)}</span>
        </h3>
        <p>{STAGE_COPY[stage].description}</p>
      </div>

      {sets
        .filter((set) => set.groups.length > 0)
        .map((set) => {
          const max = set.groups[0].count;
          return (
            <div key={set.id} className={styles.reasons}>
              <p className={styles.miniLabel}>{set.title}</p>
              <ul>
                {set.groups.slice(0, 8).map((group) => {
                  const pressed = selection?.set === set.id && selection.key === group.key;
                  return (
                    <li key={group.key}>
                      <button
                        type="button"
                        aria-pressed={pressed}
                        onClick={() =>
                          setSelection(pressed ? null : { set: set.id, key: group.key })
                        }
                        className={styles.reason}
                      >
                        <span className={styles.reasonLabel} title={group.label}>
                          {group.label}
                        </span>
                        <span className={styles.reasonBarTrack} aria-hidden>
                          <span
                            className={styles.reasonBar}
                            style={{ width: `${Math.max(2, (group.count / max) * 100)}%` }}
                          />
                        </span>
                        <span className={styles.reasonCount}>{number(group.count)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

      {items.length === 0 ? (
        <p className={styles.empty}>Nothing here right now.</p>
      ) : (
        <>
          <p className={styles.miniLabel}>
            {active ? `${active.label}: ` : ""}
            {items.length < shownOf
              ? `${isExitStage(stage) ? "Latest" : "Oldest"} ${number(items.length)} of ${number(shownOf)}`
              : `${number(shownOf)} citation${shownOf === 1 ? "" : "s"}`}
          </p>
          <ul className={styles.items}>
            {items.map((item) => (
              <ItemRow key={item.citation} item={item} referenceMs={referenceMs} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ItemRow({ item, referenceMs }: { item: PipelineItem; referenceMs: number }) {
  // A review item's reason and detail already say what holds the PR.
  const reviewing = item.stage === "review";
  const meta = [
    item.gate,
    !reviewing && item.prChecks === "failure"
      ? "checks failing"
      : !reviewing && item.prChecks === "pending"
        ? "checks pending"
        : null,
    !reviewing && item.prReview === "changes_requested"
      ? "changes requested"
      : !reviewing && item.prReview === "approved"
        ? "approved"
        : null,
    item.dispatches > 1 ? `${item.dispatches} dispatches` : null,
    item.openPrs > 1 ? `${item.openPrs} open PRs` : null,
    item.reachedIndex && !["indexed", "runs", "verified"].includes(item.stage)
      ? "an earlier encoding is in the index"
      : null,
    item.stage === "runs" || item.stage === "verified" || item.stage === "tests_failing"
      ? item.oracle
      : null,
  ].filter(Boolean);
  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <a href={journeyHref(item.citation)} className={styles.citation}>
          {item.citation}
        </a>
        <span className={styles.age}>{ageLabel(item.since, referenceMs)}</span>
      </div>
      <p className={styles.itemMeta}>
        {item.prUrl ? (
          <a href={item.prUrl} target="_blank" rel="noreferrer">
            {item.prLabel}
          </a>
        ) : (
          <a href={item.runUrl} target="_blank" rel="noreferrer">
            run
          </a>
        )}
        {item.testsRunUrl && (
          <>
            {" · "}
            <a href={item.testsRunUrl} target="_blank" rel="noreferrer">
              validation run
            </a>
          </>
        )}
        {meta.length > 0 && ` · ${meta.join(" · ")}`}
        {item.reason && item.stage !== "encode_failed" && ` · ${item.reason}`}
      </p>
      {item.detail && <p className={styles.itemDetail}>{item.detail}</p>}
    </li>
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
    <div className={styles.throughput}>
      <div className={styles.detailHead}>
        <h3>Weekly throughput</h3>
        <p>Dispatches, successful encodes, and merges into a default branch, by week.</p>
      </div>
      {rate && (
        <p className={styles.stat}>
          <span className={styles.statValue}>
            {Math.round((rate.failed / rate.finished) * 100)}%
          </span>
          <span>
            of finished runs failed in the last 14 days ({number(rate.failed)} of{" "}
            {number(rate.finished)})
          </span>
        </p>
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

