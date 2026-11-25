// The walkthrough's words that state a fact about the rules, kept apart
// from the drawing so journey-live-claims.test.tsx can pin each one. What
// they rest on, read 2026-11-24: rulespec-us fbc74a69 (us/statutes/7/2017/a.yaml
// and its imports), axiom-encode caa46624 and axiom-rules-engine 82cf3aa6.

import { GRAPH_NODES, WAIVER_LINE, type GraphNodeId } from "../journey-digital/data";

const NBSP = String.fromCharCode(0xa0);

// The graph shows each rule by a plain name, not its identifier in the
// file (snap_allotment_before_minimum and so on). The net income § 2017(a)
// reduces is the household's income "as determined in accordance with
// section 2014(d) and (e)". The module a.yaml imports it from is filed
// under 2014(e)(6)(A), the excess shelter deduction (probably because that
// paragraph speaks of income after all other deductions), but its rule
// cites "7 USC 2014(d) and (e)", and so does the name here. No-break
// spaces keep the citation on one line.
export const NODE_NAME: Record<GraphNodeId, string> = {
  imp2014: `Net income under ${["7", "U.S.C.", "§", "2014(d)"].join(NBSP)} and (e)`,
  impUsda: "Maximum allotment, USDA FY 2026",
  net: "Net income for the allotment",
  rate30: "Household contribution rate",
  size2: "Household size limit for the minimum",
  rate8: "Minimum allotment rate",
  contrib: "Household food contribution",
  minimum: "Minimum monthly allotment",
  before: "Allotment before the minimum",
  regular: "Regular monthly allotment",
};

const valueOf = (id: GraphNodeId) => GRAPH_NODES.find((n) => n.id === id)!.value;
// The output is the greater of the two results it reads,
// max(snap_allotment_before_minimum, snap_minimum_monthly_allotment)
// (a.yaml line 176), in test case 1's values, built from the nodes' own
// values so it cannot drift from them.
export const OUTPUT_NOTE = `Greater of ${valueOf("before")} and ${valueOf("minimum")}`;

// Every executable rule names its source (the encoder's CI refuses a rule
// without one: validator_pipeline find_rule_source_metadata_issues), and
// the engine will not compile a version without an effective date
// (rulespec.rs MissingEffectiveFrom). Citations sit on rules, not on every
// value, and only program artifacts are published as releases, so the card
// claims neither.
export const SOURCE_ABOUT = "The rules carry source citations and effective dates.";

// The side caption carries WAIVER_LINE, but the side column is hidden on
// live stages under 1100 px wide and on slides that frame the stage
// themselves, so the code card's bar names the waiver too, at every width.
export const CODE_WAIVER_NOTE = "checks waived in CI";

// The four branches are kinds of tool the rules could serve, not tools
// that run on them today.
export const USES_HEADING = "Potential uses";

// The stage's whole picture in words, for a screen reader: what each step
// draws, and nothing it does not, plus the waiver line step 5 carries for
// the published module. The drafts are an example (the draft's test strip
// says so); the review advises and the comparisons run apart from the
// encoder, as the gates step draws them. Step 7 draws bodies of law (see
// PROGRAMS in layout.ts), with the Food and Nutrition Act lit.
export const STAGE_LABEL =
  "A law book comes off the shelf, opens on section 2017(a) and becomes one addressed cell of the corpus. " +
  "The section is encoded: in an example, checks send a first draft back and pass the second, an AI review advises, and program comparisons run separately. " +
  "Each rule in the code cites the words it encodes. " +
  `${WAIVER_LINE} ` +
  "The rules run as a graph to $182 for test case 1, the greater of $182 and $24. " +
  "The graph shrinks to section 2017(a) of the Food and Nutrition Act, among other bodies of law such as the Internal Revenue Code and state statutes. " +
  "The rules carry source citations and effective dates, and four potential uses branch from them.";
