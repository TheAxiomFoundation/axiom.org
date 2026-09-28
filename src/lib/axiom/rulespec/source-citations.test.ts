import { describe, expect, it } from "vitest";
import { parseRuleSpec } from "./doc";
import {
  REFERENCE_ATOM_KINDS,
  VALUE_ATOM_KINDS,
  extractCitationPathSets,
  moduleSourcePaths,
  rankForKinds,
  ruleCitationRows,
  ruleEncodesProvision,
  ruleValueCitationPaths,
} from "./source-citations";

const BEER = "us/statute/hts/2203.00.00";

function atom(kind: string, path: string): string[] {
  return [
    "          - path: versions[0].values",
    `            kind: ${kind}`,
    "            source:",
    `              corpus_citation_path: ${path}`,
    "              excerpt: text",
  ];
}

function moduleYaml(
  header: string[],
  rules: Array<{ name: string; atoms: string[][] }>,
): string {
  return [
    "format: rulespec/v1",
    ...header,
    "rules:",
    ...rules.flatMap((rule) => [
      `  - name: ${rule.name}`,
      "    kind: parameter",
      "    metadata:",
      "      proof:",
      "        atoms:",
      ...rule.atoms.flat(),
      "    versions:",
      "      - effective_from: '2026-01-01'",
      "        values: {1: 0}",
    ]),
  ].join("\n");
}

describe("moduleSourcePaths", () => {
  it("reads the singular source and the legacy plural list", () => {
    const doc = parseRuleSpec(
      moduleYaml(
        [
          "module:",
          "  source_verification:",
          "    corpus_citation_path: /us/statute/26/1/h",
          "    corpus_citation_paths:",
          "      - us/statute/hts/2201.10.00.00",
          "      - us/statute/hts/2201.10.00.00",
          "      - ''",
        ],
        [],
      ),
    );
    expect(moduleSourcePaths(doc)).toEqual({
      singular: "us/statute/26/1/h",
      plural: ["us/statute/hts/2201.10.00.00"],
    });
  });

  it("returns nothing for a module without declarations", () => {
    expect(moduleSourcePaths(parseRuleSpec("rules: []"))).toEqual({
      singular: null,
      plural: [],
    });
  });
});

describe("extractCitationPathSets", () => {
  it("counts the singular module source as a value citation even without atoms", () => {
    // 135 rulespec-us modules carry a singular source and no proof
    // atoms at all (direct IRS parameter modules among them).
    const doc = parseRuleSpec(
      moduleYaml(
        [
          "module:",
          "  source_verification:",
          "    corpus_citation_path: us/statute/26/1/h/1",
        ],
        [],
      ),
    );
    expect(extractCitationPathSets(doc)).toEqual({
      all: ["us/statute/26/1/h/1"],
      values: ["us/statute/26/1/h/1"],
    });
  });

  it("keeps the plural module list out of the value set", () => {
    const doc = parseRuleSpec(
      moduleYaml(
        [
          "module:",
          "  source_verification:",
          "    corpus_citation_paths:",
          `      - ${BEER}`,
          "      - us/statute/hts/general-note-3/page-1",
        ],
        [{ name: "ch22_general_rate", atoms: [atom("parameter", BEER)] }],
      ),
    );
    expect(extractCitationPathSets(doc)).toEqual({
      all: [BEER, "us/statute/hts/general-note-3/page-1"],
      values: [BEER],
    });
  });

  it("includes every grounding atom kind and excludes reference kinds from values", () => {
    const doc = parseRuleSpec(
      moduleYaml(
        [],
        [
          {
            name: "de_minimis_threshold",
            atoms: [atom("amount", "us/statute/19/1321/a/2/C")],
          },
          {
            name: "regime_guard",
            atoms: [
              atom("condition", BEER),
              atom("exception", "us/statute/hts/7202"),
              atom("import", "us/statute/hts/general-note-3/page-4"),
              atom("ordering", "us/statute/hts/general-note-3/page-5"),
              atom("definition", "us/statute/hts/chapter-99/page-1"),
              atom("predicate", "us/statute/hts/chapter-99/page-2"),
            ],
          },
          {
            name: "dated_rate",
            atoms: [
              atom(
                "effective_period",
                "us/rulemaking/fr/2026-02-25/2026-03824",
              ),
              atom("parameter_table", "us/statute/hts/chapter-99/page-330"),
            ],
          },
        ],
      ),
    );
    const sets = extractCitationPathSets(doc);
    expect(sets.values).toEqual([
      "us/statute/19/1321/a/2/C",
      BEER,
      "us/statute/hts/7202",
      "us/statute/hts/chapter-99/page-1",
      "us/statute/hts/chapter-99/page-2",
      "us/rulemaking/fr/2026-02-25/2026-03824",
      "us/statute/hts/chapter-99/page-330",
    ]);
    expect(sets.all).toHaveLength(9);
    for (const kind of ["import", "ordering"]) {
      expect(REFERENCE_ATOM_KINDS.has(kind)).toBe(true);
    }
  });

  it("ignores atoms without a usable path or kind", () => {
    const doc = parseRuleSpec(
      [
        "format: rulespec/v1",
        "rules:",
        "  - name: odd",
        "    kind: parameter",
        "    metadata:",
        "      proof:",
        "        atoms:",
        "          - path: versions[0].values",
        "            source: {corpus_citation_path: '   '}",
        "          - path: versions[0].values",
        "            kind: parameter",
        "          - not-a-record",
        "    versions:",
        "      - effective_from: '2026-01-01'",
        "        values: {1: 0}",
      ].join("\n"),
    );
    expect(extractCitationPathSets(doc)).toEqual({ all: [], values: [] });
    expect(ruleValueCitationPaths(doc.rules[0])).toEqual(new Set());
  });
});

describe("rankForKinds", () => {
  it("ranks module sources before every atom kind", () => {
    expect(rankForKinds(new Set(["condition"]), true)).toBe(0);
  });

  it("ranks value kinds first, including effective periods", () => {
    for (const kind of VALUE_ATOM_KINDS) {
      expect(rankForKinds(new Set([kind]), false)).toBe(1);
    }
    expect(rankForKinds(new Set(["formula", "amount"]), false)).toBe(1);
  });

  it("ranks formulas second and condition-family or unknown kinds third", () => {
    expect(rankForKinds(new Set(["formula", "condition"]), false)).toBe(2);
    for (const kind of [
      "condition",
      "predicate",
      "exception",
      "definition",
      "default-unknown",
    ]) {
      expect(rankForKinds(new Set([kind]), false)).toBe(3);
    }
    expect(rankForKinds(new Set(), false)).toBe(3);
  });
});

describe("ruleCitationRows", () => {
  it("creates one rank-zero row per rule for a singular source without atoms", () => {
    const doc = parseRuleSpec(
      moduleYaml(
        [
          "module:",
          "  source_verification:",
          `    corpus_citation_path: ${BEER}`,
        ],
        [
          { name: "beer_rate", atoms: [] },
          { name: "beer_unit", atoms: [] },
        ],
      ),
    );

    const rows = ruleCitationRows(
      doc,
      "us/policy/usitc/us-tariff-duty/lines/generated/ch22",
      "policy/usitc/us-tariff-duty/lines/generated/ch22.yaml",
      "rulespec-us",
      "us",
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.rule_name)).toEqual([
      "beer_rate",
      "beer_unit",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        citation_path: BEER,
        module_citation_path:
          "us/policy/usitc/us-tariff-duty/lines/generated/ch22",
        file_path: "policy/usitc/us-tariff-duty/lines/generated/ch22.yaml",
        repo: "rulespec-us",
        jurisdiction: "us",
        is_module_source: true,
        atom_kinds: [],
        rank: 0,
      });
    }
  });

  it("deduplicates paths, ranks mixed kinds, and ignores imports and ordering", () => {
    const japan = "us/statute/hts/9903.05.49";
    const formulaSource = "us/statute/19/1202";
    const conditionSource = "us/statute/hts/general-note-3/page-1";
    const doc = parseRuleSpec(
      moduleYaml(
        [],
        [
          {
            name: "origin_is_japan",
            atoms: [
              atom("condition", japan),
              atom("parameter", japan),
              atom("parameter", japan),
              atom("formula", formulaSource),
              atom("condition", conditionSource),
              atom("import", "us/policy/imported/declaration"),
              atom("ordering", "us/policy/ordered/declaration"),
            ],
          },
        ],
      ),
    );

    const rows = ruleCitationRows(
      doc,
      "us/policy/cbp/us-tariff-duty/composition",
      "policy/cbp/us-tariff-duty/composition.yaml",
      "rulespec-us",
      "us",
    );

    expect(rows.map((row) => row.citation_path)).toEqual([
      japan,
      formulaSource,
      conditionSource,
    ]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.atom_kinds)).toEqual([
      ["condition", "parameter"],
      ["formula"],
      ["condition"],
    ]);
  });

  it("serializes each rule as a list item that round-trips through parseRuleSpec", () => {
    const doc = parseRuleSpec(
      moduleYaml(
        [],
        [
          {
            name: "quoted_formula",
            atoms: [atom("amount", "us/statute/26/32")],
          },
        ],
      ),
    );
    const [row] = ruleCitationRows(
      doc,
      "us/policy/irs/excise-tax",
      "policy/irs/excise-tax.yaml",
      "rulespec-us",
      "us",
    );

    expect(row.rule_yaml).toMatch(/^- name: quoted_formula/m);
    const reparsed = parseRuleSpec(
      `format: rulespec/v1\nmodule: {}\nrules:\n${row.rule_yaml}`,
    );
    expect(reparsed.parseErrors).toEqual([]);
    expect(reparsed.rules).toHaveLength(1);
    expect(reparsed.rules[0].raw).toEqual(doc.rules[0].raw);
  });
});

describe("ruleEncodesProvision", () => {
  it("is true for every rule of a module whose singular source is the provision", () => {
    const doc = parseRuleSpec(
      moduleYaml(
        [
          "module:",
          "  source_verification:",
          `    corpus_citation_path: ${BEER}`,
        ],
        [{ name: "no_atoms", atoms: [] }],
      ),
    );
    expect(ruleEncodesProvision(doc, doc.rules[0], BEER)).toBe(true);
    expect(ruleEncodesProvision(doc, doc.rules[0], "us/statute/hts/7202")).toBe(
      false,
    );
  });

  it("is true only for rules whose non-reference atoms cite the provision otherwise", () => {
    const doc = parseRuleSpec(
      moduleYaml(
        [
          "module:",
          "  source_verification:",
          "    corpus_citation_paths:",
          `      - ${BEER}`,
        ],
        [
          { name: "rate", atoms: [atom("parameter", BEER)] },
          { name: "guard", atoms: [atom("condition", BEER)] },
          { name: "imported", atoms: [atom("import", BEER)] },
        ],
      ),
    );
    expect(ruleEncodesProvision(doc, doc.rules[0], BEER)).toBe(true);
    expect(ruleEncodesProvision(doc, doc.rules[1], BEER)).toBe(true);
    expect(ruleEncodesProvision(doc, doc.rules[2], BEER)).toBe(false);
  });
});
