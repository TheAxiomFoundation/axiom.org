import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
// So the only universal gate the film names is the encoder's, and only of
// drafts; compare is scoped to programs another calculator covers; the
// review chip says AI; and the hero's four stamped gates are marked an
// illustration on the workbench and in the label, which also says the
// published § 2017(a) module is waived.
// PolicyEngine is not independent of Axiom (Max Ghenis is CEO of both, and
// PSL Foundation fiscally sponsors both), so the film never calls it
// independent.

// The test setup stubs prefers-reduced-motion on, which renders the
// composed still; the animated film needs it off. STATIC is read at module
// load, so each render reloads the module.
async function renderFilm({ motion }: { motion: boolean }) {
  if (motion) {
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
  vi.resetModules();
  const { JourneyFilm } = await import("./journey-film");
  const { container } = render(<JourneyFilm />);
  const svg = container.querySelector("svg[role='img']");
  const words = [...container.querySelectorAll("text")].map((t) => t.textContent ?? "");
  return {
    captions: [...container.querySelectorAll("text.jw-sub")].map((t) => t.textContent ?? ""),
    chips: [...container.querySelectorAll("tspan.jw-gatetick-name")].map((t) => t.textContent ?? ""),
    label: svg?.getAttribute("aria-label") ?? "",
    ticks: [...container.querySelectorAll("text.jw-gatetick")].filter(
      (t) => (t.textContent ?? "").trim() === "✓✓",
    ),
    words,
  };
}

// One clause per sentence or semicolon-separated part.
function clauses(text: string): string[] {
  return text.split(/[.;]\s+/).filter(Boolean);
}

const UNIVERSAL = /\b(every|each|all|any|always)\b/i;
const SCOPED_COMPARE =
  /\bcompared (where another calculator covers it|through their outputs later, where another calculator covers them)\b/;

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
    expect(label).toContain("disagrees with another calculator at compare");
  });

  it("names only the encoder's gate as universal, and scopes compare", async () => {
    const { captions, label, words } = await renderFilm({ motion });
    if (motion) {
      expect(captions).toContain(
        "a draft must compile and pass its tests — compared where another calculator covers it",
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
        expect(clause).not.toMatch(/\bcheck|\bpass(es|ed)?\b|\bverif|\breview/i);
      }
    }
  });

  it("names the AI review on its chip and marks the four gates an illustration", async () => {
    const { chips, label, words } = await renderFilm({ motion });
    expect(new Set(chips)).toEqual(new Set(["run", "checks", "compare", "AI review"]));
    // On screen, in both modes: the workbench eyebrow.
    expect(words.map((w) => w.trim())).toContain("illustration");
    const gates = clauses(label).filter((c) => /four gates/.test(c));
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatch(/^The workbench, marked illustration, stamps four gates/);
    expect(gates[0]).toContain("and AI review");
    expect(label).toContain(
      "On October 2, 2026 the published § 2017(a) module was one of 1,940 rulespec-us modules on the validation waiver list, whose checks CI skips.",
    );
    expect(label).toContain("The other two sections are stamped run and checks.");
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
