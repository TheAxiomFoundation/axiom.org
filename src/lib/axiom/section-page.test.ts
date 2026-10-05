import { describe, expect, it } from "vitest";
import type { Rule } from "@/lib/supabase";
import type { RuleReference } from "@/lib/supabase";
import {
  buildSectionToc,
  compareCitationPaths,
  dedupeRootBody,
  railChunksFromProvisions,
  mapRulesToSubsections,
  refsForChunk,
  relativeDesignator,
  splitBodyIntoSubsections,
  subtreeAnchor,
  type SectionProvision,
  mapRulesToDeepPath,
  joinedSegmentPaths,
  splitNycrrSectionPath,
  docTypeCrosswalk,
  encodingPathCandidates,
  splitRootBodyAroundChildren,
} from "./section-page";

const ROOT = "us/statute/26/32";

describe("joinedSegmentPaths", () => {
  it("emits dotted and dashed joins for a two-part section number", () => {
    expect(joinedSegmentPaths("us-ia", ["statute", "422", "12C"])).toEqual([
      "us-ia/statute/422.12C",
      "us-ia/statute/422-12C",
    ]);
  });

  it("emits only the dashed join for deeper numbers", () => {
    expect(joinedSegmentPaths("us-mt", ["statute", "15", "1", "1"])).toEqual([
      "us-mt/statute/15-1-1",
    ]);
  });

  it("emits nothing when the number is a single segment already", () => {
    expect(joinedSegmentPaths("us-or", ["statute", "315.264"])).toEqual([]);
    expect(joinedSegmentPaths("us", ["statute"])).toEqual([]);
  });
});

function provision(
  subPath: string,
  heading: string | null = null
): SectionProvision {
  const citationPath = `${ROOT}/${subPath}`;
  return {
    rule: { heading, citation_path: citationPath } as Rule,
    anchor: subtreeAnchor(ROOT, citationPath),
    designator: relativeDesignator(ROOT, citationPath),
    relativeDepth: subPath.split("/").length,
  };
}

describe("railChunksFromProvisions", () => {
  it("aggregates each top-level provision with its subtree text", () => {
    const provisions = [
      { ...provision("d", "Limitation"), rule: { heading: "Limitation", citation_path: `${ROOT}/d`, body: "(d) chapeau" } as Rule },
      { ...provision("d/2"), rule: { heading: null, citation_path: `${ROOT}/d/2`, body: "(2) nested text" } as Rule },
      { ...provision("e", "Definitions"), rule: { heading: "Definitions", citation_path: `${ROOT}/e`, body: "(e) body" } as Rule },
    ];
    const chunks = railChunksFromProvisions(provisions);
    expect(chunks.map((chunk: { anchor: string }) => chunk.anchor)).toEqual([
      "d",
      "e",
    ]);
    expect(chunks[0].label).toBe("(d) Limitation");
    expect(chunks[0].text).toContain("(2) nested text");
    expect(chunks[1].text).toBe("(e) body");
  });
});

describe("compareCitationPaths", () => {
  it("orders numeric segments numerically, not lexicographically", () => {
    expect(compareCitationPaths(`${ROOT}/a/2`, `${ROOT}/a/10`)).toBeLessThan(0);
    expect(compareCitationPaths(`${ROOT}/a/10`, `${ROOT}/a/2`)).toBeGreaterThan(
      0
    );
  });

  it("sorts parents before their descendants", () => {
    expect(compareCitationPaths(`${ROOT}/a`, `${ROOT}/a/1`)).toBeLessThan(0);
  });

  it("orders letter designators alphabetically", () => {
    const paths = [`${ROOT}/c`, `${ROOT}/a`, `${ROOT}/b`];
    expect(paths.sort(compareCitationPaths)).toEqual([
      `${ROOT}/a`,
      `${ROOT}/b`,
      `${ROOT}/c`,
    ]);
  });

  it("sorts USC-style lettered titles after their base number", () => {
    expect(
      compareCitationPaths("us/statute/25", "us/statute/25A")
    ).toBeLessThan(0);
  });
});

describe("subtreeAnchor", () => {
  it("joins the relative path with dashes", () => {
    expect(subtreeAnchor(ROOT, `${ROOT}/a/1/B`)).toBe("a-1-B");
  });

  it("returns empty string for paths outside the root", () => {
    expect(subtreeAnchor(ROOT, "us/statute/26/33/a")).toBe("");
    expect(subtreeAnchor(ROOT, ROOT)).toBe("");
  });
});

describe("relativeDesignator", () => {
  it("wraps each relative segment in parens", () => {
    expect(relativeDesignator(ROOT, `${ROOT}/a/1/B`)).toBe("(a)(1)(B)");
  });
});

describe("buildSectionToc", () => {
  it("nests entries under their parent anchors", () => {
    const toc = buildSectionToc([
      provision("a", "In general"),
      provision("a/1"),
      provision("a/2"),
      provision("b", "Percentages"),
    ]);
    expect(toc).toHaveLength(2);
    expect(toc[0].label).toBe("(a) In general");
    expect(toc[0].children.map((child) => child.anchor)).toEqual([
      "a-1",
      "a-2",
    ]);
    expect(toc[1].label).toBe("(b) Percentages");
  });

  it("cuts off below maxDepth", () => {
    const toc = buildSectionToc([
      provision("a"),
      provision("a/1"),
      provision("a/1/B"),
    ]);
    expect(toc[0].children).toHaveLength(1);
    expect(toc[0].children[0].children).toHaveLength(0);
  });

  it("promotes orphans whose parent is not in the TOC", () => {
    const toc = buildSectionToc([provision("a/1")]);
    expect(toc).toHaveLength(1);
    expect(toc[0].anchor).toBe("a-1");
  });

  it("labels heading-less entries with the designator alone", () => {
    const toc = buildSectionToc([provision("c")]);
    expect(toc[0].label).toBe("(c)");
  });
});

// Mirrors the corpus shape: each subsection is one flattened line
// with nested (1)/(A)/(i) markers inline, blank lines between
// subsections.
const SECTION_BODY = [
  "(a) Allowance of credit (1) In general In the case of an eligible individual, there shall be allowed a credit. (2) Limitation The amount shall not exceed the phaseout.",
  "",
  "(b) Percentages The credit percentage is determined under this table.",
  "",
  "(c) Definitions and special rules For purposes of this section— (1) Eligible individual (A) In general The term means any individual. (i) a reserved clause, and",
  "",
  "(d) Coordination with other credits",
].join("\n");

describe("splitBodyIntoSubsections", () => {
  it("chunks at top-level lowercase markers only", () => {
    const { intro, chunks } = splitBodyIntoSubsections(SECTION_BODY);
    expect(intro).toBeNull();
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps inline nested (1)/(A)/(i) markers inside their parent chunk", () => {
    const { chunks } = splitBodyIntoSubsections(SECTION_BODY);
    const c = chunks.find((chunk) => chunk.anchor === "c");
    expect(c?.text).toContain("(A) In general");
    expect(c?.text).toContain("(i) a reserved clause");
  });

  it("rejects markers that do not increase alphabetically", () => {
    const body = [
      "(a) First subsection text here.",
      "(c) Third subsection text here.",
      "(b) an out-of-order nested fragment at line start,",
      "(d) Fourth subsection text here.",
    ].join("\n");
    const { chunks } = splitBodyIntoSubsections(body);
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(["a", "c", "d"]);
  });

  it("tolerates repealed-subsection gaps (§ 32 skips g and h)", () => {
    const body = ["a", "b", "c", "d", "e", "f", "i", "j"]
      .map((letter) => `(${letter}) Subsection ${letter} text.`)
      .join("\n");
    const { chunks } = splitBodyIntoSubsections(body);
    expect(chunks.map((chunk) => chunk.anchor)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "i",
      "j",
    ]);
  });

  it("cuts the label at the first nested marker on flattened lines", () => {
    const body = [
      "(a) Allowance of credit (1) In general In the case of an eligible individual…",
      "(b) Percentages (1) Percentages The credit percentage is…",
    ].join("\n");
    const { chunks } = splitBodyIntoSubsections(body);
    expect(chunks[0].label).toBe("(a) Allowance of credit");
    expect(chunks[1].label).toBe("(b) Percentages");
  });

  it("captures chapeau text before (a) as intro", () => {
    const body = `General rule for this section.\n(a) First one text.\n(b) Second one text.`;
    const { intro, chunks } = splitBodyIntoSubsections(body);
    expect(intro).toBe("General rule for this section.");
    expect(chunks).toHaveLength(2);
  });

  it("returns no chunks when only one marker matches", () => {
    const body = "(a) Lone subsection body text.";
    expect(splitBodyIntoSubsections(body).chunks).toHaveLength(0);
  });

  it("builds a truncated preview label", () => {
    const { chunks } = splitBodyIntoSubsections(SECTION_BODY);
    expect(chunks[0].label).toBe("(a) Allowance of credit");
    expect(chunks[1].label).toMatch(/^\(b\) Percentages The credit/);
  });

  it("continues past z with doubled letters", () => {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const body = [...letters, "aa"]
      .map((letter) => `(${letter}) Subsection ${letter} text.`)
      .join("\n");
    const { chunks } = splitBodyIntoSubsections(body);
    expect(chunks.at(-1)?.anchor).toBe("aa");
  });
});

describe("mapRulesToSubsections", () => {
  const yaml = [
    "format: rulespec/v1",
    "module:",
    "  name: eitc",
    "rules:",
    "  - name: eitc_phase_in_rates",
    "    kind: parameter",
    "    source: 26 USC 32(b)(1)",
    "    versions:",
    "      - effective_from: '2026-01-01'",
    "        values: {0: 0.0765}",
    "  - name: eitc_eligible",
    "    kind: formula",
    "    source: 26 USC 32(c)(1)(A)",
    "    versions:",
    "      - effective_from: '2026-01-01'",
    "        formula: 'age >= 19'",
    "  - name: dependent_rule",
    "    kind: formula",
    "    source: 26 USC 152(c)",
    "    versions:",
    "      - effective_from: '2026-01-01'",
    "        formula: 'x'",
  ].join("\n");

  it("maps rules to their top-level subsection anchors", () => {
    const links = mapRulesToSubsections("us/statute/26/32", yaml);
    expect(
      links.find((l) => l.name === "eitc_phase_in_rates")?.anchors
    ).toEqual(["b"]);
    expect(links.find((l) => l.name === "eitc_eligible")?.anchors).toEqual([
      "c",
    ]);
  });

  it("collects every subsection a multi-source rule cites", () => {
    const multi = [
      "format: rulespec/v1",
      "module:",
      "  name: eitc",
      "rules:",
      "  - name: eitc_allowed",
      "    kind: derived",
      "    source: 26 USC 32(a), 32(c)(1)(E), 32(i), 32(k)",
      "    versions:",
      "      - effective_from: '2026-01-01'",
      "        formula: 'x'",
    ].join("\n");
    const links = mapRulesToSubsections("us/statute/26/32", multi);
    expect(links[0].anchors).toEqual(["a", "c", "i", "k"]);
  });

  it("leaves rules citing other sections unanchored", () => {
    const links = mapRulesToSubsections("us/statute/26/32", yaml);
    expect(links.find((l) => l.name === "dependent_rule")?.anchors).toEqual(
      []
    );
  });

  it("returns empty for null or unparseable content", () => {
    expect(mapRulesToSubsections("us/statute/26/32", null)).toEqual([]);
    expect(mapRulesToSubsections("us/statute/26/32", "not: yaml: [")).toEqual(
      []
    );
  });
});

describe("refsForChunk", () => {
  const ref = (citation_text: string, direction = "outgoing"): RuleReference =>
    ({
      direction,
      citation_text,
      pattern_kind: "test",
      confidence: 1,
      start_offset: 0,
      end_offset: citation_text.length,
      other_citation_path: "us/statute/26/1",
      other_provision_id: null,
      other_heading: null,
      target_resolved: true,
    }) as RuleReference;

  it("keeps outgoing refs whose text appears in the chunk", () => {
    const refs = [ref("section 1"), ref("section 2")];
    expect(refsForChunk(refs, "see section 1 for rates")).toEqual([
      refs[0],
    ]);
  });

  it("drops incoming refs", () => {
    expect(
      refsForChunk([ref("section 1", "incoming")], "see section 1")
    ).toEqual([]);
  });
});

describe("dedupeRootBody", () => {
  const base = {
    id: "id",
    jurisdiction: "us",
    doc_type: "statute",
    parent_id: null,
    level: 4,
    ordinal: null,
    heading: null,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: null,
    citation_path: "us/statute/26/32/a",
    rulespec_path: null,
    has_rulespec: false,
    created_at: "",
    updated_at: "",
  } as const;
  const child = (body: string): Rule => ({
    ...base,
    body,
    citation_path: "us/statute/26/32/a/1",
  });

  it("trims a root body that repeats its descendants, keeping the chapeau", () => {
    const childText =
      "In the case of an eligible individual, there shall be allowed a credit for the taxable year.";
    const root: Rule = {
      ...base,
      body: `(1) In general ${childText}`,
    };
    const deduped = dedupeRootBody(root, [child(childText)]);
    expect(deduped.body).toBe("(1) In general");
  });

  it("drops the body entirely when nothing precedes the repeated text", () => {
    const childText =
      "In the case of an eligible individual, there shall be allowed a credit for the taxable year.";
    const root: Rule = { ...base, body: childText };
    expect(dedupeRootBody(root, [child(childText)]).body).toBeNull();
  });

  it("keeps the body when descendants carry different text", () => {
    const root: Rule = {
      ...base,
      body: "Chapeau text that stands alone and is not repeated below.",
    };
    const deduped = dedupeRootBody(root, [
      child("Completely different descendant text that is long enough."),
    ]);
    expect(deduped.body).toBe(root.body);
  });

  it("keeps the body when there are no descendants", () => {
    const root: Rule = { ...base, body: "(a) Text." };
    expect(dedupeRootBody(root, []).body).toBe("(a) Text.");
  });
});


describe("mapRulesToDeepPath", () => {
  const yaml = [
    "format: rulespec/v1",
    "rules:",
    "  - name: snap_calculated_monthly_allotment_before_minimums",
    "    kind: derived",
    "    source: 7 CFR 273.10(e)(2)(ii)(A)",
    "    versions:",
    "      - effective_from: '2025-10-01'",
    "        formula: 'x'",
    "  - name: snap_net_income_before_shelter",
    "    kind: derived",
    "    source: 7 CFR 273.10(e)(1)",
    "    versions:",
    "      - effective_from: '2025-10-01'",
    "        formula: 'y'",
    "  - name: snap_total_gross_income",
    "    kind: derived",
    "    source: 7 CFR 273.10(c)",
    "    versions:",
    "      - effective_from: '2025-10-01'",
    "        formula: 'z'",
  ].join("\n");

  it("keeps only rules citing the deep paragraph or below", () => {
    const links = mapRulesToDeepPath(
      "us/regulation/7/273/10",
      ["e", "2", "ii", "A"],
      yaml
    );
    expect(links).toEqual([
      {
        name: "snap_calculated_monthly_allotment_before_minimums",
        kind: "derived",
        anchors: [],
      },
    ]);
  });

  it("anchors deeper citations to the page's next-level unit", () => {
    const links = mapRulesToDeepPath("us/regulation/7/273/10", ["e"], yaml);
    expect(links.map((link) => link.name).sort()).toEqual([
      "snap_calculated_monthly_allotment_before_minimums",
      "snap_net_income_before_shelter",
    ]);
    const allotment = links.find((link) =>
      link.name.startsWith("snap_calculated")
    );
    expect(allotment?.anchors).toEqual(["2"]);
  });

  it("returns nothing without content or relative depth", () => {
    expect(mapRulesToDeepPath("us/regulation/7/273/10", ["e"], null)).toEqual([]);
    expect(mapRulesToDeepPath("us/regulation/7/273/10", [], yaml)).toEqual([]);
  });
});

describe("docTypeCrosswalk", () => {
  it("maps policy-adjacent classes to their siblings and nothing else", () => {
    expect(docTypeCrosswalk("policy")).toEqual(["manual", "guidance"]);
    expect(docTypeCrosswalk("manual")).toEqual(["policy", "guidance"]);
    expect(docTypeCrosswalk("guidance")).toEqual(["policy", "manual"]);
    expect(docTypeCrosswalk("statute")).toEqual([]);
    expect(docTypeCrosswalk(undefined)).toEqual([]);
  });
});

describe("encodingPathCandidates", () => {
  it("tries resolved, requested, and crosswalk sibling paths in order", () => {
    expect(
      encodingPathCandidates({
        citationPath: "us-ca/guidance/dor/spotlight/block-7",
        requestedPath: "us-ca/policy/dor/spotlight/block-7",
      })
    ).toEqual([
      "us-ca/guidance/dor/spotlight/block-7",
      "us-ca/policy/dor/spotlight/block-7",
      "us-ca/manual/dor/spotlight/block-7",
    ]);
  });

  it("stays a single candidate for statute paths with no rewrite", () => {
    expect(
      encodingPathCandidates({
        citationPath: "us/statute/26/32",
        requestedPath: "us/statute/26/32",
      })
    ).toEqual(["us/statute/26/32"]);
  });
});

describe("splitRootBodyAroundChildren", () => {
  const asRule = (citationPath: string, body: string | null) =>
    ({ citation_path: citationPath, body }) as Parameters<
      typeof splitRootBodyAroundChildren
    >[0];

  it("keeps the chapeau and surfaces the flush sentence after the last child", () => {
    const parent = asRule(
      "us/statute/26/21/c",
      "The amount taken into account shall not exceed—\n\n" +
        "(1) $3,000 if there is 1 qualifying individual for the year, or\n\n" +
        "(2) $6,000 if there are 2 or more qualifying individuals there.\n\n" +
        "The amount determined under paragraph (1) or (2) shall be reduced under section 129."
    );
    const children = [
      asRule(
        "us/statute/26/21/c/1",
        "$3,000 if there is 1 qualifying individual for the year, or"
      ),
      asRule(
        "us/statute/26/21/c/2",
        "$6,000 if there are 2 or more qualifying individuals there."
      ),
    ];
    const { root, flush } = splitRootBodyAroundChildren(parent, children);
    expect(root.body).toBe("The amount taken into account shall not exceed—");
    expect(flush).toBe(
      "The amount determined under paragraph (1) or (2) shall be reduced under section 129."
    );
  });

  it("returns no flush when nothing follows the last child", () => {
    const parent = asRule(
      "x/statute/1/2",
      "Chapeau—\n\n(a) First subsection text that is long enough here."
    );
    const children = [
      asRule("x/statute/1/2/a", "First subsection text that is long enough here."),
    ];
    const { flush } = splitRootBodyAroundChildren(parent, children);
    expect(flush).toBeNull();
  });
});


describe("splitNycrrSectionPath", () => {
  it("resolves dotted New York section citations while preserving subsections", () => {
    expect(splitNycrrSectionPath(["us-ny", "regulation", "18-nycrr", "387.9"])).toEqual(["us-ny", "regulation", "18-nycrr", "387", "9"]);
    expect(splitNycrrSectionPath(["us-ny", "regulation", "18-nycrr", "387.10", "a"])).toEqual(["us-ny", "regulation", "18-nycrr", "387", "10", "a"]);
  });
  it("leaves canonical paths and other numbering systems alone", () => {
    expect(splitNycrrSectionPath(["us-ny", "regulation", "18-nycrr", "387", "9"])).toBeNull();
    expect(splitNycrrSectionPath(["us-or", "statute", "315.264"])).toBeNull();
    expect(splitNycrrSectionPath(["us-co", "regulation", "10-ccr", "4.410"])).toBeNull();
  });
});
