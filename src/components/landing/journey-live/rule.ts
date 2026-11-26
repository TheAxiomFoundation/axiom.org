// Beat 5: one real rule, whole, and where each piece of it comes from.
//
// The rule is snap_allotment_before_minimum, lines 105–128 of rulespec-us
// us/statutes/7/2017/a.yaml (rulespec-us 647a0648), quoted exactly. Each
// marked token belongs to one step: the words of § 2017(a) that put it
// there. Tokens with no step (the rule's name, its period, the date it
// takes effect, the max(0, …) guard, the import's hash) are not claimed
// to come from the sentence; they show as plain code throughout.

// `thread: false`: lit with its step, but no thread runs to it (the
// bracket that closes floor( )).
export type Tok = string | { t: string; step: number; thread?: false };
export type RuleLine = { n: number; parts: Tok[] };

const tok = (step: number, t: string, thread?: false): Tok => (thread === false ? { t, step, thread } : { t, step });

export const RULE_LINES: RuleLine[] = [
  { n: 105, parts: ["  - name: snap_allotment_before_minimum"] },
  { n: 106, parts: ["    kind: derived"] },
  { n: 107, parts: ["    entity: ", tok(0, "Household")] },
  { n: 108, parts: ["    dtype: ", tok(5, "Money")] },
  { n: 109, parts: ["    period: Month"] },
  { n: 110, parts: ["    unit: ", tok(5, "USD")] },
  { n: 111, parts: ["    source: ", tok(6, "7 USC 2017(a)"), ", ", tok(7, '"cost ... of the thrifty food plan reduced ... rounded to the nearest lower whole dollar"')] },
  { n: 112, parts: ["    metadata:"] },
  { n: 113, parts: ["      proof:"] },
  { n: 114, parts: ["        atoms:"] },
  { n: 115, parts: ["          - path: versions[0].formula"] },
  { n: 116, parts: ["            kind: formula"] },
  { n: 117, parts: ["            source:"] },
  { n: 118, parts: ["              corpus_citation_path: ", tok(6, "us/statute/7/2017")] },
  { n: 119, parts: ["          - path: versions[0].formula"] },
  { n: 120, parts: ["            kind: ", tok(1, "import")] },
  { n: 121, parts: ["            import:"] },
  { n: 122, parts: ["              target: ", tok(1, "us:policies/usda/snap/fy-2026-cola/maximum-allotments#snap_maximum_allotment")] },
  { n: 123, parts: ["              output: ", tok(1, "snap_maximum_allotment")] },
  { n: 124, parts: ["              hash: sha256:2e4708b8df906b506f07d091fe93dbcc6aefe603a31500502ecc270d436e9f2e"] },
  { n: 125, parts: ["    versions:"] },
  { n: 126, parts: ["      - effective_from: '2008-10-01'"] },
  { n: 127, parts: ["        formula: |-"] },
  { n: 128, parts: ["          ", tok(4, "floor("), "max(0, ", tok(1, "snap_maximum_allotment"), tok(2, " - "), tok(3, "snap_household_food_contribution"), ")", tok(4, ")", false)] },
];

// Words this beat marks on their own. `within` is the marked phrase they
// stand in (null: the plain text between phrases), so the same word
// elsewhere in the sentence is left alone.
export const SUB_PHRASES: Array<{ within: string | null; words: string; id: string }> = [
  { within: "eligible", words: "households", id: "hh" },
  { within: null, words: "reduced by", id: "reduced" },
  { within: null, words: "an amount equal to", id: "amount" },
  { within: "floor", words: "dollar", id: "dollar" },
];
// a marked word inside a marked phrase is lit when the phrase is
export const PHRASE_PARENT: Record<string, string> = { hh: "eligible", dollar: "floor" };

// The steps, in the sentence's reading order. `phrases` are the words that
// light in the statute card (the last is where the threads start; the
// address sits in the card's bar); `what` says what those words set. One
// thread runs to each token of the step.
export const RULE_STEPS: Array<{ phrases: string[]; what: string }> = [
  { phrases: ["hh"], what: "“households” is who the rule is about: its entity" },
  { phrases: ["tfp"], what: "the starting amount, and the USDA table it is read from" },
  { phrases: ["reduced"], what: "“reduced by” is the subtraction" },
  { phrases: ["amount", "rate30", "income"], what: "what is taken off: the household’s contribution, a rule of its own" },
  { phrases: ["floor"], what: "“the nearest lower whole dollar” is floor( )" },
  { phrases: ["dollar"], what: "“dollar” is the type and the unit" },
  { phrases: ["address"], what: "the provision’s address is the citation the rule carries" },
  { phrases: ["tfp", "reduced", "floor"], what: "the rule quotes the words it encodes" },
];

// every thread: a step and one of its tokens, in the order the tokens stand
export const RULE_THREADS: Array<{ step: number; tok: number }> = [];
{
  let k = 0;
  for (const line of RULE_LINES) {
    for (const part of line.parts) {
      if (typeof part === "string") continue;
      if (part.thread !== false) RULE_THREADS.push({ step: part.step, tok: k });
      k++;
    }
  }
}

export const RULE_ROW_H = 21;
