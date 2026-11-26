import { supabaseCorpus, type Rule } from "@/lib/supabase";
import { naturalCompare } from "@/lib/natural-sort";
import {
  enDashCitationSegments,
  normalizeCitationPathInput,
} from "@/lib/axiom/citation-path";

/**
 * Outcome of resolving a citation_path against ``corpus.current_provisions``.
 *
 * - ``exact``: the full path exists as an atomic rule, as typed or in
 *   its en-dash spelling (see ``resolveCitationPath``).
 * - ``ancestor``: the full path does not exist, but some prefix does;
 *   ``rule`` is the deepest ingested ancestor and ``missingTail``
 *   lists the segments below it that aren't in the axiom yet.
 * - ``none``: no prefix of the path is ingested.
 *
 * The Axiom view treats ``ancestor`` the same as a "rule-not-yet-
 * ingested" deep link — it lands on the ancestor so the user gets
 * useful context (and surfaces the missing tail so they understand
 * what's absent). ``none`` falls through to a "no ingested rule
 * matches" empty state.
 */
export type ResolveMatch = "exact" | "ancestor" | "none";

export interface ResolveResult {
  match: ResolveMatch;
  rule: Rule | null;
  /**
   * Segments below ``rule`` that aren't ingested, spelled as in the path
   * that matched: en dashes when the en-dash spelling matched.
   */
  missingTail: string[];
  /**
   * The input path after normalisation (structural segments lower-cased,
   * no leading slash), spelled as typed. ``rule.citation_path`` gives the
   * spelling that matched.
   */
  citationPath: string;
}

/**
 * Enumerate every prefix of a citation_path from deepest to shallowest.
 *
 *   us/statute/26/32/b/1 →
 *     [
 *       "us/statute/26/32/b/1",
 *       "us/statute/26/32/b",
 *       "us/statute/26/32",
 *       "us/statute/26",
 *       "us/statute",
 *       "us",
 *     ]
 *
 * The root jurisdiction segment is kept for consistency even though
 * no rule lives at that depth; the resolver will simply miss it.
 */
export function citationPathPrefixes(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

/**
 * Resolve a citation_path against the ingested axiom. Single DB query
 * fetches every possible ancestor; we pick the deepest match.
 *
 * The corpus stores USC lettered sections with an en dash
 * (``us/statute/42/1395w–113``), but people and citation tools type a
 * hyphen. When the path has a hyphen after its document type, the same
 * query also fetches every prefix of its en-dash spelling
 * (``enDashCitationSegments``, the swap the section page retries with):
 * the typed prefixes deepest-first, then the en-dash prefixes not
 * already listed. The deeper match wins; at equal depth the path as
 * typed wins. A path with no such hyphen queries its own prefixes only,
 * and so does a path whose en-dash prefixes would add more than
 * ``DASH_PREFIX_BUDGET`` bytes to the query string.
 *
 * This is the load-bearing primitive for the command palette and
 * direct-URL entry: every wayfinding path ultimately resolves an
 * input to an atomic ``rules`` row here.
 */
/**
 * The most bytes the en-dash prefixes may add to the resolver's query
 * string. An en dash encodes as nine bytes (``%E2%80%93``), so without a
 * cap a path of many hyphens would multiply the query's length and could
 * fail where the typed query alone succeeds. A real citation adds a few
 * hundred bytes.
 */
export const DASH_PREFIX_BUDGET = 2048;

/**
 * The length of the ``.in("citation_path", values)`` filter as
 * postgrest-js puts it in the query string: it quotes a value that holds
 * a comma or a parenthesis, joins the values with commas inside
 * ``in.(...)``, and URLSearchParams encodes the result. The tests check
 * this against the real client.
 */
function inFilterLength(values: readonly string[]): number {
  const list = values
    .map((value) => (/[,()]/.test(value) ? `"${value}"` : value))
    .join(",");
  return new URLSearchParams([["citation_path", `in.(${list})`]]).toString()
    .length;
}

export async function resolveCitationPath(
  input: string
): Promise<ResolveResult> {
  const citationPath = normalizeCitationPathInput(input);
  if (!citationPath) {
    return {
      match: "none",
      rule: null,
      missingTail: [],
      citationPath: "",
    };
  }

  const prefixes = citationPathPrefixes(citationPath);
  if (prefixes.length === 0) {
    return { match: "none", rule: null, missingTail: [], citationPath };
  }

  // Both spellings have the same number of segments, so their prefixes
  // line up depth for depth: ``dashPrefixes[i]`` is ``prefixes[i]``
  // respelled.
  const dashPath = enDashCitationSegments(citationPath.split("/")).join("/");
  let dashPrefixes =
    dashPath === citationPath ? [] : citationPathPrefixes(dashPath);
  let added = dashPrefixes.filter((prefix) => !prefixes.includes(prefix));
  const addedBytes =
    added.length === 0
      ? 0
      : inFilterLength([...prefixes, ...added]) - inFilterLength(prefixes);
  if (addedBytes > DASH_PREFIX_BUDGET) {
    dashPrefixes = [];
    added = [];
  }
  const queried = [...prefixes, ...added];

  const { data, error } = await supabaseCorpus
    .from("current_provisions")
    .select("*")
    .in("citation_path", queried);

  if (error || !data || data.length === 0) {
    return { match: "none", rule: null, missingTail: [], citationPath };
  }

  // Index hits by path so we can pick the deepest in O(1).
  const byPath = new Map<string, Rule>();
  for (const row of data as Rule[]) {
    if (row.citation_path) byPath.set(row.citation_path, row);
  }
  // Walk deepest-first; at each depth try the path as typed, then its
  // en-dash spelling.
  for (let i = 0; i < prefixes.length; i++) {
    const candidates: Array<[prefix: string, spelled: string]> = [
      [prefixes[i], citationPath],
    ];
    if (dashPrefixes.length > 0) {
      candidates.push([dashPrefixes[i], dashPath]);
    }
    for (const [prefix, spelled] of candidates) {
      const hit = byPath.get(prefix);
      if (!hit) continue;
      const isExact = prefix === spelled;
      const missingTail = isExact
        ? []
        : spelled.slice(prefix.length).split("/").filter(Boolean);
      return {
        match: isExact ? "exact" : "ancestor",
        rule: hit,
        missingTail,
        citationPath,
      };
    }
  }

  return { match: "none", rule: null, missingTail: [], citationPath };
}

/**
 * Given a rule, return its siblings at the same depth under the same
 * parent, ordered by ``ordinal``. Used for the rule-view sibling
 * strip and for palette "nearby" hints.
 */
export async function getSiblings(rule: Rule): Promise<Rule[]> {
  if (!rule.parent_id) {
    if (!rule.citation_path) return [rule];

    const parts = rule.citation_path.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    if (!parentPath) return [rule];

    const { data } = await supabaseCorpus
      .from("current_provisions")
      .select("*")
      .gte("citation_path", `${parentPath}/`)
      .lt("citation_path", `${parentPath}~`)
      .is("parent_id", null)
      .order("citation_path")
      .range(0, 999);
    return sortSiblings((data as Rule[] | null) ?? []);
  }
  const { data } = await supabaseCorpus
    .from("current_provisions")
    .select("*")
    .eq("parent_id", rule.parent_id)
    .order("ordinal", { ascending: true, nullsFirst: false });
  return (data as Rule[] | null) ?? [];
}

function sortSiblings(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    const aOrdinal = a.ordinal;
    const bOrdinal = b.ordinal;

    if (aOrdinal != null && bOrdinal != null && aOrdinal !== bOrdinal) {
      return aOrdinal - bOrdinal;
    }
    if (aOrdinal != null && bOrdinal == null) return -1;
    if (aOrdinal == null && bOrdinal != null) return 1;

    return naturalCompare(a.citation_path ?? a.id, b.citation_path ?? b.id);
  });
}
