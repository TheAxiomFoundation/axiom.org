import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CERTIFICATE_COMMIT } from "../src/lib/tariff-certificate";
import { COVERAGE_COPY, INCIDENCE_COPY, PENDING_INCIDENCE_TABLES, coverageStatusWord, linesSha256, partitionRateLines, type TariffArtifact } from "../src/lib/tariff-coverage";
import {
  CERTIFICATE_FILE, CLOSURE_LEDGER_PATH, CORPUS_COMMIT, CORPUS_RELEASE, EXPECTED_LINE_COUNT, RULESPEC_COMMIT, SOURCES, TARIFF_TREES,
  atomNamingMember, bindCertificate, buildArtifact, checkEvidence, memberPrefix, renderCsv, renderJson, renderMembershipExplanation,
} from "./build-tariff-schedule-data";

// The committed artifact is the surface the site serves; its invariants are
// checked everywhere. Regeneration and the evidence checks additionally run
// wherever the pinned rulespec-us, axiom-corpus and axiom-oracles commits
// resolve (SOURCES uses the same lookup as the build script, so a worktree and
// the main clone agree).
const jsonText = readFileSync("public/downloads/tariff-schedule.json", "utf8");
const csvText = readFileSync("public/downloads/tariff-schedule.csv", "utf8");
const committed = JSON.parse(jsonText) as TariffArtifact;
const certificateBytes = readFileSync(CERTIFICATE_FILE);
const certificate = JSON.parse(certificateBytes.toString("utf8"));
const sourcesAvailable = Object.values(SOURCES).every((source) => source.available);
const burndownFamilies = (certificate.verdicts.closed.burndown as { family: string; status: string }[]);

describe("tariff schedule artifact", () => {
  it("contains the adjudicated rated-line count and pins its sources", () => {
    expect(committed.lines).toHaveLength(EXPECTED_LINE_COUNT);
    expect(committed.metadata).toMatchObject({ rulespecCommit: RULESPEC_COMMIT, corpusCommit: CORPUS_COMMIT, corpusRelease: CORPUS_RELEASE, lineCount: EXPECTED_LINE_COUNT });
    expect(Object.keys(committed.metadata.tariffTrees)).toEqual([...TARIFF_TREES]);
    expect(committed.metadata.tariffEncodingsChangedAt <= committed.metadata.builtAt).toBe(true);
  });

  it("serializes the JSON and derives the CSV from it byte for byte", () => {
    expect(renderJson(committed)).toBe(jsonText);
    expect(renderCsv(committed)).toBe(csvText);
  });

  it("names the vendored certificate in every artifact", () => {
    const sha = createHash("sha256").update(certificateBytes).digest("hex");
    const { metadata } = committed;
    expect(metadata.certificateSha256).toBe(sha);
    expect(metadata.certificateCommit).toBe(CERTIFICATE_COMMIT);
    expect(metadata.certificateRulespecCommit).toBe(certificate.verdicts.closed.rulespec_commit);
    expect(metadata.closureLedgerSha256).toBe(certificate.evidence.find((e: { artifact: string }) => e.artifact === CLOSURE_LEDGER_PATH).sha256);
    expect(certificate.verdicts.closed.reproduction_contract.external_corpus_git_object.commit).toBe(metadata.corpusCommit);
    expect(csvText.trimEnd().split("\n").slice(1).every((row) => row.includes(`"${sha}"`))).toBe(true);
  });

  it("partitions the lines exactly as the closure ledger does", () => {
    const { encoded, partial } = partitionRateLines(committed.lines);
    const { metadata } = committed;
    expect([encoded.length, partial.length]).toEqual([metadata.encodedLineCount, metadata.partialLineCount]);
    expect([linesSha256(encoded), linesSha256(partial)]).toEqual([metadata.encodedPathsSha256, metadata.partialPathsSha256]);
    const count = (family: string) => metadata.coverageFamilies.find((row) => row.ledgerFamily === family)?.count;
    expect(count("fully-computable-rate-bearing-lines")).toBe(encoded.length);
    expect(count("non-ad-valorem-or-partial-value-rate-bearing-lines")).toBe(partial.length);
  });

  it("carries one coverage row per ledger family with the current page copy", () => {
    const rows = committed.metadata.coverageFamilies;
    expect(new Set(rows.map((row) => row.ledgerFamily))).toEqual(new Set(Object.keys(COVERAGE_COPY)));
    for (const row of rows) {
      const copy = COVERAGE_COPY[row.ledgerFamily];
      expect(row.family).toBe(copy.label);
      expect(row.note).toBe(copy.note.replace("{count}", row.count.toLocaleString("en-US")));
    }
  });

  it("agrees with the certificate's burndown in both directions", () => {
    const burndown = new Map(burndownFamilies.map((item) => [item.family, item.status]));
    expect(burndown.size).toBeGreaterThan(0);
    for (const row of committed.metadata.coverageFamilies) {
      const listed = burndown.get(row.ledgerFamily);
      if (row.status === "partially encoded" || row.status === "pending") expect(listed && coverageStatusWord(listed), row.ledgerFamily).toBe(row.status);
      else expect(listed, row.ledgerFamily).toBeUndefined();
    }
    for (const family of burndown.keys()) expect(committed.metadata.coverageFamilies.some((row) => row.ledgerFamily === family), family).toBe(true);
  });

  it("lists every incidence table the lines draw memberships from, with honest counts", () => {
    const tables = committed.metadata.incidenceTables;
    const present = tables.filter((table) => table.module);
    expect(present.map((table) => table.family).sort()).toEqual(Object.values(INCIDENCE_COPY).map((copy) => copy.family).sort());
    expect(tables.filter((table) => !table.module).map((table) => table.note)).toEqual(PENDING_INCIDENCE_TABLES.map((table) => table.note));
    const families = new Set(committed.lines.flatMap((line) => line.memberships.map((m) => m.family)));
    expect([...families].sort()).toEqual(present.map((table) => table.family).sort());
    for (const table of present) {
      expect(table.subdivisions.length, table.note).toBeGreaterThan(0);
      const members = committed.lines.map((line) => line.memberships.filter((m) => m.family === table.family)).filter((list) => list.length);
      expect(members).toHaveLength(table.lineCount);
      expect(members.filter((list) => list.every((m) => m.explanation.includes(", via statistical reporting number ")))).toHaveLength(table.suffixOnlyLineCount);
    }
  });

  it("cites the chapter 99 page each membership explanation names", () => {
    for (const line of committed.lines) for (const membership of line.memberships) {
      expect(membership.citationPath.endsWith(`/page-${membership.explanation.match(/, page (\d+)/)?.[1]}`), `${line.hts10} ${membership.explanation}`).toBe(true);
    }
  });

  it("keeps known witness values, memberships and the fail-closed Canada warning", () => {
    const byCode = new Map(committed.lines.map((line) => [line.hts10, line]));
    expect(byCode.get("2203000000")).toMatchObject({ description: "Beer made from malt", generalRate: "Free", column2Rate: "13.2¢/liter", canada338Warning: true });
    // Note 20(f) lists 2203.00.00 on chapter 99 page 273, not the rule's first page.
    expect(byCode.get("2203000000")?.memberships).toEqual([{ family: "Section 301 China", explanation: "Section 301 China list scope — U.S. note 20(f), page 273", citationPath: "/us/statute/hts/chapter-99/page-273" }]);
    // Note 19 names 7615.10.20 only through its statistical numbers.
    expect(byCode.get("7615102000")?.memberships.map((m) => m.explanation)).toEqual([
      "Section 232 aluminum scope — U.S. note 19(j), page 255, via statistical reporting number 7615.10.20.15",
      "Section 232 aluminum scope — U.S. note 19(j), page 255, via statistical reporting number 7615.10.20.25",
    ]);
    expect(committed.lines.filter((item) => item.canada338Warning)).toHaveLength(1);
  });

  it("preserves non-ad-valorem statutory text", () => {
    const line = committed.lines.find((item) => item.generalDisposition === "specific");
    expect(line).toBeDefined();
    expect(line?.generalRate).not.toBe("not determined");
    expect(line?.generalRate).toMatch(/[¢$\/]|kg|liter|each/i);
  });
});

describe("tariff build helpers", () => {
  it("renders a human-readable incidence explanation", () => {
    expect(renderMembershipExplanation("note16", { name: "steel" }, { source: { corpus_citation_path: "us/statute/hts/chapter-99/page-237" }, context: { subdivision: "16(b)" } })).toBe("Section 232 steel scope — U.S. note 16(b), page 237");
  });

  it("restores a member code's lost leading zero", () => {
    expect(["301", "7206", "22030000", "7615102015"].map(memberPrefix)).toEqual(["0301", "7206", "22030000", "7615102015"]);
  });

  it("matches the one atom whose excerpt is the member's code, and fails otherwise", () => {
    const atom = (excerpt: string, page: number) => ({ source: { corpus_citation_path: `us/statute/hts/chapter-99/page-${page}`, excerpt } });
    const atoms = [atom("2201.10.00", 270), atom("2203.00.00", 273)];
    expect(atomNamingMember(atoms, "22030000", "note20").source?.corpus_citation_path).toBe("us/statute/hts/chapter-99/page-273");
    expect(() => atomNamingMember(atoms, "22040000", "note20")).toThrow(/0 proof atoms name member 22040000/);
    expect(() => atomNamingMember([...atoms, atom("2203.00.00", 274)], "22030000", "note20")).toThrow(/2 proof atoms/);
  });

  it("binds only a ledger the certificate content-addresses, with matching commits", () => {
    const ledgerText = "program:\n  rulespec_ref: aaa\nreproduction_contract:\n  external_corpus_git_object:\n    commit: ccc\n";
    const cert = (ledger: string, rulespec = "aaa", corpus = "ccc") => Buffer.from(JSON.stringify({
      evidence: [{ artifact: CLOSURE_LEDGER_PATH, sha256: createHash("sha256").update(ledger).digest("hex") }],
      verdicts: { closed: { rulespec_commit: rulespec, reproduction_contract: { external_corpus_git_object: { commit: corpus } } } },
    }));
    expect(bindCertificate(cert(ledgerText), ledgerText, "ccc")).toMatchObject({ evaluatedRulespecCommit: "aaa" });
    expect(() => bindCertificate(cert(ledgerText), `${ledgerText}# tampered\n`, "ccc")).toThrow(/does not hash/);
    expect(() => bindCertificate(cert(ledgerText, "bbb"), ledgerText, "ccc")).toThrow(/different rulespec commits/);
    expect(() => bindCertificate(cert(ledgerText), ledgerText, "ddd")).toThrow(/names corpus ccc/);
    expect(() => bindCertificate(Buffer.from("{}"), ledgerText, "ccc")).toThrow(/no evidence entry/);
  });
});

describe.skipIf(!sourcesAvailable)("tariff build against the pinned sources", () => {
  const chapter = "us/policies/cbp/us-tariff-schedule/generated/ch22/ch22.yaml";
  const files = [chapter, "us/policies/usitc/us-tariff-incidence/generated/note16-232-steel.yaml"];

  it("fails every kind of evidence check on a false claim", { timeout: 120_000 }, () => {
    const check = (evidence: Parameters<typeof checkEvidence>[1]) => () => checkEvidence("test", evidence, files);
    expect(check({ present: ["us/policies/missing.yaml"] })).toThrow(/expected us\/policies\/missing.yaml/);
    expect(check({ absent: ["us/policies/usitc/us-tariff-incidence/generated/note16"] })).toThrow(/expected nothing under/);
    expect(check({ absentMatching: "steel" })).toThrow(/expected no path matching/);
    expect(check({ fileContains: [{ path: chapter, text: "no such text anywhere" }] })).toThrow(/to contain/);
    expect(check({ rules: [{ module: chapter, rules: ["no_such_rule"] }] })).toThrow(/expected rule no_such_rule/);
    expect(check({ chapters: { imports: ["us:policies/usitc/no/such/overlay"] } })).toThrow(/to import/);
    expect(check({ chapters: { stackTerms: ["entry_is_line_d"] } })).toThrow(/schedule_statutory_stack/);
    expect(check({ chapters: { references: ["entry_is_brazil_301_listd"] } })).toThrow(/to reference/);
    expect(check({ chapters: { notDefined: ["schedule_statutory_stack"] } })).toThrow(/not to define/);
    expect(check({ undefinedRules: ["section_232_steel_component_rate"] })).toThrow(/expected no module to define/);
    expect(check({ chapters: { stackTerms: ["brazil_section_301_component_rate"], references: ["entry_is_brazil_301_listed"] }, undefinedRules: ["entry_is_brazil_301_listed"] })).not.toThrow();
  });

  it("regenerates both downloads byte-identically from the pinned commits", { timeout: 300_000 }, () => {
    const rebuilt = buildArtifact();
    expect(renderJson(rebuilt)).toBe(jsonText);
    expect(renderCsv(rebuilt)).toBe(csvText);
  });
});
