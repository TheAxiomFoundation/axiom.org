import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderedText } from "@/test/claim-copy";
import { CODE, EXPLORE, GRAPH_EDGES, GRAPH_NODES, WAIVER_LINE } from "../journey-digital/data";
import { CAPTIONS } from "../journey-lamplight/captions";
import { ASIDES, CHECKS_PASS, GATES, LAST_GATE, MOVE2, OPEN, REST_AT, REVIEW_READ, U, asideAt, draftAt, draftX, gateAt } from "./layout";
import { CODE_WAIVER_NOTE, NODE_NAME, OUTPUT_NOTE, SOURCE_ABOUT, STAGE_LABEL, USES_HEADING } from "./copy";
import { LiveStory, StaticStory } from "./journey-live";

// What the encoder walkthrough (the landing page, /present/encoder and the
// decks that embed it) may say, read from code on 2026-11-24:
// - `axiom-encode encode --apply` applies a draft only after it passes the
//   RuleSpec CI run, whose docstring reads "Run RuleSpec compile, executable
//   tests, and source-grounding checks" (axiom-encode caa46624:
//   validator_pipeline _run_rulespec_ci, inside cmd_encode's overlay
//   validation, which builds its pipeline with enable_oracles=False and
//   calls validate with skip_reviewers=True). A draft that fails goes back
//   to the model. So the rail holds encode and checks, and only checks can
//   pass. Grounding skips some numbers (0.5 in half-up rounding, the small
//   integers in GROUNDING_ALLOWED_VALUES, structural table keys), so step 4
//   names the checks and never says the source holds every number.
// - One AI model reviews a draft once its first compile and CI checks pass,
//   before apply-time repairs and the overlay validation check it again
//   (cli.py: run_model_eval, then the overlay), so the overlay can still
//   send a reviewed draft back. Its verdict never blocks apply unless the
//   encoder runs with --require-review, which is off by default and which
//   no signed or CI workflow sets (evals.py: the encode loop "never gates
//   apply on the reviewer"). So the review is labelled advisory, sits off
//   the rail, never shows a pass, reads draft 2 while checks are at work,
//   and its words say "by default".
// - Comparisons never run inside encode or apply; axiom-oracles runs them
//   apart, each suite on the outputs it names (a whole benefit in some, one
//   credit in others: axiom-oracles c599a7d8 us-savers-grid.yaml), where
//   another calculator covers them. So
//   comparison sits off the rail, says it runs separately and never passes.
// - § 2017(a) reduces the thrifty food plan by 30 percent of income "as
//   determined in accordance with section 2014(d) and (e)". The module the
//   graph draws (rulespec-us us/statutes/7/2017/a.yaml, 647a0648) imports
//   that income from the rule filed under 2014(e)(6)(A), the excess shelter
//   deduction, whose own source reads "7 USC 2014(d) and (e)". Its output is
//   max(allotment before the minimum, minimum allotment): $182 and $24 in
//   test case 1.
// - Every rule in the § 2017(a) module and its two imports names its source
//   and dates every version. The engine requires a date only on parameter
//   and derived versions (axiom-rules-engine 82cf3aa6, MissingEffectiveFrom),
//   and the encoder's validator requires a source only on parameter, derived
//   and derived_relation rules, so step 8 speaks of the § 2017(a) rules, not
//   every rule. Citations sit on rules, not on every value, and only program
//   artifacts are published as releases.
// - The published § 2017(a) module is waived: at rulespec-us fbc74a69 (main
//   on 2026-11-24) known-validation-gaps.yaml lists it among 1,930 modules
//   with an active validate_failures waiver, and the shared workflow
//   rulespec-us pins (TheAxiomFoundation/.github validate-rulespec.yml@
//   882c5f11) skips their validate, companion-test and proof steps. Its
//   apply manifest records the tool "axiom-encode deterministic/manual
//   repair" and the model "manual-repair-v1". So step 5,
//   where the code card quotes that module, carries a dated waiver line, as
//   the journey film does, and so does the stage label.
// - So nothing here says every rule went through the same encoder or the
//   same checks. Step 7's title says the encoder takes provisions from the
//   corpus: it resolves each citation against the pinned corpus release and
//   refuses one with no active match (corpus_resolver
//   CorpusSourceNotFoundError), and the release lacks some provisions
//   (rulespec-us fbc74a69 known-source-conflicts.yaml, pending_texts), so no
//   words claim any program in any state. /ops follows only the targeted
//   re-encode workflow's runs (scripts/collect-encoding-pipeline.mjs).
// - The four branches of step 8 are kinds of tool the rules could serve.

const NBSP = String.fromCharCode(0xa0);
const plain = (s: string) => s.split(NBSP).join(" ");

// The stage version is the scroll-driven picture; its effects need a real
// browser, so it is rendered to markup, which holds every element and word
// it draws. The scroll version renders as a phone or reduced motion gets it.
function stage(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<LiveStory />);
  return host;
}
function scroll(): HTMLElement {
  return render(<StaticStory />).container;
}
const textOf = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// The stage's label, pinned whole: every edit to it changes a claim.
const LABEL =
  "A law book comes off the shelf, opens on section 2017(a) and becomes one addressed cell of the corpus. " +
  "An AI model drafts the section's rules. In an example, checks send its first draft back, an AI review advises on the second, checks then pass it, and comparisons with other calculators run separately. " +
  "Each rule in the code cites the words it encodes. " +
  "On November 24, 2026 the published § 2017(a) module was one of 1,930 rulespec-us modules on the validation waiver list, whose checks CI skipped. " +
  "For test case 1, an eligible household of one, the rules run as a graph to $182, the greater of $182 and $24. " +
  "The graph shrinks to section 2017(a) of the Food and Nutrition Act, among other bodies of law such as the Internal Revenue Code and state statutes. " +
  "The section 2017(a) rules carry source citations and effective dates, and four potential uses branch from them.";

// The waiver line, in the journey film's form, dated to the read above.
const WAIVER =
  "On November 24, 2026 the published § 2017(a) module was one of 1,930 rulespec-us modules on the validation waiver list, whose checks CI skipped.";

// Each step's words beside the drawing that state a fact, pinned whole, as
// journey-film-claims.test.tsx pins its captions: an overclaim in new words
// would pass the retired-word sweep below, so each edit has to land here.
const ENCODE_ABOUT =
  "The encoder applies a draft only after it passes compile, companion-test and source-grounding checks. By default, any AI review of it advises and stops nothing.";
const CITED_ABOUT = `Each rule cites the words it encodes. ${WAIVER}`;
const GRAPH_ABOUT =
  "The rules of a program form one executable graph: each node is a rule, and each line is a value one rule reads from another.";
const SCALE_ABOUT = "A public page follows targeted encoder runs from dispatch to merge.";
const SCALE_TITLE = "One encoder takes provisions from the corpus, one at a time.";
const USES_TITLE = "One open set of rules that many kinds of tool can build on.";

// A tick anywhere on a line that names either step off the rail, before or
// after the name (rendered text puts each list item on its own line). The
// name takes no word boundary after it: rendered text joins inline spans,
// so a name can run straight into the words after it ("Program
// comparisonRuns separately").
const TICK_BESIDE_ASIDE = /^(?=[^\n]*[✓✔])(?=[^\n]*\b(AI review|compar))[^\n]*$/im;

// Words the walkthrough retired. They read words, not sense.
const RETIRED = [
  /\beach value cites\b/i,
  /\bevery value\b/i,
  /\bin versioned releases\b/i,
  /\bevery kind of tool\b/i,
  /\bone source for every\b/i,
  /\bevery system\b/i,
  /\bworks from the same set\b/i,
  /\bAI judges?\b/i,
  /\bpowers every\b/i,
  /\bthe same (process|checks)\b/i,
  /\blaw by law\b/i,
  /\bany program\b/i,
  /\bnumbers and quotes\b/i,
  /\bruntime registry\b/i,
  TICK_BESIDE_ASIDE,
  /2014\(e\)\(6\)/,
];

// The walkthrough's own words: the step titles and about lines it shows
// beside each step, and the stage label.
const WALKTHROUGH_COPY = [STAGE_LABEL, ...CAPTIONS.map((c) => c.title), ...EXPLORE.flatMap((e) => [e.name, e.about])];

describe("step 4: the gates", () => {
  it("puts only encode and checks on the rail, and the review and comparison off it", () => {
    expect(GATES.map((g) => g.name)).toEqual(["encode", "checks"]);
    expect(LAST_GATE).toBe(1);
    expect(ASIDES.map((a) => a.name)).toEqual(["AI review · advisory", "Comparison"]);
    const compare = ASIDES.find((a) => a.id === "compare")!;
    expect(compare.about).toMatch(/^Runs separately\b/);
    expect(compare.about).toContain("on selected outputs, where another calculator covers them");
    expect(compare.about).not.toMatch(/whole program/i);
    expect(ASIDES.find((a) => a.id === "review")!.about).toBe("One AI model reads the draft. By default, its verdict does not stop the draft.");
    // the gate names its checks, not what they prove
    expect(GATES.map((g) => g.about)).toEqual(["An AI model drafts the rule", "It passes compile, grounding and test checks"]);
  });

  it("never shows a pass for the AI review or the comparison, at any moment", () => {
    for (let u = -0.5; u <= U.end + 0.5; u += 0.005) {
      for (const a of ASIDES) expect(["idle", "active", "aside"], `${a.id} at ${u}`).toContain(asideAt(a.id, u));
      expect(["idle", "active", "done"], `encode at ${u}`).toContain(gateAt(0, u).state);
      expect(["idle", "active", "fail", "pass"], `checks at ${u}`).toContain(gateAt(1, u).state);
    }
    // the review reads draft 2 once it reaches checks and while checks are
    // still at work; checks pass only after it, and before the step rests
    expect(REVIEW_READ[0]).toBeGreaterThanOrEqual(MOVE2[1]);
    expect(REVIEW_READ[1]).toBeLessThanOrEqual(CHECKS_PASS);
    expect(OPEN + CHECKS_PASS).toBeLessThanOrEqual(REST_AT[3]);
    expect(CHECKS_PASS).toBeLessThan(U.t45[0]);
    for (let u = REVIEW_READ[0]; u < CHECKS_PASS; u += 0.01) expect(gateAt(1, u).state, `checks at ${u}`).toBe("active");
    expect(gateAt(1, CHECKS_PASS).state).toBe("pass");
    // the review waits, reads draft 2, then stands aside; draft 1 never reaches it
    expect(asideAt("review", U.draft1[1] - 0.01)).toBe("idle");
    expect(asideAt("review", REVIEW_READ[0] - 0.01)).toBe("idle");
    expect(asideAt("review", (REVIEW_READ[0] + REVIEW_READ[1]) / 2)).toBe("active");
    expect(asideAt("review", REVIEW_READ[1])).toBe("aside");
    expect(asideAt("review", U.end)).toBe("aside");
    // the comparison stands apart throughout
    for (let u = -0.5; u <= U.end + 0.5; u += 0.05) expect(asideAt("compare", u)).toBe("aside");
  });

  it("ends draft 2 at checks, and turns it into the code only once checks pass", () => {
    let furthest = -Infinity;
    for (let u = U.draft2[0]; u < U.draft2[1]; u += 0.005) furthest = Math.max(furthest, draftAt(u)!.x);
    expect(furthest).toBeCloseTo(draftX(LAST_GATE));
    expect(draftAt(U.draft2[1] - 0.01)!.x).toBeCloseTo(draftX(LAST_GATE));
    expect(gateAt(1, U.t45[0]).state).toBe("pass");
    expect(gateAt(1, U.t45[0]).text).toBe("passes");
  });

  it("draws the review and comparison with no mark, in the stage version", () => {
    const root = stage();
    expect([...root.querySelectorAll(".jv-gate .jv-gate__name")].map(textOf)).toEqual(["encode", "checks"]);
    const asides = [...root.querySelectorAll(".jv-aside")];
    expect(asides.map((a) => textOf(a.querySelector(".jv-aside__name")))).toEqual(ASIDES.map((a) => a.name));
    for (const a of asides) {
      expect(a.classList.contains("jv-gate")).toBe(false);
      expect(a.closest(".jv-gate")).toBeNull();
      expect(a.querySelector(".jv-gate__mark")).toBeNull();
      expect(a.textContent).not.toMatch(/[✓✔]/);
    }
  });

  // The stage draws its ticks in CSS: a gate's from its state, so only a
  // gate on the rail can take one, and the draft's own test result. Comments
  // are stripped first, so a note above a rule never joins its selector, and
  // a tick in either quote, as a glyph or as an escape, counts.
  it("ticks only gates on the rail, in the stylesheet", () => {
    const raw = readFileSync(join(process.cwd(), "src/components/landing/journey-live/journey-live.css"), "utf8");
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1].split(",").map((s) => s.trim()),
      body: m[2],
    }));
    const TICK = /(?<![-\w])content\s*:\s*["'](?:[✓✔]|\\0{0,2}271[34])/i;
    const SETS_CONTENT = /(?<![-\w])content\s*:/i;
    const ticked = rules.filter((r) => TICK.test(r.body)).flatMap((r) => r.selectors);
    const allowed = [/^\.jv-gate\[data-state="(done|pass)"\] \.jv-gate__mark::after$/, /^\.jv-test b::before$/];
    expect(ticked.length).toBeGreaterThan(0);
    for (const sel of ticked) expect(allowed.some((r) => r.test(sel)), sel).toBe(true);
    // a step off the rail takes no generated content at all, tick or not
    for (const r of rules) {
      if (r.selectors.some((s) => s.includes(".jv-aside"))) expect(SETS_CONTENT.test(r.body), r.selectors.join(", ")).toBe(false);
    }
    // the matcher itself sees each way of writing a tick
    for (const body of ['content: "✓"', "content: '✔'", 'content:"\\2713"', "content: '\\002714'"]) expect(TICK.test(body), body).toBe(true);
    expect(TICK.test('justify-content: "✓"')).toBe(false);
  });

  it("ticks encode and checks and nothing else, in the scroll version", () => {
    const root = scroll();
    const rail = [...root.querySelectorAll(".js-gates li")];
    expect(rail.map((li) => textOf(li.querySelector(".js-gate")))).toEqual(["encode", "checks"]);
    for (const li of rail) expect(textOf(li.querySelector(".js-gate__ok"))).toBe("✓");
    const off = [...root.querySelectorAll(".js-asides li")];
    expect(off.map((li) => textOf(li.querySelector(".js-aside")))).toEqual(ASIDES.map((a) => a.name));
    for (const li of off) {
      expect(li.querySelector(".js-gate__ok")).toBeNull();
      expect(li.textContent).not.toMatch(/[✓✔]/);
    }
    expect(root.querySelectorAll(".js-gate__ok")).toHaveLength(2);
  });

  it("says what gates apply and that the review is advisory, beside the step", () => {
    expect(EXPLORE[3].about).toBe(ENCODE_ABOUT);
  });
});

describe("step 5: the cited code", () => {
  it("pins its words, with the waiver line for the published module", () => {
    expect(WAIVER_LINE).toBe(WAIVER);
    expect(EXPLORE[4].about).toBe(CITED_ABOUT);
  });

  it("shows the waiver line beside step 5, in both versions", () => {
    const caps = [...stage().querySelectorAll(".jv-cap__about")].map(textOf);
    expect(caps).toHaveLength(8);
    expect(caps[4]).toBe(plain(CITED_ABOUT));
    // only step 5 carries it, once
    expect(caps.filter((c) => c.includes(plain(WAIVER)))).toHaveLength(1);
    const abouts = [...scroll().querySelectorAll(".js-about")].map(textOf);
    expect(abouts).toHaveLength(8);
    expect(abouts[4]).toBe(plain(CITED_ABOUT));
  });

  it("names the waiver on the code card itself, which no width or framing slide hides", () => {
    expect(CODE_WAIVER_NOTE).toBe("checks waived in CI");
    const meta = stage().querySelector("[data-code] [data-code-meta]");
    expect(textOf(meta)).toBe(`lines 105–128 · ${CODE_WAIVER_NOTE}`);
    // the bar sits inside the card, not in the side column a slide or a
    // narrower stage hides
    expect(meta!.closest(".jv-side")).toBeNull();
  });
});

describe("step 6: the graph", () => {
  it("names the imported net income by the law it follows", () => {
    expect(plain(NODE_NAME.imp2014)).toBe("Net income under 7 U.S.C. § 2014(d) and (e)");
    // no-break spaces keep the citation on one line
    expect(NODE_NAME.imp2014).toContain(["7", "U.S.C.", "§", "2014(d)"].join(NBSP));
    for (const name of Object.values(NODE_NAME)) expect(name).not.toMatch(/2014\(e\)\(6\)/);
    // the module's own import path stays the node's identifier
    expect(GRAPH_NODES.find((n) => n.id === "imp2014")!.label).toBe("§ 2014(e)(6)(A) · snap_net_income");
  });

  it("draws that name on the node, in both versions", () => {
    const NAME = "Net income under 7 U.S.C. § 2014(d) and (e)";
    expect(textOf(stage().querySelector('[data-node="imp2014"] .jv-node__label'))).toBe(NAME);
    // the scroll version lists the nodes in firing order, with no id
    const labels = [...scroll().querySelectorAll(".js-node__label")].map(textOf);
    expect(labels).toHaveLength(GRAPH_NODES.length);
    expect(labels.filter((l) => l === NAME)).toHaveLength(1);
  });

  it("pins the step's words", () => {
    expect(EXPLORE[5].about).toBe(GRAPH_ABOUT);
  });

  it("labels the output the eligible case's greater of its two inputs, in both versions", () => {
    expect(OUTPUT_NOTE).toBe("Eligible, so the greater of $182 and $24");
    expect(textOf(stage().querySelector('[data-node="regular"] .jv-node__note'))).toBe(OUTPUT_NOTE);
    expect(stage().querySelectorAll(".jv-node__note")).toHaveLength(1);
    expect(textOf(scroll().querySelector(".js-node--hero .js-node__note"))).toBe(OUTPUT_NOTE);
    // and the result the note explains is the one drawn
    expect(textOf(scroll().querySelector(".js-node--hero b"))).toBe("$182");
  });

  // Each line is a name the target's formula reads. The formula of a rule
  // is its rows in CODE (data.ts's transcription of a.yaml, which the code
  // card quotes in part) after its name row, up to the next rule. A name
  // counts only whole, so snap_net_income is not read where the formula
  // says snap_net_income_for_allotment. The stage draws its lines from
  // GRAPH_EDGES (one pair of paths each, below), so this checks the edge
  // list against the transcription, not pixels.
  it("draws a line into each rule from every drawn rule its formula reads, and no other", () => {
    const formula = (line: number) => {
      const rows: string[] = [];
      for (let i = CODE.findIndex((r) => "n" in r && r.n === line) + 1; i < CODE.length; i++) {
        const r = CODE[i];
        if (!("n" in r)) continue;
        if (/^\s*- name:/.test(r.text)) break;
        rows.push(r.text);
      }
      return rows.join("\n");
    };
    const reads = (text: string, rule: string) => new RegExp(`(^|[^A-Za-z0-9_])${rule}([^A-Za-z0-9_]|$)`).test(text);
    const expected = GRAPH_NODES.filter((b) => b.kind === "derived" || b.kind === "output").flatMap((b) =>
      GRAPH_NODES.filter((a) => a.id !== b.id && reads(formula(b.line), a.rule)).map((a) => `${a.id} > ${b.id}`),
    );
    expect(GRAPH_EDGES.map(([a, b]) => `${a} > ${b}`).sort()).toEqual(expected.sort());
    // the minimum reads the one-person food plan cost, not the household's
    // maximum allotment: two rules, both $298 for one person
    expect(expected).toContain("impTfp > minimum");
    expect(expected).not.toContain("impUsda > minimum");
    expect(expected).toContain("impUsda > before");
  });

  it("gives the stage one line, base and lit, for each graph edge", () => {
    expect(stage().querySelectorAll("[data-edge-base]")).toHaveLength(GRAPH_EDGES.length);
    expect(stage().querySelectorAll("[data-edge-lit]")).toHaveLength(GRAPH_EDGES.length);
  });

  // The stage writes each node's value from GRAPH_NODES once it fires, and
  // the scroll version prints them, so the values are checked here against
  // a.yaml's formulas, run on test case 1's inputs (a household of one).
  it("gives each node the value a.yaml's formula yields for test case 1", () => {
    const value = (id: string) => GRAPH_NODES.find((n) => n.id === id)!.value;
    const num = (id: string) => Number(value(id).replace(/[$,]/g, "").split(" ")[0]);
    const household = 1;
    const net = num("imp2014");
    const contrib = num("rate30") * net;
    const before = Math.floor(Math.max(0, num("impUsda") - contrib));
    const minimum = household <= num("size2") ? Math.floor(num("impTfp") * num("rate8") + 0.5) : 0;
    const money = (v: number) => "$" + (Number.isInteger(v) ? String(v) : v.toFixed(2));
    expect(num("net")).toBe(net);
    expect(value("contrib")).toBe(money(contrib));
    expect(value("before")).toBe(money(before));
    expect(value("minimum")).toBe(money(minimum));
    expect(value("regular")).toBe(money(Math.max(before, minimum)));
    expect([before, minimum, Math.max(before, minimum)]).toEqual([182, 24, 182]);
  });
});

describe("step 8: one source and its potential uses", () => {
  it("says the § 2017(a) rules carry source citations and effective dates, in both versions", () => {
    expect(SOURCE_ABOUT).toBe("The § 2017(a) rules carry source citations and effective dates.");
    expect(textOf(stage().querySelector(".jv-source__about"))).toBe(SOURCE_ABOUT);
    expect(textOf(scroll().querySelector(".js-source article p"))).toBe(SOURCE_ABOUT);
  });

  it("heads the four branches as potential uses, in both versions", () => {
    expect(USES_HEADING).toBe("Potential uses");
    const live = stage();
    const heading = live.querySelector("[data-uses]")!;
    expect(textOf(heading)).toBe("Potential uses");
    const firstUse = live.querySelector("[data-user]")!;
    expect(heading.compareDocumentPosition(firstUse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const root = scroll();
    const kids = [...root.querySelector(".js-source")!.children];
    const at = kids.findIndex((el) => el.classList.contains("js-uses"));
    expect(textOf(kids[at])).toBe("Potential uses");
    expect(kids.slice(at + 1).every((el) => el.classList.contains("js-user"))).toBe(true);
    expect(kids.slice(at + 1)).toHaveLength(4);
  });
});

describe("the words around the drawings", () => {
  it("describes the stage as it now draws, and nothing more", () => {
    expect(STAGE_LABEL).toBe(LABEL);
    expect(stage().querySelector(".jv-live")?.getAttribute("aria-label")).toBe(LABEL);
  });

  it("names step 8 for potential uses, not every system", () => {
    expect(EXPLORE[7].name).toBe("Potential uses");
    expect(EXPLORE[7].about).toBe("The rules are open and versioned, so any tool can build on them.");
  });

  // Steps 7 and 8 say what the encoder and the rules can do. Decks that
  // frame the walkthrough compare these titles with their own copies.
  it("pins the step 7 and step 8 titles and the step 7 words", () => {
    expect(CAPTIONS[6].title).toBe(SCALE_TITLE);
    expect(CAPTIONS[7].title).toBe(USES_TITLE);
    expect(EXPLORE[6].about).toBe(SCALE_ABOUT);
  });

  it("catches a tick on the same line as a step off the rail, before or after its name", () => {
    const tick = TICK_BESIDE_ASIDE;
    expect(RETIRED).toContain(tick);
    expect("AI review · advisoryOne AI model reads the draft.✓").toMatch(tick);
    expect("✓ Comparison").toMatch(tick);
    // inline spans run together in rendered text
    expect("ComparisonRuns separately, on selected outputs✔").toMatch(tick);
    expect("checks\nIt compiles ✓\nAI review · advisory").not.toMatch(tick);
  });

  it("carries no retired claim, in its strings or either rendered version", () => {
    const copy = [...WALKTHROUGH_COPY, renderedText(stage()), renderedText(scroll())];
    for (const text of copy) for (const retired of RETIRED) expect(plain(text), String(retired)).not.toMatch(retired);
  });
});
