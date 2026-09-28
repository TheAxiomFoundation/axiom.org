/**
 * Runtime ``app_visibility`` gate for the encoding readers.
 *
 * ``discoverRoots()`` (scripts/lib/rulespec-discovery.mjs) and the
 * encoded-search fallback both refuse to index a ``rulespec-*`` repo
 * that declares ``app_visibility = "experimental"`` in
 * ``.axiom/registry.toml``. The request-time readers —
 * ``listEncodedFiles``, ``fetchEncodedFile``,
 * ``fetchRuleSpecFromGitHub`` — resolved a repo straight out of the
 * repo map and skipped that gate, so a mapped-but-gated pilot repo's
 * YAML was listable and servable while discovery still excluded it.
 * Everything that reads encodings now funnels through
 * ``ruleSpecReadLocation`` instead of ``getRuleSpecRepoLocation``.
 *
 * Two layers, deliberately different in how they fail:
 *
 *  - the **registered** gate in ``repo-map.ts`` (``appVisibility`` on
 *    the family) is synchronous and fails CLOSED — a pilot repo is
 *    unreadable with no network call at all, so a GitHub outage or a
 *    rate limit cannot open it;
 *  - the **live** gate here re-reads the repo's own
 *    ``.axiom/registry.toml`` and fails OPEN — an absent file, an
 *    absent key, or a fetch failure means "public", so a hiccup can't
 *    blank a live country's tiles. It catches a repo that gates itself
 *    upstream between app deploys, which is the same contract
 *    ``discoverRoots()`` and ``lib/axiom/search.ts`` already keep.
 */
import {
  getRuleSpecRepoLocation,
  gitHubApiHeaders,
  isRuleSpecRepoInAppReadList,
  type RuleSpecRepoLocation,
} from "@/lib/axiom/repo-map";
import { parseAppVisibility } from "@/lib/axiom/registry-visibility";
import { cachedRawFetch } from "./raw-cache";

const GITHUB_ORG = "TheAxiomFoundation";

/** Matches the encoded-file listing's cache window. */
const REVALIDATE_SECONDS = 600;

function registryTomlUrl(repo: string): string {
  return `https://raw.githubusercontent.com/${GITHUB_ORG}/${repo}/main/.axiom/registry.toml`;
}

/**
 * The visibility a repo declares for itself right now. Deduped and
 * cached per URL by ``cachedRawFetch``, so a page render that lists
 * and then serves several files costs one extra request per repo.
 */
export async function fetchRuleSpecRepoVisibility(repo: string) {
  const res = await cachedRawFetch(registryTomlUrl(repo), {
    headers: gitHubApiHeaders(),
    next: { revalidate: REVALIDATE_SECONDS },
  } as RequestInit);
  if (!res.ok) return "public" as const;
  return parseAppVisibility(res.body);
}

/**
 * Whether the app may read a repo's encodings: it is on the read list
 * (registered gate) and does not currently gate itself (live gate).
 */
export async function isRuleSpecRepoReadable(repo: string): Promise<boolean> {
  if (!isRuleSpecRepoInAppReadList(repo)) return false;
  return (await fetchRuleSpecRepoVisibility(repo)) !== "experimental";
}

/**
 * Where to read a jurisdiction's encodings, or ``null`` when the app
 * must not read them. The gated replacement for
 * ``getRuleSpecRepoLocation`` on every request-time read path.
 */
export async function ruleSpecReadLocation(
  jurisdiction: string
): Promise<RuleSpecRepoLocation | null> {
  const location = getRuleSpecRepoLocation(jurisdiction);
  if (!location) return null;
  return (await isRuleSpecRepoReadable(location.repo)) ? location : null;
}
