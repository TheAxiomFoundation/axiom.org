import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";
import type { RelationDecl } from "@/lib/axiom/runtime/relation-roles";
import type {
  Country,
  LegalId,
  ProgramGraph,
  ProgramRef,
  ProgramSummary,
} from "./types";

// All API traffic goes through a same-origin proxy (Vite dev-server proxy
// locally, a Vercel function in production) that injects the Axiom API key
// server-side. The browser never sees the key and there is no cross-origin
// request, so no CORS dependency. Override the proxy base only for testing.
export const API_BASE = "/api/axiom";

/** Why a request to the API failed, as the visitor needs to know it:
 *  "unavailable" is on our side and passes (a 5xx such as 503
 *  `mirror_unavailable`, a rate limit, a network error, a timeout);
 *  "not_found" is a real absence; "client" is a request the API refused. */
export type ApiFailureKind = "unavailable" | "not_found" | "client";

export const UNAVAILABLE_MESSAGE =
  "The rules service is not reachable right now. This is on our side. Please try again in a few minutes.";
export const MIRROR_UNAVAILABLE_MESSAGE =
  "The rules database is not reachable right now. This is on our side. Please try again in a few minutes.";

/** A failed API request. `message` is always a sentence written for the
 *  visitor: it never carries a response body. `status`, `code` and
 *  `requestId` are for support (a details line, the console). */
export class ApiRequestError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  constructor(
    kind: ApiFailureKind,
    message: string,
    detail: { status?: number | null; code?: string | null; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.kind = kind;
    this.status = detail.status ?? null;
    this.code = detail.code ?? null;
    this.requestId = detail.requestId ?? null;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

/** fetch that turns a network failure or a timeout into an "unavailable"
 *  ApiRequestError, so a caller never sees a raw TypeError. */
async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    // A DOMException is not always an Error instance; read the name directly.
    const name = String((error as { name?: unknown } | null)?.name ?? "");
    throw new ApiRequestError("unavailable", UNAVAILABLE_MESSAGE, {
      code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error",
    });
  }
}

/** The typed failure for a non-2xx response. Reads the error envelope for
 *  the code and request id only; the body itself is never shown. */
async function failureFrom(
  response: Response,
  messages: { notFound: string; client: string },
): Promise<ApiRequestError> {
  const json = (await response.json().catch(() => null)) as {
    error?: { code?: unknown };
    meta?: { request_id?: unknown };
  } | null;
  const code = typeof json?.error?.code === "string" ? json.error.code : null;
  const requestId =
    typeof json?.meta?.request_id === "string"
      ? json.meta.request_id
      : response.headers.get("x-request-id");
  const detail = { status: response.status, code, requestId };
  if (response.status === 404) return new ApiRequestError("not_found", messages.notFound, detail);
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    return new ApiRequestError(
      "unavailable",
      code === "mirror_unavailable" ? MIRROR_UNAVAILABLE_MESSAGE : UNAVAILABLE_MESSAGE,
      detail,
    );
  }
  return new ApiRequestError("client", messages.client, detail);
}

/** What the viewer shows for a failed load: a sentence for the visitor
 *  and a short reference for support. */
export interface LoadFailure {
  kind: ApiFailureKind | "unknown";
  message: string;
  /** For example "HTTP 503 · mirror_unavailable · request 4f0c…". */
  reference: string | null;
}

export function toLoadFailure(error: unknown): LoadFailure {
  if (error instanceof ApiRequestError) {
    const parts = [
      error.status != null ? `HTTP ${error.status}` : null,
      error.code,
      error.requestId ? `request ${error.requestId}` : null,
    ].filter(Boolean);
    return {
      kind: error.kind,
      message: error.message,
      reference: parts.length ? parts.join(" · ") : null,
    };
  }
  // Anything else is a defect in the response or the viewer. The visitor
  // gets a plain sentence; the real error stays in the console.
  return {
    kind: "unknown",
    message: "This could not be shown. Please try again.",
    reference: null,
  };
}

// Friendly country labels. Any jurisdiction whose prefix is missing here falls
// back to the upper-cased prefix, so a new country still renders — the map is
// cosmetic, never a gate.
const COUNTRY_LABELS: Record<string, string> = {
  us: "United States",
  uk: "United Kingdom",
  nz: "New Zealand",
  be: "Belgium",
  ca: "Canada",
  il: "Israel",
};

interface ApiPackage {
  program_id: string;
  jurisdiction: string;
  runtime_id: string;
  mode: string;
  status: string;
  default_outputs: string[];
  output_count?: number;
  entity_count?: number;
  input_count?: number;
  certified_node_count?: number;
  certified_output_count?: number;
}

export function countryOf(jurisdiction: string): Country {
  return jurisdiction.split("-")[0] ?? jurisdiction;
}

export function countryLabel(country: Country): string {
  return COUNTRY_LABELS[country] ?? country.toUpperCase();
}

export function countryShortLabel(country: Country): string {
  return country.toUpperCase();
}

export async function fetchAllPrograms(): Promise<ProgramSummary[]> {
  const response = await apiFetch(`${trimSlash(API_BASE)}/runtime/packages`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw await failureFrom(response, {
      notFound: "The list of programs is not available.",
      client: "The list of programs could not be loaded.",
    });
  }
  const json = (await response.json()) as { data?: { packages?: ApiPackage[] } };
  const packages = json.data?.packages ?? [];
  return packages
    .filter((pkg) => pkg.status === "ready")
    .map(toProgramSummary)
    .sort((a, b) => displayNameForProgram(a).localeCompare(displayNameForProgram(b)));
}

export function countriesFromPrograms(programs: ProgramSummary[]): Country[] {
  const seen = new Set<Country>();
  for (const program of programs) seen.add(countryOf(program.jurisdiction));
  return [...seen].sort();
}

export async function fetchProgramGraph(program: ProgramRef): Promise<ProgramGraph> {
  const url = `${trimSlash(API_BASE)}/runtime/packages/${encodeURIComponent(
    program.jurisdiction,
  )}/${encodeURIComponent(program.programId)}/graph`;
  const response = await apiFetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw await failureFrom(response, {
      notFound: "This program's graph is not available.",
      client: "This program's graph could not be loaded.",
    });
  }
  const json = (await response.json()) as { data?: { graph?: ProgramGraph } };
  if (!json.data?.graph) {
    throw new Error("graph response missing data.graph");
  }
  return json.data.graph;
}

/** The runtime's input registry for a package: every settable input
 *  with its dtype and default, straight from the engine. */
export interface InputMeta {
  dtypes: Record<string, string>;
  defaults: Record<string, unknown>;
  options?: Record<string, number[]>;
  optionLabels?: Record<string, Record<number, string>>;
}
export async function fetchInputMeta(program: ProgramRef): Promise<InputMeta> {
  const url = `${trimSlash(API_BASE)}/runtime/packages/${encodeURIComponent(
    program.jurisdiction,
  )}/${encodeURIComponent(program.programId)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return { dtypes: {}, defaults: {} };
    const json = (await response.json()) as {
      data?: {
        package?: {
          entities?: Array<{
            entity: string;
            inputs?: Array<{ name: string; dtype?: string; default?: unknown; choices?: Array<{ value: number; label: string }> }>;
          }>;
        };
      };
    };
    const dtypes: Record<string, string> = {};
    const defaults: Record<string, unknown> = {};
    const options: Record<string, number[]> = {};
    const optionLabels: Record<string, Record<number, string>> = {};
    for (const entity of json.data?.package?.entities ?? []) {
      for (const input of entity.inputs ?? []) {
        dtypes[input.name] = input.dtype ?? "number";
        defaults[input.name] = input.default;
        if (input.choices?.length) {
          options[input.name] = input.choices.map(choice => choice.value);
          optionLabels[input.name] = Object.fromEntries(input.choices.map(choice => [choice.value, choice.label]));
        }
      }
    }
    return { dtypes, defaults, options, optionLabels };
  } catch {
    return { dtypes: {}, defaults: {} };
  }
}

export interface ComposedGraph {
  graph: ProgramGraph;
  files: LegalId[];
  truncated: boolean;
}

// Compose-on-demand graph for any encoded rule or file (no compiled
// package required). `focus` is a file or rule legal id, e.g.
// "us:regulations/47-cfr/54/403" or "…#basic_lifeline_support_amount".
export async function fetchComposedGraph(focus: string): Promise<ComposedGraph> {
  // `v` versions the browser cache: bump when the graph SHAPE changes
  // (relation kinds, v2) so stale cached graphs can't poison runs.
  const url = `${trimSlash(API_BASE)}/graph/compose?focus=${encodeURIComponent(focus)}&v=2`;
  const response = await apiFetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw await failureFrom(response, {
      notFound: "This encoding is not available in the graph viewer yet.",
      client: "This rule graph could not be loaded.",
    });
  }
  const json = (await response.json()) as {
    data?: { graph?: ProgramGraph; files?: LegalId[]; truncated?: boolean };
  };
  if (!json.data?.graph) {
    throw new Error("compose response missing data.graph");
  }
  return {
    graph: json.data.graph,
    files: json.data.files ?? [],
    truncated: json.data.truncated ?? false,
  };
}

export interface RootInputSlot {
  name: string;
  dtype: string;
  default: string | number | boolean;
  entity: string;
  category?: string;
  order?: number;
  label?: string;
  /** Explicit complete enum declaration, including display labels. */
  choices?: Array<{ value: number; label: string }>;
  /** Legacy inferred suggestions; not a complete enum declaration. */
  values?: Array<number | string>;
}

// Input catalog for a compose-on-demand subtree: dtypes and screening
// defaults the runtime inferred from the compiled artifact. The run
// panel types its controls from this. A successful catalog establishes
// compile readiness, not household/scenario correctness.
export interface RootCatalog {
  inputs: RootInputSlot[];
  /** Source-declared data relations in the closure. */
  relations: RelationDecl[];
  /** "explicit": the scenario must state each person's relation roles;
   *  "convention": every person joins the scope's (at most one) relation. */
  relationMembership: "explicit" | "convention";
}

export async function fetchRootInputs(root: string): Promise<RootInputSlot[]> {
  return (await fetchRootCatalog(root)).inputs;
}

export async function fetchRootCatalog(root: string): Promise<RootCatalog> {
  const url = `${trimSlash(API_BASE)}/runtime/root-inputs?root=${encodeURIComponent(root)}`;
  const response = await apiFetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const json = await response.json().catch(() => null) as {
    data?: { inputs?: RootInputSlot[]; relations?: RelationDecl[]; relation_membership?: string };
    error?: { code?: string; message?: string };
    meta?: { request_id?: string };
  } | null;
  // An outage is not a verdict on the source: it gets the calm sentence and
  // the "unavailable" kind, never the server's text.
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    throw new ApiRequestError(
      "unavailable",
      json?.error?.code === "mirror_unavailable" ? MIRROR_UNAVAILABLE_MESSAGE : UNAVAILABLE_MESSAGE,
      {
        status: response.status,
        code: typeof json?.error?.code === "string" ? json.error.code : null,
        requestId: typeof json?.meta?.request_id === "string" ? json.meta.request_id : null,
      },
    );
  }
  if (!response.ok) {
    const reason = json?.error;
    const fallback: Record<string, string> = {
      invalid_root: "This source identifier is not supported by the runtime.",
      root_not_found: "This source is not available in the runtime's serving catalog.",
      composition_root: "This source assembles a program and cannot run as an individual provision.",
      composition_in_closure: "This source depends on a program assembly that cannot run as an individual provision.",
      relationships_unsupported: "This source relates people to units in a way a scenario cannot represent yet.",
    };
    const error = new Error(
      (typeof reason?.message === "string" && reason.message.trim()) ||
      fallback[reason?.code ?? ""] ||
      `The runtime could not check this source (${response.status}). Try again later.`,
    );
    if (response.status === 422) error.name = "RunUnavailableError";
    throw error;
  }
  if (!Array.isArray(json?.data?.inputs)) {
    throw new Error("The runtime returned an incomplete input catalog. Try again later.");
  }
  const relations = Array.isArray(json.data.relations) ? json.data.relations : [];
  const relationMembership = json.data.relation_membership === "explicit" ? "explicit" : "convention";
  if (relationMembership === "explicit" && relations.length === 0) {
    throw new Error("The runtime returned an incomplete relationship catalog. Try again later.");
  }
  return { inputs: json.data.inputs, relations, relationMembership };
}

export function displayNameForProgram(program: ProgramSummary | ProgramRef): string {
  if ("displayName" in program && program.displayName) return program.displayName;
  return `${jurisdictionLabel(program.jurisdiction)} ${programLabel(program.programId, program.jurisdiction)}`;
}

export function summaryForProgram(programs: ProgramSummary[], program: ProgramRef): string {
  const match = programs.find(
    (item) => item.jurisdiction === program.jurisdiction && item.programId === program.programId,
  );
  if (!match) return displayNameForProgram(program);
  const parts: string[] = [];
  if (match.outputCount != null) parts.push(`${match.outputCount} outputs`);
  if (match.inputCount != null) parts.push(`${match.inputCount} inputs`);
  if (match.entityCount != null) parts.push(`${match.entityCount} entities`);
  return parts.length ? parts.join(" · ") : displayNameForProgram(program);
}

export function programRefFromSummary(program: ProgramSummary): ProgramRef {
  return {
    jurisdiction: program.jurisdiction,
    programId: program.programId,
    displayName: displayNameForProgram(program),
  };
}

export function programKey(program: ProgramSummary | ProgramRef): string {
  return `${program.jurisdiction}/${program.programId}`;
}

// Outputs to pre-select for a program. The server resolves each package's
// declared default outputs (aliases included) into graph legal ids and returns
// them as ownOutputs, so trust those; only when a package declares none do we
// fall back to graph inference.
export function defaultOutputsForProgram(graph: ProgramGraph): LegalId[] {
  const ruleIds = new Set(graph.rules.map((rule) => rule.legalId));
  const own = graph.ownOutputs.filter((id) => ruleIds.has(id));
  if (own.length > 0) return own;
  return graph.terminalOutputs.slice(0, 3);
}

function toProgramSummary(pkg: ApiPackage): ProgramSummary {
  return {
    jurisdiction: pkg.jurisdiction,
    programId: pkg.program_id,
    runtimeId: pkg.runtime_id,
    mode: pkg.mode,
    status: pkg.status,
    defaultOutputs: pkg.default_outputs ?? [],
    outputCount: pkg.output_count,
    entityCount: pkg.entity_count,
    inputCount: pkg.input_count,
    certifiedNodeCount: pkg.certified_node_count,
    certifiedOutputCount: pkg.certified_output_count,
  };
}

const US_STATE_NAMES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
  co: "Colorado", ct: "Connecticut", de: "Delaware", dc: "DC", fl: "Florida",
  ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana",
  ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine",
  md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska",
  nv: "Nevada", nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico",
  ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio",
  ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island",
  sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas",
  ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington",
  wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};

function jurisdictionLabel(jurisdiction: string): string {
  const [country, region] = jurisdiction.split("-", 2);
  if (country === "us" && region) return US_STATE_NAMES[region] ?? jurisdiction.toUpperCase();
  return jurisdiction.toUpperCase();
}

// Spelled-out names for known program ids. Cosmetic only — an id missing
// here still renders via humanizeProgram, so new programs never need a
// viewer change to appear.
const PROGRAM_LABELS: Record<string, string> = {
  snap: "SNAP",
  tanf: "TANF",
  tca: "Temporary Cash Assistance",
  fiit: "Federal Income Tax",
  scretd: "Senior Citizens Real Estate Tax Deferral",
  "income-tax": "Income Tax",
  "oasdi-wage-tax": "OASDI Wage Tax",
  "universal-credit": "Universal Credit",
  "medicaid-magi": "Medicaid MAGI",
  ssi: "SSI",
};

// The program pre-selected on first load, when present in the registry.
export const PREFERRED_DEFAULT_PROGRAM_KEY = "us-co/co-snap";

// Turn a program id into a readable label, dropping a leading jurisdiction
// segment when it just repeats the state (e.g. "co-snap" under "us-co").
function programLabel(programId: string, jurisdiction: string): string {
  const stateCode = jurisdiction.split("-")[1];
  let base = programId;
  if (stateCode && base.startsWith(`${stateCode}-`)) {
    base = base.slice(stateCode.length + 1);
  }
  return PROGRAM_LABELS[base] ?? humanizeProgram(base);
}

export function humanizeProgram(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (DISPLAY_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
