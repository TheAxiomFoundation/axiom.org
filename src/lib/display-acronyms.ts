/**
 * The display-acronym vocabulary: tokens that render upper-case when a
 * snake_case or dash-slug value is humanized word by word
 * ("snap_agi_limit" → "SNAP AGI Limit"). One registry so a new acronym
 * needs exactly one addition; every humanizer that title-cases slugs
 * consults it:
 *
 * - `humanizeRuleName` (graph-viewer citations.ts) — doors, tooltips,
 *   policy-document fallbacks
 * - `humanizeProgram` (graph-viewer api.ts) — program labels, behind the
 *   `PROGRAM_LABELS` overrides and jurisdiction-prefix strips
 * - `formatGenericSegmentLabel` (tree-data.ts) — reader breadcrumbs
 * - `formatRulespecOnlySegment` (tree-node-loader.ts) — RuleSpec-only
 *   document nodes
 * - `titleise` (search.ts) — search-result labels; its fuzzy matcher also
 *   consults the registry so fuzzy matching never fires on acronyms
 *
 * Matching is whole-word on lower-cased tokens ("debt" is unaffected by
 * "ebt"), and the registry feeds rule/input fragments AND document slugs,
 * so admission is judged against every displayable use: a token qualifies
 * only when it always means the acronym ("co" never qualifies —
 * `co_resident` means co-resident while `co_snap` means Colorado). The
 * convention lives in axiom-rules-engine docs/concept-naming.md §Acronyms.
 *
 * Deliberately NOT consumers: `humanizeIdentifier` (axiom-stats.tsx) cases
 * jurisdiction codes — its EU/UN are geography, not program vocabulary,
 * and would collide with ordinary words in rule fragments. Cross-repo
 * mirror kept in sync by hand: `RULE_NAME_ACRONYMS` in
 * rulespec-graph-viewer src/citations.ts.
 */
export const DISPLAY_ACRONYMS: ReadonlySet<string> = new Set([
  "abawd",
  "aca",
  "agi",
  "amt",
  "apa",
  "cdcc",
  "cdhs",
  "cfr",
  "cola",
  "ctc",
  "dc",
  "dcf",
  "dor",
  "dpa",
  "dss",
  "ebt",
  "eitc",
  "ess",
  "fica",
  "fns",
  "fpl",
  "fy",
  "gst",
  "hhs",
  "irs",
  "itin",
  "lcwra",
  "leap",
  "magi",
  "sme",
  "smed",
  "snap",
  "ssi",
  "ssn",
  "ssp",
  "tanf",
  "uc",
  "uk",
  "ukpga",
  "uksi",
  "us",
  "usc",
  "usda",
  "wic",
]);
