"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, Position, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { CAUSE_ORIGINS, causeText, formatDuration, pct, stationLabel, type FlowModel, type SinkId, type StationStats } from "@/lib/axiom/pipeline-flow";
import { CanvasShell } from "./canvas-shell";
import { pipelineLayout, stationsPerRow, stationStatus, type Drain, type RoutedEdge, type Status } from "./flow-layout";
import { STATUS_LABEL, StatusIcon } from "./status-icon";
import styles from "./flow.module.css";

const STATUS_COLOR: Record<Status, string> = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
  neutral: "#8f877d",
};

type StationData = { station: StationStats; status: Status; selected: boolean; selfLoop: number | null; left: number; leak: Leak; offRoute: Array<{ to: string; cases: number; loop: boolean }>; href: string };
/** How much of all exits a station accounts for: a fifth or more is high, a twelfth or more mid. */
type Leak = "high" | "mid" | "low" | "none";

function leakLevel(left: number, allExits: number): Leak {
  if (!left || !allExits) return "none";
  const share = left / allExits;
  return share >= 0.2 ? "high" : share >= 0.08 ? "mid" : "low";
}

type SinkData = { sink: SinkId; label: string; cases: number; href?: string };
type FlowEdgeData = { routed: RoutedEdge; max: number };

const SIDES = {
  l: { position: Position.Left, style: undefined },
  r: { position: Position.Right, style: undefined },
  t: { position: Position.Top, style: undefined },
  b: { position: Position.Bottom, style: undefined },
  // The bottom's quarters: arcs under a row start and end here, clear of the centre.
  bl: { position: Position.Bottom, style: { left: "25%" } },
  br: { position: Position.Bottom, style: { left: "75%" } },
} as const;

function Handles() {
  return (
    <>
      {(Object.keys(SIDES) as Array<keyof typeof SIDES>).map((side) => {
        const { position, style } = SIDES[side];
        return (
          <span key={side}>
            <Handle id={`s-${side}`} type="source" position={position} style={style} className={styles.handle} isConnectable={false} />
            <Handle id={`t-${side}`} type="target" position={position} style={style} className={styles.handle} isConnectable={false} />
          </span>
        );
      })}
    </>
  );
}

function Ring({ value, status }: { value: number | null; status: Status }) {
  const r = 23;
  const c = 2 * Math.PI * r;
  return (
    <div className={styles.ring}>
      <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden>
        <circle cx="27" cy="27" r={r} fill="none" stroke="#3a3530" strokeWidth="5" />
        {value != null ? (
          <circle cx="27" cy="27" r={r} fill="none" stroke={STATUS_COLOR[status]} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${Math.max(0.001, value) * c} ${c}`} />
        ) : null}
      </svg>
      <b>{pct(value)}</b>
    </div>
  );
}

/** This week against the week before, short enough for a node: "▲ 12 · yield 30% → 26%". */
function WeekTrend({ trend }: { trend: StationStats["trend"] }) {
  const { now, before } = trend;
  if (!now.finished && !before.finished) return <p className={styles.week}>No dated finishes in 2 weeks</p>;
  const delta = now.finished - before.finished;
  const y = (b: { finished: number; ok: number }) => (b.finished ? b.ok / b.finished : null);
  const yNow = y(now);
  const yBefore = y(before);
  const yieldMove = yNow != null && yBefore != null && Math.abs(yNow - yBefore) >= 0.03;
  const worse = yieldMove && yNow! < yBefore!;
  return (
    <p className={styles.week} data-worse={worse}>
      Week {delta === 0 ? "same volume" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}`}
      {yieldMove ? ` · yield ${pct(yBefore)} → ${pct(yNow)}` : yNow != null ? ` · yield ${pct(yNow)}` : ""}
    </p>
  );
}

const StationNode = memo(function StationNode({ data }: NodeProps<Node<StationData>>) {
  const { station: s, status, selected, selfLoop, left, leak, offRoute } = data;
  const top = s.flow.exit_causes[0];
  const yieldText = s.tries && s.tries.total ? `${pct(s.tries.ok / s.tries.total)} of ${s.tries.total.toLocaleString("en-US")} tries` : `${s.ok + s.failed + s.cancelled} finished`;
  const hot = s.target?.max_wip != null ? s.wip > s.target.max_wip : s.over_sla > 0;
  return (
    <div
      className={styles.station}
      data-status={status}
      data-selected={selected}
      data-leak={leak}
      tabIndex={0}
      aria-label={`${s.label}: yield ${pct(s.yield)}, ${s.wip} open, median ${s.timed ? formatDuration(s.p50_ms) : "not timed"}. ${STATUS_LABEL[status]}.`}
    >
      <Handles />
      <div className={styles.stationTop}>
        <span className={styles.stationName}>{s.label}</span>
        <span className={styles.status} data-status={status}>
          <StatusIcon status={status} size={11} /> {STATUS_LABEL[status]}
        </span>
      </div>
      <div className={styles.stationBody}>
        <Ring value={s.yield} status={status} />
        <dl className={styles.stats}>
          <dt>Cases</dt>
          <dd>{s.cases.toLocaleString("en-US")}</dd>
          <dt>Open now</dt>
          <dd className={styles.wip} data-hot={hot}>
            {s.wip.toLocaleString("en-US")}
          </dd>
          <dt>p50 · p95</dt>
          <dd title={s.timed && s.timed_share < 0.5 ? `From ${pct(s.timed_share)} of visits` : undefined}>
            {s.timed ? `${formatDuration(s.p50_ms)} · ${formatDuration(s.p95_ms)}${s.timed_share < 0.5 ? "*" : ""}` : "not timed"}
          </dd>
        </dl>
      </div>
      <div className={styles.stats} style={{ marginTop: 6, gridTemplateColumns: "1fr" }}>
        <dt>
          {yieldText}
          {selfLoop ? ` · ${selfLoop} re-runs` : ""}

        </dt>
      </div>
      <WeekTrend trend={s.trend} />
      {top ? (
        <div title={`${left} of ${s.cases} cases left the line here. Top reason: ${top.cause} (${top.cases}), from ${CAUSE_ORIGINS[top.origin].label}${top.message ? `: ${top.message}` : ""}`}>
          <span className={styles.leakTrack} aria-hidden>
            <i style={{ width: `${(left / Math.max(1, s.cases)) * 100}%` }} />
          </span>
          <p className={styles.reason}>
            <b>
              {left.toLocaleString("en-US")} left ({left / Math.max(1, s.cases) < 0.005 ? "<1%" : pct(left / Math.max(1, s.cases))})
            </b>{" "}
            · {causeText(top.cause) ?? <code>{top.cause}</code>}
          </p>
        </div>
      ) : null}
      {offRoute.map((o) => (
        <p key={o.to} className={styles.offRoute} title="This edge would cross a row of stations, so it is a note here, not a line">
          {o.loop ? "↺" : "→"} {o.cases} {o.loop ? "back " : ""}to {stationLabel(o.to)}
        </p>
      ))}
    </div>
  );
});

const SinkNode = memo(function SinkNode({ data }: NodeProps<Node<SinkData>>) {
  return (
    <div className={styles.sink} data-sink={data.sink} aria-label={`${data.label}: ${data.cases} cases`}>
      <Handles />
      <b>{data.cases.toLocaleString("en-US")}</b>
      {data.label}
    </div>
  );
});

/** A flow edge: width by cases, moving particles by throughput; loops amber, exits red and dashed. */
const FlowEdgeView = memo(function FlowEdgeView(props: EdgeProps<Edge<FlowEdgeData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, id } = props;
  const routed = data!.routed;
  const ratio = Math.sqrt(routed.cases / Math.max(1, data!.max));
  let path: string;
  let labelX: number;
  let labelY: number;
  if (sourcePosition === Position.Bottom && targetPosition === Position.Bottom) {
    // An arc through the aisle under the row: a retry, or a skip past a station.
    const up = 1;
    const lift = 56 + Math.min(40, Math.abs(sourceX - targetX) * 0.06);
    path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + up * lift}, ${targetX} ${targetY + up * lift}, ${targetX} ${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = sourceY + up * lift * 0.75;
  } else {
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: routed.kind === "exit" ? 0.35 : 0.25 });
  }
  const color = routed.kind === "exit" ? "#d03b3b" : routed.kind === "loop" ? "#fab219" : "#f59e0b";
  const width = routed.kind === "exit" ? 1 + ratio * 5 : 1.5 + ratio * 9;
  const particles = Math.max(1, Math.min(5, Math.round(1 + ratio * 4)));
  const dur = (routed.kind === "exit" ? 7 : 5.5) - ratio * 3;
  const showLabel = routed.kind !== "exit" || routed.cases >= Math.max(5, data!.max * 0.02);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeOpacity: routed.kind === "main" ? 0.55 : 0.45,
          strokeDasharray: routed.kind === "exit" ? "6 6" : undefined,
          strokeLinecap: "round",
        }}
      />
      {Array.from({ length: particles }, (_, i) => (
        <circle key={i} r={routed.kind === "main" ? 2.6 : 2} fill={color} className={styles.particle}>
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${(i * dur) / particles}s`} path={path} />
        </circle>
      ))}
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className={`${styles.edgeLabel} nodrag nopan`}
            data-kind={routed.kind}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={`${routed.cases} cases${routed.median_wait_ms != null ? `, median wait ${formatDuration(routed.median_wait_ms)}` : ""}`}
          >
            {routed.cases.toLocaleString("en-US")}
            {routed.kind === "main" && routed.median_wait_ms != null && routed.median_wait_ms >= 60_000 ? ` · ${formatDuration(routed.median_wait_ms)} wait` : ""}
            {routed.kind === "loop" ? " retries" : ""}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

type DrainData = { drain: Drain; max: number; from: string };

/** A path through the given corners, with rounded turns. */
function roundedPath(points: Array<[number, number]>, radius = 12): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const inX = x - Math.sign(x - px) * r;
    const inY = y - Math.sign(y - py) * r;
    const outX = x + Math.sign(nx - x) * r;
    const outY = y + Math.sign(ny - y) * r;
    d += ` L ${inX} ${inY} Q ${x} ${y} ${outX} ${outY}`;
  }
  const end = points[points.length - 1];
  return `${d} L ${end[0]} ${end[1]}`;
}

/**
 * An exit line: from under the station, along the aisle below its row, down
 * the gutter beside the floor, into the Failed or Cancelled sink. Its corners
 * come from the layout, so it never crosses a box. Width = cases.
 */
const DrainEdgeView = memo(function DrainEdgeView(props: EdgeProps<Edge<DrainData>>) {
  const { drain, max, from } = props.data!;
  const path = roundedPath(drain.points);
  const ratio = Math.sqrt(drain.cases / Math.max(1, max));
  const failed = drain.to === "exit:failed";
  const color = failed ? "#d03b3b" : "#8f877d";
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{ stroke: color, strokeWidth: 1 + ratio * 9, strokeOpacity: failed ? 0.6 : 0.5, strokeLinejoin: "round", strokeDasharray: failed ? undefined : "5 5" }}
      />
      <title>{`${drain.cases.toLocaleString("en-US")} ${failed ? "failed" : "cancelled"} at ${stationLabel(from)}`}</title>
      <circle r={2} fill={color} className={styles.particle}>
        <animateMotion dur={`${9 - ratio * 3}s`} repeatCount="indefinite" path={path} />
      </circle>
    </>
  );
});

const nodeTypes = { station: StationNode, sink: SinkNode };
const edgeTypes = { flow: FlowEdgeView, drain: DrainEdgeView };

/** fitView's padding, as a share of the canvas on each side. */
const FIT_PADDING = 0.12;

export function PipelineCanvas({
  model,
  selected,
  hrefFor,
  onSelect,
}: {
  model: FlowModel;
  selected: string | null;
  hrefFor: Record<string, string>;
  onSelect?: (station: string) => void;
}) {
  // The row length follows the canvas width, so the stations read at a
  // useful zoom on any screen; the canvas is then as tall as the graph.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const perRow = width ? stationsPerRow(width) : 7;

  const { nodes, edges, height } = useMemo(() => {
    const layout = pipelineLayout(model, perRow);
    const byId = new Map(model.stations.map((s) => [s.id, s]));
    const allExits = [...layout.exits.values()].reduce((n, x) => n + x, 0);
    const nodes: Node[] = [
      ...layout.stations.map((p) => {
        const station = byId.get(p.id)!;
        return {
          id: p.id,
          type: "station",
          position: { x: p.x, y: p.y },
          data: {
            station,
            status: stationStatus(station, model.alerts),
            selected: selected === p.id,
            selfLoop: layout.selfLoops.get(p.id) ?? null,
            left: layout.exits.get(p.id) ?? 0,
            leak: leakLevel(layout.exits.get(p.id) ?? 0, allExits),
            offRoute: layout.offRoute.get(p.id) ?? [],
            href: hrefFor[p.id],
          } satisfies StationData,
        };
      }),
      ...layout.sinks.map((p) => {
        const sink = model.sinks.find((s) => s.id === p.sink)!;
        return { id: p.id, type: "sink", position: { x: p.x, y: p.y }, data: { sink: p.sink, label: sink.label, cases: sink.cases } satisfies SinkData };
      }),
    ];
    const max = Math.max(1, ...layout.edges.filter((e) => e.kind === "main").map((e) => e.cases));
    const edges: Edge[] = layout.edges
      .filter((e) => e.kind !== "exit")
      .map((e) => ({
        id: `${e.from}→${e.to}`,
        source: e.from,
        target: e.to,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: "flow",
        zIndex: e.kind === "exit" ? 0 : 1,
        data: { routed: e, max } satisfies FlowEdgeData,
      }));
    const maxDrain = Math.max(1, ...layout.drains.map((d) => d.cases));
    for (const d of layout.drains) {
      edges.push({
        id: `${d.from}→${d.to}`,
        source: d.from,
        target: d.to,
        sourceHandle: "s-b",
        targetHandle: "t-t",
        type: "drain",
        zIndex: 0,
        selectable: false,
        data: { drain: d, max: maxDrain, from: d.from } satisfies DrainData,
      });
    }
    const zoom = width ? Math.min(1.1, width / (layout.width * (1 + 2 * FIT_PADDING))) : 0;
    const height = zoom ? Math.round(Math.min(1400, Math.max(420, layout.height * (1 + 2 * FIT_PADDING) * zoom))) : undefined;
    return { nodes, edges, height };
  }, [model, selected, hrefFor, perRow, width]);

  return (
    <div ref={box} style={{ minWidth: 0 }}>
      <CanvasShell
        nodes={nodes}
        height={height}
        fitKey={perRow}
        onSelect={onSelect}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        label="The encoding pipeline: stations, the cases that moved between them, and where they left"
        legend={
          <>
            <span>
              <i className={styles.line} /> cases moving on (width = cases)
            </span>
            <span>
              <i className={styles.line} data-kind="loop" /> back to an earlier station
            </span>
            <span>
              <i className={styles.line} data-kind="exit" /> failed, to the Failed sink
            </span>
            <span>
              <i className={styles.line} data-kind="cancel" /> cancelled
            </span>
            <span>
              <i className={styles.legendLeak} /> red bar = share of the station&apos;s cases that left the line there, with the top reason (hover for its source); a red glow = a big share of all exits (strong: a fifth or more; faint: a twelfth or more)
            </span>
            {(["good", "warning", "critical", "neutral"] as Status[]).map((s) => (
              <span key={s} style={{ color: STATUS_COLOR[s] }}>
                <StatusIcon status={s} size={11} /> <span style={{ color: "var(--floor-ink-2)" }}>{STATUS_LABEL[s]}</span>
              </span>
            ))}
            <span>Ring = yield · * = times from part of the visits · click a station for why</span>
          </>
        }
      />
    </div>
  );
}
