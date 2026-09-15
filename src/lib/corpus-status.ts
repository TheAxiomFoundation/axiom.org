import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { corpusLookupPathsForCitation } from "@/lib/axiom/ops-citations";

const STATUS_REVALIDATE_SECONDS = 300;

export const STATE_STATUTE_COMPLETION_KEY =
  "analytics/state-statute-completion-current.json";
export const REGULATION_COMPLETION_KEY =
  "analytics/regulation-completion-current.json";
export const SOURCE_DISCOVERY_KEY =
  "analytics/source-discovery-current.json";
export const ARTIFACT_REPORT_KEY = "analytics/artifact-report-current-r2.json";
export const VALIDATION_REPORT_KEY = "analytics/validate-release-current.json";
const CORPUS_STATS_KEY = "supabase://corpus.get_corpus_stats";
const ENCODING_STATUS_KEY = "supabase://encodings.encoding_runs";
const RULESPEC_REPO_ACTIVITY_KEY = "github://TheAxiomFoundation/rulespec-repos";
const COMPILED_ARTIFACTS_KEY = "github://TheAxiomFoundation/compiled-artifacts";
const ENCODING_LOOKBACK_DAYS = 7;
/** How far back live_encoding_runs rows stay in the ops payload (by
 *  heartbeat). Generous because the ledger leans on live rows for history
 *  until manifest syncs land in encoding_runs. */
const LIVE_RUN_WINDOW_HOURS = 7 * 24;
const RULESPEC_ACTIVITY_LOOKBACK_DAYS = 30;
const GITHUB_REPOS_PAGE_SIZE = 100;
const GITHUB_REPOS_MAX_PAGES = 10;

export type CorpusArtifactSource =
  | "status-url"
  | "r2"
  | "local"
  | "supabase"
  | "github";

export interface CorpusCompletionRow {
  jurisdiction: string;
  name: string;
  status: string;
  supabase_count: number | null;
  release_provision_count: number | null;
  release_version: string | null;
  best_local_provision_count: number | null;
  best_local_version: string | null;
  local_complete: boolean;
  r2_complete: boolean | null;
  supabase_matches_release: boolean | null;
  next_action: string;
  mismatch_reasons: string[];
  source_access_status?: string | null;
  source_access_note?: string | null;
  validation_error_count: number;
  validation_warning_count: number;
  coverage_complete?: boolean;
  local_scope_count?: number;
  release_scope_present?: boolean;
  validation_codes?: string[];
}

export interface CorpusCompletionReport {
  complete: boolean;
  document_class?: string;
  expected_jurisdiction_count: number;
  productionized_and_validated_count: number;
  unfinished_count: number;
  release: string;
  status_counts: Record<string, number>;
  rows: CorpusCompletionRow[];
  unfinished_jurisdictions: string[];
  validation_report_ok: boolean | null;
  validation_report_path: string | null;
  supabase_counts_path: string | null;
  release_statute_scope_count?: number;
  release_regulation_scope_count?: number;
  validation_report_present?: boolean;
  validation_report_truncated?: boolean;
}

export type StateStatuteCompletionRow = CorpusCompletionRow;
export type RegulationCompletionRow = CorpusCompletionRow;
export type StateStatuteCompletionReport = CorpusCompletionReport;
export type RegulationCompletionReport = CorpusCompletionReport;

export interface ArtifactScopeRow {
  jurisdiction: string;
  document_class: string;
  version: string;
  provision_count: number | null;
  source_count: number | null;
  local_complete: boolean | null;
  r2_complete: boolean | null;
  coverage_complete: boolean | null;
  supabase_count: number | null;
  supabase_matches_provisions: boolean | null;
  mismatch_reasons: string[];
}

export interface ArtifactReport {
  refreshed_at?: string | null;
  release: string;
  scope_count: number;
  release_scope_count: number;
  local_count: number;
  remote_count: number;
  local_bytes: number;
  remote_bytes: number;
  mismatch_count: number;
  supabase_group_count: number;
  supabase_mismatch_count: number;
  /**
   * "live" rows carry only what Supabase can attest (scope, R2 sync, a live
   * provision count) with no local/coverage comparison; "report" rows come
   * from a full generated artifact report. Absent means "report" for older
   * JSON artifacts.
   */
  counts_mode?: "live" | "report";
  rows: ArtifactScopeRow[];
}

interface CurrentReleaseScopeRow {
  release_name: string;
  jurisdiction: string;
  document_class: string;
  version: string;
  synced_at: string | null;
}

export interface ValidationIssue {
  severity: "error" | "warning" | string;
  code: string;
  jurisdiction: string;
  document_class: string;
  version: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  release: string;
  scope_count: number;
  error_count: number;
  warning_count: number;
  issue_count: number;
  issues_truncated: boolean;
  issues: ValidationIssue[];
}

export interface ProvisionCountRow {
  jurisdiction: string;
  document_class: string;
  provision_count: number;
  body_count: number;
  top_level_count: number;
  rulespec_count: number;
  refreshed_at: string;
}

export interface ProvisionCountsSnapshot {
  refreshed_at: string | null;
  rows: ProvisionCountRow[];
}

export interface CorpusStatsDocumentClass {
  document_class: string;
  count: number;
  body_count: number;
  top_level_count: number;
  rulespec_count: number;
  refreshed_at: string | null;
}

export interface CorpusStats {
  refreshed_at: string | null;
  document_classes: CorpusStatsDocumentClass[];
}

export interface SourceDiscoveryDomainRow {
  host: string;
  url_count: number;
  ready_for_manifest_count: number;
  needs_review_count: number;
  excluded_count: number;
  release_scope_present_count: number;
  source_status_counts: Record<string, number>;
  disposition_counts: Record<string, number>;
  document_class_counts: Record<string, number>;
  jurisdiction_counts: Record<string, number>;
  sample_urls: string[];
}

export interface SourceDiscoveryReport {
  generated_at: string;
  source_name: string;
  input_paths: string[];
  raw_url_count: number;
  invalid_url_count: number;
  unique_url_count: number;
  release: string | null;
  release_scope_count: number;
  ready_for_manifest_count: number;
  needs_review_count: number;
  blocked_or_excluded_count: number;
  release_scope_present_count: number;
  source_status_counts: Record<string, number>;
  disposition_counts: Record<string, number>;
  document_class_counts: Record<string, number>;
  jurisdiction_counts: Record<string, number>;
  domain_rows: SourceDiscoveryDomainRow[];
  corpus_source_policy?: string;
}

export interface EncodingStatusRun {
  id: string;
  timestamp: string;
  citation: string | null;
  total_duration_ms: number | null;
  agent_type: string | null;
  agent_model: string | null;
  data_source: string | null;
  has_issues: boolean | null;
  session_id: string | null;
  encoder_version: string | null;
}

export interface EncodingStatusSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  model: string | null;
  event_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  encoder_version: string | null;
}

/** Machine identity attached by axiom-encode to a live run. */
export interface LiveEncodingRunner {
  hostname?: string;
  username?: string;
  platform?: string;
  pid?: number;
  is_ci?: boolean;
  /** "public_ingest" when the row arrived via the credential-free ingest
   *  route (self-reported); absent for trusted direct writes. */
  reported_via?: string;
}

/**
 * One in-flight (or recently finished) `axiom-encode encode` invocation,
 * heartbeated by the encoder while it runs. A `running` row whose heartbeat
 * has gone stale means the encoder died mid-run.
 */
export interface LiveEncodingRun {
  id: string;
  citation: string;
  status: string;
  started_at: string;
  last_heartbeat_at: string;
  finished_at: string | null;
  phase: string | null;
  attempt: number | null;
  backend: string | null;
  model: string | null;
  encoder_version: string | null;
  run_id: string | null;
  runner: LiveEncodingRunner | null;
}

export interface EncodingOpsStatus {
  refreshed_at: string;
  lookback_days: number;
  run_count: number | null;
  recent_run_count: number | null;
  issue_run_count: number | null;
  active_session_count: number | null;
  /** Timestamp of the oldest recorded run — run telemetry only exists from here on. */
  earliest_run_at: string | null;
  latest_runs: EncodingStatusRun[];
  latest_sessions: EncodingStatusSession[];
  latest_source_counts: Record<string, number>;
  live_runs: LiveEncodingRun[];
  /** Human-readable corpus labels keyed by navigation path
   *  (`us/statute/26` → "INTERNAL REVENUE CODE") for the citations that
   *  appear in latest_runs and live_runs. Best-effort. */
  citation_labels?: Record<string, string>;
  /** Confirmed source-document roots, keyed by the original run citation. */
  citation_document_paths?: Record<string, string>;
}

export interface RulespecRepoLatestCommit {
  sha: string;
  date: string | null;
  author: string | null;
  message: string;
  url: string;
}

export interface RulespecRepoActivity {
  name: string;
  url: string;
  default_branch: string;
  pushed_at: string | null;
  rulespec_count: number;
  document_class_counts: Record<string, number>;
  test_count: number;
  manifest_count: number;
  corpus_provision_file_count: number;
  coverage_file_count: number;
  oracle_file_count: number;
  latest_commit: RulespecRepoLatestCommit | null;
}

export interface RulespecRepoActivityReport {
  refreshed_at: string;
  org: string;
  lookback_days: number;
  repo_count: number;
  active_repo_count: number;
  rulespec_count: number;
  document_class_counts: Record<string, number>;
  test_count: number;
  manifest_count: number;
  corpus_provision_file_count: number;
  rows: RulespecRepoActivity[];
}

export interface CompiledArtifactActivity {
  repo: string;
  repo_url: string;
  default_branch: string;
  path: string;
  url: string;
  package_id: string;
  package_type: "applied-rulespec" | "compiled-runtime";
  pushed_at: string | null;
  has_manifest: boolean;
  has_rulespec_bundle: boolean;
  latest_commit: RulespecRepoLatestCommit | null;
}

export interface CompiledArtifactReport {
  refreshed_at: string;
  org: string;
  repo_count: number;
  artifact_count: number;
  rows: CompiledArtifactActivity[];
}

export interface CorpusStatusArtifact<T> {
  key: string;
  source: CorpusArtifactSource | null;
  value: T | null;
  error: string | null;
}

export interface CorpusStatusData {
  stateStatutes: CorpusStatusArtifact<StateStatuteCompletionReport>;
  regulations: CorpusStatusArtifact<RegulationCompletionReport>;
  artifactReport: CorpusStatusArtifact<ArtifactReport>;
  validationReport: CorpusStatusArtifact<ValidationReport>;
  provisionCounts: CorpusStatusArtifact<ProvisionCountsSnapshot>;
  corpusStats?: CorpusStatusArtifact<CorpusStats>;
  sourceDiscovery: CorpusStatusArtifact<SourceDiscoveryReport>;
  encodingStatus: CorpusStatusArtifact<EncodingOpsStatus>;
  rulespecRepoActivity?: CorpusStatusArtifact<RulespecRepoActivityReport>;
  compiledArtifacts?: CorpusStatusArtifact<CompiledArtifactReport>;
}

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SupabaseRestConfig {
  url: string;
  anonKey: string;
}

interface ReadAttempt<T> {
  source: CorpusArtifactSource;
  value: T;
}

export async function getCorpusStatus(): Promise<CorpusStatusData> {
  const [
    stateStatutes,
    regulations,
    artifactReport,
    validationReport,
    sourceDiscovery,
  ] =
    await Promise.all([
      readCorpusJson<StateStatuteCompletionReport>(STATE_STATUTE_COMPLETION_KEY),
      readCorpusJson<RegulationCompletionReport>(REGULATION_COMPLETION_KEY),
      readArtifactReport(),
      readCorpusJson<ValidationReport>(VALIDATION_REPORT_KEY),
      readCorpusJson<SourceDiscoveryReport>(SOURCE_DISCOVERY_KEY),
    ]);

  const provisionCountsKey =
    cleanEnvValue(process.env.AXIOM_CORPUS_PROVISION_COUNTS_KEY) ??
    provisionCountsKeyFromCompletionReports(regulations.value, stateStatutes.value);

  const [
    provisionCounts,
    corpusStats,
    encodingStatus,
    rulespecRepoActivity,
    compiledArtifacts,
  ] =
    await Promise.all([
      provisionCountsKey
        ? readCorpusJson<ProvisionCountsSnapshot>(provisionCountsKey)
        : Promise.resolve<CorpusStatusArtifact<ProvisionCountsSnapshot>>({
            key: "snapshots/provision-counts",
            source: null,
            value: null,
            error:
              "No provision counts snapshot key could be derived from completion reports (set AXIOM_CORPUS_PROVISION_COUNTS_KEY to override)",
          }),
      readCorpusStats(),
      getEncodingStatus(),
      readRulespecRepoActivity(),
      readCompiledArtifacts(),
    ]);

  return {
    stateStatutes,
    regulations,
    artifactReport,
    validationReport,
    provisionCounts,
    corpusStats,
    sourceDiscovery,
    encodingStatus,
    rulespecRepoActivity,
    compiledArtifacts,
  };
}

export function provisionCountsKeyFromStateReport(
  report: StateStatuteCompletionReport | null
): string | null {
  return provisionCountsKeyFromCompletionReports(report);
}

export function provisionCountsKeyFromCompletionReports(
  ...reports: Array<CorpusCompletionReport | null>
): string | null {
  for (const report of reports) {
    if (report?.supabase_counts_path) {
      return corpusKeyFromPath(report.supabase_counts_path);
    }
  }
  return null;
}

export function corpusKeyFromPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const marker = "data/corpus/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }
  return normalized.replace(/^\/+/, "");
}

async function readCorpusJson<T>(key: string): Promise<CorpusStatusArtifact<T>> {
  const errors: string[] = [];

  const statusBaseUrl = process.env.AXIOM_CORPUS_STATUS_BASE_URL;
  if (statusBaseUrl) {
    try {
      return {
        key,
        ...(await readFromStatusUrl<T>(statusBaseUrl, key)),
        error: null,
      };
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  const r2Config = getR2Config();
  if (r2Config) {
    try {
      return {
        key,
        ...(await readFromR2<T>(r2Config, key)),
        error: null,
      };
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  try {
    return {
      key,
      ...(await readFromLocal<T>(key)),
      error: null,
    };
  } catch (error) {
    errors.push(errorMessage(error));
  }

  return {
    key,
    source: null,
    value: null,
    error: errors.length > 0 ? errors.join(" | ") : "No corpus status source configured",
  };
}

export async function getEncodingStatus(
  options: { fresh?: boolean } = {}
): Promise<CorpusStatusArtifact<EncodingOpsStatus>> {
  try {
    return {
      key: ENCODING_STATUS_KEY,
      source: "supabase",
      value: await readEncodingStatusFromSupabase(options),
      error: null,
    };
  } catch (error) {
    return {
      key: ENCODING_STATUS_KEY,
      source: null,
      value: null,
      error: errorMessage(error),
    };
  }
}

async function readCorpusStats(): Promise<CorpusStatusArtifact<CorpusStats>> {
  try {
    return {
      key: CORPUS_STATS_KEY,
      source: "supabase",
      value: await readCorpusStatsFromSupabase(),
      error: null,
    };
  } catch (error) {
    return {
      key: CORPUS_STATS_KEY,
      source: null,
      value: null,
      error: errorMessage(error),
    };
  }
}

async function readArtifactReport(): Promise<CorpusStatusArtifact<ArtifactReport>> {
  try {
    return {
      key: ARTIFACT_REPORT_KEY,
      source: "supabase",
      value: await readArtifactReportFromSupabase(),
      error: null,
    };
  } catch (error) {
    const supabaseError = errorMessage(error);
    const artifact = await readCorpusJson<ArtifactReport>(ARTIFACT_REPORT_KEY);
    if (artifact.value) return artifact;

    return {
      key: ARTIFACT_REPORT_KEY,
      source: null,
      value: null,
      error: [supabaseError, artifact.error].filter(Boolean).join(" | "),
    };
  }
}

async function readRulespecRepoActivity(): Promise<
  CorpusStatusArtifact<RulespecRepoActivityReport>
> {
  try {
    return {
      key: RULESPEC_REPO_ACTIVITY_KEY,
      source: "github",
      value: await readRulespecRepoActivityFromGitHub(),
      error: null,
    };
  } catch (error) {
    return {
      key: RULESPEC_REPO_ACTIVITY_KEY,
      source: null,
      value: null,
      error: errorMessage(error),
    };
  }
}

interface GitHubRepo {
  name: string;
  html_url: string;
  default_branch: string;
  pushed_at: string | null;
  fork?: boolean;
  archived?: boolean;
}

interface GitHubTreeResponse {
  tree?: Array<{ path?: string; type?: string }>;
}

interface GitHubCommitResponse {
  sha?: string;
  html_url?: string;
  commit?: {
    author?: {
      name?: string;
      date?: string;
    };
    message?: string;
  };
}

interface GitHubConfig {
  org: string;
  token: string;
}

function getGitHubConfig(): GitHubConfig {
  const org = cleanEnvValue(process.env.AXIOM_GITHUB_ORG) ?? "TheAxiomFoundation";
  const token = cleanEnvValue(process.env.AXIOM_GITHUB_TOKEN) ??
    cleanEnvValue(process.env.GITHUB_TOKEN) ??
    cleanEnvValue(process.env.GH_TOKEN);
  if (!token) {
    throw new Error(
      "AXIOM_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN is not configured"
    );
  }
  return { org, token };
}

async function listOrgRepos(org: string, token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= GITHUB_REPOS_MAX_PAGES; page += 1) {
    const batch = await githubJson<GitHubRepo[]>(
      `https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=${GITHUB_REPOS_PAGE_SIZE}&type=all&sort=pushed&page=${page}`,
      token
    );
    repos.push(...batch);
    if (batch.length < GITHUB_REPOS_PAGE_SIZE) break;
  }
  return repos;
}

async function readRulespecRepoActivityFromGitHub(): Promise<RulespecRepoActivityReport> {
  const { org, token } = getGitHubConfig();

  const repos = (await listOrgRepos(org, token))
    .filter((repo) => repo.name.startsWith("rulespec-"))
    .sort((a, b) => stringCompareDesc(a.pushed_at, b.pushed_at));
  const rows = await Promise.all(
    repos.map((repo) => readRulespecRepoActivityRow(org, repo, token))
  );
  const sinceMs =
    Date.now() - RULESPEC_ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  return {
    refreshed_at: new Date().toISOString(),
    org,
    lookback_days: RULESPEC_ACTIVITY_LOOKBACK_DAYS,
    repo_count: rows.length,
    active_repo_count: rows.filter((row) => {
      if (!row.pushed_at) return false;
      return Date.parse(row.pushed_at) >= sinceMs;
    }).length,
    rulespec_count: sumActivity(rows, "rulespec_count"),
    document_class_counts: sumRecordActivity(rows, "document_class_counts"),
    test_count: sumActivity(rows, "test_count"),
    manifest_count: sumActivity(rows, "manifest_count"),
    corpus_provision_file_count: sumActivity(rows, "corpus_provision_file_count"),
    rows,
  };
}

async function readCompiledArtifacts(): Promise<
  CorpusStatusArtifact<CompiledArtifactReport>
> {
  try {
    return {
      key: COMPILED_ARTIFACTS_KEY,
      source: "github",
      value: await readCompiledArtifactsFromGitHub(),
      error: null,
    };
  } catch (error) {
    return {
      key: COMPILED_ARTIFACTS_KEY,
      source: null,
      value: null,
      error: errorMessage(error),
    };
  }
}

async function readCompiledArtifactsFromGitHub(): Promise<CompiledArtifactReport> {
  const { org, token } = getGitHubConfig();
  const configuredRepoNames = cleanEnvValue(
    process.env.AXIOM_COMPILED_ARTIFACT_REPOS
  )?.split(",");
  const repoNames = configuredRepoNames
    ? configuredRepoNames.map((name) => name.trim()).filter(Boolean)
    : await discoverExecutablePackageRepos(org, token);
  const rows = (
    await Promise.all(
      repoNames.map((repoName) =>
        readCompiledArtifactsFromRepo(org, repoName, token)
      )
    )
  ).flat();

  return {
    refreshed_at: new Date().toISOString(),
    org,
    repo_count: repoNames.length,
    artifact_count: rows.length,
    rows: rows.sort((a, b) => stringCompareDesc(a.pushed_at, b.pushed_at)),
  };
}

async function discoverExecutablePackageRepos(
  org: string,
  token: string
): Promise<string[]> {
  const repos = await listOrgRepos(org, token);
  return repos
    .filter((repo) => !repo.fork && !repo.archived)
    .map((repo) => repo.name);
}

async function readCompiledArtifactsFromRepo(
  org: string,
  repoName: string,
  token: string
): Promise<CompiledArtifactActivity[]> {
  const encodedOrg = encodeURIComponent(org);
  const encodedName = encodeURIComponent(repoName);
  const repo = await githubJson<GitHubRepo>(
    `https://api.github.com/repos/${encodedOrg}/${encodedName}`,
    token
  );
  const encodedBranch = encodeURIComponent(repo.default_branch);
  const tree = await githubJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${encodedOrg}/${encodedName}/git/trees/${encodedBranch}?recursive=1`,
    token
  );
  const paths = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path)
    .map((entry) => entry.path as string);
  const pathSet = new Set(paths);
  const packagePaths = paths
    .filter(isExecutablePackagePath)
    .sort();

  return Promise.all(
    packagePaths.map(async (filePath) => {
      const packageType = executablePackageType(filePath);
      const latest =
        packageType === "compiled-runtime"
          ? await readLatestCommitForPath(
              org,
              repoName,
              repo.default_branch,
              filePath,
              token
            )
          : null;
      const basePath =
        packageType === "compiled-runtime"
          ? filePath.slice(0, -".compiled.json".length)
          : filePath.slice(0, -".json".length);
      return {
        repo: repo.name,
        repo_url: repo.html_url,
        default_branch: repo.default_branch,
        path: filePath,
        url: `${repo.html_url}/blob/${repo.default_branch}/${filePath}`,
        package_id: packageIdFromPath(basePath, packageType),
        package_type: packageType,
        pushed_at: latest?.date ?? repo.pushed_at,
        has_manifest:
          packageType === "applied-rulespec" ||
          pathSet.has(`${basePath}.manifest.json`),
        has_rulespec_bundle:
          packageType === "applied-rulespec" ||
          pathSet.has(`${basePath}.rulespec.yaml`),
        latest_commit: latest,
      };
    })
  );
}

function isExecutablePackagePath(filePath: string): boolean {
  return (
    filePath.endsWith(".compiled.json") ||
    (filePath.startsWith(".axiom/encoding-manifests/") &&
      filePath.endsWith(".json"))
  );
}

function executablePackageType(
  filePath: string
): CompiledArtifactActivity["package_type"] {
  return filePath.endsWith(".compiled.json")
    ? "compiled-runtime"
    : "applied-rulespec";
}

function packageIdFromPath(
  basePath: string,
  packageType: CompiledArtifactActivity["package_type"]
): string {
  if (packageType === "compiled-runtime") {
    return basePath.split("/").slice(-2).join("/");
  }
  return basePath.replace(/^\.axiom\/encoding-manifests\//, "");
}

async function readLatestCommitForPath(
  org: string,
  repoName: string,
  branch: string,
  filePath: string,
  token: string
): Promise<RulespecRepoLatestCommit | null> {
  const commits = await githubJson<GitHubCommitResponse[]>(
    `https://api.github.com/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/commits?per_page=1&sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(filePath)}`,
    token
  );
  const latest = commits[0] ?? null;
  if (!latest) return null;
  return {
    sha: stringOrFallback(latest.sha, "").slice(0, 7),
    date: stringOrNull(latest.commit?.author?.date),
    author: stringOrNull(latest.commit?.author?.name),
    message: stringOrFallback(latest.commit?.message, "")
      .split("\n")[0]
      .trim(),
    url: stringOrFallback(latest.html_url, ""),
  };
}

async function readRulespecRepoActivityRow(
  org: string,
  repo: GitHubRepo,
  token: string
): Promise<RulespecRepoActivity> {
  const encodedName = encodeURIComponent(repo.name);
  const encodedBranch = encodeURIComponent(repo.default_branch);
  const [tree, commits] = await Promise.all([
    githubJson<GitHubTreeResponse>(
      `https://api.github.com/repos/${encodeURIComponent(org)}/${encodedName}/git/trees/${encodedBranch}?recursive=1`,
      token
    ),
    githubJson<GitHubCommitResponse[]>(
      `https://api.github.com/repos/${encodeURIComponent(org)}/${encodedName}/commits?per_page=1&sha=${encodedBranch}`,
      token
    ),
  ]);
  const paths = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path)
    .map((entry) => entry.path as string);
  const rulespecPaths = paths.filter(isRulespecYamlPath);
  const latest = commits[0] ?? null;

  return {
    name: repo.name,
    url: repo.html_url,
    default_branch: repo.default_branch,
    pushed_at: repo.pushed_at,
    rulespec_count: rulespecPaths.length,
    document_class_counts: summarizeRulespecDocumentClasses(rulespecPaths),
    test_count: paths.filter((path) => path.endsWith(".test.yaml")).length,
    manifest_count: paths.filter((path) =>
      path.startsWith(".axiom/encoding-manifests/")
    ).length,
    corpus_provision_file_count: paths.filter((path) =>
      path.startsWith("data/corpus/provisions/")
    ).length,
    coverage_file_count: paths.filter((path) =>
      path.startsWith("data/coverage/")
    ).length,
    oracle_file_count: paths.filter((path) =>
      path.startsWith("data/oracles/")
    ).length,
    latest_commit: latest
      ? {
          sha: stringOrFallback(latest.sha, "").slice(0, 7),
          date: stringOrNull(latest.commit?.author?.date),
          author: stringOrNull(latest.commit?.author?.name),
          message: stringOrFallback(latest.commit?.message, "")
            .split("\n")[0]
            .trim(),
          url: stringOrFallback(latest.html_url, repo.html_url),
        }
      : null,
  };
}

async function githubJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    next: { revalidate: STATUS_REVALIDATE_SECONDS },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

function isRulespecYamlPath(filePath: string): boolean {
  return (
    filePath.endsWith(".yaml") &&
    !filePath.endsWith(".test.yaml") &&
    filePath !== "known-validation-gaps.yaml" &&
    !filePath.startsWith(".github/")
  );
}

function summarizeRulespecDocumentClasses(paths: string[]): Record<string, number> {
  return paths.reduce<Record<string, number>>((counts, filePath) => {
    const documentClass = rulespecDocumentClassFromPath(filePath);
    if (documentClass) {
      counts[documentClass] = (counts[documentClass] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function rulespecDocumentClassFromPath(filePath: string): string | null {
  const segments = filePath.split("/");
  const firstSegment = segments[0];
  const classSegment = isJurisdictionPathSegment(firstSegment)
    ? segments[1]
    : firstSegment;
  if (classSegment === "statutes") return "statute";
  if (classSegment === "regulations") return "regulation";
  if (classSegment === "manuals") return "manual";
  if (classSegment === "rulemaking") return "rulemaking";
  if (classSegment === "policies") return "policy";
  if (classSegment === "forms") return "form";
  if (classSegment === "guidance") return "guidance";
  return null;
}

function isJurisdictionPathSegment(value: string | undefined): boolean {
  // Two-letter country code, optionally with a region suffix (us, us-co,
  // uk-scotland, nz). Derived from the path convention rather than an
  // enumerated jurisdiction list so new countries are counted automatically.
  return !!value && /^[a-z]{2}(-[a-z0-9-]+)?$/.test(value);
}

function stringCompareDesc(a: string | null, b: string | null): number {
  return (b ?? "").localeCompare(a ?? "");
}

function sumActivity(
  rows: RulespecRepoActivity[],
  key: keyof Pick<
    RulespecRepoActivity,
    | "rulespec_count"
    | "test_count"
    | "manifest_count"
    | "corpus_provision_file_count"
  >
): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

function sumRecordActivity(
  rows: RulespecRepoActivity[],
  key: keyof Pick<RulespecRepoActivity, "document_class_counts">
): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    for (const [className, count] of Object.entries(row[key])) {
      counts[className] = (counts[className] ?? 0) + count;
    }
    return counts;
  }, {});
}

async function readEncodingStatusFromSupabase(
  options: { fresh?: boolean } = {}
): Promise<EncodingOpsStatus> {
  const config = getSupabaseRestConfig();
  if (!config) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured");
  }

  const fetchOptions: SupabaseFetchOptions = { fresh: options.fresh };
  const since = new Date(
    Date.now() - ENCODING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const liveWindowStart = new Date(
    Date.now() - LIVE_RUN_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();

  const [
    runCount,
    recentRunCount,
    issueRunCount,
    activeSessionCount,
    earliestRuns,
    latestRuns,
    latestSessions,
    liveRuns,
  ] = await Promise.all([
    readSupabaseCount(config, "encodings", "encoding_runs", {}, fetchOptions),
    readSupabaseCount(
      config,
      "encodings",
      "encoding_runs",
      { timestamp: `gte.${since}` },
      fetchOptions
    ),
    readSupabaseCount(
      config,
      "encodings",
      "encoding_runs",
      { has_issues: "eq.true" },
      fetchOptions
    ),
    readSupabaseCount(
      config,
      "telemetry",
      "sdk_sessions",
      { ended_at: "is.null" },
      fetchOptions
    ),
    readSupabaseRows<{ timestamp: string }>(
      config,
      "encodings",
      "encoding_runs",
      {
        select: "timestamp",
        order: "timestamp.asc",
        limit: "1",
      },
      fetchOptions
    ),
    readSupabaseRows<EncodingStatusRun>(
      config,
      "encodings",
      "encoding_runs",
      {
        select:
          "id,timestamp,citation,total_duration_ms,agent_type,agent_model,data_source,has_issues,session_id,encoder_version",
        order: "timestamp.desc",
        limit: "60",
      },
      fetchOptions
    ),
    readSupabaseRows<EncodingStatusSession>(
      config,
      "telemetry",
      "sdk_sessions",
      {
        select:
          "id,started_at,ended_at,model,event_count,input_tokens,output_tokens,estimated_cost_usd,encoder_version",
        order: "started_at.desc",
        limit: "8",
      },
      fetchOptions
    ),
    // Live-run presence is written by newer encoders only; a missing table or
    // read failure must not take down the rest of the encoding status.
    readSupabaseRows<LiveEncodingRun>(
      config,
      "encodings",
      "live_encoding_runs",
      {
        select:
          "id,citation,status,started_at,last_heartbeat_at,finished_at,phase,attempt,backend,model,encoder_version,run_id,runner",
        last_heartbeat_at: `gte.${liveWindowStart}`,
        order: "started_at.desc",
        limit: "200",
      },
      fetchOptions
    ).catch(() => [] as LiveEncodingRun[]),
  ]);

  const citationMetadata = await readCitationMetadata(
    config,
    [
      ...latestRuns.map((run) => run.citation),
      ...liveRuns.map((run) => run.citation),
    ],
    fetchOptions
  );

  const resolvedRunCount =
    runCount == null ? latestRuns.length : Math.max(runCount, latestRuns.length);
  const latestIssueRunCount = latestRuns.filter((run) => run.has_issues).length;
  const resolvedIssueRunCount =
    issueRunCount == null
      ? latestIssueRunCount
      : Math.max(issueRunCount, latestIssueRunCount);

  return {
    refreshed_at: new Date().toISOString(),
    lookback_days: ENCODING_LOOKBACK_DAYS,
    run_count: resolvedRunCount,
    recent_run_count: recentRunCount,
    issue_run_count: resolvedIssueRunCount,
    active_session_count: activeSessionCount,
    earliest_run_at: stringOrNull(earliestRuns[0]?.timestamp),
    latest_runs: latestRuns,
    latest_sessions: latestSessions,
    latest_source_counts: summarizeLatestSources(latestRuns),
    live_runs: liveRuns,
    citation_labels: citationMetadata.labels,
    citation_document_paths: citationMetadata.documentPaths,
  };
}

export interface RecentCorpusScope {
  jurisdiction: string;
  document_class: string;
  version: string;
  synced_at: string | null;
}

const RECENT_SCOPE_LIMIT = 8;

/**
 * The most recently synced scopes of the active corpus release — the ops
 * dashboard's "recently ingested" feed. Scope versions are the ingest
 * batches themselves (e.g. `2026-08-04-dk-full-parity-tier1`). Best-effort:
 * failures return an empty list.
 */
export async function getRecentCorpusScopes(): Promise<RecentCorpusScope[]> {
  const config = getSupabaseRestConfig();
  if (!config) return [];
  try {
    return await readSupabaseRows<RecentCorpusScope>(
      config,
      "corpus",
      "current_release_scopes",
      {
        select: "jurisdiction,document_class,version,synced_at",
        order: "synced_at.desc.nullslast",
        limit: String(RECENT_SCOPE_LIMIT),
      }
    );
  } catch {
    return [];
  }
}

const CITATION_LABEL_LOOKUP_LIMIT = 200;

/**
 * Resolve human-readable labels for run citations from corpus navigation
 * nodes. Best-effort: label coverage is partial and a lookup failure never
 * takes down the encoding status.
 */
async function readCitationMetadata(
  config: SupabaseRestConfig,
  citations: Array<string | null>,
  options: SupabaseFetchOptions,
): Promise<{
  labels: Record<string, string>;
  documentPaths: Record<string, string>;
}> {
  const paths = new Set<string>();
  for (const citation of citations) {
    if (!citation) continue;
    const ancestors = corpusLookupPathsForCitation(citation);
    // Include shallower ancestors too: source-document depth varies by corpus.
    const deepest = ancestors.at(-1);
    if (deepest) {
      const segments = deepest.split("/");
      for (let depth = 3; depth <= segments.length; depth++) {
        paths.add(segments.slice(0, depth).join("/"));
      }
    }
  }
  const list = [...paths].slice(0, CITATION_LABEL_LOOKUP_LIMIT);
  if (list.length === 0) return { labels: {}, documentPaths: {} };

  const rows = await readSupabaseRows<{ path: string; label: string | null }>(
    config,
    "corpus",
    "navigation_nodes",
    {
      select: "path,label",
      // navigation_nodes.path is the indexed lookup column (citation_path
      // is not indexed and times out on filtered reads).
      path: `in.(${list.map((p) => `"${p}"`).join(",")})`,
      limit: String(CITATION_LABEL_LOOKUP_LIMIT),
    },
    options,
  ).catch(() => [] as Array<{ path: string; label: string | null }>);

  const labels: Record<string, string> = {};
  for (const row of rows) {
    const label = row.label?.trim();
    if (label) labels[row.path] = label;
  }

  // Source roots have no parent. Unlike a fixed path depth, this distinguishes
  // agency folders from actual documents, regardless of the corpus layout.
  const provisions = await readSupabaseRows<{
    citation_path: string | null;
    heading: string | null;
    parent_id: string | null;
  }>(
    config,
    "corpus",
    "current_provisions",
    {
      select: "citation_path,heading,parent_id",
      citation_path: `in.(${list.map((p) => `"${p}"`).join(",")})`,
      limit: String(CITATION_LABEL_LOOKUP_LIMIT),
    },
    options,
  ).catch(() => []);

  const roots = new Set<string>();
  const provisionLabels = new Set<string>();
  for (const row of provisions) {
    if (!row.citation_path) continue;
    const heading = row.heading?.trim();
    if (heading && !provisionLabels.has(row.citation_path)) {
      labels[row.citation_path] = heading;
      provisionLabels.add(row.citation_path);
    }
    if (row.parent_id === null) roots.add(row.citation_path);
  }
  const documentPaths: Record<string, string> = {};
  for (const citation of citations) {
    if (!citation) continue;
    const leaf = corpusLookupPathsForCitation(citation).at(-1);
    if (!leaf) continue;
    const root = [...roots]
      .filter((path) => leaf === path || leaf.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (root) documentPaths[citation] = root;
  }
  return { labels, documentPaths };
}

async function readCorpusStatsFromSupabase(): Promise<CorpusStats> {
  const config = getSupabaseRestConfig();
  if (!config) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured");
  }

  const response = await fetch(supabaseRestUrl(config, "rpc/get_corpus_stats", {}), {
    method: "POST",
    headers: {
      ...supabaseRestHeaders(config, "corpus"),
      "Content-Profile": "corpus",
      "Content-Type": "application/json",
    },
    body: "{}",
    next: { revalidate: STATUS_REVALIDATE_SECONDS },
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Supabase returned ${response.status} for corpus.get_corpus_stats`);
  }

  const value = (await response.json()) as Partial<CorpusStats>;
  return {
    refreshed_at: stringOrNull(value.refreshed_at),
    document_classes: Array.isArray(value.document_classes)
      ? value.document_classes.map((row) => ({
          document_class: stringOrFallback(row.document_class, "unknown"),
          count: numberOrNull(row.count) ?? 0,
          body_count: numberOrNull(row.body_count) ?? 0,
          top_level_count: numberOrNull(row.top_level_count) ?? 0,
          rulespec_count: numberOrNull(row.rulespec_count) ?? 0,
          refreshed_at: stringOrNull(row.refreshed_at),
        }))
      : [],
  };
}

async function readArtifactReportFromSupabase(): Promise<ArtifactReport> {
  const config = getSupabaseRestConfig();
  if (!config) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured");
  }

  const scopes = await readSupabaseRows<CurrentReleaseScopeRow>(
    config,
    "corpus",
    "current_release_scopes",
    {
      select: "release_name,jurisdiction,document_class,version,synced_at",
      order: "jurisdiction.asc,document_class.asc,version.asc",
      limit: "1000",
    }
  );

  const rows = await mapWithConcurrency(
    scopes,
    16,
    async (scope): Promise<ArtifactScopeRow> => {
      const provisionCount = await readReleaseScopeProvisionCount(config, scope);

      return {
        jurisdiction: scope.jurisdiction,
        document_class: scope.document_class,
        version: scope.version,
        provision_count: provisionCount,
        source_count: null,
        local_complete: null,
        r2_complete: !!scope.synced_at,
        coverage_complete: null,
        supabase_count: provisionCount,
        supabase_matches_provisions: null,
        mismatch_reasons:
          provisionCount == null ? ["exact_scope_count_unavailable"] : [],
      };
    }
  );
  const exactCount = rows.filter((row) => row.supabase_count != null).length;

  return {
    refreshed_at: new Date().toISOString(),
    release: "current",
    scope_count: rows.length,
    release_scope_count: rows.length,
    local_count: 0,
    remote_count: rows.filter((row) => row.r2_complete).length,
    local_bytes: 0,
    remote_bytes: 0,
    mismatch_count: 0,
    supabase_group_count: exactCount,
    supabase_mismatch_count: rows.length - exactCount,
    counts_mode: "live",
    rows,
  };
}

async function readReleaseScopeProvisionCount(
  config: SupabaseRestConfig,
  scope: CurrentReleaseScopeRow
): Promise<number | null> {
  try {
    return await readSupabaseCount(
      config,
      "corpus",
      "current_provisions",
      {
        jurisdiction: `eq.${scope.jurisdiction}`,
        doc_type: `eq.${scope.document_class}`,
        version: `eq.${scope.version}`,
      },
      { timeoutMs: 2_000 }
    );
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, U>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, values.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface SupabaseFetchOptions {
  fresh?: boolean;
}

function supabaseCacheOptions(options: SupabaseFetchOptions): RequestInit {
  return options.fresh
    ? { cache: "no-store" }
    : ({ next: { revalidate: STATUS_REVALIDATE_SECONDS } } as RequestInit);
}

async function readSupabaseRows<T>(
  config: SupabaseRestConfig,
  schema: string,
  table: string,
  query: Record<string, string>,
  options: SupabaseFetchOptions = {}
): Promise<T[]> {
  const response = await fetch(supabaseRestUrl(config, table, query), {
    headers: supabaseRestHeaders(config, schema),
    ...supabaseCacheOptions(options),
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Supabase returned ${response.status} for ${schema}.${table}`);
  }

  const value = await response.json();
  if (!Array.isArray(value)) {
    throw new Error(`Supabase returned a non-array payload for ${schema}.${table}`);
  }
  return value as T[];
}

async function readSupabaseCount(
  config: SupabaseRestConfig,
  schema: string,
  table: string,
  filters: Record<string, string> = {},
  options: SupabaseFetchOptions & { timeoutMs?: number } = {}
): Promise<number | null> {
  const response = await fetch(
    supabaseRestUrl(config, table, {
      select: "id",
      limit: "1",
      ...filters,
    }),
    {
      headers: {
        ...supabaseRestHeaders(config, schema),
        Prefer: "count=exact",
      },
      signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
      ...supabaseCacheOptions(options),
    } as RequestInit
  );

  if (!response.ok) {
    throw new Error(`Supabase returned ${response.status} for ${schema}.${table}`);
  }

  return countFromContentRange(response.headers.get("content-range"));
}

export function countFromContentRange(value: string | null): number | null {
  const match = value?.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function supabaseRestUrl(
  config: SupabaseRestConfig,
  table: string,
  query: Record<string, string>
): string {
  const url = new URL(`/rest/v1/${table}`, ensureTrailingSlash(config.url));
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function supabaseRestHeaders(
  config: SupabaseRestConfig,
  schema: string
): Record<string, string> {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    "Accept-Profile": schema,
  };
}

async function readFromStatusUrl<T>(
  baseUrl: string,
  key: string
): Promise<ReadAttempt<T>> {
  const url = new URL(corpusKeyFromPath(key), ensureTrailingSlash(baseUrl));
  const response = await fetch(url, {
    next: { revalidate: STATUS_REVALIDATE_SECONDS },
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`Status URL returned ${response.status} for ${key}`);
  }
  return { source: "status-url", value: (await response.json()) as T };
}

async function readFromR2<T>(
  config: R2Config,
  key: string
): Promise<ReadAttempt<T>> {
  const request = buildR2GetRequest(config, corpusKeyFromPath(key));
  const response = await fetch(request.url, {
    headers: request.headers,
    next: { revalidate: STATUS_REVALIDATE_SECONDS },
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`R2 returned ${response.status} for ${key}`);
  }
  return { source: "r2", value: (await response.json()) as T };
}

async function readFromLocal<T>(key: string): Promise<ReadAttempt<T>> {
  const localRoot = process.env.AXIOM_CORPUS_LOCAL_ROOT;
  if (!localRoot) {
    throw new Error("AXIOM_CORPUS_LOCAL_ROOT is not configured");
  }
  const filePath = path.join(localRoot, corpusKeyFromPath(key));
  const text = await readFile(filePath, "utf8");
  return { source: "local", value: JSON.parse(text) as T };
}

function getR2Config(): R2Config | null {
  const endpoint = cleanEnvValue(
    process.env.AXIOM_CORPUS_R2_ENDPOINT ?? process.env.R2_ENDPOINT
  );
  const bucket = cleanEnvValue(
    process.env.AXIOM_CORPUS_R2_BUCKET ?? process.env.R2_BUCKET
  );
  const accessKeyId = cleanEnvValue(
    process.env.AXIOM_CORPUS_R2_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY_ID
  );
  const secretAccessKey = cleanEnvValue(
    process.env.AXIOM_CORPUS_R2_SECRET_ACCESS_KEY ??
      process.env.R2_SECRET_ACCESS_KEY
  );

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

function getSupabaseRestConfig(): SupabaseRestConfig | null {
  const url = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

function summarizeLatestSources(
  runs: EncodingStatusRun[]
): Record<string, number> {
  return runs.reduce<Record<string, number>>((counts, run) => {
    const key = run.data_source ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildR2GetRequest(
  config: R2Config,
  key: string,
  now = new Date()
): { url: string; headers: Record<string, string> } {
  const endpoint = config.endpoint.trim().replace(/\/+$/, "");
  const endpointUrl = new URL(endpoint);
  const bucket = config.bucket.trim();
  const accessKeyId = config.accessKeyId.trim();
  const secretAccessKey = config.secretAccessKey.trim();
  const canonicalUri = `/${encodeS3Path(bucket)}/${encodeS3Path(key)}`;
  const url = `${endpoint}${canonicalUri}`;
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = "UNSIGNED-PAYLOAD";
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `host:${endpointUrl.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    "GET",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    url,
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  };
}

function getSigningKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodeS3Path(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function errorMessage(error: unknown): string {
  return redactSensitiveError(error instanceof Error ? error.message : String(error));
}

function cleanEnvValue(value: string | undefined): string | undefined {
  const cleaned = value?.replaceAll("\\n", "\n").trim();
  return cleaned || undefined;
}

function redactSensitiveError(message: string): string {
  return message
    .replace(
      /AWS4-HMAC-SHA256 Credential=[^"]+/g,
      "AWS4-HMAC-SHA256 Credential=[redacted]"
    )
    .replace(/Signature=[0-9a-f]+/gi, "Signature=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}
