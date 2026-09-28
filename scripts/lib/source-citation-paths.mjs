import { parseRuleSpec } from "../../src/lib/axiom/rulespec/doc.ts";
import { extractCitationPathSets as extractFromDoc } from "../../src/lib/axiom/rulespec/source-citations.ts";

export const MAX_SOURCE_CITATION_PATHS = 5_000;

/**
 * Collect the corpus citation paths a RuleSpec file declares. See
 * src/lib/axiom/rulespec/source-citations.ts for the semantics of the
 * two sets (``all`` = every declaration; ``values`` = the provisions
 * reached by singular-source or non-reference grounding declarations).
 * Both arrays are search aids; malformed YAML and non-strings yield
 * empty sets.
 */
export function extractCitationPathSets(content) {
  if (typeof content !== "string") return { all: [], values: [] };
  let doc;
  try {
    doc = parseRuleSpec(content);
  } catch {
    return { all: [], values: [] };
  }
  return extractFromDoc(doc);
}

/** Back-compat single-set view: every declared source path. */
export function extractSourceCitationPaths(content) {
  return extractCitationPathSets(content).all;
}

function capped(paths, label, filePath, warn) {
  if (paths.length <= MAX_SOURCE_CITATION_PATHS) return paths;
  warn(
    `${label} capped at ${MAX_SOURCE_CITATION_PATHS} entries for ${filePath}`,
  );
  return paths.slice(0, MAX_SOURCE_CITATION_PATHS);
}

/**
 * Apply the mirror's per-row array bound and warn when declarations
 * overflow it. Returns both citation-path sets, capped independently.
 */
export function citationPathSetsForFile(
  content,
  filePath,
  warn = console.warn,
) {
  const sets = extractCitationPathSets(content);
  return {
    all: capped(sets.all, "source_citation_paths", filePath, warn),
    values: capped(sets.values, "value_citation_paths", filePath, warn),
  };
}
