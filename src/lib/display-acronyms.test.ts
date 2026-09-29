import { describe, expect, it } from "vitest";
import { DISPLAY_ACRONYMS } from "./display-acronyms";

describe("DISPLAY_ACRONYMS", () => {
  it("holds only lowercase word tokens (humanizers lower-case before lookup)", () => {
    for (const token of DISPLAY_ACRONYMS) {
      expect(token).toMatch(/^[a-z0-9]+$/);
    }
  });

  // The per-humanizer sets this registry replaced. Losing any token would
  // silently regress casing on that humanizer's surface.
  const retired: Record<string, string[]> = {
    "graph-viewer rule names (citations.ts)": [
      "cdcc", "snap", "tanf", "wic", "ssi", "eitc", "ctc", "agi", "magi",
      "cola", "usda", "irs", "fpl", "abawd", "uc", "dcf", "dss", "hhs",
      "dor", "dpa", "apa", "ess", "ssn", "itin", "amt", "fica", "cfr",
      "lcwra", "dc", "ebt", "leap", "sme", "smed", "ssp",
    ],
    "graph-viewer program labels (api.ts)": [
      "snap", "tanf", "wic", "ssi", "eitc", "ctc", "uc",
    ],
    "breadcrumbs (tree-data.ts)": [
      "cfr", "cola", "fns", "irs", "snap", "uk", "ukpga", "uksi", "us",
      "usc", "usda",
    ],
    "RuleSpec document nodes (tree-node-loader.ts)": [
      "fns", "irs", "usda", "snap", "fy", "cola",
    ],
    "search-result labels (search.ts)": [
      "aca", "cdhs", "cfr", "cola", "eitc", "fy", "gst", "hhs", "irs",
      "snap", "ssi", "tanf", "uc", "usc", "usda", "wic",
    ],
  };

  for (const [surface, tokens] of Object.entries(retired)) {
    it(`covers every token the retired ${surface} set had`, () => {
      for (const token of tokens) {
        expect(DISPLAY_ACRONYMS.has(token), token).toBe(true);
      }
    });
  }

  it("excludes tokens that are ordinary words in some displayable use", () => {
    // concept-naming.md §Acronyms: "co" means co-resident in fragments and
    // Colorado in program ids; "eu"/"un" are jurisdiction vocabulary only
    // (axiom-stats humanizeIdentifier keeps its own set for those).
    expect(DISPLAY_ACRONYMS.has("co")).toBe(false);
    expect(DISPLAY_ACRONYMS.has("eu")).toBe(false);
    expect(DISPLAY_ACRONYMS.has("un")).toBe(false);
  });
});
