"use client";

import { memo, useMemo } from "react";
import { BaseEdge, getBezierPath, getStraightPath, Handle, Position, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { formatDuration, stationLabel, type CaseDetail, type CitationLane, type LaneVisit } from "@/lib/axiom/pipeline-flow";
import { CanvasShell } from "./canvas-shell";
import { laneLayout, LANE_ROW } from "./flow-layout";
import styles from "./flow.module.css";

function H({ side = "lr" }: { side?: "lr" | "tb" }) {
  return side === "lr" ? (
    <>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </>
  ) : (
    <>
      <Handle type="target" position={Position.Top} className={styles.handle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={styles.handle} isConnectable={false} />
    </>
  );
}

const OUTCOME_COLOR: Record<string, string> = { ok: "#0ca30c", fail: "#d03b3b", cancel: "#8f877d", open: "#fab219" };

const WeightedEdge = memo(function WeightedEdge(props: EdgeProps<Edge<{ width: number; color: string; dashed?: boolean; straight?: boolean }>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, id } = props;
  const [path] = data?.straight
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{ stroke: data?.color ?? "#8f877d", strokeWidth: data?.width ?? 1.5, strokeOpacity: 0.6, strokeDasharray: data?.dashed ? "4 4" : undefined }}
    />
  );
});

const edgeTypes = { weighted: WeightedEdge };

/* ── Citation lanes ── */

type PipData = { visits: number; outcome: string; label: string; href: string };
type LaneData = { lane: CitationLane; href: string };

const PipNode = memo(function PipNode({ data }: NodeProps<Node<PipData>>) {
  return (
    <div className={styles.pip} data-outcome={data.outcome} title={data.label} aria-label={data.label}>
      <H />
      {data.visits > 1 ? data.visits : ""}
    </div>
  );
});

const LaneLabelNode = memo(function LaneLabelNode({ data }: NodeProps<Node<LaneData>>) {
  const { lane } = data;
  return (
    <div className={styles.laneLabel} data-end={lane.end}>
      <b>{lane.end}</b>
      {new Date(lane.start).toISOString().slice(0, 16).replace("T", " ")} · {lane.source === "pipeline_attempts" || lane.source === "failure_bundle" ? lane.case_id.slice(0, 22) : lane.source}
    </div>
  );
});

const ColHeadNode = memo(function ColHeadNode({ data }: NodeProps<Node<{ text: string }>>) {
  return <div className={styles.colHead}>{data.text}</div>;
});

export function LanesCanvas({ lanes, stationOrder, caseHref }: { lanes: CitationLane[]; stationOrder: string[]; caseHref: Record<string, string> }) {
  const { nodes, edges } = useMemo(() => {
    const layout = laneLayout(lanes, stationOrder);
    const nodes: Node[] = [];
    layout.columns.forEach((station) => {
      if (!layout.pips.some((p) => p.station === station)) return;
      nodes.push({ id: `col:${station}`, type: "col", position: { x: layout.colX.get(station)! - 45, y: 0 }, data: { text: stationLabel(station) }, selectable: false });
    });
    lanes.forEach((lane, row) => {
      nodes.push({ id: `lane:${lane.case_id}`, type: "lane", position: { x: 0, y: 40 + row * LANE_ROW - 8 }, data: { lane, href: caseHref[lane.case_id] } satisfies LaneData });
    });
    for (const p of layout.pips) {
      const label = `${stationLabel(p.station)}: ${p.outcome}${p.visits > 1 ? `, ${p.visits} visits` : ""}${p.rule ? ` (${p.rule})` : ""}`;
      nodes.push({ id: p.id, type: "pip", position: { x: p.x, y: p.y }, data: { visits: p.visits, outcome: p.outcome, label, href: caseHref[p.lane] } satisfies PipData });
    }
    const edges: Edge[] = layout.links.map((l) => ({ id: l.id, source: l.from, target: l.to, type: "weighted", data: { width: 2, color: OUTCOME_COLOR[l.outcome] ?? "#8f877d", straight: true, dashed: l.outcome === "open" } }));
    return { nodes, edges };
  }, [lanes, stationOrder, caseHref]);
  return (
    <CanvasShell
      nodes={nodes}
      edges={edges}
      nodeTypes={{ pip: PipNode, lane: LaneLabelNode, col: ColHeadNode }}
      edgeTypes={edgeTypes}
      minimap={lanes.length > 20}
      fitIds={lanes.length > 14 ? nodes.filter((n) => n.type === "col" || lanes.slice(0, 12).some((l) => n.id === `lane:${l.case_id}` || n.id.startsWith(`${l.case_id}|`))).map((n) => n.id) : undefined}
      label="Every case of this citation, station by station"
      legend={
        <>
          {(["ok", "fail", "cancel", "open"] as const).map((o) => (
            <span key={o}>
              <i className={styles.swatch} style={{ background: o === "open" ? "transparent" : OUTCOME_COLOR[o], border: o === "open" ? "2px dashed #fab219" : undefined }} />
              {{ ok: "passed", fail: "failed", cancel: "cancelled", open: "waiting" }[o]}
            </span>
          ))}
          <span>A number = visits (tries). Click a row for the run.</span>
        </>
      }
      empty={
        <div className={styles.empty}>
          <p>No cases for this citation in the event log.</p>
        </div>
      }
    />
  );
}

/* ── One run ── */

type VisitData = { visit: LaneVisit; issues: number };

const VisitNode = memo(function VisitNode({ data }: NodeProps<Node<VisitData>>) {
  const v = data.visit;
  return (
    <div className={styles.visit} data-outcome={v.outcome}>
      <H />
      <b>
        {stationLabel(v.station)}
        {v.try_no != null && (v.station === "generate" || v.station === "validate") ? ` · try ${v.try_no}` : ""}
      </b>
      {v.outcome === "open" ? "waiting" : v.waived ? "waived" : v.outcome} · {formatDuration(v.duration_ms)}
      {v.actor ? ` · ${v.actor}` : ""}
      {v.cost_usd != null ? ` · $${v.cost_usd.toFixed(3)}` : ""}
      {data.issues ? ` · ${data.issues} issues` : ""}
      {v.rule_id ? <code>{v.rule_id}</code> : null}
      {v.reason && !v.rule_id ? <code>{v.reason}</code> : null}
    </div>
  );
});

export function CaseCanvas({ detail, stationOrder }: { detail: CaseDetail; stationOrder: string[] }) {
  const { nodes, edges } = useMemo(() => {
    const issuesByTry = new Map<number, number>();
    for (const i of detail.issues) if (i.try_no != null) issuesByTry.set(i.try_no, (issuesByTry.get(i.try_no) ?? 0) + 1);
    // A column per station in rank order; the tries of the loop stack down.
    const col = new Map(stationOrder.map((s, i) => [s, i]));
    let extra = stationOrder.length;
    const rowAt = new Map<string, number>();
    const nodes: Node[] = detail.visits.map((v, i) => {
      if (!col.has(v.station)) col.set(v.station, extra++);
      const row = rowAt.get(v.station) ?? 0;
      rowAt.set(v.station, row + 1);
      return {
        id: `v${i}`,
        type: "visit",
        position: { x: col.get(v.station)! * 240, y: row * 120 },
        data: { visit: v, issues: v.station === "validate" && v.try_no != null ? (issuesByTry.get(v.try_no) ?? 0) : 0 } satisfies VisitData,
      };
    });
    // Compact the columns no visit uses.
    const used = [...new Set(nodes.map((n) => n.position.x))].sort((a, b) => a - b);
    for (const n of nodes) n.position.x = used.indexOf(n.position.x) * 240;
    const edges: Edge[] = detail.visits.slice(1).map((v, i) => {
      const back = nodes[i + 1].position.x < nodes[i].position.x;
      return {
        id: `e${i}`,
        source: `v${i}`,
        target: `v${i + 1}`,
        type: "weighted",
        data: { width: 2, color: back ? "#fab219" : OUTCOME_COLOR[detail.visits[i].outcome] ?? "#8f877d", straight: back },
      };
    });
    return { nodes, edges };
  }, [detail, stationOrder]);
  return (
    <CanvasShell
      nodes={nodes}
      edges={edges}
      nodeTypes={{ visit: VisitNode }}
      edgeTypes={edgeTypes}
      label="One run, visit by visit"
      legend={
        <>
          <span>
            <i className={styles.line} data-kind="loop" /> back for another try
          </span>
          <span>Left border: green passed, red failed, grey cancelled, dashed waiting</span>
        </>
      }
    />
  );
}
