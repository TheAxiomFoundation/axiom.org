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
 *   --waivers      read every RuleSpec repo's known-validation-gaps.yaml (the
 *                  repos the attempts' PRs name) and write one `wait` event per
 *                  waived module, with its expiry, under source waiver_ledger.
 *                  /ops/flow raises a deadline alert from them.
 *   --encoder-prs  read axiom-encode PRs merged since --since (default 2026-07-01)
 *                  and write one `change` event per validator rule a PR names
 *                  (title or body), under source encoder_change. /ops/flow
 *                  compares each rule's rate before and after them. Uses
 *                  GITHUB_TOKEN when set.
 *   --no-programs  skip the program tags. By default every case's events get
 *                  attrs.programs: the programs whose bundles
 *                  (program_bundle_documents, in scope) hold its citation or a
 *                  path above it, or ["out_of_plan"] when none does. The
 *                  accepted-module count splits by them.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { acceptedModules, programIndex, tagPrograms } from "../src/lib/axiom/accepted-modules.ts";
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

/** One event per waived module: its expiry, owner and tracking issue. */
async function waiverEvents(repos, readAt) {
  const events = [];
  for (const repo of repos) {
    const res = await fetch(`https://raw.githubusercontent.com/TheAxiomFoundation/${repo}/main/known-validation-gaps.yaml`, {
      headers: { "User-Agent": "axiom-pipeline-events" },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`read ${repo} known-validation-gaps.yaml: HTTP ${res.status}`);
    const doc = yaml.load(await res.text()) ?? {};
    for (const [ledger, entries] of Object.entries(doc)) {
      if (!entries || typeof entries !== "object") continue;
      for (const [path, entry] of Object.entries(entries)) {
        const active = entry?.active;
        if (!active?.expires) continue;
        const id = `waiver:${repo}/${path}`;
        events.push({
          id: `${id}/tests/wait/0`,
          case_id: id,
          citation: path.replace(/\.ya?ml$/, ""),
          jurisdiction: repo.replace(/^rulespec-/, ""),
          station: "tests",
          kind: "wait",
          at: readAt,
          duration_ms: null,
          outcome: "waived",
          try_no: null,
          rule_id: `waiver:${ledger}`,
          message: null,
          actor: active.owner ?? null,
          cost_usd: null,
          encoder_version: null,
          source: "waiver_ledger",
          ref_url: active.issue ?? null,
          attrs: { expires_at: String(active.expires), repo, ledger },
        });
      }
    }
  }
  return events;
}

if (has("--waivers")) {
  const repos = [...new Set(attempts.map((a) => a.pr_repo).filter(Boolean))].sort();
  const waivers = await waiverEvents(repos, new Date().toISOString());
  console.error(`waivers: ${waivers.length} active entries in ${repos.length} repos`);
  events.push(...waivers);
}

const RULE_TOKEN_RE = /\b([a-z][a-z0-9-]*:[a-z0-9][a-z0-9:-]*[a-z0-9])\b/g;

/** One `change` event per (merged axiom-encode PR, validator rule it names). */
async function encoderChangeEvents(knownRules, since) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "axiom-pipeline-events" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const events = [];
  for (let page = 1; page <= 10; page++) {
    const q = encodeURIComponent(`repo:TheAxiomFoundation/axiom-encode is:pr is:merged merged:>=${since}`);
    const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`search merged axiom-encode PRs: HTTP ${res.status}`);
    const { items } = await res.json();
    for (const pr of items) {
      const text = `${pr.title}\n${pr.body ?? ""}`;
      const rules = new Set([...text.matchAll(RULE_TOKEN_RE)].map((m) => m[1]).filter((r) => knownRules.has(r)));
      const mergedAt = pr.pull_request?.merged_at ?? pr.closed_at;
      for (const rule of rules) {
        const id = `pr:axiom-encode#${pr.number}`;
        events.push({
          id: `${id}/validate/change/${rule}`,
          case_id: id,
          citation: "axiom-encode",
          jurisdiction: null,
          station: "validate",
          kind: "change",
          at: mergedAt,
          duration_ms: null,
          outcome: "merged",
          try_no: null,
          rule_id: rule,
          message: pr.title.slice(0, 500),
          actor: pr.user?.login ?? null,
          cost_usd: null,
          encoder_version: null,
          source: "encoder_change",
          ref_url: pr.html_url,
          attrs: { number: pr.number },
        });
      }
    }
    if (items.length < 100) break;
  }
  return events;
}

if (has("--encoder-prs")) {
  // Rules the pipeline has seen fail, with their own ids (not text: or infra: classes).
  const known = new Set(events.map((e) => e.rule_id).filter((r) => r && !r.startsWith("text:") && !r.startsWith("infra:")));
  const changes = await encoderChangeEvents(known, opt("--since") ?? "2026-07-01");
  console.error(`encoder changes: ${changes.length} (PR, rule) events`);
  events.push(...changes);
}

/** In-scope bundle documents: which program's bundle holds which corpus path. */
async function readBundleMembers() {
  const db = createClient(url, key, { db: { schema: "encodings" }, auth: { persistSession: false } });
  const rows = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from("program_bundle_documents")
      .select("bundle_id,citation_path")
      .eq("scope", "in")
      .order("bundle_id")
      .order("tier")
      .order("key")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`program_bundle_documents: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

if (!has("--no-programs")) {
  if (!url || !key) throw new Error("program tags read program_bundle_documents: set SUPABASE_URL and a key, or pass --no-programs");
  const members = await readBundleMembers();
  tagPrograms(events, programIndex(members));
  const accepted = acceptedModules(events);
  const byRoute = { pipeline: 0, hand: 0 };
  for (const m of accepted) byRoute[m.route]++;
  console.error(
    `programs: ${members.length} bundle documents; ${accepted.length} accepted modules (${byRoute.pipeline} pipeline, ${byRoute.hand} hand)`
  );
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
  const rebuilt = ["pipeline_attempts", ...(has("--waivers") ? ["waiver_ledger"] : []), ...(has("--encoder-prs") ? ["encoder_change"] : [])];
  const { error } = await db
    .from("pipeline_events")
    .delete()
    .in("source", rebuilt)
    .lt("collected_at", collectedAt);
  if (error) throw new Error(`pipeline_events prune: ${error.message}`);
  console.error(`upserted ${events.length} events`);
}
