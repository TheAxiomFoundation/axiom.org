import { availableGraphCitations } from "@/lib/axiom/ops-graph-availability";
import { corpusLookupPathsForCitation } from "@/lib/axiom/ops-citations";

const STATUS_REVALIDATE_SECONDS = 300;

const ENCODING_STATUS_KEY = "supabase://encodings.encoding_runs";
/** How far back live_encoding_runs rows stay in the ops payload (by
 *  heartbeat). Generous because the ledger leans on live rows for history
 *  until manifest syncs land in encoding_runs. */
const LIVE_RUN_WINDOW_HOURS = 7 * 24;

export type CorpusArtifactSource = "supabase";

export interface EncodingStatusRun {
  /** True only after the graph serving API confirms a viewable graph. */
  graph_available?: boolean;
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

/** What /ops reads: its initial render and its /api/ops/encoding poll. */
export interface EncodingOpsStatus {
  refreshed_at: string;
  latest_runs: EncodingStatusRun[];
  live_runs: LiveEncodingRun[];
  /** Human-readable corpus labels keyed by navigation path
   *  (`us/statute/26` → "INTERNAL REVENUE CODE") for the citations that
   *  appear in latest_runs and live_runs. Best-effort. */
  citation_labels?: Record<string, string>;
  /** Confirmed source-document roots, keyed by the original run citation. */
  citation_document_paths?: Record<string, string>;
}

export interface CorpusStatusArtifact<T> {
  key: string;
  source: CorpusArtifactSource | null;
  value: T | null;
  error: string | null;
}

export interface SupabaseRestConfig {
  url: string;
  anonKey: string;
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

async function readEncodingStatusFromSupabase(
  options: { fresh?: boolean } = {}
): Promise<EncodingOpsStatus> {
  const config = getSupabaseRestConfig();
  if (!config) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured");
  }

  const fetchOptions: SupabaseFetchOptions = { fresh: options.fresh };
  const liveWindowStart = new Date(
    Date.now() - LIVE_RUN_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();

  const [latestRuns, liveRuns] = await Promise.all([
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

  const [citationMetadata, graphCitations] = await Promise.all([
    readCitationMetadata(
      config,
      [
        ...latestRuns.map((run) => run.citation),
        ...liveRuns.map((run) => run.citation),
      ],
      fetchOptions
    ),
    availableGraphCitations(latestRuns),
  ]);

  return {
    refreshed_at: new Date().toISOString(),
    latest_runs: latestRuns.map((run) => ({
      ...run,
      graph_available: run.citation != null && graphCitations.has(run.citation),
    })),
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
/** Citations per batched lookup: their ancestor paths stay under the lookup limit. */
const CITATION_METADATA_BATCH = 25;

export interface CitationMetadata {
  labels: Record<string, string>;
  documentPaths: Record<string, string>;
}

/**
 * Names and source documents for any number of citations (the /ops
 * ledger's), read in batches so a whole jurisdiction fits the lookup
 * limit. Empty where Supabase is not configured or a batch fails.
 */
export async function getCitationMetadata(citations: string[]): Promise<CitationMetadata> {
  const config = getSupabaseRestConfig();
  if (!config) return { labels: {}, documentPaths: {} };
  const unique = [...new Set(citations)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += CITATION_METADATA_BATCH) {
    batches.push(unique.slice(i, i + CITATION_METADATA_BATCH));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      readCitationMetadata(config, batch, {}).catch(() => ({ labels: {}, documentPaths: {} }))
    )
  );
  return {
    labels: Object.assign({}, ...results.map((result) => result.labels)),
    documentPaths: Object.assign({}, ...results.map((result) => result.documentPaths)),
  };
}

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

export interface SupabaseFetchOptions {
  fresh?: boolean;
}

function supabaseCacheOptions(options: SupabaseFetchOptions): RequestInit {
  return options.fresh
    ? { cache: "no-store" }
    : ({ next: { revalidate: STATUS_REVALIDATE_SECONDS } } as RequestInit);
}

export async function readSupabaseRows<T>(
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

export function getSupabaseRestConfig(): SupabaseRestConfig | null {
  const url = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
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
