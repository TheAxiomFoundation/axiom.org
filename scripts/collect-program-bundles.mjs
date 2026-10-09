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
 *   --local-scopes TSV --local-base DIR
 *                dry run only: also count the scopes a release would add
 *                (TSV of jurisdiction, document_class, version) from their
 *                local provisions under DIR, as if they were served: a
 *                preview of what activating the release changes.
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
const localScopes = argValue("--local-scopes");
const localBase = argValue("--local-base");
if (localScopes && !dryRun) throw new Error("--local-scopes previews a release: use it with --out only");

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

// The served corpus is public: read its views with the anon key, as the site does.
// The service role has no grant on corpus.current_provisions; it reads and writes
// the encodings tables only.
const corpusDb = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? supabaseKey, {
  db: { schema: "corpus" },
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

/** A query error worth another try: the statement timeout, or a gateway error page. */
const transient = (message) => /statement timeout|fetch failed|<!DOCTYPE html>/i.test(message ?? "");

/** Every row a query returns, a page at a time; a page that fails for a transient reason is tried twice more. */
async function pages(build, size = PAGE_SIZE) {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    let result;
    for (let attempt = 1; ; attempt++) {
      const query = build();
      result = await query.range(offset, offset + size - 1);
      if (!result.error) break;
      if (attempt === 3 || !transient(result.error.message)) {
        const message = result.error.message.startsWith("<") ? "gateway error" : result.error.message;
        throw new Error(`${message} (${query.url?.pathname ?? "query"}, offset ${offset})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
    rows.push(...result.data);
    if (result.data.length < size) return rows;
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

/** A PostgREST filter value, quoted: paths hold dots, commas and parentheses. */
const literal = (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The corpus nodes in each document: under its path, and linked under it.
 * The nodes under a root are the paths from "<root>/" up to "<root>0" ("0"
 * follows "/"; the path index orders bytes), read as index ranges, a batch of
 * roots per query; a LIKE on path or a read by jurisdiction runs into the
 * statement timeout. The parent links reach further: a chapter or a subpart
 * links sections that are not under its path (us-mi/statute/chapter-206 holds
 * us-mi/statute/206.1), so a node with linked children not yet read has them
 * read by parent_path, with everything under them. Neither alone suffices: a
 * section can have no parent link (us/statute/26/1 under Title 26).
 *
 * A leaf is a node with no linked children and nothing under its path.
 */
/** The citation paths of the scopes a release would add, from their local provisions files (preview only). */
const previewFacts = new Map();
function localScopePaths() {
  if (!localScopes) return [];
  const paths = [];
  const rows = readFileSync(localScopes, "utf8").trim().split("\n").slice(1);
  for (const row of rows) {
    const [jurisdiction, documentClass, version] = row.split("\t");
    const file = `${localBase}/provisions/${jurisdiction}/${documentClass}/${version}.jsonl`;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line);
      paths.push(row.citation_path);
      previewFacts.set(row.citation_path, { kind: row.kind, subtype: row.metadata?.document_subtype ?? "" });
    }
  }
  console.log(`preview: ${paths.length} provisions of ${rows.length} release scopes counted as served`);
  return paths;
}

async function corpusTrees(roots, previewPaths = []) {
  const nodes = () => corpusDb.from("navigation_nodes").select("path,parent_path,child_count");
  const found = new Map();
  const keep = (rows) => {
    const added = [];
    for (const n of rows) {
      if (found.has(n.path)) continue;
      found.set(n.path, n);
      added.push(n.path);
    }
    return added;
  };
  const ranges = (batch) =>
    pages(() =>
      nodes()
        .or(batch.map((root) => `and(path.gte.${literal(`${root}/`)},path.lt.${literal(`${root}0`)})`).join(","))
        .order("path")
    );
  // Only the outermost paths need a range: a nested path's nodes lie in its ancestor's.
  const outermost = (paths) => {
    const set = new Set(paths);
    return paths.filter((path) => !ancestors(path).slice(1).some((a) => set.has(a)));
  };
  keep(await inBatches(roots, 100, (batch) => pages(() => nodes().in("path", batch))));
  keep(await inBatches(outermost(roots), 25, ranges));
  // A release preview: the scopes it would add, contained by path.
  for (const path of previewPaths) if (!found.has(path)) found.set(path, { path, parent_path: null, child_count: 0 });
  // Linked children not yet read, and everything under them, until none are left.
  for (let round = 0; ; round++) {
    const linked = new Map();
    for (const n of found.values()) if (n.parent_path) linked.set(n.parent_path, (linked.get(n.parent_path) ?? 0) + 1);
    const short = [...found.values()].filter((n) => n.child_count > (linked.get(n.path) ?? 0)).map((n) => n.path);
    if (!short.length || round === 10) break;
    console.log(`corpus links, round ${round + 1}: ${short.length} nodes with linked children not read (${short.slice(0, 3).join(", ")})`);
    const added = keep(await inBatches(short, 20, (batch) => pages(() => nodes().in("parent_path", batch).order("path"))));
    if (!added.length) break;
    keep(await inBatches(outermost(added), 25, ranges));
  }
  // JavaScript compares strings by UTF-16 code units, which orders these
  // ASCII paths as the index does.
  const paths = [...found.keys()].sort();
  const lowerBound = (value) => {
    let lo = 0;
    let hi = paths.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (paths[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const underPath = (path) => paths.slice(lowerBound(`${path}/`), lowerBound(`${path}0`));
  const childrenOf = new Map();
  for (const n of found.values()) {
    if (n.parent_path) childrenOf.set(n.parent_path, [...(childrenOf.get(n.parent_path) ?? []), n.path]);
  }
  const trees = new Map();
  for (const root of roots) {
    // A root the corpus holds no node for, with nodes under its path (a whole
    // agency's rules held chapter by chapter): the document is those nodes.
    const start = lowerBound(`${root}/`);
    const end = lowerBound(`${root}0`);
    if (!found.has(root) && start === end) {
      trees.set(root, []);
      continue;
    }
    // Everything reachable from the root by path or by link.
    const seen = new Set(found.has(root) ? [root] : paths.slice(start, end));
    const queue = [...seen];
    while (queue.length) {
      const path = queue.pop();
      for (const next of [...underPath(path), ...(childrenOf.get(path) ?? [])]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    trees.set(
      root,
      [...seen].map((path) => ({
        path,
        // Linked children, or failing those the nodes under the path.
        child_count: Math.max(found.get(path).child_count ?? 0, lowerBound(`${path}0`) - lowerBound(`${path}/`)),
      }))
    );
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
    for (const path of new Set([...m.sources, ...m.cited, ...m.broad, ...m.deferred])) {
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

/** An identifier key that names a container (indiana:title, ecfr:part, nmsa_chapter), or a section. */
const CONTAINER_KEY = /(^|[:_])(title|code_title|chapter|subchapter|part|subpart|article|subtitle|division|act)$/;
const SECTION_KEY = /(^|[:_])section$/;
/** A label or legal identifier that names a numbered container: "Chapter 17-676", "42 CFR part 435", "Title 16". */
const CONTAINER_WORD = /\b(title|chapter|subchapter|part|subpart|article|subtitle|division)\s+\d/i;
const CONTAINER_SEGMENT = /^(title|chapter|subchapter|part|subpart|article|subtitle|division)-/;
/** A path inside a collection of acts: a public law or session law is a container of sections. */
const ACT_PATH = /\/(public-law|session-laws?|acts?)\//;
/** Unit kinds and document subtypes (local provisions, for a release preview) that collect citable units. */
const CONTAINER_KIND = /^(title|chapter|subchapter|part|subpart|article|subtitle|division)$/;
const CONTAINER_SUBTYPE = /manual|compilation|register|public_law|session_law|title|code_edition|code_chapter/;

/**
 * The document roots that are a title, chapter, part or whole manual, not a
 * section, read from the served corpus: identifiers naming a container and
 * no section (IC 6, 42 CFR part 435, MCL chapter 206); a path or label naming
 * a numbered container (HAR Chapter 17-676); a public or session law, a
 * register issue or a statute compilation (collections of citable units); a
 * manual whose label names a manual, handbook or notebook and nothing in it
 * ("West Virginia Income Maintenance Manual", not "Texas Works Handbook:
 * A-1320"). A citation of all of such a document is one reference.
 */
async function containerRoots(roots) {
  const labels = new Map();
  for (const n of await inBatches(roots, 100, (batch) =>
    pages(() => corpusDb.from("navigation_nodes").select("path,label").in("path", batch))
  ))
    labels.set(n.path, n.label ?? "");
  const facts = new Map();
  for (const p of await inBatches(roots, 100, (batch) =>
    pages(() =>
      corpusDb
        .from("current_provisions")
        .select("citation_path,legal_identifier,identifiers,doc_type")
        .in("citation_path", batch)
    )
  ))
    facts.set(p.citation_path, p);
  const containers = new Set();
  for (const root of roots) {
    // A root a release preview adds: its unit kind from the local provisions.
    const local = previewFacts.get(root);
    if (local && !facts.has(root)) {
      if (
        CONTAINER_KIND.test(local.kind ?? "") ||
        CONTAINER_SUBTYPE.test(local.subtype) ||
        ACT_PATH.test(root) ||
        CONTAINER_SEGMENT.test(root.split("/").pop())
      ) {
        containers.add(root);
      }
      continue;
    }
    const fact = facts.get(root) ?? {};
    const label = labels.get(root) ?? "";
    const keys = Object.keys(fact.identifiers ?? {});
    const text = [fact.legal_identifier, label].filter(Boolean).join(" ");
    const container = keys.some((k) => SECTION_KEY.test(k))
      ? false
      : keys.some((k) => CONTAINER_KEY.test(k)) ||
        CONTAINER_SEGMENT.test(root.split("/").pop()) ||
        ACT_PATH.test(root) ||
        /\b(register|compilation)\b/i.test(label) ||
        (CONTAINER_WORD.test(text) && !/§|\bsection\b|\bsec\./i.test(text)) ||
        (["manual", "policy"].includes(fact.doc_type) && /\b(manual|handbook|notebook)\b/i.test(label) && !label.includes(":"));
    if (container) containers.add(root);
  }
  console.log(`containers: ${containers.size} of ${roots.length} screener document roots`);
  return containers;
}

/** A section number as its corpus path segment and a web page's path both spell it: 7 AAC 45.280, 7-AAC-45.280. */
const sectionKey = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The section a state-law web page names in its last path segment, when it names one. */
function urlSection(url) {
  let last;
  try {
    last = new URL(url).pathname.split("/").filter(Boolean).pop();
  } catch {
    return null;
  }
  if (!last) return null;
  const key = sectionKey(
    decodeURIComponent(last)
      .toLowerCase()
      .replace(/^(section|sec|rule)-/, "")
      .replace(/\.(html?|pdf|aspx?)$/, "")
  );
  return key.length >= 5 && /\d/.test(key) ? key : null;
}

/**
 * The state-law web pages the corpus holds under their section numbers
 * (Justia's section-40-18-15 is us-al/statute/40-18-15, Cornell's
 * 7-AAC-45.280 is us-ak/regulation/aac/title-7/chapter-45/7 AAC 45.280): a
 * state layer's in-scope document with no citation path takes the one path
 * of its state's statutes and regulations whose last segment spells its
 * section. A page whose section matches no path, or more than one, stays a
 * web page.
 */
async function matchSections(bundles) {
  const webPages = [];
  for (const { bundle } of bundles)
    for (const layer of bundle.layers) {
      if (layer.jurisdiction === "us") continue;
      for (const tier of ["screener", "full"])
        for (const doc of layer[tier]) {
          const key = !doc.citation_path && doc.scope === "in" && doc.source_url ? urlSection(doc.source_url) : null;
          if (key) webPages.push({ doc, jurisdiction: layer.jurisdiction, key });
        }
    }
  const jurisdictions = [...new Set(webPages.map((p) => p.jurisdiction))];
  const nodes = () => corpusDb.from("navigation_nodes").select("path");
  const ranges = jurisdictions.flatMap((j) => [`${j}/statute`, `${j}/regulation`]);
  const paths = await inBatches(
    ranges,
    1,
    ([root]) => pages(() => nodes().gte("path", `${root}/`).lt("path", `${root}0`).order("path")),
    3
  );
  const bySection = new Map();
  for (const { path } of paths) {
    const key = `${path.split("/")[0]}|${sectionKey(path.split("/").pop())}`;
    bySection.set(key, [...(bySection.get(key) ?? []), path]);
  }
  let matched = 0;
  for (const { doc, jurisdiction, key } of webPages) {
    const found = bySection.get(`${jurisdiction}|${key}`) ?? [];
    if (found.length !== 1) continue;
    doc.citation_path = found[0];
    doc.note = [doc.note, `Found in the corpus as ${found[0]}, by its section number`].filter(Boolean).join(" ");
    matched++;
  }
  console.log(`corpus sections: ${matched} of ${webPages.length} state-law web pages matched (${paths.length} paths read)`);
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

  await matchSections(bundles);
  // A document a layer's tier holds twice (a web page found in the corpus, or
  // two editions of one page) counts once: as the row keyed by its path, or
  // the first.
  for (const { bundle } of bundles)
    for (const layer of bundle.layers)
      for (const tier of ["screener", "full"]) {
        const held = new Map();
        const docs = layer[tier].filter((d) => d.scope === "in" && d.citation_path);
        for (const doc of [...docs.filter((d) => d.key === d.citation_path), ...docs.filter((d) => d.key !== d.citation_path)]) {
          if (!held.has(doc.citation_path)) {
            held.set(doc.citation_path, doc);
            continue;
          }
          doc.scope = "excluded";
          doc.reason = `The same document as ${held.get(doc.citation_path).key}, counted there`;
        }
      }

  // Every in-scope document root, measured once.
  const roots = new Set();
  for (const { bundle } of bundles)
    for (const layer of bundle.layers)
      for (const tier of ["screener", "full"])
        for (const doc of layer[tier]) if (doc.scope === "in" && doc.citation_path) roots.add(doc.citation_path);
  const trees = await corpusTrees([...roots], localScopePaths());
  // The screener documents' roots that are containers, so a citation of all of one counts once.
  const screenerRoots = new Set();
  for (const { bundle } of bundles)
    for (const layer of bundle.layers)
      for (const doc of layer.screener) if (doc.scope === "in" && doc.citation_path) screenerRoots.add(doc.citation_path);
  const containers = await containerRoots([...screenerRoots].filter((root) => trees.get(root)?.length));
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
      // A full-bundle document PolicyEngine also cites takes its cited provisions,
      // so it never counts more coarsely than in the screener tier.
      const cited = new Map(layer.screener.filter((d) => d.cited?.length).map((d) => [d.key, d.cited]));
      for (const tier of ["screener", "full"]) {
        // Each document counts only its own provisions, none that a document
        // under it in this tier holds (a manual and its sections, a part and
        // the sections PolicyEngine cites), so no provision counts twice.
        const roots = [
          ...new Set(layer[tier].filter((d) => d.scope === "in" && d.citation_path).map((d) => d.citation_path)),
        ].sort();
        const nestedIn = (root) => {
          const out = [];
          let i = roots.findIndex((r) => r >= `${root}/`);
          for (; i >= 0 && i < roots.length && roots[i] < `${root}0`; i++) out.push(roots[i]);
          return out;
        };
        for (const doc of layer[tier]) {
          let t = doc.scope === "in" && doc.citation_path ? telemetryFor(doc.citation_path) : null;
          let measuredDoc = tier === "full" && cited.has(doc.key) ? { ...doc, cited: cited.get(doc.key) } : doc;
          if (doc.citation_path && containers.has(doc.citation_path)) measuredDoc = { ...measuredDoc, container: true };
          const nested = t ? nestedIn(doc.citation_path) : [];
          if (nested.length) {
            const held = t.nodes.length > 0;
            t = { ...t, nodes: t.nodes.filter((n) => !nested.some((r) => under(n.path, r))) };
            // Nothing of its own left: its documents hold it all.
            if (held && !t.nodes.some((n) => n.child_count === 0)) {
              const reason = `Counted through the ${nested.length} document${nested.length === 1 ? "" : "s"} under it`;
              measuredDoc = { ...measuredDoc, scope: "excluded", reason };
            }
          }
          rows.push(measureDocument(bundleId, tier, measuredDoc, t, collectedAt));
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
  // Documents more than one program's bundle holds, in the same jurisdiction:
  // an encoding of one counts in each, so each row names the others.
  const titles = new Map(bundles.map(({ bundle }) => [bundle.program, bundle.title]));
  const holders = new Map();
  for (const row of documentRows) {
    if (row.scope !== "in") continue;
    const [jurisdiction, program] = row.bundle_id.split("/");
    const key = `${jurisdiction}|${row.key}`;
    holders.set(key, new Set([...(holders.get(key) ?? []), program]));
  }
  for (const row of documentRows) {
    const [jurisdiction, program] = row.bundle_id.split("/");
    row.also_in = [...(holders.get(`${jurisdiction}|${row.key}`) ?? [])]
      .filter((p) => p !== program)
      .map((p) => titles.get(p) ?? p)
      .sort();
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
