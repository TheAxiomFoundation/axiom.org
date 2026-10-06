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
import { measureDocument, tierCounts } from "../src/lib/axiom/program-bundles.ts";

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

/** A path and everything under it. LIKE escapes, so a path's own "_" or "%" match only themselves. */
const likeUnder = (path) => `${path.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;

async function subtree(schema, table, column, select, root) {
  const query = () => supabase.schema(schema).from(table).select(select);
  const [self, below] = await Promise.all([
    pages(() => query().eq(column, root)),
    pages(() => query().like(column, likeUnder(root))),
  ]);
  return [...self, ...below];
}

/**
 * A document's corpus paths, walked level by level through parent_path: a
 * LIKE on navigation_nodes.path has no index to use and times out.
 */
async function corpusTree(root) {
  const nodes = () => supabase.schema("corpus").from("navigation_nodes").select("path,child_count");
  const self = await pages(() => nodes().eq("path", root));
  const paths = self.map((n) => n.path);
  let level = self.filter((n) => n.child_count > 0).map((n) => n.path);
  while (level.length) {
    const next = [];
    for (let i = 0; i < level.length; i += 100) {
      const batch = level.slice(i, i + 100);
      const children = await pages(() => nodes().in("parent_path", batch).order("path"));
      paths.push(...children.map((n) => n.path));
      next.push(...children.filter((n) => n.child_count > 0).map((n) => n.path));
    }
    level = next;
  }
  return paths;
}

async function telemetryFor(root, attempts) {
  const select = "citation_path,module_citation_path,rule_name";
  // A rule cites provisions (citation_path) and belongs to a module that
  // encodes one (module_citation_path); either may be the deeper of the two.
  const [nodes, cited, modules] = await Promise.all([
    corpusTree(root),
    subtree("encodings", "rule_citations", "citation_path", select, root),
    subtree("encodings", "rule_citations", "module_citation_path", select, root),
  ]);
  const rules = new Map();
  for (const c of [...cited, ...modules]) {
    const rule = `${c.module_citation_path}#${c.rule_name}`;
    rules.set(`${rule}|${c.citation_path}`, { citation_path: c.citation_path, rule });
    rules.set(`${rule}|${c.module_citation_path}`, { citation_path: c.module_citation_path, rule });
  }
  return {
    nodes,
    ruleCitations: [...rules.values()],
    attempts: attempts.filter((a) => a.citation === root || a.citation?.startsWith(`${root}/`)),
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
    const cache = new Map();
    for (const tier of bundle.tiers) {
      const rows = [];
      for (const doc of tier.documents) {
        let telemetry = null;
        if (doc.scope === "in" && doc.citation_path) {
          if (!cache.has(doc.citation_path)) cache.set(doc.citation_path, await telemetryFor(doc.citation_path, attempts));
          telemetry = cache.get(doc.citation_path);
        }
        rows.push(measureDocument(bundle.id, tier.id, doc, telemetry, collectedAt));
      }
      documentRows.push(...rows);
      const counts = tierCounts(rows);
      snapshotRows.push({ bundle_id: bundle.id, tier: tier.id, day, counts });
      const done = counts.byStatus.encoded;
      console.log(
        `${bundle.id} ${tier.id}: ${counts.documents} documents in scope (${counts.excluded} excluded), ` +
          `${done} encoded, ${counts.byStatus.partly_encoded} partly, ${counts.byStatus.not_encoded} without rules, ` +
          `${counts.byStatus.not_in_corpus} not in the corpus; provisions ${counts.encodedProvisions}/${counts.provisions}` +
          (counts.citedTotal
            ? `; PolicyEngine-cited ${counts.citedCovered} encoded, ${counts.citedWithin} within, of ${counts.citedTotal}`
            : "")
      );
    }
    bundleRows.push({
      id: bundle.id,
      title: bundle.title,
      program: bundle.program,
      jurisdiction: bundle.jurisdiction,
      as_of: bundle.as_of,
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
