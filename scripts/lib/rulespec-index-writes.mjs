import { budgetedChunks } from "./budgeted-chunks.mjs";

/** Backoff between attempts of one Supabase write: five tries in all. */
export const WRITE_RETRY_DELAYS_MS = [2_000, 8_000, 20_000, 45_000];

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run one Supabase write with bounded retries. A six-hourly crawl makes
 * thousands of REST calls; transient gateway failures (HTML error pages,
 * dropped connections) surface as one-off errors and have killed full
 * runs at arbitrary chunks. Retry every failure a few times with
 * backoff, and resolve to the successful response (its `count` included).
 * A persisting error rejects, so the run still fails closed.
 */
export async function writeWithRetries(
  label,
  run,
  { delaysMs = WRITE_RETRY_DELAYS_MS, sleep = sleepFor, log = console } = {},
) {
  for (let attempt = 0; ; attempt++) {
    const response = await run();
    if (!response?.error) return response;
    const summary = String(response.error.message ?? response.error).slice(0, 200);
    if (attempt >= delaysMs.length) {
      throw new Error(`${label} failed after ${attempt + 1} attempts: ${summary}`);
    }
    log.warn(`${label} attempt ${attempt + 1} failed (${summary}); retrying`);
    await sleep(delaysMs[attempt]);
  }
}

/**
 * Replace each synced module's materialized rules: delete a batch of
 * modules' rows, then upsert their current rows in payload-budgeted
 * chunks. Batching the module predicates keeps requests bounded while
 * modules that now cite nothing also lose their old rows. Resolves to
 * the number of rows upserted.
 */
export async function replaceRuleCitations(
  supabase,
  indexedFiles,
  {
    write = writeWithRetries,
    moduleChunkSize,
    rowChunkSize,
    chunkBudgetBytes,
  },
) {
  let upserted = 0;
  for (let i = 0; i < indexedFiles.length; i += moduleChunkSize) {
    const moduleChunk = indexedFiles.slice(i, i + moduleChunkSize);
    const moduleCitationPaths = moduleChunk.map(
      ({ fileRow }) => fileRow.citation_path,
    );
    await write(`rule citation reset at module chunk ${i}`, () =>
      supabase
        .from("rule_citations")
        .delete()
        .in("module_citation_path", moduleCitationPaths),
    );
    const citationRows = moduleChunk.flatMap(
      ({ ruleCitationRows }) => ruleCitationRows,
    );
    for (const chunk of budgetedChunks(citationRows, rowChunkSize, chunkBudgetBytes)) {
      await write(
        `rule citation upsert at module chunk ${i}, row ${upserted}`,
        () =>
          supabase.from("rule_citations").upsert(chunk, {
            onConflict: "citation_path,module_citation_path,rule_name",
          }),
      );
      upserted += chunk.length;
    }
  }
  return upserted;
}

/**
 * After a complete run, delete the rows it did not touch: they no longer
 * exist upstream. Both deletes retry like every other write, so one
 * transient gateway error no longer fails a run that synced everything.
 * Resolves to the two removed-row counts.
 */
export async function removeStaleRows(
  supabase,
  startedAt,
  { write = writeWithRetries } = {},
) {
  const files = await write("stale-row cleanup", () =>
    supabase
      .from("rulespec_files")
      .delete({ count: "exact" })
      .lt("synced_at", startedAt),
  );
  const citations = await write("stale rule citation cleanup", () =>
    supabase
      .from("rule_citations")
      .delete({ count: "exact" })
      .lt("synced_at", startedAt),
  );
  return { files: files?.count ?? 0, ruleCitations: citations?.count ?? 0 };
}
