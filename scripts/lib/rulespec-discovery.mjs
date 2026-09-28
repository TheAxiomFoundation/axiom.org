/**
 * Shared discovery of jurisdiction roots across the org's rulespec-*
 * GitHub repos. Used by sync-rulespec-index.mjs (to build the encoded
 * search index) and check-rulespec-drift.mjs (to fail CI when a
 * discovered jurisdiction isn't wired into the app) — one
 * implementation so the two can't drift apart.
 */

export const GITHUB_ORG = "TheAxiomFoundation";

export const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

export async function githubJson(url) {
  const res = await fetch(url, { headers: githubHeaders });
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${url}`);
  return res.json();
}

/**
 * Top-level directories that hold encodings — used to recognise a
 * populated root-layout repo. Mirrors RULESPEC_BUCKETS in
 * src/lib/axiom/rulespec/repo-listing.ts.
 */
export const RULESPEC_BUCKETS = new Set([
  "statutes",
  "regulations",
  "policies",
  "manuals",
  "rulemaking",
  "forms",
  "guidance",
]);

function isJurisdictionSegment(value) {
  // Mirror the JURISDICTION_DIR_RE the rulespec repos' own layout tests
  // enforce (^[a-z]{2}(-[a-z0-9-]+)*$): a bare ISO-3166-style alpha-2 code
  // (us, uk, gh, ng, ...) or a compound sub-jurisdiction (us-co, be-vlg,
  // uk-kingston-upon-thames). A hardcoded allowlist here silently dropped
  // new countries from the encoded-search index (gh and ng never synced).
  return /^[a-z]{2}(-[a-z0-9-]+)*$/.test(value);
}

function jurisdictionFromRepoName(repoName) {
  const suffix = repoName.replace(/^rulespec-/, "");
  if (!suffix || suffix === repoName) return null;
  return suffix;
}

/**
 * App-surface visibility marker (.axiom/registry.toml). Absent file/key or
 * any fetch failure means "public" so a hiccup can't hide a live country;
 * an explicit `app_visibility = "experimental"` keeps a repo off the
 * encoded-search index (stale rows are removed by the end-of-run cleanup).
 * Parsed line-wise — keep the marker in simple `key = "value"` form.
 */
async function fetchAppVisibility(repo) {
  const url = `https://raw.githubusercontent.com/${GITHUB_ORG}/${repo.name}/${repo.default_branch}/.axiom/registry.toml`;
  const res = await fetch(url, { headers: githubHeaders }).catch(() => null);
  if (!res || !res.ok) return "public";
  const text = await res.text().catch(() => null);
  if (!text) return "public";
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*app_visibility\s*=\s*"([a-z]+)"\s*(?:#.*)?$/);
    if (match) return match[1] === "experimental" ? "experimental" : "public";
  }
  return "public";
}

/**
 * Discover jurisdiction roots across the org's rulespec-* repos:
 * monorepos with per-jurisdiction directories (rulespec-us → us/,
 * us-co/, …) and standalone repos with buckets at top level
 * (rulespec-ca). Repos gated `app_visibility = "experimental"` are
 * skipped, as are archived repos — an archived repo is read-only, so
 * it can never flip its own visibility marker, and a parked lane's
 * encodings don't belong on app surfaces (rulespec-tz-znz).
 * ``onIncomplete`` is notified when a repository tree cannot be
 * inspected, allowing destructive consumers to suppress stale cleanup.
 */
export async function discoverRoots(onIncomplete) {
  const repos = await githubJson(
    `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&type=all&sort=pushed`
  );
  const roots = [];
  for (const repo of repos) {
    if (!repo.name.startsWith("rulespec-")) continue;
    if (repo.archived) {
      console.log(`skip ${repo.name}: archived`);
      continue;
    }
    if ((await fetchAppVisibility(repo)) === "experimental") {
      console.log(`skip ${repo.name}: app_visibility=experimental`);
      continue;
    }
    let tree;
    try {
      tree = await githubJson(
        `https://api.github.com/repos/${GITHUB_ORG}/${repo.name}/git/trees/${repo.default_branch}`
      );
    } catch (error) {
      console.warn(`skip ${repo.name}: ${error.message}`);
      onIncomplete?.({ repo: repo.name, error });
      continue;
    }
    if (!Array.isArray(tree.tree)) {
      const error = new Error("GitHub tree response did not contain entries");
      console.warn(`skip ${repo.name}: ${error.message}`);
      onIncomplete?.({ repo: repo.name, error });
      continue;
    }
    const entries = tree.tree;
    const jurisdictionDirs = entries
      .filter(
        (entry) => entry.type === "tree" && isJurisdictionSegment(entry.path)
      )
      .map((entry) => entry.path);
    if (jurisdictionDirs.length > 0) {
      for (const jurisdiction of jurisdictionDirs) {
        roots.push({
          repo: repo.name,
          branch: repo.default_branch,
          jurisdiction,
          prefix: jurisdiction,
        });
      }
      continue;
    }
    if (
      entries.some(
        (entry) => entry.type === "tree" && RULESPEC_BUCKETS.has(entry.path)
      )
    ) {
      const jurisdiction = jurisdictionFromRepoName(repo.name);
      if (jurisdiction) {
        roots.push({
          repo: repo.name,
          branch: repo.default_branch,
          jurisdiction,
          prefix: null,
        });
      }
    }
  }
  return roots;
}
