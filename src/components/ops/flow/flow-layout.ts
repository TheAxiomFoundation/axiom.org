/**
 * Positions for each zoom level's graph. Pure functions over the mined
 * model, so the layout is tested without a browser and every coordinate
 * follows from data (the stations' ranks, the cases' visits).
 */

import type { CitationLane, FlowAlert, FlowModel, StationStats } from "@/lib/axiom/pipeline-flow";

export type Status = "good" | "warning" | "critical" | "neutral";

/** A station's status: its worst alert, else good when it has targets, else neutral. */
export function stationStatus(station: StationStats, alerts: FlowAlert[]): Status {
  const own = alerts.filter((a) => a.station === station.id);
  if (own.some((a) => a.severity === "critical")) return "critical";
  if (own.some((a) => a.severity === "warning")) return "warning";
  return station.target ? "good" : "neutral";
}

/** The widest flow band on the process map, in px. */
export const BAND_MAX = 72;

/** A band's width for n cases against the busiest station: linear, at least 2px when there are any. */
export function bandWidth(n: number, max: number): number {
  return n > 0 && max > 0 ? Math.max(2, Math.round((n / max) * BAND_MAX)) : 0;
}

const T_MIN = 60_000;
const T_MAX = 30 * 86_400_000;

/** The time axis's marks: one log scale, from a minute to a month, for every station. */
export const TIME_TICKS = [
  { label: "1m", ms: T_MIN },
  { label: "1h", ms: 3_600_000 },
  { label: "1d", ms: 86_400_000 },
  { label: "1w", ms: 7 * 86_400_000 },
  { label: "30d", ms: T_MAX },
];

/** A duration's place on the time axis, 0 to 1; under a minute sits at 0, null without a time. */
export function timeShare(ms: number | null): number | null {
  if (ms == null || ms <= 0) return null;
  const v = (Math.log10(Math.max(ms, T_MIN)) - Math.log10(T_MIN)) / (Math.log10(T_MAX) - Math.log10(T_MIN));
  return Math.min(1, Math.max(0, v));
}

export interface EndSegment {
  key: string;
  kind: "landed" | "exit" | "open";
  label: string;
  cases: number;
  station: string | null;
}

/**
 * Where the window's cases ended, in line order: landed, then the exits of
 * each station (failed and cancelled), then those still in the line. The
 * segments add up to the window's cases.
 */
export function lineEnds(model: Pick<FlowModel, "stations" | "totals">): EndSegment[] {
  const segments: EndSegment[] = [];
  if (model.totals.landed) segments.push({ key: "landed", kind: "landed", label: "Landed", cases: model.totals.landed, station: null });
  for (const s of model.stations) {
    const n = s.flow.failed_here + s.flow.cancelled_here;
    if (n) segments.push({ key: `exit:${s.id}`, kind: "exit", label: s.label, cases: n, station: s.id });
  }
  if (model.totals.open) segments.push({ key: "open", kind: "open", label: "Still in the line", cases: model.totals.open, station: null });
  return segments;
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
