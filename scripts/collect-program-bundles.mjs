#!/usr/bin/env bun
/**
 * Measure every program bundle: for each document of each delivery tier
 * (axiom-corpus manifests/program-bundles/*.yaml), whether the corpus serves
 * it, how many of its provisions a RuleSpec rule cites, which of the
 * provisions PolicyEngine cites are covered, and its newest encode run. The
 * /ops/bundles pages read only the tables this writes.
 *
 * Usage:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   GITHUB_TOKEN=... \
 *   bun scripts/collect-program-bundles.mjs
 *
 *   # Dry run: read with the public anon key and write the rows to a file.
 *   # The dev server reads the file when AXIOM_OPS_BUNDLES_FILE points at it.
 *   bun scripts/collect-program-bundles.mjs --out /tmp/bundles.json
 *
 * Options:
 *   --bundle F   measure a local bundle file instead of the ones on
 *                axiom-corpus main (repeatable), e.g. a draft under review.
 *
 * Tables: encodings.program_bundles (one row per bundle: its header and tier
 * definitions), encodings.program_bundle_documents (one row per document and
 * tier, replaced each pass) and encodings.program_bundle_snapshots (each
 * tier's counts once a day, for progress over time).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { measureDocument, moduleSources, tierCounts } from "../src/lib/axiom/program-bundles.ts";

const CORPUS_REPO = "TheAxiomFoundation/axiom-corpus";
const BUNDLE_DIR = "manifests/program-bundles";
const PAGE_SIZE = 1000;

const args = process.argv.slice(2);
const outPath = argValue("--out");
const localBundles = argValues("--bundle");
const dryRun = Boolean(outPath);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function argValues(name) {
  return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []));
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = dryRun
  ? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or a Supabase key.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "encodings" },
  auth: { autoRefreshToken: false, persistSession: false },
});

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "axiom-program-bundles",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

/** The bundle files: local ones when named, else every file on axiom-corpus main. */
async function readBundles() {
  if (localBundles.length) {
    return localBundles.map((file) => ({ source: file, bundle: yaml.load(readFileSync(file, "utf8")) }));
  }
  const res = await fetch(`https://api.github.com/repos/${CORPUS_REPO}/contents/${BUNDLE_DIR}?ref=main`, {
    headers: githubHeaders,
  });
  // No bundle directory on main yet: nothing to measure.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`list ${BUNDLE_DIR}: HTTP ${res.status}`);
  const entries = (await res.json()).filter((entry) => entry.type === "file" && /\.ya?ml$/.test(entry.name));
  return Promise.all(
    entries.map(async (entry) => {
      const file = await fetch(entry.download_url, { headers: githubHeaders });
      if (!file.ok) throw new Error(`read ${entry.path}: HTTP ${file.status}`);
      return { source: `${CORPUS_REPO}@main:${entry.path}#${entry.sha.slice(0, 12)}`, bundle: yaml.load(await file.text()) };
    })
  );
}

/** Every row a query returns, a page at a time. */
async function pages(build) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

/**
 * A document's corpus provisions with their child counts, walked level by
 * level through parent_path: a LIKE on navigation_nodes.path has no index to
 * use and times out.
 */
async function corpusTree(root) {
  const nodes = () => supabase.schema("corpus").from("navigation_nodes").select("path,child_count");
  const self = await pages(() => nodes().eq("path", root));
  const out = self.map((n) => ({ path: n.path, child_count: n.child_count }));
  let level = self.filter((n) => n.child_count > 0).map((n) => n.path);
  while (level.length) {
    const next = [];
    for (let i = 0; i < level.length; i += 100) {
      const batch = level.slice(i, i + 100);
      const children = await pages(() => nodes().in("parent_path", batch).order("path"));
      out.push(...children.map((n) => ({ path: n.path, child_count: n.child_count })));
      next.push(...children.filter((n) => n.child_count > 0).map((n) => n.path));
    }
    level = next;
  }
  return out;
}

const under = (path, root) => path === root || path.startsWith(`${root}/`);

/**
 * Every module of the jurisdictions a bundle draws on, with the provisions it
 * encodes. A policy module's declared source is its rules' module-source rows
 * in the rule index.
 */
async function readModules(jurisdictions) {
  const [rows, declared] = await Promise.all([
    pages(() =>
      supabase
        .from("rulespec_files")
        .select("citation_path")
        .in("jurisdiction", jurisdictions)
        .not("citation_path", "is", null)
        .order("citation_path")
    ),
    pages(() =>
      supabase
        .from("rule_citations")
        .select("module_citation_path,citation_path")
        .eq("is_module_source", true)
        .like("module_citation_path", "%/policy/%")
        .order("module_citation_path")
        .order("citation_path")
    ),
  ]);
  const sources = new Map();
  for (const row of declared) {
    sources.set(row.module_citation_path, [...new Set([...(sources.get(row.module_citation_path) ?? []), row.citation_path])]);
  }
  return rows.map((row) => ({
    module: row.citation_path,
    sources: moduleSources({ citation_path: row.citation_path, declared_sources: sources.get(row.citation_path) ?? [] }),
  }));
}

/** The YAML of modules the parity rule must read, by module path. */
async function readYaml(modulePaths) {
  const out = new Map();
  for (let i = 0; i < modulePaths.length; i += 50) {
    const { data, error } = await supabase
      .from("rulespec_files")
      .select("citation_path,raw_yaml")
      .in("citation_path", modulePaths.slice(i, i + 50));
    if (error) throw new Error(error.message);
    for (const row of data) out.set(row.citation_path, row.raw_yaml);
  }
  return out;
}

async function telemetryFor(doc, modules, attempts) {
  const root = doc.citation_path;
  const nodes = await corpusTree(root);
  // Modules whose source is in the document or holds it.
  const relevant = modules.filter((m) => m.sources.some((s) => under(s, root) || under(root, s)));
  // A section module credits a cited paragraph only when its YAML names it.
  const cited = (doc.cited ?? []).map((c) => c.path);
  const readers = relevant.filter((m) => m.sources.some((s) => cited.some((c) => c.startsWith(`${s}/`))));
  const yaml = readers.length ? await readYaml(readers.map((m) => m.module)) : new Map();
  return {
    nodes,
    modules: relevant.map((m) => (yaml.has(m.module) ? { ...m, yaml: yaml.get(m.module) } : m)),
    attempts: attempts.filter((a) => a.citation && under(a.citation, root)),
  };
}

async function main() {
  const collectedAt = new Date().toISOString();
  const day = collectedAt.slice(0, 10);
  const bundles = await readBundles();
  if (!bundles.length) {
    console.log(`no bundle files in ${CORPUS_REPO}/${BUNDLE_DIR}`);
    return;
  }
  const attempts = await pages(() => supabase.from("pipeline_attempts").select("*").order("id"));
  console.log(`read ${attempts.length} pipeline attempts`);

  const bundleRows = [];
  const documentRows = [];
  const snapshotRows = [];
  for (const { source, bundle } of bundles) {
    const modules = await readModules([...new Set(["us", bundle.jurisdiction])]);
    console.log(`${bundle.id}: read ${modules.length} modules`);
    const cache = new Map();
    for (const tier of bundle.tiers) {
      const rows = [];
      for (const doc of tier.documents) {
        let telemetry = null;
        if (doc.scope === "in" && doc.citation_path) {
          const key = `${doc.citation_path}|${(doc.cited ?? []).map((c) => c.path).join(",")}`;
          if (!cache.has(key)) cache.set(key, await telemetryFor(doc, modules, attempts));
          telemetry = cache.get(key);
        }
        rows.push(measureDocument(bundle.id, tier.id, doc, telemetry, collectedAt));
      }
      documentRows.push(...rows);
      const counts = tierCounts(rows);
      snapshotRows.push({ bundle_id: bundle.id, tier: tier.id, day, counts });
      const done = counts.byStatus.complete;
      const p = counts.byProvisionState;
      const u = counts.byUnitState;
      console.log(
        `${bundle.id} ${tier.id}: ${counts.documents} documents in scope (${counts.excluded} excluded): ` +
          `${done} complete, ${counts.byStatus.partly} partly, ${counts.byStatus.not_started} not started, ` +
          `${counts.byStatus.not_in_corpus} not in the corpus; ${counts.provisions} provisions: ${p.encoded} encoded, ` +
          `${p.partly} partly, ${p.in_progress} in progress, ${p.failed} failed, ${p.not_started} not started` +
          (counts.units
            ? `; ${counts.units} cited units: ${u.encoded} encoded, ${u.partly} partly, ${u.in_progress} in progress, ` +
              `${u.failed} failed, ${u.not_encoded} not encoded, ${u.not_in_corpus} not in the corpus`
            : "")
      );
    }
    bundleRows.push({
      id: bundle.id,
      title: bundle.title,
      program: bundle.program,
      jurisdiction: bundle.jurisdiction,
      as_of: bundle.as_of,
      parts: bundle.parts ?? [],
      tiers: bundle.tiers.map(({ id, title, definition, membership, notes }) => ({ id, title, definition, membership, notes })),
      source,
      collected_at: collectedAt,
    });
  }

  if (dryRun) {
    writeFileSync(outPath, JSON.stringify({ bundles: bundleRows, documents: documentRows, snapshots: snapshotRows }, null, 1));
    console.log(`wrote ${documentRows.length} document rows to ${outPath}`);
    return;
  }
  await write(bundleRows, documentRows, snapshotRows);
}

async function write(bundleRows, documentRows, snapshotRows) {
  // Before the migration: measure, report, and write nothing.
  const { error: missing } = await supabase.from("program_bundles").select("id").limit(1);
  if (missing) {
    console.log(`program bundle tables not readable (${missing.message}); apply the migration to store results`);
    return;
  }
  const { error: bundleError } = await supabase.from("program_bundles").upsert(bundleRows, { onConflict: "id" });
  if (bundleError) throw new Error(`upsert program_bundles: ${bundleError.message}`);
  for (const bundle of bundleRows) {
    const rows = documentRows.filter((row) => row.bundle_id === bundle.id);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase
        .from("program_bundle_documents")
        .upsert(rows.slice(i, i + 200), { onConflict: "bundle_id,tier,key" });
      if (error) throw new Error(`upsert program_bundle_documents: ${error.message}`);
    }
    // Documents a newer bundle file dropped.
    const { error } = await supabase
      .from("program_bundle_documents")
      .delete()
      .eq("bundle_id", bundle.id)
      .lt("collected_at", bundle.collected_at);
    if (error) throw new Error(`prune program_bundle_documents: ${error.message}`);
  }
  const { error: snapshotError } = await supabase
    .from("program_bundle_snapshots")
    .upsert(snapshotRows, { onConflict: "bundle_id,tier,day" });
  if (snapshotError) throw new Error(`upsert program_bundle_snapshots: ${snapshotError.message}`);
  console.log(`wrote ${bundleRows.length} bundles, ${documentRows.length} documents, ${snapshotRows.length} snapshots`);
}

await main();
