#!/usr/bin/env bun
/**
 * Sync the rulespec-* GitHub repos into the encodings.rulespec_files
 * search index and the encodings.rule_citations reader index.
 *
 * One row per encoding YAML: citation path, raw YAML, source citation
 * paths, and a pre-tokenised search_text (path segments, rule names,
 * formula identifiers, module summary). The Axiom app's encoded-search
 * lane queries this table first and only falls back to crawling GitHub
 * at request time when the table is missing or empty.
 *
 * Usage:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   [GITHUB_TOKEN=...] \
 *   bun scripts/sync-rulespec-index.mjs
 *
 * Run on a schedule (cron / GitHub Action) or as a post-merge hook on
 * the rulespec-* repos.
 */

import { createClient } from "@supabase/supabase-js";
// Bun resolves the TypeScript imports (and the repo's tsconfig paths)
// directly, so the script reuses the app's canonical RuleSpec parser
// and tree-listing logic instead of mirroring them — a mirror is how
// the index once kept a stale ca→canada slug mapping the app had
// already dropped.
import {
  parseRuleSpec,
  tokenizeFormula,
} from "../src/lib/axiom/rulespec/doc.ts";
import { ruleCitationRows } from "../src/lib/axiom/rulespec/source-citations.ts";
import {
  removeStaleRows,
  replaceRuleCitations,
  writeWithRetries as retryWrite,
} from "./lib/rulespec-index-writes.mjs";
import { parseTreeEntries } from "../src/lib/axiom/rulespec/repo-listing.ts";
import {
  GITHUB_ORG,
  discoverRoots,
  githubHeaders,
  githubJson,
} from "./lib/rulespec-discovery.mjs";
import { citationPathSetsForFile } from "./lib/source-citation-paths.mjs";
import { indexableRoots } from "./lib/indexable-roots.mjs";

import { executionClassification } from "./lib/execution-classification.mjs";

const RAW_FETCH_CONCURRENCY = 8;
const UPSERT_CHUNK_SIZE = 100;
const RULE_CITATION_DELETE_CHUNK_SIZE = 25;
const RULE_CITATION_UPSERT_CHUNK_SIZE = 200;
// Rows carry whole rule YAML; composition rules run to tens of KB, so a
// row-count bound alone let single requests reach several MB and the
// REST gateway answered with Cloudflare error pages, connection resets,
// and statement timeouts (runs 32710243782 and two locals died at the
// same fat chunk). Flush a chunk when its payload budget is spent.
const RULE_CITATION_CHUNK_BUDGET_BYTES = 700_000;

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  db: { schema: "encodings" },
  auth: { autoRefreshToken: false, persistSession: false },
});

// Every read of a repo pins the commit its branch pointed at when the sync
// reached it, so a merge landing mid-sync can't mix two trees, and each row
// records the commit it came from.
const branchHeads = new Map();
async function branchHead(root) {
  const key = `${root.repo}@${root.branch}`;
  if (!branchHeads.has(key)) {
    branchHeads.set(
      key,
      githubJson(
        `https://api.github.com/repos/${GITHUB_ORG}/${root.repo}/commits/${encodeURIComponent(root.branch)}`,
      )
        .then((commit) => commit.sha ?? null)
        .catch((error) => {
          console.warn(`head of ${key} unresolved, reading the branch: ${error.message}`);
          return null;
        }),
    );
  }
  return branchHeads.get(key);
}

async function listFiles(root) {
  root.commit = await branchHead(root);
  const ref = root.commit ?? root.branch;
  const treePath = root.prefix ? `${ref}:${root.prefix}` : ref;
  const body = await githubJson(
    `https://api.github.com/repos/${GITHUB_ORG}/${root.repo}/git/trees/${encodeURIComponent(treePath)}?recursive=1`,
  );
  if (!Array.isArray(body.tree)) {
    console.warn(`tree missing entries for ${root.repo}:${root.prefix ?? ""}`);
    return { complete: false, files: [] };
  }
  if (body.truncated) {
    console.warn(`tree truncated for ${root.repo}:${root.prefix ?? ""}`);
  }
  return {
    complete: !body.truncated,
    files: parseTreeEntries(body, root.jurisdiction).map((file) => ({
      ...file,
      root,
    })),
  };
}

async function fetchRawYaml(file) {
  const prefixedPath = file.root.prefix
    ? `${file.root.prefix}/${file.filePath}`
    : file.filePath;
  const url = `https://raw.githubusercontent.com/${GITHUB_ORG}/${file.root.repo}/${file.root.commit ?? file.root.branch}/${prefixedPath}`;
  const res = await fetch(url, { headers: githubHeaders });
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} for ${url}`);
  }
  return res.text();
}

/** Bag of words the app's OR-of-terms candidate query matches against. */
function buildSearchText(file, doc) {
  const parts = [
    file.citationPath.replace(/[/_-]+/g, " "),
    file.filePath.replace(/[/_.-]+/g, " "),
  ];
  if (doc) {
    if (doc.module.summary) parts.push(doc.module.summary);
    for (const rule of doc.rules) {
      parts.push(rule.name.replace(/_/g, " "));
      if (rule.source) parts.push(rule.source);
      for (const version of rule.versions) {
        if (!version.formula) continue;
        for (const segment of tokenizeFormula(version.formula)) {
          if (segment.isIdentifier) {
            parts.push(segment.text.replace(/_/g, " "));
          }
        }
      }
    }
  }
  const tokens = new Set(
    parts
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2),
  );
  return [...tokens].join(" ");
}

/** Every write retries (scripts/lib/rulespec-index-writes.mjs); one that
 *  keeps failing ends the run, so it fails closed. */
async function writeWithRetries(label, run) {
  try {
    return await retryWrite(label, run);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}

const startedAt = new Date().toISOString();
const incomplete = {
  discoveryTrees: 0,
  emptyDiscovery: false,
  rootListings: 0,
  rawFiles: 0,
  invalidFiles: 0,
};
const discovered = await discoverRoots(() => {
  incomplete.discoveryTrees += 1;
});
if (discovered.length === 0) incomplete.emptyDiscovery = true;
console.log(`${discovered.length} jurisdiction roots discovered`);

// Second, synchronous gate on top of discovery's marker read, which
// fails open: a family the app registers app_visibility="experimental"
// is never indexed, even when its .axiom/registry.toml could not be
// fetched. See scripts/lib/indexable-roots.mjs.
const roots = indexableRoots(discovered, (root) =>
  console.log(
    `skip ${root.repo}:${root.prefix ?? ""}: app registers "${root.jurisdiction}" app_visibility=experimental`,
  ),
);
if (roots.length < discovered.length) {
  console.log(
    `${discovered.length - roots.length} root(s) withheld by the app read list`,
  );
}

// commit_sha arrives with a hand-applied migration; until then, sync without it.
const { error: commitColumnError } = await supabase
  .from("rulespec_files")
  .select("commit_sha")
  .limit(1);
const hasCommitColumn = !commitColumnError;
if (!hasCommitColumn) {
  console.log(`rulespec_files.commit_sha unavailable, not recorded: ${commitColumnError.message}`);
}

const seen = new Set();
const files = [];
for (const root of roots) {
  try {
    const listing = await listFiles(root);
    if (!listing.complete) incomplete.rootListings += 1;
    for (const file of listing.files) {
      if (seen.has(file.citationPath)) continue;
      seen.add(file.citationPath);
      files.push(file);
    }
  } catch (error) {
    incomplete.rootListings += 1;
    console.warn(
      `skip ${root.repo}:${root.prefix ?? ""} listing: ${error.message}`,
    );
  }
}
console.log(`${files.length} encoding files listed`);

const indexedFiles = (
  await mapWithConcurrency(files, RAW_FETCH_CONCURRENCY, async (file) => {
    let content;
    try {
      content = await fetchRawYaml(file);
    } catch (error) {
      incomplete.rawFiles += 1;
      console.warn(
        `skip ${file.root.repo}:${file.filePath} raw YAML: ${error.message}`,
      );
      return null;
    }

    let doc;
    let citations;
    try {
      doc = parseRuleSpec(content);
      citations = ruleCitationRows(
        doc,
        file.citationPath,
        file.filePath,
        file.root.repo,
        file.root.jurisdiction,
      );
    } catch (error) {
      incomplete.invalidFiles += 1;
      console.warn(
        `skip ${file.root.repo}:${file.filePath} indexing: ${error.message}`,
      );
      return null;
    }
    const citationPathSets = citationPathSetsForFile(
      content,
      `${file.root.repo}:${file.filePath}`,
    );
    const syncedAt = new Date().toISOString();
    return {
      fileRow: {
        citation_path: file.citationPath,
        file_path: file.filePath,
        repo: file.root.repo,
        branch: file.root.branch,
        jurisdiction: file.root.jurisdiction,
        bucket: file.bucket,
        raw_yaml: content,
        ...executionClassification(content, doc, file.bucket),
        search_text: buildSearchText(file, doc),
        source_citation_paths: citationPathSets.all,
        value_citation_paths: citationPathSets.values,
        ...(hasCommitColumn ? { commit_sha: file.root.commit ?? null } : {}),
        synced_at: syncedAt,
      },
      ruleCitationRows: citations.map((row) => ({
        ...row,
        synced_at: syncedAt,
      })),
    };
  })
).filter(Boolean);

const rows = indexedFiles.map(({ fileRow }) => fileRow);

let upserted = 0;
for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
  const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
  await writeWithRetries(`rulespec_files upsert at chunk ${i}`, () =>
    supabase.from("rulespec_files").upsert(chunk, {
      onConflict: "citation_path",
    }),
  );
  upserted += chunk.length;
}
console.log(`${upserted} rows upserted`);

// Replace each synced module's materialized rules before inserting its
// current rows; modules that now cite nothing lose their old rows too.
const ruleCitationRowsUpserted = await replaceRuleCitations(
  supabase,
  indexedFiles,
  {
    write: writeWithRetries,
    moduleChunkSize: RULE_CITATION_DELETE_CHUNK_SIZE,
    rowChunkSize: RULE_CITATION_UPSERT_CHUNK_SIZE,
    chunkBudgetBytes: RULE_CITATION_CHUNK_BUDGET_BYTES,
  },
);
console.log(`${ruleCitationRowsUpserted} rule citation rows upserted`);
console.log(
  `${indexedFiles.filter(({ ruleCitationRows: moduleRows }) => moduleRows.length === 0).length} modules with zero rule citations`,
);

const incompleteReasons = [
  incomplete.emptyDiscovery ? "discovery returned no roots" : null,
  incomplete.discoveryTrees > 0
    ? `${incomplete.discoveryTrees} skipped discovery tree(s)`
    : null,
  incomplete.rootListings > 0
    ? `${incomplete.rootListings} incomplete root listing(s)`
    : null,
  incomplete.rawFiles > 0
    ? `${incomplete.rawFiles} raw YAML fetch failure(s)`
    : null,
  incomplete.invalidFiles > 0
    ? `${incomplete.invalidFiles} invalid or unindexable YAML file(s)`
    : null,
].filter(Boolean);

if (incompleteReasons.length > 0) {
  console.warn(
    `stale cleanup skipped because the sync was incomplete: ${incompleteReasons.join(
      ", ",
    )}`,
  );
} else {
  // Rows not touched by a complete run no longer exist upstream.
  const removed = await removeStaleRows(supabase, startedAt, {
    write: writeWithRetries,
  });
  console.log(`${removed.files} stale rows removed`);
  console.log(`${removed.ruleCitations} stale rule citation rows removed`);
}
