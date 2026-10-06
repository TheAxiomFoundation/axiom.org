import {
  listRuntimePackages,
  getProgramGraph,
  isRuntimeApiConfigured,
  type GraphRuleNode,
} from "@/lib/axiom/runtime/api";

/**
 * The provision ↔ program join: which executable runtime packages
 * contain rules derived from a given corpus provision.
 *
 * Graph rule nodes carry durable repo-backed file IDs
 * ("us:statutes/7/2017/a") while corpus rows carry citation paths
 * ("us/statute/7/2017"), so the join is a tolerant segment match:
 * same jurisdiction, doc type equal modulo plural, node path at or
 * below the section path. Runs app-side from graph payloads today; a
 * registry-built coverage endpoint in axiom-api is the planned
 * replacement once Encoding Registry v1 lands.
 */

export interface ProvisionProgramCoverage {
  jurisdiction: string;
  programId: string;
  mode: "fixture" | "compiled";
  status: "ready" | "unavailable";
  /** Rule nodes in the program derived from this provision. */
  ruleCount: number;
  /** Top-level subsection anchors ("a", "b", …) those rules cite. */
  anchors: string[];
  /** Rule names for display, capped at RULE_NAME_CAP. */
  ruleNames: string[];
}

/** Registry sweep bound — the live registry held 16 packages in July
 *  2026 and 6 after the 2026-07-28 cutover; if it outgrows this, the join must move
 *  server-side into axiom-api rather than raising the cap. */
const MAX_PACKAGES = 32;
const RULE_NAME_CAP = 8;

const REPO_DOC_TYPE_ALIASES: Readonly<Record<string, string>> = {
  policies: "policy",
};

function normalizeDocType(segment: string): string {
  const lower = segment.toLowerCase();
  // "policies" → "policy" (a bare strip-s yields "policie"); other
  // buckets pluralize regularly.
  return REPO_DOC_TYPE_ALIASES[lower] ?? lower.replace(/s$/, "");
}

/** Federal-regulation repo paths carry a "-cfr" title suffix the
 *  corpus drops ("7-cfr" vs "7"). */
function titleSegmentsEqual(legal: string, citation: string): boolean {
  const a = legal.toLowerCase();
  const b = citation.toLowerCase();
  return a === b || a === `${b}-cfr`;
}

/**
 * Match a graph node's fileLegalId against a section citation path.
 * Returns null when the node is outside the section, otherwise the
 * top-level subsection anchor the node sits under (or null at the
 * section root).
 */
export function matchLegalId(
  fileLegalId: string,
  citationPath: string
): { anchor: string | null } | null {
  const colon = fileLegalId.indexOf(":");
  if (colon <= 0) return null;
  const legalJurisdiction = fileLegalId.slice(0, colon).toLowerCase();
  const legalSegments = fileLegalId
    .slice(colon + 1)
    .split("/")
    .filter(Boolean);

  const citationSegments = citationPath.split("/").filter(Boolean);
  // citationPath = slug / docType / …section segments
  if (citationSegments.length < 3 || legalSegments.length < 2) return null;
  const [slug, docType, ...sectionSegments] = citationSegments;
  const [legalDocType, ...legalRest] = legalSegments;

  if (legalJurisdiction !== slug.toLowerCase()) return null;
  if (normalizeDocType(legalDocType) !== normalizeDocType(docType)) {
    return null;
  }
  if (legalRest.length < sectionSegments.length) return null;
  for (let i = 0; i < sectionSegments.length; i++) {
    const equal =
      i === 0
        ? titleSegmentsEqual(legalRest[i], sectionSegments[i])
        : legalRest[i].toLowerCase() === sectionSegments[i].toLowerCase();
    if (!equal) return null;
  }

  const tail = legalRest[sectionSegments.length];
  return { anchor: tail && /^[a-z]{1,2}$/.test(tail) ? tail : null };
}

function coverageFromRules(
  rules: GraphRuleNode[],
  citationPath: string
): { ruleCount: number; anchors: string[]; ruleNames: string[] } | null {
  const anchors = new Set<string>();
  const ruleNames: string[] = [];
  let ruleCount = 0;
  for (const rule of rules) {
    const match = matchLegalId(rule.fileLegalId, citationPath);
    if (!match) continue;
    ruleCount++;
    if (match.anchor) anchors.add(match.anchor);
    if (ruleNames.length < RULE_NAME_CAP) {
      // The legalId fragment is the rule's file-level name — the
      // name space encodedRules and builder deep links speak.
      // node.name can be a composition-local alias.
      ruleNames.push(rule.legalId.split("#")[1] ?? rule.name);
    }
  }
  if (ruleCount === 0) return null;
  return { ruleCount, anchors: Array.from(anchors).sort(), ruleNames };
}

/**
 * Sweep the runtime-package registry for programs containing rules
 * derived from this provision. Resolves to [] when the runtime API
 * is unconfigured or unreachable — pages render without the block.
 */
export async function getProvisionCoverage(
  citationPath: string
): Promise<ProvisionProgramCoverage[]> {
  if (!isRuntimeApiConfigured()) return [];
  const packages = (await listRuntimePackages()).slice(0, MAX_PACKAGES);
  if (packages.length === 0) return [];

  const graphs = await Promise.all(
    packages.map((pkg) =>
      getProgramGraph(pkg.jurisdiction, pkg.program_id).catch(() => null)
    )
  );

  const coverage: ProvisionProgramCoverage[] = [];
  packages.forEach((pkg, index) => {
    const graph = graphs[index];
    if (!graph) return;
    // Certified serving can answer 200 with an empty rules array
    // (artifact exists, nothing certified yet) — that simply yields
    // no coverage below, same as any graph with no matching rules.
    const matched = coverageFromRules(graph.rules, citationPath);
    if (!matched) return;
    coverage.push({
      jurisdiction: pkg.jurisdiction,
      programId: pkg.program_id,
      mode: pkg.mode,
      status: pkg.status,
      ...matched,
    });
  });

  return coverage.sort((a, b) => b.ruleCount - a.ruleCount);
}
