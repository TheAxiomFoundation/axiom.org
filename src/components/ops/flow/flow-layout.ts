/**
 * Positions for each zoom level's graph. Pure functions over the mined
 * model, so the layout is tested without a browser and every coordinate
 * follows from data (the stations' ranks, the cases' visits).
 */

import type { CitationLane, FlowAlert, FlowEdge, FlowModel, SinkId, StationStats } from "@/lib/axiom/pipeline-flow";

export type Status = "good" | "warning" | "critical" | "neutral";

export const STATION_W = 216;
export const STATION_H = 150;
const COL = 320;
const ROW = 430;
/** Stations per row before the floor turns back (a serpentine line). */
const MAX_PER_ROW = 7;

/** A station's status: its worst alert, else good when it has targets, else neutral. */
export function stationStatus(station: StationStats, alerts: FlowAlert[]): Status {
  const own = alerts.filter((a) => a.station === station.id);
  if (own.some((a) => a.severity === "critical")) return "critical";
  if (own.some((a) => a.severity === "warning")) return "warning";
  return station.target ? "good" : "neutral";
}

export type Side = "l" | "r" | "t" | "b";

export interface Placed {
  id: string;
  x: number;
  y: number;
  row: number;
}

export interface RoutedEdge extends FlowEdge {
  kind: "main" | "loop" | "exit";
  sourceHandle: `s-${Side}`;
  targetHandle: `t-${Side}`;
}

export interface PipelineLayout {
  stations: Placed[];
  sinks: Array<Placed & { sink: SinkId }>;
  edges: RoutedEdge[];
  /** Self loops (a station straight back to itself), shown on the node. */
  selfLoops: Map<string, number>;
}

/**
 * The station floor: stations in rank order on a serpentine line (left to
 * right, then right to left below), the Failed and Cancelled sinks in the
 * aisle between the rows, Landed after the last station.
 */
export function pipelineLayout(model: Pick<FlowModel, "stations" | "edges" | "sinks">): PipelineLayout {
  const ordered = [...model.stations].sort((a, b) => a.rank - b.rank || a.position - b.position);
  const perRow = ordered.length > MAX_PER_ROW ? Math.ceil(ordered.length / 2) : ordered.length;
  const stations: Placed[] = ordered.map((s, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = row % 2 === 0 ? col * COL : (perRow - 1 - col) * COL;
    return { id: s.id, x, y: row * ROW, row };
  });
  const rows = Math.max(1, Math.ceil(ordered.length / perRow));
  const width = (perRow - 1) * COL + STATION_W;
  const at = new Map(stations.map((p) => [p.id, p]));
  const aisleY = rows > 1 ? STATION_H + (ROW - STATION_H) / 2 - 30 : STATION_H + 120;

  const sinks: PipelineLayout["sinks"] = [];
  for (const sink of model.sinks) {
    if (sink.id === "exit:landed") {
      const last = stations.at(-1);
      if (!last) continue;
      // Below the last station, off the line, so the edges into it cross nothing.
      sinks.push({ id: sink.id, sink: sink.id, x: last.x + STATION_W / 2 - 66, y: last.y + STATION_H + 110, row: last.row + 1 });
    } else if (sink.id === "exit:failed") {
      sinks.push({ id: sink.id, sink: sink.id, x: width / 2 - 66, y: aisleY, row: 0 });
    } else {
      sinks.push({ id: sink.id, sink: sink.id, x: width / 2 - 66 - COL * 1.4, y: aisleY, row: 0 });
    }
  }
  for (const s of sinks) at.set(s.id, s);

  const selfLoops = new Map<string, number>();
  const edges: RoutedEdge[] = [];
  // Edges with a handful of cases (a stray order of events) are noise at
  // this zoom: under 0.5% of the busiest edge, and under 3 cases, are left out.
  const busiest = Math.max(1, ...model.edges.map((e) => e.cases));
  const floor = Math.max(3, busiest * 0.005);
  for (const e of model.edges) {
    if (e.cases < floor && e.from !== e.to) continue;
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) continue;
    if (e.from === e.to) {
      selfLoops.set(e.from, e.cases);
      continue;
    }
    const kind: RoutedEdge["kind"] = e.to.startsWith("exit:") && e.to !== "exit:landed" ? "exit" : e.loop ? "loop" : "main";
    edges.push({ ...e, kind, ...handles(a, b, kind) });
  }
  return { stations, sinks, edges, selfLoops };
}

function handles(a: Placed, b: Placed, kind: RoutedEdge["kind"]): Pick<RoutedEdge, "sourceHandle" | "targetHandle"> {
  if (kind === "loop") return a.y === b.y ? { sourceHandle: a.row % 2 === 0 ? "s-t" : "s-b", targetHandle: a.row % 2 === 0 ? "t-t" : "t-b" } : { sourceHandle: "s-t", targetHandle: "t-b" };
  if (kind === "exit") return a.y < b.y ? { sourceHandle: "s-b", targetHandle: "t-t" } : { sourceHandle: "s-t", targetHandle: "t-b" };
  if (Math.abs(a.y - b.y) < 40) return a.x < b.x ? { sourceHandle: "s-r", targetHandle: "t-l" } : { sourceHandle: "s-l", targetHandle: "t-r" };
  return a.y < b.y ? { sourceHandle: "s-b", targetHandle: "t-t" } : { sourceHandle: "s-t", targetHandle: "t-b" };
}

export const LANE_COL = 132;
export const LANE_ROW = 56;
const LANE_LABEL_W = 270;

/**
 * One citation's cases as lanes: a row per case (newest first), a column per
 * station in the pipeline's rank order, a pip per visit (tries of a loop
 * station stack into one pip with a count).
 */
export function laneLayout(lanes: CitationLane[], stationOrder: string[]) {
  const columns = [...stationOrder];
  for (const lane of lanes) for (const v of lane.visits) if (!columns.includes(v.station)) columns.push(v.station);
  const colX = new Map(columns.map((s, i) => [s, LANE_LABEL_W + i * LANE_COL]));
  const pips: Array<{ id: string; lane: string; station: string; x: number; y: number; visits: number; outcome: string; rule: string | null }> = [];
  const links: Array<{ id: string; from: string; to: string; outcome: string }> = [];
  lanes.forEach((lane, row) => {
    const y = 40 + row * LANE_ROW;
    const byStation = new Map<string, { count: number; outcome: string; rule: string | null }>();
    const order: string[] = [];
    for (const v of lane.visits) {
      const entry = byStation.get(v.station) ?? { count: 0, outcome: v.outcome, rule: null };
      entry.count++;
      entry.outcome = v.outcome;
      if (v.rule_id) entry.rule = v.rule_id;
      if (!byStation.has(v.station)) order.push(v.station);
      byStation.set(v.station, entry);
    }
    let prev: string | null = null;
    for (const station of order) {
      const entry = byStation.get(station)!;
      const id = `${lane.case_id}|${station}`;
      pips.push({ id, lane: lane.case_id, station, x: colX.get(station)!, y, visits: entry.count, outcome: entry.outcome, rule: entry.rule });
      if (prev) links.push({ id: `${prev}>${id}`, from: prev, to: id, outcome: entry.outcome });
      prev = id;
    }
  });
  return { columns, colX, pips, links, labelX: 0 };
}
