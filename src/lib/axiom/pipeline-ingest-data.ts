/**
 * Reads what the ingest stations of the encoding line are derived from (see
 * pipeline-ingest.ts): the signed releases and their activations from the
 * corpus tables, axiom-corpus's publish runs and PRs, and every rulespec
 * repo's pin history, from GitHub.
 *
 * The GitHub reads are cached with the result (INGEST_REVALIDATE_SECONDS),
 * like the Program coverage tab's corpus panel. The PRs and pin history come
 * from GitHub's GraphQL API, which needs a token (AXIOM_GITHUB_TOKEN); without
 * one, Corpus ingest has no times and Release pin is not measured.
 */

import { unstable_cache } from "next/cache";
import { getSupabaseRestConfig, readSupabaseRows, type SupabaseRestConfig } from "@/lib/corpus-status";
import { getCorpusView, parsePin, readRulespecRepos } from "./corpus-releases";
import type { PipelineEvent } from "./pipeline-events";
import { commitPrNumber, ingestEvents, ORG_URL, type CorpusPr, type IngestInputs, type PinRecord, type PublishRun } from "./pipeline-ingest";

const ORG = "TheAxiomFoundation";
const INGEST_REVALIDATE_SECONDS = 900;
const ROW_PAGE = 1000;
const MAX_ROW_PAGES = 20;
/** Publish runs read back this far: past the 90-day window, for releases signed just before it. */
const RUN_HISTORY_DAYS = 120;
const MAX_RUN_PAGES = 6;
/** Toolchain commits per repo, 100 a page. */
const MAX_PIN_PAGES = 10;
/** PRs or commits per GraphQL query. */
const LOOKUP_BATCH = 60;
const REQUEST_TIMEOUT_MS = 15_000;
/** The page waits this long for a cold read, then shows the ingest stations as not measured. */
const READ_BUDGET_MS = 25_000;
const TOOLCHAIN = ".axiom/toolchain.toml";

export interface IngestResult {
  events: PipelineEvent[];
  /** Ingest stations with no measure, and why. */
  unmeasured: Record<string, string>;
  error: string | null;
}

function githubToken(): string | null {
  return (process.env.AXIOM_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim() || null;
}

async function githubJson<T>(url: string, token: string | null): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  } as RequestInit);
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${url.replace(/\?.*/, "")}`);
  return response.json() as Promise<T>;
}

async function graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  } as RequestInit);
  if (!response.ok) throw new Error(`GitHub GraphQL returned ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!body.data) throw new Error(`GitHub GraphQL: ${body.errors?.[0]?.message ?? "no data"}`);
  return body.data;
}

async function readAll<T>(config: SupabaseRestConfig, table: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_ROW_PAGES; page++) {
    const chunk = await readSupabaseRows<T>(config, "corpus", table, { ...query, limit: String(ROW_PAGE), offset: String(page * ROW_PAGE) }, { fresh: true });
    rows.push(...chunk);
    if (chunk.length < ROW_PAGE) return rows;
  }
  throw new Error(`corpus.${table} has more than ${MAX_ROW_PAGES * ROW_PAGE} rows`);
}

interface RunRow {
  id: number;
  html_url: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  conclusion: string | null;
  status: string;
  head_commit?: { timestamp?: string; message?: string } | null;
}

/** axiom-corpus's finished publish runs since `since` (YYYY-MM-DD): the first page, then the rest at once. */
export async function readPublishRuns(since: string, token: string | null): Promise<PublishRun[]> {
  const page = (n: number) =>
    githubJson<{ total_count: number; workflow_runs: RunRow[] }>(
      `https://api.github.com/repos/${ORG}/axiom-corpus/actions/workflows/publish.yml/runs?status=completed&exclude_pull_requests=true&per_page=100&page=${n}&created=${encodeURIComponent(`>=${since}`)}`,
      token
    );
  const first = await page(1);
  const pages = Math.min(MAX_RUN_PAGES, Math.ceil(first.total_count / 100));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 2)));
  return [first, ...rest].flatMap((body) =>
    body.workflow_runs.map((r) => ({
      id: r.id,
      url: r.html_url,
      headSha: r.head_sha,
      commitAt: r.head_commit?.timestamp ?? null,
      commitMessage: r.head_commit?.message?.split("\n")[0] ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      conclusion: r.conclusion,
    }))
  );
}

/** axiom-corpus PRs by number. */
export async function readCorpusPrs(numbers: number[], token: string): Promise<Record<number, CorpusPr>> {
  const out: Record<number, CorpusPr> = {};
  const unique = [...new Set(numbers)].filter((n) => Number.isInteger(n) && n > 0);
  for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
    const batch = unique.slice(i, i + LOOKUP_BATCH);
    const fields = batch.map((n) => `p${n}: pullRequest(number: ${n}) { number url createdAt mergedAt }`).join("\n");
    const data = await graphql<{ repository: Record<string, CorpusPr | null> }>(
      `query { repository(owner: "${ORG}", name: "axiom-corpus") { ${fields} } }`,
      {},
      token
    );
    for (const pr of Object.values(data.repository)) if (pr) out[pr.number] = pr;
  }
  return out;
}

interface HistoryNode {
  oid: string;
  committedDate: string;
  file: { object: { text?: string | null } | null } | null;
}

interface PrNode {
  number: number;
  url: string;
  mergedAt: string | null;
  baseRefName: string;
}

const HISTORY_QUERY = `query($name: String!, $after: String) {
  repository(owner: "${ORG}", name: $name) {
    defaultBranchRef { name target { ... on Commit {
      history(first: 100, path: "${TOOLCHAIN}", after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { oid committedDate file(path: "${TOOLCHAIN}") { object { ... on Blob { text } } } }
      }
    } } }
  }
}`;

/**
 * When a repo's default branch first pinned each release: the earliest
 * commit there whose toolchain file names it, landed by its PR's merge (or,
 * pushed directly, at its own time).
 */
export async function readRepoPins(repo: string, token: string): Promise<PinRecord[]> {
  const nodes: HistoryNode[] = [];
  let branch = "main";
  let after: string | null = null;
  for (let page = 0; page < MAX_PIN_PAGES; page++) {
    const data: {
      repository: {
        defaultBranchRef: { name: string; target: { history?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: HistoryNode[] } } } | null;
      } | null;
    } = await graphql(HISTORY_QUERY, { name: repo, after }, token);
    const ref = data.repository?.defaultBranchRef;
    const history = ref?.target.history;
    if (!ref || !history) break;
    branch = ref.name;
    nodes.push(...history.nodes);
    if (!history.pageInfo.hasNextPage) break;
    after = history.pageInfo.endCursor;
  }
  const first = new Map<string, HistoryNode>();
  for (const node of nodes) {
    const release = parsePin(node.file?.object?.text ?? "");
    if (!release) continue;
    const seen = first.get(release);
    if (!seen || Date.parse(node.committedDate) < Date.parse(seen.committedDate)) first.set(release, node);
  }
  if (!first.size) return [];
  const entries = [...first.entries()];
  const prs = new Map<string, PrNode[]>();
  for (let i = 0; i < entries.length; i += LOOKUP_BATCH) {
    const batch = entries.slice(i, i + LOOKUP_BATCH);
    const fields = batch
      .map(([, node], j) => `c${i + j}: object(oid: "${node.oid}") { ... on Commit { oid associatedPullRequests(first: 3) { nodes { number url mergedAt baseRefName } } } }`)
      .join("\n");
    const data = await graphql<{ repository: Record<string, { oid: string; associatedPullRequests: { nodes: PrNode[] } } | null> }>(
      `query { repository(owner: "${ORG}", name: "${repo}") { ${fields} } }`,
      {},
      token
    );
    for (const commit of Object.values(data.repository)) if (commit) prs.set(commit.oid, commit.associatedPullRequests.nodes);
  }
  return entries.map(([release, node]) => {
    const merged = (prs.get(node.oid) ?? [])
      .filter((pr) => pr.baseRefName === branch && pr.mergedAt)
      .sort((a, b) => Date.parse(a.mergedAt!) - Date.parse(b.mergedAt!))[0];
    return {
      repo,
      release,
      at: merged?.mergedAt ?? node.committedDate,
      ref_url: merged?.url ?? `${ORG_URL}/${repo}/commit/${node.oid}`,
    };
  });
}

/** Runs `fn` over `items`, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The ingest events and what could not be measured. Throws when the release
 * tables cannot be read, so a failure is not cached; a GitHub part that fails
 * leaves its stations unmeasured or untimed.
 */
export async function readIngest(now = Date.now()): Promise<IngestResult> {
  const config = getSupabaseRestConfig();
  if (!config) throw new Error("Supabase is not configured");
  const token = githubToken();
  const since = new Date(now - RUN_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const unmeasured: Record<string, string> = {};
  const errors: string[] = [];

  const [releases, activations, runs, view, repos] = await Promise.all([
    readAll<{ release_name: string; created_at: string }>(config, "release_objects", { select: "release_name,created_at", order: "created_at.asc" }),
    readAll<{ release_name: string; activated_at: string }>(config, "scope_activation_history", { select: "release_name,activated_at", order: "id.asc" }),
    readPublishRuns(since, token).catch((error) => {
      errors.push(`publish runs: ${message(error)}`);
      return [] as PublishRun[];
    }),
    getCorpusView(),
    token ? readRulespecRepos() : Promise.resolve([] as string[]),
  ]);

  let prs: Record<number, CorpusPr> = {};
  let pins: PinRecord[] = [];
  if (token) {
    const numbers = runs.map((r) => commitPrNumber(r.commitMessage)).filter((n): n is number => n != null);
    const [prResult, pinResult] = await Promise.all([
      readCorpusPrs(numbers, token).catch((error) => {
        errors.push(`axiom-corpus PRs: ${message(error)}`);
        return {} as Record<number, CorpusPr>;
      }),
      pool(repos, 8, (j) =>
        readRepoPins(`rulespec-${j}`, token).catch((error) => {
          errors.push(`rulespec-${j} pins: ${message(error)}`);
          return [] as PinRecord[];
        })
      ),
    ]);
    prs = prResult;
    pins = pinResult.flat();
    if (!pins.length) unmeasured.release_pin = "pin history not readable";
  } else {
    unmeasured.release_pin = "needs a GitHub token to read the pin history";
  }

  const inputs: IngestInputs = {
    releases: releases.map((r) => ({ name: r.release_name, signedAt: r.created_at })),
    runs,
    prs,
    activations,
    pins,
    toActivate: (view?.jurisdictions ?? []).flatMap((j) => (j.next ? [{ jurisdiction: j.jurisdiction, release: j.next.release }] : [])),
  };
  return { events: ingestEvents(inputs), unmeasured, error: errors.length ? errors.join("; ") : null };
}

const cachedIngest = unstable_cache(() => readIngest(), ["ops-pipeline-ingest-v1"], { revalidate: INGEST_REVALIDATE_SECONDS });

/** The ingest events, cached; every ingest station unmeasured when they cannot be read in time. */
export async function getIngestEvents(budgetMs = READ_BUDGET_MS): Promise<IngestResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      cachedIngest(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${Math.round(budgetMs / 1000)}s`)), budgetMs);
      }),
    ]);
  } catch (error) {
    const why = "release data not readable";
    return {
      events: [],
      unmeasured: { corpus_ingest: why, release_publish: why, release_activate: why, release_pin: why },
      error: `corpus releases: ${message(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The log plus the ingest events, unless the log already carries release
 * events (a writer put them in encodings.pipeline_events).
 */
export function withIngest(events: PipelineEvent[], ingest: PipelineEvent[]): PipelineEvent[] {
  return events.some((e) => e.source === "corpus_release") ? events : [...events, ...ingest];
}
