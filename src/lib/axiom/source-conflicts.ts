/**
 * Server only: the RuleSpec source-conflict registers, read from
 * encodings.source_conflicts (scripts/collect-source-conflicts.mjs writes it).
 * The table is small, so a read takes every row once (cached for five
 * minutes) and matches in memory.
 *
 * When the table is missing or unreadable, every lookup returns {} and logs
 * once, so pages render the same without it.
 *
 * In development, AXIOM_SOURCE_CONFLICTS_FILE may point at a collector dry
 * run (`bun scripts/collect-source-conflicts.mjs --out <file>`), which is
 * read instead of the table.
 */

import { readFile } from "node:fs/promises";
import { unstable_cache } from "next/cache";
import { getSupabaseRestConfig, readSupabaseRows } from "@/lib/corpus-status";
import {
  matchConflictsToModules,
  matchConflictsToPaths,
  sourceConflictFromRow,
  type SourceConflict,
  type SourceConflictRow,
} from "./source-conflicts-normalize";

export type { SourceConflict } from "./source-conflicts-normalize";

const REVALIDATE_SECONDS = 300;
const MAX_ROWS = 5000;
const COLUMNS = [
  "global_id",
  "repo",
  "jurisdiction",
  "entry_id",
  "program",
  "status",
  "question",
  "reading",
  "basis",
  "alternatives",
  "ruling",
  "citation_paths",
  "pending_citations",
  "adopted_by",
  "source_url",
].join(",");

type Loaded = { conflicts: SourceConflict[] | null; error: string | null };

async function readTable(): Promise<Loaded> {
  const config = getSupabaseRestConfig();
  if (!config) return { conflicts: null, error: "Supabase is not configured" };
  try {
    const rows = await readSupabaseRows<SourceConflictRow>(
      config,
      "encodings",
      "source_conflicts",
      { select: COLUMNS, order: "global_id.asc", limit: String(MAX_ROWS) },
      { fresh: true }
    );
    return { conflicts: rows.map(sourceConflictFromRow), error: null };
  } catch (error) {
    // Cached too, so a missing table is not asked for on every request.
    return { conflicts: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const cachedTable = unstable_cache(readTable, ["source-conflicts-v1"], { revalidate: REVALIDATE_SECONDS });

async function readFileOverride(file: string): Promise<Loaded> {
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as { rows?: SourceConflictRow[] };
    return { conflicts: (data.rows ?? []).map(sourceConflictFromRow), error: null };
  } catch (error) {
    return { conflicts: null, error: error instanceof Error ? error.message : String(error) };
  }
}

let warned = false;

/** Every conflict, or null when none can be read (logged once). */
async function loadConflicts(): Promise<SourceConflict[] | null> {
  const file = process.env.AXIOM_SOURCE_CONFLICTS_FILE;
  let loaded: Loaded;
  try {
    loaded = file && process.env.NODE_ENV === "development" ? await readFileOverride(file) : await cachedTable();
  } catch (error) {
    loaded = { conflicts: null, error: error instanceof Error ? error.message : String(error) };
  }
  if (loaded.conflicts) return loaded.conflicts;
  if (!warned) {
    warned = true;
    console.warn(`source conflicts unavailable: ${loaded.error}`);
  }
  return null;
}

/**
 * Per requested citation path, the conflicts that cite that path, a path
 * under it or a path above it (on "/" boundaries). Paths with no conflict
 * are left out; {} when the conflicts cannot be read.
 */
export async function conflictsForCitationPaths(paths: string[]): Promise<Record<string, SourceConflict[]>> {
  if (!paths.length) return {};
  const conflicts = await loadConflicts();
  return conflicts ? matchConflictsToPaths(conflicts, paths) : {};
}

/**
 * Per requested RuleSpec module path, the conflicts the module adopts (the
 * register's adopted_by). Modules with none are left out; {} when the
 * conflicts cannot be read.
 */
export async function conflictsForModules(modulePaths: string[]): Promise<Record<string, SourceConflict[]>> {
  if (!modulePaths.length) return {};
  const conflicts = await loadConflicts();
  return conflicts ? matchConflictsToModules(conflicts, modulePaths) : {};
}
