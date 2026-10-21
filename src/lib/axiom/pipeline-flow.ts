/**
 * Process mining over the pipeline event log (see pipeline-events.ts):
 * the station graph /ops/flow draws, the variants, the issue ladder across
 * tries, alerts, and the brief agents read before they dispatch.
 *
 * Nothing here knows the pipeline's shape. Stations are whatever the events
 * name; their order and edges come from the order cases visit them; yields,
 * times and rates are counted from events; targets come from
 * encodings.pipeline_station_targets. Only the display names below are copy.
 */

import type { PipelineEvent } from "./pipeline-events";

export const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Display names and one-line meanings. An unknown station shows its id. */
export const STATION_COPY: Record<string, { label: string; description: string }> = {
  corpus_ingest: { label: "Corpus ingest", description: "Source documents enter the corpus." },
  release_publish: { label: "Release publish", description: "A signed corpus release is uploaded." },
  release_activate: { label: "Release activate", description: "The site starts to serve the release." },
  target_gate: { label: "Target gate", description: "A citation is checked before it can be queued." },
  dispatch: { label: "Dispatch", description: "A targeted re-encode run is queued." },
  approval: { label: "Signing approval", description: "The production-signing environment waits for a person." },
  setup: { label: "Setup", description: "Checkouts, corpus fetch and identity checks before the encoder runs." },
  generate: { label: "Generate", description: "The model writes a candidate. One visit per try." },
  validate: { label: "Validate", description: "Checks judge the candidate. A failed try loops back to Generate." },
  publish: { label: "Sign & open PR", description: "Package, sign, and open the manifest PR." },
  pr_checks: { label: "PR checks", description: "CI on the signed manifest PR." },
  review: { label: "Review", description: "Review and the merge decision." },
  merge: { label: "Merge", description: "Into the default branch, directly or through a side branch's PR." },
  index: { label: "Index", description: "The rulespec_files sync picks the module up." },
  compile: { label: "Compile", description: "axiom-api's nightly compile sweep." },
  tests: { label: "Tests on main", description: "The jurisdiction's validation on the default branch." },
  oracle: { label: "Oracle", description: "The axiom-oracles comparison against a reference model." },
};

export function stationLabel(id: string): string {
  return STATION_COPY[id]?.label ?? id.replace(/_/g, " ");
}

export type SinkId = "exit:landed" | "exit:failed" | "exit:cancelled";

export const SINK_LABELS: Record<SinkId, string> = {
  "exit:landed": "Landed",
  "exit:failed": "Failed",
  "exit:cancelled": "Cancelled",
};

export interface StationTarget {
  station: string;
  min_yield: number | null;
  max_p95_hours: number | null;
  max_wip: number | null;
  sla_hours: number | null;
  note?: string | null;
}

export interface RuleCount {
  rule_id: string;
  count: number;
  cases: number;
  example: string | null;
  last_at: string;
}

export interface OpenItem {
  case_id: string;
  citation: string;
  since: string;
  /** Why it waits, when an event says (a failing check, a reviewer). */
  reason: string | null;
  ref_url: string | null;
}

export interface StationStats {
  id: string;
  label: string;
  description: string;
  /** Cases in the window that reached the station. */
  cases: number;
  ok: number;
  failed: number;
  cancelled: number;
  /** Of ok: left under a waiver, not a pass. */
  waived: number;
  /** ok / (ok + failed + cancelled) over finished visits; null with none. */
  yield: number | null;
  /** For a station visited once per try: tries and tries that passed. */
  tries: { total: number; ok: number } | null;
  /** Open now, over all time (a case waits at a station until it leaves). */
  wip: number;
  p50_ms: number | null;
  p95_ms: number | null;
  /** Visits finished per week, oldest week first. */
  weekly: number[];
  failures: RuleCount[];
  oldest: OpenItem[];
  /** Open items older than the station's SLA. */
  over_sla: number;
  target: StationTarget | null;
  /** Mean position in case paths. */
  position: number;
  /** Column in the flow: the longest path to it over forward edges. */
  rank: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  cases: number;
  /** Median time from leaving `from` to entering `to`. */
  median_wait_ms: number | null;
  /** Most of its traffic goes back to a station the case visited before. */
  loop: boolean;
}

export interface Variant {
  path: string[];
  end: string;
  cases: number;
  share: number;
  median_lead_ms: number | null;
  /** Median visits of the most-repeated station (tries of the encode loop). */
  median_repeats: number;
  example_case: string;
  example_citation: string;
}

export interface RuleTrajectory {
  rule_id: string;
  /** Try sets the rule was in. */
  occurrences: number;
  cases: number;
  /** Of try sets with a next try: the rule was in the next try too. */
  persisted: number;
  /** ... the rule was gone in the next try. */
  fixed: number;
  /** Rules that first showed up in the try right after this one, most first. */
  followed_by: Array<{ rule_id: string; count: number }>;
  /** Cases that hit the rule and still passed on a later try. */
  recovered: number;
  /** persisted / (persisted + fixed): how often the next try fails it again. */
  stick_rate: number | null;
}

/** How validator rules behave across the tries of the encode loop. */
export interface IssueLadder {
  rules: RuleTrajectory[];
  /** The rules the encoder does not fix: most failures times stick rate. */
  stubborn: RuleTrajectory[];
  cases: number;
}

/** One try number of the loop: how many tries reached it, passed, and what they cost. */
export interface TryStep {
  try_no: number;
  label: string;
  tries: number;
  passed: number;
  cost_usd: number;
  /** Models that ran this try, most used first. */
  models: string[];
}

/**
 * The retry curve of the busiest loop (a judge station that sends cases back
 * to a work station, as validate sends them back to generate): pass rate and
 * cost by try number.
 */
export interface RetryCurve {
  judge: string;
  work: string;
  steps: TryStep[];
}

export interface CoOccurrence {
  a: string;
  b: string;
  count: number;
  lift: number;
}

export interface LoopingCitation {
  citation: string;
  cases: number;
  last_at: string;
  rules: string[];
  /** Failed visits over all its cases (tries that failed, setup failures, ...). */
  failed_visits: number;
  /** Recorded model cost over all its cases; null when no case recorded any. */
  cost_usd: number | null;
}

export type AlertSeverity = "critical" | "warning" | "info";

export interface FlowAlert {
  id: string;
  rule: string;
  severity: AlertSeverity;
  station: string | null;
  title: string;
  detail: string;
  href: string | null;
}

export interface FlowTotals {
  cases: number;
  landed: number;
  failed: number;
  cancelled: number;
  open: number;
  /** Cases that landed per week over the window. */
  landed_per_week: number;
  /** Dispatch to landing, median over landed cases. */
  lead_p50_ms: number | null;
}

export interface FlowModel {
  window: { from: string; to: string; days: number };
  jurisdiction: string | null;
  stations: StationStats[];
  edges: FlowEdge[];
  sinks: Array<{ id: SinkId; label: string; cases: number }>;
  variants: Variant[];
  ladder: IssueLadder;
  retry: RetryCurve | null;
  cooccurrence: CoOccurrence[];
  looping: LoopingCitation[];
  alerts: FlowAlert[];
  totals: FlowTotals;
  sources: Record<string, number>;
  events: number;
  generated_at: string;
}

export interface WorkflowSignal {
  label: string;
  grade: string;
  url: string;
  detail?: string | null;
}

export interface FlowOptions {
  now: number;
  days: number;
  jurisdiction?: string | null;
  targets?: StationTarget[];
  workflows?: WorkflowSignal[];
  /** Dated items to watch (waiver expiry, ...): alert within 90 days. */
  deadlines?: Array<{ label: string; at: string; href: string | null }>;
}

/** A visit: one case at one station, from its first event to the one that ends it. */
interface Visit {
  station: string;
  start: number;
  end: number | null;
  outcome: "ok" | "fail" | "cancel" | "open";
  try_no: number | null;
  rule_id: string | null;
  reason: string | null;
  ref_url: string | null;
  duration_ms: number | null;
  /** Left ok under a waiver (tests on main). */
  waived: boolean;
  actor: string | null;
  cost_usd: number | null;
  message: string | null;
}

interface Case {
  id: string;
  citation: string;
  jurisdiction: string | null;
  source: string;
  start: number;
  visits: Visit[];
  /** Rule ids per try, from validate fails and issues. */
  tryRules: Map<number, Set<string>>;
  passedTry: number | null;
  end: SinkId | null;
  failedAt: string | null;
}

const TERMINAL = new Set(["leave", "fail", "cancel"]);

/** Whether a jurisdiction is the scope or under it (us covers us-ca). */
export function inJurisdiction(value: string | null, scope: string | null | undefined): boolean {
  if (!scope) return true;
  if (!value) return false;
  return value === scope || value.startsWith(`${scope}-`);
}

/** Group events into cases, and each case's events into station visits. */
function buildCases(events: PipelineEvent[]): Map<string, Case> {
  const byCase = new Map<string, PipelineEvent[]>();
  for (const e of events) {
    const list = byCase.get(e.case_id);
    if (list) list.push(e);
    else byCase.set(e.case_id, [e]);
  }
  const cases = new Map<string, Case>();
  for (const [id, list] of byCase) {
    // Stable sort: events at the same instant keep their pipeline order.
    const sorted = list.map((e, i) => ({ e, i, t: Date.parse(e.at) })).sort((a, b) => a.t - b.t || a.i - b.i);
    const visits: Visit[] = [];
    const open = new Map<string, Visit>();
    const unentered = new Map<string, Visit>();
    const tryRules = new Map<number, Set<string>>();
    let passedTry: number | null = null;
    let source = "pipeline_attempts";
    for (const { e, t } of sorted) {
      if (e.source !== "pipeline_attempts") source = e.source;
      if (e.kind === "issue") {
        if (e.rule_id) addRule(tryRules, e.try_no ?? 0, e.rule_id);
        continue;
      }
      let visit = open.get(e.station);
      if (e.kind === "enter" && !visit) {
        // An enter that comes after the visit already ended (a check that ran
        // before the step it follows) belongs to that visit.
        const early = unentered.get(e.station);
        if (early) {
          unentered.delete(e.station);
          continue;
        }
      }
      if (!visit) {
        visit = { station: e.station, start: t, end: null, outcome: "open", try_no: e.try_no, rule_id: null, reason: null, ref_url: e.ref_url, duration_ms: null, waived: false, actor: e.actor, cost_usd: null, message: null };
        visits.push(visit);
        open.set(e.station, visit);
        if (e.kind !== "enter" && TERMINAL.has(e.kind)) unentered.set(e.station, visit);
      } else if (e.kind === "enter") {
        unentered.delete(e.station);
      }
      if (e.kind === "wait") {
        visit.reason = e.rule_id ?? e.outcome;
        visit.ref_url = e.ref_url ?? visit.ref_url;
        if (e.message) visit.reason = `${visit.reason}: ${e.message}`;
      }
      if (TERMINAL.has(e.kind)) {
        visit.end = t;
        visit.outcome = e.kind === "leave" ? "ok" : e.kind === "fail" ? "fail" : "cancel";
        visit.rule_id = e.rule_id;
        visit.waived = e.outcome === "waived";
        visit.actor = e.actor ?? visit.actor;
        visit.cost_usd = e.cost_usd != null ? Number(e.cost_usd) : null;
        visit.message = e.message;
        visit.duration_ms = e.duration_ms ?? (e.attrs?.untimed ? null : t - visit.start);
        visit.ref_url = e.ref_url ?? visit.ref_url;
        open.delete(e.station);
        if (e.kind === "fail" && e.rule_id && e.try_no != null) addRule(tryRules, e.try_no, e.rule_id);
        if (e.kind === "fail" && e.rule_id && e.try_no == null && e.station === "validate") addRule(tryRules, 0, e.rule_id);
        if (e.kind === "leave" && e.station === "validate" && e.try_no != null) passedTry = e.try_no;
      }
    }
    // Issues an archive could not place on a try (try 0) belong to the last try.
    const lastTry = Math.max(0, ...[...tryRules.keys()], ...visits.filter((v) => v.try_no != null).map((v) => v.try_no!));
    const unplaced = tryRules.get(0);
    if (unplaced && lastTry > 0) {
      for (const r of unplaced) addRule(tryRules, lastTry, r);
      tryRules.delete(0);
    }
    const first = sorted[0]?.e;
    if (!first) continue;
    const c: Case = {
      id,
      citation: first.citation,
      jurisdiction: first.jurisdiction,
      source,
      start: sorted[0].t,
      visits,
      tryRules,
      passedTry,
      end: null,
      failedAt: null,
    };
    classifyEnd(c);
    cases.set(id, c);
  }
  return cases;
}

function addRule(map: Map<number, Set<string>>, tryNo: number, rule: string) {
  const set = map.get(tryNo);
  if (set) set.add(rule);
  else map.set(tryNo, new Set([rule]));
}

/** A case ends failed at the first station whose fail no later visit there recovered. */
function classifyEnd(c: Case) {
  const lastOutcome = new Map<string, Visit>();
  for (const v of c.visits) lastOutcome.set(v.station, v);
  for (const v of c.visits) {
    if (v.outcome === "fail" && lastOutcome.get(v.station) === v) {
      c.end = "exit:failed";
      c.failedAt = v.station;
      return;
    }
  }
  if (c.visits.some((v) => v.outcome === "cancel")) {
    c.end = "exit:cancelled";
    c.failedAt = c.visits.find((v) => v.outcome === "cancel")!.station;
    return;
  }
  if (c.visits.some((v) => v.outcome === "open")) return;
  if (c.visits.length) c.end = "exit:landed";
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Mine the event log into everything /ops/flow and the agent brief show. */
export function mineFlow(events: PipelineEvent[], options: FlowOptions): FlowModel {
  const { now, days } = options;
  const from = now - days * DAY_MS;
  const scoped = events.filter((e) => inJurisdiction(e.jurisdiction, options.jurisdiction));
  const all = buildCases(scoped);
  const factory = [...all.values()].filter((c) => c.source === "pipeline_attempts" || c.source === "failure_bundle");
  const windowCases = factory.filter((c) => c.start >= from && c.start <= now);
  const targets = new Map((options.targets ?? []).map((t) => [t.station, t]));

  // Stations: every station any case visited, with counts over the window.
  const stationIds = new Set<string>();
  for (const c of factory) for (const v of c.visits) stationIds.add(v.station);
  const weeks = Math.max(1, Math.ceil(days / 7));
  const stations: StationStats[] = [];
  for (const id of stationIds) {
    const visitsIn: Array<{ c: Case; v: Visit }> = [];
    for (const c of windowCases) for (const v of c.visits) if (v.station === id) visitsIn.push({ c, v });
    const caseIds = new Set(visitsIn.map((x) => x.c.id));
    // A case's outcome at a station is its last visit there.
    const lastByCase = new Map<string, Visit>();
    for (const { c, v } of visitsIn) lastByCase.set(c.id, v);
    let ok = 0;
    let failed = 0;
    let cancelled = 0;
    let waived = 0;
    for (const v of lastByCase.values()) {
      if (v.waived) waived++;
      if (v.outcome === "ok") ok++;
      else if (v.outcome === "fail") failed++;
      else if (v.outcome === "cancel") cancelled++;
    }
    const perTry = visitsIn.filter((x) => x.v.try_no != null && x.v.outcome !== "open");
    const repeated = visitsIn.length > caseIds.size;
    const durations = visitsIn.map((x) => x.v.duration_ms).filter((d): d is number => d != null);
    const weekly = new Array(weeks).fill(0);
    for (const { v } of visitsIn) {
      if (v.end == null || v.end < from) continue;
      const w = Math.min(weeks - 1, Math.floor((v.end - from) / WEEK_MS));
      weekly[w]++;
    }
    const failures = ruleCounts(visitsIn.filter((x) => x.v.outcome === "fail" || x.v.reason).map((x) => ({ c: x.c, v: x.v })));
    // WIP over all time: cases open at the station now.
    const openItems: OpenItem[] = [];
    for (const c of factory) {
      for (const v of c.visits) {
        if (v.station === id && v.outcome === "open") {
          openItems.push({ case_id: c.id, citation: c.citation, since: new Date(v.start).toISOString(), reason: v.reason, ref_url: v.ref_url });
        }
      }
    }
    openItems.sort((a, b) => a.since.localeCompare(b.since));
    const target = targets.get(id) ?? null;
    const slaMs = target?.sla_hours != null ? target.sla_hours * 3_600_000 : null;
    const overSla = slaMs == null ? 0 : openItems.filter((o) => now - Date.parse(o.since) > slaMs).length;
    const positions: number[] = [];
    for (const c of windowCases.length ? windowCases : factory) {
      const i = c.visits.findIndex((v) => v.station === id);
      if (i >= 0) positions.push(i / Math.max(1, c.visits.length - 1) + i);
    }
    const finished = ok + failed + cancelled;
    stations.push({
      id,
      label: stationLabel(id),
      description: STATION_COPY[id]?.description ?? "",
      cases: caseIds.size,
      ok,
      failed,
      cancelled,
      waived,
      yield: finished ? ok / finished : null,
      tries: repeated || perTry.length > caseIds.size ? { total: perTry.length, ok: perTry.filter((x) => x.v.outcome === "ok").length } : null,
      wip: openItems.length,
      p50_ms: quantile(durations, 0.5),
      p95_ms: quantile(durations, 0.95),
      weekly,
      failures,
      oldest: openItems.slice(0, 8),
      over_sla: overSla,
      target,
      position: positions.length ? positions.reduce((s, p) => s + p, 0) / positions.length : Number.MAX_SAFE_INTEGER,
      rank: 0,
    });
  }

  // Edges: directly-follows between consecutive visits, and each case's end.
  const edgeMap = new Map<string, { from: string; to: string; cases: number; waits: number[]; back: number }>();
  const bump = (fromId: string, to: string, wait: number | null, back: boolean) => {
    const key = `${fromId}→${to}`;
    const edge = edgeMap.get(key) ?? { from: fromId, to, cases: 0, waits: [], back: 0 };
    edge.cases++;
    if (wait != null && wait >= 0) edge.waits.push(wait);
    if (back) edge.back++;
    edgeMap.set(key, edge);
  };
  const sinkCounts: Record<SinkId, number> = { "exit:landed": 0, "exit:failed": 0, "exit:cancelled": 0 };
  for (const c of windowCases) {
    const seen = new Set<string>();
    for (let i = 0; i < c.visits.length; i++) {
      const v = c.visits[i];
      seen.add(v.station);
      const next = c.visits[i + 1];
      if (next) bump(v.station, next.station, v.end != null ? next.start - v.end : null, seen.has(next.station));
    }
    if (c.end) {
      sinkCounts[c.end]++;
      const exitFrom = c.end === "exit:landed" ? c.visits.at(-1)!.station : c.failedAt!;
      bump(exitFrom, c.end, null, false);
    }
  }
  const edges: FlowEdge[] = [...edgeMap.values()].map((e) => ({
    from: e.from,
    to: e.to,
    cases: e.cases,
    median_wait_ms: quantile(e.waits, 0.5),
    loop: e.back > e.cases / 2,
  }));
  edges.sort((a, b) => b.cases - a.cases);
  const ranks = rankStations(stations, edges);
  for (const s of stations) s.rank = ranks.get(s.id) ?? 0;
  stations.sort((a, b) => a.rank - b.rank || a.position - b.position);

  const variants = mineVariants(windowCases);
  const ladderCases = [...all.values()].filter((c) => c.start <= now && (c.source === "local_ab" || c.start >= from));
  const ladder = issueLadder(ladderCases);
  const cooccurrence = coOccurrence(ladderCases);
  const looping = loopingCitations(windowCases);
  const retry = retryCurve(windowCases, edges);

  const landed = windowCases.filter((c) => c.end === "exit:landed");
  const leads = landed.map((c) => caseEnd(c) - c.start);
  const totals: FlowTotals = {
    cases: windowCases.length,
    landed: landed.length,
    failed: sinkCounts["exit:failed"],
    cancelled: sinkCounts["exit:cancelled"],
    open: windowCases.filter((c) => c.end == null).length,
    landed_per_week: landed.length / (days / 7),
    lead_p50_ms: quantile(leads, 0.5),
  };

  const sources: Record<string, number> = {};
  for (const e of scoped) sources[e.source] = (sources[e.source] ?? 0) + 1;

  const model: FlowModel = {
    window: { from: new Date(from).toISOString(), to: new Date(now).toISOString(), days },
    jurisdiction: options.jurisdiction ?? null,
    stations,
    edges,
    sinks: (Object.keys(sinkCounts) as SinkId[]).filter((id) => sinkCounts[id] > 0).map((id) => ({ id, label: SINK_LABELS[id], cases: sinkCounts[id] })),
    variants,
    ladder,
    retry,
    cooccurrence,
    looping,
    alerts: [],
    totals,
    sources,
    events: scoped.length,
    generated_at: new Date(now).toISOString(),
  };
  model.alerts = flowAlerts(model, factory, options);
  return model;
}

/** When a case's last timed visit ended (untimed checks carry a read time, not a finish time). */
function caseEnd(c: Case): number {
  let end = c.start;
  for (const v of c.visits) if (v.end != null && v.duration_ms != null) end = Math.max(end, v.end);
  return end;
}

/**
 * Columns for the flow: a depth-first walk from the busiest entry station
 * marks back edges (loops), and each station's rank is its longest path
 * over the forward edges. Edges the walk finds going back are loops.
 */
export function rankStations(stations: Array<{ id: string; cases: number }>, edges: FlowEdge[]): Map<string, number> {
  const ids = new Set(stations.map((s) => s.id));
  const out = new Map<string, FlowEdge[]>();
  const indegree = new Map<string, number>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + e.cases);
  }
  for (const list of out.values()) list.sort((a, b) => b.cases - a.cases);
  const inflow = (id: string) => indegree.get(id) ?? 0;
  const outflow = (id: string) => (out.get(id) ?? []).reduce((s, e) => s + e.cases, 0);
  // Entry stations first: most net outflow.
  const roots = [...ids].sort((a, b) => outflow(b) - inflow(b) - (outflow(a) - inflow(a)));
  const state = new Map<string, 1 | 2>();
  const order: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 1) e.loop = true;
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
    order.push(id);
  };
  for (const r of roots) if (!state.get(r)) visit(r);
  const rank = new Map<string, number>();
  for (const id of order.reverse()) {
    if (!rank.has(id)) rank.set(id, 0);
    for (const e of out.get(id) ?? []) {
      if (e.loop) continue;
      rank.set(e.to, Math.max(rank.get(e.to) ?? 0, rank.get(id)! + 1));
    }
  }
  for (const e of edges) if (e.from === e.to) e.loop = true;
  return rank;
}

function ruleCounts(items: Array<{ c: Case; v: Visit }>): RuleCount[] {
  const map = new Map<string, RuleCount & { caseSet: Set<string> }>();
  for (const { c, v } of items) {
    const rule = v.rule_id ?? (v.reason ? v.reason.split(":")[0] : "unknown");
    const entry = map.get(rule) ?? { rule_id: rule, count: 0, cases: 0, example: null, last_at: "", caseSet: new Set<string>() };
    entry.count++;
    entry.caseSet.add(c.id);
    const at = new Date(v.end ?? v.start).toISOString();
    if (at > entry.last_at) {
      entry.last_at = at;
      entry.example = c.citation;
    }
    map.set(rule, entry);
  }
  return [...map.values()]
    .map(({ caseSet, ...rest }) => ({ ...rest, cases: caseSet.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function mineVariants(cases: Case[]): Variant[] {
  const groups = new Map<string, { path: string[]; end: string; cases: Case[]; repeats: number[] }>();
  for (const c of cases) {
    const path: string[] = [];
    const counts = new Map<string, number>();
    for (const v of c.visits) {
      counts.set(v.station, (counts.get(v.station) ?? 0) + 1);
      if (!path.includes(v.station)) path.push(v.station);
    }
    const end = c.end === "exit:landed" ? "landed" : c.end ? `${c.end === "exit:failed" ? "failed" : "cancelled"} at ${c.failedAt}` : `open at ${c.visits.at(-1)?.station ?? "?"}`;
    const repeats = Math.max(1, ...counts.values());
    const key = `${path.join(">")}|${end}`;
    const group = groups.get(key) ?? { path, end, cases: [], repeats: [] };
    group.cases.push(c);
    group.repeats.push(repeats);
    groups.set(key, group);
  }
  const total = cases.length || 1;
  return [...groups.values()]
    .sort((a, b) => b.cases.length - a.cases.length)
    .slice(0, 12)
    .map((g) => {
      const leads = g.cases.map((c) => caseEnd(c) - c.start);
      const example = g.cases[g.cases.length - 1];
      return {
        path: g.path,
        end: g.end,
        cases: g.cases.length,
        share: g.cases.length / total,
        median_lead_ms: quantile(leads, 0.5),
        median_repeats: quantile(g.repeats, 0.5) ?? 1,
        example_case: example.id,
        example_citation: example.citation,
      };
    });
}

const STUBBORN_MIN = 10;

/**
 * Rules across tries: for cases whose tries carry rule ids, which rules each
 * try hit and what the next try hit instead. A rule that stays from one try
 * to the next was not fixed; a new one after a fix is the whack-a-mole loop.
 */
export function issueLadder(cases: Case[]): IssueLadder {
  const usable = cases.filter((c) => c.tryRules.size > 0);
  const traj = new Map<string, { occurrences: number; cases: Set<string>; persisted: number; fixed: number; followed: Map<string, number>; recovered: Set<string> }>();
  const trajOf = (r: string) => {
    const t = traj.get(r) ?? { occurrences: 0, cases: new Set<string>(), persisted: 0, fixed: 0, followed: new Map<string, number>(), recovered: new Set<string>() };
    traj.set(r, t);
    return t;
  };
  for (const c of usable) {
    const tries = [...c.tryRules.keys()].filter((n) => n > 0).sort((a, b) => a - b);
    for (let i = 0; i < tries.length; i++) {
      const rules = c.tryRules.get(tries[i])!;
      for (const r of rules) {
        const t = trajOf(r);
        t.occurrences++;
        t.cases.add(c.id);
        if (c.passedTry != null && c.passedTry > tries[i]) t.recovered.add(c.id);
      }
      const nextN = tries[i + 1];
      if (nextN == null) continue;
      const next = c.tryRules.get(nextN)!;
      for (const r of rules) {
        const t = trajOf(r);
        if (next.has(r)) t.persisted++;
        else {
          t.fixed++;
          for (const q of next) if (!rules.has(q)) t.followed.set(q, (t.followed.get(q) ?? 0) + 1);
        }
      }
    }
  }
  const all: RuleTrajectory[] = [...traj.entries()].map(([rule_id, t]) => ({
    rule_id,
    occurrences: t.occurrences,
    cases: t.cases.size,
    persisted: t.persisted,
    fixed: t.fixed,
    followed_by: [...t.followed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, count]) => ({ rule_id: r, count })),
    recovered: t.recovered.size,
    stick_rate: t.persisted + t.fixed ? t.persisted / (t.persisted + t.fixed) : null,
  }));
  const rules = [...all].sort((a, b) => b.occurrences - a.occurrences).slice(0, 25);
  const stubborn = all
    .filter((r) => r.occurrences >= STUBBORN_MIN && r.stick_rate != null)
    .sort((a, b) => b.occurrences * b.stick_rate! - a.occurrences * a.stick_rate!)
    .slice(0, 10);
  return { rules, stubborn, cases: usable.length };
}

const TRY_CAP = 6;

/** Pass rate and cost by try number for the busiest loop in the flow. */
export function retryCurve(cases: Case[], edges: FlowEdge[]): RetryCurve | null {
  const loop = edges.filter((e) => e.loop && e.from !== e.to && !e.to.startsWith("exit:")).sort((a, b) => b.cases - a.cases)[0];
  if (!loop) return null;
  const judge = loop.from;
  const work = loop.to;
  const steps = new Map<number, { tries: number; passed: number; cost: number; models: Map<string, number> }>();
  const stepOf = (n: number) => {
    const k = Math.min(n, TRY_CAP);
    const st = steps.get(k) ?? { tries: 0, passed: 0, cost: 0, models: new Map<string, number>() };
    steps.set(k, st);
    return st;
  };
  for (const c of cases) {
    for (const v of c.visits) {
      if (v.try_no == null || v.try_no < 1) continue;
      if (v.station === judge && (v.outcome === "ok" || v.outcome === "fail")) {
        const st = stepOf(v.try_no);
        st.tries++;
        if (v.outcome === "ok") st.passed++;
      } else if (v.station === work && v.outcome === "ok") {
        const st = stepOf(v.try_no);
        st.cost += v.cost_usd ?? 0;
        if (v.actor) st.models.set(v.actor, (st.models.get(v.actor) ?? 0) + 1);
      }
    }
  }
  if (!steps.size) return null;
  return {
    judge,
    work,
    steps: [...steps.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, st]) => st.tries > 0)
      .map(([n, st]) => ({
        try_no: n,
        label: n === TRY_CAP ? `${n}+` : String(n),
        tries: st.tries,
        passed: st.passed,
        cost_usd: Math.round(st.cost * 100) / 100,
        models: [...st.models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
      })),
  };
}

function coOccurrence(cases: Case[]): CoOccurrence[] {
  const single = new Map<string, number>();
  const pairs = new Map<string, number>();
  let sets = 0;
  for (const c of cases) {
    for (const set of c.tryRules.values()) {
      if (!set.size) continue;
      sets++;
      const list = [...set].sort();
      for (const r of list) single.set(r, (single.get(r) ?? 0) + 1);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const key = `${list[i]}|${list[j]}`;
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const out: CoOccurrence[] = [];
  for (const [key, count] of pairs) {
    if (count < 5) continue;
    const [a, b] = key.split("|");
    const lift = (count * sets) / (single.get(a)! * single.get(b)!);
    out.push({ a, b, count, lift: Math.round(lift * 10) / 10 });
  }
  return out.sort((x, y) => y.count * Math.log2(1 + y.lift) - x.count * Math.log2(1 + x.lift)).slice(0, 15);
}

const LOOPING_MIN_CASES = 4;

function loopingCitations(cases: Case[]): LoopingCitation[] {
  const byCitation = new Map<string, Case[]>();
  for (const c of cases) {
    if (!c.visits.some((v) => v.station === "dispatch")) continue;
    const list = byCitation.get(c.citation) ?? [];
    list.push(c);
    byCitation.set(c.citation, list);
  }
  const out: LoopingCitation[] = [];
  for (const [citation, list] of byCitation) {
    if (list.length < LOOPING_MIN_CASES) continue;
    if (list.some((c) => c.visits.some((v) => v.station === "merge" && v.outcome === "ok"))) continue;
    const rules = new Map<string, number>();
    for (const c of list) for (const v of c.visits) if (v.outcome === "fail" && v.rule_id) rules.set(v.rule_id, (rules.get(v.rule_id) ?? 0) + 1);
    let failedVisits = 0;
    let cost: number | null = null;
    for (const c of list) {
      for (const v of c.visits) {
        if (v.outcome === "fail") failedVisits++;
        if (v.cost_usd != null) cost = (cost ?? 0) + v.cost_usd;
      }
    }
    out.push({
      citation,
      cases: list.length,
      last_at: new Date(Math.max(...list.map((c) => c.start))).toISOString(),
      rules: [...rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r),
      failed_visits: failedVisits,
      cost_usd: cost == null ? null : Math.round(cost * 100) / 100,
    });
  }
  return out.sort((a, b) => b.cases - a.cases).slice(0, 15);
}

const HOUR_MS = 3_600_000;
const DEADLINE_WINDOW_MS = 90 * DAY_MS;
const SPIKE_DAYS = 7;
/** A try number needs this many tries before its pass rate raises an alert. */
const RETRY_MIN_TRIES = 30;
/** Below this pass rate a later try is not worth its cost. */
const RETRY_MIN_PASS = 0.05;

/** Alerts from stations against their targets, workflows, deadlines and rule trends. */
function flowAlerts(model: FlowModel, factory: Case[], options: FlowOptions): FlowAlert[] {
  const alerts: FlowAlert[] = [];
  const scope = options.jurisdiction ? `&j=${encodeURIComponent(options.jurisdiction)}` : "";
  for (const s of model.stations) {
    const t = s.target;
    const href = `/ops/flow?station=${encodeURIComponent(s.id)}${scope}`;
    if (!t) continue;
    if (t.min_yield != null && s.yield != null && s.ok + s.failed + s.cancelled >= 10 && s.yield < t.min_yield) {
      alerts.push({
        id: `yield:${s.id}`,
        rule: "yield_below_target",
        severity: s.yield < t.min_yield * 0.75 ? "critical" : "warning",
        station: s.id,
        title: `${s.label}: yield ${pct(s.yield)} (target ${pct(t.min_yield)})`,
        detail: `${s.failed} failed and ${s.cancelled} cancelled of ${s.ok + s.failed + s.cancelled} finished in ${model.window.days} days.${s.failures[0] ? ` Top cause: ${s.failures[0].rule_id} (${s.failures[0].count}).` : ""}`,
        href,
      });
    }
    if (t.max_p95_hours != null && s.p95_ms != null && s.p95_ms > t.max_p95_hours * HOUR_MS) {
      alerts.push({
        id: `p95:${s.id}`,
        rule: "p95_over_target",
        severity: "warning",
        station: s.id,
        title: `${s.label}: p95 ${formatDuration(s.p95_ms)} (target ${formatDuration(t.max_p95_hours * HOUR_MS)})`,
        detail: `Median ${formatDuration(s.p50_ms)}.`,
        href,
      });
    }
    if (t.max_wip != null && s.wip > t.max_wip) {
      alerts.push({
        id: `wip:${s.id}`,
        rule: "wip_over_target",
        severity: s.wip > t.max_wip * 2 ? "critical" : "warning",
        station: s.id,
        title: `${s.label}: ${s.wip} open (limit ${t.max_wip})`,
        detail: `Oldest since ${s.oldest[0]?.since.slice(0, 10) ?? "?"} (${s.oldest[0]?.citation ?? ""}).`,
        href,
      });
    }
    if (s.over_sla > 0 && t.sla_hours != null) {
      alerts.push({
        id: `sla:${s.id}`,
        rule: "case_over_sla",
        severity: s.over_sla >= 10 ? "warning" : "info",
        station: s.id,
        title: `${s.label}: ${s.over_sla} over ${formatDuration(t.sla_hours * HOUR_MS)}`,
        detail: s.oldest
          .slice(0, 3)
          .map((o) => `${o.citation} since ${o.since.slice(0, 10)}`)
          .join("; "),
        href,
      });
    }
  }
  for (const w of options.workflows ?? []) {
    if (w.grade !== "failing") continue;
    alerts.push({
      id: `workflow:${w.label}`,
      rule: "workflow_red",
      severity: "critical",
      station: null,
      title: `${w.label} is failing`,
      detail: w.detail ?? "The latest runs failed.",
      href: w.url,
    });
  }
  for (const d of options.deadlines ?? []) {
    const left = Date.parse(d.at) - options.now;
    if (left < 0 || left > DEADLINE_WINDOW_MS) continue;
    alerts.push({
      id: `deadline:${d.label}`,
      rule: "deadline_near",
      severity: left < 14 * DAY_MS ? "critical" : "warning",
      station: null,
      title: `${d.label} in ${Math.ceil(left / DAY_MS)} days`,
      detail: `On ${d.at.slice(0, 10)}.`,
      href: d.href,
    });
  }
  // Rule spikes: a rule's share of validate failures in the last week vs before.
  const recentFrom = options.now - SPIKE_DAYS * DAY_MS;
  const windowFrom = options.now - options.days * DAY_MS;
  const recent = new Map<string, number>();
  const before = new Map<string, number>();
  let recentTotal = 0;
  let beforeTotal = 0;
  for (const c of factory) {
    for (const v of c.visits) {
      if (v.outcome !== "fail" || !v.rule_id || v.end == null || v.end < windowFrom) continue;
      if (v.end >= recentFrom) {
        recent.set(v.rule_id, (recent.get(v.rule_id) ?? 0) + 1);
        recentTotal++;
      } else {
        before.set(v.rule_id, (before.get(v.rule_id) ?? 0) + 1);
        beforeTotal++;
      }
    }
  }
  if (recentTotal >= 10 && beforeTotal >= 10) {
    for (const [rule, n] of recent) {
      const share = n / recentTotal;
      const prior = (before.get(rule) ?? 0) / beforeTotal;
      if (n >= 5 && share >= 2 * prior && share >= 0.1) {
        alerts.push({
          id: `spike:${rule}`,
          rule: "rule_spike",
          severity: "warning",
          station: null,
          title: `${rule}: ${pct(share)} of failures this week (${pct(prior)} before)`,
          detail: `${n} failures in the last ${SPIKE_DAYS} days.`,
          href: null,
        });
      }
    }
  }
  // A late try that almost never passes: the loop spends without return.
  const retry = model.retry;
  if (retry) {
    for (const st of retry.steps) {
      if (st.try_no < 2 || st.tries < RETRY_MIN_TRIES) continue;
      const rate = st.passed / st.tries;
      if (rate >= RETRY_MIN_PASS) continue;
      alerts.push({
        id: `retry:${retry.judge}:${st.label}`,
        rule: "retry_low_yield",
        severity: "warning",
        station: retry.judge,
        title: `${stationLabel(retry.judge)} try ${st.label} passes ${pct(rate)} (${st.passed} of ${st.tries})`,
        detail: `$${st.cost_usd.toFixed(2)} of model cost on try ${st.label} in ${model.window.days} days. Cap the loop before it, or change what the encoder gets.`,
        href: `/ops/flow?view=discovery${scope}`,
      });
    }
  }
  for (const l of model.looping.slice(0, 5)) {
    alerts.push({
      id: `looping:${l.citation}`,
      rule: "looping_citation",
      severity: l.cases >= 8 ? "warning" : "info",
      station: null,
      title: `${l.citation}: ${l.cases} runs, none merged`,
      detail: l.rules.length ? `Fails on ${l.rules.join(", ")}.` : "",
      href: `/ops/flow?citation=${encodeURIComponent(l.citation)}`,
    });
  }
  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function pct(value: number | null): string {
  if (value == null) return "–";
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "–";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR_MS) return `${Math.round(ms / 60_000)}m`;
  if (ms < 2 * DAY_MS) return `${(ms / HOUR_MS).toFixed(ms < 10 * HOUR_MS ? 1 : 0)}h`;
  return `${(ms / DAY_MS).toFixed(ms < 10 * DAY_MS ? 1 : 0)}d`;
}

/** One citation: each case's visits, for the lanes view. */
export interface CitationLane {
  case_id: string;
  start: string;
  source: string;
  end: string;
  visits: LaneVisit[];
}

export interface LaneVisit {
  station: string;
  start: string;
  end: string | null;
  outcome: Visit["outcome"];
  rule_id: string | null;
  try_no: number | null;
  duration_ms: number | null;
  actor: string | null;
  cost_usd: number | null;
  message: string | null;
  reason: string | null;
  ref_url: string | null;
  waived: boolean;
}

function laneVisit(v: Visit): LaneVisit {
  return {
    station: v.station,
    start: new Date(v.start).toISOString(),
    end: v.end != null ? new Date(v.end).toISOString() : null,
    outcome: v.outcome,
    rule_id: v.rule_id,
    try_no: v.try_no,
    duration_ms: v.duration_ms,
    actor: v.actor,
    cost_usd: v.cost_usd,
    message: v.message,
    reason: v.reason,
    ref_url: v.ref_url,
    waived: v.waived,
  };
}

export function citationLanes(events: PipelineEvent[], citation: string): CitationLane[] {
  const cases = buildCases(events.filter((e) => e.citation === citation));
  return [...cases.values()]
    .sort((a, b) => b.start - a.start)
    .map((c) => ({
      case_id: c.id,
      start: new Date(c.start).toISOString(),
      source: c.source,
      end: c.end === "exit:landed" ? "landed" : c.end ? `${SINK_LABELS[c.end].toLowerCase()} at ${stationLabel(c.failedAt!)}` : "open",
      visits: c.visits.map(laneVisit),
    }));
}

/** One case in full: its visits, every issue by try, and its pages. */
export interface CaseDetail extends CitationLane {
  citation: string;
  jurisdiction: string | null;
  issues: Array<{ try_no: number | null; rule_id: string | null; message: string | null; source: string; final: boolean }>;
  encoder_version: string | null;
}

export function caseDetail(events: PipelineEvent[], caseId: string): CaseDetail | null {
  const own = events.filter((e) => e.case_id === caseId);
  const c = buildCases(own).get(caseId);
  if (!c) return null;
  const lane = citationLanes(own, c.citation)[0];
  return {
    ...lane,
    citation: c.citation,
    jurisdiction: c.jurisdiction,
    encoder_version: own.find((e) => e.encoder_version)?.encoder_version ?? null,
    issues: own
      .filter((e) => e.kind === "issue")
      .map((e) => ({ try_no: e.try_no, rule_id: e.rule_id, message: e.message, source: e.source, final: Boolean(e.attrs?.final) })),
  };
}

/** Markdown brief of systemic problems, for an agent to read before it dispatches. */
export function agentBrief(model: FlowModel, siteUrl: string): string {
  const lines: string[] = [];
  const scope = model.jurisdiction ? ` (${model.jurisdiction})` : "";
  lines.push(`# Encoding pipeline brief${scope}`);
  lines.push("");
  lines.push(`Window: last ${model.window.days} days to ${model.window.to.slice(0, 16)}Z. ${model.totals.cases} cases, ${model.totals.landed} landed, ${model.totals.failed} failed, ${model.totals.cancelled} cancelled, ${model.totals.open} open. Lead time p50 ${formatDuration(model.totals.lead_p50_ms)}.`);
  lines.push("");
  if (model.retry) {
    lines.push(`## Is retrying worth it? (${stationLabel(model.retry.judge)} by try)`);
    lines.push("| try | tries | passed | pass rate | model cost |");
    lines.push("|---|---|---|---|---|");
    for (const st of model.retry.steps) lines.push(`| ${st.label} | ${st.tries} | ${st.passed} | ${pct(st.tries ? st.passed / st.tries : null)} | $${st.cost_usd.toFixed(2)} |`);
    lines.push("");
  }
  if (model.ladder.stubborn.length) {
    lines.push("## Rules the encoder does not fix");
    lines.push("Ranked by failures times the share of next tries that fail the same rule again. Fix these at the source (prompt, validator, example), not by another dispatch.");
    lines.push("");
    for (const r of model.ladder.stubborn.slice(0, 8)) {
      lines.push(`- \`${r.rule_id}\`: ${r.occurrences} tries in ${r.cases} cases; the next try fails it again ${pct(r.stick_rate)}; ${r.recovered} cases recovered.`);
    }
    lines.push("");
  }
  if (model.looping.length) {
    lines.push("## Do not re-dispatch without a change");
    for (const l of model.looping.slice(0, 10)) lines.push(`- ${l.citation}: ${l.cases} runs, none merged, ${l.failed_visits} failures, ${l.cost_usd == null ? "cost not recorded" : `$${l.cost_usd.toFixed(2)} model cost`}; ${l.rules.join(", ") || "no rule"} (${link(`/ops/flow?citation=${encodeURIComponent(l.citation)}`, siteUrl)})`);
    lines.push("");
  }
  lines.push("## Alerts");
  if (!model.alerts.length) lines.push("- None.");
  for (const a of model.alerts.slice(0, 15)) lines.push(`- **${a.severity}** ${a.title}. ${a.detail}${a.href ? ` (${link(a.href, siteUrl)})` : ""}`);
  lines.push("");
  lines.push("## Stations");
  lines.push("| station | cases | yield | WIP | p50 | p95 | top failure |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const s of model.stations) {
    const top = s.failures[0] ? `${s.failures[0].rule_id} (${s.failures[0].count})` : "";
    const yieldText = s.tries ? `${pct(s.yield)} (tries ${pct(s.tries.total ? s.tries.ok / s.tries.total : null)})` : pct(s.yield);
    lines.push(`| ${s.label} | ${s.cases} | ${yieldText} | ${s.wip} | ${formatDuration(s.p50_ms)} | ${formatDuration(s.p95_ms)} | ${top} |`);
  }
  lines.push("");
  if (model.cooccurrence.length) {
    lines.push("");
    lines.push("## Failure modes that come together");
    for (const c of model.cooccurrence.slice(0, 6)) lines.push(`- \`${c.a}\` + \`${c.b}\`: ${c.count} tries, lift ${c.lift}.`);
  }
  lines.push("");
  lines.push("## Common paths");
  for (const v of model.variants.slice(0, 6)) {
    lines.push(`- ${pct(v.share)} (${v.cases}): ${v.path.map(stationLabel).join(" → ")} → **${v.end}**${v.median_repeats > 1 ? `, ${v.median_repeats} tries median` : ""}`);
  }
  lines.push("");
  lines.push(`Data: ${model.events} events (${Object.entries(model.sources).map(([s, n]) => `${s} ${n}`).join(", ")}). JSON: ${link("/api/ops/flow", siteUrl)}.`);
  return lines.join("\n");
}

function link(path: string, siteUrl: string): string {
  return path.startsWith("http") ? path : `${siteUrl}${path}`;
}
