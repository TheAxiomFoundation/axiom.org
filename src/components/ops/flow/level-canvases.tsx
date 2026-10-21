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

/* ── Programs and bundles ── */

export interface ProgramTile {
  id: string;
  title: string;
  bundles: Array<{ id: string; label: string; done: number; documents: number; href: string }>;
  documents: number;
  done: number;
  href: string;
}

const SEQ = ["#3a3026", "#6b4a17", "#a8650c", "#e08a0b", "#fbbf24"];

export function seqColor(share: number): string {
  return SEQ[Math.min(SEQ.length - 1, Math.max(0, Math.floor(share * SEQ.length)))];
}

type BundleTileData = { label: string; done: number; documents: number; href: string };

const BundleTile = memo(function BundleTile({ data }: NodeProps<Node<BundleTileData>>) {
  const share = data.documents ? data.done / data.documents : 0;
  return (
    <div
      className={styles.tile}
      style={{ width: 112, padding: "6px 8px", borderColor: seqColor(share), background: `linear-gradient(180deg, ${seqColor(share)}33, transparent)` }}
      aria-label={`${data.label}: ${data.done} of ${data.documents} provisions encoded`}
    >
      <H side="tb" />
      <b>{data.label}</b>
      {Math.round(share * 100)}% of {data.documents.toLocaleString("en-US")}
    </div>
  );
});

const ProgramNode = memo(function ProgramNode({ data }: NodeProps<Node<{ title: string; done: number; documents: number; bundles: number; href: string }>>) {
  const share = data.documents ? data.done / data.documents : 0;
  return (
    <div className={styles.tile} style={{ width: 220, borderColor: "#f59e0b" }}>
      <H />
      <b style={{ fontSize: 15 }}>{data.title}</b>
      {data.bundles} bundles · {Math.round(share * 100)}% of {data.documents.toLocaleString("en-US")} provisions encoded
      <div className={styles.meter}>
        <i style={{ width: `${share * 100}%`, background: "#fbbf24" }} />
      </div>
    </div>
  );
});

const TILES_PER_ROW = 18;

export function ProgramsCanvas({ programs }: { programs: ProgramTile[] }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let y = 0;
    for (const p of programs) {
      const rows = Math.max(1, Math.ceil(p.bundles.length / TILES_PER_ROW));
      nodes.push({ id: `p:${p.id}`, type: "program", position: { x: 0, y: y + ((rows - 1) * 70) / 2 }, data: { title: p.title, done: p.done, documents: p.documents, bundles: p.bundles.length, href: p.href } });
      p.bundles.forEach((b, i) => {
        const id = `b:${b.id}`;
        nodes.push({ id, type: "bundle", position: { x: 300 + (i % TILES_PER_ROW) * 126, y: y + Math.floor(i / TILES_PER_ROW) * 70 }, data: b satisfies BundleTileData });
        if (i % TILES_PER_ROW === 0) edges.push({ id: `${p.id}>${b.id}`, source: `p:${p.id}`, target: id, type: "weighted", data: { width: 2, color: "#3a3530" } });
      });
      y += rows * 70 + 60;
    }
    return { nodes, edges };
  }, [programs]);
  return (
    <CanvasShell
      nodes={nodes}
      edges={edges}
      nodeTypes={{ program: ProgramNode, bundle: BundleTile }}
      edgeTypes={edgeTypes}
      minimap
      fitIds={programs.length > 4 ? nodes.filter((n) => programs.slice(0, 3).some((p) => n.id === `p:${p.id}` || p.bundles.some((b) => n.id === `b:${b.id}`))).map((n) => n.id) : undefined}
      label="Programs and their bundles by jurisdiction, coloured by provisions encoded"
      legend={
        <>
          {SEQ.map((c, i) => (
            <span key={c}>
              <i className={styles.swatch} style={{ background: c }} />
              {i * 20}–{i * 20 + 20}%
            </span>
          ))}
          <span>provisions encoded, own layer (full bundle) · zoom out for every program · click a tile</span>
        </>
      }
      empty={
        <div className={styles.empty}>
          <p>No program bundles yet. The bundle collector writes encodings.program_bundles.</p>
        </div>
      }
    />
  );
}

export type DocumentTile = {
  key: string;
  name: string;
  part: string;
  status: string;
  provisions: number;
  encoded: number;
  runs: number;
  href: string | null;
};

const STATUS_FILL: Record<string, string> = {
  complete: "#fbbf24",
  unvalidated: "#e08a0b",
  partly: "#a8650c",
  not_started: "#3a3026",
  not_in_corpus: "#1c1a17",
};

const DocNode = memo(function DocNode({ data }: NodeProps<Node<DocumentTile>>) {
  return (
    <div
      className={styles.tile}
      style={{ borderColor: STATUS_FILL[data.status] ?? "#3a3530", borderStyle: data.status === "not_in_corpus" ? "dashed" : "solid", cursor: data.href ? "pointer" : "default" }}
      aria-label={`${data.name}: ${data.status.replace(/_/g, " ")}, ${data.encoded} of ${data.provisions} provisions encoded`}
    >
      <H side="tb" />
      <b>{data.name}</b>
      {data.status.replace(/_/g, " ")} · {data.encoded}/{data.provisions} provisions{data.runs ? ` · ${data.runs} runs` : ""}
      <div className={styles.meter}>
        <i style={{ width: `${data.provisions ? (data.encoded / data.provisions) * 100 : 0}%`, background: STATUS_FILL[data.status] ?? "#8f877d" }} />
      </div>
    </div>
  );
});

const PartNode = memo(function PartNode({ data }: NodeProps<Node<{ text: string; count: number }>>) {
  return (
    <div className={styles.colHead} style={{ width: 180, textAlign: "left", color: "#c9c3bb" }}>
      <H side="tb" />
      {data.text} · {data.count}
    </div>
  );
});

const DOCS_PER_COLUMN = 12;

export function DocumentsCanvas({ documents }: { documents: DocumentTile[] }) {
  const { nodes, edges } = useMemo(() => {
    const parts = [...new Set(documents.map((d) => d.part))];
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    // Each part is a block of columns, DOCS_PER_COLUMN deep, side by side.
    let x = 0;
    parts.forEach((part) => {
      const docs = documents.filter((d) => d.part === part);
      const partId = `part:${part}`;
      nodes.push({ id: partId, type: "part", position: { x, y: 0 }, data: { text: part || "Other", count: docs.length } });
      docs.forEach((d, i) => {
        const id = `doc:${d.key}`;
        nodes.push({ id, type: "doc", position: { x: x + Math.floor(i / DOCS_PER_COLUMN) * 200, y: 50 + (i % DOCS_PER_COLUMN) * 92 }, data: d });
        if (i === 0) edges.push({ id: `${partId}>${id}`, source: partId, target: id, type: "weighted", data: { width: 1.5, color: "#3a3530" } });
      });
      x += Math.ceil(docs.length / DOCS_PER_COLUMN) * 200 + 60;
    });
    return { nodes, edges };
  }, [documents]);
  return (
    <CanvasShell
      nodes={nodes}
      edges={edges}
      nodeTypes={{ doc: DocNode, part: PartNode }}
      edgeTypes={edgeTypes}
      minimap={documents.length > 40}
      fitIds={documents.length > 60 ? nodes.filter((n) => n.position.x < 1400).map((n) => n.id) : undefined}
      label="The bundle's documents by part, coloured by status"
      legend={
        <>
          {Object.entries(STATUS_FILL).map(([k, c]) => (
            <span key={k}>
              <i className={styles.swatch} style={{ background: c, border: k === "not_in_corpus" ? "1px dashed #8f877d" : undefined }} />
              {k.replace(/_/g, " ")}
            </span>
          ))}
          <span>Click a document for its runs</span>
        </>
      }
      empty={
        <div className={styles.empty}>
          <p>This bundle has no documents in the tables yet.</p>
        </div>
      }
    />
  );
}
