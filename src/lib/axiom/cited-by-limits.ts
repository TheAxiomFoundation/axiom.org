/**
 * Bounds on the section reader's "cited by" lookups, shared by the
 * server-side queries (section-encoding.ts) and the rail that reports
 * what they left out, so the rail's numbers always match the queries.
 */

/** Rules fetched from the encodings.rule_citations index, by rank. */
export const MAX_CITED_RULES = 120;

/** Whole modules fetched by the rulespec_files compatibility fallback. */
export const MAX_CITED_BY_MODULES = 60;
