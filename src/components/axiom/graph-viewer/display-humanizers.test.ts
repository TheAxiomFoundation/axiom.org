import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";
import { humanizeProgram } from "./api";
import { humanizeRuleName } from "./citations";

// The two RuleSpec display humanizers in this repo: rule names (doors,
// tooltips, policy-document fallbacks) and program labels. Both read the
// one DISPLAY_ACRONYMS registry, so a slug both can receive must read the
// same in both.
const WORDS = [
  ...DISPLAY_ACRONYMS,
  "eligible",
  "income",
  "non",
  "citizen",
  "debt",
  "quota",
  "inactive",
  "co",
  "eu",
  "un",
  "2017",
  "a",
];
const slug = fc
  .tuple(
    fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 6 }),
    fc.constantFrom("_", "-"),
  )
  .map(([words, sep]) => words.join(sep));

describe("RuleSpec display humanizers", () => {
  it("agree on every lower-case slug (differential)", () => {
    fc.assert(
      fc.property(slug, (value) => {
        expect(humanizeProgram(value)).toBe(humanizeRuleName(value));
      }),
      { seed: 232, numRuns: 500 },
    );
  });

  it("upper-case exactly the registered tokens, word by word", () => {
    fc.assert(
      fc.property(slug, (value) => {
        const words = value.split(/[-_]/);
        const shown = humanizeRuleName(value).split(" ");
        expect(shown).toHaveLength(words.length);
        words.forEach((word, i) => {
          expect(shown[i]).toBe(
            DISPLAY_ACRONYMS.has(word)
              ? word.toUpperCase()
              : word.charAt(0).toUpperCase() + word.slice(1),
          );
        });
      }),
      { seed: 232, numRuns: 500 },
    );
  });

  it("render the SNAP immigration acronyms the same way", () => {
    for (const token of ["lpr", "obbb", "cofa", "prwora", "ina", "qc", "cfr", "us"]) {
      expect(humanizeRuleName(`${token}_status`)).toBe(`${token.toUpperCase()} Status`);
      expect(humanizeProgram(`${token}-status`)).toBe(`${token.toUpperCase()} Status`);
    }
  });
});
