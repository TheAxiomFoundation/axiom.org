import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";
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

// Friendly country labels. Any jurisdiction whose prefix is missing here falls
// back to the upper-cased prefix, so a new country still renders — the map is
// cosmetic, never a gate.
const COUNTRY_LABELS: Record<string, string> = {
  us: "United States",
  uk: "United Kingdom",
  nz: "New Zealand",
  be: "Belgium",
  ca: "Canada",
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
  const response = await fetch(`${trimSlash(API_BASE)}/runtime/packages`);
  if (!response.ok) {
    throw new Error(`packages request failed (${response.status}): ${await response.text()}`);
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`graph request failed (${response.status}): ${await response.text()}`);
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
            inputs?: Array<{ name: string; dtype?: string; default?: unknown }>;
          }>;
        };
      };
    };
    const dtypes: Record<string, string> = {};
    const defaults: Record<string, unknown> = {};
    for (const entity of json.data?.package?.entities ?? []) {
      for (const input of entity.inputs ?? []) {
        dtypes[input.name] = input.dtype ?? "number";
        defaults[input.name] = input.default;
      }
    }
    return { dtypes, defaults };
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`compose request failed (${response.status}): ${await response.text()}`);
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
  /** Closed value domain (table keys or the equality-literal set the
   *  statute distinguishes), when the artifact defines one. */
  values?: Array<number | string>;
}

// Input catalog for a compose-on-demand subtree: dtypes and screening
// defaults the runtime inferred from the compiled artifact. The run
// panel types its controls from this; callers fall back to name-shape
// heuristics when the subtree doesn't compile.
export async function fetchRootInputs(root: string): Promise<RootInputSlot[]> {
  const url = `${trimSlash(API_BASE)}/runtime/root-inputs?root=${encodeURIComponent(root)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`root-inputs request failed (${response.status})`);
  }
  const json = (await response.json()) as {
    data?: { inputs?: RootInputSlot[] };
  };
  return json.data?.inputs ?? [];
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

function humanizeProgram(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (DISPLAY_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
