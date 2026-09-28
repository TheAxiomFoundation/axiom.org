import { describe, expect, it, vi } from "vitest";
import {
  MAX_SOURCE_CITATION_PATHS,
  citationPathSetsForFile,
  extractCitationPathSets,
  extractSourceCitationPaths,
} from "./source-citation-paths.mjs";

describe("extractSourceCitationPaths", () => {
  it("extracts module-level corpus citation paths", () => {
    const content = `
module:
  source_verification:
    corpus_citation_paths:
      - us/statute/hts/2201.10.00.00
      - us/statute/hts/2202.10.00.00
rules: []
`;

    expect(extractSourceCitationPaths(content)).toEqual([
      "us/statute/hts/2201.10.00.00",
      "us/statute/hts/2202.10.00.00",
    ]);
  });

  it("extracts atom-level corpus citation paths", () => {
    const content = `
module: {}
rules:
  - name: first_rule
    versions: []
    metadata:
      proof:
        atoms:
          - source:
              corpus_citation_path: us/statute/hts/2203.00.00
          - source:
              corpus_citation_path: us/statute/hts/2204.10.00
`;

    expect(extractSourceCitationPaths(content)).toEqual([
      "us/statute/hts/2203.00.00",
      "us/statute/hts/2204.10.00",
    ]);
  });

  it("deduplicates the module and atom union while preserving first-seen order", () => {
    const content = `
module:
  source_verification:
    corpus_citation_paths:
      - us/statute/hts/2203.00.00
      - us/statute/hts/2204.10.00
rules:
  - name: first_rule
    versions: []
    metadata:
      proof:
        atoms:
          - source:
              corpus_citation_path: us/statute/hts/2203.00.00
          - source:
              corpus_citation_path: us/statute/hts/2205.10.00
`;

    expect(extractSourceCitationPaths(content)).toEqual([
      "us/statute/hts/2203.00.00",
      "us/statute/hts/2204.10.00",
      "us/statute/hts/2205.10.00",
    ]);
  });

  it("returns an empty list for malformed YAML", () => {
    expect(extractSourceCitationPaths("module: [unterminated")).toEqual([]);
  });

  it("trims paths, strips leading slashes, and drops empty or non-string entries", () => {
    const content = `
module:
  source_verification:
    corpus_citation_paths:
      - "  /us/statute/hts/2203.00.00  "
      - "/   "
      - null
rules:
  - name: first_rule
    versions: []
    metadata:
      proof:
        atoms:
          - source:
              corpus_citation_path: "///us/statute/hts/2204.10.00"
          - source: null
          - malformed atom
  - name: no_atoms
    versions: []
    metadata:
      proof: not-a-mapping
`;

    expect(extractSourceCitationPaths(content)).toEqual([
      "us/statute/hts/2203.00.00",
      "us/statute/hts/2204.10.00",
    ]);
    expect(extractSourceCitationPaths(null)).toEqual([]);
  });

  it("caps oversized files and warns with the file path", () => {
    const declarations = Array.from(
      { length: MAX_SOURCE_CITATION_PATHS + 1 },
      (_, index) => `      - us/statute/hts/${index}`,
    ).join("\n");
    const content = `
module:
  source_verification:
    corpus_citation_paths:
${declarations}
rules: []
`;
    const warn = vi.fn();

    const { all: paths } = citationPathSetsForFile(
      content,
      "policies/usitc/us-tariff-duty/lines/generated/ch22.yaml",
      warn,
    );

    expect(paths).toHaveLength(MAX_SOURCE_CITATION_PATHS);
    expect(paths.at(-1)).toBe("us/statute/hts/4999");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "policies/usitc/us-tariff-duty/lines/generated/ch22.yaml",
      ),
    );
  });

  it("does not warn when the file is within the cap", () => {
    const warn = vi.fn();

    expect(
      citationPathSetsForFile("module: {}\nrules: []", "empty.yaml", warn),
    ).toEqual({ all: [], values: [] });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("extractCitationPathSets", () => {
  it("keys the value set on every non-reference grounding atom", () => {
    const content = `
module:
  source_verification:
    corpus_citation_paths:
      - us/statute/hts/general-note-3/page-1
      - us/statute/hts/2203.00.00
rules:
  - name: ch22_general_rate
    metadata:
      proof:
        atoms:
          - path: versions[0].values
            kind: parameter
            source:
              corpus_citation_path: us/statute/hts/2203.00.00
              excerpt: "Rates of duty (1-General): Free"
  - name: entry_is_line_d
    metadata:
      proof:
        atoms:
          - path: versions[0].formula
            kind: condition
            source:
              corpus_citation_path: us/statute/hts/2203.00.00
              excerpt: Beer made from malt
          - path: versions[0].formula
            kind: condition
            source:
              corpus_citation_path: us/statute/hts/7202
              excerpt: Ferroalloys
`;

    const sets = extractCitationPathSets(content);
    expect(sets.values).toEqual([
      "us/statute/hts/2203.00.00",
      "us/statute/hts/7202",
    ]);
    expect(sets.all).toEqual([
      "us/statute/hts/general-note-3/page-1",
      "us/statute/hts/2203.00.00",
      "us/statute/hts/7202",
    ]);
  });

  it("returns empty sets for malformed YAML and non-strings", () => {
    expect(extractCitationPathSets("module: [unterminated")).toEqual({
      all: [],
      values: [],
    });
    expect(extractCitationPathSets(null)).toEqual({ all: [], values: [] });
  });
});
