/**
 * Cross-cutting reads of the /ops pipeline: how far citations ever got,
 * what retries and re-dispatches yield, how success moved across encoder
 * versions, and what failing PR checks printed. Each is derived from the
 * same encodings.pipeline_attempts rows as the stage view, for whichever
 * jurisdictions the view is scoped to.
 */

import {
  checkErrorLabel,
  citationStates,
  pipelineItem,
  type PipelineAttempt,
  type PipelineGroupView,
} from "./encoding-pipeline";

/** Citations that ever reached each point, across all their dispatches. */
export interface PipelineFunnel {
  citations: number;
  encoded: number;
  merged: number;
  mergedMain: number;
  /** Merged into main and passing its jurisdiction's validation there. */
  passing: number;
}

export interface AttemptRate {
  label: string;
  success: number;
  total: number;
}

export interface RunStats {
  /** Each citation's first finished, uncancelled dispatch. */
  firstAttempt: { success: number; total: number };
  /** Finished, uncancelled dispatches by their place in the citation's history. */
  byAttempt: AttemptRate[];
  /** The citations dispatched most, when any was dispatched three times or more. */
  mostDispatched: Array<{ citation: string; dispatches: number; successes: number; merged: number }>;
  /** Encoder-reported cost, over the runs that report one. */
  cost: { recorded: number; finished: number; total: number; onFailures: number };
}

/** Consecutive encoder versions pooled until they hold enough finished runs to compare. */
export interface VersionBin {
  from: string;
  to: string;
  runs: number;
  successes: number;
  lastAt: string;
}

export interface PipelineInsights {
  funnel: PipelineFunnel;
  runs: RunStats;
  versions: VersionBin[];
  /** Citations in review by what their PR's failing check printed. */
  checkErrors: PipelineGroupView[];
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];
const MOST_DISPATCHED = 5;
const MOST_DISPATCHED_MIN = 3;
/** A version bin closes once it holds this many finished runs. */
const VERSION_BIN_RUNS = 10;
const VERSION_BINS_SHOWN = 8;
const CHECK_ERROR_ITEMS = 30;

const finished = (attempt: PipelineAttempt) =>
  attempt.run_status === "completed" &&
  attempt.run_conclusion !== null &&
  attempt.run_conclusion !== "cancelled";

function byCitation(attempts: PipelineAttempt[]): PipelineAttempt[][] {
  const groups = new Map<string, PipelineAttempt[]>();
  for (const attempt of attempts) {
    groups.set(attempt.citation, [...(groups.get(attempt.citation) ?? []), attempt]);
  }
  return [...groups.values()].map((list) =>
    [...list].sort((a, b) => a.dispatched_at.localeCompare(b.dispatched_at))
  );
}

export function pipelineFunnel(attempts: PipelineAttempt[]): PipelineFunnel {
  const groups = byCitation(attempts);
  const ever = (test: (attempt: PipelineAttempt) => boolean) =>
    groups.filter((list) => list.some(test)).length;
  const mergedMain = (a: PipelineAttempt) => a.pr_state === "merged" && a.pr_targets_default !== false;
  return {
    citations: groups.length,
    encoded: ever((a) => a.run_conclusion === "success"),
    merged: ever((a) => a.pr_state === "merged"),
    mergedMain: ever(mergedMain),
    passing: ever((a) => mergedMain(a) && a.tests_status === "pass"),
  };
}

export function runStats(attempts: PipelineAttempt[]): RunStats {
  const groups = byCitation(attempts);
  const buckets = [...ORDINALS, `${ORDINALS.length + 1}th+`].map((label) => ({
    label,
    success: 0,
    total: 0,
  }));
  let firstSuccess = 0;
  let firstTotal = 0;
  for (const list of groups) {
    list.filter(finished).forEach((attempt, index) => {
      const bucket = buckets[Math.min(index, buckets.length - 1)];
      const success = attempt.run_conclusion === "success";
      bucket.total += 1;
      bucket.success += Number(success);
      if (index === 0) {
        firstTotal += 1;
        firstSuccess += Number(success);
      }
    });
  }
  const mostDispatched = groups
    .filter((list) => list.length >= MOST_DISPATCHED_MIN)
    .sort((a, b) => b.length - a.length || a[0].citation.localeCompare(b[0].citation))
    .slice(0, MOST_DISPATCHED)
    .map((list) => ({
      citation: list[0].citation,
      dispatches: list.length,
      successes: list.filter((a) => a.run_conclusion === "success").length,
      merged: list.filter((a) => a.pr_state === "merged").length,
    }));
  const costed = attempts.filter((a) => a.cost_usd !== null);
  const sum = (list: PipelineAttempt[]) => list.reduce((total, a) => total + (a.cost_usd ?? 0), 0);
  return {
    firstAttempt: { success: firstSuccess, total: firstTotal },
    byAttempt: buckets.filter((bucket) => bucket.total > 0),
    mostDispatched,
    cost: {
      recorded: costed.length,
      finished: attempts.filter(finished).length,
      total: sum(costed),
      onFailures: sum(costed.filter((a) => a.run_conclusion === "failure")),
    },
  };
}

/** Dotted versions in numeric order: 0.2.999 before 0.2.2080. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? "";
    const y = right[i] ?? "";
    const diff = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Success across encoder versions. Releases come every few commits, so a
 * version alone rarely has enough runs; consecutive versions are pooled
 * until a bin holds VERSION_BIN_RUNS finished runs, and the newest bins are
 * kept (the last one may be short: the current encoder so far).
 */
export function versionBins(attempts: PipelineAttempt[]): VersionBin[] {
  const byVersion = new Map<string, PipelineAttempt[]>();
  for (const attempt of attempts) {
    if (!attempt.encoder_version || !finished(attempt)) continue;
    byVersion.set(attempt.encoder_version, [...(byVersion.get(attempt.encoder_version) ?? []), attempt]);
  }
  const bins: VersionBin[] = [];
  let open: VersionBin | null = null;
  for (const version of [...byVersion.keys()].sort(compareVersions)) {
    const runs = byVersion.get(version)!;
    open ??= { from: version, to: version, runs: 0, successes: 0, lastAt: "" };
    open.to = version;
    open.runs += runs.length;
    open.successes += runs.filter((a) => a.run_conclusion === "success").length;
    for (const run of runs) if (run.dispatched_at > open.lastAt) open.lastAt = run.dispatched_at;
    if (open.runs >= VERSION_BIN_RUNS) {
      bins.push(open);
      open = null;
    }
  }
  if (open) bins.push(open);
  return bins.slice(-VERSION_BINS_SHOWN);
}

/**
 * Citations in review by what their PR's failing check printed. PRs failing
 * the same way differ only in paths, hashes, and counts, so those are set
 * aside to group them (with number-only asides like a "(0:01:25)" duration);
 * the label keeps the counts of the first one.
 */
export function checkErrorGroups(
  attempts: PipelineAttempt[],
  referenceMs: number
): PipelineGroupView[] {
  const groups = new Map<string, PipelineGroupView>();
  for (const state of citationStates(attempts)) {
    const error = state.stage === "review" ? state.latest.pr_check_error : null;
    if (!error) continue;
    const label = checkErrorLabel(error);
    const key = label
      .replace(/\(\s*[\d:.,\s]+\)/g, "")
      .replace(/\d+(?:\.\d+)*/g, "N")
      .replace(/\s+/g, " ")
      .trim();
    const group = groups.get(key) ?? { key, label, count: 0, items: [] };
    group.count += 1;
    if (group.items.length < CHECK_ERROR_ITEMS) group.items.push(pipelineItem(state, referenceMs));
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function pipelineInsights(attempts: PipelineAttempt[], referenceMs: number): PipelineInsights {
  return {
    funnel: pipelineFunnel(attempts),
    runs: runStats(attempts),
    versions: versionBins(attempts),
    checkErrors: checkErrorGroups(attempts, referenceMs),
  };
}

/** Which jurisdictions the view covers: one and everything under it, or that one alone. */
export interface PipelineScope {
  jurisdiction: string;
  only: boolean;
}

export interface ScopeOption extends PipelineScope {
  label: string;
  citations: number;
}

/** The jurisdiction a dispatch belongs to, from its citation when not recorded. */
export function attemptJurisdiction(attempt: Pick<PipelineAttempt, "jurisdiction" | "citation">): string {
  return attempt.jurisdiction ?? attempt.citation.split("/")[0];
}

export function inScope(jurisdiction: string, scope: PipelineScope | null): boolean {
  if (!scope) return true;
  if (jurisdiction === scope.jurisdiction) return true;
  return !scope.only && jurisdiction.startsWith(`${scope.jurisdiction}-`);
}

/** The top-level jurisdiction: "us" for "us-la", "uk" for "uk-wakefield". */
export const rootJurisdiction = (jurisdiction: string) => jurisdiction.split("-")[0];

/** The scope a URL asks for (`?j=us`, `?j=us&only=1`), or null for everything. */
export function parseScope(params: Record<string, string | string[] | undefined>): PipelineScope | null {
  const value = params.j;
  const jurisdiction = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  if (!jurisdiction || !/^[a-z]{2}[a-z0-9:-]*$/.test(jurisdiction)) return null;
  const only = params.only;
  return { jurisdiction, only: (Array.isArray(only) ? only[0] : only) === "1" };
}

/**
 * The scopes worth offering: every top-level jurisdiction, largest first,
 * and, under the selected one, itself alone and each jurisdiction within it.
 */
export function scopeOptions(
  attempts: PipelineAttempt[],
  selected: PipelineScope | null
): { roots: ScopeOption[]; within: ScopeOption[] } {
  const citations = new Map<string, Set<string>>();
  for (const attempt of attempts) {
    const jurisdiction = attemptJurisdiction(attempt);
    citations.set(jurisdiction, (citations.get(jurisdiction) ?? new Set()).add(attempt.citation));
  }
  const count = (scope: PipelineScope) =>
    [...citations].reduce((total, [j, set]) => total + (inScope(j, scope) ? set.size : 0), 0);
  const roots = [...new Set([...citations.keys()].map(rootJurisdiction))]
    .map((root) => ({ jurisdiction: root, only: false, label: root, citations: 0 }))
    .map((option) => ({ ...option, citations: count(option) }))
    .sort((a, b) => b.citations - a.citations || a.label.localeCompare(b.label));
  if (!selected) return { roots, within: [] };
  const root = rootJurisdiction(selected.jurisdiction);
  const members = [...citations.keys()].filter((j) => rootJurisdiction(j) === root).sort();
  if (members.length < 2) return { roots, within: [] };
  const within: ScopeOption[] = members.map((jurisdiction) =>
    jurisdiction === root
      ? { jurisdiction, only: true, label: `${root} only`, citations: count({ jurisdiction, only: true }) }
      : { jurisdiction, only: false, label: jurisdiction, citations: count({ jurisdiction, only: false }) }
  );
  return { roots, within };
}
