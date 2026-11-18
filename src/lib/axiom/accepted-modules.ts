/**
 * Accepted modules: the one number the roadmap's flow model runs on, measured
 * from the event log (see docs/operations/pipeline-flow.md, "Accepted
 * modules").
 *
 * A module (one RuleSpec file, `<repo>:<path>`) is strictly accepted when it
 * is merged into the default branch, compiles (`compile_status = ok`), and
 * passes its jurisdiction's tests on main with no active waiver
 * (`tests_status = pass`). It counts once, in the ISO week of the first merge
 * that made it accepted; later merges of the same file are rework. A merged
 * module with no compile or test result yet (its repo is not in the index,
 * say) is not measured: unknown, not failed. Each module carries its route
 * and sub-route and the programs whose bundles hold its citation.
 */

import type { PipelineEvent } from "./pipeline-events";

/** Who wrote a module: the encoder, or a PR merged by hand. */
export type AcceptRoute = "pipeline" | "hand";
/** The pipeline's two sub-routes (a targeted dispatch, or a module written inside another citation's run), and hand. */
export type SubRoute = "dispatch" | "dep" | "hand";

/** The program of a module that no plan program's bundle holds (tariff and customs rules, say). */
export const OUT_OF_PLAN = "out_of_plan";
/** The program of a module whose case carries no program tag (the bundle lookup was not run). */
export const UNTAGGED = "untagged";

export const ACCEPTED_DEFINITION =
  "A RuleSpec module file counts as accepted when it is merged into its repo's default branch, compiles in axiom-api's sweep (compile_status = ok), and passes its jurisdiction's tests on main with no active validation waiver (tests_status = pass). Each file counts once, in the ISO week (Monday, UTC) of the first merge that made it accepted; a later merge of an accepted file counts as rework, not as a new module. A merged file with no compile or test result (its repo is not in the rulespec_files index, or the sweep has not reached it) is not measured: it is neither accepted nor failed, and is counted beside the headline, in the week of its latest merge, with the same route and program split. Route: pipeline = the encoder wrote it, split into dispatch (a targeted run) and dep (a module written inside another citation's run); hand = a PR merged it with no dispatch. A module in several programs' bundles counts in each program, and once in the total.";

// ---- Programs -------------------------------------------------------------

/** A bundle document's membership: the bundle (`<jurisdiction>/<program>`) and the corpus path it covers. */
export interface BundleMember {
  bundle_id: string;
  citation_path: string | null;
}

/** The program a bundle id names: `us-or/snap` → `snap`. */
export function bundleProgram(bundleId: string): string {
  return bundleId.slice(bundleId.lastIndexOf("/") + 1);
}

/** Programs by document path, from in-scope bundle documents. */
export function programIndex(members: BundleMember[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const m of members) {
    if (!m.citation_path) continue;
    const set = index.get(m.citation_path) ?? new Set<string>();
    set.add(bundleProgram(m.bundle_id));
    index.set(m.citation_path, set);
  }
  return index;
}

/**
 * The programs whose bundles hold a citation: a bundle document at the
 * citation or any path above it. `out_of_plan` when none does.
 */
export function citationPrograms(citation: string, index: Map<string, Set<string>>): string[] {
  const out = new Set<string>();
  const parts = citation.split("/");
  for (let n = 2; n <= parts.length; n++) {
    for (const p of index.get(parts.slice(0, n).join("/")) ?? []) out.add(p);
  }
  return out.size ? [...out].sort() : [OUT_OF_PLAN];
}

/**
 * Tag every event of a case with its programs (`attrs.programs`), from its
 * citation. Encoder changes and waiver rows (keyed by module path) stay
 * untagged. Returns the events, changed in place.
 */
export function tagPrograms(events: PipelineEvent[], index: Map<string, Set<string>>): PipelineEvent[] {
  const cache = new Map<string, string[]>();
  for (const e of events) {
    // Encoder changes name no citation, and a waiver row's "citation" is a
    // module file path, not a corpus citation: neither has a program here.
    if (e.source === "encoder_change" || e.source === "waiver_ledger" || !e.citation.includes("/")) continue;
    let programs = cache.get(e.citation);
    if (!programs) {
      programs = citationPrograms(e.citation, index);
      cache.set(e.citation, programs);
    }
    e.attrs = { ...e.attrs, programs };
  }
  return events;
}

// ---- The module ledger ----------------------------------------------------

/** Where a merged module stands: the headline, a later merge of it, or never accepted (by the checks on its latest merge). */
export type ModuleStatus = "accepted" | "rework" | "not_measured" | "not_accepted";

/** One module file's merge, as one case saw it. */
interface MergeFacts {
  key: string;
  repo: string;
  path: string;
  citation: string;
  case_id: string;
  sub_route: SubRoute;
  programs: string[];
  merged_at: string;
  /** The checks on main: accepted, failed (a check failed, or the module is waived), or not measured (a result is missing). */
  verdict: "accepted" | "failed" | "not_measured";
}

export interface AcceptedModule {
  status: "accepted";
  /** `<repo>:<path>` */
  key: string;
  repo: string;
  path: string;
  citation: string;
  case_id: string;
  route: AcceptRoute;
  sub_route: SubRoute;
  programs: string[];
  /** The accepting merge into the default branch. */
  accepted_at: string;
  /** Monday (UTC) of that merge's ISO week, YYYY-MM-DD. */
  week: string;
}

/** A later merge of a module that was already accepted: rework, which uses capacity but adds no module. */
export interface ReworkMerge {
  status: "rework";
  key: string;
  case_id: string;
  route: AcceptRoute;
  sub_route: SubRoute;
  programs: string[];
  merged_at: string;
  week: string;
}

/** A merged module never accepted, by the checks on its latest merge. */
export interface OpenModule {
  status: "not_measured" | "not_accepted";
  key: string;
  repo: string;
  path: string;
  citation: string;
  case_id: string;
  route: AcceptRoute;
  sub_route: SubRoute;
  programs: string[];
  merged_at: string;
  /** Monday (UTC) of the latest merge's ISO week. */
  week: string;
}

export interface ModuleLedger {
  accepted: AcceptedModule[];
  rework: ReworkMerge[];
  /** Merged, with a compile or test result missing: unknown, not failed. */
  not_measured: OpenModule[];
  /** Merged, with a failed compile or test, or an active waiver. */
  not_accepted: OpenModule[];
}

/** Monday (UTC) of an instant's ISO week, as YYYY-MM-DD. */
export function isoWeek(iso: string): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function routeOf(subRoute: SubRoute): AcceptRoute {
  return subRoute === "hand" ? "hand" : "pipeline";
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function subRouteOf(caseSource: unknown): SubRoute {
  return caseSource === "outside" ? "hand" : caseSource === "dependent" ? "dep" : "dispatch";
}

/**
 * Every merged module file, from the event log, sorted into accepted,
 * rework, not measured and not accepted. A case's checks are its last
 * verdicts at compile and tests: compile leaves `ok` (or `skipped` for a
 * waived module) or fails; tests leave `ok` or `waived`, or fail. Both `ok`
 * accepts; any failure, a skip or a waiver fails; otherwise a result is
 * missing and the merge is not measured.
 */
export function moduleLedger(events: PipelineEvent[]): ModuleLedger {
  interface CaseFacts {
    citation: string;
    subRoute: SubRoute;
    programs: string[] | null;
    mergedAt: string | null;
    repo: string | null;
    modules: string[];
    compile: string | null;
    tests: string | null;
  }
  const cases = new Map<string, CaseFacts>();
  for (const e of events) {
    if (e.source !== "pipeline_attempts") continue;
    let c = cases.get(e.case_id);
    if (!c) {
      c = { citation: e.citation, subRoute: subRouteOf(e.attrs.case_source), programs: null, mergedAt: null, repo: null, modules: [], compile: null, tests: null };
      cases.set(e.case_id, c);
    }
    if (!c.programs && Array.isArray(e.attrs.programs)) c.programs = asStrings(e.attrs.programs);
    if (e.station === "merge" && e.kind === "leave") {
      c.mergedAt = e.at;
      c.repo = typeof e.attrs.repo === "string" ? e.attrs.repo : null;
      c.modules = asStrings(e.attrs.modules);
    } else if (e.station === "compile" && (e.kind === "leave" || e.kind === "fail")) {
      c.compile = e.kind === "fail" ? "fail" : (e.outcome ?? "ok");
    } else if (e.station === "tests" && (e.kind === "leave" || e.kind === "fail")) {
      c.tests = e.kind === "fail" ? "fail" : (e.outcome ?? "ok");
    }
  }

  const byKey = new Map<string, MergeFacts[]>();
  for (const [caseId, c] of cases) {
    if (!c.mergedAt) continue;
    const verdict: MergeFacts["verdict"] =
      c.compile === "ok" && c.tests === "ok"
        ? "accepted"
        : (c.compile && c.compile !== "ok") || (c.tests && c.tests !== "ok")
          ? "failed"
          : "not_measured";
    for (const path of c.modules) {
      const repo = c.repo ?? "?";
      const key = `${repo}:${path}`;
      const list = byKey.get(key) ?? [];
      list.push({
        key,
        repo,
        path,
        citation: c.citation,
        case_id: caseId,
        sub_route: c.subRoute,
        programs: c.programs?.length ? c.programs : [UNTAGGED],
        merged_at: c.mergedAt,
        verdict,
      });
      byKey.set(key, list);
    }
  }

  const ledger: ModuleLedger = { accepted: [], rework: [], not_measured: [], not_accepted: [] };
  for (const merges of byKey.values()) {
    merges.sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.case_id.localeCompare(b.case_id));
    const first = merges.find((m) => m.verdict === "accepted");
    if (first) {
      ledger.accepted.push({
        status: "accepted",
        key: first.key,
        repo: first.repo,
        path: first.path,
        citation: first.citation,
        case_id: first.case_id,
        route: routeOf(first.sub_route),
        sub_route: first.sub_route,
        programs: first.programs,
        accepted_at: first.merged_at,
        week: isoWeek(first.merged_at),
      });
      for (const m of merges) {
        if (m.merged_at <= first.merged_at) continue;
        ledger.rework.push({ status: "rework", key: m.key, case_id: m.case_id, route: routeOf(m.sub_route), sub_route: m.sub_route, programs: m.programs, merged_at: m.merged_at, week: isoWeek(m.merged_at) });
      }
      continue;
    }
    const last = merges[merges.length - 1];
    const status = last.verdict === "not_measured" ? "not_measured" : "not_accepted";
    ledger[status].push({
      status,
      key: last.key,
      repo: last.repo,
      path: last.path,
      citation: last.citation,
      case_id: last.case_id,
      route: routeOf(last.sub_route),
      sub_route: last.sub_route,
      programs: last.programs,
      merged_at: last.merged_at,
      week: isoWeek(last.merged_at),
    });
  }
  const byTime = <T extends { key: string }>(at: (x: T) => string) => (a: T, b: T) => at(a).localeCompare(at(b)) || a.key.localeCompare(b.key);
  ledger.accepted.sort(byTime((m) => m.accepted_at));
  ledger.rework.sort(byTime((m) => m.merged_at));
  ledger.not_measured.sort(byTime((m) => m.merged_at));
  ledger.not_accepted.sort(byTime((m) => m.merged_at));
  return ledger;
}

// ---- The weekly series ----------------------------------------------------

/** A count by route; `pipeline` = `dispatch` + `dep`. */
export interface RouteCounts {
  pipeline: number;
  dispatch: number;
  dep: number;
  hand: number;
}

export interface AcceptedWeek {
  week: string;
  /** New accepted modules. */
  total: RouteCounts;
  /** New accepted modules by program; a module in two programs counts in both. */
  programs: Record<string, RouteCounts>;
  /** Merges of modules already accepted. */
  rework: RouteCounts;
  /** Shown beside the headline: modules whose latest merge falls in the week and that have no compile or test result. */
  not_measured: RouteCounts;
  not_measured_programs: Record<string, RouteCounts>;
}

export interface AcceptedSeries {
  definition: string;
  /** Every week from the first accepted or not-measured module to `now`, empty weeks included. */
  weeks: AcceptedWeek[];
  totals: {
    total: RouteCounts;
    programs: Record<string, RouteCounts>;
    rework: RouteCounts;
    /** Shown beside the headline: merged modules with no compile or test result yet, by repo too. */
    not_measured: RouteCounts;
    not_measured_programs: Record<string, RouteCounts>;
    not_measured_by_repo: Record<string, number>;
    not_accepted: RouteCounts;
  };
  /** Programs seen among accepted and not-measured modules, plan programs first, then out_of_plan and untagged. */
  programs: string[];
}

const zero = (): RouteCounts => ({ pipeline: 0, dispatch: 0, dep: 0, hand: 0 });
const emptyWeek = (week: string): AcceptedWeek => ({ week, total: zero(), programs: {}, rework: zero(), not_measured: zero(), not_measured_programs: {} });

function add(counts: RouteCounts, subRoute: SubRoute): void {
  counts[subRoute]++;
  if (subRoute !== "hand") counts.pipeline++;
}

/** The weekly strict-accepted count, by route, sub-route and program, with rework and the modules not measured. */
export function acceptedSeries(ledger: ModuleLedger, now: number = Date.now()): AcceptedSeries {
  const byWeek = new Map<string, AcceptedWeek>();
  const week = (w: string) => {
    let entry = byWeek.get(w);
    if (!entry) {
      entry = emptyWeek(w);
      byWeek.set(w, entry);
    }
    return entry;
  };
  const totals: AcceptedSeries["totals"] = {
    total: zero(),
    programs: {},
    rework: zero(),
    not_measured: zero(),
    not_measured_programs: {},
    not_measured_by_repo: {},
    not_accepted: zero(),
  };
  const seen = new Set<string>();
  for (const m of ledger.accepted) {
    const w = week(m.week);
    add(w.total, m.sub_route);
    add(totals.total, m.sub_route);
    for (const p of m.programs) {
      seen.add(p);
      add((w.programs[p] ??= zero()), m.sub_route);
      add((totals.programs[p] ??= zero()), m.sub_route);
    }
  }
  for (const r of ledger.rework) {
    add(week(r.week).rework, r.sub_route);
    add(totals.rework, r.sub_route);
  }
  for (const m of ledger.not_measured) {
    const w = week(m.week);
    add(w.not_measured, m.sub_route);
    add(totals.not_measured, m.sub_route);
    for (const p of m.programs) {
      seen.add(p);
      add((w.not_measured_programs[p] ??= zero()), m.sub_route);
      add((totals.not_measured_programs[p] ??= zero()), m.sub_route);
    }
    totals.not_measured_by_repo[m.repo] = (totals.not_measured_by_repo[m.repo] ?? 0) + 1;
  }
  for (const m of ledger.not_accepted) add(totals.not_accepted, m.sub_route);

  const weeks: AcceptedWeek[] = [];
  const starts = [...byWeek.keys()].sort();
  if (starts.length) {
    const last = isoWeek(new Date(now).toISOString());
    for (let w = starts[0]; w <= last; ) {
      weeks.push(byWeek.get(w) ?? emptyWeek(w));
      const d = new Date(`${w}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7);
      w = d.toISOString().slice(0, 10);
    }
  }
  const tail = [OUT_OF_PLAN, UNTAGGED];
  const programs = [...seen].sort((a, b) => Number(tail.includes(a)) - Number(tail.includes(b)) || a.localeCompare(b));
  return { definition: ACCEPTED_DEFINITION, weeks, totals, programs };
}

/** A short markdown section for the agent brief: the headline, rework and not measured, then programs. */
export function acceptedBrief(series: AcceptedSeries, options: { programs?: boolean } = {}): string {
  const withPrograms = options.programs ?? true;
  const { total, rework, not_measured, not_measured_by_repo } = series.totals;
  const byRepo = Object.entries(not_measured_by_repo)
    .sort((a, b) => b[1] - a[1])
    .map(([repo, n]) => `${repo} ${n}`)
    .join(", ");
  const lines = [
    "## Accepted modules",
    "",
    `${total.pipeline + total.hand} accepted: ${total.pipeline} through the pipeline (${total.dispatch} dispatch, ${total.dep} dep), ${total.hand} merged by hand.`,
    `Not measured (merged, no compile or test result): ${not_measured.pipeline + not_measured.hand}${byRepo ? ` (${byRepo})` : ""}.`,
    `Rework (later merges of accepted modules): ${rework.pipeline + rework.hand}.`,
    "",
    ...(withPrograms ? programTable(series) : ["By program: /api/ops/flow?accepted.", ""]),
    series.definition,
    "",
  ];
  return lines.join("\n");
}

function programTable(series: AcceptedSeries): string[] {
  const { programs } = series.totals;
  return [
    "| program | accepted: dispatch | dep | hand | not measured |",
    "|---|---:|---:|---:|---:|",
    ...series.programs.map((p) => {
      const a = programs[p] ?? zero();
      const n = series.totals.not_measured_programs[p];
      return `| ${p} | ${a.dispatch} | ${a.dep} | ${a.hand} | ${n ? n.pipeline + n.hand : 0} |`;
    }),
    "",
  ];
}
