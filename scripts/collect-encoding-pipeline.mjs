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
 *   --failure-lookups N  failed runs to look up per pass (default 100). A
 *                        cause is stored once found, so the backlog drains
 *                        across passes while diagnostics bundles last (90 days).
 *                        Each lookup costs 2-3 GitHub requests, and the Actions
 *                        token's 1,000/hour is shared with the index sync.
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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildAttempts,
  failureLookups,
  oldestUnsyncedMerge,
  parseDiagnostics,
  prCitation,
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
const lookupLimit = Number(argValue("--failure-lookups") ?? 100);
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

function readEncoderRuns(since) {
  return readAll(
    "encoding_runs",
    "id,timestamp,citation,status:outcome->>status,apply_error:outcome->>apply_error,note,generation_attempt_count,estimated_cost_usd",
    (query) => query.gte("timestamp", since).order("timestamp"),
  );
}

async function readPrevious() {
  try {
    const rows = await readAll(
      "pipeline_attempts",
      "id,citation,synced_at,failure_source,failed_step,encoder_error,encoder_error_rule",
      (query) => query.order("id"),
    );
    return new Map(rows.map((row) => [row.id, row]));
  } catch (error) {
    if (!dryRun) throw error;
    console.warn(`no previous rows (${error.message})`);
    return new Map();
  }
}

function readMirror() {
  return readAll(
    "rulespec_files",
    "repo,jurisdiction,file_path,citation_path,synced_at,raw_yaml_sha256",
    (query) => query.order("repo").order("file_path"),
  );
}

const PR_QUERY = `query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number url title body isDraft state createdAt mergedAt closedAt baseRefName
        repository { name defaultBranchRef { name } }
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
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
    if (body.errors?.length) throw new Error(`GraphQL: ${body.errors[0].message}`);
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
      });
    }
    if (!search.pageInfo.hasNextPage) return prs;
    cursor = search.pageInfo.endCursor;
  }
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

async function lookUpFailure(run) {
  let detail = null;
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
  return detail;
}

async function lookUpFailures(runs) {
  const details = new Map();
  const queue = [...runs];
  await Promise.all(
    Array.from({ length: LOOKUP_CONCURRENCY }, async () => {
      for (let run = queue.shift(); run; run = queue.shift()) {
        const detail = await lookUpFailure(run);
        if (detail) details.set(String(run.id), detail);
      }
    }),
  );
  return details;
}

async function readCompileSweep() {
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

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("pipeline_attempts")
      .upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`upsert pipeline_attempts: ${error.message}`);
  }
}

async function dispatchSyncIfNeeded(oldestMerge) {
  if (!oldestMerge) return;
  const repo = process.env.GITHUB_REPOSITORY ?? `${GITHUB_ORG}/axiom-foundation.org`;
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

  const lookups = failureLookups(runs, encoderRuns, previous, nowMs, lookupLimit);
  const failureDetails = await lookUpFailures(lookups);
  console.log(`looked up ${failureDetails.size} of ${lookups.length} unexplained failures`);

  const attempts = buildAttempts({
    runs,
    prs,
    encoderRuns,
    mirror,
    compile,
    failureDetails,
    previous,
    nowMs,
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
