#!/usr/bin/env bun
/**
 * Backfill encodings.pipeline_events: derive every case's station events
 * from encodings.pipeline_attempts, and load archived validator issues
 * (failure bundles, local A/B runs) as issue events on the same cases.
 *
 * Ids are deterministic (<case>/<station>/<kind>/<seq>), so a re-run upserts
 * and changes nothing that did not change. Rows from pipeline_attempts are
 * rebuilt in full each run; issue rows are only added.
 *
 * Usage:
 *   # Dry run: read with the public anon key, write events to a JSON file.
 *   # The dev server reads it when AXIOM_OPS_EVENTS_FILE points at it.
 *   bun --env-file=.env.production scripts/backfill-pipeline-events.mjs --out /tmp/events.json
 *
 *   # Add archived issues (the handbook's obs.jsonl: one issue per line with
 *   # src, run, citation, attempt?, final?, msg) and failure-bundle expiry
 *   # dates (the archive's index.tsv).
 *   bun --env-file=.env.production scripts/backfill-pipeline-events.mjs --out /tmp/events.json \
 *     --issues ~/axiom-encode-local-ab/2026-10-21-handbook-kb/kb/data/obs.jsonl \
 *     --bundle-index ~/axiom-encode-local-ab/failure-bundles/index.tsv
 *
 *   # Write: upsert into the table (needs the service role key).
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/backfill-pipeline-events.mjs --write [--issues F]
 *
 * Options:
 *   --attempts F   read pipeline_attempts from a collector dry run instead of the table.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { attemptEvents, caseIndex, issueEvents } from "../src/lib/axiom/pipeline-events.ts";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const has = (name) => args.includes(name);

const PAGE = 1000;
const WRITE_BATCH = 500;

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const writing = has("--write");
const key = writing ? process.env.SUPABASE_SERVICE_ROLE_KEY : (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
if (writing && !key) throw new Error("--write needs SUPABASE_SERVICE_ROLE_KEY");
if (!writing && !opt("--out")) throw new Error("pass --out <file> for a dry run, or --write");

async function readAttempts() {
  const file = opt("--attempts");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  if (!url || !key) throw new Error("set SUPABASE_URL and a key, or pass --attempts <file>");
  const db = createClient(url, key, { db: { schema: "encodings" }, auth: { persistSession: false } });
  const rows = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from("pipeline_attempts")
      .select("*")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`pipeline_attempts: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/** index.tsv: artifact id, name, bytes, created, expires, expired, run id. */
function bundleExpiry(file) {
  const byRun = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 7 || !/^\d+$/.test(cols[6])) continue;
    byRun.set(cols[6], cols[4]);
  }
  return byRun;
}

const attempts = await readAttempts();
const events = attempts.flatMap(attemptEvents);
console.error(`pipeline_attempts: ${attempts.length} cases, ${events.length} events`);

const issuesFile = opt("--issues");
if (issuesFile) {
  const observations = readFileSync(issuesFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    // Only issue lists (bundle_final, bundle_try, pa_try, ab_attempt); pa_try
    // repeats the tries[] errors already derived above.
    .filter((o) => o.src !== "pa_try");
  // Issues a case cannot be placed in time take the archive's own date.
  const fallbackAt = statSync(issuesFile).mtime.toISOString();
  const issues = issueEvents(observations, caseIndex(events), fallbackAt);
  const expiry = opt("--bundle-index") ? bundleExpiry(opt("--bundle-index")) : new Map();
  for (const e of issues) {
    const expires = expiry.get(e.case_id);
    if (expires) e.attrs.bundle_expires_at = expires;
  }
  console.error(`issues: ${observations.length} observations, ${issues.length} events`);
  events.push(...issues);
}

const out = opt("--out");
if (out) {
  writeFileSync(out, JSON.stringify(events));
  console.error(`wrote ${events.length} events to ${out}`);
}

if (writing) {
  const db = createClient(url, key, { db: { schema: "encodings" }, auth: { persistSession: false } });
  const collectedAt = new Date().toISOString();
  for (let i = 0; i < events.length; i += WRITE_BATCH) {
    const batch = events.slice(i, i + WRITE_BATCH).map((e) => ({ ...e, collected_at: collectedAt }));
    const { error } = await db.from("pipeline_events").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`pipeline_events upsert at ${i}: ${error.message}`);
  }
  // Events pipeline_attempts no longer implies (a case moved on) are stale:
  // drop this source's rows the pass did not write.
  const { error } = await db
    .from("pipeline_events")
    .delete()
    .eq("source", "pipeline_attempts")
    .lt("collected_at", collectedAt);
  if (error) throw new Error(`pipeline_events prune: ${error.message}`);
  console.error(`upserted ${events.length} events`);
}
