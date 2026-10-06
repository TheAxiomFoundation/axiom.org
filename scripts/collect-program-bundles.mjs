#!/usr/bin/env bun
/**
 * Measure every program bundle: for each document of each delivery tier
 * (axiom-corpus manifests/program-bundles/<program>.yaml, one file per core
 * program with a federal layer and a layer per state), whether the corpus
 * serves it, how many of its provisions a RuleSpec rule cites (read from each
 * module's YAML, with its deferrals and validation waivers), which of the
 * provisions PolicyEngine cites are covered, and its newest encode run; and
 * each state bundle's screener-level parity, from the axiom-oracles
 * comparison its program names, with the newest policyengine-us release. The
 * /ops pages read only the tables this writes.
 *
 * Bundles: `us/<program>` holds the federal layer, `us-<st>/<program>` a
 * state's own layer; a state's bundle page and counts are the two together.
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
 * Tables: encodings.program_bundles (one row per bundle: its header, tier
 * definitions, parity and counts), encodings.program_bundle_documents (one row
 * per document, tier and bundle, replaced each pass) and
 * encodings.program_bundle_snapshots (each state bundle's tier counts once a
 * day, for progress over time).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { measureDocument, tierCounts } from "../src/lib/axiom/program-bundles.ts";
import { moduleFacts, waivedModules } from "../src/lib/axiom/program-bundles-modules.ts";
import { screenerParity } from "../src/lib/axiom/screener-parity.ts";
import { JURISDICTIONS_SEED } from "../src/lib/axiom/jurisdictions-seed.ts";

const CORPUS_REPO = "TheAxiomFoundation/axiom-corpus";
const BUNDLE_DIR = "manifests/program-bundles";
const ORACLE_DATA = "dashboard/public/data";
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

const label = (jurisdiction) =>
  jurisdiction === "us" ? "Federal" : (JURISDICTIONS_SEED.find((j) => j.slug === jurisdiction)?.label ?? jurisdiction);

/** The bundle files: local ones when named, else every program file on axiom-corpus main. */
async function readBundles() {
  const parse = (text) => yaml.load(text);
  if (localBundles.length) {
    return localBundles.map((file) => ({ source: file, bundle: parse(readFileSync(file, "utf8")) }));
  }
  const res = await fetch(`https://api.github.com/repos/${CORPUS_REPO}/contents/${BUNDLE_DIR}?ref=main`, {
    headers: githubHeaders,
  });
  // No bundle directory on main yet: nothing to measure.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`list ${BUNDLE_DIR}: HTTP ${res.status}`);
  const entries = (await res.json()).filter(
    (entry) => entry.type === "file" && /\.ya?ml$/.test(entry.name) && !entry.name.includes(".config.")
  );
  const out = [];
  for (const entry of entries) {
    const file = await fetch(entry.download_url, { headers: githubHeaders });
    if (!file.ok) throw new Error(`read ${entry.path}: HTTP ${file.status}`);
    out.push({ source: `${CORPUS_REPO}@main:${entry.path}#${entry.sha.slice(0, 12)}`, bundle: parse(await file.text()) });
  }
  return out;
}

/** Every row a query returns, a page at a time. */
async function pages(build, size = PAGE_SIZE) {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    const query = build();
    const { data, error } = await query.range(offset, offset + size - 1);
    if (error) throw new Error(`${error.message} (${query.url?.pathname ?? "query"}, offset ${offset})`);
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

const under = (path, root) => path === root || path.startsWith(`${root}/`);

/** The ancestors of a path, itself included: us/statute/7/2014/a → us/statute/7/2014/a, …, us. */
function ancestors(path) {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, parts.length - i).join("/"));
}

/** Run async jobs a few at a time. */
async function inBatches(items, size, job, concurrency = 6) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < batches.length) out.push(...(await job(batches[next++])));
    })
  );
  return out;
}

/**
 * The corpus provisions under each document root, with child counts, walked
 * level by level through parent_path for every root at once: path and
 * parent_path are indexed, while a LIKE on path or a read by jurisdiction
 * runs into the statement timeout.
 */
async function corpusTrees(roots) {
  const nodes = () => supabase.schema("corpus").from("navigation_nodes").select("path,child_count");
  const found = new Map();
  const keep = (rows) => {
    for (const n of rows) found.set(n.path, n.child_count);
    return rows.filter((n) => n.child_count > 0).map((n) => n.path);
  };
  let level = keep(await inBatches(roots, 100, (batch) => pages(() => nodes().in("path", batch))));
  for (let depth = 1; level.length; depth++) {
    level = keep(await inBatches(level, 100, (batch) => pages(() => nodes().in("parent_path", batch).order("path"))));
  }
  const paths = [...found.keys()].sort();
  const trees = new Map();
  for (const root of roots) {
    // The nodes at or under the root: a contiguous run in path order.
    let lo = 0;
    let hi = paths.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (paths[mid] < root) lo = mid + 1;
      else hi = mid;
    }
    const tree = [];
    for (let i = lo; i < paths.length && (paths[i] === root || paths[i].startsWith(`${root}/`)); i++) {
      tree.push({ path: paths[i], child_count: found.get(paths[i]) });
    }
    trees.set(root, tree);
  }
  console.log(`corpus: ${found.size} nodes for ${roots.length} documents`);
  return trees;
}

/**
 * The module files each RuleSpec repo merged under a validation waiver (its
 * known-validation-gaps.yaml on main); a repo without the file waives nothing.
 */
async function readWaivers(repos) {
  const waivers = new Set();
  for (const repo of repos) {
    const res = await fetch(`https://raw.githubusercontent.com/TheAxiomFoundation/${repo}/main/known-validation-gaps.yaml`, {
      headers: { "User-Agent": "axiom-program-bundles" },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`read ${repo} known-validation-gaps.yaml: HTTP ${res.status}`);
    for (const key of waivedModules(await res.text())) waivers.add(key);
  }
  return waivers;
}

/**
 * Every RuleSpec module, as the provisions its rules cite and defer
 * (program-bundles-modules.ts), indexed by every path it touches and their
 * ancestors, so a document finds its modules without a scan.
 */
async function readModules() {
  // A policy module's declared sources come from its row's source_citation_paths
  // (the rule index's module-source rows need a scan that runs into the
  // statement timeout at this size).
  const rows = await pages(
    () =>
      supabase
        .from("rulespec_files")
        .select("citation_path,jurisdiction,file_path,repo,raw_yaml,source_citation_paths")
        .not("citation_path", "is", null)
        .order("citation_path"),
    200
  );
  const waivers = await readWaivers([...new Set(rows.map((r) => r.repo).filter(Boolean))]);
  const modules = rows.map((row) => moduleFacts(row, [], waivers));
  // A module touches a root when one of its paths is at or under the root
  // (indexed by every ancestor of the path), or at or above it (by the path itself).
  const byAncestor = new Map();
  const byPath = new Map();
  for (const m of modules) {
    for (const path of new Set([...m.sources, ...m.cited, ...m.deferred])) {
      byPath.set(path, [...(byPath.get(path) ?? []), m]);
      for (const a of ancestors(path)) byAncestor.set(a, [...(byAncestor.get(a) ?? []), m]);
    }
  }
  const touching = (root) => {
    const found = new Set(byAncestor.get(root) ?? []);
    for (const a of ancestors(root)) for (const m of byPath.get(a) ?? []) found.add(m);
    return [...found];
  };
  console.log(
    `read ${modules.length} modules (${modules.filter((m) => m.deferred.length).length} defer something, ` +
      `${modules.filter((m) => m.waived).length} waived)`
  );
  return touching;
}

/** The newest policyengine-us version on PyPI; null when PyPI does not answer. */
async function newestPolicyEngine() {
  try {
    const res = await fetch("https://pypi.org/pypi/policyengine-us/json", { headers: { "User-Agent": "axiom-program-bundles" } });
    return res.ok ? (await res.json()).info.version : null;
  } catch {
    return null;
  }
}

/** The comparison report files on axiom-oracles main, by name. */
async function oracleReports() {
  const res = await fetch(`https://api.github.com/repos/TheAxiomFoundation/axiom-oracles/contents/${ORACLE_DATA}?ref=main`, {
    headers: githubHeaders,
  });
  if (!res.ok) {
    console.warn(`list ${ORACLE_DATA}: HTTP ${res.status}`);
    return [];
  }
  return (await res.json()).filter((entry) => entry.type === "file").map((entry) => entry.name);
}

/** A state bundle's screener-level parity from its program's comparison suite, if it has one. */
async function readParity(comparison, st, reports) {
  if (!comparison?.repo || !comparison?.suite) return null;
  const suite = comparison.suite.replace("{st}", st);
  const name = reports.find((file) => file.endsWith(`-${suite}.json`));
  if (!name) return null;
  const report = `${ORACLE_DATA}/${name}`;
  // The raw host: no API rate limit for a public repo, and the token for a private one.
  const res = await fetch(`https://raw.githubusercontent.com/${comparison.repo}/main/${report}`, { headers: githubHeaders });
  if (!res.ok) {
    console.warn(`comparison report ${report}: HTTP ${res.status}`);
    return null;
  }
  return screenerParity(await res.json(), { repo: comparison.repo, suite, report });
}

async function main() {
  const collectedAt = new Date().toISOString();
  const day = collectedAt.slice(0, 10);
  const bundles = (await readBundles()).filter(({ bundle }) => bundle?.schema === "axiom-program-bundle/v2");
  if (!bundles.length) {
    console.log(`no program bundle files in ${CORPUS_REPO}/${BUNDLE_DIR}`);
    return;
  }
  const [attempts, touching, policyengineLatest, reports] = await Promise.all([
    pages(() => supabase.from("pipeline_attempts").select("*").order("id")),
    readModules(),
    newestPolicyEngine(),
    oracleReports(),
  ]);
  console.log(`read ${attempts.length} pipeline attempts; newest policyengine-us release: ${policyengineLatest ?? "unknown"}`);
  const attemptsUnder = (root) => attempts.filter((a) => a.citation && under(a.citation, root));

  // Every in-scope document root, measured once.
  const roots = new Set();
  for (const { bundle } of bundles)
    for (const layer of bundle.layers)
      for (const tier of ["screener", "full"])
        for (const doc of layer[tier]) if (doc.scope === "in" && doc.citation_path) roots.add(doc.citation_path);
  const trees = await corpusTrees([...roots]);
  const telemetry = new Map();
  const telemetryFor = (root) => {
    if (!telemetry.has(root)) {
      telemetry.set(root, { nodes: trees.get(root) ?? [], modules: touching(root), attempts: attemptsUnder(root) });
    }
    return telemetry.get(root);
  };

  const bundleRows = [];
  const documentRows = [];
  const snapshotRows = [];
  for (const { source, bundle } of bundles) {
    const tiers = bundle.tiers.map(({ id, title, definition, membership, notes }) => ({ id, title, definition, membership, notes }));
    const byLayer = new Map();
    for (const layer of bundle.layers) {
      const bundleId = `${layer.jurisdiction}/${bundle.program}`;
      const rows = [];
      for (const tier of ["screener", "full"]) {
        for (const doc of layer[tier]) {
          const t = doc.scope === "in" && doc.citation_path ? telemetryFor(doc.citation_path) : null;
          rows.push(measureDocument(bundleId, tier, doc, t, collectedAt));
        }
      }
      byLayer.set(layer.jurisdiction, rows);
      documentRows.push(...rows);
    }
    const federal = byLayer.get("us") ?? [];
    for (const layer of bundle.layers) {
      const jurisdiction = layer.jurisdiction;
      const bundleId = `${jurisdiction}/${bundle.program}`;
      // A state's bundle is its layer and the federal layer together.
      const rows = jurisdiction === "us" ? federal : [...federal, ...byLayer.get(jurisdiction)];
      const counts = {};
      for (const tier of ["screener", "full"]) {
        counts[tier] = tierCounts(rows.filter((r) => r.tier === tier));
        if (jurisdiction !== "us") snapshotRows.push({ bundle_id: bundleId, tier, day, counts: counts[tier] });
      }
      const parity = jurisdiction === "us" ? null : await readParity(bundle.comparison, jurisdiction.slice(3), reports);
      bundleRows.push({
        id: bundleId,
        title: jurisdiction === "us" ? `${bundle.title}: federal law` : `${label(jurisdiction)} ${bundle.title}`,
        program: bundle.program,
        jurisdiction,
        as_of: bundle.as_of,
        parts: bundle.parts ?? [],
        tiers,
        source,
        parity,
        policyengine_latest: policyengineLatest,
        counts,
        collected_at: collectedAt,
      });
    }
    const share = (c) => {
      const done = c.byProvisionState.encoded + c.byProvisionState.unvalidated;
      return `${done} of ${c.provisions} (${c.provisions ? Math.round((done / c.provisions) * 100) : 0}%)`;
    };
    const fed = bundleRows.find((r) => r.id === `us/${bundle.program}`);
    console.log(
      `${bundle.program}: ${bundle.layers.length} layers; federal screener ${share(fed.counts.screener)} cited provisions, ` +
        `full ${share(fed.counts.full)} provisions`
    );
  }
  console.log(`${bundleRows.length} bundles, ${documentRows.length} document rows, ${snapshotRows.length} snapshots`);

  if (dryRun) {
    writeFileSync(outPath, JSON.stringify({ bundles: bundleRows, documents: documentRows, snapshots: snapshotRows }));
    console.log(`wrote ${outPath}`);
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
  for (let i = 0; i < bundleRows.length; i += 200) {
    const { error } = await supabase.from("program_bundles").upsert(bundleRows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw new Error(`upsert program_bundles: ${error.message}`);
  }
  for (let i = 0; i < documentRows.length; i += 500) {
    const { error } = await supabase
      .from("program_bundle_documents")
      .upsert(documentRows.slice(i, i + 500), { onConflict: "bundle_id,tier,key" });
    if (error) throw new Error(`upsert program_bundle_documents: ${error.message}`);
  }
  // Documents and bundles a newer bundle file dropped.
  const collectedAt = bundleRows[0]?.collected_at;
  if (collectedAt) {
    const { error } = await supabase.from("program_bundle_documents").delete().lt("collected_at", collectedAt);
    if (error) throw new Error(`prune program_bundle_documents: ${error.message}`);
    const { error: bundleError } = await supabase.from("program_bundles").delete().lt("collected_at", collectedAt);
    if (bundleError) throw new Error(`prune program_bundles: ${bundleError.message}`);
  }
  for (let i = 0; i < snapshotRows.length; i += 500) {
    const { error } = await supabase
      .from("program_bundle_snapshots")
      .upsert(snapshotRows.slice(i, i + 500), { onConflict: "bundle_id,tier,day" });
    if (error) throw new Error(`upsert program_bundle_snapshots: ${error.message}`);
  }
  console.log(`wrote ${bundleRows.length} bundles, ${documentRows.length} documents, ${snapshotRows.length} snapshots`);
}

await main();
