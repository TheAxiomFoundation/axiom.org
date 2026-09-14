import type { AppVisibility } from "@/lib/axiom/registry-visibility";

/**
 * The country family table, in a module of its own so a test can mock
 * it (``vi.mock("@/lib/axiom/rulespec-families", ...)``) with a
 * synthetic gated family: with every real family public, the gate has
 * no live instance to test against.
 */
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
  // rulespec-il is a bounded, uncertified pilot with no oracle wired;
  // public on Max's call of 2026-09-07 ("similar treatment to Belgium"):
  // a country tile on the app landing, listed and searchable, never
  // featured on the marketing homepage (which features no country).
  { slug: "il", repo: "rulespec-il", appVisibility: "public" },
] as const);
