import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileCopy, renderedText } from "@/test/claim-copy";

// What the film may say about the gates, per axiom-encode main (6f08e25c,
// read 2026-10-03):
// - run and checks block every `encode --apply`: compile, source grounding
//   and the companion tests (harness/evals.py
//   _eval_artifact_validation_error; the apply revalidation builds its
//   pipeline with enable_oracles=False and calls validate with
//   skip_reviewers=True).
// - compare never runs inside the encoder: run_model_eval's oracle mode
//   defaults to "none" and `encode` has no flag to change it. Comparisons
//   run later in axiom-oracles on program outputs: 14,030 of 34,810
//   rulespec-us rules sit on a compared program surface
//   (dashboard/public/data/rule_verification_summary.json, 2026-09-28).
//   For SNAP the one calculator compared is PolicyEngine; the SNAP QC
//   replay uses USDA case records.
// - review is one call to an AI model (REVIEWER_CLI_MODEL = "opus"),
//   skipped by --skip-reviewers, and its verdict never blocks apply.
// - Nothing holds for every published module: rulespec CI skips the 1,940
//   modules on known-validation-gaps.yaml (2066cef6, 2026-10-02),
//   § 2017(a) among them, and the TheAxiomFoundation/.github workflow
//   validate-rulespec.yml prints "SKIPPED (known-validation-gaps
//   validate_failures)" for each.
// So the only universal gate the film names is the encoder's, and the
// caption names the encoder as its subject; compare is scoped to programs
// another calculator covers; the review chip says AI; scene II is titled an
// illustration (the title is the line that stays readable on a phone); and
// the label says the published § 2017(a) module was waived.
// PolicyEngine is not independent of Axiom (Max Ghenis is CEO of both, and
// PSL Foundation fiscally sponsors both), so the film never calls it
// independent.
//
// The /docs strip draws the same loop, so it keeps to the same facts,
// reread on axiom-encode main (5d40209b, 2026-11-01): the encode retry loop
// "feeds only compile/CI findings back to the model and never gates apply on
// the reviewer" (harness/evals.py), encode sets
// reviewers_require_deterministic_pass, and the --oracle flag belongs to
// `validate`, never `encode`. So the strip ticks run and checks and nothing
// else, only they send a draft back, the AI review stays unticked, and
// compare stays out of the loop, beside its scope. The strip's worked example
// is § 2017, so the strip carries the film's waiver line where a reader sees
// it, in fullscreen too.

// The test setup stubs prefers-reduced-motion on, which renders the
// composed still; the animated film needs it off. STATIC is read at module
// load, so each render reloads the module.
function stubMotion(motion: boolean) {
  if (!motion) return;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

async function renderFilm({ motion }: { motion: boolean }) {
  stubMotion(motion);
  vi.resetModules();
  const { JourneyFilm } = await import("./journey-film");
  const { container } = render(<JourneyFilm />);
  const svg = container.querySelector("svg[role='img']");
  const words = [...container.querySelectorAll("text")].map((t) => t.textContent ?? "");
  return {
    captions: [...container.querySelectorAll("text.jw-sub")].map((t) => t.textContent ?? ""),
    names: [...container.querySelectorAll("text.jw-name")].map((t) => (t.textContent ?? "").trim()),
    chips: [...container.querySelectorAll("tspan.jw-gatetick-name")].map((t) => t.textContent ?? ""),
    label: svg?.getAttribute("aria-label") ?? "",
    redraft: container.querySelector("text.jw-redraft"),
    draftFormula: [...container.querySelectorAll("text.jw-wbcode")].find((t) =>
      (t.textContent ?? "").includes("0.03"),
    ),
    ticks: [...container.querySelectorAll("text.jw-gatetick")].filter(
      (t) => (t.textContent ?? "").trim() === "✓✓",
    ),
    words,
  };
}

async function renderStrip({ motion }: { motion: boolean }) {
  stubMotion(motion);
  vi.resetModules();
  const { FlatStrip } = await import("@/components/docs/flat-strip");
  const { container } = render(<FlatStrip />);
  const texts = [...container.querySelectorAll("text")];
  return {
    chipNames: [...container.querySelectorAll("g.fp-gate text")].map((t) => (t.textContent ?? "").replace(/^✓ /, "")),
    container,
    gateChips: [...container.querySelectorAll("rect.fp-gatechip")],
    label: container.querySelector("svg[role='img']")?.getAttribute("aria-label") ?? "",
    redraft: container.querySelector("path.fp-redraft"),
    texts,
    words: texts.map((t) => t.textContent ?? ""),
  };
}

// One clause per sentence or semicolon-separated part.
function clauses(text: string): string[] {
  return text.split(/[.;]\s+/).filter(Boolean);
}

// The clause loop only polices explicit quantifiers. A generic-article
// universal ("a draft must…") slips past it, so captions are also pinned
// by exact string below.
const UNIVERSAL = /\b(every|each|all|any|always)\b/i;
const SCOPED_COMPARE =
  /\bcompared (where another calculator covers them|through their outputs later, where another calculator covers them)\b/;

// The words the /docs strip retired. They read words, not sense, so an honest
// negation trips them too, and the page says it another way.
const RETIRED_DOCS_COPY = [
  /\bAI judges?\b/i,
  /\bthe whole law\b/i,
  /✓\s*(AI review|oracles?|compare)\b/i,
  /\b(human|expert) review\b|\bhuman sign-?off\b/i,
  /\bproof required\b|\bvalidators? refuses?\b/i,
];
// The repo table on /docs names axiom-oracles, so these two hold for the strip
// alone.
const RETIRED_STRIP_COPY = [...RETIRED_DOCS_COPY, /\bdeterministic\b/i, /\boracles?\b/i];

const COMPARE_CAPTION = "programs compared where another calculator covers them";
const COMPARE_SENTENCE =
  /\b[Pp]rograms are compared through their outputs later, where another calculator covers them/;
const WAIVER_LINE =
  "On October 2, 2026 the published § 2017(a) module was one of 1,940 rulespec-us modules on the validation waiver list, whose checks CI skipped.";
// Every edit to the label changes a claim, so each one has to change here too.
const STRIP_LABEL =
  "The Axiom pipeline as five equal stations. The intake: scraping pipelines (eCFR, USLM, state codes, laws-lois) fill the database — nothing ever leaves. The corpus, word for word, with § 2017 pulled forward. One provision at a time feeds the encoding loop, where encoders draft (30 per centum becomes 0.30) and the run and checks validators send failing drafts back. The encoder applies a draft only once it compiles and passes its own tests. The AI review's score does not block apply. The RuleSpec snap_allotment plugs into the rules graph — tfp and income feed it, benefit flows out — which compiles into a program artifact, powering the chatbot, dashboards, and APIs. Programs are compared through their outputs later, where another calculator covers them. On October 2, 2026 the published § 2017(a) module was one of 1,940 rulespec-us modules on the validation waiver list, whose checks CI skipped.";
// The encoding station's box, from XS.loop and BOX.w in flat-strip.tsx.
const LOOP_BOX = { left: 500, right: 700 };

describe.each([
  { mode: "animated", motion: true },
  { mode: "reduced-motion still", motion: false },
])("journey film gate claims ($mode)", ({ motion }) => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("never calls the other calculator independent, or plural for SNAP", async () => {
    const { label, words } = await renderFilm({ motion });
    for (const text of [label, ...words]) {
      expect(text).not.toMatch(/independent/i);
      expect(text).not.toMatch(/other calculators/i);
    }
    if (motion) expect(label).toContain("disagrees with another calculator at compare");
    expect(words.map((w) => w.trim())).toContain("✗ disagrees with another calculator — redrafted");
  });

  it("names only the encoder's gate as universal, and scopes compare", async () => {
    const { captions, label, words } = await renderFilm({ motion });
    if (motion) {
      expect(captions).toContain(
        "encoder drafts must pass their tests — programs compared where another calculator covers them",
      );
    }
    expect(label).toContain(
      "The encoder applies a draft only once it compiles and passes its own tests; programs are compared through their outputs later, where another calculator covers them.",
    );
    for (const text of [...captions, label, ...words]) {
      expect(text).not.toMatch(/four ways|walked through the four gates/i);
      for (const clause of clauses(text)) {
        if (!UNIVERSAL.test(clause)) continue;
        // A universal clause may name a comparison only with its scope,
        // and may never claim a check, a pass, a verification or a review.
        if (/compar/i.test(clause)) expect(clause).toMatch(SCOPED_COMPARE);
        expect(clause).not.toMatch(/\bcheck|\bpass(es|ed|ing)?\b|\bverif|\breview/i);
      }
    }
  });

  it("names the AI review on its chip and titles the scene an illustration", async () => {
    const { chips, draftFormula, label, names, redraft, words } = await renderFilm({ motion });
    expect(new Set(chips)).toEqual(new Set(["run", "checks", "compare", "AI review"]));
    // On screen, in both modes: the scene title, which phones enlarge, and
    // the workbench eyebrow, which they do not.
    expect(names).toContain("One provision, encoded — an illustration");
    expect(words.map((w) => w.trim())).toContain("illustration");
    const gates = clauses(label).filter((c) => /four (stamped )?gates/.test(c));
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatch(
      motion
        ? /^In this illustration the workbench stamps four gates/
        : /^In this illustration the workbench shows four stamped gates/,
    );
    expect(gates[0]).toContain("and AI review");
    // The label narrates the redraft only where the film plays it.
    if (motion) {
      expect(label).toContain("is redrafted to 0.30, and passes");
    } else {
      expect(label).not.toMatch(/0\.03|redraft/);
      // ...which holds only while the still keeps both beats hidden.
      expect(redraft?.getAttribute("opacity")).toBe("0");
      expect(draftFormula?.getAttribute("opacity")).toBe("0");
    }
    expect(label).toContain(
      "On October 2, 2026 the published § 2017(a) module was one of 1,940 rulespec-us modules on the validation waiver list, whose checks CI skipped.",
    );
    expect(label).toContain(
      motion
        ? "The other two sections are stamped run and checks."
        : "the other two sections show two ticks, for run and checks.",
    );
    expect(label).not.toMatch(/\bhuman\b/i);
  });

  it("stamps the other sections with two ticks, for run and checks", async () => {
    const { words, ticks } = await renderFilm({ motion });
    expect(ticks).toHaveLength(2);
    for (const tick of ticks) {
      // The still shows them; the film flashes them in from hidden.
      if (motion) {
        expect(tick.getAttribute("opacity")).toBe("0");
        expect(tick.querySelector("animate")).not.toBeNull();
      } else {
        expect(tick.getAttribute("opacity")).toBe("1");
      }
    }
    expect(words.join(" ")).not.toContain("✓✓✓");
  });
});

describe.each([
  { mode: "animated", motion: true },
  { mode: "reduced-motion still", motion: false },
])("/docs strip gate claims ($mode)", ({ motion }) => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("ticks run, checks and the compile seal, and nothing else", async () => {
    const { chipNames, container, gateChips, words } = await renderStrip({ motion });
    expect(chipNames).toEqual(["run", "checks", "AI review"]);
    // Position, not a class name, so a chip drawn beside these still counts.
    const loopChips = [...container.querySelectorAll("rect.fp-chip, rect.fp-gatechip")].filter((chip) => {
      const x = Number(chip.getAttribute("x"));
      return x >= LOOP_BOX.left && x < LOOP_BOX.right;
    });
    expect(loopChips).toHaveLength(3);
    expect(words.filter((w) => w.includes("✓"))).toEqual(["✓ run", "✓ checks", "✓"]);
    expect(gateChips).toHaveLength(2);
  });

  it("names the AI review once, on a chip with no tick", async () => {
    const { texts, words } = await renderStrip({ motion });
    const reviews = texts.filter((t) => /AI review/.test(t.textContent ?? ""));
    expect(reviews).toHaveLength(1);
    expect(words).toContain("AI review");
    expect(reviews[0].closest(".fp-gatetext, .fp-gatechip")).toBeNull();
    expect(reviews[0].previousElementSibling?.getAttribute("class")).toBe("fp-chip");
  });

  it("sends a draft back from checks, never from the AI review", async () => {
    const { container, gateChips, label, redraft } = await renderStrip({ motion });
    // One dashed arrow: it leaves from just left of the checks chip, level
    // with it, and no second one leaves the AI review.
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(1);
    const [startX, startY] = (/^M (\S+) (\S+)/.exec(redraft?.getAttribute("d") ?? "") ?? []).slice(1).map(Number);
    const checksX = Number(gateChips[1].getAttribute("x"));
    const checksY = Number(gateChips[1].getAttribute("y"));
    expect(checksX - startX).toBeGreaterThanOrEqual(0);
    expect(checksX - startX).toBeLessThanOrEqual(8);
    expect(startY).toBeGreaterThanOrEqual(checksY);
    expect(startY).toBeLessThanOrEqual(checksY + Number(gateChips[1].getAttribute("height")));
    // The label says the same, and gives the AI review no other job.
    expect(clauses(label).filter((c) => /\b(sends?|back|redraft\w*|blocks?)\b/i.test(c))).toEqual([
      "One provision at a time feeds the encoding loop, where encoders draft (30 per centum becomes 0.30) and the run and checks validators send failing drafts back",
      "The AI review's score does not block apply",
    ]);
    expect(clauses(label).filter((c) => /\breview/i.test(c))).toEqual([
      "The AI review's score does not block apply",
    ]);
  });

  it("names compare only beside its scope, under the compile seal", async () => {
    const { label, texts, words } = await renderStrip({ motion });
    expect(words.filter((w) => /compar/i.test(w))).toEqual(["compare", COMPARE_CAPTION]);
    const compile = texts.find((t) => t.textContent === "compile");
    const compiled = texts.find((t) => t.textContent === "compiled · illustrative");
    const compare = texts.find((t) => t.textContent === "compare");
    const caption = texts.find((t) => t.textContent === COMPARE_CAPTION);
    // Comparisons never run inside the encoder, so neither word sits in the loop.
    expect(compare?.getAttribute("x")).toBe(compile?.getAttribute("x"));
    expect(caption?.getAttribute("x")).toBe(compile?.getAttribute("x"));
    expect(Number(compare?.getAttribute("y"))).toBeGreaterThan(Number(compiled?.getAttribute("y")));
    expect(Number(caption?.getAttribute("y"))).toBeGreaterThan(Number(compare?.getAttribute("y")));
    expect(label).toMatch(COMPARE_SENTENCE);
    for (const clause of clauses(label).filter((c) => /compar/i.test(c))) {
      expect(clause).toMatch(SCOPED_COMPARE);
    }
  });

  it("says the pinned label", async () => {
    const { label } = await renderStrip({ motion });
    expect(label).toBe(STRIP_LABEL);
  });

  it("names only the encoder's gate as universal", async () => {
    const { label, words } = await renderStrip({ motion });
    expect(label).toContain("The encoder applies a draft only once it compiles and passes its own tests.");
    expect(label).toContain("The AI review's score does not block apply.");
    for (const text of [label, ...words]) {
      for (const clause of clauses(text).filter((c) => UNIVERSAL.test(c))) {
        expect(clause).not.toMatch(/\bcheck|\bpass(es|ed|ing)?\b|\bverif|\breview|\bcompar/i);
      }
    }
  });

  it("keeps the retired gates and corpus claim out of what it draws and says", async () => {
    const { label, words } = await renderStrip({ motion });
    for (const text of [label, ...words]) {
      for (const retired of RETIRED_STRIP_COPY) expect(text).not.toMatch(retired);
    }
    expect(words).toContain("word for word");
    expect(label).toContain("The corpus, word for word");
  });

  // The gate names and their scope are the film's, so the two surfaces must
  // agree. The ticks are not: the film's hero stamps all four gates, and the
  // strip ticks only the two that block `encode --apply`.
  it("agrees with the film on its gate names, its scope and its waiver line", async () => {
    const strip = await renderStrip({ motion });
    const film = await renderFilm({ motion });
    const compare = strip.words.filter((word) => word === "compare");
    expect(new Set([...strip.chipNames, ...compare])).toEqual(new Set(film.chips));
    expect(film.label).toMatch(COMPARE_SENTENCE);
    if (motion) {
      expect(film.captions.join("\n")).toContain(COMPARE_CAPTION);
    }
    expect(film.label).toContain(WAIVER_LINE);
    expect(strip.label).toContain(WAIVER_LINE);
  });
});

describe("/docs page claims", () => {
  // Every word a visitor can read or a screen reader gets, and the copy of
  // every branch /docs ships but this render never takes.
  it("shows no retired claim, in the page or its source", async () => {
    const { default: DocsPage } = await import("@/app/docs/page");
    const { container } = render(<DocsPage />);
    const copy = [
      renderedText(container),
      ...["src/app/docs/page.tsx", "src/components/docs/flat-strip.tsx", "src/components/docs/core-execution-path.tsx"].flatMap(
        (path) => fileCopy(join(process.cwd(), path)),
      ),
    ];
    expect(copy[0]).toContain("programs compared where another calculator covers them");
    for (const text of copy) {
      for (const retired of RETIRED_DOCS_COPY) expect(text).not.toMatch(retired);
    }
    for (const text of fileCopy(join(process.cwd(), "src/components/docs/flat-strip.tsx"))) {
      for (const retired of RETIRED_STRIP_COPY) expect(text).not.toMatch(retired);
    }
  });

  // § 2017 runs through the strip, and CI skipped that module's checks. A
  // screen reader gets the waiver line from the figure; a sighted reader gets
  // it as text under the figure, in full, and keeps it in fullscreen.
  it("shows the whole waiver line under the strip, in fullscreen too", async () => {
    const enlarged: Element[] = [];
    Element.prototype.requestFullscreen = async function (this: Element) {
      enlarged.push(this);
    };
    try {
      const { default: DocsPage } = await import("@/app/docs/page");
      const { container } = render(<DocsPage />);
      const strip = container.querySelector("svg[role='img']");
      const line = [...container.querySelectorAll("details p")].find((p) => p.textContent?.includes("2017(a)"));
      const text = (line?.textContent ?? "").replace(/\s+/g, " ");
      expect(text).toBe(`One provision, encoded — an illustration. ${WAIVER_LINE}`);
      expect(line?.getAttribute("aria-hidden")).toBeNull();
      expect(line?.matches("[hidden], .sr-only, .hidden, .invisible")).toBe(false);
      expect(strip?.compareDocumentPosition(line as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

      fireEvent.click(container.querySelector("button[aria-label='full screen']") as Element);
      expect(enlarged).toHaveLength(1);
      const css = readFileSync(join(process.cwd(), "src/app/architecture-graphics.css"), "utf8");
      expect(enlarged[0].matches(".fpfigure")).toBe(true);
      expect(css).toContain(".fpfigure:fullscreen {");
      expect(enlarged[0].contains(strip)).toBe(true);
      expect(enlarged[0].contains(line as Element)).toBe(true);
    } finally {
      delete (Element.prototype as Partial<Element>).requestFullscreen;
    }
  });
});

describe("journey film layout", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  // #294's verification-claims test reads the source for this phrase.
  it("keeps independence claims out of the source", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/landing/journey-film.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/independent calc(ulator)?s?/i);
  });

  // Captions sit centred in the 1,420-unit band under the artwork, and the
  // phone breakpoint sets .jw-sub to 19px mono. Measured in Chrome
  // (2026-10-03), the mono advance with 0.05em tracking is 0.65em, so
  // every caption must fit 1,420 units with a 16-unit gutter each side.
  it("keeps every caption inside the stage at the phone font size", async () => {
    const { captions } = await renderFilm({ motion: true });
    expect(captions.length).toBe(5);
    for (const caption of captions) {
      expect(caption.length * 19 * 0.65).toBeLessThanOrEqual(1420 - 2 * 16);
    }
  });
});
