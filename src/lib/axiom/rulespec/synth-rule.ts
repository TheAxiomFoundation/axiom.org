import type { Rule } from "@/lib/supabase";
import { fetchEncodedFile } from "./repo-listing";
import { parseRuleSpec } from "./doc";

/**
 * Prefix used on synthesised rule IDs so downstream code can detect
 * "this Rule didn't come from the corpus DB" without changing the
 * Rule shape. Read by ``getRuleEncoding`` to skip the corpus lookup
 * and go straight to the GitHub fetch.
 */
export const SYNTHESISED_ID_PREFIX = "github:";

/**
 * Build a synthesised id for a citation path. Stable so React keys
 * and Supabase mocks behave consistently across renders.
 */
export function synthesisedRuleId(citationPath: string): string {
  return `${SYNTHESISED_ID_PREFIX}${citationPath}`;
}

/** Inverse of {@link synthesisedRuleId}. Returns ``null`` for ids
 *  that aren't synthesised. */
export function citationPathFromSynthesisedId(
  ruleId: string
): string | null {
  if (!ruleId.startsWith(SYNTHESISED_ID_PREFIX)) return null;
  return ruleId.slice(SYNTHESISED_ID_PREFIX.length);
}

export function isSynthesisedRuleId(ruleId: string): boolean {
  return ruleId.startsWith(SYNTHESISED_ID_PREFIX);
}

/**
 * Try to build a minimal {@link Rule} for a citation path that
 * exists as a YAML in the canonical ``rulespec-*`` repo even if the
 * corpus DB has no row for it. Returns ``null`` when no such file
 * exists, so callers can fall through to the normal "not found"
 * path.
 *
 * The returned Rule is synthetic: ``parent_id`` is null and
 * ``effective_date``/``ordinal`` are absent. The heading is derived
 * from the YAML's module summary or first declared rule; when the
 * module has a summary, we also expose the full summary as ``body`` so
 * the reader pane does not collapse to the shortened heading. The
 * rest of the Axiom app treats it as a real leaf — the only difference is
 * that ``id`` carries the
 * {@link SYNTHESISED_ID_PREFIX} so the encoding fetcher can skip
 * the corpus and go straight to GitHub.
 */
export async function synthesiseRuleFromCitationPath(
  jurisdiction: string,
  citationPath: string
): Promise<Rule | null> {
  const fetched = await fetchEncodedFile(citationPath);
  if (!fetched) return null;
  const doc = parseRuleSpec(fetched.content);
  const heading = pickHeading(doc.module.summary, doc.rules[0]?.name ?? null);
  const body = doc.module.summary?.trim() || null;
  return {
    id: synthesisedRuleId(citationPath),
    jurisdiction,
    doc_type: deriveDocType(citationPath),
    parent_id: null,
    level: 0,
    ordinal: null,
    heading,
    body,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: null,
    citation_path: citationPath,
    rulespec_path: fetched.filePath,
    has_rulespec: true,
    created_at: "",
    updated_at: "",
  };
}

function pickHeading(
  summary: string | null,
  firstRuleName: string | null
): string {
  if (summary) {
    // Literal-block (``|-``) summaries carry hard wraps at the source
    // line width, so collapse all whitespace before sentence-splitting
    // — otherwise the heading ends mid-sentence at the first wrap.
    // Split on sentence-end punctuation followed by whitespace (so
    // ``6.2`` in a number doesn't terminate the heading).
    const normalised = summary.replace(/\s+/g, " ").trim();
    const firstSentence = normalised.split(/[.!?]\s/, 1)[0]?.trim();
    if (firstSentence && firstSentence.length <= 120) return firstSentence;
    if (firstSentence) return firstSentence.slice(0, 117).trimEnd() + "…";
  }
  if (firstRuleName) return firstRuleName;
  return "Encoded rule";
}

function deriveDocType(citationPath: string): string {
  const parts = citationPath.split("/");
  return parts[1] ?? "statute";
}
