// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  citationPathLabel,
  citationPathsOverlap,
  matchConflictsToModules,
  matchConflictsToPaths,
  normalizeSourceConflictEntry,
  parseConflictPathsParam,
  parseSourceConflictRegister,
  sourceConflictFromRow,
} from "./source-conflicts-normalize";

const AT = "2026-11-06T12:00:00.000Z";

const REGISTER = `
version: 1
entries:
- id: oasdi-ret-own-work-age-exemptions
  jurisdiction: us
  program: social-security
  question: Is a widow's own excess earnings exempt by age alone?
  texts:
  - corpus_citation_path: us/statute/42/403/f/1
    excerpt: but subject to section 402(s)
  - corpus_citation_path: us/statute/42/403/f/1
    excerpt: in which such individual has attained the age of 18
  pending_texts:
  - citation: 20 CFR 404.415
    kind: regulation
    url: https://www.ecfr.gov/x
    excerpt: some text
    snapshot: {repo: a/b, commit: abc}
  reading: Exempt automatically only the CFR's disability-based categories.
  alternatives:
  - id: act-age-alone
    reading: Exempt by age alone.
    effect: $600 more a year.
  basis: The Act controls.
  status: ruled
  ruling:
    by: Axiom Foundation
    date: 2026-10-12
    record: https://github.com/TheAxiomFoundation/rulespec-us/pull/1710
  adopted_by:
  - module: us/statutes/42/403/f.yaml
    interpretation: own-work-age
  years: {from: 2022, to: 2025, type: tax}
- id: msa-guardian-fee-cap
  jurisdiction: us-mn
  question: Which cap applies?
  texts: []
  reading: Apply the statutory limit.
  status: open
`;

describe("parseSourceConflictRegister", () => {
  const rows = parseSourceConflictRegister(REGISTER, "rulespec-us", AT);

  it("keys each entry by its global id and keeps the raw entry", () => {
    expect(rows.map((r) => r.global_id)).toEqual(["us:oasdi-ret-own-work-age-exemptions", "us-mn:msa-guardian-fee-cap"]);
    expect(rows[0].entry_id).toBe("oasdi-ret-own-work-age-exemptions");
    expect(rows[0].entry?.years).toEqual({ from: 2022, to: 2025, type: "tax" });
    expect(rows[0].source_url).toBe(
      "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/known-source-conflicts.yaml"
    );
    expect(rows[0].collected_at).toBe(AT);
  });

  it("normalizes citations, pending citations, alternatives, ruling and adoptions", () => {
    const [row] = rows;
    expect(row.citation_paths).toEqual(["us/statute/42/403/f/1"]);
    expect(row.pending_citations).toEqual([
      { citation: "20 CFR 404.415", kind: "regulation", url: "https://www.ecfr.gov/x" },
    ]);
    expect(row.alternatives).toEqual([{ id: "act-age-alone", reading: "Exempt by age alone.", effect: "$600 more a year." }]);
    // An unquoted date stays text.
    expect(row.ruling).toEqual({
      by: "Axiom Foundation",
      date: "2026-10-12",
      record: "https://github.com/TheAxiomFoundation/rulespec-us/pull/1710",
    });
    expect(row.adopted_by).toEqual([{ module: "us/statutes/42/403/f.yaml", interpretation: "own-work-age" }]);
  });

  it("fills empty optional fields", () => {
    const row = rows[1];
    expect(row).toMatchObject({
      program: null,
      basis: null,
      ruling: null,
      alternatives: [],
      citation_paths: [],
      pending_citations: [],
      adopted_by: [],
    });
  });

  it("returns nothing for an empty register", () => {
    expect(parseSourceConflictRegister("", "rulespec-ca", AT)).toEqual([]);
    expect(parseSourceConflictRegister("version: 1\nentries: []\n", "rulespec-ca", AT)).toEqual([]);
  });

  it("fails loudly on a malformed register", () => {
    expect(() => parseSourceConflictRegister("- a\n- b\n", "rulespec-us", AT)).toThrow(/not a mapping/);
    expect(() => parseSourceConflictRegister("entries: {a: 1}\n", "rulespec-us", AT)).toThrow(/entries is not a list/);
    expect(() => parseSourceConflictRegister("entries: [\n", "rulespec-us", AT)).toThrow(/rulespec-us/);
    expect(() =>
      parseSourceConflictRegister("entries:\n- id: x\n  jurisdiction: us\n  status: open\n  reading: r\n", "rulespec-us", AT)
    ).toThrow(/\(x\): missing question/);
    const twice = "entries:\n" + "- {id: x, jurisdiction: us, status: open, question: q, reading: r}\n".repeat(2);
    expect(() => parseSourceConflictRegister(twice, "rulespec-us", AT)).toThrow(/us:x appears twice/);
  });

  it("rejects a list field that is not a list and an alternative without a reading", () => {
    const base = { id: "x", jurisdiction: "us", status: "open", question: "q", reading: "r" };
    expect(() => normalizeSourceConflictEntry({ ...base, texts: "us/statute/1" }, "rulespec-us", AT)).toThrow(
      /texts is not a list/
    );
    expect(() => normalizeSourceConflictEntry({ ...base, alternatives: [{ id: "a" }] }, "rulespec-us", AT)).toThrow(
      /alternative 0 has no reading/
    );
  });

  it("reads an adoption written as a two-item list", () => {
    const base = { id: "x", jurisdiction: "us", status: "open", question: "q", reading: "r" };
    const row = normalizeSourceConflictEntry({ ...base, adopted_by: [["us/statutes/26/32", "eitc-loss"]] }, "rulespec-us", AT);
    expect(row.adopted_by).toEqual([{ module: "us/statutes/26/32", interpretation: "eitc-loss" }]);
  });
});

describe("the quoted texts", () => {
  it("names each text, keeps its quoted words, and lists the other implementations", () => {
    const [row] = parseSourceConflictRegister(REGISTER, "rulespec-us", AT);
    const conflict = sourceConflictFromRow({ ...row!, entry: { ...row!.entry, implementations: [{ repo: "PolicyEngine/policyengine-us", follows: "act-age-alone" }] } });
    expect(conflict.texts).toEqual([
      { citation: "42 USC 403(f)(1)", kind: "statute", path: "us/statute/42/403/f/1", url: null, excerpt: "but subject to section 402(s)" },
      { citation: "42 USC 403(f)(1)", kind: "statute", path: "us/statute/42/403/f/1", url: null, excerpt: "in which such individual has attained the age of 18" },
      { citation: "20 CFR 404.415", kind: "regulation", path: null, url: "https://www.ecfr.gov/x", excerpt: "some text" },
    ]);
    expect(conflict.implementations).toEqual([{ by: "PolicyEngine", follows: "act-age-alone" }]);
    expect(conflict.moneyCase).toBeNull();
    const money = { description: "A widow at 64.", amount: "20.40", currency: "USD", period: "month", computed_by: "test_widow" };
    expect(sourceConflictFromRow({ ...row!, entry: { ...row!.entry, money_case: money } }).moneyCase).toEqual({ description: "A widow at 64.", amount: "20.40", currency: "USD", period: "month", computedBy: "test_widow" });
    // An incomplete money case shows nothing rather than half a figure.
    expect(sourceConflictFromRow({ ...row!, entry: { ...row!.entry, money_case: { ...money, amount: undefined } } }).moneyCase).toBeNull();
    expect(citationPathLabel("us/regulation/7/273/9/d/1")).toBe("7 CFR 273.9(d)(1)");
    expect(citationPathLabel("us-co/regulation/9-ccr-2503-5/3.520.785")).toBe("us-co/regulation/9-ccr-2503-5/3.520.785");
    // A row without its entry (an old cache) still reads, with no texts.
    expect(sourceConflictFromRow({ ...row!, entry: undefined }).texts).toEqual([]);
  });
});

describe("matching", () => {
  const conflicts = parseSourceConflictRegister(REGISTER, "rulespec-us", AT).map(sourceConflictFromRow);

  it("matches a path, a path above it and a path under it on / boundaries", () => {
    expect(citationPathsOverlap("us/statute/42/403/f", "us/statute/42/403/f/1")).toBe(true);
    expect(citationPathsOverlap("us/statute/42/403/f/1/A", "us/statute/42/403/f/1")).toBe(true);
    expect(citationPathsOverlap("us/statute/42/403/f/1", "us/statute/42/403/f/1")).toBe(true);
    expect(citationPathsOverlap("us/statute/42/403/f/10", "us/statute/42/403/f/1")).toBe(false);
    expect(citationPathsOverlap("us/statute/42/403/g", "us/statute/42/403/f/1")).toBe(false);
    expect(citationPathsOverlap("", "us/statute/42")).toBe(false);
  });

  it("returns the conflicts per requested path and leaves out paths with none", () => {
    const result = matchConflictsToPaths(conflicts, [
      "us/statute/42/403/f",
      "us/statute/42/403/f/1/A",
      "us/statute/42/403/f/10",
    ]);
    expect(Object.keys(result)).toEqual(["us/statute/42/403/f", "us/statute/42/403/f/1/A"]);
    expect(result["us/statute/42/403/f"].map((c) => c.globalId)).toEqual(["us:oasdi-ret-own-work-age-exemptions"]);
    expect(result["us/statute/42/403/f"][0]).toMatchObject({ id: "oasdi-ret-own-work-age-exemptions", repo: "rulespec-us" });
  });

  it("matches modules through adopted_by, with or without the .yaml suffix", () => {
    const result = matchConflictsToModules(conflicts, ["us/statutes/42/403/f", "us/statutes/26/32"]);
    expect(Object.keys(result)).toEqual(["us/statutes/42/403/f"]);
    expect(result["us/statutes/42/403/f"][0].globalId).toBe("us:oasdi-ret-own-work-age-exemptions");
  });
});

describe("parseConflictPathsParam", () => {
  it("accepts citation paths, trimmed and each once", () => {
    expect(parseConflictPathsParam("us/statute/42/403/f, us-hi/statute/235-2.4,us/statute/42/403/f/")).toEqual([
      "us/statute/42/403/f",
      "us-hi/statute/235-2.4",
    ]);
    expect(parseConflictPathsParam("us-co/regulation/9-ccr-2503-5/3.520.785")).toEqual([
      "us-co/regulation/9-ccr-2503-5/3.520.785",
    ]);
  });

  it("rejects empty, oversized and malformed input", () => {
    expect(parseConflictPathsParam(null)).toBeNull();
    expect(parseConflictPathsParam("")).toBeNull();
    expect(parseConflictPathsParam(" , ")).toBeNull();
    expect(parseConflictPathsParam("us/statute/../secret")).toBeNull();
    expect(parseConflictPathsParam("us/statute/42 403")).toBeNull();
    expect(parseConflictPathsParam("not a path")).toBeNull();
    expect(parseConflictPathsParam(Array.from({ length: 201 }, (_, i) => `us/statute/${i}`).join(","))).toBeNull();
    expect(parseConflictPathsParam(`us/statute/${"a".repeat(4000)}`)).toBeNull();
  });
});
