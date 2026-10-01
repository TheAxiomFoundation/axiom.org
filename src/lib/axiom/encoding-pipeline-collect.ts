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
  /** Login of whoever started (or re-ran) it. */
  triggering_actor?: string | null;
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
  /** Head commit's failed checks, by name, without the aggregate "validate / validate". */
  failedChecks?: string[];
  /** How many head commit checks were cancelled before finishing. */
  cancelledChecks?: number;
  requestedReviewers?: string[];
  mergeCommit?: string | null;
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

/** One jurisdiction's latest decisive validation on a repo's default branch. */
export interface ShardResult {
  conclusion: "success" | "failure";
  headSha: string;
  runUrl: string;
  completedAt: string;
}

/** Per repo: shard results keyed by jurisdiction ("" for an unsharded validate job). */
export type ValidationIndex = Map<string, Map<string, ShardResult>>;

export function containsKey(repo: string, ancestor: string, descendant: string): string {
  return `${repo}:${ancestor}..${descendant}`;
}

/** The (repo, merge commit, later commit) pairs whose ancestry decides sync and tests. */
export function containmentQueries(
  prs: ManifestPr[],
  mirror: MirrorRow[],
  validation: ValidationIndex,
  oracle: Map<string, OracleVerdict> = new Map()
): Array<{ repo: string; ancestor: string; descendant: string }> {
  const index = buildMirrorIndex(mirror);
  const queries = new Map<string, { repo: string; ancestor: string; descendant: string }>();
  const add = (repo: string, ancestor: string, descendant: string) =>
    queries.set(containsKey(repo, ancestor, descendant), { repo, ancestor, descendant });
  for (const pr of prs) {
    if (pr.state !== "MERGED" || !pr.mergeCommit) continue;
    if (pr.defaultBranch && pr.baseRefName !== pr.defaultBranch) continue;
    const indexCommit = index.repoCommit.get(pr.repo);
    if (indexCommit) add(pr.repo, pr.mergeCommit, indexCommit);
    const citation = prCitation(pr.title);
    const shard = shardFor(validation, pr.repo, citation ? jurisdictionOf(citation) : null);
    if (shard) add(pr.repo, pr.mergeCommit, shard.headSha);
    const verdict = moduleVerdict(oracle, pr.repo, rulespecModulePaths(pr.files));
    if (verdict?.rulespecSha) add(pr.repo, pr.mergeCommit, verdict.rulespecSha);
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
}

interface RunJob {
  name: string;
  steps?: Array<{ conclusion?: string | null; started_at?: string | null }> | null;
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
  return { encodeStartedAt: starts[0] ?? null, cancelStage };
}

/**
 * Finished runs whose jobs have not been read, cancelled ones first (their
 * story is in the jobs), then newest first.
 */
export function runDetailLookups(
  runs: WorkflowRun[],
  previous: Map<string, Partial<PipelineAttempt>>,
  limit: number
): WorkflowRun[] {
  return runs
    .filter((run) => run.status === "completed" && !previous.get(String(run.id))?.jobs_checked_at)
    .sort(
      (a, b) =>
        Number(b.conclusion === "cancelled") - Number(a.conclusion === "cancelled") ||
        b.created_at.localeCompare(a.created_at)
    )
    .slice(0, limit);
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
}

interface JoinContext {
  mirror: MirrorIndex;
  compile: Map<string, CompileSweepRow>;
  compileAt: string | null;
  contains: Map<string, boolean>;
  validation: ValidationIndex;
  waivers: Map<string, Set<string>>;
  oracle: Map<string, OracleVerdict> | null;
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
  };
  if (state !== "merged" || targetsDefault === false || !pr.mergedAt) return attempt;
  const mergeCommit = pr.mergeCommit ?? null;

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
    commitContains ?? (repoSynced !== null && repoSynced >= pr.mergedAt);
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
    contains.get(containsKey(pr.repo, mergeCommit, shard.headSha))
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
        : !!verdict.generatedAt && verdict.generatedAt > pr.mergedAt);
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
  };
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
      dispatched_by: run.triggering_actor ?? null,
    };

    const detail = inputs.runDetails?.get(id);
    if (detail) {
      attempt.encode_started_at = detail.encodeStartedAt;
      attempt.cancel_stage = detail.cancelStage;
      attempt.jobs_checked_at = nowIso;
    } else if (previous?.jobs_checked_at) {
      attempt.encode_started_at = previous.encode_started_at ?? null;
      attempt.cancel_stage = previous.cancel_stage ?? null;
      attempt.jobs_checked_at = previous.jobs_checked_at;
    }

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

    attempt = withPr(attempt, pr, context, previous);
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
    attempts.push(withPr(base, pr, context, inputs.previous.get(id)));
  }
  return attempts;
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
  limit: number
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
  return runs
    .filter((run) => {
      if (!isFailedRun(run)) return false;
      if (run.conclusion === "cancelled" || run.conclusion === "timed_out") return false;
      if (previous.get(String(run.id))?.failure_source) return false;
      // An unnamed early run has no citation to match an encoder record by.
      const parsed = parseRunTitle(run.display_title);
      const encoder = parsed
        ? matchEncoderRun(run, parsed.citation, encoderIndex, nowMs)
        : null;
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
    if (attempt.pr_state !== "merged" || attempt.pr_targets_default === false) continue;
    if (attempt.synced_at || attempt.index_status === "missing" || !attempt.pr_merged_at) {
      continue;
    }
    if (nowMs - Date.parse(attempt.pr_merged_at) < graceMs) continue;
    if (!oldest || attempt.pr_merged_at < oldest) oldest = attempt.pr_merged_at;
  }
  return oldest;
}
