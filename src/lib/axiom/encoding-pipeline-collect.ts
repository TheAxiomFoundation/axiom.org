/**
 * Pure assembly of encodings.pipeline_attempts rows from the raw sources
 * scripts/collect-encoding-pipeline.mjs fetches:
 *
 *   - GitHub Actions runs of axiom-encode's targeted-signed-reencode.yml
 *     (one dispatch each, named "... [queue:item:sha] <citation>");
 *   - encodings.encoding_runs, the encoder's own record, joined by citation
 *     inside the run's time window (the rows carry no Actions run id);
 *   - failure details for runs without an encoder record: the run's
 *     targeted-reencode-failure diagnostics bundle, else the jobs API;
 *   - "Add signed encoding manifest for <citation>" PRs across the
 *     rulespec-* repos, linked to their run by the body's run URL;
 *   - encodings.rulespec_files (the index) and the axiom-api compile sweep.
 *
 * Kept free of I/O so every join rule is unit-tested.
 */

import type { PipelineAttempt } from "./encoding-pipeline";

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
}

export interface MirrorRow {
  repo: string;
  jurisdiction: string;
  file_path: string;
  citation_path: string;
  synced_at: string;
  raw_yaml_sha256: string | null;
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
  source: "diagnostics" | "jobs";
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

/** RuleSpec module files a PR adds or changes: YAML, not tests, not .axiom/. */
export function rulespecModulePaths(files: string[]): string[] {
  return files
    .filter(
      (path) =>
        /\.ya?ml$/.test(path) &&
        !/\.test\.ya?ml$/.test(path) &&
        !path.startsWith(".") &&
        !path.includes("/.")
    )
    .sort();
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

export interface MirrorIndex {
  byPath: Map<string, MirrorRow>;
  /** Latest sync time per repo (the sync rewrites every row it keeps). */
  repoSyncedAt: Map<string, string>;
  /** Latest sync time of any repo: a repo absent from the index was skipped by it. */
  lastSyncedAt: string | null;
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
  for (const row of rows) {
    byPath.set(`${row.repo}:${row.file_path}`, row);
    byPath.set(`${row.repo}:${row.jurisdiction}/${row.file_path}`, row);
    const current = repoSyncedAt.get(row.repo);
    if (!current || row.synced_at > current) repoSyncedAt.set(row.repo, row.synced_at);
    if (!lastSyncedAt || row.synced_at > lastSyncedAt) lastSyncedAt = row.synced_at;
  }
  return { byPath, repoSyncedAt, lastSyncedAt };
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

function latest(rows: EncoderRunRow[]): EncoderRunRow | null {
  let best: EncoderRunRow | null = null;
  for (const row of rows) {
    if (!best || Date.parse(row.timestamp) > Date.parse(best.timestamp)) best = row;
  }
  return best;
}

/**
 * The encoder's record for this dispatch: the one stamped with its run id
 * when the encoder recorded it, else the latest unstamped record for the
 * citation inside the run's time window.
 */
export function matchEncoderRun(
  run: WorkflowRun,
  citation: string,
  index: EncoderIndex,
  nowMs: number
): EncoderRunRow | null {
  const stamped = index.byRunId.get(String(run.id));
  if (stamped) return latest(stamped);
  const start = Date.parse(run.run_started_at ?? run.created_at) - ENCODER_WINDOW_SLACK_MS;
  const end =
    (run.status === "completed" ? Date.parse(run.updated_at) : nowMs) +
    ENCODER_WINDOW_SLACK_MS;
  return latest(
    (index.byCitation.get(citation) ?? []).filter((row) => {
      const at = Date.parse(row.timestamp);
      return at >= start && at <= end;
    })
  );
}

function encoderFailed(row: EncoderRunRow): boolean {
  return row.status !== null && !["applied", "apply_applied"].includes(row.status);
}

function encoderError(row: EncoderRunRow): string | null {
  return truncateError(row.apply_error ?? (encoderFailed(row) ? row.note : null));
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

function withPr(
  base: PipelineAttempt,
  pr: ManifestPr | undefined,
  mirror: MirrorIndex,
  compile: Map<string, CompileSweepRow>,
  compileGeneratedAt: string | null,
  previous: Partial<PipelineAttempt> | undefined
): PipelineAttempt {
  if (!pr) return base;
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
  };
  if (state !== "merged" || targetsDefault === false || !pr.mergedAt) return attempt;

  const mirrorRows = modules.map((path) => mirror.byPath.get(`${pr.repo}:${path}`));
  // A repo with no rows at all (e.g. one gated experimental) was still
  // passed over by the latest sync.
  const repoSynced = mirror.repoSyncedAt.get(pr.repo) ?? mirror.lastSyncedAt;
  const syncedAfterMerge = repoSynced !== null && repoSynced >= pr.mergedAt;
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
  if (!attempt.synced_at || mirrorRows.length === 0 || !mirrorRows.every(Boolean)) {
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
  const encoderIndex = indexEncoderRows(inputs.encoderRuns);
  const { byRun, orphans } = linkPrsToRuns(inputs.runs, inputs.prs);

  const attempts: PipelineAttempt[] = [];
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
    let attempt: PipelineAttempt = {
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
    };

    const encoder = matchEncoderRun(run, citation, encoderIndex, inputs.nowMs);
    if (encoder) {
      attempt.encoder_run_id = encoder.id;
      attempt.encoder_status = encoder.status;
      attempt.generation_attempts = encoder.generation_attempt_count;
      attempt.cost_usd = encoder.estimated_cost_usd;
      const error = encoderError(encoder);
      if (error) {
        attempt.encoder_error = error;
        attempt.encoder_error_rule = errorRule(error);
        attempt.failure_source = "encoder_run";
      }
    }

    if (isFailedRun(run) && !attempt.failure_source) {
      const detail = inputs.failureDetails.get(id);
      if (detail) {
        attempt.failure_source = detail.source;
        attempt.failed_step = detail.failed_step;
        attempt.encoder_error = detail.error;
        attempt.encoder_error_rule = detail.rule;
      } else if (previous?.failure_source) {
        attempt.failure_source = previous.failure_source;
        attempt.failed_step = previous.failed_step ?? null;
        attempt.encoder_error = previous.encoder_error ?? null;
        attempt.encoder_error_rule = previous.encoder_error_rule ?? null;
      }
    }

    attempt = withPr(attempt, pr, mirror, compile, compileAt, previous);
    attempts.push(attempt);
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
    attempts.push(withPr(base, pr, mirror, compile, compileAt, inputs.previous.get(id)));
  }
  return attempts;
}

/**
 * Failed runs whose cause is still unknown, newest first: no encoder
 * record explains them and no earlier collection stored a detail.
 */
export function failureLookups(
  runs: WorkflowRun[],
  encoderRuns: EncoderRunRow[],
  previous: Map<string, Partial<PipelineAttempt>>,
  nowMs: number,
  limit: number
): WorkflowRun[] {
  const encoderIndex = indexEncoderRows(encoderRuns);
  return runs
    .filter((run) => {
      if (!isFailedRun(run)) return false;
      if (previous.get(String(run.id))?.failure_source) return false;
      // An unnamed early run has no citation to match an encoder record by.
      const parsed = parseRunTitle(run.display_title);
      const encoder = parsed
        ? matchEncoderRun(run, parsed.citation, encoderIndex, nowMs)
        : null;
      return !encoder || !encoderError(encoder);
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
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
    if (attempt.pr_state !== "merged" || attempt.pr_targets_default === false) continue;
    if (attempt.synced_at || attempt.index_status === "missing" || !attempt.pr_merged_at) {
      continue;
    }
    if (nowMs - Date.parse(attempt.pr_merged_at) < graceMs) continue;
    if (!oldest || attempt.pr_merged_at < oldest) oldest = attempt.pr_merged_at;
  }
  return oldest;
}
