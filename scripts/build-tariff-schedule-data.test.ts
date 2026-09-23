import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildArtifact, CORPUS_COMMIT, EXPECTED_LINE_COUNT, pinsAvailable, renderMembershipExplanation, resolveSourcePins, RULESPEC_COMMIT,
  unavailablePins, type SourcePins,
} from "./build-tariff-schedule-data";

type Artifact = ReturnType<typeof buildArtifact>;

// The committed artifact is the surface the site serves; its invariants
// are checked everywhere. Regeneration equality additionally runs only
// where both pinned commits (rulespec-us and axiom-corpus) resolve through
// the builder's own lookup, SOURCE_PINS — local lanes with those clones,
// not CI. pinsAvailable() is the same check buildArtifact() fails closed on.
const committed = JSON.parse(readFileSync("public/downloads/tariff-schedule.json", "utf8")) as Artifact;
const regenerable = pinsAvailable();

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
  it.skipIf(!regenerable)("regenerates byte-identically from the pinned rulespec commit", { timeout: 180_000 }, () => {
    const rebuilt = buildArtifact();
    expect(rebuilt).toEqual(committed);
    expect(buildArtifact()).toEqual(rebuilt);
  });
});

describe("tariff schedule source pins", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "tariff-pins-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  const dir = (...parts: string[]) => { const path = join(tmp, ...parts); mkdirSync(path, { recursive: true }); return path; };
  // A throwaway repository with one commit; returns that commit's SHA.
  const repoWithCommit = (...parts: string[]) => {
    const path = dir(...parts);
    const git = (...args: string[]) => execFileSync("git", ["-C", path, "-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "--no-verify", "-m", "pin");
    return { path, commit: git("rev-parse", "HEAD") };
  };
  const pins = (rulespec: { path: string; commit: string }, corpus: { path: string; commit: string }): SourcePins => ({
    rulespec: { repo: "rulespec-us", envVar: "RULESPEC_US_PATH", ...rulespec },
    corpus: { repo: "axiom-corpus", envVar: "AXIOM_CORPUS_PATH", ...corpus },
  });

  it("takes both checkouts from their environment overrides", () => {
    expect(resolveSourcePins({ RULESPEC_US_PATH: "/pins/rulespec-us", AXIOM_CORPUS_PATH: "/pins/axiom-corpus" }, "/nowhere/axiom.org")).toEqual(pins(
      { path: "/pins/rulespec-us", commit: RULESPEC_COMMIT },
      { path: "/pins/axiom-corpus", commit: CORPUS_COMMIT },
    ));
  });

  it("finds both checkouts beside a main checkout and beside a nested worktree's repository", () => {
    const rulespec = dir("_b1wt/rulespec-us"); const corpus = dir("axiom-corpus-b1-full");
    for (const root of [dir("axiom.org"), dir("axiom.org/.worktrees/branch")]) {
      const resolved = resolveSourcePins({}, root);
      expect([resolved.rulespec.path, resolved.corpus.path]).toEqual([rulespec, corpus]);
    }
  });

  it("names the first sibling candidate when neither exists, so failures report the path the build tried", () => {
    const resolved = resolveSourcePins({}, dir("_worktrees/axiom-org-branch"));
    expect(resolved.rulespec.path).toBe(join(tmp, "_worktrees/_b1wt/rulespec-us"));
    expect(resolved.corpus.path).toBe(join(tmp, "_worktrees/axiom-corpus-b1-full"));
    expect(unavailablePins(resolved)).toEqual([
      `rulespec-us checkout not found at ${resolved.rulespec.path} (set RULESPEC_US_PATH)`,
      `axiom-corpus checkout not found at ${resolved.corpus.path} (set AXIOM_CORPUS_PATH)`,
    ]);
  });

  it("counts a pin available only when its exact commit resolves in the checkout", () => {
    const rulespec = repoWithCommit("rulespec-us"); const corpus = repoWithCommit("axiom-corpus");
    expect(unavailablePins(pins(rulespec, corpus))).toEqual([]);
    expect(pinsAvailable(pins(rulespec, corpus))).toBe(true);

    const absent = "0".repeat(40);
    expect(unavailablePins(pins({ ...rulespec, commit: absent }, corpus))).toEqual([`rulespec-us commit ${absent} not found in ${rulespec.path} (set RULESPEC_US_PATH)`]);
    const notARepository = dir("not-a-repository");
    expect(unavailablePins(pins(rulespec, { ...corpus, path: notARepository }))).toEqual([`axiom-corpus commit ${corpus.commit} not found in ${notARepository} (set AXIOM_CORPUS_PATH)`]);
  });

  // The 2026-09-22 regression: the guard checked only rulespec-us, so a lane
  // with that clone but no axiom-corpus clone ran the test and crashed.
  it("is unavailable when rulespec-us resolves but the axiom-corpus checkout does not", () => {
    const partial = pins(repoWithCommit("rulespec-us"), { path: join(tmp, "axiom-corpus-b1-full"), commit: CORPUS_COMMIT });
    expect(pinsAvailable(partial)).toBe(false);
    expect(unavailablePins(partial)).toEqual([`axiom-corpus checkout not found at ${partial.corpus.path} (set AXIOM_CORPUS_PATH)`]);
  });

  it("makes buildArtifact refuse with exactly the reasons the skip guard sees", () => {
    const partial = pins(repoWithCommit("rulespec-us"), { path: join(tmp, "axiom-corpus-b1-full"), commit: CORPUS_COMMIT });
    expect(() => buildArtifact(partial)).toThrow(`tariff schedule sources unavailable: ${unavailablePins(partial).join("; ")}`);
  });
});
