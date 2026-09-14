import {
  gitHubApiHeaders,
  isAppReadableJurisdiction,
  ruleSpecRawFileUrlForLocation,
  ruleSpecRepoRootJurisdiction,
  ruleSpecRepoRootTreeApiUrl,
  ruleSpecRepoSubtreeApiUrl,
  RULESPEC_REPOS,
} from "@/lib/axiom/repo-map";
import { cachedRawFetch } from "./raw-cache";
import { isRuleSpecRepoReadable, ruleSpecReadLocation } from "./visibility";

/**
 * Fetch the list of RuleSpec encoding files in a jurisdiction's
 * ``rulespec-*`` GitHub repo. Filters down to ``.yaml`` files that are
 * actual encodings (not ``.test.yaml`` test fixtures, not
 * ``.meta.yaml`` source-target overlays).
 *
 * The Axiom app's encoded-rules surface uses this to render a directory
 * of every encoding that exists in the canonical repos today —
 * independent of the corpus DB's ``has_rulespec`` flag, which is
 * out-of-date for most jurisdictions during the rolling migration.
 */
export interface EncodedFile {
  /** Repo-relative path, e.g. ``statutes/26/3101/a.yaml``. */
  filePath: string;
  /** Citation path, e.g. ``us/statute/26/3101/a``. Bucket-renamed
   *  back to the singular form the rest of the Axiom app speaks. */
  citationPath: string;
  /** Top-level bucket: ``statutes`` | ``regulations`` | ``policies``
   *  | other. Useful for grouping in the index UI. */
  bucket: string;
}

const REPO_TO_CITATION_BUCKET: Readonly<Record<string, string>> = Object.freeze({
  statutes: "statute",
  regulations: "regulation",
  policies: "policy",
});

/**
 * Top-level directories that hold encodings. Mirrors RULESPEC_BUCKETS in
 * scripts/sync-rulespec-index.mjs. Used to recognise a populated
 * root-layout repo during jurisdiction discovery.
 */
const RULESPEC_BUCKETS: ReadonlySet<string> = new Set([
  "statutes",
  "regulations",
  "policies",
  "manuals",
  "rulemaking",
  "forms",
  "guidance",
]);

/**
 * Top-level segments that are repo plumbing rather than encoding
 * buckets: dot-dirs (``.axiom/`` manifests, ``.github/``) and
 * ``sources/`` (corpus source slices that mirror the encodings as
 * plain YAML). Root-layout repos keep these beside the buckets, so a
 * whole-repo listing must skip them; a denylist (rather than a bucket
 * allowlist) keeps open-ended buckets like UK ``legislation/`` working.
 */
function isRepoPlumbingSegment(segment: string): boolean {
  return segment.startsWith(".") || segment === "sources";
}

interface GitHubTreeEntry {
  path: string;
  type: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

const REVALIDATE_SECONDS = 600;

/**
 * Fetch and filter the encoded-file listing for one jurisdiction.
 * Returns an empty list when the jurisdiction has no repo or the API
 * call fails — the caller renders that as "no encodings yet" instead
 * of surfacing the network error.
 *
 * The ``rulespec-*`` repos are monorepos shared across a whole
 * jurisdiction family (federal + every state live in ``rulespec-us``
 * under ``us/``, ``us-ca/``, …). We fetch just the requested
 * jurisdiction's subtree, which keeps each response small enough to
 * cache (the full monorepo tree is several MB — over Next's cache
 * limit — so caching it fails and every browse re-hits GitHub) and
 * returns bucket-rooted paths the parser already understands.
 */
export async function listEncodedFiles(
  jurisdiction: string
): Promise<EncodedFile[]> {
  // ``ruleSpecReadLocation`` — not ``getRuleSpecRepoLocation`` — so a
  // repo the app maps but must not read (``app_visibility =
  // "experimental"``) lists nothing, the same gate ``discoverRoots()``
  // applies to the search index.
  const loc = await ruleSpecReadLocation(jurisdiction);
  if (!loc) return [];
  const body = await fetchTree(
    ruleSpecRepoSubtreeApiUrl(loc.repo, loc.prefix)
  );
  return parseTreeEntries(body, jurisdiction);
}

/**
 * Discover which jurisdictions actually have encodings across the
 * ``rulespec-*`` repos. Reads each repo's top-level tree (one small
 * request per repo); for jurisdiction-dir monorepos it keeps the
 * directories that name a jurisdiction, and for root-layout repos
 * (``rulespec-ca``) it adds the repo's single jurisdiction when any
 * bucket directory exists at the root. Lets the encoded index list
 * exactly the populated jurisdictions without probing every
 * conceivable slug (which would burn the unauthenticated GitHub rate
 * limit on 404s).
 */
export async function listRuleSpecJurisdictions(): Promise<string[]> {
  const trees = await Promise.all(
    RULESPEC_REPOS.map(async (repo) =>
      (await isRuleSpecRepoReadable(repo))
        ? fetchTree(ruleSpecRepoRootTreeApiUrl(repo))
        : null
    )
  );
  const slugs = new Set<string>();
  for (const [index, body] of trees.entries()) {
    if (!body || !Array.isArray(body.tree)) continue;
    const rootJurisdiction = ruleSpecRepoRootJurisdiction(
      RULESPEC_REPOS[index]
    );
    for (const entry of body.tree) {
      if (entry.type !== "tree") continue;
      if (rootJurisdiction) {
        if (RULESPEC_BUCKETS.has(entry.path)) slugs.add(rootJurisdiction);
      } else if (isAppReadableJurisdiction(entry.path)) {
        // A gated family's directory inside a repo the app *does* read
        // is still not listable — the index must not name a
        // jurisdiction whose files it would refuse to serve.
        slugs.add(entry.path);
      }
    }
  }
  return [...slugs];
}

async function fetchTree(url: string): Promise<GitHubTreeResponse | null> {
  try {
    const res = await fetch(url, {
      headers: gitHubApiHeaders(),
      next: { revalidate: REVALIDATE_SECONDS },
    } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as GitHubTreeResponse;
  } catch {
    return null;
  }
}

/**
 * Pure transform from a jurisdiction's GitHub subtree to encoded-file
 * records. Exposed for testing.
 *
 * The subtree is rooted at the jurisdiction directory, so its paths are
 * already bucket-rooted (``statutes/26/32.yaml``, ``regulations/…``) —
 * the same shape ``EncodedFile.filePath`` and the rest of the Axiom app
 * speak.
 */
export function parseTreeEntries(
  body: GitHubTreeResponse | null,
  jurisdiction: string
): EncodedFile[] {
  if (!body || !Array.isArray(body.tree)) return [];
  const out: EncodedFile[] = [];
  for (const entry of body.tree) {
    if (entry.type !== "blob") continue;
    if (!isEncodingFile(entry.path)) continue;
    const stripped = entry.path.replace(/\.yaml$/, "");
    const segs = stripped.split("/");
    const repoBucket = segs[0];
    if (isRepoPlumbingSegment(repoBucket)) continue;
    const citationBucket = REPO_TO_CITATION_BUCKET[repoBucket] ?? repoBucket;
    const tail = normaliseTitleSegment(
      segs.slice(1),
      jurisdiction,
      repoBucket
    );
    out.push({
      filePath: entry.path,
      citationPath: tail
        ? `${jurisdiction}/${citationBucket}/${tail}`
        : `${jurisdiction}/${citationBucket}`,
      bucket: repoBucket,
    });
  }
  out.sort((a, b) => a.citationPath.localeCompare(b.citationPath));
  return out;
}

/**
 * Some rulespec-* repos include a publication-system suffix on the
 * regulation title that the corpus citation_path drops. ``rulespec-us``
 * stores federal regulations under ``regulations/7-cfr/…``, but the
 * corpus carries the bare ``us/regulation/7/…``. Normalise here so
 * the citation paths line up across the two stores.
 */
function normaliseTitleSegment(
  tailSegs: string[],
  jurisdiction: string,
  repoBucket: string
): string {
  if (
    jurisdiction === "us" &&
    repoBucket === "regulations" &&
    tailSegs.length > 0
  ) {
    tailSegs = [...tailSegs];
    tailSegs[0] = tailSegs[0].replace(/-cfr$/, "");
  }
  return tailSegs.join("/");
}

function isEncodingFile(path: string): boolean {
  if (!path.endsWith(".yaml")) return false;
  if (path.endsWith(".test.yaml")) return false;
  if (path.endsWith(".meta.yaml")) return false;
  // Encodings always sit inside a bucket directory (statutes/…,
  // policies/…). A YAML at the listing root is repo config — e.g.
  // rulespec-ca's proof-obligation ratchet — and treating its filename
  // as a bucket fabricates a citation path no index can resolve.
  if (!path.includes("/")) return false;
  return true;
}

/**
 * Find every encoded descendant of ``citationPath`` — i.e. YAML files
 * whose citation_path lives strictly under it. Used by the rule-detail
 * rail to point readers from a container page (e.g. ``us/statute/26/3101``)
 * down to the subsections that actually have encodings (``…/a``,
 * ``…/b/1``, ``…/b/2``).
 */
export async function findEncodedDescendants(
  citationPath: string
): Promise<EncodedFile[]> {
  const jurisdiction = citationPath.split("/")[0];
  if (!jurisdiction) return [];
  const all = await listEncodedFiles(jurisdiction);
  const prefix = `${citationPath}/`;
  return all.filter((f) => f.citationPath.startsWith(prefix));
}

/**
 * Resolve a citation path back to the repo-relative file path. Reverse
 * of the transform in ``parseTreeEntries``, so the viewer page can
 * fetch the YAML for a given citation.
 */
export function citationPathToFilePath(citationPath: string): string | null {
  const parts = citationPath.split("/");
  if (parts.length < 2) return null;
  const [jurisdiction, citationBucket, ...rest] = parts;
  const repoBucket = citationBucketToRepoBucket(citationBucket);
  // Inverse of the title-segment normalisation in parseTreeEntries —
  // the corpus drops the ``-cfr`` suffix that the rulespec-us repo
  // carries on federal-regulation titles.
  if (
    jurisdiction === "us" &&
    citationBucket === "regulation" &&
    rest.length > 0 &&
    !rest[0].endsWith("-cfr")
  ) {
    rest[0] = `${rest[0]}-cfr`;
  }
  return `${repoBucket}/${rest.join("/")}.yaml`;
}

function citationBucketToRepoBucket(citationBucket: string): string {
  if (citationBucket === "statute") return "statutes";
  if (citationBucket === "regulation") return "regulations";
  if (citationBucket === "policy") return "policies";
  return citationBucket;
}

/**
 * Fetch the raw YAML from the canonical ``rulespec-*`` repo for a given
 * citation path. Returns null when the repo or file is missing.
 */
export async function fetchEncodedFile(
  citationPath: string
): Promise<{ filePath: string; content: string } | null> {
  const parts = citationPath.split("/");
  const jurisdiction = parts[0];
  const filePath = citationPathToFilePath(citationPath);
  if (!filePath) return null;
  // Same gate as the listing: a gated repo's YAML is not servable even
  // when a caller already holds its citation path.
  const loc = await ruleSpecReadLocation(jurisdiction);
  if (!loc) return null;
  const url = ruleSpecRawFileUrlForLocation(loc, filePath);
  const res = await cachedRawFetch(url, {
    next: { revalidate: REVALIDATE_SECONDS },
  } as RequestInit);
  if (!res.ok) return null;
  return { filePath, content: res.body };
}
