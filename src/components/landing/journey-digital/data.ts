// Everything the digital journey shows is a real artifact, quoted
// exactly:
//
//   STATUTE      7 U.S.C. § 2017(a), as the corpus serves it at
//                us/statute/7/2017/a (two stray spaces in the corpus
//                text before "," are dropped).
//   CODE         lines of rulespec-us us/statutes/7/2017/a.yaml, with
//                their real line numbers (rulespec-us 647a0648).
//   CASE         test case 1 of a.test.yaml: its inputs and expected
//                outputs. 298 is the FY 2026 one-person maximum
//                allotment from the imported USDA COLA module
//                (floor(298 - 115.95) = 182).
//
// Copy rule (shared with journey-film.tsx): nothing here may call a
// rule certified, signed or sealed. The statute's own words ("certified
// as eligible") are a quotation of the law, not a claim about Axiom.

export const ADDRESS = ["us", "statute", "7", "2017", "a"] as const;

export type MarkId =
  | "eligible"
  | "tfp"
  | "rate30"
  | "income"
  | "floor"
  | "size2"
  | "rate8"
  | "round";

export type Segment =
  | string
  | { mark: MarkId; text: string }
  | { em: string };

export const STATUTE: Segment[] = [
  "The value of the allotment which State agencies shall be authorized to issue to any ",
  { mark: "eligible", text: "households certified as eligible" },
  " to participate in the supplemental nutrition assistance program shall be equal to ",
  { mark: "tfp", text: "the cost to such households of the thrifty food plan" },
  " reduced by an amount equal to ",
  { mark: "rate30", text: "30 per centum" },
  " of ",
  {
    mark: "income",
    text: "the household’s income, as determined in accordance with section 2014(d) and (e)",
  },
  " of this title, ",
  { mark: "floor", text: "rounded to the nearest lower whole dollar" },
  ": ",
  { em: "Provided," },
  " That for ",
  { mark: "size2", text: "households of one and two persons" },
  " the minimum allotment shall be ",
  { mark: "rate8", text: "8 percent" },
  " of the cost of the thrifty food plan for a household containing 1 member, as determined by the Secretary under section 2012 of this title, ",
  { mark: "round", text: "rounded to the nearest whole dollar increment" },
  ".",
];

// What each marked phrase decides, as a short tag, and the code line
// it became. Order = reading order in the sentence.
export const MARKS: Array<{ id: MarkId; tag: string; line: number }> = [
  { id: "eligible", tag: "if eligible", line: 175 },
  { id: "tfp", tag: "import", line: 11 },
  { id: "rate30", tag: "0.30", line: 27 },
  { id: "income", tag: "import", line: 10 },
  { id: "floor", tag: "floor()", line: 128 },
  { id: "size2", tag: "≤ 2", line: 59 },
  { id: "rate8", tag: "0.08", line: 43 },
  { id: "round", tag: "round", line: 154 },
];

// A display line: real line number + raw text. `gap` rows stand for the
// lines folded away between them.
export type CodeRow = { n: number; text: string } | { gap: true };

export const CODE: CodeRow[] = [
  { n: 1, text: "format: rulespec/v1" },
  { gap: true },
  { n: 9, text: "imports:" },
  { n: 10, text: "  - us:statutes/7/2014/e/6/A" },
  { n: 11, text: "  - us:policies/usda/snap/fy-2026-cola/maximum-allotments" },
  { n: 12, text: "rules:" },
  { n: 13, text: "  - name: snap_household_food_contribution_rate" },
  { n: 14, text: "    kind: parameter" },
  { n: 15, text: "    dtype: Rate" },
  { n: 16, text: '    source: 7 USC 2017(a), "30 per centum"' },
  { gap: true }, // 17–23: the rule's proof metadata
  { n: 24, text: "    versions:" },
  { n: 25, text: "      - effective_from: '2008-10-01'" },
  { n: 26, text: "        formula: |-" },
  { n: 27, text: "          0.30" },
  { n: 29, text: "  - name: snap_minimum_allotment_rate" },
  { n: 43, text: "          0.08" },
  { n: 45, text: "  - name: snap_minimum_allotment_household_size_limit" },
  { n: 59, text: "          2" },
  { n: 61, text: "  - name: snap_net_income_for_allotment" },
  { n: 84, text: "          max(0, snap_net_income)" },
  { n: 86, text: "  - name: snap_household_food_contribution" },
  { n: 103, text: "          snap_net_income_for_allotment * snap_household_food_contribution_rate" },
  { n: 105, text: "  - name: snap_allotment_before_minimum" },
  { n: 128, text: "          floor(max(0, snap_maximum_allotment - snap_household_food_contribution))" },
  { n: 130, text: "  - name: snap_minimum_monthly_allotment" },
  { n: 153, text: "          if household_size <= snap_minimum_allotment_household_size_limit:" },
  { n: 154, text: "              floor((snap_one_person_thrifty_food_plan_cost * snap_minimum_allotment_rate) + 0.5)" },
  { n: 158, text: "  - name: snap_regular_month_allotment" },
  { n: 175, text: "          if snap_eligible:" },
  { n: 176, text: "              max(snap_allotment_before_minimum, snap_minimum_monthly_allotment)" },
];

// Test case 1 — inline values shown on the code, in evaluation order.
// `line` is where the value appears; `fmt` how it prints.
export const CASE = {
  name: "one_person_eligible_household_receives_thrifty_food_plan_less_thirty_percent_income",
  label: "Test case 1 of 4 · one person · $1,000 a month in earnings",
  values: [
    { line: 10, value: 386.5, fmt: "money2", note: "snap_net_income" },
    { line: 11, value: 298, fmt: "money0", note: "1 person" },
    { line: 13, value: 0.3, fmt: "rate" },
    { line: 29, value: 0.08, fmt: "rate" },
    { line: 45, value: 2, fmt: "int" },
    { line: 61, value: 386.5, fmt: "money2" },
    { line: 86, value: 115.95, fmt: "money2" },
    { line: 105, value: 182, fmt: "money0" },
    { line: 130, value: 24, fmt: "money0" },
    { line: 158, value: 182, fmt: "money0", hero: true },
  ],
  result: 182,
} as const;

export type Fmt = "money0" | "money2" | "rate" | "int";

export function fmtValue(v: number, fmt: Fmt): string {
  switch (fmt) {
    case "money0":
      return `$${Math.round(v).toLocaleString("en-US")}`;
    case "money2":
      return `$${v.toFixed(2)}`;
    case "rate":
      return v.toFixed(2);
    case "int":
      return String(Math.round(v));
  }
}

// The rule graph: every node is a rule in a.yaml or one of its two
// imports; every edge is a name the formula reads.
export type GraphNodeId =
  | "imp2014"
  | "impUsda"
  | "net"
  | "rate30"
  | "size2"
  | "rate8"
  | "contrib"
  | "minimum"
  | "before"
  | "regular";

export const GRAPH_NODES: Array<{
  id: GraphNodeId;
  label: string;
  kind: "import" | "parameter" | "derived" | "output";
  line: number; // the code line the node grows out of
  value: string; // its value in test case 1
}> = [
  { id: "imp2014", label: "§ 2014(e)(6)(A) · snap_net_income", kind: "import", line: 10, value: "$386.50" },
  { id: "impUsda", label: "USDA FY 2026 · maximum allotments", kind: "import", line: 11, value: "$298 · 1 person" },
  { id: "net", label: "snap_net_income_for_allotment", kind: "derived", line: 61, value: "$386.50" },
  { id: "rate30", label: "snap_household_food_contribution_rate", kind: "parameter", line: 13, value: "0.30" },
  { id: "size2", label: "snap_minimum_allotment_household_size_limit", kind: "parameter", line: 45, value: "2" },
  { id: "rate8", label: "snap_minimum_allotment_rate", kind: "parameter", line: 29, value: "0.08" },
  { id: "contrib", label: "snap_household_food_contribution", kind: "derived", line: 86, value: "$115.95" },
  { id: "minimum", label: "snap_minimum_monthly_allotment", kind: "derived", line: 130, value: "$24" },
  { id: "before", label: "snap_allotment_before_minimum", kind: "derived", line: 105, value: "$182" },
  { id: "regular", label: "snap_regular_month_allotment", kind: "output", line: 158, value: "$182" },
];

export const GRAPH_EDGES: Array<[GraphNodeId, GraphNodeId]> = [
  ["imp2014", "net"],
  ["net", "contrib"],
  ["rate30", "contrib"],
  ["impUsda", "before"],
  ["contrib", "before"],
  ["impUsda", "minimum"],
  ["size2", "minimum"],
  ["rate8", "minimum"],
  ["before", "regular"],
  ["minimum", "regular"],
];

// Where each piece of the story leads once the scroll is done: the real
// page behind each step. Shown as clickable cards in the end state.
//
// The about lines for steps 4 to 8 state what the encoder and the rules do,
// read from code on 2026-11-24 (axiom-encode caa46624, rulespec-us
// fbc74a69, axiom-rules-engine 82cf3aa6):
// - encode applies a draft only once it compiles, its numbers and quotes are
//   found in its source and its tests pass (cmd_encode's overlay validation,
//   built with oracles off and reviewers skipped). One AI model reviews a
//   draft that passes; its verdict blocks apply only under
//   --require-review, which is off by default and set by no signed or CI
//   workflow. Program comparisons run in axiom-oracles, never in encode.
// - every executable rule in a jurisdiction repo names its source (the
//   encoder's CI refuses one without), and the engine will not compile a
//   version with no effective date. Citations sit on rules, not values.
// - the encoder takes one corpus citation at a time, in any jurisdiction;
//   /ops follows runs of the targeted re-encode workflow from dispatch to
//   merge (scripts/collect-encoding-pipeline.mjs), and no other encoder run.
//
// The walkthrough's worked example is § 2017(a), so step 5, where the code
// card quotes the published module, carries the same kind of dated waiver
// line as the journey film. At rulespec-us fbc74a69 (main on 2026-11-24),
// known-validation-gaps.yaml lists 1,930 modules under validate_failures,
// each with an active waiver, us/statutes/7/2017/a.yaml among them; the
// shared workflow rulespec-us pins (TheAxiomFoundation/.github
// validate-rulespec.yml@882c5f11) prints "SKIPPED (known-validation-gaps
// validate_failures)" for each in its validate, companion-test and proof
// steps. The list last changed on 2026-11-01, so the count held all day.
export const WAIVER_LINE =
  "On November 24, 2026 the published § 2017(a) module was one of 1,930 rulespec-us modules on the validation waiver list, whose checks CI skipped.";

export const EXPLORE: Array<{ n: number; name: string; go: string; href: string; about: string }> = [
  { n: 1, name: "Off the shelf", go: "See what is covered", href: "/coverage", about: "Primary sources: the statutes, regulations and agency manuals that legislatures and agencies publish." },
  { n: 2, name: "The law, as published", go: "Read § 2017(a)", href: "/us/statute/7/2017/a", about: "The official text is captured word for word and stored in the corpus: a database of the law, exactly as published." },
  { n: 3, name: "The corpus", go: "Browse Title 7", href: "/us/statute/7", about: "The corpus splits each document into its provisions. Each one has its own address, which follows its legal citation." },
  { n: 4, name: "Encode", go: "How the encoder works", href: "/encoder", about: "The encoder applies a draft only once it compiles, its numbers and quotes are found in its source, and its tests pass. An AI review of it is advisory." },
  { n: 5, name: "Cited code", go: "Explore this encoding", href: "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/us/statutes/7/2017/a.yaml#L105-L128", about: `Each rule cites the words it encodes. ${WAIVER_LINE}` },
  { n: 6, name: "The graph", go: "Explore the rule graph", href: "/app?compose=us:statutes/7/2017/a", about: "The rules of a program form one executable graph: each node is a rule, and each line is a value one rule reads from another." },
  { n: 7, name: "All the law", go: "Watch the pipeline", href: "/ops", about: "The same encoder works one provision at a time, in any program and any state. A public page follows targeted encoder runs from dispatch to merge." },
  { n: 8, name: "Potential uses", go: "Build on it", href: "/docs", about: "The rules are open and versioned, so any tool can build on them." },
];
