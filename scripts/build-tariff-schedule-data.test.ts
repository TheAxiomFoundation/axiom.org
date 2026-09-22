import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CERTIFICATE_COMMIT } from "../src/lib/tariff-certificate";
import { COVERAGE_COPY, INCIDENCE_COPY, PENDING_INCIDENCE_TABLES, coverageStatusWord, linesSha256, partitionRateLines, type TariffArtifact } from "../src/lib/tariff-coverage";
import {
  CERTIFICATE_FILE, CLOSURE_LEDGER_PATH, CORPUS_COMMIT, CORPUS_RELEASE, EXPECTED_LINE_COUNT, RULESPEC_COMMIT, SOURCES, TARIFF_TREES,
  buildArtifact, renderMembershipExplanation,
} from "./build-tariff-schedule-data";

// The committed artifact is the surface the site serves; its invariants are
// checked everywhere. Regeneration additionally runs wherever the pinned
// rulespec-us, axiom-corpus and axiom-oracles commits resolve (SOURCES uses the
// same lookup as the build script, so a worktree and the main clone agree).
const committed = JSON.parse(readFileSync("public/downloads/tariff-schedule.json", "utf8")) as TariffArtifact;
const csv = readFileSync("public/downloads/tariff-schedule.csv", "utf8");
const certificateBytes = readFileSync(CERTIFICATE_FILE);
const certificate = JSON.parse(certificateBytes.toString("utf8"));
const sourcesAvailable = Object.values(SOURCES).every((source) => source.available);

describe("tariff schedule artifact", () => {
  it("contains the adjudicated rated-line count and pins its sources", () => {
    expect(committed.lines).toHaveLength(EXPECTED_LINE_COUNT);
    expect(committed.metadata).toMatchObject({ rulespecCommit: RULESPEC_COMMIT, corpusCommit: CORPUS_COMMIT, corpusRelease: CORPUS_RELEASE, lineCount: EXPECTED_LINE_COUNT });
    expect(Object.keys(committed.metadata.tariffTrees)).toEqual([...TARIFF_TREES]);
    expect(committed.metadata.tariffEncodingsChangedAt <= committed.metadata.builtAt).toBe(true);
  });

  it("names the vendored certificate in every artifact", () => {
    const sha = createHash("sha256").update(certificateBytes).digest("hex");
    const { metadata } = committed;
    expect(metadata.certificateSha256).toBe(sha);
    expect(metadata.certificateCommit).toBe(CERTIFICATE_COMMIT);
    expect(metadata.certificateRulespecCommit).toBe(certificate.verdicts.closed.rulespec_commit);
    expect(metadata.closureLedgerSha256).toBe(certificate.evidence.find((e: { artifact: string }) => e.artifact === CLOSURE_LEDGER_PATH).sha256);
    expect(certificate.verdicts.closed.reproduction_contract.external_corpus_git_object.commit).toBe(metadata.corpusCommit);
    const rows = csv.trimEnd().split("\n");
    expect(rows).toHaveLength(EXPECTED_LINE_COUNT + 1);
    const tail = `"${metadata.rulespecCommit}","${metadata.corpusRelease}","${metadata.certificateSha256}","${metadata.builtAt}"`;
    expect(rows.slice(1).every((row) => row.endsWith(tail))).toBe(true);
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

  it("agrees with the certificate's own burndown on every status", () => {
    const burndown = certificate.verdicts.closed.burndown as { family: string; status: string }[];
    expect(burndown.length).toBeGreaterThan(0);
    for (const item of burndown) {
      expect(committed.metadata.coverageFamilies.find((row) => row.ledgerFamily === item.family)?.status).toBe(coverageStatusWord(item.status));
    }
  });

  it("lists every incidence table the lines draw memberships from", () => {
    const tables = committed.metadata.incidenceTables;
    const present = tables.filter((table) => table.module);
    expect(present.map((table) => table.family).sort()).toEqual(Object.values(INCIDENCE_COPY).map((copy) => copy.family).sort());
    expect(tables.filter((table) => !table.module).map((table) => table.note)).toEqual(PENDING_INCIDENCE_TABLES.map((table) => table.note));
    const families = new Set(committed.lines.flatMap((line) => line.memberships.map((m) => m.family)));
    expect([...families].sort()).toEqual(present.map((table) => table.family).sort());
    for (const table of present) {
      expect(committed.lines.filter((line) => line.memberships.some((m) => m.family === table.family))).toHaveLength(table.lineCount);
    }
  });

  it("preserves non-ad-valorem statutory text", () => {
    const line = committed.lines.find((item) => item.generalDisposition === "specific");
    expect(line).toBeDefined();
    expect(line?.generalRate).not.toBe("not determined");
    expect(line?.generalRate).toMatch(/[¢$\/]|kg|liter|each/i);
  });

  it("renders a human-readable incidence explanation", () => {
    expect(renderMembershipExplanation("note16", { name: "steel" }, { source: { corpus_citation_path: "us/statute/hts/chapter-99/page-237" }, context: { subdivision: "16(b)" } })).toBe("Section 232 steel scope — U.S. note 16(b), page 237");
  });

  it("keeps known witness values and the fail-closed Canada warning", () => {
    const beer = committed.lines.find((item) => item.hts10 === "2203000000");
    expect(beer).toMatchObject({ description: "Beer made from malt", generalRate: "Free", column2Rate: "13.2¢/liter", canada338Warning: true });
    expect(committed.lines.filter((item) => item.canada338Warning)).toHaveLength(1);
  });

  it.skipIf(!sourcesAvailable)("regenerates byte-identically from the pinned commits", { timeout: 300_000 }, () => {
    const rebuilt = buildArtifact();
    expect(rebuilt).toEqual(committed);
    expect(buildArtifact()).toEqual(rebuilt);
  });
});
