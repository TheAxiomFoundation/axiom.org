/**
 * Server-side client for the hosted Axiom API's runtime-package
 * surface: the package registry and per-program rule graphs. This is
 * the app's first integration with the hosted API — everything
 * executable (packages, graphs, later calculate) comes from here,
 * while corpus text stays on Supabase.
 *
 * Env-gated: without AXIOM_RUNTIME_API_KEY every call resolves to an
 * empty result and pages render exactly as before. The key must stay
 * server-side — client components consume derived data through
 * server props, never this module.
 */

const DEFAULT_BASE = "https://axiom-api-eta.vercel.app/v1";
const REQUEST_TIMEOUT_MS = 4000;
const CALCULATE_TIMEOUT_MS = 15000;
const REVALIDATE_SECONDS = 600;

export interface RuntimePackageSummary {
  program_id: string;
  jurisdiction: string;
  runtime_id: string;
  mode: "fixture" | "compiled";
  status: "ready" | "unavailable";
  default_outputs: string[];
  output_count?: number;
  entity_count?: number;
  input_count?: number;
  /** Certified-serving counts: how much of the package the ledger
   *  actually lets the API serve. Zero means "nothing certified yet",
   *  a real state distinct from a missing package. */
  certified_node_count?: number;
  certified_output_count?: number;
}

/** Subset of the API's GraphRuleNode the app consumes. */
export interface GraphRuleNode {
  legalId: string;
  name: string;
  fileLegalId: string;
  kind: "derived" | "parameter";
  source: string | null;
  sourceUrl: string | null;
  ruleDeps: string[];
  inputDeps: string[];
}

export interface ProgramGraph {
  rules: GraphRuleNode[];
  ownOutputs: string[];
  terminalOutputs: string[];
}

/**
 * Configured means either a key (hosted API) or an explicit base
 * override (a local axiom-api instance, which runs without auth).
 */
export function isRuntimeApiConfigured(): boolean {
  return Boolean(
    process.env.AXIOM_RUNTIME_API_KEY || process.env.AXIOM_RUNTIME_API_BASE
  );
}

function apiBase(): string {
  return (process.env.AXIOM_RUNTIME_API_BASE ?? DEFAULT_BASE).replace(
    /\/$/,
    ""
  );
}

/**
 * Process-local response cache. Program graphs run 2–3 MB — over the
 * Next.js Data Cache's 2 MB item limit — so `next.revalidate` alone
 * silently refetches them on every render. Fluid Compute reuses
 * instances across requests, so a module-level map recovers the
 * intended ten-minute caching for exactly the payloads the platform
 * cache rejects.
 */
const memoryCache = new Map<string, { at: number; value: unknown }>();
const MEMORY_CACHE_MAX_ENTRIES = 64;

/** Test hook: module-level cache must reset between tests. */
export function _resetRuntimeApiCache() {
  memoryCache.clear();
}

/**
 * Every 2xx payload is a `{ status: "ok", data: … }` envelope;
 * returns the endpoint payload or null on any transport, HTTP, or
 * envelope failure.
 */
async function runtimeGet<T>(path: string): Promise<T | null> {
  if (!isRuntimeApiConfigured()) return null;
  const cached = memoryCache.get(path);
  if (cached && Date.now() - cached.at < REVALIDATE_SECONDS * 1000) {
    return cached.value as T;
  }
  const key = process.env.AXIOM_RUNTIME_API_KEY;
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      headers: key ? { "x-api-key": key } : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as {
      status?: string;
      data?: T;
    };
    if (envelope.status !== "ok" || envelope.data === undefined) return null;
    if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
      const oldest = memoryCache.keys().next().value;
      if (oldest !== undefined) memoryCache.delete(oldest);
    }
    memoryCache.set(path, { at: Date.now(), value: envelope.data });
    return envelope.data;
  } catch {
    return null;
  }
}

/**
 * Raw envelope passthrough for the in-app graph viewer's proxy
 * routes: the browser gets the upstream `{status, data}` envelope
 * verbatim (the viewer client parses it), the key stays server-side.
 */
export async function runtimeProxyGet(
  path: string,
  options: { timeoutMs?: number; fresh?: boolean } = {},
): Promise<{ status: number; body: unknown }> {
  if (!isRuntimeApiConfigured()) {
    return {
      status: 503,
      body: { status: "error", error: { code: "runtime_unconfigured" } },
    };
  }
  const key = process.env.AXIOM_RUNTIME_API_KEY;
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      headers: key ? { "x-api-key": key } : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      ...(options.fresh ? { cache: "no-store" as const } : { next: { revalidate: REVALIDATE_SECONDS } }),
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return {
      status: 502,
      body: { status: "error", error: { code: "upstream_unreachable" } },
    };
  }
}

export async function listRuntimePackages(): Promise<RuntimePackageSummary[]> {
  const data = await runtimeGet<{ packages: RuntimePackageSummary[] }>(
    "/runtime/packages"
  );
  return data?.packages ?? [];
}

export interface RuntimePackageDetail extends RuntimePackageSummary {
  default_period?: string;
  sample_request?: unknown;
  outputs?: Array<{ name: string; legal_id: string; alias_for?: string }>;
  entities?: Array<{
    entity: string;
    inputs?: Array<{ name: string; dtype?: string; default?: unknown }>;
  }>;
  household_aliases?: Record<string, string>;
}

export async function getRuntimePackage(
  jurisdiction: string,
  programId: string
): Promise<RuntimePackageDetail | null> {
  const data = await runtimeGet<{ package: RuntimePackageDetail }>(
    `/runtime/packages/${encodeURIComponent(jurisdiction)}/${encodeURIComponent(
      programId
    )}`
  );
  return data?.package ?? null;
}

export interface CalculateTraceEntry {
  rule_id: string;
  variable: string;
  value: number | string | boolean | null;
  sources: string[];
}

/** The verifier vintage a certified response was computed under. */
export interface CertifiedVintage {
  encoding_release: string;
  engine_release: string;
  corpus_release: string;
}

export interface CalculateProvenance {
  ledger_id: string;
  certified_set_version: string;
  vintage: CertifiedVintage;
  certificates: Array<{
    variable: string;
    legal_id: string;
    certificate_id: string;
    claim: string;
  }>;
}

export interface CalculateResult {
  outputs: Record<string, number | string | boolean | null>;
  trace?: CalculateTraceEntry[];
  /** Present on certified-serving successes: the ledger, vintage and
   *  per-output certificates the computation ran under. */
  provenance?: CalculateProvenance;
}

/**
 * POST /v1/calculate. Uncached — every run executes.
 *
 * Certified serving refuses requests naming uncertified nodes with a
 * 422 `uncertified_node`; callers must distinguish that (a state to
 * present) from a transport failure, so it surfaces as
 * `{ uncertified: true }` instead of null.
 */
export async function runCalculate(
  request: unknown
): Promise<CalculateResult | { uncertified: true } | null> {
  if (!isRuntimeApiConfigured()) return null;
  const key = process.env.AXIOM_RUNTIME_API_KEY;
  try {
    const response = await fetch(`${apiBase()}/calculate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "x-api-key": key } : {}),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(CALCULATE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 422) {
        try {
          const failure = (await response.json()) as {
            error?: { code?: string };
          };
          if (failure.error?.code === "uncertified_node") {
            return { uncertified: true };
          }
        } catch {
          // Unparseable 422 body — fall through to the generic null.
        }
      }
      return null;
    }
    const envelope = (await response.json()) as {
      status?: string;
      data?: CalculateResult;
    };
    if (envelope.status !== "ok" || !envelope.data?.outputs) return null;
    return envelope.data;
  } catch {
    return null;
  }
}

/** Outcome of a run-by-root calculate. `unsupported` is the feature
 *  detector's signal: the upstream API answered 400/404 for the
 *  `{ root }` request shape, i.e. the endpoint isn't deployed yet. */
export type RootCalculateOutcome =
  | { kind: "ok"; result: CalculateResult }
  /** 422: the engine declined this subtree (compile_failed /
   *  closure_incomplete / uncertified_node) — code and the API's own
   *  message carried through for honest display. */
  | { kind: "refused"; code: string; message: string | null }
  | { kind: "unsupported" }
  | { kind: "failed" };

/**
 * POST /v1/calculate with the run-by-root shape: `{ root: <file
 * legal id>, facts, variables }` — same response envelope as the
 * program-coordinates shape. Unlike `runCalculate`, upstream 400/404
 * are surfaced distinctly so callers can feature-detect the endpoint
 * and hide the run affordance instead of erroring.
 */
export async function runCalculateRoot(request: {
  root: string;
  facts: Record<string, number | boolean>;
  /** Additional household members (person_2, …) with their own
   *  Person-level answers; the flat facts remain person_1. Omitted
   *  for single-filer runs so older upstreams see the old shape. */
  people?: Record<string, Record<string, number | boolean>>;
  variables?: string[];
}): Promise<RootCalculateOutcome> {
  if (!isRuntimeApiConfigured()) return { kind: "failed" };
  const key = process.env.AXIOM_RUNTIME_API_KEY;
  try {
    const response = await fetch(`${apiBase()}/calculate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "x-api-key": key } : {}),
      },
      body: JSON.stringify(request.people ? {
        root: request.root,
        facts: request.facts,
        variables: request.variables,
        household: { people: { person_1: {}, ...request.people } },
      } : request),
      signal: AbortSignal.timeout(CALCULATE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 400 || response.status === 404) {
      return { kind: "unsupported" };
    }
    if (!response.ok) {
      if (response.status === 422) {
        try {
          const failure = (await response.json()) as {
            error?: { code?: string; message?: string };
          };
          return {
            kind: "refused",
            code: failure.error?.code ?? "refused",
            message: failure.error?.message ?? null,
          };
        } catch {
          // Unparseable 422 body — still a refusal, just anonymous.
          return { kind: "refused", code: "refused", message: null };
        }
      }
      // A structured engine error (5xx with the API's envelope, e.g.
      // runtime_error "missing input …") is a state to present with the
      // API's own words — hiding the run affordance behind a bare 502
      // buried exactly the message that explains the blocked run.
      try {
        const failure = (await response.json()) as {
          status?: string;
          error?: { code?: string; message?: string };
        };
        if (failure.status === "error" && failure.error?.code) {
          return {
            kind: "refused",
            code: failure.error.code,
            message: failure.error.message ?? null,
          };
        }
      } catch {
        // Not the API's envelope (gateway HTML, truncation) — a real
        // transport failure.
      }
      return { kind: "failed" };
    }
    const envelope = (await response.json()) as {
      status?: string;
      data?: CalculateResult;
    };
    if (envelope.status !== "ok" || !envelope.data?.outputs) {
      return { kind: "failed" };
    }
    return { kind: "ok", result: envelope.data };
  } catch {
    return { kind: "failed" };
  }
}

export interface ParityCaseSummary {
  id: string;
  description: string;
  program_id: string;
  jurisdiction: string;
  /** External oracle engines this case is compared against
   *  (empty = golden expectations only — executable, not verified). */
  oracles: string[];
}

/**
 * Canonical parity cases from the hosted API, reduced to what the
 * app's trust surfaces need. Cached like the registry reads.
 */
export async function listParityCases(): Promise<ParityCaseSummary[]> {
  const data = await runtimeGet<{
    cases: Array<{
      id: string;
      description?: string;
      program_id: string;
      jurisdiction: string;
      external_comparisons?: Array<{ engine?: string }>;
    }>;
  }>("/parity/cases");
  return (data?.cases ?? []).map((item) => ({
    id: item.id,
    description: item.description ?? "",
    program_id: item.program_id,
    jurisdiction: item.jurisdiction,
    oracles: Array.from(
      new Set(
        (item.external_comparisons ?? [])
          .map((comparison) => comparison.engine)
          .filter((engine): engine is string => Boolean(engine))
      )
    ),
  }));
}

export async function getProgramGraph(
  jurisdiction: string,
  programId: string
): Promise<ProgramGraph | null> {
  const data = await runtimeGet<{ graph: ProgramGraph }>(
    `/runtime/packages/${encodeURIComponent(jurisdiction)}/${encodeURIComponent(
      programId
    )}/graph`
  );
  return data?.graph ?? null;
}

export interface CertifiedNodeDetail {
  node: unknown;
  certificate: {
    certificate_id: string;
    claim: string;
    evidence_sha256?: string;
  } | null;
  ledger_id?: string;
  vintage?: CertifiedVintage;
}

/**
 * Node-native certified read: GET /v1/nodes/{legal id}. The path
 * keeps literal slashes but must carry `#` as `%23` — encode per
 * segment, never the whole id. Unknown and uncertified ids are the
 * same 404 upstream (no existence oracle), so both resolve to null.
 */
export async function getCertifiedNode(
  legalId: string
): Promise<CertifiedNodeDetail | null> {
  const path = legalId
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return runtimeGet<CertifiedNodeDetail>(`/nodes/${path}`);
}

/** GET /v1/subgraph: the certified closure of the given roots, in
 *  ProgramGraph shape (`truncated` marks the node ceiling). */
export async function getCertifiedSubgraph(
  roots: string[]
): Promise<{ graph: ProgramGraph; truncated: boolean } | null> {
  if (roots.length === 0) return null;
  return runtimeGet<{ graph: ProgramGraph; truncated: boolean }>(
    `/subgraph?roots=${encodeURIComponent(roots.join(","))}`
  );
}

export interface CertifiedLedgerMeta {
  ledger_id: string;
  certified_set_version: string;
  issued_at?: string;
  vintage?: CertifiedVintage;
  entries: Array<{
    legal_id: string;
    certificate_id: string;
    claim: string;
  }>;
}

/** GET /v1/certified: the serving ledger's identity and entries. */
export async function getCertifiedLedger(): Promise<CertifiedLedgerMeta | null> {
  return runtimeGet<CertifiedLedgerMeta>("/certified");
}
