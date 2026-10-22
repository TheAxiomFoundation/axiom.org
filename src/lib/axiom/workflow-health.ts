/**
 * The /ops "Workflows" strip: the GitHub Actions workflows the encoding
 * pipeline depends on, each with its state (on or turned off), its last
 * finished run, the run in progress, and its runs, failures and
 * cancellations over the last 7 days. The encode runs' own failures are on
 * the Line tab; these are the workflows around them, which otherwise
 * fail unseen.
 *
 * Reads are best-effort and cached: a workflow that cannot be read is
 * "unknown" and never breaks the page. Each workflow costs one
 * `actions/workflows/<file>` read and one read of its runs created in the
 * last 7 days; a workflow with more than 200 runs in that window (two more
 * pages) counts its failures and cancellations with two filtered reads
 * instead, and one whose window holds no finished run reads its newest
 * finished runs once more.
 */

import { unstable_cache } from "next/cache";

const ORG = "TheAxiomFoundation";
const REVALIDATE_SECONDS = 300;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The most runs one read returns. */
const PAGE = 100;
/** A read that takes longer than this leaves its workflow unknown. */
const TIMEOUT_MS = 8_000;

export interface WorkflowSpec {
  /** The repository under TheAxiomFoundation. */
  repo: string;
  /** The workflow file under .github/workflows. */
  file: string;
  /** A short name for the chip. */
  label: string;
  /** What it does, in a few words. */
  does: string;
  /** Count only this branch's runs (a CI workflow's pull request runs are that PR's business). */
  branch?: string;
  /**
   * Cancelled runs are part of how it works (a newer run replaces a waiting
   * one, or an operator cancels a superseded one): they are counted, but the
   * last run is the newest one that was not cancelled.
   */
  routineCancels?: boolean;
  /** Shown by its state and last run only: its failures are on the Line tab. */
  stateOnly?: boolean;
  /** A warning when no run is in progress and the last one finished longer ago than this. */
  staleAfterMinutes?: number;
}

/** In pipeline order: the corpus, the encodes, then the collector behind this page. */
export const WORKFLOWS: WorkflowSpec[] = [
  {
    repo: "axiom-corpus",
    file: "publish.yml",
    label: "Corpus publish",
    does: "Signs and uploads a corpus release",
    routineCancels: true,
  },
  {
    repo: "axiom-corpus",
    file: "activate-release.yml",
    label: "Release activation",
    does: "Makes the site serve a signed release",
    routineCancels: true,
  },
  {
    repo: "axiom-encode",
    file: "snap-dispatch-queue.yml",
    label: "SNAP queue",
    does: "Sends queued SNAP sections to encode, hourly",
  },
  {
    repo: "axiom-encode",
    file: "targeted-signed-reencode.yml",
    label: "Encode runs",
    does: "Encodes one section per run; its failures are on the Line tab",
    stateOnly: true,
  },
  {
    repo: "axiom-encode",
    file: "signing-supervisor.yml",
    label: "Signing supervisor",
    does: "Builds and tests the signer that signs encodes (main branch)",
    branch: "main",
  },
  {
    repo: "axiom.org",
    file: "collect-encoding-pipeline.yml",
    label: "Ops collector",
    does: "Refreshes this page's tabs every 30 minutes",
    staleAfterMinutes: 90,
  },
  {
    repo: "axiom.org",
    file: "collector-heartbeat.yml",
    label: "Collector heartbeat",
    does: "Starts the ops collector every 30 minutes",
    routineCancels: true,
    staleAfterMinutes: 180,
  },
];

export interface WorkflowRunRef {
  /** success, failure, cancelled, timed_out, ... (for a run in progress: its status). */
  conclusion: string;
  /** When it finished; when it started, for a run in progress. */
  at: string;
  url: string;
}

export interface WorkflowRead {
  /** active, disabled_manually, disabled_inactivity, ... */
  state: string;
  /** The newest finished run that counts (never a skipped one; not a cancelled one with routine cancels). */
  last: WorkflowRunRef | null;
  /** The run in progress, or else the newest one waiting to start. */
  running: (WorkflowRunRef & { waiting: boolean }) | null;
  /** The last 7 days; null when not read (a state-only workflow). */
  week: { runs: number; failed: number; cancelled: number } | null;
}

export type WorkflowGrade = "ok" | "warning" | "failing" | "off" | "unknown";

export interface WorkflowHealth extends WorkflowSpec {
  /** The workflow's runs page on GitHub. */
  url: string;
  /** Null when GitHub could not be read. */
  read: WorkflowRead | null;
}

/** Conclusions that mean the run failed. */
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
/** Conclusions that mean the run did its work. */
const PASSED = new Set(["success", "neutral"]);

export function runsPageUrl(spec: Pick<WorkflowSpec, "repo" | "file" | "branch">): string {
  const base = `https://github.com/${ORG}/${spec.repo}/actions/workflows/${spec.file}`;
  return spec.branch ? `${base}?query=${encodeURIComponent(`branch:${spec.branch}`)}` : base;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A whole-hours-or-minutes span: "45 min", "3h". */
function span(minutes: number): string {
  return minutes < 60 ? `${Math.round(minutes)} min` : `${Math.floor(minutes / 60)}h`;
}

/**
 * A workflow's grade, and why in a few words:
 * - off: turned off (any state but active);
 * - unknown: GitHub could not be read, or no finished run was found;
 * - failing: the last finished run failed;
 * - warning: the last run was cancelled or ended another way, no run for
 *   longer than expected, or failures in the last 7 days under a last run
 *   that passed;
 * - ok: otherwise.
 * A state-only workflow is ok while it is on: its runs are graded elsewhere.
 */
export function gradeWorkflow(
  spec: Pick<WorkflowSpec, "stateOnly" | "staleAfterMinutes">,
  read: WorkflowRead | null,
  referenceMs: number
): { grade: WorkflowGrade; reason: string } {
  if (!read) return { grade: "unknown", reason: "Could not be read from GitHub" };
  if (read.state !== "active") {
    return { grade: "off", reason: `Turned off (${read.state.replace(/_/g, " ")})` };
  }
  if (spec.stateOnly) return { grade: "ok", reason: "On" };
  const { last, running, week } = read;
  if (!last) {
    return running
      ? { grade: "ok", reason: "First run in progress" }
      : { grade: "unknown", reason: "No finished run found" };
  }
  if (FAILED.has(last.conclusion)) return { grade: "failing", reason: "Last run failed" };
  if (last.conclusion === "cancelled") return { grade: "warning", reason: "Last run cancelled" };
  if (!PASSED.has(last.conclusion)) {
    return { grade: "warning", reason: `Last run ended: ${last.conclusion.replace(/_/g, " ")}` };
  }
  const idleMinutes = (referenceMs - Date.parse(last.at)) / 60_000;
  if (spec.staleAfterMinutes && !running && idleMinutes > spec.staleAfterMinutes) {
    return { grade: "warning", reason: `No run for ${span(idleMinutes)}` };
  }
  if (week && week.failed > 0) {
    return { grade: "warning", reason: `${week.failed} failed in 7 days; the last run passed` };
  }
  return { grade: "ok", reason: "Last run passed" };
}

/* ── Reading GitHub ── */

interface ApiRun {
  status: string | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  html_url: string;
}

interface ApiRuns {
  total_count: number;
  workflow_runs: ApiRun[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const token = (process.env.AXIOM_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim();
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token && url.startsWith("https://api.github.com/") ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  } as RequestInit);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json() as Promise<T>;
}

/** The newest finished run that counts, from runs newest first. */
function lastRun(runs: ApiRun[], routineCancels: boolean | undefined): WorkflowRunRef | null {
  const run = runs.find(
    (r) =>
      r.status === "completed" &&
      r.conclusion &&
      r.conclusion !== "skipped" &&
      !(routineCancels && r.conclusion === "cancelled")
  );
  return run ? { conclusion: run.conclusion!, at: run.updated_at, url: run.html_url } : null;
}

/** The run in progress, else the newest one waiting to start. */
function runningRun(runs: ApiRun[]): WorkflowRead["running"] {
  const open = runs.filter((r) => r.status !== "completed");
  const run = open.find((r) => r.status === "in_progress") ?? open[0];
  if (!run) return null;
  return {
    conclusion: run.status ?? "queued",
    at: run.run_started_at ?? run.created_at,
    url: run.html_url,
    waiting: run.status !== "in_progress",
  };
}

/**
 * One workflow's state and runs. Exported for tests; production callers use
 * getWorkflowHealth. Throws when GitHub cannot be read, so a failure is
 * never cached.
 */
export async function readWorkflow(spec: WorkflowSpec, nowMs = Date.now()): Promise<WorkflowRead> {
  const api = `https://api.github.com/repos/${ORG}/${spec.repo}/actions/workflows/${spec.file}`;
  const since = new Date(nowMs - WINDOW_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const filter = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(spec.branch ? { branch: spec.branch } : {}),
      ...extra,
    }).toString();
  const windowRuns = (extra: Record<string, string>) =>
    fetchJson<ApiRuns>(`${api}/runs?${filter({ created: `>=${since}`, ...extra })}`);

  const [workflow, first] = await Promise.all([
    fetchJson<{ state?: string }>(api),
    windowRuns({ per_page: String(PAGE) }),
  ]);
  let runs = first.workflow_runs;
  let week: WorkflowRead["week"] = null;
  if (!spec.stateOnly) {
    const total = first.total_count;
    if (total <= runs.length) {
      week = tally(runs);
    } else if (total <= 2 * PAGE) {
      // One more page holds the rest of the window.
      const second = await windowRuns({ per_page: String(PAGE), page: "2" });
      runs = [...runs, ...second.workflow_runs];
      week = { ...tally(runs), runs: total };
    } else {
      // Counting by conclusion takes two reads however many runs there are.
      const [failed, cancelled] = await Promise.all([
        windowRuns({ per_page: "1", status: "failure" }),
        windowRuns({ per_page: "1", status: "cancelled" }),
      ]);
      week = { runs: total, failed: failed.total_count, cancelled: cancelled.total_count };
    }
  }

  let last = lastRun(runs, spec.routineCancels);
  if (!last) {
    // Nothing finished in the window (a quiet or turned-off workflow): its newest finished runs.
    const older = await fetchJson<ApiRuns>(`${api}/runs?${filter({ status: "completed", per_page: "20" })}`);
    last = lastRun(older.workflow_runs, spec.routineCancels);
  }
  return {
    state: workflow.state ?? "unknown",
    last,
    running: runningRun(runs),
    week,
  };
}

function tally(runs: ApiRun[]): NonNullable<WorkflowRead["week"]> {
  return {
    runs: runs.length,
    failed: runs.filter((r) => r.status === "completed" && FAILED.has(r.conclusion ?? "")).length,
    cancelled: runs.filter((r) => r.status === "completed" && r.conclusion === "cancelled").length,
  };
}

const cachedWorkflow = unstable_cache((spec: WorkflowSpec) => readWorkflow(spec), ["ops-workflow-health-v1"], {
  revalidate: REVALIDATE_SECONDS,
});

/**
 * Every workflow in WORKFLOWS, in order, each read at most every
 * REVALIDATE_SECONDS; a workflow that cannot be read has a null read.
 */
export async function getWorkflowHealth(
  specs: WorkflowSpec[] = WORKFLOWS,
  read: (spec: WorkflowSpec) => Promise<WorkflowRead> = cachedWorkflow
): Promise<WorkflowHealth[]> {
  return Promise.all(
    specs.map(async (spec) => ({
      ...spec,
      url: runsPageUrl(spec),
      read: await read(spec).catch(() => null),
    }))
  );
}
