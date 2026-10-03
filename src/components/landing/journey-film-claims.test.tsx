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
//   run later in axiom-oracles, where another calculator covers the rule:
//   14,030 of 34,810 rulespec-us rules sit on an oracle surface
//   (dashboard/public/data/rule_verification_summary.json, 2026-09-28).
// - review is one call to an AI model (REVIEWER_CLI_MODEL = "opus"),
//   skipped by --skip-reviewers, and its verdict never blocks apply.
// So only run and checks may be said of every section; compare is scoped
// to the rules another calculator covers, and the hero's four stamped
// gates are labelled an illustration.
// PolicyEngine is not independent of Axiom (Max Ghenis is CEO of both, and
// PSL Foundation fiscally sponsors both), so the film calls the
// calculators "other", never "independent".

const SOURCE = readFileSync(
  join(process.cwd(), "src/components/landing/journey-film.tsx"),
  "utf8",
);

// Captions only render when motion is allowed; the test setup stubs
// reduced motion on, so reload the film with it off.
async function renderAnimatedFilm() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.resetModules();
  const { JourneyFilm } = await import("./journey-film");
  const { container } = render(<JourneyFilm />);
  const captions = [...container.querySelectorAll("text.jw-sub")].map((t) => t.textContent ?? "");
  const label = container.querySelector("svg[role='img']")?.getAttribute("aria-label") ?? "";
  return { captions, label };
}

// One clause per sentence or semicolon-separated part.
function clauses(text: string): string[] {
  return text.split(/[.;]\s+/).filter(Boolean);
}

const UNIVERSAL = /\b(every|each|all)\b/i;
const SCOPED_COMPARE = /\bcompared where another calculator covers (it|the rule)\b/;

describe("journey film gate claims", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("never calls the other calculators independent", () => {
    expect(SOURCE).not.toMatch(/independent/i);
    expect(SOURCE).toContain("✗ disagrees with other calculators — redrafted");
  });

  it("says only run and checks of every section, and scopes compare", async () => {
    const { captions, label } = await renderAnimatedFilm();
    expect(captions).toContain(
      "each section run and checked — compared where another calculator covers it",
    );
    expect(label).toContain(
      "Every section is run and checked against its own tests, and compared where another calculator covers the rule.",
    );
    for (const text of [...captions, label]) {
      expect(text).not.toMatch(/four ways|walked through the four gates/i);
      for (const clause of clauses(text)) {
        if (!UNIVERSAL.test(clause)) continue;
        // A universal clause may name a comparison only with its scope,
        // and may never name the review.
        if (/compar/i.test(clause)) expect(clause).toMatch(SCOPED_COMPARE);
        expect(clause).not.toMatch(/review/i);
      }
    }
  });

  it("labels the hero's four gates an illustration with an AI review", async () => {
    const { label } = await renderAnimatedFilm();
    const gates = clauses(label).filter((c) => /four gates/.test(c));
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatch(/^In this illustration the workbench stamps four gates/);
    expect(gates[0]).toContain("review by an AI model");
    expect(label).toContain("disagrees with the other calculators at compare");
    expect(label).not.toMatch(/\bhuman\b|independent/i);
  });

  // Captions sit centred in the 1,420-unit band under the artwork, and the
  // phone breakpoint sets .jw-sub to 19px mono. Measured in Chrome
  // (2026-10-03), the mono advance with 0.05em tracking is 0.65em, so
  // every caption must fit 1,420 units with a 16-unit gutter each side.
  it("keeps every caption inside the stage at the phone font size", async () => {
    const { captions } = await renderAnimatedFilm();
    expect(captions.length).toBe(5);
    for (const caption of captions) {
      expect(caption.length * 19 * 0.65).toBeLessThanOrEqual(1420 - 2 * 16);
    }
  });
});
