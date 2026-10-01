import { readFile } from "node:fs/promises";
import {
  getSupabaseRestConfig,
  readSupabaseRows,
} from "@/lib/corpus-status";
import type { PipelineAttempt } from "./encoding-pipeline";

const PAGE_SIZE = 1000;
/** Enough pages for every dispatch since the targeted workflow began, many times over. */
const MAX_PAGES = 50;

export interface PipelineAttemptsResult {
  attempts: PipelineAttempt[];
  /** False when the table is not there yet (migration not applied). */
  available: boolean;
  error: string | null;
}

/**
 * Every row of encodings.pipeline_attempts, newest dispatch first.
 *
 * In development, AXIOM_OPS_PIPELINE_FILE may point at a collector dry run
 * (`bun scripts/collect-encoding-pipeline.mjs --out <file>`), so the view
 * can be built before the table exists.
 */
export async function getPipelineAttempts(): Promise<PipelineAttemptsResult> {
  const file = process.env.AXIOM_OPS_PIPELINE_FILE;
  if (file && process.env.NODE_ENV === "development") {
    try {
      const attempts = JSON.parse(await readFile(file, "utf8")) as PipelineAttempt[];
      return { attempts, available: true, error: null };
    } catch (error) {
      return { attempts: [], available: false, error: message(error) };
    }
  }

  const config = getSupabaseRestConfig();
  if (!config) return { attempts: [], available: false, error: null };
  const attempts: PipelineAttempt[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      // Uncached: pages cached one by one can come from different collector
      // passes (one stale, one fresh) and split a citation's history.
      const rows = await readSupabaseRows<PipelineAttempt>(
        config,
        "encodings",
        "pipeline_attempts",
        {
          select: "*",
          order: "dispatched_at.desc,id.desc",
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        },
        { fresh: true }
      );
      attempts.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return { attempts, available: true, error: null };
  } catch (error) {
    const text = message(error);
    // PostgREST answers 404 for a table it does not know.
    if (/returned 404/.test(text)) return { attempts: [], available: false, error: null };
    return { attempts: [], available: false, error: text };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
