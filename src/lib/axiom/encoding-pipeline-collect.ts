/**
 * Pure assembly of encodings.pipeline_attempts rows from the raw sources
 * scripts/collect-encoding-pipeline.mjs fetches:
 *
 *   - GitHub Actions runs of axiom-encode's targeted-signed-reencode.yml
 *     (one dispatch each, named "... [queue:item:sha] <citation>");
 *   - encodings.encoding_runs, the encoder's own record, joined by citation
 *     to the one run whose encode step holds its timestamp (the rows carry
 *     no Actions run id; see matchEncoderRuns);
 *   - failure details for runs without an encoder record: the run's
 *     targeted-reencode-failure diagnostics bundle, else the jobs API;
 *   - "Add signed encoding manifest for <citation>" PRs across the
 *     rulespec-* repos, linked to their run by the body's run URL, and for
 *     one merged into a side branch, that branch's own PR into the default
 *     branch (see viaPrFor);
 *   - encodings.rulespec_files (the index) and the axiom-api compile sweep;
 *   - every other PR merged into a rulespec-* repo's default branch, for
 *     the modules people encode outside the pipeline (see outsideModules);
 *   - encoder records of modules the encoder wrote inside another
 *     citation's run, a source or a dependent module, joined to that run
 *     (see matchDependentHosts).
 *
 * Kept free of I/O so every join rule is unit-tested.
 */

import {
  attemptSource,
  dependentAttemptId,
  dependentQueueRef,
  mainMergedAt,
  outsideAttemptId,
  outsideIdParts,
  type EncodeLoopTiming,
  type PipelineAttempt,
  type PipelineTry,
  type PipelineTryPhase,
} from "./encoding-pipeline";

export interface WorkflowRun {
  id: number;
  display_title: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
  html_url: string;
  run_attempt?: number | null;
  /** Login of whoever started (or re-ran) it. */
  triggering_actor?: string | null;
  /** The axiom-encode commit the run checked out: the encoder that ran. */
  head_sha?: string | null;
}

export interface EncoderRunRow {
  id: string;
  timestamp: string;
  citation: string | null;
  status: string | null;
  apply_error: string | null;
  note: string | null;
  generation_attempt_count: number | null;
  estimated_cost_usd: number | null;
  /** The Actions run that wrote the record (axiom-encode migration 008 on). */
  github_run_id?: string | null;
  /** One entry per generation attempt: model, time, tokens, cost, and the errors that sent it back. */
  iterations?: unknown;
  /** The record's `outcome.encode_loop_timing`: its loop's clock (axiom-encode 0.2.2157 on). */
  loop_timing?: unknown;
  /**
   * Where the encoder wrote the module: `<runner temp>/generated/<lane>/<model>/<repo path>`,
   * the lane being target, a source (source-01, ...), or a dependent module.
   */
  file_path?: string | null;
  /** The axiom-encode package version that wrote the record. */
  encoder_version?: string | null;
}

export interface ManifestPr {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRefName: string;
  defaultBranch: string | null;
  /** The head commit's statusCheckRollup state, if any. */
  checks: string | null;
  reviewDecision: string | null;
  files: string[];
  /** Head commit's failed checks, by name, without the aggregate "validate / validate". */
  failedChecks?: string[];
  /** How many head commit checks were cancelled before finishing. */
  cancelledChecks?: number;
  /** The head commit's failed check runs with their Actions job ids, by name. */
  failedJobs?: FailedJob[];
  requestedReviewers?: string[];
  mergeCommit?: string | null;
  /** For a PR merged into a side branch, once looked up: that branch's own
   *  PR into the default branch that carries it there, or null (see viaPrFor). */
  via?: BranchPr | null;
  /** For one module of a PR merged outside the pipeline: the module's
   *  jurisdiction (a manifest PR's comes from its title) and the PR's author. */
  jurisdiction?: string | null;
  author?: string | null;
}

/** A pull request from a side branch (its head) into the repo's default branch. */
export interface BranchPr {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  mergeCommit: string | null;
}

export interface FailedJob {
  name: string;
  id: number;
}

export interface MirrorRow {
  repo: string;
  jurisdiction: string;
  file_path: string;
  citation_path: string;
  synced_at: string;
  raw_yaml_sha256: string | null;
  /** The commit the sync read (once the commit_sha column exists). */
  commit_sha?: string | null;
}

export interface CompileSweepRow {
  repo: string;
  file_path: string;
  citation_path: string;
  raw_yaml_sha256: string | null;
  status: string;
  error: string | null;
}

export interface CompileSweep {
  generated_at: string;
  rows: CompileSweepRow[];
}

export interface FailureDetail {
  /** "log" when the cause came from the failing job's log, after the
   *  failure bundle or the jobs listing named only the step. */
  source: "diagnostics" | "jobs" | "log";
  /** The dispatched citation, when the bundle records it (early runs' names do not). */
  citation?: string | null;
  failed_step: string | null;
  error: string | null;
  rule: string | null;
}

const RUN_TITLE_RE = /\[([^\]]+)\]\s+(\S+)\s*$/;
const PR_TITLE_PREFIX = "Add signed encoding manifest for ";
const PR_RUN_RE =
  /Axiom Encode run:\s*<?https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/(\d+)/;
// A validator rule id: letters first, with at least one "-" or ":" segment
// (complete-source-unit:structure), so an index like versions[0] never matches.
const ERROR_RULE_RE = /\[([a-z][a-z0-9]*(?:[-:][a-z0-9]+)+)\]/i;
const ERROR_MAX_CHARS = 500;
/** Clock slack between the Actions run and the encoder's own timestamps. */
const ENCODER_WINDOW_SLACK_MS = 10 * 60 * 1000;

export function parseRunTitle(
  title: string
): { queueRef: string; citation: string } | null {
  const match = title.match(RUN_TITLE_RE);
  if (!match) return null;
  return { queueRef: match[1], citation: match[2] };
}

export function prCitation(title: string): string | null {
  if (!title.startsWith(PR_TITLE_PREFIX)) return null;
  const citation = title.slice(PR_TITLE_PREFIX.length).trim();
  return citation || null;
}

export function prRunId(body: string | null | undefined): string | null {
  return body?.match(PR_RUN_RE)?.[1] ?? null;
}

/** The bracketed validator rule of an issue, e.g. complete-source-unit:structure. */
export function errorRule(message: string | null | undefined): string | null {
  return message?.match(ERROR_RULE_RE)?.[1] ?? null;
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * The encode loop's tries from the encoder's record: each attempt's model,
 * its own time and cost, whether its candidate passed, and the first error
 * that sent it back for repair. Null when the record has no iterations.
 */
export function encoderTries(row: EncoderRunRow): PipelineTry[] | null {
  if (!Array.isArray(row.iterations)) return null;
  const tries = row.iterations
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry, index) => {
      const errors = Array.isArray(entry.errors) ? entry.errors : [];
      const first = errors.find((error) => error && typeof error === "object" && "message" in error) as
        | { message?: unknown }
        | undefined;
      const attempt: PipelineTry = {
        attempt: number(entry.attempt) ?? index + 1,
        model: typeof entry.model === "string" ? entry.model : null,
        ms: number(entry.duration_ms),
        cost: number(entry.estimated_cost_usd),
        ok: entry.success === true,
        error: truncateError(typeof first?.message === "string" ? first.message : null),
      };
      // Encoder 0.2.2157 on also times the whole try, phase by phase; older records keep the model time only.
      const startedAt = typeof entry.started_at === "string" ? entry.started_at : null;
      const wallMs = number(entry.wall_duration_ms);
      const phases = tryPhases(entry.phases);
      if (startedAt && wallMs !== null && phases) Object.assign(attempt, { startedAt, wallMs, phases });
      return attempt;
    });
  return tries.length ? tries : null;
}

/** A try's phases as the encoder lists them, each with its time and, for a check phase, its time by tool. */
function tryPhases(value: unknown): PipelineTryPhase[] | null {
  if (!Array.isArray(value)) return null;
  const phases: PipelineTryPhase[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { name, duration_ms, breakdown_ms } = entry as Record<string, unknown>;
    const ms = number(duration_ms);
    if (typeof name !== "string" || ms === null) continue;
    const tools =
      breakdown_ms && typeof breakdown_ms === "object"
        ? Object.fromEntries(
            Object.entries(breakdown_ms as Record<string, unknown>).filter(
              (pair): pair is [string, number] => number(pair[1]) !== null
            )
          )
        : {};
    phases.push(Object.keys(tools).length ? { name, ms, tools } : { name, ms });
  }
  return phases.length ? phases : null;
}

/** The encoder record's loop clock: its start, its whole time, and its time around the tries. Null before 0.2.2157. */
export function encoderLoop(row: EncoderRunRow): EncodeLoopTiming | null {
  const loop = row.loop_timing;
  if (!loop || typeof loop !== "object") return null;
  const timing = loop as Record<string, unknown>;
  const wallMs = number(timing.wall_duration_ms);
  if (wallMs === null) return null;
  return {
    startedAt: typeof timing.started_at === "string" ? timing.started_at : null,
    wallMs,
    setupMs: number(timing.setup_ms),
    triesMs: number(timing.tries_ms),
    betweenMs: number(timing.between_tries_ms),
    finalizeMs: number(timing.finalize_ms),
  };
}

export function truncateError(message: string | null | undefined): string | null {
  const trimmed = message?.trim();
  if (!trimmed) return null;
  return trimmed.length > ERROR_MAX_CHARS
    ? `${trimmed.slice(0, ERROR_MAX_CHARS - 1)}…`
    : trimmed;
}

export function jurisdictionOf(citation: string): string | null {
  const head = citation.split("/")[0];
  return /^[a-z]{2}(-[a-z0-9-]+)*$/.test(head) ? head : null;
}

/**
 * RuleSpec module files a PR adds or changes: YAML, not tests, not .axiom/,
 * and not the repo-root ledgers (known-validation-gaps.yaml,
 * oracle-coverage-pending.yaml, ...). A module always sits in a bucket
 * directory (statutes/..., or us/statutes/... in a monorepo); the root
 * files are never in the index, so counting one would mark the PR's
 * modules missing from it.
 */
export function rulespecModulePaths(files: string[]): string[] {
  return files
    .filter(
      (path) =>
        /\.ya?ml$/.test(path) &&
        path.includes("/") &&
        !/\.test\.ya?ml$/.test(path) &&
        !path.startsWith(".") &&
        !path.includes("/.")
    )
    .sort();
}

/** The first day a PR merged outside the pipeline is collected from. */
export const OUTSIDE_SINCE = "2026-07-22T00:00:00Z";
/** How far before the previous pass a pass lists merged PRs again: a pass that failed to write loses nothing. */
const OUTSIDE_RELIST_MS = 24 * 60 * 60 * 1000;

/** A PR merged into a rulespec-* repo, as the collector lists it; `files` only once read. */
export interface MergedPr {
  repo: string;
  number: number;
  url: string;
  title?: string;
  author: string | null;
  createdAt: string;
  mergedAt: string;
  baseRefName: string;
  defaultBranch: string;
  mergeCommit: string | null;
  /** Repo-relative paths it added or changed (deletions left out); undefined until read. */
  files?: string[];
}

/** One module file a PR merged outside the pipeline, ready for the post-merge joins. */
export interface OutsideModule {
  /** The PR with this one module as its files, its jurisdiction and author set. */
  pr: ManifestPr;
  path: string;
  citation: string;
  /** Where the citation came from: the index, an earlier pass, or the module's path. */
  citationFrom: "index" | "stored" | "path";
}

const prKey = (repo: string, number: number) => `${repo}#${number}`;

/** Bucket directories whose citation segment is the singular (statutes → statute). */
const CITATION_BUCKETS: Record<string, string> = { statutes: "statute", regulations: "regulation", policies: "policy" };
const MODULE_BUCKETS = new Set(["statutes", "regulations", "policies", "manuals", "manual", "rulemaking", "forms", "guidance"]);
const JURISDICTION_RE = /^[a-z]{2}(-[a-z0-9-]+)*$/;

/**
 * A module's citation from its path alone, for a module the index does not
 * hold: the jurisdiction directory (or, in a single-jurisdiction repo, the
 * repo's), the bucket in the singular, and the rest without `.yaml`
 * (rulespec-us `us-az/statutes/46/292.yaml` is `us-az/statute/46/292`). A
 * root directory that is not a bucket but holds jurisdiction directories
 * (rulespec-us `programs/us-fl/snap/fy-2026.yaml`) reads as that
 * jurisdiction's (`us-fl/programs/snap/fy-2026`). As the index does, a US
 * federal regulation drops its title's `-cfr`.
 */
export function derivedCitation(repo: string, path: string): string {
  const segments = path.replace(/\.ya?ml$/, "").split("/");
  let jurisdiction: string;
  let rest: string[];
  if (JURISDICTION_RE.test(segments[0]) && !MODULE_BUCKETS.has(segments[0])) {
    [jurisdiction, ...rest] = segments;
  } else if (!MODULE_BUCKETS.has(segments[0]) && segments[1] && JURISDICTION_RE.test(segments[1])) {
    jurisdiction = segments[1];
    rest = [segments[0], ...segments.slice(2)];
  } else {
    jurisdiction = repo.replace(/^rulespec-/, "");
    rest = segments;
  }
  const [bucket, ...tail] = rest;
  if (jurisdiction === "us" && bucket === "regulations" && tail.length) tail[0] = tail[0].replace(/-cfr$/, "");
  return [jurisdiction, CITATION_BUCKETS[bucket] ?? bucket, ...tail].join("/");
}

/** A module's citation: from the index, else what an earlier pass stored, else its path. */
function outsideCitation(
  repo: string,
  path: string,
  index: MirrorIndex,
  stored: string | null | undefined
): Pick<OutsideModule, "citation" | "citationFrom"> {
  const row = index.byPath.get(`${repo}:${path}`);
  if (row) return { citation: row.citation_path, citationFrom: "index" };
  if (stored) return { citation: stored, citationFrom: "stored" };
  return { citation: derivedCitation(repo, path), citationFrom: "path" };
}

/** The PRs a dispatch row stands for: every manifest PR (its run's row, or its own when the run is gone). */
function dispatchPrKeys(manifestPrs: ManifestPr[], previous: Map<string, Partial<PipelineAttempt>>): Set<string> {
  const keys = new Set(manifestPrs.map((pr) => prKey(pr.repo, pr.number)));
  for (const row of previous.values()) {
    if (row.id && attemptSource({ id: row.id }) === "dispatch" && row.pr_repo && row.pr_number != null) {
      keys.add(prKey(row.pr_repo, Number(row.pr_number)));
    }
  }
  return keys;
}

/** Stored outside rows by their PR. */
function storedOutside(previous: Map<string, Partial<PipelineAttempt>>): Map<string, Partial<PipelineAttempt>[]> {
  const byPr = new Map<string, Partial<PipelineAttempt>[]>();
  for (const row of previous.values()) {
    const parts = row.id ? outsideIdParts(row.id) : null;
    if (!parts) continue;
    const key = prKey(parts.repo, parts.number);
    byPr.set(key, [...(byPr.get(key) ?? []), row]);
  }
  return byPr;
}

/**
 * Where this pass lists merged PRs from: a day before the previous pass
 * that stored outside rows (every pass rewrites their collection time), or
 * OUTSIDE_SINCE on the first. Older PRs are carried in their stored rows.
 */
export function outsideListingSince(previous: Map<string, Partial<PipelineAttempt>>): string {
  let last: string | null = null;
  for (const row of previous.values()) {
    if (!row.id || attemptSource({ id: row.id }) !== "outside" || !row.collected_at) continue;
    if (!last || Date.parse(row.collected_at) > Date.parse(last)) last = row.collected_at;
  }
  if (!last) return OUTSIDE_SINCE;
  const since = Date.parse(last) - OUTSIDE_RELIST_MS;
  return since > Date.parse(OUTSIDE_SINCE) ? new Date(since).toISOString() : OUTSIDE_SINCE;
}

/**
 * Listed PRs whose files to read: merged into the default branch, not a
 * dispatch's, and with no stored row. A stored PR's modules are its rows,
 * so its files are never read again.
 */
export function outsideFileLookups(
  merged: MergedPr[],
  previous: Map<string, Partial<PipelineAttempt>>,
  manifestPrs: ManifestPr[]
): MergedPr[] {
  const linked = dispatchPrKeys(manifestPrs, previous);
  const stored = storedOutside(previous);
  return merged.filter((pr) => {
    const key = prKey(pr.repo, pr.number);
    return pr.files === undefined && pr.baseRefName === pr.defaultBranch && !linked.has(key) && !stored.has(key);
  });
}

function outsidePr(pr: MergedPr, path: string, jurisdiction: string | null): ManifestPr {
  return {
    repo: pr.repo,
    number: pr.number,
    url: pr.url,
    title: pr.title ?? "",
    body: "",
    isDraft: false,
    state: "MERGED",
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    closedAt: null,
    baseRefName: pr.baseRefName,
    defaultBranch: pr.defaultBranch,
    checks: null,
    reviewDecision: null,
    files: [path],
    mergeCommit: pr.mergeCommit,
    jurisdiction,
    author: pr.author,
  };
}

/** A stored outside row's PR, for a PR merged before this pass's listing window. */
function storedMergedPr(repo: string, number: number, row: Partial<PipelineAttempt>): MergedPr | null {
  const mergedAt = row.pr_merged_at ?? row.finished_at;
  const createdAt = row.pr_created_at ?? row.dispatched_at;
  const url = row.pr_url ?? row.run_url;
  if (!mergedAt || !createdAt || !url) return null;
  const branch = row.pr_base_branch ?? "main";
  return {
    repo,
    number,
    url,
    author: row.dispatched_by ?? null,
    createdAt,
    mergedAt,
    baseRefName: branch,
    defaultBranch: branch,
    mergeCommit: row.pr_merge_commit ?? null,
  };
}

/**
 * Every module file merged into a rulespec-* repo's default branch since
 * OUTSIDE_SINCE outside the pipeline: one per module (rulespecModulePaths)
 * a PR added or changed, when no dispatch row stands for the PR. A side
 * branch's own PR into the default branch is a dispatch's for the modules
 * its manifest PRs carry (known once `via` is read), and outside for the
 * rest. PRs listed this pass bring their files (read now, or the modules
 * their stored rows hold); PRs merged before the listing window come from
 * their stored rows alone.
 */
/**
 * Whether a file is a RuleSpec module by where it sits: in a bucket folder at
 * the repo root (`statutes/...`) or under a jurisdiction folder
 * (`us/policies/...`, `uk-leeds/policies/...`). Compose specs (`programs/`),
 * worklists (`bulk/`), tests and data are YAML too, but not encodings.
 */
export function isModuleBucketPath(path: string): boolean {
  const parts = path.split("/");
  if (MODULE_BUCKETS.has(parts[0])) return true;
  return parts.length > 2 && JURISDICTION_RE.test(parts[0]) && MODULE_BUCKETS.has(parts[1]);
}

export function outsideModules(
  merged: MergedPr[],
  previous: Map<string, Partial<PipelineAttempt>>,
  manifestPrs: ManifestPr[],
  mirror: MirrorRow[] | MirrorIndex
): OutsideModule[] {
  const index = Array.isArray(mirror) ? buildMirrorIndex(mirror) : mirror;
  const linked = dispatchPrKeys(manifestPrs, previous);
  const carried = new Map<string, Set<string>>();
  for (const pr of manifestPrs) {
    if (!pr.via) continue;
    const key = prKey(pr.repo, pr.via.number);
    const paths = carried.get(key) ?? new Set<string>();
    for (const path of rulespecModulePaths(pr.files)) paths.add(path);
    carried.set(key, paths);
  }
  const stored = storedOutside(previous);
  const modules = new Map<string, OutsideModule>();
  const add = (pr: MergedPr, path: string) => {
    if (!isModuleBucketPath(path)) return;
    if (carried.get(prKey(pr.repo, pr.number))?.has(path)) return;
    const id = outsideAttemptId(pr.repo, pr.number, path);
    const { citation, citationFrom } = outsideCitation(pr.repo, path, index, previous.get(id)?.citation);
    const jurisdiction = jurisdictionOf(citation);
    modules.set(id, { pr: outsidePr(pr, path, jurisdiction), path, citation, citationFrom });
  };
  const listed = new Set<string>();
  for (const pr of merged) {
    if (pr.baseRefName !== pr.defaultBranch || Date.parse(pr.mergedAt) < Date.parse(OUTSIDE_SINCE)) continue;
    const key = prKey(pr.repo, pr.number);
    if (linked.has(key)) continue;
    const rows = stored.get(key);
    if (pr.files === undefined && !rows) continue;
    listed.add(key);
    const paths = pr.files !== undefined ? rulespecModulePaths(pr.files) : rows!.map((row) => outsideIdParts(row.id!)!.path);
    for (const path of paths) add(pr, path);
  }
  for (const [key, rows] of stored) {
    if (listed.has(key) || linked.has(key)) continue;
    for (const row of rows) {
      const parts = outsideIdParts(row.id!)!;
      const pr = storedMergedPr(parts.repo, parts.number, row);
      if (pr) add(pr, parts.path);
    }
  }
  return [...modules.values()].sort((a, b) => a.pr.mergedAt!.localeCompare(b.pr.mergedAt!) || a.path.localeCompare(b.path));
}

/** The first validator issue (or apply error) and its rule from a diagnostics bundle. */
export function parseDiagnostics(
  metadata: { failed_steps?: unknown; citation?: unknown } | null,
  issues: { issues?: unknown } | null
): FailureDetail {
  const steps = Array.isArray(metadata?.failed_steps)
    ? metadata.failed_steps.filter((step): step is string => typeof step === "string")
    : [];
  const issueList = Array.isArray(issues?.issues)
    ? issues.issues.filter((issue): issue is string => typeof issue === "string")
    : [];
  const first = issueList[0] ?? null;
  return {
    source: "diagnostics",
    citation: typeof metadata?.citation === "string" ? metadata.citation : null,
    failed_step: steps[0] ?? null,
    error: truncateError(first),
    rule: errorRule(first),
  };
}

function prState(pr: ManifestPr): NonNullable<PipelineAttempt["pr_state"]> {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  return pr.isDraft ? "draft" : "open";
}

function prChecks(state: string | null): NonNullable<PipelineAttempt["pr_checks"]> {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "none";
  }
}

function prReview(decision: string | null): NonNullable<PipelineAttempt["pr_review"]> {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return "none";
  }
}

/** A manifest PR merged into a branch other than its repo's default one. */
function mergedOffDefault(pr: ManifestPr): boolean {
  return pr.state === "MERGED" && !!pr.defaultBranch && pr.baseRefName !== pr.defaultBranch;
}

/** The side branches manifest PRs merged into, once per repo and branch, whose own PRs to read. */
export function sideBranchLookups(
  prs: ManifestPr[]
): Array<{ repo: string; branch: string; base: string }> {
  const lookups = new Map<string, { repo: string; branch: string; base: string }>();
  for (const pr of prs) {
    if (!mergedOffDefault(pr)) continue;
    lookups.set(`${pr.repo}:${pr.baseRefName}`, { repo: pr.repo, branch: pr.baseRefName, base: pr.defaultBranch! });
  }
  return [...lookups.values()];
}

/**
 * Which of a side branch's PRs into the default branch carries a merge into
 * that branch: the first to merge after it, else the newest still open,
 * else the newest closed. One that merged before it carried earlier work.
 */
export function viaPrFor(pr: ManifestPr, branchPrs: BranchPr[]): BranchPr | null {
  if (!mergedOffDefault(pr) || !pr.mergedAt) return null;
  const newest = (list: BranchPr[]) =>
    list.reduce<BranchPr | null>((best, item) => (!best || item.createdAt > best.createdAt ? item : best), null);
  const merged = branchPrs
    .filter((item) => item.state === "MERGED" && item.mergedAt && item.mergedAt >= pr.mergedAt!)
    .sort((a, b) => a.mergedAt!.localeCompare(b.mergedAt!));
  return (
    merged[0] ??
    newest(branchPrs.filter((item) => item.state === "OPEN")) ??
    newest(branchPrs.filter((item) => item.state === "CLOSED"))
  );
}

/**
 * Where and when a PR's change reached the default branch: its own merge
 * into it, or the merge of the side branch's own PR. Null until it has.
 */
export function mainMerge(pr: ManifestPr): { mergedAt: string; mergeCommit: string | null } | null {
  if (pr.state !== "MERGED" || !pr.mergedAt) return null;
  if (!mergedOffDefault(pr)) return { mergedAt: pr.mergedAt, mergeCommit: pr.mergeCommit ?? null };
  const via = pr.via;
  return via?.state === "MERGED" && via.mergedAt ? { mergedAt: via.mergedAt, mergeCommit: via.mergeCommit } : null;
}

function branchPrState(pr: BranchPr): NonNullable<PipelineAttempt["pr_via_state"]> {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  return pr.isDraft ? "draft" : "open";
}

export interface MirrorIndex {
  byPath: Map<string, MirrorRow>;
  /** Latest sync time per repo (the sync rewrites every row it keeps). */
  repoSyncedAt: Map<string, string>;
  /** Latest sync time of any repo: a repo absent from the index was skipped by it. */
  lastSyncedAt: string | null;
  /** The commit each repo's rows were last read from, when recorded. */
  repoCommit: Map<string, string>;
}

/**
 * Index rows by `${repo}:${path}` for both repo layouts: monorepos keep
 * each jurisdiction in a directory (rulespec-us → us-az/...), standalone
 * repos keep buckets at the top level. A PR file path matches one of them.
 */
export function buildMirrorIndex(rows: MirrorRow[]): MirrorIndex {
  const byPath = new Map<string, MirrorRow>();
  const repoSyncedAt = new Map<string, string>();
  let lastSyncedAt: string | null = null;
  const repoCommit = new Map<string, string>();
  const repoCommitAt = new Map<string, string>();
  for (const row of rows) {
    byPath.set(`${row.repo}:${row.file_path}`, row);
    byPath.set(`${row.repo}:${row.jurisdiction}/${row.file_path}`, row);
    const current = repoSyncedAt.get(row.repo);
    if (!current || row.synced_at > current) repoSyncedAt.set(row.repo, row.synced_at);
    if (!lastSyncedAt || row.synced_at > lastSyncedAt) lastSyncedAt = row.synced_at;
    if (row.commit_sha && row.synced_at >= (repoCommitAt.get(row.repo) ?? "")) {
      repoCommit.set(row.repo, row.commit_sha);
      repoCommitAt.set(row.repo, row.synced_at);
    }
  }
  return { byPath, repoSyncedAt, lastSyncedAt, repoCommit };
}

function compileKey(repo: string, citationPath: string): string {
  return `${repo}:${citationPath}`;
}

export function buildCompileIndex(
  sweep: CompileSweep | null
): Map<string, CompileSweepRow> {
  const index = new Map<string, CompileSweepRow>();
  for (const row of sweep?.rows ?? []) {
    index.set(compileKey(row.repo, row.citation_path), row);
  }
  return index;
}

export interface EncoderIndex {
  byCitation: Map<string, EncoderRunRow[]>;
  byRunId: Map<string, EncoderRunRow[]>;
}

export function indexEncoderRows(rows: EncoderRunRow[]): EncoderIndex {
  const byCitation = new Map<string, EncoderRunRow[]>();
  const byRunId = new Map<string, EncoderRunRow[]>();
  const add = (map: Map<string, EncoderRunRow[]>, key: string, row: EncoderRunRow) => {
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  };
  for (const row of rows) {
    if (row.github_run_id) add(byRunId, row.github_run_id, row);
    else if (row.citation) add(byCitation, row.citation, row);
  }
  return { byCitation, byRunId };
}

/** What a run's jobs said, as matchEncoderRuns needs it: this pass's read or the stored one. */
export type RunJobsKnown = Pick<
  Partial<PipelineAttempt>,
  "cancel_stage" | "jobs_checked_at" | "encode_started_at" | "setup_seconds" | "encode_seconds" | "steps_read_at"
>;

/**
 * When a run could have written an encoder record, in epoch ms, or null when
 * its encode step never ran: cancelled at the approval or before its job,
 * an encode job that ran no step, or one that stopped before the encode
 * step. With its steps read, the encode step's own span; else from the
 * encode job's start (or the run's) to the run's end (now while it runs).
 */
export function encodeWindow(
  run: WorkflowRun,
  known: RunJobsKnown | undefined,
  nowMs: number
): { start: number; end: number } | null {
  if (known?.cancel_stage === "approval" || known?.cancel_stage === "before_job") return null;
  if (known?.jobs_checked_at && !known.encode_started_at) return null;
  if (known?.encode_started_at && known.steps_read_at) {
    if (known.encode_seconds == null) return null;
    const start = Date.parse(known.encode_started_at) + (known.setup_seconds ?? 0) * 1000;
    return { start, end: start + known.encode_seconds * 1000 };
  }
  const start = Date.parse(known?.encode_started_at ?? run.run_started_at ?? run.created_at);
  return { start, end: run.status === "completed" ? Date.parse(run.updated_at) : nowMs };
}

export interface EncoderCandidate {
  run: WorkflowRun;
  citation: string;
  known?: RunJobsKnown;
}

/**
 * The encoder's record for each dispatch. A record stamped with a run id
 * belongs to that run. An unstamped record (the encoder records no run id
 * yet) goes to exactly one run of its citation: the run whose encode
 * window holds its timestamp (the latest to start, if two overlap), else
 * the run whose window ended last before it, up to the clock slack. A run
 * whose encode step never ran gets none, and a run with several keeps the
 * latest.
 */
export function matchEncoderRuns(
  candidates: EncoderCandidate[],
  index: EncoderIndex,
  nowMs: number
): Map<string, EncoderRunRow> {
  const matched = new Map<string, EncoderRunRow>();
  const keep = (runId: string, row: EncoderRunRow) => {
    const current = matched.get(runId);
    if (!current || Date.parse(row.timestamp) > Date.parse(current.timestamp)) matched.set(runId, row);
  };
  const windows = new Map<string, Array<{ id: string; start: number; end: number }>>();
  for (const { run, citation, known } of candidates) {
    const id = String(run.id);
    const stamped = index.byRunId.get(id);
    if (stamped) {
      // A run stamps its sources' and dependents' records too: its own is the one of its
      // citation (or of none); another citation's is a module it wrote (see matchDependentHosts).
      for (const row of stamped) if (!row.citation || row.citation === citation) keep(id, row);
      continue;
    }
    const window = encodeWindow(run, known, nowMs);
    if (!window) continue;
    const list = windows.get(citation) ?? [];
    list.push({ id, ...window });
    windows.set(citation, list);
  }
  for (const [citation, list] of windows) {
    for (const row of index.byCitation.get(citation) ?? []) {
      const at = Date.parse(row.timestamp);
      let best: { id: string; start: number; end: number } | null = null;
      for (const window of list) {
        if (window.start <= at && at <= window.end && (!best || window.start > best.start)) best = window;
      }
      if (!best) {
        for (const window of list) {
          if (window.end < at && at - window.end <= ENCODER_WINDOW_SLACK_MS && (!best || window.end > best.end)) {
            best = window;
          }
        }
      }
      if (best) keep(best.id, row);
    }
  }
  return matched;
}

/** One dispatch's encoder record, by the rules of matchEncoderRuns with no other run competing. */
export function matchEncoderRun(
  run: WorkflowRun,
  citation: string,
  index: EncoderIndex,
  nowMs: number,
  known?: RunJobsKnown
): EncoderRunRow | null {
  return matchEncoderRuns([{ run, citation, known }], index, nowMs).get(String(run.id)) ?? null;
}

/** A module the encoder wrote inside another citation's run, and that run. */
export interface DependentMatch {
  record: EncoderRunRow;
  hostId: string;
  /** How the run was found: its stamp on the record, an encode window holding the
   *  record's time, or one that ended up to the clock slack before it. */
  by: "stamp" | "window" | "slack";
  /** Whether several runs qualified (decided by the encoder version, then by history). */
  ambiguous: boolean;
}

/** The root jurisdiction of a citation, as its rulespec repo is named: "us" for us-az/... */
const rootOf = (citation: string) => citation.split("/")[0].split(":")[0].split("-")[0];

/**
 * The run each leftover encoder record was written in: the records of
 * modules the encoder wrote inside another citation's run (a source lane
 * before the target, a dependent lane after it). The records share no
 * session with their run (each record's session is its own), so a record
 * stamped with a run id goes to that run, and any other to the run whose
 * encode window holds its timestamp (else the one that ended last before
 * it, up to the clock slack) among the runs of the same rulespec repo
 * (root jurisdiction). Where several qualify, the one on the record's
 * encoder version; then the citation that hosted the record's citation
 * most often among the clear matches; then the latest to start. A record of
 * a run's own citation is that run's (a record matchEncoderRuns passed
 * over), never a dependent; a record no run qualifies for is left out.
 */
export function matchDependentHosts(
  candidates: Array<EncoderCandidate & { version?: string | null }>,
  rows: EncoderRunRow[],
  own: Map<string, EncoderRunRow>,
  nowMs: number
): DependentMatch[] {
  const used = new Set([...own.values()].map((row) => row.id));
  const byId = new Map(candidates.map((candidate) => [String(candidate.run.id), candidate]));
  const windows = candidates.flatMap((candidate) => {
    const window = encodeWindow(candidate.run, candidate.known, nowMs);
    return window
      ? [{ id: String(candidate.run.id), citation: candidate.citation, version: candidate.version ?? null, ...window }]
      : [];
  });
  type Window = (typeof windows)[number];
  const matches: DependentMatch[] = [];
  const pending: Array<{ record: EncoderRunRow; options: Window[]; by: "window" | "slack" }> = [];
  for (const record of rows) {
    if (!record.citation || used.has(record.id)) continue;
    const stamped = record.github_run_id ? byId.get(record.github_run_id) : undefined;
    if (stamped) {
      if (stamped.citation !== record.citation) {
        matches.push({ record, hostId: String(stamped.run.id), by: "stamp", ambiguous: false });
      }
      continue;
    }
    const at = Date.parse(record.timestamp);
    const root = rootOf(record.citation);
    const sameRepo = windows.filter((window) => rootOf(window.citation) === root);
    let by: "window" | "slack" = "window";
    let options = sameRepo.filter((window) => window.start <= at && at <= window.end);
    if (!options.length) {
      by = "slack";
      const before = sameRepo.filter((window) => window.end < at && at - window.end <= ENCODER_WINDOW_SLACK_MS);
      const last = Math.max(...before.map((window) => window.end));
      options = before.filter((window) => window.end === last);
    }
    if (!options.length || options.some((window) => window.citation === record.citation)) continue;
    const sameVersion = record.encoder_version ? options.filter((window) => window.version === record.encoder_version) : [];
    if (sameVersion.length) options = sameVersion;
    if (options.length === 1) matches.push({ record, hostId: options[0].id, by, ambiguous: false });
    else pending.push({ record, options, by });
  }
  // What the clear matches say: which citations' runs write which modules.
  const hosted = new Map<string, number>();
  const citationOf = new Map(windows.map((window) => [window.id, window.citation]));
  for (const match of matches) {
    const key = `${match.record.citation}>${citationOf.get(match.hostId) ?? byId.get(match.hostId)?.citation}`;
    hosted.set(key, (hosted.get(key) ?? 0) + 1);
  }
  for (const { record, options, by } of pending) {
    const best = [...options].sort(
      (a, b) =>
        (hosted.get(`${record.citation}>${b.citation}`) ?? 0) - (hosted.get(`${record.citation}>${a.citation}`) ?? 0) ||
        b.start - a.start
    )[0];
    matches.push({ record, hostId: best.id, by, ambiguous: true });
  }
  return matches;
}

/** The module's repo path from where the encoder wrote it: `.../generated/<lane>/<model>/statutes/7/2017/a.yaml` → `statutes/7/2017/a.yaml`. */
export function encoderModulePath(filePath: string | null | undefined): string | null {
  return filePath?.match(/\/generated\/[^/]+\/[^/]+\/(.+\.ya?ml)$/)?.[1] ?? null;
}

function encoderFailed(row: EncoderRunRow): boolean {
  return row.status !== null && !["applied", "apply_applied"].includes(row.status);
}

function encoderError(row: EncoderRunRow): string | null {
  return truncateError(row.apply_error ?? (encoderFailed(row) ? row.note : null));
}

/** One jurisdiction's latest decisive validation on a repo's default branch. */
export interface ShardResult {
  conclusion: "success" | "failure";
  headSha: string;
  runUrl: string;
  completedAt: string;
  /** When the head commit was made (its committer date), and whether it sits on the
   *  branch's own line (first parents from its tip) rather than on a merged branch. */
  headAt?: string | null;
  headFirstParent?: boolean;
}

/** Per repo: shard results keyed by jurisdiction ("" for an unsharded validate job). */
export type ValidationIndex = Map<string, Map<string, ShardResult>>;

export function containsKey(repo: string, ancestor: string, descendant: string): string {
  return `${repo}:${ancestor}..${descendant}`;
}

/** Clock slack around a merge for the time rule of containedByTime. */
const CONTAIN_MARGIN_MS = 10 * 60 * 1000;

/**
 * Whether a shard's head holds a merge into the default branch, by time
 * alone: a head made before the merge cannot, and a head on the branch's own
 * line made well after it does (that line only moves forward, and a merge
 * lands on it). Undefined near the merge, for a head on a merged branch, or
 * without the head's time: the compare API decides.
 */
export function containedByTime(mergedAt: string, shard: Pick<ShardResult, "headAt" | "headFirstParent">): boolean | undefined {
  if (!shard.headAt) return undefined;
  const gap = Date.parse(shard.headAt) - Date.parse(mergedAt);
  if (gap < 0) return false;
  if (gap > CONTAIN_MARGIN_MS && shard.headFirstParent) return true;
  return undefined;
}

/**
 * The (repo, merge commit, later commit) pairs whose ancestry decides sync
 * and tests, when nothing cheaper does: the index commit only for a merge
 * with a row not synced yet (a stored first sync is kept), and a shard's
 * head only for a merge whose modules the index holds (only those reach
 * their tests) and that the time rule leaves open.
 */
export function containmentQueries(
  prs: ManifestPr[],
  mirror: MirrorRow[],
  validation: ValidationIndex,
  oracle: Map<string, OracleVerdict> = new Map(),
  previous: Map<string, Partial<PipelineAttempt>> = new Map()
): Array<{ repo: string; ancestor: string; descendant: string }> {
  const index = buildMirrorIndex(mirror);
  // PRs every stored row of which has its first sync: the index commit no longer matters for them.
  const unsynced = new Set<string>();
  const stored = new Set<string>();
  for (const row of previous.values()) {
    if (!row.pr_repo || row.pr_number == null) continue;
    const key = prKey(row.pr_repo, Number(row.pr_number));
    stored.add(key);
    if (!row.synced_at) unsynced.add(key);
  }
  const queries = new Map<string, { repo: string; ancestor: string; descendant: string }>();
  const add = (repo: string, ancestor: string, descendant: string) =>
    queries.set(containsKey(repo, ancestor, descendant), { repo, ancestor, descendant });
  for (const pr of prs) {
    const main = mainMerge(pr);
    const mergeCommit = main?.mergeCommit;
    if (!main || !mergeCommit) continue;
    const modules = rulespecModulePaths(pr.files);
    const indexed = modules.every((path) => index.byPath.has(`${pr.repo}:${path}`));
    const key = prKey(pr.repo, pr.number);
    const synced = stored.has(key) && !unsynced.has(key);
    const indexCommit = index.repoCommit.get(pr.repo);
    if (indexCommit && !synced) add(pr.repo, mergeCommit, indexCommit);
    const citation = prCitation(pr.title);
    const jurisdiction = pr.jurisdiction !== undefined ? pr.jurisdiction : citation ? jurisdictionOf(citation) : null;
    const shard = shardFor(validation, pr.repo, jurisdiction);
    if (shard && indexed && containedByTime(main.mergedAt, shard) === undefined) add(pr.repo, mergeCommit, shard.headSha);
    const verdict = moduleVerdict(oracle, pr.repo, modules);
    if (verdict?.rulespecSha) add(pr.repo, mergeCommit, verdict.rulespecSha);
  }
  return [...queries.values()];
}

function shardFor(
  validation: ValidationIndex,
  repo: string,
  jurisdiction: string | null
): ShardResult | null {
  const shards = validation.get(repo);
  if (!shards) return null;
  const own = jurisdiction ? shards.get(jurisdiction) : undefined;
  if (own) return own;
  // An unsharded repo has one "validate" job; a sharded repo's aggregate job
  // fails for any shard, so it never stands in for a missing one.
  const sharded = [...shards.keys()].some((key) => key !== "");
  return sharded ? null : shards.get("") ?? null;
}

/** A merge commit's shard run for the jurisdiction, by the same rule as shardFor. */
function shardAtMerge(shards: Map<string, ShardRun>, jurisdiction: string | null): ShardRun | null {
  const own = jurisdiction ? shards.get(jurisdiction) : undefined;
  if (own) return own;
  const sharded = [...shards.keys()].some((key) => key !== "");
  return sharded ? null : (shards.get("") ?? null);
}

/**
 * Modules whose validation is waived: the `validate_failures` entries of a
 * repo's known-validation-gaps.yaml that carry an `active` waiver. CI skips
 * their validate, companion tests, and proofs, so a green shard says
 * nothing about them.
 */
export function activeWaivers(doc: unknown): Set<string> {
  const failures = (doc as { validate_failures?: Record<string, unknown> } | null)
    ?.validate_failures;
  const waived = new Set<string>();
  if (!failures || typeof failures !== "object") return waived;
  for (const [path, entry] of Object.entries(failures)) {
    if (entry && typeof entry === "object" && (entry as { active?: unknown }).active) {
      waived.add(path);
    }
  }
  return waived;
}

/** One module's verdict from the axiom-oracles comparison reports. */
export interface OracleVerdict {
  /** match: every compared output agrees. explained: mismatches, all
   *  dispositioned as engine, bridge, or residual differences. disagree:
   *  an unexplained mismatch or one blamed on the encoding. */
  status: "match" | "explained" | "disagree";
  /** The report file that decided it, e.g. axiom-policyengine-az-snap-ecps.json. */
  report: string;
  engine: string;
  /** The rulespec commit the report compared. */
  rulespecSha: string | null;
  generatedAt: string | null;
  /** A re-emission: the leg could not run the comparison and re-stamped an
   *  earlier report, so its date and commit say nothing about this version. */
  reemitted: boolean;
}

interface OracleReport {
  aggregates?: Array<{ concept?: string; mismatch_count?: number }>;
  summary?: {
    mismatches_by_concept?: Array<{ value?: string; count?: number }>;
    dispositioned?: { counts?: Record<string, number> } | null;
  };
  provenance?: {
    generated_at?: string;
    rulespecs?: Array<{ repo?: string; sha?: string }>;
    reemitted_report?: boolean;
  };
}

const ORACLE_RANK: Record<OracleVerdict["status"], number> = {
  match: 0,
  explained: 1,
  disagree: 2,
};

/**
 * `us-az:policies/des/faa5/x#output` → the module's index keys in its
 * repo, for both repo layouts (see buildMirrorIndex).
 */
export function conceptModuleKeys(concept: string): string[] {
  const match = concept.match(/^([a-z]{2}(?:-[a-z0-9-]+)*):([^#]+?)(?:#.*)?$/);
  if (!match) return [];
  const [, jurisdiction, path] = match;
  const repo = `rulespec-${jurisdiction.split("-")[0]}`;
  return [`${repo}:${jurisdiction}/${path}.yaml`, `${repo}:${path}.yaml`];
}

/** A real run beats a re-emission; between equals, the worse verdict wins. */
function outranks(verdict: OracleVerdict, current: OracleVerdict | undefined): boolean {
  if (!current) return true;
  if (verdict.reemitted !== current.reemitted) return !verdict.reemitted;
  return ORACLE_RANK[verdict.status] > ORACLE_RANK[current.status];
}

/** Per module index key, the worst verdict across every report that compares it. */
export function oracleVerdicts(
  reports: Array<{ name: string; report: OracleReport }>
): Map<string, OracleVerdict> {
  const verdicts = new Map<string, OracleVerdict>();
  for (const { name, report } of reports) {
    const engine = name.match(/^axiom-([a-z]+)-/)?.[1] ?? "oracle";
    const counts = report.summary?.dispositioned?.counts ?? null;
    const blamed = counts
      ? (counts.unexplained ?? 0) + (counts.axiom_encoding_gap ?? 0)
      : null;
    const mismatches = new Map<string, number>();
    for (const entry of report.summary?.mismatches_by_concept ?? []) {
      if (entry.value) mismatches.set(entry.value, entry.count ?? 0);
    }
    const concepts = new Map<string, number>();
    for (const aggregate of report.aggregates ?? []) {
      if (aggregate.concept) {
        concepts.set(
          aggregate.concept,
          mismatches.get(aggregate.concept) ?? aggregate.mismatch_count ?? 0
        );
      }
    }
    for (const [concept, count] of mismatches) {
      if (!concepts.has(concept)) concepts.set(concept, count);
    }
    for (const [concept, count] of concepts) {
      const status: OracleVerdict["status"] =
        count === 0 ? "match" : blamed === 0 ? "explained" : "disagree";
      const verdict: OracleVerdict = {
        status,
        report: name,
        engine,
        rulespecSha: report.provenance?.rulespecs?.[0]?.sha ?? null,
        generatedAt: report.provenance?.generated_at ?? null,
        reemitted: report.provenance?.reemitted_report === true,
      };
      for (const key of conceptModuleKeys(concept)) {
        if (outranks(verdict, verdicts.get(key))) verdicts.set(key, verdict);
      }
    }
  }
  return verdicts;
}

function moduleVerdict(
  oracle: Map<string, OracleVerdict>,
  repo: string,
  modules: string[]
): OracleVerdict | null {
  let worst: OracleVerdict | null = null;
  for (const path of modules) {
    const verdict = oracle.get(`${repo}:${path}`);
    if (verdict && outranks(verdict, worst ?? undefined)) worst = verdict;
  }
  return worst;
}

/** What a run's jobs say: when encoding started, how far a cancelled run got. */
export interface RunDetail {
  encodeStartedAt: string | null;
  cancelStage: PipelineAttempt["cancel_stage"];
  /** The encode job's parts in seconds (see jobPhases); null for a part that did not run. */
  phases: JobPhases;
}

export interface JobPhases {
  setup: number | null;
  encode: number | null;
  publish: number | null;
}

interface RunStep {
  name?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

interface RunJob {
  name: string;
  steps?: RunStep[] | null;
}

/** The step that generates, validates, repairs, and reviews: the encode loop. */
const ENCODE_STEP_RE = /^Encode, review, validate, and apply$/i;
/** Steps outside the three parts: bookkeeping, failure bundles, and cleanup. */
const UNTIMED_STEP_RE = /^(?:Post |Complete job$|Summarize model spend$|(?:Package|Upload) failed re-encode diagnostics$)/i;

const seconds = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));

/**
 * Split the encode job at its encode step. Setup runs from the first step
 * to the encode step (or, when the job stopped before it, to the last step
 * that ran); the encode part is that step; publishing runs from its end to
 * the last packaging, signing, or PR step after it. Failure bundles and
 * cleanup steps count toward none of them.
 */
export function jobPhases(steps: RunStep[]): JobPhases {
  const ran = steps.filter(
    (step): step is RunStep & { started_at: string; completed_at: string } =>
      !!step.conclusion &&
      step.conclusion !== "skipped" &&
      !!step.started_at &&
      !!step.completed_at &&
      !UNTIMED_STEP_RE.test(step.name ?? "")
  );
  if (ran.length === 0) return { setup: null, encode: null, publish: null };
  const at = ran.findIndex((step) => ENCODE_STEP_RE.test(step.name ?? ""));
  const first = ran[0].started_at;
  if (at < 0) return { setup: seconds(first, ran[ran.length - 1].completed_at), encode: null, publish: null };
  const encode = ran[at];
  const after = ran.slice(at + 1);
  return {
    setup: seconds(first, encode.started_at),
    encode: seconds(encode.started_at, encode.completed_at),
    publish: after.length ? seconds(encode.completed_at, after[after.length - 1].completed_at) : null,
  };
}

/**
 * Read a targeted re-encode run's jobs. The encode job waits for the
 * production-signing approval before any step runs, so its first step's
 * start is when encoding began; a cancelled run with no encode job, or one
 * whose encode job ran no step, was cancelled before it or while waiting
 * for approval.
 */
export function parseRunJobs(jobs: RunJob[], conclusion: string | null): RunDetail {
  const encode =
    jobs.find((job) => /re-encode/i.test(job.name)) ??
    jobs.find((job) => !/budget/i.test(job.name)) ??
    null;
  const ran = (encode?.steps ?? []).filter(
    (step) => step.conclusion && step.conclusion !== "skipped"
  );
  const starts = ran
    .map((step) => step.started_at)
    .filter((value): value is string => !!value)
    .sort();
  let cancelStage: RunDetail["cancelStage"] = null;
  if (conclusion === "cancelled") {
    cancelStage = !encode ? "before_job" : ran.length === 0 ? "approval" : "running";
  }
  return { encodeStartedAt: starts[0] ?? null, cancelStage, phases: jobPhases(encode?.steps ?? []) };
}

/** The attempt fields a run's jobs, read at `readAt`, fill in. */
export function runDetailFields(detail: RunDetail, readAt: string): Partial<PipelineAttempt> {
  return {
    encode_started_at: detail.encodeStartedAt,
    cancel_stage: detail.cancelStage,
    jobs_checked_at: readAt,
    setup_seconds: detail.phases.setup,
    encode_seconds: detail.phases.encode,
    publish_seconds: detail.phases.publish,
    steps_read_at: readAt,
  };
}

/**
 * Finished runs whose jobs have not been read, cancelled ones first (their
 * story is in the jobs), then newest first. With `steps`, runs read before
 * step times were recorded are read once more, after every unread run. A
 * run named after no citation and never stored is left out: nothing would
 * keep what its jobs say, so every pass would read it again first.
 */
export function runDetailLookups(
  runs: WorkflowRun[],
  previous: Map<string, Partial<PipelineAttempt>>,
  limit: number,
  { steps = false }: { steps?: boolean } = {}
): WorkflowRun[] {
  const unread = (run: WorkflowRun) => !previous.get(String(run.id))?.jobs_checked_at;
  const stepsUnread = (run: WorkflowRun) => steps && !previous.get(String(run.id))?.steps_read_at;
  const storable = (run: WorkflowRun) => !!parseRunTitle(run.display_title) || previous.has(String(run.id));
  return runs
    .filter((run) => run.status === "completed" && storable(run) && (unread(run) || stepsUnread(run)))
    .sort(
      (a, b) =>
        Number(unread(b)) - Number(unread(a)) ||
        Number(b.conclusion === "cancelled") - Number(a.conclusion === "cancelled") ||
        b.created_at.localeCompare(a.created_at)
    )
    .slice(0, limit);
}

/** A successful run of the index sync: it read every repo's default branch when it started. */
export interface SyncRun {
  created_at: string;
  updated_at: string;
}

/** A merge this recent may be indexed by the next sync even if no sync has shown it yet. */
const SYNC_WINDOW_RECENT_MS = 7 * 86_400_000;

/**
 * Where to start listing sync runs: the oldest default-branch merge that is
 * indexed (or recent enough to be indexed soon) but has no first sync
 * recorded, or null when there is none. A merge that never reached the index
 * does not hold the window open.
 */
export function syncWindowStart(
  prs: ManifestPr[],
  previous: Map<string, Partial<PipelineAttempt>>,
  nowMs: number
): string | null {
  const byPr = new Map(
    [...previous.values()]
      .filter((attempt) => attempt.pr_repo && attempt.pr_number != null)
      .map((attempt) => [`${attempt.pr_repo}#${attempt.pr_number}`, attempt])
  );
  let oldest: string | null = null;
  for (const pr of prs) {
    const mergedAt = mainMerge(pr)?.mergedAt;
    if (!mergedAt) continue;
    const known = byPr.get(`${pr.repo}#${pr.number}`);
    if (known?.indexed_at) continue;
    if (!known?.synced_at && nowMs - Date.parse(mergedAt) > SYNC_WINDOW_RECENT_MS) continue;
    if (!oldest || mergedAt < oldest) oldest = mergedAt;
  }
  return oldest;
}

/** When the first successful sync that started after a merge finished, if one is listed. */
export function firstSyncAfter(syncs: SyncRun[], mergedAt: string): string | null {
  let first: SyncRun | null = null;
  for (const sync of syncs) {
    if (sync.created_at < mergedAt) continue;
    if (!first || sync.created_at < first.created_at) first = sync;
  }
  return first?.updated_at ?? null;
}

/** A validate shard's first decisive run at a merge commit. */
export interface ShardRun {
  startedAt: string | null;
  completedAt: string;
  conclusion: "success" | "failure";
  /** The check run's page. */
  url?: string | null;
}

/**
 * Per repo and merge commit, each validate shard's first decisive run there
 * ("" for an unsharded validate job).
 */
export type MergeValidation = Map<string, Map<string, ShardRun>>;

export function mergeValidationKey(repo: string, commit: string): string {
  return `${repo}:${commit}`;
}

/**
 * Default-branch merges whose first validation on main is not recorded yet,
 * newest first: the merge commit's own check runs say when it started and
 * finished, and how. With `detail`, a merge recorded before its start and
 * result were kept is read once more; with `url`, one recorded before the
 * first run's page was kept.
 */
export function mergeValidationLookups(
  prs: ManifestPr[],
  previous: Map<string, Partial<PipelineAttempt>>,
  limit: number,
  { detail = false, url = false }: { detail?: boolean; url?: boolean } = {}
): Array<{ repo: string; commit: string }> {
  const recorded = new Set(
    [...previous.values()]
      .filter(
        (attempt) =>
          attempt.tests_first_at &&
          (!detail || attempt.tests_first_status) &&
          (!url || attempt.tests_first_run_url) &&
          (attempt.pr_via_merge_commit ?? attempt.pr_merge_commit) &&
          attempt.pr_repo
      )
      .map((attempt) =>
        mergeValidationKey(attempt.pr_repo!, (attempt.pr_via_merge_commit ?? attempt.pr_merge_commit)!)
      )
  );
  const lookups = new Map<string, { repo: string; commit: string; mergedAt: string }>();
  for (const pr of prs) {
    const main = mainMerge(pr);
    if (!main?.mergeCommit) continue;
    const key = mergeValidationKey(pr.repo, main.mergeCommit);
    if (recorded.has(key)) continue;
    lookups.set(key, { repo: pr.repo, commit: main.mergeCommit, mergedAt: main.mergedAt });
  }
  return [...lookups.values()]
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
    .slice(0, limit)
    .map(({ repo, commit }) => ({ repo, commit }));
}

export interface CollectInputs {
  runs: WorkflowRun[];
  prs: ManifestPr[];
  encoderRuns: EncoderRunRow[];
  mirror: MirrorRow[];
  compile: CompileSweep | null;
  failureDetails: Map<string, FailureDetail>;
  previous: Map<string, Partial<PipelineAttempt>>;
  nowMs: number;
  /** Whether a repo's later commit contains a merge commit (see containmentQueries). */
  contains?: Map<string, boolean>;
  validation?: ValidationIndex;
  /** Per repo, modules with an active validation waiver. */
  waivers?: Map<string, Set<string>>;
  /** Oracle verdicts read this pass; absent between refreshes, when each
   *  attempt keeps the verdict its previous collection stored. */
  oracle?: Map<string, OracleVerdict>;
  /** Jobs read this pass, by run id (see runDetailLookups). */
  runDetails?: Map<string, RunDetail>;
  /** Package versions read this pass, by axiom-encode commit (see versionLookups). */
  encoderVersions?: Map<string, string>;
  /** What failing PR jobs printed, read this pass, by job id (see checkErrorLookups). */
  checkErrors?: Map<string, string>;
  /** Successful index syncs since the oldest merge whose first sync is not recorded. */
  syncRuns?: SyncRun[];
  /** Where those syncs were listed from (see syncWindowStart): a merge before it is not covered. */
  syncSince?: string | null;
  /** Validate shards at merge commits, read this pass (see mergeValidationLookups). */
  mergeValidation?: MergeValidation;
  /** Module files merged outside the pipeline (see outsideModules): a row each. */
  outside?: OutsideModule[];
  /** Told how each module encoded inside another citation's run found its run, for the log. */
  onDependents?: (matches: DependentMatch[]) => void;
}

interface JoinContext {
  mirror: MirrorIndex;
  compile: Map<string, CompileSweepRow>;
  compileAt: string | null;
  contains: Map<string, boolean>;
  validation: ValidationIndex;
  waivers: Map<string, Set<string>>;
  oracle: Map<string, OracleVerdict> | null;
  checkErrors: Map<string, string>;
  syncRuns: SyncRun[] | null;
  syncSince: string | null;
  mergeValidation: MergeValidation;
}

/** Link each PR to its dispatch: the run URL in its body, else citation + time. */
export function linkPrsToRuns(
  runs: WorkflowRun[],
  prs: ManifestPr[]
): { byRun: Map<string, ManifestPr>; orphans: ManifestPr[] } {
  const runIds = new Set(runs.map((run) => String(run.id)));
  const runsByCitation = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const parsed = parseRunTitle(run.display_title);
    if (!parsed) continue;
    const list = runsByCitation.get(parsed.citation) ?? [];
    list.push(run);
    runsByCitation.set(parsed.citation, list);
  }

  const byRun = new Map<string, ManifestPr>();
  const orphans: ManifestPr[] = [];
  const claim = (runId: string, pr: ManifestPr) => {
    const existing = byRun.get(runId);
    // One run opens one PR; if two point at it, keep the newer.
    if (!existing || pr.createdAt > existing.createdAt) {
      if (existing) orphans.push(existing);
      byRun.set(runId, pr);
    } else {
      orphans.push(pr);
    }
  };

  for (const pr of prs) {
    const bodyRun = prRunId(pr.body);
    if (bodyRun && runIds.has(bodyRun)) {
      claim(bodyRun, pr);
      continue;
    }
    const citation = prCitation(pr.title);
    const created = Date.parse(pr.createdAt);
    const candidate = (citation ? runsByCitation.get(citation) ?? [] : []).find(
      (run) =>
        Date.parse(run.created_at) <= created &&
        created <= Date.parse(run.updated_at) + 5 * 60 * 1000
    );
    if (candidate) claim(String(candidate.id), pr);
    else orphans.push(pr);
  }
  return { byRun, orphans };
}

/**
 * An open PR's first failing job and what it printed: read once per job, so
 * a new CI run is read again and a closed or passing PR carries none.
 */
function prCheckError(
  pr: ManifestPr,
  state: PipelineAttempt["pr_state"],
  checkErrors: Map<string, string>,
  previous: Partial<PipelineAttempt> | undefined
): Partial<PipelineAttempt> {
  if (pr.failedJobs === undefined) return {};
  const job = state === "draft" || state === "open" ? pr.failedJobs[0] : undefined;
  if (!job) return { pr_check_job_id: null, pr_check_error: null };
  const kept =
    previous?.pr_check_job_id != null && Number(previous.pr_check_job_id) === job.id
      ? (previous.pr_check_error ?? null)
      : null;
  return { pr_check_job_id: job.id, pr_check_error: checkErrors.get(String(job.id)) ?? kept };
}

/** The side branch's own PR on an attempt, or nulls when there is none to record. */
function viaFields(via: BranchPr | null): Partial<PipelineAttempt> {
  const state = via ? branchPrState(via) : null;
  return {
    pr_via_number: via?.number ?? null,
    pr_via_url: via?.url ?? null,
    pr_via_state: state,
    pr_via_merged_at: state === "merged" ? (via?.mergedAt ?? null) : null,
    pr_via_merge_commit: state === "merged" ? (via?.mergeCommit ?? null) : null,
  };
}

function withPr(
  base: PipelineAttempt,
  pr: ManifestPr | undefined,
  context: JoinContext,
  previous: Partial<PipelineAttempt> | undefined
): PipelineAttempt {
  if (!pr) return base;
  const { mirror, compile, compileAt: compileGeneratedAt, contains, validation, waivers, oracle } =
    context;
  const state = prState(pr);
  const modules = rulespecModulePaths(pr.files);
  const targetsDefault = pr.defaultBranch ? pr.baseRefName === pr.defaultBranch : null;
  const attempt: PipelineAttempt = {
    ...base,
    pr_repo: pr.repo,
    pr_number: pr.number,
    pr_url: pr.url,
    pr_state: state,
    pr_base_branch: pr.baseRefName,
    pr_targets_default: targetsDefault,
    pr_created_at: pr.createdAt,
    pr_merged_at: pr.mergedAt,
    pr_closed_at: state === "closed" ? pr.closedAt : null,
    pr_checks: prChecks(pr.checks),
    pr_review: prReview(pr.reviewDecision),
    module_paths: modules,
    ...(pr.failedChecks !== undefined ? { pr_failed_checks: pr.failedChecks } : {}),
    ...(pr.cancelledChecks !== undefined ? { pr_cancelled_checks: pr.cancelledChecks } : {}),
    ...(pr.requestedReviewers !== undefined
      ? { pr_requested_reviewers: pr.requestedReviewers }
      : {}),
    ...(pr.mergeCommit !== undefined ? { pr_merge_commit: pr.mergeCommit } : {}),
    ...prCheckError(pr, state, context.checkErrors, previous),
    ...(pr.via !== undefined ? viaFields(state === "merged" && targetsDefault === false ? pr.via : null) : {}),
  };
  // From here on, the merge into the default branch: the PR's own, or its side branch's.
  const main = mainMerge(pr);
  if (state !== "merged" || !main) return attempt;
  const { mergedAt, mergeCommit } = main;

  // The merge commit's own validation on main: the first tests the merge
  // got there, when they started and finished, and how they ended. A read
  // this pass is the same run as the stored one, and may add its page.
  const atMerge = mergeCommit ? context.mergeValidation.get(mergeValidationKey(pr.repo, mergeCommit)) : undefined;
  const first = atMerge ? shardAtMerge(atMerge, attempt.jurisdiction) : null;
  if (first) {
    attempt.tests_first_at = first.completedAt;
    attempt.tests_first_started_at = first.startedAt;
    attempt.tests_first_status = first.conclusion === "success" ? "pass" : "fail";
    if (first.url !== undefined) attempt.tests_first_run_url = first.url;
  } else if (previous?.tests_first_status) {
    attempt.tests_first_at = previous.tests_first_at ?? null;
    attempt.tests_first_started_at = previous.tests_first_started_at ?? null;
    attempt.tests_first_status = previous.tests_first_status;
    if (previous.tests_first_run_url !== undefined) attempt.tests_first_run_url = previous.tests_first_run_url;
  } else if (previous?.tests_first_at) {
    attempt.tests_first_at = previous.tests_first_at;
  }

  const mirrorRows = modules.map((path) => mirror.byPath.get(`${pr.repo}:${path}`));
  // A repo with no rows at all (e.g. one gated experimental) was still
  // passed over by the latest sync.
  const repoSynced = mirror.repoSyncedAt.get(pr.repo) ?? mirror.lastSyncedAt;
  // The commit the index read decides when both commits are known; else
  // the sync time against the merge time.
  const indexCommit = mirror.repoCommit.get(pr.repo);
  const commitContains =
    mergeCommit && indexCommit
      ? contains.get(containsKey(pr.repo, mergeCommit, indexCommit))
      : undefined;
  const syncedAfterMerge =
    commitContains ?? (repoSynced !== null && repoSynced >= mergedAt);
  if (previous?.synced_at) {
    attempt.synced_at = previous.synced_at;
    attempt.index_status = "indexed";
  } else if (syncedAfterMerge) {
    if (mirrorRows.every(Boolean)) {
      attempt.synced_at = repoSynced;
      attempt.index_status = "indexed";
    } else {
      attempt.index_status = "missing";
    }
  }
  if (!attempt.synced_at || !mirrorRows.every(Boolean)) return attempt;

  // synced_at is the sync the collector first saw the modules in, which can
  // be later than the first sync after the merge; the sync runs say that one.
  // Only from a listing that reaches back to the merge: an older merge's first sync is not in it.
  const listed = context.syncRuns && (!context.syncSince || Date.parse(mergedAt) >= Date.parse(context.syncSince));
  const firstSync = previous?.indexed_at ?? (listed ? firstSyncAfter(context.syncRuns!, mergedAt) : null);
  if (firstSync) attempt.indexed_at = firstSync;

  // Tests: the module's jurisdiction validation on the default branch, at a
  // commit that contains the merge.
  // A waived module is skipped by its shard, so the shard cannot vouch for it.
  const shard = shardFor(validation, pr.repo, attempt.jurisdiction);
  const waived = modules.some((path) => waivers.get(pr.repo)?.has(path));
  if (waived) {
    attempt.tests_status = "waived";
  } else if (
    shard &&
    mergeCommit &&
    (contains.get(containsKey(pr.repo, mergeCommit, shard.headSha)) ?? containedByTime(mergedAt, shard))
  ) {
    attempt.tests_status = shard.conclusion === "success" ? "pass" : "fail";
    attempt.tests_checked_at = shard.completedAt;
    attempt.tests_run_url = shard.runUrl;
  }

  // Oracle: a report counts only if it compared this version: the rulespec
  // commit it recorded contains the merge, or, for a report that records no
  // commit (EUROMOD/UKMOD), it was generated after the merge. A re-emission
  // never counts: it re-stamps an earlier run.
  if (!oracle) {
    if (previous?.oracle_status) {
      attempt.oracle_status = previous.oracle_status;
      attempt.oracle_report = previous.oracle_report ?? null;
      attempt.oracle_engine = previous.oracle_engine ?? null;
      attempt.oracle_checked_at = previous.oracle_checked_at ?? null;
    }
    return compileVerdict(attempt, mirrorRows, compile, compileGeneratedAt);
  }
  const verdict = moduleVerdict(oracle, pr.repo, modules);
  if (verdict) {
    const current =
      !verdict.reemitted &&
      (verdict.rulespecSha
        ? !!mergeCommit &&
          contains.get(containsKey(pr.repo, mergeCommit, verdict.rulespecSha)) === true
        : !!verdict.generatedAt && verdict.generatedAt > mergedAt);
    attempt.oracle_status = current ? verdict.status : "stale";
    attempt.oracle_report = verdict.report;
    attempt.oracle_engine = verdict.engine;
    attempt.oracle_checked_at = verdict.generatedAt;
  }

  return compileVerdict(attempt, mirrorRows, compile, compileGeneratedAt);
}

/** The compile sweep's verdict on the module versions now in the index. */
function compileVerdict(
  attempt: PipelineAttempt,
  mirrorRows: Array<MirrorRow | undefined>,
  compile: Map<string, CompileSweepRow>,
  compileGeneratedAt: string | null
): PipelineAttempt {
  // A merge that changed no module (manifests or tests only) has nothing to run.
  if (mirrorRows.length === 0) {
    attempt.compile_status = "skipped";
    return attempt;
  }

  // Only a sweep result for the module version now in the index counts.
  let status: string | null = "ok";
  let error: string | null = null;
  let allSkipped = true;
  for (const row of mirrorRows as MirrorRow[]) {
    const result = compile.get(compileKey(row.repo, row.citation_path));
    if (!result || result.raw_yaml_sha256 !== row.raw_yaml_sha256) {
      if (status === "ok") status = null;
      allSkipped = false;
      continue;
    }
    if (result.status === "skipped") continue;
    allSkipped = false;
    if (result.status !== "ok") {
      status = result.status;
      error = truncateError(result.error);
      break;
    }
  }
  if (allSkipped) status = "skipped";
  attempt.compile_status = status;
  attempt.compile_error = error;
  attempt.compile_checked_at = status ? compileGeneratedAt : null;
  return attempt;
}

function emptyAttempt(nowIso: string): Omit<PipelineAttempt, "id" | "citation" | "run_url" | "dispatched_at" | "run_status"> {
  return {
    jurisdiction: null,
    queue_ref: null,
    run_attempt: null,
    started_at: null,
    finished_at: null,
    run_conclusion: null,
    failed_step: null,
    failure_source: null,
    encoder_run_id: null,
    encoder_status: null,
    encoder_error: null,
    encoder_error_rule: null,
    generation_attempts: null,
    cost_usd: null,
    pr_repo: null,
    pr_number: null,
    pr_url: null,
    pr_state: null,
    pr_base_branch: null,
    pr_targets_default: null,
    pr_created_at: null,
    pr_merged_at: null,
    pr_closed_at: null,
    pr_checks: null,
    pr_review: null,
    module_paths: [],
    synced_at: null,
    index_status: null,
    compile_status: null,
    compile_checked_at: null,
    compile_error: null,
    collected_at: nowIso,
  };
}

function isFailedRun(run: WorkflowRun): boolean {
  return (
    run.status === "completed" &&
    run.conclusion !== null &&
    !["success", "skipped", "neutral"].includes(run.conclusion)
  );
}

export function buildAttempts(inputs: CollectInputs): PipelineAttempt[] {
  const nowIso = new Date(inputs.nowMs).toISOString();
  const mirror = buildMirrorIndex(inputs.mirror);
  const compile = buildCompileIndex(inputs.compile);
  const compileAt = inputs.compile?.generated_at ?? null;
  const context: JoinContext = {
    mirror,
    compile,
    compileAt,
    contains: inputs.contains ?? new Map(),
    validation: inputs.validation ?? new Map(),
    waivers: inputs.waivers ?? new Map(),
    oracle: inputs.oracle ?? null,
    checkErrors: inputs.checkErrors ?? new Map(),
    syncRuns: inputs.syncRuns ?? null,
    syncSince: inputs.syncSince ?? null,
    mergeValidation: inputs.mergeValidation ?? new Map(),
  };
  const versions = knownVersions(inputs.previous);
  for (const [sha, version] of inputs.encoderVersions ?? []) versions.set(sha, version);
  const encoderIndex = indexEncoderRows(inputs.encoderRuns);
  const { byRun, orphans } = linkPrsToRuns(inputs.runs, inputs.prs);

  const runAttempts: Array<{ run: WorkflowRun; attempt: PipelineAttempt }> = [];
  for (const run of inputs.runs) {
    const id = String(run.id);
    const previous = inputs.previous.get(id);
    const parsed = parseRunTitle(run.display_title);
    // Early runs were not named after their citation; their PR, failure
    // bundle, or an earlier collection still says what they encoded.
    const pr = byRun.get(id);
    const citation =
      parsed?.citation ??
      (pr ? prCitation(pr.title) : null) ??
      inputs.failureDetails.get(id)?.citation ??
      previous?.citation ??
      null;
    if (!citation) continue;
    const completed = run.status === "completed";
    const attempt: PipelineAttempt = {
      ...emptyAttempt(nowIso),
      id,
      citation,
      jurisdiction: jurisdictionOf(citation),
      queue_ref: parsed?.queueRef ?? null,
      run_url: run.html_url,
      run_attempt: run.run_attempt ?? null,
      dispatched_at: run.created_at,
      started_at: run.run_started_at ?? null,
      finished_at: completed ? run.updated_at : null,
      run_status: run.status,
      run_conclusion: completed ? run.conclusion : null,
      dispatched_by: run.triggering_actor ?? null,
    };
    const sha = run.head_sha ?? previous?.encoder_sha ?? null;
    if (sha) {
      attempt.encoder_sha = sha;
      attempt.encoder_version = versions.get(sha) ?? null;
    }

    const detail = inputs.runDetails?.get(id);
    if (detail) {
      Object.assign(attempt, runDetailFields(detail, nowIso));
    } else if (previous?.jobs_checked_at) {
      attempt.encode_started_at = previous.encode_started_at ?? null;
      attempt.cancel_stage = previous.cancel_stage ?? null;
      attempt.jobs_checked_at = previous.jobs_checked_at;
      if (previous.steps_read_at) {
        attempt.setup_seconds = previous.setup_seconds ?? null;
        attempt.encode_seconds = previous.encode_seconds ?? null;
        attempt.publish_seconds = previous.publish_seconds ?? null;
        attempt.steps_read_at = previous.steps_read_at;
      }
    }
    runAttempts.push({ run, attempt });
  }

  // Encoder records join across runs, so one record never lands on two.
  const encoders = matchEncoderRuns(
    runAttempts.map(({ run, attempt }) => ({ run, citation: attempt.citation, known: attempt })),
    encoderIndex,
    inputs.nowMs
  );
  const attempts: PipelineAttempt[] = [];
  for (const { run, attempt } of runAttempts) {
    const id = attempt.id;
    const previous = inputs.previous.get(id);
    const encoder = encoders.get(id);
    // Derived from the record each pass, so a run that lost a record loses its tries too.
    attempt.tries = null;
    attempt.encode_loop = null;
    if (encoder) applyEncoderRecord(attempt, encoder);

    if (isFailedRun(run) && !attempt.failure_source) {
      const detail = inputs.failureDetails.get(id);
      if (detail) {
        attempt.failure_source = detail.source;
        attempt.failed_step = detail.failed_step;
        attempt.encoder_error = detail.error;
        attempt.encoder_error_rule = detail.rule;
      } else if (previous?.failure_source && previous.failure_source !== "encoder_run") {
        // An encoder record's cause is joined again each pass, never carried.
        attempt.failure_source = previous.failure_source;
        attempt.failed_step = previous.failed_step ?? null;
        attempt.encoder_error = previous.encoder_error ?? null;
        attempt.encoder_error_rule = previous.encoder_error_rule ?? null;
      }
    }

    attempts.push(withPr(attempt, byRun.get(id), context, previous));
  }

  // PRs whose dispatch is gone from the Actions history still belong on the board.
  for (const pr of orphans) {
    const citation = prCitation(pr.title);
    if (!citation) continue;
    const id = `pr:${pr.repo}#${pr.number}`;
    const base: PipelineAttempt = {
      ...emptyAttempt(nowIso),
      id,
      citation,
      jurisdiction: jurisdictionOf(citation),
      run_url: pr.url,
      dispatched_at: pr.createdAt,
      finished_at: pr.createdAt,
      run_status: "completed",
      run_conclusion: "success",
    };
    attempts.push(withPr(base, pr, context, inputs.previous.get(id)));
  }

  // Modules the encoder wrote inside another citation's run: a row each, on that run.
  const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const dependents = matchDependentHosts(
    runAttempts.map(({ run, attempt }) => ({
      run,
      citation: attempt.citation,
      known: attempt,
      version: attempt.encoder_version ?? null,
    })),
    inputs.encoderRuns,
    encoders,
    inputs.nowMs
  );
  inputs.onDependents?.(dependents);
  for (const { record, hostId } of dependents) {
    const host = byId.get(hostId);
    if (!host || !record.citation) continue;
    attempts.push(dependentAttempt(record, host, byRun.get(hostId), context, inputs.previous, nowIso));
  }

  // Modules merged outside the pipeline: a row each, through the same joins after the merge.
  for (const module of inputs.outside ?? []) {
    const { pr, path, citation } = module;
    const id = outsideAttemptId(pr.repo, pr.number, path);
    const base: PipelineAttempt = {
      ...emptyAttempt(nowIso),
      id,
      citation,
      jurisdiction: jurisdictionOf(citation),
      queue_ref: "outside",
      run_url: pr.url,
      dispatched_at: pr.createdAt,
      finished_at: pr.mergedAt,
      run_status: "completed",
      run_conclusion: "success",
      dispatched_by: pr.author ?? null,
    };
    attempts.push(withPr(base, pr, context, inputs.previous.get(id)));
  }
  return attempts;
}

/** The fields an encoder record fills on a row: its status, attempts, cost, tries, loop clock, and error. */
function applyEncoderRecord(attempt: PipelineAttempt, encoder: EncoderRunRow): void {
  attempt.encoder_run_id = encoder.id;
  attempt.encoder_status = encoder.status;
  attempt.generation_attempts = encoder.generation_attempt_count;
  attempt.cost_usd = encoder.estimated_cost_usd;
  attempt.tries = encoderTries(encoder);
  attempt.encode_loop = encoderLoop(encoder);
  const error = encoderError(encoder);
  if (error) {
    attempt.encoder_error = error;
    attempt.encoder_error_rule = errorRule(error);
    attempt.failure_source = "encoder_run";
  }
}

/**
 * A module the encoder wrote inside another citation's run, as its own row:
 * its record's outcome (applied is success, anything else a failure), tries,
 * cost and error, on the run's page and clock. When the run's PR carries the
 * module, the row follows that PR through the merge, the index, and the
 * tests for this module alone; otherwise the module never left the run.
 */
function dependentAttempt(
  record: EncoderRunRow,
  host: PipelineAttempt,
  hostPr: ManifestPr | undefined,
  context: JoinContext,
  previous: Map<string, Partial<PipelineAttempt>>,
  nowIso: string
): PipelineAttempt {
  const citation = record.citation!;
  const id = dependentAttemptId(record.id);
  const at = new Date(record.timestamp).toISOString();
  const attempt: PipelineAttempt = {
    ...emptyAttempt(nowIso),
    id,
    citation,
    jurisdiction: jurisdictionOf(citation),
    queue_ref: dependentQueueRef(host.id),
    run_url: host.run_url,
    dispatched_at: at,
    finished_at: at,
    run_status: "completed",
    run_conclusion: record.status === "apply_applied" || record.status === "applied" ? "success" : "failure",
    dispatched_by: host.dispatched_by ?? null,
    encoder_sha: host.encoder_sha ?? null,
    encoder_version: record.encoder_version ?? host.encoder_version ?? null,
  };
  attempt.tries = null;
  attempt.encode_loop = null;
  applyEncoderRecord(attempt, record);
  const path = encoderModulePath(record.file_path);
  const modules = hostPr ? rulespecModulePaths(hostPr.files) : [];
  const inPr = path ? (modules.find((m) => m === `${attempt.jurisdiction}/${path}`) ?? modules.find((m) => m === path)) : undefined;
  return inPr && hostPr ? withPr(attempt, { ...hostPr, files: [inPr] }, context, previous.get(id)) : attempt;
}

/**
 * A failure explained only by the step that stopped it: the bundle had no
 * validator issue and nothing else recorded why. Its job log usually does.
 * So does a log whose cause was read before the signer's and the encoder's
 * bookkeeping lines were skipped: it is read once more.
 */
export function needsLogRead(known: Partial<PipelineAttempt>): boolean {
  if (known.failure_source === "log") return bookkeepingCause(known.encoder_error);
  return (
    (known.failure_source === "diagnostics" || known.failure_source === "jobs") &&
    !known.encoder_error &&
    !known.encoder_error_rule
  );
}

/**
 * A failure its log explains whose step the jobs API was never asked for
 * ("jq: error: …" read from the log, no step): read the step, once.
 */
export function needsStepRead(known: Partial<PipelineAttempt>): boolean {
  return known.failure_source === "log" && !known.failed_step;
}

/**
 * Failed runs whose cause is still unknown, in the order /ops needs them:
 * each citation's latest dispatch first (the view shows only that one),
 * then older dispatches, newest first within each. A cancelled or
 * timed-out run is explained by its conclusion and never looked up; nor is
 * one an encoder record or an earlier lookup explains.
 */
export function failureLookups(
  runs: WorkflowRun[],
  encoderRuns: EncoderRunRow[],
  previous: Map<string, Partial<PipelineAttempt>>,
  nowMs: number,
  limit: number,
  runDetails?: Map<string, RunDetail>
): WorkflowRun[] {
  const encoderIndex = indexEncoderRows(encoderRuns);
  const latestByCitation = new Map<string, WorkflowRun>();
  for (const run of runs) {
    const citation =
      parseRunTitle(run.display_title)?.citation ?? previous.get(String(run.id))?.citation;
    if (!citation) continue;
    const latest = latestByCitation.get(citation);
    if (!latest || run.created_at > latest.created_at) latestByCitation.set(citation, run);
  }
  const latestIds = new Set([...latestByCitation.values()].map((run) => run.id));
  // The same join buildAttempts makes, with the jobs read this pass where there are any.
  const encoders = matchEncoderRuns(
    runs.flatMap((run) => {
      const id = String(run.id);
      const citation = parseRunTitle(run.display_title)?.citation ?? previous.get(id)?.citation;
      if (!citation) return [];
      const detail = runDetails?.get(id);
      return [{ run, citation, known: detail ? runDetailFields(detail, new Date(nowMs).toISOString()) : previous.get(id) }];
    }),
    encoderIndex,
    nowMs
  );
  return runs
    .filter((run) => {
      if (!isFailedRun(run)) return false;
      if (run.conclusion === "cancelled" || run.conclusion === "timed_out") return false;
      const known = previous.get(String(run.id));
      // A cause from an encoder record is joined each pass: it explains the run only while that record still matches.
      if (
        known?.failure_source &&
        known.failure_source !== "encoder_run" &&
        !needsLogRead(known) &&
        !needsStepRead(known)
      ) {
        return false;
      }
      const encoder = encoders.get(String(run.id));
      return !encoder || !encoderError(encoder);
    })
    .sort(
      (a, b) =>
        Number(latestIds.has(b.id)) - Number(latestIds.has(a.id)) ||
        b.created_at.localeCompare(a.created_at)
    )
    .slice(0, limit);
}

/**
 * The oldest merge into a default branch that no sync has picked up yet,
 * once it is older than `graceMs`. The collector dispatches a sync when
 * this is newer than the last sync run it can see.
 */
export function oldestUnsyncedMerge(
  attempts: PipelineAttempt[],
  nowMs: number,
  graceMs = 5 * 60 * 1000
): string | null {
  let oldest: string | null = null;
  for (const attempt of attempts) {
    const mergedAt = mainMergedAt(attempt);
    if (!mergedAt || attempt.synced_at || attempt.index_status === "missing") continue;
    if (nowMs - Date.parse(mergedAt) < graceMs) continue;
    if (!oldest || mergedAt < oldest) oldest = mergedAt;
  }
  return oldest;
}

/** Package versions already stored, by axiom-encode commit. */
function knownVersions(previous: Map<string, Partial<PipelineAttempt>>): Map<string, string> {
  const versions = new Map<string, string>();
  for (const row of previous.values()) {
    if (row.encoder_sha && row.encoder_version) versions.set(row.encoder_sha, row.encoder_version);
  }
  return versions;
}

/** axiom-encode commits whose package version is not stored yet. */
export function versionLookups(
  runs: WorkflowRun[],
  previous: Map<string, Partial<PipelineAttempt>>
): string[] {
  const known = knownVersions(previous);
  return [...new Set(runs.map((run) => run.head_sha).filter((sha): sha is string => !!sha))].filter(
    (sha) => !known.has(sha)
  );
}

/** The package version in a pyproject.toml. */
export function parseVersion(pyproject: string): string | null {
  return /^version\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1] ?? null;
}

/**
 * Failing jobs of open PRs whose log has not been read, newest PR first, one
 * job per PR. A job is read once; a new CI run has a new job id.
 */
export function checkErrorLookups(
  prs: ManifestPr[],
  previous: Map<string, Partial<PipelineAttempt>>,
  limit: number
): Array<{ repo: string; jobId: number }> {
  const read = new Set<number>();
  for (const row of previous.values()) {
    if (row.pr_check_job_id != null && row.pr_check_error != null) read.add(Number(row.pr_check_job_id));
  }
  const lookups: Array<{ repo: string; jobId: number }> = [];
  for (const pr of [...prs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const job = pr.state === "OPEN" ? pr.failedJobs?.[0] : undefined;
    if (!job || read.has(job.id)) continue;
    read.add(job.id);
    lookups.push({ repo: pr.repo, jobId: job.id });
  }
  return lookups.slice(0, limit);
}

const LOG_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Actions' own closing lines, which say a step failed but not why. */
const GENERIC_ERROR_RE =
  /^(Process completed with exit code \d+|The operation was canceled|The job was not acquired|The runner has received a shutdown signal)/i;
const CHECK_ERROR_MAX_CHARS = 400;
/** "pkg.module.SomeError: message", the last line of a Python traceback. */
const EXCEPTION_RE = /^[A-Za-z_][\w.]*(?:Error|Exception|Exit)\b[^:\s]*: \S/;
/** A failing step's own output, up to this many lines, is quoted whole; longer output by its end. */
const PRINTED_LINES = 4;
/** The signer's and the encoder's bookkeeping, printed as a run winds down: never why it failed. */
const BOOKKEEPING_RE = /(?:^|\s)(?:supabase_sync=|axiom-apply-signer event=|repair_manifest=)/;
/**
 * The encoder's result block around its errors: the headers, `key=value`
 * facts (tokens, files, run id, applied paths, outcome), and sync notes.
 */
const RESULT_LINE_RE =
  /^(?:[a-z_]+=\S|tokens in=|compile=|(?:Output root|Axiom Corpus|Corpus release|Axiom rules engine|Policy repo|Runner|Mode): |\S+ \[[\w.:-]+\]$|Synced session |WARNING: run \S+ \(.*\) was NOT synced|repair_candidate_overlay|auto_reanchored_proof_excerpts:)/;
/** An explicit error: the encoder's `error=`, a blocked apply's reason, or a tool's `error: ...`. */
const ERROR_LINE_RE = /^(?:error=(.+)|apply=blocked_[a-z_]+:(.+)|(error: .+))$/;
/** A result block that applied in the end: the errors before it were repaired. */
const APPLIED_RE = /^outcome=\S+ final_success=True\b/;

/** A cause read from a log before its signer and encoder bookkeeping lines were skipped. */
export function bookkeepingCause(error: string | null | undefined): boolean {
  return !!error && BOOKKEEPING_RE.test(error);
}

function clipLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > CHECK_ERROR_MAX_CHARS ? `${flat.slice(0, CHECK_ERROR_MAX_CHARS - 1)}…` : flat;
}

/**
 * Why a check job failed, from its log: its first explicit error annotation,
 * else what the failing step printed before Actions' generic "exit code"
 * line: the last error it named (an exception, the encoder's `error=`, a
 * blocked apply, `error: ...`) that no later applied result repaired, else
 * its last lines less the signer's and the encoder's bookkeeping. Null when
 * the log shows no failure.
 */
export function checkErrorFromLog(log: string): string | null {
  const lines = log.split(/\r?\n/).map((line) => line.replace(LOG_PREFIX_RE, "").replace(ANSI_RE, ""));
  let generic = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = /^##\[error\](.*)$/.exec(lines[i]);
    if (!match) continue;
    const message = match[1].trim();
    if (message && !GENERIC_ERROR_RE.test(message)) return clipLine(message);
    if (generic < 0) generic = i;
  }
  if (generic < 0) return null;
  if (/canceled/i.test(lines[generic])) return "Cancelled before it finished (a timeout or a newer run)";
  // The step's output follows the group that echoes its script and env.
  const printed: string[] = [];
  for (let i = generic - 1; i >= 0 && !/^##\[(?:group|endgroup)\]/.test(lines[i]); i--) {
    if (lines[i].trim()) printed.unshift(lines[i].trim());
  }
  // The last error named wins: a Python traceback ends in its exception, an
  // encoder result in its error or blocked apply; later lines are shutdown noise.
  let cause: string | null = null;
  const output: string[] = [];
  for (const line of printed) {
    const explicit = ERROR_LINE_RE.exec(line);
    if (explicit) {
      cause = (explicit[1] ?? explicit[2] ?? explicit[3]).trim();
      continue;
    }
    if (APPLIED_RE.test(line)) {
      cause = null;
      continue;
    }
    if (BOOKKEEPING_RE.test(line) || RESULT_LINE_RE.test(line)) continue;
    if (EXCEPTION_RE.test(line)) cause = line;
    output.push(line);
  }
  if (cause) return clipLine(cause);
  if (output.length === 0) return clipLine(lines[generic].replace(/^##\[error\]/, ""));
  return clipLine((output.length <= PRINTED_LINES ? output : output.slice(-2)).join(" "));
}
