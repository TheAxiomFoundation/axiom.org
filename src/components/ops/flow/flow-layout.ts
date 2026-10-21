/**
 * Positions for each zoom level's graph. Pure functions over the mined
 * model, so the layout is tested without a browser and every coordinate
 * follows from data (the stations' ranks, the cases' visits).
 */

import type { CitationLane, FlowAlert, FlowEdge, FlowModel, SinkId, StationStats } from "@/lib/axiom/pipeline-flow";

export type Status = "good" | "warning" | "critical" | "neutral";

export const STATION_W = 216;
export const STATION_H = 150;
export const COL = 320;
/** Row pitch: a station plus an aisle wide enough for a loop arc. */
const ROW = STATION_H + 150;
/** Stations per row before the floor turns back (a serpentine line). */
const MAX_PER_ROW = 7;
/** Space around the graph when it is fitted to the canvas. */
export const FIT_PAD = 40;

/** A station's status: its worst alert, else good when it has targets, else neutral. */
export function stationStatus(station: StationStats, alerts: FlowAlert[]): Status {
  const own = alerts.filter((a) => a.station === station.id);
  if (own.some((a) => a.severity === "critical")) return "critical";
  if (own.some((a) => a.severity === "warning")) return "warning";
  return station.target ? "good" : "neutral";
}

/**
 * How many stations fit on one row of a canvas this wide, read at a zoom of
 * at least `minZoom`. Between 3 and 7: fewer rows on a wide screen, more
 * rows (and a taller canvas) on a narrow one.
 */
export function stationsPerRow(canvasWidth: number, minZoom = 0.8): number {
  const fits = Math.floor((canvasWidth / minZoom - 2 * FIT_PAD - STATION_W) / COL) + 1;
  return Math.max(3, Math.min(MAX_PER_ROW, fits));
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
  /** Cases that left the line at each station (its exit edges). */
  exits: Map<string, number>;
  /** The graph's extent, for sizing the canvas. */
  width: number;
  height: number;
}

const SINK_W = 132;
const SINK_H = 64;

/**
 * The station floor: stations in rank order on a serpentine line (left to
 * right, then right to left below). Landed takes the next slot on the line
 * after the last station (below it when the row is full); Failed and
 * Cancelled sit in a row under the floor, so no sink lies in an aisle.
 */
export function pipelineLayout(model: Pick<FlowModel, "stations" | "edges" | "sinks">, maxPerRow = MAX_PER_ROW): PipelineLayout {
  const ordered = [...model.stations].sort((a, b) => a.rank - b.rank || a.position - b.position);
  const rowsNeeded = Math.ceil(ordered.length / Math.max(1, maxPerRow));
  // Balance the rows: 14 stations on 4-wide rows become 4+4+4+2, not 7+7 squeezed.
  const perRow = Math.max(1, Math.ceil(ordered.length / Math.max(1, rowsNeeded)));
  const slot = (i: number) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    return { row, x: row % 2 === 0 ? col * COL : (perRow - 1 - col) * COL, y: row * ROW };
  };
  const stations: Placed[] = ordered.map((s, i) => ({ id: s.id, ...slot(i) }));
  const width = (Math.min(perRow, ordered.length) - 1) * COL + STATION_W;
  const at = new Map(stations.map((p) => [p.id, p]));
  let bottom = stations.length ? Math.max(...stations.map((p) => p.y)) + STATION_H : 0;

  const sinks: PipelineLayout["sinks"] = [];
  const last = stations.at(-1);
  const landed = model.sinks.find((s) => s.id === "exit:landed");
  if (landed && last) {
    const next = slot(stations.length);
    const room = stations.length % perRow !== 0;
    const pos = room
      ? { x: next.x + (STATION_W - SINK_W) / 2, y: last.y + (STATION_H - SINK_H) / 2, row: last.row }
      : { x: last.x + (STATION_W - SINK_W) / 2, y: last.y + STATION_H + 70, row: last.row + 1 };
    sinks.push({ id: landed.id, sink: landed.id, ...pos });
    bottom = Math.max(bottom, pos.y + SINK_H);
  }
  const others = model.sinks.filter((s) => s.id !== "exit:landed");
  if (others.length) {
    const y = bottom + 70;
    const span = others.length * SINK_W + (others.length - 1) * 40;
    others.forEach((sink, i) => sinks.push({ id: sink.id, sink: sink.id, x: (width - span) / 2 + i * (SINK_W + 40), y, row: -1 }));
    bottom = y + SINK_H;
  }
  for (const s of sinks) at.set(s.id, s);

  const selfLoops = new Map<string, number>();
  const exits = new Map<string, number>();
  const edges: RoutedEdge[] = [];
  // Edges with a handful of cases (a stray order of events) are noise at
  // this zoom: under 0.5% of the busiest edge, and under 3 cases, are left out.
  const busiest = Math.max(1, ...model.edges.map((e) => e.cases));
  const floor = Math.max(3, busiest * 0.005);
  for (const e of model.edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    const kind: RoutedEdge["kind"] = e.to.startsWith("exit:") && e.to !== "exit:landed" ? "exit" : e.loop ? "loop" : "main";
    if (kind === "exit" && a) exits.set(e.from, (exits.get(e.from) ?? 0) + e.cases);
    if (e.cases < floor && e.from !== e.to) continue;
    if (!a || !b) continue;
    if (e.from === e.to) {
      selfLoops.set(e.from, e.cases);
      continue;
    }
    edges.push({ ...e, kind, ...handles(a, b, kind) });
  }
  return { stations, sinks, edges, selfLoops, exits, width, height: bottom };
}

function handles(a: Placed, b: Placed, kind: RoutedEdge["kind"]): Pick<RoutedEdge, "sourceHandle" | "targetHandle"> {
  // A retry on one row arcs through the aisle under it, never over the top edge of the floor.
  if (kind === "loop") return a.row === b.row ? { sourceHandle: "s-b", targetHandle: "t-b" } : { sourceHandle: "s-t", targetHandle: "t-b" };
  if (kind === "exit") return a.y < b.y ? { sourceHandle: "s-b", targetHandle: "t-t" } : { sourceHandle: "s-t", targetHandle: "t-b" };
  if (a.row === b.row) return a.x < b.x ? { sourceHandle: "s-r", targetHandle: "t-l" } : { sourceHandle: "s-l", targetHandle: "t-r" };
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
