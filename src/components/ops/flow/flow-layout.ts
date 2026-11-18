/**
 * Positions for each zoom level's graph. Pure functions over the mined
 * model, so the layout is tested without a browser and every coordinate
 * follows from data (the stations' ranks, the cases' visits).
 */

import type { CitationLane, FlowAlert, FlowEdge, FlowModel, SinkId, StationStats } from "@/lib/axiom/pipeline-flow";

export type Status = "good" | "warning" | "critical" | "neutral";

/** A station's status: its worst alert, else good when it has targets, else neutral. */
export function stationStatus(station: StationStats, alerts: FlowAlert[]): Status {
  const own = alerts.filter((a) => a.station === station.id);
  if (own.some((a) => a.severity === "critical")) return "critical";
  if (own.some((a) => a.severity === "warning")) return "warning";
  return station.target ? "good" : "neutral";
}

export const STATION_W = 216;
/** A station box's fixed height: the node is drawn at exactly this size, so the aisles stay clear. */
export const STATION_H = 196;
export const COL = 320;
/** Row pitch: a station plus an aisle wide enough for a loop arc. */
const ROW = STATION_H + 150;
/** Stations per row before the floor turns back (a serpentine line). */
const MAX_PER_ROW = 7;
/** Space around the graph when it is fitted to the canvas. */
export const FIT_PAD = 40;
/** The channel right of the floor that exit lines run down to the Failed and Cancelled sinks. */
const DRAIN_GUTTER = 80;
/** How far under a row's boxes its exit lines run: below the arcs of that row, above the next row. */
const LANE_DROP = 118;
/** Space between parallel exit lines. */
const DRAIN_STEP = 7;

/**
 * How many stations fit on one row of a canvas this wide, read at a zoom of
 * at least `minZoom`. Between 3 and 7: fewer rows on a wide screen, more
 * rows (and a taller canvas) on a narrow one.
 */
export function stationsPerRow(canvasWidth: number, minZoom = 0.8): number {
  const fits = Math.floor((canvasWidth / minZoom - 2 * FIT_PAD - STATION_W - DRAIN_GUTTER) / COL) + 1;
  return Math.max(3, Math.min(MAX_PER_ROW, fits));
}

/** Box sides; "bl" and "br" are the bottom's left and right quarters, where arcs under a row start and end. */
export type Side = "l" | "r" | "t" | "b" | "bl" | "br";

export interface Placed {
  id: string;
  x: number;
  y: number;
  row: number;
  /** Box width: stations and sinks differ, so neighbours are judged by their centres. */
  w: number;
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
  /** Exit lines, routed around every box: down under the row, right to the gutter, down, and left into the sink. */
  drains: Drain[];
  /** Edges left out because any route would cross a row of stations: shown as a note on the source station. */
  offRoute: Map<string, Array<{ to: string; cases: number; loop: boolean }>>;
  /** The graph's extent, for sizing the canvas. */
  width: number;
  height: number;
}

export interface Drain {
  from: string;
  to: SinkId;
  cases: number;
  /** The corners of the line, in floor coordinates. */
  points: Array<[number, number]>;
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
  const stations: Placed[] = ordered.map((s, i) => ({ id: s.id, w: STATION_W, ...slot(i) }));
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
      ? { x: next.x + (STATION_W - SINK_W) / 2, y: last.y + (STATION_H - SINK_H) / 2, row: last.row, w: SINK_W }
      : { x: last.x + (STATION_W - SINK_W) / 2, y: last.y + STATION_H + 70, row: last.row + 1, w: SINK_W };
    sinks.push({ id: landed.id, sink: landed.id, ...pos });
    bottom = Math.max(bottom, pos.y + SINK_H);
  }
  // The lane under each row that its exit lines run along; under the last
  // row it also clears a Landed sink placed below it.
  const landedBelow = sinks.find((x) => x.sink === "exit:landed" && last && x.row > last.row);
  const laneY = (row: number) => {
    const y = row * ROW + STATION_H + LANE_DROP;
    return landedBelow && last && row === last.row ? Math.max(y, landedBelow.y + SINK_H + 24) : y;
  };

  const busiest = Math.max(1, ...model.edges.map((e) => e.cases));
  const floor = Math.max(3, busiest * 0.005);
  const exitEdges = model.edges
    .filter((e) => (e.to === "exit:failed" || e.to === "exit:cancelled") && e.cases >= floor && at.has(e.from))
    .sort((a, b) => stations.findIndex((p) => p.id === a.from) - stations.findIndex((p) => p.id === b.from) || a.to.localeCompare(b.to));
  const others = model.sinks.filter((s) => s.id !== "exit:landed");
  const drains: Drain[] = [];
  if (others.length) {
    const deepestLane = Math.max(bottom, ...stations.map((p) => laneY(p.row) + DRAIN_STEP * 2));
    const n = exitEdges.length;
    const bottomLane = deepestLane + 30;
    // Under the floor, right-aligned, so the lines come down the gutter and turn left into them.
    const y = bottomLane + n * DRAIN_STEP + 40;
    const span = others.length * SINK_W + (others.length - 1) * 40;
    others.forEach((sink, i) => sinks.push({ id: sink.id, sink: sink.id, x: width - span + i * (SINK_W + 40), y, row: -1, w: SINK_W }));
    bottom = y + SINK_H;
    const into = new Map<string, number>();
    const perSink = new Map<string, number>();
    for (const e of exitEdges) perSink.set(e.to, (perSink.get(e.to) ?? 0) + 1);
    exitEdges.forEach((e, j) => {
      const a = at.get(e.from)!;
      const sink = sinks.find((x) => x.sink === e.to);
      if (!sink) return;
      const cancel = e.to === "exit:cancelled";
      // The top row's lines run outermost, so lines from lower rows join inside them.
      const outer = (n - 1 - j) * DRAIN_STEP;
      const sx = a.x + STATION_W - 18 - (cancel ? 10 : 0);
      const lane = laneY(a.row) + (cancel ? DRAIN_STEP : 0);
      const gx = width + 36 + outer;
      const by = bottomLane + outer;
      // Into the sink as one bundle: the outer (lower) line lands rightmost, so no line crosses another on the way in.
      const k = into.get(e.to) ?? 0;
      into.set(e.to, k + 1);
      const count = perSink.get(e.to) ?? 1;
      const tx = sink.x + SINK_W / 2 - ((count - 1) * DRAIN_STEP) / 2 + (count - 1 - k) * DRAIN_STEP;
      drains.push({
        from: e.from,
        to: e.to as SinkId,
        cases: e.cases,
        points: [
          [sx, a.y + STATION_H],
          [sx, lane],
          [gx, lane],
          [gx, by],
          [tx, by],
          [tx, sink.y],
        ],
      });
    });
  }
  for (const s of sinks) at.set(s.id, s);

  const selfLoops = new Map<string, number>();
  const exits = new Map<string, number>();
  const edges: RoutedEdge[] = [];
  // Edges with a handful of cases (a stray order of events) are noise at
  // this zoom: under 0.5% of the busiest edge, and under 3 cases, are left out
  // (floor, above).
  const offRoute = new Map<string, Array<{ to: string; cases: number; loop: boolean }>>();
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
    if (kind === "exit") continue;
    const route = handles(a, b, kind);
    if (!route) {
      const list = offRoute.get(e.from) ?? [];
      list.push({ to: e.to, cases: e.cases, loop: kind === "loop" });
      offRoute.set(e.from, list);
      continue;
    }
    edges.push({ ...e, kind, ...route });
  }
  const extent = drains.length ? width + 36 + drains.length * DRAIN_STEP + 12 : width;
  return { stations, sinks, edges, selfLoops, exits, drains, offRoute, width: extent, height: bottom };
}

/**
 * How an edge leaves and enters its boxes, chosen so it crosses no box:
 * neighbours on a row meet side to side; a skip or a step back on a row
 * arcs through the aisle under it, from the inner quarters of the two
 * boxes (clear of the centre, where the line turns down to the next row);
 * adjacent rows meet bottom to top through the aisle between them. An edge
 * across a whole row of stations has no clear route: null.
 */
function handles(a: Placed, b: Placed, kind: RoutedEdge["kind"]): Pick<RoutedEdge, "sourceHandle" | "targetHandle"> | null {
  const rowA = a.row < 0 ? Infinity : a.row;
  const rowB = b.row < 0 ? Infinity : b.row;
  if (rowA === rowB) {
    const adjacent = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) <= COL + 1;
    if (adjacent && kind !== "loop") return a.x < b.x ? { sourceHandle: "s-r", targetHandle: "t-l" } : { sourceHandle: "s-l", targetHandle: "t-r" };
    return a.x < b.x ? { sourceHandle: "s-br", targetHandle: "t-bl" } : { sourceHandle: "s-bl", targetHandle: "t-br" };
  }
  if (Math.abs(rowA - rowB) !== 1) return null;
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
