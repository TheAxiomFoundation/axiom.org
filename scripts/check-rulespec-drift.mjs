#!/usr/bin/env bun
/**
 * Fail CI when the org's rulespec-* repos and the app's static wiring
 * drift apart. Runs on the same schedule as the search-index sync.
 *
 * The app derives almost everything from src/lib/axiom/repo-map.ts and
 * jurisdictions-seed.ts, but those two files are still written by
 * hand when a country launches. Every gap this script checks for has
 * shipped as a real bug before:
 *
 *  - a public repo whose jurisdictions the repo map can't place
 *    (rulespec-nz sat invisible for 36 encodings),
 *  - a country slug with no seed entry (no label, no landing tile),
 *  - a root-layout repo missing its registration (paths would get a
 *    bogus jurisdiction-dir prefix),
 *  - a RULESPEC_REPOS entry that no longer matches a real, public,
 *    populated repo (rename/gating would silently empty a tile),
 *  - a repo that went public upstream while the app still gates it
 *    (its encodings would stay unreadable, and its country tile stuck
 *    on "pilot · pending", until someone edits repo-map.ts).
 *
 * Usage: [GITHUB_TOKEN=...] bun scripts/check-rulespec-drift.mjs
 */

import {
  RULESPEC_REPOS,
  getRuleSpecRepoForJurisdiction,
  ruleSpecFamilyAppVisibility,
  ruleSpecRepoRootJurisdiction,
} from "../src/lib/axiom/repo-map.ts";
import { JURISDICTIONS_SEED } from "../src/lib/axiom/jurisdictions-seed.ts";
import { discoverRoots } from "./lib/rulespec-discovery.mjs";

const roots = await discoverRoots();
if (roots.length === 0) {
  console.error("discovery returned no jurisdiction roots — GitHub outage?");
  process.exit(1);
}
console.log(`${roots.length} jurisdiction roots discovered`);

const problems = [];

// Every discovered public jurisdiction must resolve to a repo family.
for (const root of roots) {
  if (getRuleSpecRepoForJurisdiction(root.jurisdiction) === null) {
    problems.push(
      `${root.repo} holds "${root.jurisdiction}" encodings but repo-map.ts has no family for it — ` +
        `either gate the repo (app_visibility = "experimental" in .axiom/registry.toml, the scaffold ` +
        `form in the gated rulespec repos) until its listing gates hold, or promote it: add it to ` +
        `repoForJurisdiction and RULESPEC_REPOS plus a jurisdictions-seed.ts entry`
    );
  }
}

// Promotion is a two-key change: the rulespec repo drops
// app_visibility = "experimental" AND repo-map.ts flips the family to
// "public". discoverRoots() only yields public repos, so a discovered
// jurisdiction the app still gates means the second key is missing —
// its encodings stay unreadable and its tile stuck on pending.
for (const root of roots) {
  if (ruleSpecFamilyAppVisibility(root.jurisdiction) === "experimental") {
    problems.push(
      `${root.repo} is public and holds "${root.jurisdiction}" encodings, but repo-map.ts still ` +
        `registers that family appVisibility: "experimental" — the app will neither list nor serve ` +
        `them. Flip the RULESPEC_FAMILIES entry to "public" (that also adds the repo to ` +
        `RULESPEC_REPOS), or re-gate the repo's .axiom/registry.toml`
    );
  }
}

// Every discovered country-level slug needs a seed entry (label, tile).
const seedSlugs = new Set(JURISDICTIONS_SEED.map((j) => j.slug));
const countrySlugs = new Set(
  roots.map((r) => r.jurisdiction).filter((slug) => !slug.includes("-"))
);
for (const slug of countrySlugs) {
  if (!seedSlugs.has(slug)) {
    problems.push(
      `jurisdiction "${slug}" has encodings but no jurisdictions-seed.ts entry — no label or landing tile`
    );
  }
}

// A root-layout repo the app reads must be registered, or every path
// it serves gets a bogus jurisdiction-dir prefix.
const appRepos = new Set(RULESPEC_REPOS);
for (const root of roots) {
  if (root.prefix !== null || !appRepos.has(root.repo)) continue;
  if (ruleSpecRepoRootJurisdiction(root.repo) !== root.jurisdiction) {
    problems.push(
      `${root.repo} is a root-layout repo for "${root.jurisdiction}" but is not registered in ` +
        `ROOT_LAYOUT_REPO_JURISDICTIONS in repo-map.ts`
    );
  }
}

// Every repo the app reads must still exist, be public, and hold
// encodings — otherwise its tiles quietly empty out.
const discoveredRepos = new Set(roots.map((r) => r.repo));
for (const repo of RULESPEC_REPOS) {
  if (!discoveredRepos.has(repo)) {
    problems.push(
      `${repo} is listed in RULESPEC_REPOS but discovery found no encodings — renamed, emptied, ` +
        `archived, or gated app_visibility=experimental?`
    );
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} drift problem(s):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("no drift: repos, repo map, and seed agree");
