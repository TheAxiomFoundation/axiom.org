/**
 * Accepted modules: the one number the roadmap's flow model runs on, measured
 * from the event log (see docs/operations/pipeline-flow.md, "Accepted
 * modules").
 *
 * A module (one RuleSpec file, `<repo>:<path>`) is strictly accepted when it
 * is merged into the default branch, compiles (`compile_status = ok`), and
 * passes its jurisdiction's tests on main with no active waiver
 * (`tests_status = pass`). It counts once, in the ISO week of the first merge
 * that made it accepted. Each one carries its route (the encoder wrote it, or
 * a PR merged it by hand) and the programs whose bundles hold its citation.
 */

import type { PipelineEvent } from "./pipeline-events";

/** Who wrote an accepted module: the encoder (a dispatch or a `dep:` module), or a hand-merged PR. */
export type AcceptRoute = "pipeline" | "hand";

/** The program of a module that no plan program's bundle holds (tariff and customs rules, say). */
export const OUT_OF_PLAN = "out_of_plan";
/** The program of a module whose case carries no program tag (the bundle lookup was not run). */
export const UNTAGGED = "untagged";

export const ACCEPTED_DEFINITION =
  "A RuleSpec module file counts as accepted when it is merged into its repo's default branch, compiles in axiom-api's sweep (compile_status = ok), and passes its jurisdiction's tests on main with no active validation waiver (tests_status = pass). Each file counts once, in the ISO week (Monday, UTC) of the first merge that made it accepted. Route: pipeline = the encoder wrote it (a dispatch or a module written inside another citation's run); hand = a PR merged it with no dispatch. A module in several programs' bundles counts in each program, and once in the total.";

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
 * citation. Cases with no citation of their own (encoder changes) stay
 * untagged. Returns the events, changed in place.
 */
export function tagPrograms(events: PipelineEvent[], index: Map<string, Set<string>>): PipelineEvent[] {
  const cache = new Map<string, string[]>();
  for (const e of events) {
    if (e.source === "encoder_change" || !e.citation.includes("/")) continue;
    let programs = cache.get(e.citation);
    if (!programs) {
      programs = citationPrograms(e.citation, index);
      cache.set(e.citation, programs);
    }
    e.attrs = { ...e.attrs, programs };
  }
  return events;
}

// ---- Accepted modules -----------------------------------------------------

export interface AcceptedModule {
  /** `<repo>:<path>` */
  key: string;
  repo: string;
  path: string;
  citation: string;
  case_id: string;
  route: AcceptRoute;
  programs: string[];
  /** The accepting merge into the default branch. */
  accepted_at: string;
  /** Monday (UTC) of that merge's ISO week, YYYY-MM-DD. */
  week: string;
}

/** Monday (UTC) of an instant's ISO week, as YYYY-MM-DD. */
export function isoWeek(iso: string): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Every strictly accepted module, from the event log: a case whose merge
 * left for the default branch, whose compile left `ok` and whose tests left
 * `ok` (a waived module leaves tests as `waived`, and compiles as `skipped`).
 * A module accepted in several cases counts at its earliest accepting merge.
 */
export function acceptedModules(events: PipelineEvent[]): AcceptedModule[] {
  interface CaseFacts {
    citation: string;
    route: AcceptRoute;
    programs: string[] | null;
    mergedAt: string | null;
    repo: string | null;
    modules: string[];
    compiles: boolean;
    passes: boolean;
  }
  const cases = new Map<string, CaseFacts>();
  for (const e of events) {
    if (e.source !== "pipeline_attempts") continue;
    let c = cases.get(e.case_id);
    if (!c) {
      c = {
        citation: e.citation,
        route: e.attrs.case_source === "outside" ? "hand" : "pipeline",
        programs: null,
        mergedAt: null,
        repo: null,
        modules: [],
        compiles: false,
        passes: false,
      };
      cases.set(e.case_id, c);
    }
    if (!c.programs && Array.isArray(e.attrs.programs)) c.programs = asStrings(e.attrs.programs);
    if (e.kind !== "leave") continue;
    if (e.station === "merge") {
      c.mergedAt = e.at;
      c.repo = typeof e.attrs.repo === "string" ? e.attrs.repo : null;
      c.modules = asStrings(e.attrs.modules);
    } else if (e.station === "compile" && e.outcome === "ok") c.compiles = true;
    else if (e.station === "tests" && e.outcome === "ok") c.passes = true;
  }

  const first = new Map<string, AcceptedModule>();
  for (const [caseId, c] of cases) {
    if (!c.mergedAt || !c.compiles || !c.passes) continue;
    for (const path of c.modules) {
      const key = `${c.repo ?? "?"}:${path}`;
      const prev = first.get(key);
      if (prev && prev.accepted_at <= c.mergedAt) continue;
      first.set(key, {
        key,
        repo: c.repo ?? "?",
        path,
        citation: c.citation,
        case_id: caseId,
        route: c.route,
        programs: c.programs?.length ? c.programs : [UNTAGGED],
        accepted_at: c.mergedAt,
        week: isoWeek(c.mergedAt),
      });
    }
  }
  return [...first.values()].sort((a, b) => a.accepted_at.localeCompare(b.accepted_at) || a.key.localeCompare(b.key));
}

export interface RouteCounts {
  pipeline: number;
  hand: number;
}

export interface AcceptedWeek {
  week: string;
  total: RouteCounts;
  /** By program; a module in two programs counts in both. */
  programs: Record<string, RouteCounts>;
}

export interface AcceptedSeries {
  definition: string;
  /** Every week from the first accepted module to `now`, empty weeks included. */
  weeks: AcceptedWeek[];
  totals: { total: RouteCounts; programs: Record<string, RouteCounts> };
  /** Programs seen, plan programs first, then out_of_plan and untagged. */
  programs: string[];
}

const zero = (): RouteCounts => ({ pipeline: 0, hand: 0 });

/** The weekly strict-accepted count, by route and program, for the flow model. */
export function acceptedSeries(modules: AcceptedModule[], now: number = Date.now()): AcceptedSeries {
  const byWeek = new Map<string, AcceptedWeek>();
  const totals = { total: zero(), programs: {} as Record<string, RouteCounts> };
  const seen = new Set<string>();
  for (const m of modules) {
    const w = byWeek.get(m.week) ?? { week: m.week, total: zero(), programs: {} };
    byWeek.set(m.week, w);
    w.total[m.route]++;
    totals.total[m.route]++;
    for (const p of m.programs) {
      seen.add(p);
      (w.programs[p] ??= zero())[m.route]++;
      (totals.programs[p] ??= zero())[m.route]++;
    }
  }
  const weeks: AcceptedWeek[] = [];
  if (modules.length) {
    const last = isoWeek(new Date(now).toISOString());
    for (let w = modules.reduce((min, m) => (m.week < min ? m.week : min), modules[0].week); w <= last; ) {
      weeks.push(byWeek.get(w) ?? { week: w, total: zero(), programs: {} });
      const d = new Date(`${w}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7);
      w = d.toISOString().slice(0, 10);
    }
  }
  const tail = [OUT_OF_PLAN, UNTAGGED];
  const programs = [...seen].sort((a, b) => Number(tail.includes(a)) - Number(tail.includes(b)) || a.localeCompare(b));
  return { definition: ACCEPTED_DEFINITION, weeks, totals, programs };
}

/** A short markdown section for the agent brief: totals by route, then by program. */
export function acceptedBrief(series: AcceptedSeries): string {
  const { total, programs } = series.totals;
  const lines = [
    "## Accepted modules",
    "",
    `${total.pipeline + total.hand} accepted in total: ${total.pipeline} through the pipeline, ${total.hand} merged by hand.`,
    "",
    "| program | pipeline | hand |",
    "|---|---:|---:|",
    ...series.programs.map((p) => `| ${p} | ${programs[p].pipeline} | ${programs[p].hand} |`),
    "",
    series.definition,
    "",
  ];
  return lines.join("\n");
}
