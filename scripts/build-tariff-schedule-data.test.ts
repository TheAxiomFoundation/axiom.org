import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildArtifact, EXPECTED_LINE_COUNT, renderMembershipExplanation, RULESPEC_COMMIT } from "./build-tariff-schedule-data";

type Artifact = ReturnType<typeof buildArtifact>;

// The committed artifact is the surface the site serves; its invariants
// are checked everywhere. Regeneration equality additionally runs only
// where the pinned rulespec-us commit is available (local lane, not CI).
const committed = JSON.parse(readFileSync("public/downloads/tariff-schedule.json", "utf8")) as Artifact;
const rulespecPath = process.env.RULESPEC_US_PATH ?? `${process.env.HOME}/TheAxiomFoundation/_b1wt/rulespec-us`;
const sourceAvailable = (() => {
  if (!existsSync(rulespecPath)) return false;
  try {
    return execFileSync("git", ["-C", rulespecPath, "rev-parse", `${RULESPEC_COMMIT}^{commit}`], { encoding: "utf8" }).trim() === RULESPEC_COMMIT;
  } catch {
    return false;
  }
})();

describe("tariff schedule artifact", () => {
  it("contains the adjudicated rated-line count and pins its sources", () => {
    expect(committed.lines).toHaveLength(EXPECTED_LINE_COUNT);
    expect(committed.metadata.rulespecCommit).toBe(RULESPEC_COMMIT);
    expect(committed.metadata.certificateSha256).toMatch(/^[0-9a-f]{64}$/);
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
  });
  it.skipIf(!sourceAvailable)("regenerates byte-identically from the pinned rulespec commit", { timeout: 180_000 }, () => {
    const rebuilt = buildArtifact();
    expect(rebuilt).toEqual(committed);
    expect(buildArtifact()).toEqual(rebuilt);
  });
});
