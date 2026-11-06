/**
 * Pure helpers for the RuleSpec source-conflict registers
 * (known-source-conflicts.yaml at the root of each rulespec-* repo's main):
 * parse and normalize a register into encodings.source_conflicts rows, turn
 * a row into the app's SourceConflict, and match conflicts to citation paths
 * and modules. Shared by scripts/collect-source-conflicts.mjs and
 * src/lib/axiom/source-conflicts.ts; no server or network dependencies.
 */

import yaml from "js-yaml";

export const SOURCE_CONFLICTS_FILE = "known-source-conflicts.yaml";
export const SOURCE_CONFLICTS_ORG = "TheAxiomFoundation";

export interface SourceConflict {
  globalId: string;
  repo: string;
  jurisdiction: string;
  id: string;
  program: string | null;
  status: string;
  question: string;
  reading: string;
  basis: string | null;
  alternatives: { id: string; reading: string; effect?: string | null }[];
  ruling: { by?: string; date?: string; record?: string } | null;
  citationPaths: string[];
  pendingCitations: { citation: string; kind?: string; url?: string }[];
  adoptedBy: { module: string; interpretation: string }[];
  sourceUrl: string;
}

/** One encodings.source_conflicts row, as the collector writes it. */
export interface SourceConflictRow {
  global_id: string;
  repo: string;
  jurisdiction: string;
  entry_id: string;
  program: string | null;
  status: string;
  question: string;
  reading: string;
  basis: string | null;
  alternatives: SourceConflict["alternatives"];
  ruling: SourceConflict["ruling"];
  citation_paths: string[];
  pending_citations: SourceConflict["pendingCitations"];
  adopted_by: SourceConflict["adoptedBy"];
  entry?: Record<string, unknown>;
  source_url: string;
  collected_at?: string;
}

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A scalar as text: YAML may give a year or a date as a number. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function registerUrl(repo: string, branch = "main"): string {
  return `https://github.com/${SOURCE_CONFLICTS_ORG}/${repo}/blob/${branch}/${SOURCE_CONFLICTS_FILE}`;
}

/**
 * Parse one repo's register into rows. Throws on a malformed file (not a
 * mapping, no entries list, an entry without its required fields, or a
 * global id twice), so a broken register fails the collector loudly.
 */
export function parseSourceConflictRegister(
  source: string,
  repo: string,
  collectedAt: string,
  sourceUrl = registerUrl(repo)
): SourceConflictRow[] {
  let doc: unknown;
  try {
    // CORE_SCHEMA: dates stay text, as the register writes them.
    doc = yaml.load(source, { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    throw new Error(`${repo} ${SOURCE_CONFLICTS_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (doc == null) return [];
  if (!isObject(doc)) throw new Error(`${repo} ${SOURCE_CONFLICTS_FILE}: not a mapping`);
  if (doc.entries == null) return [];
  if (!Array.isArray(doc.entries)) throw new Error(`${repo} ${SOURCE_CONFLICTS_FILE}: entries is not a list`);
  const seen = new Set<string>();
  return doc.entries.map((entry, index) => {
    const row = normalizeSourceConflictEntry(entry, repo, collectedAt, sourceUrl, index);
    if (seen.has(row.global_id)) {
      throw new Error(`${repo} ${SOURCE_CONFLICTS_FILE}: entry ${row.global_id} appears twice`);
    }
    seen.add(row.global_id);
    return row;
  });
}

/** One register entry as a row. Throws when a required field is missing. */
export function normalizeSourceConflictEntry(
  entry: unknown,
  repo: string,
  collectedAt: string,
  sourceUrl = registerUrl(repo),
  index = 0
): SourceConflictRow {
  const where = `${repo} ${SOURCE_CONFLICTS_FILE} entry ${index}`;
  if (!isObject(entry)) throw new Error(`${where}: not a mapping`);
  const required = (field: string): string => {
    const value = text(entry[field]);
    if (!value) throw new Error(`${where}${entry.id ? ` (${String(entry.id)})` : ""}: missing ${field}`);
    return value;
  };
  const id = required("id");
  const jurisdiction = required("jurisdiction");
  const status = required("status");
  const question = required("question");
  const reading = required("reading");

  const list = (field: string): unknown[] => {
    const value = entry[field];
    if (value == null) return [];
    if (!Array.isArray(value)) throw new Error(`${where} (${id}): ${field} is not a list`);
    return value;
  };

  const alternatives = list("alternatives").map((alt, i) => {
    if (!isObject(alt) || !text(alt.reading)) throw new Error(`${where} (${id}): alternative ${i} has no reading`);
    return { id: text(alt.id) ?? `alternative-${i + 1}`, reading: text(alt.reading)!, effect: text(alt.effect) };
  });

  const citationPaths = [
    ...new Set(
      list("texts")
        .map((t) => (isObject(t) ? text(t.corpus_citation_path) : null))
        .filter((p): p is string => Boolean(p))
        .map((p) => p.replace(/\/+$/, ""))
    ),
  ];

  const pendingCitations = list("pending_texts").flatMap((t) => {
    if (!isObject(t)) return [];
    const citation = text(t.citation);
    if (!citation) return [];
    const out: { citation: string; kind?: string; url?: string } = { citation };
    const kind = text(t.kind);
    const url = text(t.url);
    if (kind) out.kind = kind;
    if (url) out.url = url;
    return [out];
  });

  const adoptedBy = list("adopted_by").flatMap((a) => {
    const pair = adoptionPair(a);
    return pair ? [pair] : [];
  });

  let ruling: SourceConflictRow["ruling"] = null;
  if (isObject(entry.ruling)) {
    ruling = {};
    for (const key of ["by", "date", "record"] as const) {
      const value = text(entry.ruling[key]);
      if (value) ruling[key] = value;
    }
  }

  return {
    global_id: `${jurisdiction}:${id}`,
    repo,
    jurisdiction,
    entry_id: id,
    program: text(entry.program),
    status,
    question,
    reading,
    basis: text(entry.basis),
    alternatives,
    ruling,
    citation_paths: citationPaths,
    pending_citations: pendingCitations,
    adopted_by: adoptedBy,
    entry,
    source_url: sourceUrl,
    collected_at: collectedAt,
  };
}

/**
 * An adopted_by item, a (module path, interpretation id) pair: a mapping
 * ({module, interpretation}, or module_path / interpretation_id) or a
 * two-item list.
 */
function adoptionPair(value: unknown): { module: string; interpretation: string } | null {
  if (Array.isArray(value)) {
    const [module, interpretation] = value.map(text);
    return module && interpretation ? { module, interpretation } : null;
  }
  if (!isObject(value)) return null;
  const module = text(value.module) ?? text(value.module_path) ?? text(value.path);
  const interpretation = text(value.interpretation) ?? text(value.interpretation_id) ?? text(value.id);
  return module && interpretation ? { module, interpretation } : null;
}

/** A stored row as the app's SourceConflict. */
export function sourceConflictFromRow(row: SourceConflictRow): SourceConflict {
  return {
    globalId: row.global_id,
    repo: row.repo,
    jurisdiction: row.jurisdiction,
    id: row.entry_id,
    program: row.program ?? null,
    status: row.status,
    question: row.question,
    reading: row.reading,
    basis: row.basis ?? null,
    alternatives: row.alternatives ?? [],
    ruling: row.ruling ?? null,
    citationPaths: row.citation_paths ?? [],
    pendingCitations: row.pending_citations ?? [],
    adoptedBy: row.adopted_by ?? [],
    sourceUrl: row.source_url,
  };
}

/** True when one path is the other or lies under it, on "/" boundaries. */
export function citationPathsOverlap(a: string, b: string): boolean {
  const x = a.replace(/\/+$/, "");
  const y = b.replace(/\/+$/, "");
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/**
 * Per requested path, the conflicts that cite that path, a path under it or
 * a path above it. Paths with no conflict are left out.
 */
export function matchConflictsToPaths(
  conflicts: SourceConflict[],
  paths: string[]
): Record<string, SourceConflict[]> {
  const out: Record<string, SourceConflict[]> = {};
  for (const path of new Set(paths)) {
    const matched = conflicts.filter((c) => c.citationPaths.some((p) => citationPathsOverlap(path, p)));
    if (matched.length) out[path] = matched;
  }
  return out;
}

export const MAX_CONFLICT_PATHS = 200;
export const MAX_CONFLICT_PATHS_PARAM = 4000;

const CONFLICT_PATH_RE = /^[a-z]{2}(?:-[a-z0-9-]+)?(?:\/[\w.()–-]+)*$/i;

/**
 * The citation paths in a `paths=a,b,c` query value (trimmed, each once), or
 * null when it is empty, too long, holds too many paths or a path that is
 * not a citation path.
 */
export function parseConflictPathsParam(value: string | null): string[] | null {
  if (!value || value.length > MAX_CONFLICT_PATHS_PARAM) return null;
  const paths = [...new Set(value.split(",").map((p) => p.trim().replace(/\/+$/, "")).filter(Boolean))];
  if (!paths.length || paths.length > MAX_CONFLICT_PATHS) return null;
  const valid = paths.every(
    (path) => CONFLICT_PATH_RE.test(path) && path.split("/").every((part) => part !== "." && part !== "..")
  );
  return valid ? paths : null;
}

const modulePathKey = (path: string) => path.trim().replace(/\.ya?ml$/, "");

/** Per requested module path, the conflicts a module adopts (adopted_by). */
export function matchConflictsToModules(
  conflicts: SourceConflict[],
  modulePaths: string[]
): Record<string, SourceConflict[]> {
  const out: Record<string, SourceConflict[]> = {};
  for (const path of new Set(modulePaths)) {
    const key = modulePathKey(path);
    const matched = conflicts.filter((c) => c.adoptedBy.some((a) => modulePathKey(a.module) === key));
    if (matched.length) out[path] = matched;
  }
  return out;
}
