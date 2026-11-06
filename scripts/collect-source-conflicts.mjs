#!/usr/bin/env bun
/**
 * Collect the RuleSpec source-conflict registers into
 * encodings.source_conflicts: every rulespec-* repo's
 * known-source-conflicts.yaml on main (places where a jurisdiction's sources
 * disagree, the readings each side supports and the reading adopted), one
 * row per entry keyed by its global id "<jurisdiction>:<id>". Each pass
 * replaces the table's rows. A repo without the file contributes nothing; a
 * malformed file fails the pass.
 *
 * Usage:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   GITHUB_TOKEN=... \
 *   bun scripts/collect-source-conflicts.mjs
 *
 *   # Dry run: no database access; write the rows to a file. The dev server
 *   # reads the file when AXIOM_SOURCE_CONFLICTS_FILE points at it.
 *   bun scripts/collect-source-conflicts.mjs --out /tmp/source-conflicts.json
 *
 * Before the migration (20261106120000_source_conflicts.sql) is applied, a
 * write pass logs a warning and exits 0, so the collector workflow goes on.
 */

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  SOURCE_CONFLICTS_FILE,
  parseSourceConflictRegister,
  registerUrl,
} from "../src/lib/axiom/source-conflicts-normalize.ts";
import { GITHUB_ORG, githubJson } from "./lib/rulespec-discovery.mjs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (outIndex >= 0 && !outPath) throw new Error("--out needs a file path");
const dryRun = Boolean(outPath);

/** The org's rulespec-* repos that are not archived, with their default branch. */
async function listRulespecRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await githubJson(
      `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&type=all&page=${page}`
    );
    for (const repo of batch) {
      if (repo.name.startsWith("rulespec-") && !repo.archived) {
        repos.push({ name: repo.name, branch: repo.default_branch || "main" });
      }
    }
    if (batch.length < 100) break;
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

/** One repo's register text, or null when the repo has none. */
async function readRegister(repo, branch) {
  const res = await fetch(
    `https://raw.githubusercontent.com/${GITHUB_ORG}/${repo}/${branch}/${SOURCE_CONFLICTS_FILE}`,
    {
      headers: {
        "User-Agent": "axiom-source-conflicts",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${repo} ${SOURCE_CONFLICTS_FILE}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const collectedAt = new Date().toISOString();
  const repos = await listRulespecRepos();
  const rows = [];
  const counts = {};
  const seen = new Map();
  for (const { name, branch } of repos) {
    const source = await readRegister(name, branch);
    if (source == null) continue;
    const entries = parseSourceConflictRegister(source, name, collectedAt, registerUrl(name, branch));
    for (const row of entries) {
      if (seen.has(row.global_id)) {
        throw new Error(`${row.global_id} is in both ${seen.get(row.global_id)} and ${name}`);
      }
      seen.set(row.global_id, name);
    }
    counts[name] = entries.length;
    rows.push(...entries);
  }
  console.log(
    `${repos.length} rulespec repos, ${Object.keys(counts).length} with a register, ${rows.length} entries`
  );
  for (const [repo, count] of Object.entries(counts)) console.log(`  ${repo}: ${count}`);

  if (dryRun) {
    writeFileSync(outPath, JSON.stringify({ collected_at: collectedAt, counts, rows }, null, 2));
    console.log(`wrote ${outPath}`);
    return;
  }
  await write(rows, collectedAt);
}

async function write(rows, collectedAt) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    db: { schema: "encodings" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Before the migration: report, write nothing, and let the workflow go on.
  const { error: missing } = await supabase.from("source_conflicts").select("global_id").limit(1);
  if (missing) {
    console.warn(
      `::warning::encodings.source_conflicts not readable (${missing.message}); apply the migration to store the registers`
    );
    return;
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("source_conflicts")
      .upsert(rows.slice(i, i + 200), { onConflict: "global_id" });
    if (error) throw new Error(`upsert source_conflicts: ${error.message}`);
  }
  // Entries a register dropped since the last pass.
  const { error } = await supabase.from("source_conflicts").delete().lt("collected_at", collectedAt);
  if (error) throw new Error(`prune source_conflicts: ${error.message}`);
  console.log(`wrote ${rows.length} source conflicts`);
}

await main();
