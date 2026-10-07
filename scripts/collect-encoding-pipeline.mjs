#!/usr/bin/env bun
/**
 * Rebuild encodings.pipeline_attempts: every targeted re-encode dispatch
 * followed through the encoder, its signed manifest PR, the merge, the
 * rulespec_files index, and the axiom-api compile sweep. The /ops pipeline
 * view reads only that table, so nothing here runs at request time.
 *
 * Usage:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   GITHUB_TOKEN=... \
 *   bun scripts/collect-encoding-pipeline.mjs
 *
 *   # Dry run: read with the public anon key, write rows to a file, and
 *   # dispatch nothing. The dev server reads the file when
 *   # AXIOM_OPS_PIPELINE_FILE points at it.
 *   bun scripts/collect-encoding-pipeline.mjs --out /tmp/pipeline.json
 *
 * Options:
 *   --compile-sweep F    read the compile sweep from a local compile-sweep.json
 *                        instead of axiom-api's latest artifact.
 *   --previous F         take earlier rows (failure causes, first sync times)
 *                        from a dry run's output instead of the table.
 *   --run-detail-lookups N  finished runs whose jobs to read per pass (default
 *                        80): when encoding started after the signing approval,
 *                        and how far a cancelled run got. Read once per run,
 *                        cancelled runs first.
 *   --oracles            re-read the axiom-oracles comparison reports now. They
 *                        are ~30 MB and change rarely, so a scheduled pass
 *                        re-reads them only in the first half hour of every
 *                        sixth UTC hour and otherwise keeps each attempt's
 *                        stored verdict.
 *   --failure-lookups N  failed runs to look up per pass (default 60). A
 *                        cause is stored once found, so the backlog drains
 *                        across passes while diagnostics bundles last (90 days).
 *                        When the bundle names only the failing step, the
 *                        failing job's log is read for what it printed.
 *                        Each lookup costs 2-3 GitHub requests, and the Actions
 *                        token's 1,000/hour is shared with the index sync.
 *   --merge-test-lookups N  default-branch merges whose merge commit's check
 *                        runs to read per pass (default 40): when the module's
 *                        validation shard first finished on main. Read until
 *                        found, newest merge first.
 *   --check-error-lookups N  failing PR jobs whose log to read per pass
 *                        (default 60): what the check printed before failing.
 *                        One request each, read once per job.
 *
 * Each dispatch also records the axiom-encode commit it ran and that commit's
 * package version (pyproject.toml, read from raw.githubusercontent.com once
 * per commit), so success can be compared across encoder releases.
 *
 * The compile sweep is an artifact of the private axiom-api repo, so reading
 * it takes AXIOM_API_ARTIFACTS_TOKEN (a token with actions:read there). Without
 * it the compile stage stays unchecked and everything else still collects.
 *
 * After writing, a merge into a default branch that no sync has picked up
 * dispatches sync-rulespec-index.yml, so the index follows merges instead of
 * waiting for its 6-hour cron.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import {
  activeWaivers,
  buildAttempts,
  checkErrorFromLog,
  checkErrorLookups,
  containmentQueries,
  containsKey,
  failureLookups,
  mergeValidationKey,
  mergeValidationLookups,
  needsLogRead,
  needsStepRead,
  oldestUnsyncedMerge,
  oracleVerdicts,
  parseDiagnostics,
  parseRunJobs,
  parseVersion,
  prCitation,
  runDetailLookups,
  syncWindowStart,
  versionLookups,
} from "../src/lib/axiom/encoding-pipeline-collect.ts";
import { GITHUB_ORG, githubHeaders } from "./lib/rulespec-discovery.mjs";

const ENCODE_REPO = "axiom-encode";
const ENCODE_WORKFLOW = "targeted-signed-reencode.yml";
const API_REPO = "axiom-api";
const COMPILE_ARTIFACT = "compile-sweep";
const SYNC_WORKFLOW = "sync-rulespec-index.yml";
const PR_TITLE = "Add signed encoding manifest for";
const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 200;

const args = process.argv.slice(2);
const outPath = argValue("--out");
const lookupLimit = Number(argValue("--failure-lookups") ?? 60);
const runDetailLimit = Number(argValue("--run-detail-lookups") ?? 80);
const checkErrorLimit = Number(argValue("--check-error-lookups") ?? 60);
const mergeTestLimit = Number(argValue("--merge-test-lookups") ?? 40);
const dryRun = Boolean(outPath);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = dryRun
  ? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error(
    dryRun
      ? "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or a Supabase key."
      : "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}
if (!process.env.GITHUB_TOKEN) {
  console.error("Missing GITHUB_TOKEN (artifact downloads and GraphQL search need one).");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "encodings" },
  auth: { autoRefreshToken: false, persistSession: false },
});

async function github(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url.startsWith("http") ? url : `https://api.github.com/${url}`, {
      ...init,
      headers: { ...githubHeaders, ...(init.headers ?? {}) },
    });
    if (res.ok) return res;
    const retryable = res.status >= 500 || res.status === 429 || res.status === 403;
    if (!retryable || attempt >= 4) {
      throw new Error(`GitHub returned ${res.status} for ${url}`);
    }
    const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || 2000 * attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function githubJson(url, init) {
  return (await github(url, init)).json();
}

async function listDispatchRuns() {
  const runs = [];
  for (let page = 1; ; page++) {
    const body = await githubJson(
      `repos/${GITHUB_ORG}/${ENCODE_REPO}/actions/workflows/${ENCODE_WORKFLOW}/runs?per_page=100&page=${page}`,
    );
    for (const run of body.workflow_runs ?? []) {
      runs.push({
        id: run.id,
        display_title: run.display_title,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        run_started_at: run.run_started_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
        run_attempt: run.run_attempt,
        triggering_actor: run.triggering_actor?.login ?? null,
        head_sha: run.head_sha ?? null,
      });
    }
    if (!body.workflow_runs?.length || runs.length >= body.total_count) break;
  }
  return runs;
}

async function readAll(table, select, build = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(supabase.from(table).select(select)).range(
      from,
      from + PAGE_SIZE - 1,
    );
    if (error) throw new Error(`encodings.${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

const ENCODER_COLUMNS =
  "id,timestamp,citation,status:outcome->>status,apply_error:outcome->>apply_error,note,generation_attempt_count,estimated_cost_usd,iterations";

/** Encoder records, with their Actions run id once axiom-encode's migration 008 adds it. */
async function readEncoderRuns(since) {
  const read = (columns) =>
    readAll("encoding_runs", columns, (query) => query.gte("timestamp", since).order("timestamp"));
  try {
    return await read(`${ENCODER_COLUMNS},github_run_id`);
  } catch (error) {
    if (!/github_run_id/.test(error.message)) throw error;
    return read(ENCODER_COLUMNS);
  }
}

const ORACLE_CARRIED = ["oracle_status", "oracle_report", "oracle_engine", "oracle_checked_at"];
const RUN_CARRIED = ["encode_started_at", "cancel_stage", "jobs_checked_at"];
const VERSION_CARRIED = ["encoder_sha", "encoder_version", "pr_check_error", "pr_check_job_id"];
const TIME_CARRIED = [
  "setup_seconds",
  "encode_seconds",
  "publish_seconds",
  "steps_read_at",
  "indexed_at",
  "tests_first_at",
];
const FIRST_TESTS_CARRIED = ["tests_first_started_at", "tests_first_status"];

async function columnsExist(columns) {
  const { error } = await supabase.from("pipeline_attempts").select(columns.join(",")).limit(1);
  return !error;
}

async function readPrevious() {
  const previousFile = argValue("--previous");
  if (previousFile) {
    const rows = JSON.parse(readFileSync(previousFile, "utf8"));
    return new Map(rows.map((row) => [row.id, row]));
  }
  const base =
    "id,citation,synced_at,failure_source,failed_step,encoder_error,encoder_error_rule,pr_repo,pr_number";
  const read = (columns) => readAll("pipeline_attempts", columns, (query) => query.order("id"));
  try {
    // Carried columns arrive by migration; read each group only once it exists.
    let columns = base;
    for (const group of [ORACLE_CARRIED, RUN_CARRIED, VERSION_CARRIED]) {
      if (await columnsExist(group)) columns += `,${group.join(",")}`;
    }
    // With the merge commit, these say which merges are timed already.
    if (await columnsExist(TIME_CARRIED)) columns += `,${TIME_CARRIED.join(",")},pr_merge_commit`;
    if (await columnsExist(FIRST_TESTS_CARRIED)) columns += `,${FIRST_TESTS_CARRIED.join(",")}`;
    const rows = await read(columns);
    return new Map(rows.map((row) => [row.id, row]));
  } catch (error) {
    if (!dryRun) throw error;
    console.warn(`no previous rows (${error.message})`);
    return new Map();
  }
}

const MIRROR_COLUMNS = "repo,jurisdiction,file_path,citation_path,synced_at,raw_yaml_sha256";

/** Index rows, with the commit each was read from once that column exists. */
async function readMirror() {
  const read = (columns) =>
    readAll("rulespec_files", columns, (query) => query.order("repo").order("file_path"));
  try {
    return await read(`${MIRROR_COLUMNS},commit_sha`);
  } catch (error) {
    if (!/commit_sha/.test(error.message)) throw error;
    return read(MIRROR_COLUMNS);
  }
}

// 20 per page: with each PR's check runs and review requests, a 50-PR page
// exceeds GitHub's per-query resource limit and comes back empty.
const PR_QUERY = `query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 20, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number url title body isDraft state createdAt mergedAt closedAt baseRefName
        repository { name defaultBranchRef { name } }
        reviewDecision
        mergeCommit { oid }
        reviewRequests(first: 10) {
          nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } ... on Bot { login } } }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name conclusion databaseId }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
        files(first: 100) { nodes { path } }
      }
    }
  }
}`;

async function searchPrs(from, to) {
  const q = `org:${GITHUB_ORG} is:pr in:title "${PR_TITLE}" created:${from}..${to}`;
  const prs = [];
  let cursor = null;
  for (;;) {
    const body = await githubJson("graphql", {
      method: "POST",
      body: JSON.stringify({ query: PR_QUERY, variables: { q, cursor } }),
    });
    if (body?.errors?.length) throw new Error(`GraphQL: ${body.errors[0].message}`);
    if (!body?.data?.search) throw new Error(`GraphQL returned no search result for ${q}`);
    const search = body.data.search;
    // Search stops at 1,000 results; split the window rather than drop PRs.
    if (search.issueCount > 1000 && from !== to) {
      const mid = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString().slice(0, 10);
      const next = new Date(Date.parse(mid) + 86_400_000).toISOString().slice(0, 10);
      return [...(await searchPrs(from, mid)), ...(await searchPrs(next, to))];
    }
    for (const node of search.nodes) {
      if (!node?.number || !node.repository?.name?.startsWith("rulespec-")) continue;
      if (!prCitation(node.title)) continue;
      prs.push({
        repo: node.repository.name,
        number: node.number,
        url: node.url,
        title: node.title,
        body: node.body ?? "",
        isDraft: node.isDraft,
        state: node.state,
        createdAt: node.createdAt,
        mergedAt: node.mergedAt,
        closedAt: node.closedAt,
        baseRefName: node.baseRefName,
        defaultBranch: node.repository.defaultBranchRef?.name ?? null,
        checks: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
        reviewDecision: node.reviewDecision,
        files: (node.files?.nodes ?? []).map((file) => file.path),
        ...checkDetail(node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []),
        requestedReviewers: (node.reviewRequests?.nodes ?? [])
          .map((request) => request.requestedReviewer)
          .filter(Boolean)
          .map((reviewer) => reviewer.login ?? (reviewer.slug ? `team:${reviewer.slug}` : null))
          .filter(Boolean),
        mergeCommit: node.mergeCommit?.oid ?? null,
      });
    }
    if (!search.pageInfo.hasNextPage) return prs;
    cursor = search.pageInfo.endCursor;
  }
}

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
// The sharded validate workflow's summary job fails whenever any shard does.
const AGGREGATE_CHECK = "validate / validate";

/** Failed check names (shards and other checks), their job ids, and the count cancelled. */
function checkDetail(contexts) {
  const failedChecks = [];
  const failedJobs = [];
  let cancelledChecks = 0;
  for (const context of contexts) {
    if (context?.__typename === "CheckRun") {
      if (context.conclusion === "CANCELLED") cancelledChecks += 1;
      else if (FAILED_CONCLUSIONS.has(context.conclusion) && context.name !== AGGREGATE_CHECK) {
        failedChecks.push(context.name);
        if (context.databaseId) failedJobs.push({ name: context.name, id: context.databaseId });
      }
    } else if (context?.__typename === "StatusContext") {
      if (context.state === "FAILURE" || context.state === "ERROR") failedChecks.push(context.context);
    }
  }
  failedJobs.sort((a, b) => a.name.localeCompare(b.name));
  return { failedChecks: failedChecks.sort(), failedJobs, cancelledChecks };
}

const VALIDATE_JOB_RE = /^validate \/ validate(?: \(([^)]+)\))?$/;
const VALIDATION_COMMITS_SCANNED = 8;

/**
 * Each repo's latest decisive (success or failure) validate result per
 * jurisdiction shard on its default branch. Walks the branch's commits
 * newest first and reads each commit's check runs: the workflow-run listing
 * is not reliably newest first.
 */
async function readValidation(repos) {
  const index = new Map();
  for (const repo of repos) {
    const shards = new Map();
    try {
      const info = await githubJson(`repos/${GITHUB_ORG}/${repo}`);
      const commits = await githubJson(
        `repos/${GITHUB_ORG}/${repo}/commits?sha=${encodeURIComponent(info.default_branch)}&per_page=${VALIDATION_COMMITS_SCANNED}`,
      );
      for (const commit of commits) {
        for (let page = 1; page <= 3; page++) {
          const body = await githubJson(
            `repos/${GITHUB_ORG}/${repo}/commits/${commit.sha}/check-runs?filter=latest&per_page=100&page=${page}`,
          );
          const runs = body.check_runs ?? [];
          for (const run of runs) {
            const match = run.name.match(VALIDATE_JOB_RE);
            if (!match) continue;
            const key = match[1] ?? "";
            if (shards.has(key)) continue;
            if (run.conclusion !== "success" && run.conclusion !== "failure") continue;
            shards.set(key, {
              conclusion: run.conclusion,
              headSha: commit.sha,
              runUrl: run.html_url,
              completedAt: run.completed_at,
            });
          }
          if (runs.length < 100) break;
        }
      }
    } catch (error) {
      console.warn(`validation for ${repo}: ${error.message}`);
    }
    index.set(repo, shards);
  }
  return index;
}

/**
 * Whether each later commit contains its merge commit. Compared as
 * later...merge, so a contained merge diffs to nothing and the response
 * stays small whatever lies between them.
 */
async function resolveContainment(queries) {
  const contains = new Map();
  for (const { repo, ancestor, descendant } of queries) {
    try {
      const body = await githubJson(
        `repos/${GITHUB_ORG}/${repo}/compare/${descendant}...${ancestor}?per_page=1`,
      );
      contains.set(
        containsKey(repo, ancestor, descendant),
        body.status === "behind" || body.status === "identical",
      );
    } catch (error) {
      console.warn(`compare ${repo} ${ancestor}..${descendant}: ${error.message}`);
    }
  }
  return contains;
}

/** Per repo, the modules an active known-validation-gaps waiver exempts. */
async function readWaivers(repos) {
  const waivers = new Map();
  for (const repo of repos) {
    try {
      const res = await github(
        `repos/${GITHUB_ORG}/${repo}/contents/known-validation-gaps.yaml`,
        { headers: { Accept: "application/vnd.github.raw" } },
      );
      waivers.set(repo, activeWaivers(yaml.load(await res.text())));
    } catch (error) {
      // No file means no waivers; anything else leaves the repo unknown.
      if (/ 404 /.test(error.message)) waivers.set(repo, new Set());
      else console.warn(`waivers for ${repo}: ${error.message}`);
    }
  }
  return waivers;
}

// Axiom-vs-engine comparison reports: axiom-<engine>-<suite>.json (PolicyEngine,
// EUROMOD/UKMOD, SNAP QC, TAXSIM, ...). Other files in the folder are indexes.
const ORACLE_REPORT_RE = /^axiom-[a-z0-9]+-.+\.json$/;
const ORACLE_CONCURRENCY = 6;

/** The axiom-oracles comparison reports, parsed into per-module verdicts. */
async function readOracleVerdicts() {
  const listing = await githubJson(
    "repos/TheAxiomFoundation/axiom-oracles/contents/dashboard/public/data",
  );
  const files = listing.filter((entry) => ORACLE_REPORT_RE.test(entry.name));
  const reports = [];
  const queue = [...files];
  await Promise.all(
    Array.from({ length: ORACLE_CONCURRENCY }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          const res = await fetch(file.download_url);
          if (res.ok) reports.push({ name: file.name, report: await res.json() });
        } catch (error) {
          console.warn(`oracle report ${file.name}: ${error.message}`);
        }
      }
    }),
  );
  console.log(`read ${reports.length} of ${files.length} oracle reports`);
  return oracleVerdicts(reports);
}

function oracleRefreshDue(nowMs) {
  const now = new Date(nowMs);
  return args.includes("--oracles") || (now.getUTCHours() % 6 === 0 && now.getUTCMinutes() < 30);
}

async function listManifestPrs(sinceIso) {
  const prs = [];
  const now = new Date();
  let cursor = new Date(Date.UTC(new Date(sinceIso).getUTCFullYear(), new Date(sinceIso).getUTCMonth(), 1));
  while (cursor <= now) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const last = new Date(next.getTime() - 86_400_000);
    prs.push(
      ...(await searchPrs(cursor.toISOString().slice(0, 10), last.toISOString().slice(0, 10))),
    );
    cursor = next;
  }
  const unique = new Map(prs.map((pr) => [`${pr.repo}#${pr.number}`, pr]));
  return [...unique.values()];
}

/** Download an Actions artifact zip to a temp dir; returns [dir, zipPath]. */
async function downloadArtifact(artifact, init) {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-artifact-"));
  const zipPath = join(dir, "artifact.zip");
  const res = await github(artifact.archive_download_url, init);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  return [dir, zipPath];
}

function unzipText(zipPath, member) {
  return execFileSync("unzip", ["-p", zipPath, member], { maxBuffer: 256 * 1024 * 1024 });
}

const TAR_LIMIT = { maxBuffer: 256 * 1024 * 1024 };

/**
 * The run's targeted-reencode-failure bundle: metadata.json (failed steps,
 * citation) and a rejected candidate's issues.json. Current bundles wrap the
 * files in targeted-reencode-failure.tar; July's put them in the zip itself.
 */
async function diagnosticsDetail(runId) {
  const body = await githubJson(
    `repos/${GITHUB_ORG}/${ENCODE_REPO}/actions/runs/${runId}/artifacts?per_page=50`,
  );
  const artifact = (body.artifacts ?? []).find(
    (a) => a.name.startsWith("targeted-reencode-failure-") && !a.expired,
  );
  if (!artifact) return null;
  const [dir, zipPath] = await downloadArtifact(artifact);
  try {
    const zipMembers = execFileSync("unzip", ["-Z1", zipPath], TAR_LIMIT)
      .toString()
      .split("\n");
    let members = zipMembers;
    let read = (member) => unzipText(zipPath, member);
    if (zipMembers.includes("targeted-reencode-failure.tar")) {
      const tarPath = join(dir, "bundle.tar");
      writeFileSync(tarPath, unzipText(zipPath, "targeted-reencode-failure.tar"));
      members = execFileSync("tar", ["-tf", tarPath], TAR_LIMIT).toString().split("\n");
      read = (member) => execFileSync("tar", ["-xOf", tarPath, member], TAR_LIMIT);
    }
    const json = (member) => (member ? JSON.parse(read(member).toString()) : null);
    const metadataMember = members.find((m) => m.replace(/^\.\//, "") === "metadata.json");
    const issueMembers = members.filter((m) => m.endsWith("final-rejected-candidate/issues.json"));
    // The target lane's rejection explains the run better than a dependent's.
    const issuesMember =
      issueMembers.find((m) => m.includes("/target/")) ?? issueMembers[0] ?? null;
    return parseDiagnostics(json(metadataMember), json(issuesMember));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function jobsDetail(runId) {
  const body = await githubJson(
    `repos/${GITHUB_ORG}/${ENCODE_REPO}/actions/runs/${runId}/jobs?per_page=50`,
  );
  for (const job of body.jobs ?? []) {
    if (job.conclusion !== "failure") continue;
    const step = (job.steps ?? []).find((s) => s.conclusion === "failure");
    return {
      source: "jobs",
      failed_step: step ? `${job.name} / ${step.name}` : job.name,
      error: null,
      rule: null,
    };
  }
  return { source: "jobs", failed_step: null, error: null, rule: null };
}

const LOOKUP_CONCURRENCY = 6;

/**
 * What the failing job printed before it failed, from its log: undefined
 * when the log cannot be read (try again next pass), null when it shows no
 * error.
 */
async function logError(runId) {
  try {
    const body = await githubJson(
      `repos/${GITHUB_ORG}/${ENCODE_REPO}/actions/runs/${runId}/jobs?per_page=50`,
    );
    const job = (body.jobs ?? []).find((j) => j.conclusion === "failure");
    if (!job) return null;
    const res = await github(`repos/${GITHUB_ORG}/${ENCODE_REPO}/actions/jobs/${job.id}/logs`);
    return checkErrorFromLog(await res.text());
  } catch (error) {
    // Logs expire after 90 days; record that rather than ask every pass.
    if (/returned (404|410)/.test(error.message)) return null;
    console.warn(`log for run ${runId}: ${error.message}`);
    return undefined;
  }
}

async function lookUpFailure(run, known) {
  // A run its log explains, without its step: only the step needs reading.
  if (known && needsStepRead(known)) {
    try {
      const { failed_step } = await jobsDetail(run.id);
      if (!failed_step) return null;
      return {
        source: "log",
        citation: known.citation ?? null,
        failed_step,
        error: known.encoder_error ?? null,
        rule: known.encoder_error_rule ?? null,
      };
    } catch (error) {
      console.warn(`jobs for run ${run.id}: ${error.message}`);
      return null;
    }
  }
  // A run already explained by its step alone only needs its log read.
  let detail = known && needsLogRead(known)
    ? {
        source: known.failure_source,
        citation: known.citation ?? null,
        failed_step: known.failed_step ?? null,
        error: null,
        rule: null,
      }
    : null;
  if (!detail) {
    try {
      detail = await diagnosticsDetail(run.id);
    } catch (error) {
      console.warn(`diagnostics for run ${run.id}: ${error.message.split("\n")[0]}`);
    }
    try {
      detail ??= await jobsDetail(run.id);
    } catch (error) {
      console.warn(`jobs for run ${run.id}: ${error.message}`);
    }
  }
  if (detail && !detail.error && !detail.rule) {
    const printed = await logError(run.id);
    if (printed !== undefined) detail = { ...detail, source: "log", error: printed };
  }
  // The step that failed, from the jobs API, when the diagnostics bundle did not name it.
  if (detail && !detail.failed_step) {
    try {
      const { failed_step } = await jobsDetail(run.id);
      if (failed_step) detail = { ...detail, failed_step };
    } catch (error) {
      console.warn(`jobs for run ${run.id}: ${error.message}`);
    }
  }
  return detail;
}

async function lookUpFailures(runs, previous) {
  const details = new Map();
  const queue = [...runs];
  await Promise.all(
    Array.from({ length: LOOKUP_CONCURRENCY }, async () => {
      for (let run = queue.shift(); run; run = queue.shift()) {
        const detail = await lookUpFailure(run, previous.get(String(run.id)));
        if (detail) details.set(String(run.id), detail);
      }
    }),
  );
  return details;
}

async function lookUpRunDetails(runs) {
  const details = new Map();
  const queue = [...runs];
  await Promise.all(
    Array.from({ length: LOOKUP_CONCURRENCY }, async () => {
      for (let run = queue.shift(); run; run = queue.shift()) {
        try {
          const body = await githubJson(
            `repos/${GITHUB_ORG}/${ENCODE_REPO}/actions/runs/${run.id}/jobs?per_page=50`,
          );
          details.set(String(run.id), parseRunJobs(body.jobs ?? [], run.conclusion));
        } catch (error) {
          console.warn(`jobs for run ${run.id}: ${error.message}`);
        }
      }
    }),
  );
  return details;
}

const VERSION_CONCURRENCY = 8;

/** Package versions for axiom-encode commits, from each commit's pyproject.toml. */
async function readEncoderVersions(shas) {
  const versions = new Map();
  const queue = [...shas];
  await Promise.all(
    Array.from({ length: VERSION_CONCURRENCY }, async () => {
      for (let sha = queue.shift(); sha; sha = queue.shift()) {
        try {
          const res = await fetch(
            `https://raw.githubusercontent.com/${GITHUB_ORG}/${ENCODE_REPO}/${sha}/pyproject.toml`,
          );
          const version = res.ok ? parseVersion(await res.text()) : null;
          if (version) versions.set(sha, version);
        } catch (error) {
          console.warn(`version for ${sha}: ${error.message}`);
        }
      }
    }),
  );
  return versions;
}

/** What each failing PR job printed before it failed, by job id. */
async function readCheckErrors(jobs) {
  const errors = new Map();
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: LOOKUP_CONCURRENCY }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const res = await github(`repos/${GITHUB_ORG}/${job.repo}/actions/jobs/${job.jobId}/logs`);
          errors.set(
            String(job.jobId),
            checkErrorFromLog(await res.text()) ?? "The log shows no error message",
          );
        } catch (error) {
          // Logs expire after 90 days; say so rather than ask again every pass.
          if (/returned (404|410)/.test(error.message)) {
            errors.set(String(job.jobId), "The job's log is no longer available");
          } else {
            console.warn(`log of ${job.repo} job ${job.jobId}: ${error.message}`);
          }
        }
      }
    }),
  );
  return errors;
}

async function readCompileSweep() {
  const localSweep = argValue("--compile-sweep");
  if (localSweep) return JSON.parse(readFileSync(localSweep, "utf8"));
  const token = process.env.AXIOM_API_ARTIFACTS_TOKEN;
  if (!token) {
    console.log("compile sweep skipped: AXIOM_API_ARTIFACTS_TOKEN is not set");
    return null;
  }
  const init = { headers: { Authorization: `Bearer ${token}` } };
  try {
    const body = await githubJson(
      `repos/${GITHUB_ORG}/${API_REPO}/actions/artifacts?name=${COMPILE_ARTIFACT}&per_page=5`,
      init,
    );
    const artifact = (body.artifacts ?? []).find((a) => !a.expired);
    if (!artifact) return null;
    const [dir, zipPath] = await downloadArtifact(artifact, init);
    try {
      const sweep = JSON.parse(unzipText(zipPath, "compile-sweep.json").toString());
      return Array.isArray(sweep.rows) ? sweep : null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(`compile sweep unavailable: ${error.message}`);
    return null;
  }
}

// Added by the 2026-10-01 stages migration; written only once they exist.
const STAGE_COLUMNS = [
  "pr_failed_checks",
  "pr_cancelled_checks",
  "pr_requested_reviewers",
  "pr_merge_commit",
  "tests_status",
  "tests_checked_at",
  "tests_run_url",
  "oracle_status",
  "oracle_report",
  "oracle_engine",
  "oracle_checked_at",
];

// Added by the 2026-10-01 run-detail migration.
const RUN_COLUMNS = ["dispatched_by", ...RUN_CARRIED];

// Added by the 2026-10-02 versions migration.
const VERSION_COLUMNS = VERSION_CARRIED;

// Added by the 2026-10-05 step-times migration.
const TIME_COLUMNS = TIME_CARRIED;

// Added by the 2026-10-05 first-tests migration.
const FIRST_TESTS_COLUMNS = FIRST_TESTS_CARRIED;

// Added by the 2026-10-06 tries migration: derived from encoder records each pass.
const TRIES_COLUMNS = ["tries"];

async function upsert(rows) {
  // Each migration's columns are written only once that migration is applied.
  for (const [name, group] of [
    ["stage", STAGE_COLUMNS],
    ["run detail", RUN_COLUMNS],
    ["version", VERSION_COLUMNS],
    ["step time", TIME_COLUMNS],
    ["first tests", FIRST_TESTS_COLUMNS],
    ["tries", TRIES_COLUMNS],
  ]) {
    if (await columnsExist(group)) continue;
    console.log(`${name} columns not written yet (migration not applied)`);
    rows = rows.map((row) => {
      const trimmed = { ...row };
      for (const column of group) delete trimmed[column];
      return trimmed;
    });
  }
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("pipeline_attempts")
      .upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`upsert pipeline_attempts: ${error.message}`);
  }
}

const SYNC_PAGES_MAX = 10;

function syncRepo() {
  return process.env.GITHUB_REPOSITORY ?? `${GITHUB_ORG}/axiom-foundation.org`;
}

/** Successful index syncs started since `since`: when each read the default branches and finished. */
async function readSyncRuns(since) {
  if (!since) return [];
  const runs = [];
  try {
    for (let page = 1; page <= SYNC_PAGES_MAX; page++) {
      const body = await githubJson(
        `repos/${syncRepo()}/actions/workflows/${SYNC_WORKFLOW}/runs?status=success&created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`,
      );
      const listed = body.workflow_runs ?? [];
      for (const run of listed) runs.push({ created_at: run.created_at, updated_at: run.updated_at });
      if (listed.length < 100) break;
    }
  } catch (error) {
    console.warn(`sync runs: ${error.message}`);
    return null;
  }
  return runs;
}

/** Per merge commit, each validate shard's first decisive run there: when it started and finished, and how. */
async function readMergeValidation(lookups) {
  const results = new Map();
  const queue = [...lookups];
  await Promise.all(
    Array.from({ length: LOOKUP_CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const shards = new Map();
        try {
          for (let page = 1; page <= 3; page++) {
            const body = await githubJson(
              `repos/${GITHUB_ORG}/${item.repo}/commits/${item.commit}/check-runs?filter=all&per_page=100&page=${page}`,
            );
            const checks = body.check_runs ?? [];
            // Every attempt, so a re-run does not hide when the first one finished.
            for (const check of checks) {
              const match = check.name.match(VALIDATE_JOB_RE);
              if (!match || !check.completed_at) continue;
              if (check.conclusion !== "success" && check.conclusion !== "failure") continue;
              const shard = match[1] ?? "";
              const known = shards.get(shard);
              if (!known || check.completed_at < known.completedAt) {
                shards.set(shard, {
                  startedAt: check.started_at ?? null,
                  completedAt: check.completed_at,
                  conclusion: check.conclusion,
                });
              }
            }
            if (checks.length < 100) break;
          }
          results.set(mergeValidationKey(item.repo, item.commit), shards);
        } catch (error) {
          console.warn(`checks at ${item.repo}@${item.commit}: ${error.message}`);
        }
      }
    }),
  );
  return results;
}

async function dispatchSyncIfNeeded(oldestMerge) {
  if (!oldestMerge) return;
  const repo = syncRepo();
  const body = await githubJson(
    `repos/${repo}/actions/workflows/${SYNC_WORKFLOW}/runs?per_page=5`,
  );
  const runs = body.workflow_runs ?? [];
  if (runs.some((run) => run.status !== "completed")) {
    console.log("sync already queued or running");
    return;
  }
  if (runs[0] && runs[0].created_at >= oldestMerge) {
    console.log(`last sync (${runs[0].created_at}) started after the oldest unsynced merge`);
    return;
  }
  const repoInfo = await githubJson(`repos/${repo}`);
  await github(`repos/${repo}/actions/workflows/${SYNC_WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: repoInfo.default_branch }),
  });
  console.log(`dispatched ${SYNC_WORKFLOW}: merged since ${oldestMerge} not yet indexed`);
}

async function main() {
  const nowMs = Date.now();
  const runs = await listDispatchRuns();
  if (runs.length === 0) throw new Error("no dispatch runs listed");
  const earliest = runs.map((run) => run.created_at).sort()[0];
  const since = new Date(Date.parse(earliest) - 86_400_000).toISOString();
  console.log(`${runs.length} dispatch runs since ${earliest}`);

  const [encoderRuns, previous, mirror, prs, compile] = await Promise.all([
    readEncoderRuns(since),
    readPrevious(),
    readMirror(),
    listManifestPrs(since),
    readCompileSweep(),
  ]);
  console.log(
    `${encoderRuns.length} encoder records, ${prs.length} manifest PRs, ${mirror.length} index rows, ` +
      `compile sweep ${compile ? compile.generated_at : "unavailable"}, ${previous.size} previous rows`,
  );

  const mergedRepos = [
    ...new Set(prs.filter((pr) => pr.state === "MERGED").map((pr) => pr.repo)),
  ].sort();
  const [validation, waivers] = await Promise.all([
    readValidation(mergedRepos),
    readWaivers(mergedRepos),
  ]);
  const oracle = oracleRefreshDue(nowMs)
    ? await readOracleVerdicts().catch((error) => {
        console.warn(`oracle reports unavailable: ${error.message}`);
        return undefined;
      })
    : undefined;
  const contains = await resolveContainment(
    containmentQueries(prs, mirror, validation, oracle),
  );
  console.log(
    `validation read for ${mergedRepos.length} repos, ${contains.size} merge ancestry checks`,
  );

  const lookups = failureLookups(runs, encoderRuns, previous, nowMs, lookupLimit);
  const failureDetails = await lookUpFailures(lookups, previous);
  console.log(`looked up ${failureDetails.size} of ${lookups.length} unexplained failures`);
  // A dry run times every step it reads; a pass writes them once the migration is in.
  const timesTracked = dryRun || (await columnsExist(TIME_COLUMNS));
  const detailRuns = runDetailLookups(runs, previous, runDetailLimit, { steps: timesTracked });
  const runDetails = await lookUpRunDetails(detailRuns);
  console.log(`read jobs for ${runDetails.size} of ${detailRuns.length} runs`);
  const shas = versionLookups(runs, previous);
  const encoderVersions = await readEncoderVersions(shas);
  console.log(`read encoder versions for ${encoderVersions.size} of ${shas.length} new commits`);
  const errorJobs = checkErrorLookups(prs, previous, checkErrorLimit);
  const checkErrors = await readCheckErrors(errorJobs);
  console.log(`read ${checkErrors.size} of ${errorJobs.length} failing PR check logs`);
  const syncSince = timesTracked ? syncWindowStart(prs, previous, nowMs) : null;
  const syncRuns = timesTracked ? await readSyncRuns(syncSince) : null;
  const firstTestsTracked = dryRun || (await columnsExist(FIRST_TESTS_COLUMNS));
  const mergeLookups = timesTracked
    ? mergeValidationLookups(prs, previous, mergeTestLimit, { detail: firstTestsTracked })
    : [];
  const mergeValidation = await readMergeValidation(mergeLookups);
  console.log(
    `read ${syncRuns?.length ?? 0} index syncs since ${syncSince ?? "-"}, ` +
      `validation at ${mergeValidation.size} of ${mergeLookups.length} merge commits`,
  );

  const attempts = buildAttempts({
    runs,
    prs,
    encoderRuns,
    mirror,
    compile,
    failureDetails,
    previous,
    nowMs,
    contains,
    validation,
    waivers,
    oracle,
    runDetails,
    encoderVersions,
    checkErrors,
    syncRuns: syncRuns ?? undefined,
    mergeValidation,
  });

  if (dryRun) {
    writeFileSync(outPath, JSON.stringify(attempts, null, 1));
    console.log(`wrote ${attempts.length} attempts to ${outPath}`);
    return;
  }
  await upsert(attempts);
  console.log(`upserted ${attempts.length} attempts`);
  await dispatchSyncIfNeeded(oldestUnsyncedMerge(attempts, nowMs));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
