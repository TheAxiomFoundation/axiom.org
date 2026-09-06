/**
 * Single source of truth for "where do a jurisdiction's RuleSpec
 * encodings live on GitHub?". Consumed by the server-side fallback
 * fetcher (``lib/supabase.ts::fetchRuleSpecFromGitHub``), the encoded
 * index, the encoded-file listing, and the client-side "View on
 * GitHub" links. Keeping the layout here prevents those surfaces from
 * drifting.
 *
 * Layout: most ``rulespec-*`` repos are monorepos keyed by jurisdiction
 * directory at the top level — federal and every state share
 * ``rulespec-us`` under ``us/``, ``us-ca/``, ``us-al/``, …; UK and its
 * localities share ``rulespec-uk`` under ``uk/``, ``uk-…/``; Belgium
 * and its regional/community modules share ``rulespec-be`` under
 * ``be/``, ``be-bru/``, ``be-vlg/``, ``be-wal/``, …. Some repos
 * hold a single jurisdiction with the buckets at the repo root instead:
 * ``rulespec-ca`` keeps Canada's encodings directly under
 * ``statutes/`` | ``regulations/`` | ``policies/`` with no ``ca/``
 * prefix (see its ``.axiom/repository-structure.yaml``). Either way the
 * bucket-rooted path is the shape the rest of the Axiom app speaks once
 * any prefix is stripped.
 *
 * Keys are the axiom's canonical jurisdiction slugs as they land in
 * ``jurisdiction`` on corpus provision rows — so ``ca`` for Canada
 * (short codes per the corpus citation-path schema). A jurisdiction whose family has no published
 * repo returns ``null``; a jurisdiction that maps to a repo but has no
 * directory there yet just resolves to an empty file listing, so the
 * UI degrades gracefully into "Not yet encoded" without a hard-coded
 * allow-list that drifts as new states are encoded.
 *
 * Two questions this module answers, kept deliberately apart because
 * conflating them shipped a bug in both directions:
 *
 *  1. **Which countries does the app *present*?** — ``RULESPEC_FAMILIES``
 *     / ``RULESPEC_COUNTRY_SLUGS``. Every family the map knows,
 *     including one whose repo is still a gated pilot: the landing
 *     shows it as a country tile marked pending, which is how a reader
 *     learns work is under way.
 *  2. **Which repos does the app *read*?** — ``RULESPEC_REPOS`` and the
 *     ``getRuleSpecRepoLocation`` gate below. Only families registered
 *     ``app_visibility = "public"``. A gated repo resolves to ``null``
 *     here, so every URL builder and every runtime reader that funnels
 *     through the location refuses to list or serve its encodings.
 *
 * ``RULESPEC_COUNTRY_SLUGS`` used to be derived from ``RULESPEC_REPOS``,
 * which made (1) a consequence of (2): a gated country silently lost
 * its tile and fell through to the "Other" chip row with no pending
 * label. Deriving both from the family table fixes that without making
 * a pilot repo readable.
 */

import type { AppVisibility } from "./registry-visibility";

const GITHUB_ORG = "TheAxiomFoundation";

export interface RuleSpecRepoLocation {
  /** GitHub repo name, e.g. ``rulespec-us``. */
  repo: string;
  /**
   * Top-level directory within the monorepo holding this
   * jurisdiction's encodings — the jurisdiction slug for
   * jurisdiction-dir monorepos, or ``""`` for single-jurisdiction
   * repos whose buckets sit at the repo root (``rulespec-ca``).
   */
  prefix: string;
}

/**
 * One country family: the country-level slug, the repo its encodings
 * live in, that repo's layout, and the ``app_visibility`` the repo
 * declares in its ``.axiom/registry.toml``.
 */
export interface RuleSpecFamily {
  /** Country-level jurisdiction slug — ``us``, ``ca``, ``il``. */
  slug: string;
  /** GitHub repo holding the family's encodings. */
  repo: string;
  /**
   * ``true`` when the repo holds exactly one jurisdiction with the
   * buckets at the repo root (``rulespec-ca``) — no jurisdiction-dir
   * prefix, and so no ``<slug>-…`` sub-jurisdiction resolves to it.
   * Mirrors ``jurisdictionFromRepoName`` in
   * ``scripts/sync-rulespec-index.mjs``.
   */
  rootLayout?: boolean;
  /**
   * The repo's registered ``app_visibility``, mirroring its
   * ``.axiom/registry.toml``. ``experimental`` repos are *presented*
   * (a pending country tile on the landing) but never *read*: the
   * location resolver below returns ``null`` for them, which is the
   * same gate ``discoverRoots()`` applies to the search index.
   * Promoting a repo is a two-key change — flip the marker in the
   * rulespec repo AND this entry; ``scripts/check-rulespec-drift.mjs``
   * fails when the two disagree.
   */
  appVisibility: AppVisibility;
}

/**
 * Every country family the app knows, in landing-display order.
 * Adding a country is one entry here plus a ``jurisdictions-seed.ts``
 * label (``repo-map.test.ts`` fails the PR when the two disagree).
 */
export const RULESPEC_FAMILIES: readonly RuleSpecFamily[] = Object.freeze([
  { slug: "us", repo: "rulespec-us", appVisibility: "public" },
  { slug: "uk", repo: "rulespec-uk", appVisibility: "public" },
  { slug: "be", repo: "rulespec-be", appVisibility: "public" },
  { slug: "ca", repo: "rulespec-ca", rootLayout: true, appVisibility: "public" },
  { slug: "nz", repo: "rulespec-nz", appVisibility: "public" },
  // Israel — ISO 3166-1 ``il``, jurisdiction-dir monorepo (``il/``),
  // same layout as NZ. Distinct from Illinois (``us-il``), which the
  // ``us`` entry above claims first. rulespec-il is a bounded pilot
  // carrying ``app_visibility = "experimental"``, so it is presented
  // as a pending country and read by nothing.
  { slug: "il", repo: "rulespec-il", appVisibility: "experimental" },
] as const);

/**
 * The family a jurisdiction slug belongs to — the country itself
 * (``uk``) or one of its sub-jurisdictions (``uk-kingston-upon-thames``).
 * Root-layout repos hold a single jurisdiction, so no ``<slug>-…``
 * prefix resolves to them.
 *
 * This is the *family* map, deliberately ungated: it answers "whose
 * encodings would these be?", which the landing tile and
 * ``check-rulespec-drift.mjs`` both need for repos the app cannot yet
 * read. Use ``getRuleSpecRepoLocation`` (or
 * ``ruleSpecReadLocation`` in ``rulespec/visibility.ts``) to answer
 * "may the app read this?".
 */
export function ruleSpecFamilyForJurisdiction(
  jurisdiction: string
): RuleSpecFamily | null {
  for (const family of RULESPEC_FAMILIES) {
    if (jurisdiction === family.slug) return family;
    if (!family.rootLayout && jurisdiction.startsWith(`${family.slug}-`)) {
      return family;
    }
  }
  return null;
}

/**
 * The jurisdiction a root-layout repo holds, or ``null`` for
 * jurisdiction-dir monorepos.
 */
export function ruleSpecRepoRootJurisdiction(repo: string): string | null {
  const family = RULESPEC_FAMILIES.find((f) => f.repo === repo);
  return family?.rootLayout ? family.slug : null;
}

/**
 * The registered ``app_visibility`` for a jurisdiction's family, or
 * ``null`` when no family claims the slug. Presentation surfaces use
 * this to say *why* a country tile is pending ("encoding in progress")
 * rather than just that it has no rules.
 */
export function ruleSpecFamilyAppVisibility(
  jurisdiction: string
): AppVisibility | null {
  return ruleSpecFamilyForJurisdiction(jurisdiction)?.appVisibility ?? null;
}

/** The registered ``app_visibility`` for a repo, or ``null`` if unknown. */
export function ruleSpecRepoAppVisibility(repo: string): AppVisibility | null {
  return RULESPEC_FAMILIES.find((f) => f.repo === repo)?.appVisibility ?? null;
}

/**
 * Whether the app may read a jurisdiction's encodings at all: it has a
 * family, and that family's repo is registered ``public``. Fail-closed
 * — an unknown repo is not readable.
 */
export function isAppReadableJurisdiction(jurisdiction: string): boolean {
  return ruleSpecFamilyAppVisibility(jurisdiction) === "public";
}

/** Whether a repo is one the app reads encodings from. */
export function isRuleSpecRepoInAppReadList(repo: string): boolean {
  return ruleSpecRepoAppVisibility(repo) === "public";
}

/**
 * The repo a jurisdiction's encodings live in, regardless of whether
 * the app may read them. See ``ruleSpecFamilyForJurisdiction``.
 */
export function getRuleSpecRepoForJurisdiction(
  jurisdiction: string
): string | null {
  return ruleSpecFamilyForJurisdiction(jurisdiction)?.repo ?? null;
}

/**
 * Where to read a jurisdiction's encodings — **gated**. Returns
 * ``null`` both for a slug no family claims and for one whose family
 * is registered ``app_visibility = "experimental"``, so every URL
 * builder below and every runtime reader that funnels through it
 * refuses a gated pilot repo without a network round trip. The live
 * ``.axiom/registry.toml`` check layered on top of this lives in
 * ``rulespec/visibility.ts``.
 */
export function getRuleSpecRepoLocation(
  jurisdiction: string
): RuleSpecRepoLocation | null {
  const family = ruleSpecFamilyForJurisdiction(jurisdiction);
  if (!family || family.appVisibility !== "public") return null;
  const prefix = family.rootLayout ? "" : jurisdiction;
  return { repo: family.repo, prefix };
}

/** Join a location's prefix onto a bucket-rooted path (no leading slash). */
function prefixedPath(loc: RuleSpecRepoLocation, path: string): string {
  return loc.prefix ? `${loc.prefix}/${path}` : path;
}

/**
 * Build a ``raw.githubusercontent.com`` URL for a bucket-rooted repo
 * path (e.g. ``statutes/26/32.yaml``). Injects the jurisdiction-dir
 * prefix that the monorepo layout requires. Returns ``null`` when the
 * jurisdiction has no published repo.
 */
export function ruleSpecRawFileUrl(
  jurisdiction: string,
  bucketRootedPath: string
): string | null {
  const loc = getRuleSpecRepoLocation(jurisdiction);
  if (!loc) return null;
  return ruleSpecRawFileUrlForLocation(loc, bucketRootedPath);
}

/**
 * ``ruleSpecRawFileUrl`` for a location a caller already resolved —
 * used by the request-time readers, which resolve through the gated
 * ``ruleSpecReadLocation`` and would otherwise re-resolve (and
 * re-check) the same jurisdiction.
 */
export function ruleSpecRawFileUrlForLocation(
  loc: RuleSpecRepoLocation,
  bucketRootedPath: string
): string {
  return `https://raw.githubusercontent.com/${GITHUB_ORG}/${loc.repo}/main/${prefixedPath(loc, bucketRootedPath)}`;
}

/**
 * Build a ``github.com/…/blob/main`` URL for a bucket-rooted repo path
 * — the human-facing "View on GitHub" link. Returns ``null`` when the
 * jurisdiction has no published repo.
 */
export function ruleSpecBlobUrl(
  jurisdiction: string,
  bucketRootedPath: string
): string | null {
  const loc = getRuleSpecRepoLocation(jurisdiction);
  if (!loc) return null;
  return `https://github.com/${GITHUB_ORG}/${loc.repo}/blob/main/${prefixedPath(loc, bucketRootedPath)}`;
}

/**
 * Build a ``github.com/…/tree/main`` URL pointing at the
 * jurisdiction's directory within its monorepo — used by the encoded
 * index to link a jurisdiction group to its source on GitHub.
 */
export function ruleSpecRepoTreeUrl(jurisdiction: string): string | null {
  const loc = getRuleSpecRepoLocation(jurisdiction);
  if (!loc) return null;
  return loc.prefix
    ? `https://github.com/${GITHUB_ORG}/${loc.repo}/tree/main/${loc.prefix}`
    : `https://github.com/${GITHUB_ORG}/${loc.repo}/tree/main`;
}

/**
 * Build the GitHub git-trees API URL for a single jurisdiction's
 * subtree (``git/trees/main:<jurisdiction>``). Scoping to the
 * jurisdiction directory keeps each response small enough to sit
 * inside Next's fetch-cache size limit — the whole-monorepo recursive
 * tree is several MB and cannot be cached, which would re-hit GitHub on
 * every browse and blow the unauthenticated rate limit.
 */
export function ruleSpecRepoSubtreeApiUrl(
  repo: string,
  prefix: string
): string {
  // Root-layout repos (empty prefix) list the whole repo tree — they
  // hold a single jurisdiction, so the response stays small enough for
  // the fetch cache, unlike the multi-jurisdiction monorepos.
  const ref = prefix ? `main:${prefix}` : "main";
  return `https://api.github.com/repos/${GITHUB_ORG}/${repo}/git/trees/${ref}?recursive=1`;
}

/**
 * Build the GitHub git-trees API URL for a repo's top-level (non
 * recursive) tree — used to discover which jurisdiction directories a
 * monorepo actually contains, so the encoded index lists only
 * populated jurisdictions instead of probing every conceivable slug.
 */
export function ruleSpecRepoRootTreeApiUrl(repo: string): string {
  return `https://api.github.com/repos/${GITHUB_ORG}/${repo}/git/trees/main`;
}

/**
 * The **read list**: monorepos the Axiom app lists and serves
 * encodings from. Gated pilot repos are absent, which is also what
 * ``scripts/check-rulespec-drift.mjs`` asserts against discovery —
 * discovery skips ``app_visibility = "experimental"`` repos, so an
 * entry here for a gated repo would fail the drift check.
 */
export const RULESPEC_REPOS: readonly string[] = RULESPEC_FAMILIES.filter(
  (family) => family.appVisibility === "public"
).map((family) => family.repo);

/**
 * The **presentation list**: country-level (family-root) slugs in
 * landing-display order, including families whose repo is still gated.
 * A gated country renders as a real country tile marked pending —
 * separate from ``RULESPEC_REPOS`` on purpose, because deriving this
 * from the read list dropped a pending country out of the country row
 * and into the anonymous "Other" chips.
 */
export const RULESPEC_COUNTRY_SLUGS: readonly string[] = RULESPEC_FAMILIES.map(
  (family) => family.slug
);

/**
 * Headers for GitHub git-trees API requests. Unauthenticated requests
 * are capped at 60/hour per IP — tight for the encoded index, which
 * reads several jurisdiction subtrees. When ``GITHUB_TOKEN`` is set
 * (recommended in production) the calls authenticate and the limit
 * rises to 5,000/hour; without it the behaviour is unchanged.
 */
export function gitHubApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const token =
    cleanTokenValue(process.env.AXIOM_GITHUB_TOKEN) ??
    cleanTokenValue(process.env.GITHUB_TOKEN) ??
    cleanTokenValue(process.env.GH_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Vercel-managed secrets sometimes carry a trailing newline (stored
 * verbatim, escaped to a literal ``\n`` by ``vercel env pull``). Either
 * form corrupts the Authorization header into a guaranteed 401, which
 * is worse than sending no token at all — so strip both before use.
 */
function cleanTokenValue(value: string | undefined): string | undefined {
  const cleaned = value?.replaceAll("\\n", "").trim();
  return cleaned || undefined;
}
