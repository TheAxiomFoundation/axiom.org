"use client";

import { memo, useMemo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, Position, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, CheckCircle2, CircleDot, OctagonAlert } from "lucide-react";
import { formatDuration, pct, type FlowModel, type SinkId, type StationStats } from "@/lib/axiom/pipeline-flow";
import { CanvasShell } from "./canvas-shell";
import { pipelineLayout, stationStatus, type RoutedEdge, type Status } from "./flow-layout";
import styles from "./flow.module.css";

const STATUS_COLOR: Record<Status, string> = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
  neutral: "#8f877d",
};

const STATUS_LABEL: Record<Status, string> = {
  good: "On target",
  warning: "Off target",
  critical: "Alert",
  neutral: "No target",
};

export function StatusIcon({ status, size = 12 }: { status: Status; size?: number }) {
  if (status === "critical") return <OctagonAlert size={size} aria-hidden />;
  if (status === "warning") return <AlertTriangle size={size} aria-hidden />;
  if (status === "good") return <CheckCircle2 size={size} aria-hidden />;
  return <CircleDot size={size} aria-hidden />;
}

type StationData = { station: StationStats; status: Status; selected: boolean; selfLoop: number | null; href: string };
type SinkData = { sink: SinkId; label: string; cases: number; href?: string };
type FlowEdgeData = { routed: RoutedEdge; max: number };

function Handles() {
  return (
    <>
      {(["l", "r", "t", "b"] as const).map((side) => {
        const position = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom }[side];
        return (
          <span key={side}>
            <Handle id={`s-${side}`} type="source" position={position} className={styles.handle} isConnectable={false} />
            <Handle id={`t-${side}`} type="target" position={position} className={styles.handle} isConnectable={false} />
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

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 188;
  const h = 22;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return (
    <svg className={styles.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill="rgba(245,158,11,0.12)" stroke="none" />
      <polyline points={pts} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

const StationNode = memo(function StationNode({ data }: NodeProps<Node<StationData>>) {
  const { station: s, status, selected, selfLoop } = data;
  const yieldText = s.tries && s.tries.total ? `${pct(s.tries.ok / s.tries.total)} of ${s.tries.total.toLocaleString("en-US")} tries` : `${s.ok + s.failed + s.cancelled} finished`;
  const hot = s.target?.max_wip != null ? s.wip > s.target.max_wip : s.over_sla > 0;
  return (
    <div
      className={styles.station}
      data-status={status}
      data-selected={selected}
      tabIndex={0}
      aria-label={`${s.label}: yield ${pct(s.yield)}, ${s.wip} open, median ${formatDuration(s.p50_ms)}. ${STATUS_LABEL[status]}.`}
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
          <dd>
            {formatDuration(s.p50_ms)} · {formatDuration(s.p95_ms)}
          </dd>
        </dl>
      </div>
      <div className={styles.stats} style={{ marginTop: 6, gridTemplateColumns: "1fr" }}>
        <dt>
          {yieldText}
          {selfLoop ? ` · ${selfLoop} re-runs` : ""}
        </dt>
      </div>
      <Sparkline values={s.weekly} />
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
  if (routed.kind === "loop" && Math.abs(sourceY - targetY) < 40) {
    // An arc over (or under) the two stations.
    const up = sourcePosition === Position.Top ? -1 : 1;
    const lift = 90 + Math.min(120, Math.abs(sourceX - targetX) * 0.15);
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

const nodeTypes = { station: StationNode, sink: SinkNode };
const edgeTypes = { flow: FlowEdgeView };

export function PipelineCanvas({ model, selected, hrefFor }: { model: FlowModel; selected: string | null; hrefFor: Record<string, string> }) {
  const { nodes, edges } = useMemo(() => {
    const layout = pipelineLayout(model);
    const byId = new Map(model.stations.map((s) => [s.id, s]));
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
    const edges: Edge[] = layout.edges.map((e) => ({
      id: `${e.from}→${e.to}`,
      source: e.from,
      target: e.to,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: "flow",
      zIndex: e.kind === "exit" ? 0 : 1,
      data: { routed: e, max } satisfies FlowEdgeData,
    }));
    return { nodes, edges };
  }, [model, selected, hrefFor]);

  return (
    <CanvasShell
      nodes={nodes}
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
            <i className={styles.line} data-kind="exit" /> left the line
          </span>
          {(["good", "warning", "critical", "neutral"] as Status[]).map((s) => (
            <span key={s} style={{ color: STATUS_COLOR[s] }}>
              <StatusIcon status={s} size={11} /> <span style={{ color: "var(--floor-ink-2)" }}>{STATUS_LABEL[s]}</span>
            </span>
          ))}
          <span>Ring = yield · click a station</span>
        </>
      }
    />
  );
}
