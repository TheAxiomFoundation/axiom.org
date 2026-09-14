import {
  resolveAxiomPath,
  buildBreadcrumbs,
  type BreadcrumbItem,
  type TreeNode,
} from "@/lib/tree-data";
import { loadTreeNodes } from "@/lib/axiom/tree-node-loader";
import { supabaseEncodings, type Rule } from "@/lib/supabase";
import {
  excludeGatedRows,
  isGatedCitationPath,
  withoutGatedRows,
} from "@/lib/axiom/rulespec/index-visibility";

/**
 * Data assembly for v2 browse pages — the levels above a section
 * (jurisdiction root, doc type, title), server-rendered in the
 * reader's visual language. Same navigation-index-backed loader the
 * v1 tree browser uses, fetched server-side.
 */

export interface BrowsePageData {
  /** Path segments as given ("us", "statute", "26"). */
  segments: string[];
  jurisdictionLabel: string;
  breadcrumbs: BreadcrumbItem[];
  /** The node being browsed, when the level maps to a corpus row. */
  currentRule: Rule | null;
  nodes: TreeNode[];
  /**
   * Encoded-file counts from the encodings mirror, keyed by child
   * segment — the numerator for per-row coverage ("∀ 3 / 12").
   * Empty when the mirror is unreachable; rows fall back to the
   * bare ∀ mark.
   */
  encodedCounts: Record<string, number>;
  /** True when the level has more children than one page shows. */
  hasMore: boolean;
  page: number;
}

const ENCODED_COUNT_SCAN_LIMIT = 3000;
const ENCODED_COUNT_TIMEOUT_MS = 3000;

/**
 * One mirror range-scan for the browsed prefix, aggregated per child
 * segment. Uses each node's canonical citation path where known so
 * deep containers with flattened children still count correctly.
 */
async function getEncodedCounts(
  segments: string[],
  nodes: TreeNode[]
): Promise<Record<string, number>> {
  const prefix = segments.join("/");
  // Coverage marks for a gated pilot family would advertise encodings
  // no page on the site can open — the same refusal the section reader
  // and the encoded search now make.
  if (isGatedCitationPath(prefix)) return {};
  try {
    const result = await Promise.race([
      excludeGatedRows(
        supabaseEncodings.from("rulespec_files").select("citation_path"),
      )
        .like("citation_path", `${prefix}/%`)
        .limit(ENCODED_COUNT_SCAN_LIMIT),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ENCODED_COUNT_TIMEOUT_MS)
      ),
    ]);
    if (!result || result.error) return {};
    const paths = withoutGatedRows(
      (result.data ?? []) as Array<{ citation_path: string }>,
      (row) => row.citation_path,
    )
      .map((row) => row.citation_path)
      .filter(Boolean);
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      const childPrefix =
        node.rule?.citation_path ?? `${prefix}/${node.segment}`;
      const count = paths.filter(
        (path) =>
          path === childPrefix || path.startsWith(`${childPrefix}/`)
      ).length;
      if (count > 0) counts[node.segment] = count;
    }
    return counts;
  } catch {
    return {};
  }
}

/** Repo plumbing files (release scopes, bulk manifests) that the
 *  rulespec-only merge can surface as phantom browse nodes. */
function isPlumbingNode(node: TreeNode): boolean {
  return /^release[\s-]scope/i.test(node.label) || /^release-scope/.test(node.segment);
}

/** The index has shipped duplicate rows per path (axiom-corpus#400);
 *  keep the first occurrence of each segment. */
function dedupeBySegment(nodes: TreeNode[]): TreeNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.segment)) return false;
    seen.add(node.segment);
    return true;
  });
}

/** Browse depth: jurisdiction (1), doc type (2), title (3). */
export const MAX_BROWSE_SEGMENTS = 3;

export async function getBrowsePageData(
  segments: string[],
  page = 0,
  options: {
    /** Allow depths beyond MAX_BROWSE_SEGMENTS — used for navigation
     *  containers below title level (a CFR part) that have children
     *  in the index but no corpus row of their own. */
    allowDeep?: boolean;
  } = {}
): Promise<BrowsePageData | "unavailable" | null> {
  if (
    segments.length === 0 ||
    (!options.allowDeep && segments.length > MAX_BROWSE_SEGMENTS)
  ) {
    return null;
  }
  const resolved = resolveAxiomPath(segments);
  if (!resolved.jurisdiction) return null;

  // A backend failure must not become a 404: transient
  // navigation-index outages are common enough that v1 had an error
  // banner + retry for exactly this.
  const result = await loadTreeNodes({
    dbJurisdictionId: resolved.jurisdiction.slug,
    ruleSegments: resolved.ruleSegments,
    hasCitationPaths: resolved.jurisdiction.hasCitationPaths ?? true,
    encodedOnly: false,
    page,
  }).catch(() => "unavailable" as const);
  if (result === "unavailable") return "unavailable";
  if (!result) return null;

  // Mis-parented index rows (a section row claiming the doc type as
  // its parent — another #400-class duplication artifact) betray
  // themselves by their own citation path not matching the position
  // they'd occupy here.
  const expectedPrefix = segments.join("/");
  const kept: TreeNode[] = [];
  const strayCounts = new Map<string, number>();
  for (const node of result.nodes) {
    // Deep containers (a CFR part's subparts) legitimately hold
    // children whose citation paths flatten the container out
    // (…/1302/subpart-C's children live at …/1302/30). The
    // positional-integrity filter below exists for doc-type/title
    // index pollution — at container depth, trust the navigation
    // index's parent links instead.
    if (options.allowDeep) {
      kept.push(node);
      continue;
    }
    // The "recovery" namespace under each doc type holds ingestion
    // re-scrape dumps (release-scope blocks, scraper boilerplate) —
    // pipeline working data, never navigable law (verified against
    // us/regulation/recovery and us/guidance/recovery, 2026-07-20).
    if (segments.length === 2 && node.segment === "recovery") continue;
    const path = node.rule?.citation_path;
    if (!path) {
      kept.push(node);
      continue;
    }
    if (!path.startsWith(`${expectedPrefix}/`)) continue;
    // Ingestion-recovery dumps (raw re-scrape blocks under a
    // "recovery/release-scope-…" namespace, complete with scraper
    // boilerplate headings) are pipeline working data, not law.
    if (path.includes("/release-scope-")) continue;
    const nextSegment = path.slice(expectedPrefix.length + 1).split("/")[0];
    // Same namespace guard for strays that would synthesize the
    // recovery container without a release-scope marker in the path.
    if (segments.length === 2 && nextSegment === "recovery") continue;
    if (nextSegment === node.segment) {
      // Correctly positioned (including deeper flattened rows).
      kept.push(node);
    } else if (nextSegment) {
      // Mis-parented stray (a deep leaf listed at this level with its
      // last path segment — us/policy/cms/…/pdf as segment "pdf").
      // Don't show the stray; synthesize its real container instead.
      strayCounts.set(nextSegment, (strayCounts.get(nextSegment) ?? 0) + 1);
    }
  }
  const keptSegments = new Set(kept.map((node) => node.segment));
  const synthesized: TreeNode[] = Array.from(strayCounts)
    .filter(([segment]) => !keptSegments.has(segment))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([segment, count]) => ({
      segment,
      // Acronym-length segments read as initialisms (CMS, IRS);
      // longer ones as words (Recovery).
      label:
        segment.length <= 5
          ? segment.toUpperCase()
          : segment.charAt(0).toUpperCase() + segment.slice(1),
      hasChildren: true,
      childCount: count,
      nodeType: "container" as TreeNode["nodeType"],
    }));
  const positioned = [...kept, ...synthesized]
    .map((node) => {
      // Container labels citing a section ("26 U.S.C. § 85 …" as the
      // label for all of Title 26) are index corruption from the
      // duplicate-row class; fall back to a generic title.
      if (segments[1] === "statute" && /§/.test(node.label)) {
        return { ...node, label: `Title ${node.segment}` };
      }
      return node;
    });

  const nodes = dedupeBySegment(positioned.filter((n) => !isPlumbingNode(n)));
  const encodedCounts = await getEncodedCounts(segments, nodes).catch(
    () => ({}) as Record<string, number>
  );

  return {
    segments,
    jurisdictionLabel: resolved.jurisdiction.label,
    breadcrumbs: buildBreadcrumbs(segments),
    currentRule: result.currentRule ?? null,
    nodes,
    encodedCounts,
    hasMore: result.hasMore,
    page,
  };
}

/** Human title for a browse level: "Title 26 · Statutes · US Federal". */
export function browseTitle(segments: string[]): string {
  const resolved = resolveAxiomPath(segments);
  const jurisdiction = resolved.jurisdiction?.label ?? segments[0];
  if (segments.length === 1) return jurisdiction;
  const docType = segments[1];
  const docLabel =
    docType.charAt(0).toUpperCase() +
    docType.slice(1) +
    (docType.endsWith("s") || docType === "guidance" ? "" : "s");
  if (segments.length === 2) return `${docLabel} · ${jurisdiction}`;
  return `Title ${segments[2]} · ${docLabel} · ${jurisdiction}`;
}
