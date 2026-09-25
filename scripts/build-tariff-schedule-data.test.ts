import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildArtifact, CORPUS_COMMIT, CORPUS_RELEASE, EXPECTED_LINE_COUNT, pinsAvailable, renderMembershipExplanation, resolveSourcePins, RULESPEC_COMMIT,
  SOURCE_PINS, unavailablePins, type SourcePins,
} from "./build-tariff-schedule-data";

type Artifact = ReturnType<typeof buildArtifact>;

// The committed artifact is the surface the site serves; its invariants
// are checked everywhere. Regeneration equality additionally runs only
// where both pinned commits (rulespec-us and axiom-corpus) resolve through
// the builder's own lookup, SOURCE_PINS — local lanes with those clones,
// not CI. pinsAvailable() is the same check buildArtifact() fails closed on.
const committed = JSON.parse(readFileSync("public/downloads/tariff-schedule.json", "utf8")) as Artifact;
const regenerable = pinsAvailable(SOURCE_PINS);

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
  it.skipIf(!regenerable)("regenerates the committed artifact from both pinned source commits", { timeout: 180_000 }, () => {
    const rebuilt = buildArtifact(SOURCE_PINS);
    expect(rebuilt).toEqual(committed);
    expect(buildArtifact(SOURCE_PINS)).toEqual(rebuilt);
  });
});

describe("tariff schedule source pins", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "tariff-pins-")); });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(tmp, { recursive: true, force: true }); });

  const dir = (...parts: string[]) => { const path = join(tmp, ...parts); mkdirSync(path, { recursive: true }); return path; };
  // A throwaway repository holding `files` in one commit, dated
  // FIXTURE_TIME. Hermetic on purpose: hooks and `git rebase -x` run from a
  // linked worktree export GIT_DIR, which git honors over -C, so inherited
  // GIT_* variables are dropped; system, global and $HOME/XDG config
  // (including the global excludes file) are out of reach; and it commits
  // with write-tree/commit-tree rather than `git commit`, so no hook fires.
  const FIXTURE_TIME = Date.UTC(2001, 1, 3, 4, 5, 6) / 1000;
  const repoWithCommit = (name: string, files: Record<string, string> = {}) => {
    const path = dir(name);
    for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(path, file)), { recursive: true }); writeFileSync(join(path, file), text); }
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, {
      HOME: tmp, XDG_CONFIG_HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull,
      GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_AUTHOR_DATE: `${FIXTURE_TIME} +0000`,
      GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com", GIT_COMMITTER_DATE: `${FIXTURE_TIME} +0000`,
    });
    const git = (...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", env }).trim();
    git("init", "-q"); git("add", "-A", "-f");
    return { path, commit: git("commit-tree", git("write-tree"), "-m", name) };
  };
  const pins = (rulespec: { path: string; commit: string }, corpus: { path: string; commit: string }): SourcePins => ({
    rulespec: { repo: "rulespec-us", envVar: "RULESPEC_US_PATH", ...rulespec },
    corpus: { repo: "axiom-corpus", envVar: "AXIOM_CORPUS_PATH", ...corpus },
  });
  // Both sources in miniature, at commits other than the real pins: one
  // chapter table of EXPECTED_LINE_COUNT free lines, one corpus record,
  // and empty incidence tables, so a build that reads them completes.
  const miniatureSources = () => {
    const codes = Array.from({ length: EXPECTED_LINE_COUNT }, (_, i) => String(101_000_000 + i).padStart(10, "0"));
    return pins(
      repoWithCommit("rulespec-us", {
        "us/policies/usitc/us-tariff-duty/lines/generated/ch01.yaml": `rules:\n  - name: ch01_general_disposition\n    versions:\n      - values:\n${codes.map((code) => `          "${code}": free\n`).join("")}`,
        ...Object.fromEntries(["note16-232-steel", "note18-201-solar", "note19-232-aluminum", "note20-china-301", "note2aa-122-exemptions"]
          .map((file) => [`us/policies/usitc/us-tariff-incidence/generated/${file}.yaml`, "rules: []\n"])),
      }),
      repoWithCommit("axiom-corpus", { [`data/corpus/provisions/us/statute/${CORPUS_RELEASE}.jsonl`]: `${JSON.stringify({ citation_path: "us/statute/hts/0101.00.00.00", body: "Purebred breeding animals" })}\n` }),
    );
  };
  const expectBuiltFrom = (sources: SourcePins) => {
    const artifact = buildArtifact(sources);
    expect(artifact.metadata).toMatchObject({ rulespecCommit: sources.rulespec.commit, corpusCommit: sources.corpus.commit, builtAt: new Date(FIXTURE_TIME * 1000).toISOString(), lineCount: EXPECTED_LINE_COUNT });
    expect(artifact.lines[0]).toMatchObject({ hts10: "0101000000", description: "Purebred breeding animals", generalRate: "Free" });
  };

  it("lets both environment overrides win over existing sibling checkouts", () => {
    dir("_b1wt/rulespec-us"); dir("axiom-corpus-b1-full");
    expect(resolveSourcePins({ RULESPEC_US_PATH: "/pins/rulespec-us", AXIOM_CORPUS_PATH: "/pins/axiom-corpus" }, dir("axiom.org"))).toEqual(pins(
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
    // Nested so both candidates (root/.. and root/../../..) stay inside tmp.
    const resolved = resolveSourcePins({}, dir("lanes/_worktrees/axiom-org-branch"));
    expect(resolved.rulespec.path).toBe(join(tmp, "lanes/_worktrees/_b1wt/rulespec-us"));
    expect(resolved.corpus.path).toBe(join(tmp, "lanes/_worktrees/axiom-corpus-b1-full"));
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

  it("builds from the checkouts and commits the guard approved", () => {
    const sources = miniatureSources();
    expect(pinsAvailable(sources)).toBe(true);
    expectBuiltFrom(sources);
  });

  it("reads the whole tree when a pin path points inside its checkout", () => {
    const sources = miniatureSources();
    const inside = { ...sources, rulespec: { ...sources.rulespec, path: join(sources.rulespec.path, "us") } };
    expect(pinsAvailable(inside)).toBe(true);
    expectBuiltFrom(inside);
  });

  it("reads each pin's own checkout when the caller exports GIT_DIR", () => {
    const caller = repoWithCommit("caller");
    vi.stubEnv("GIT_DIR", join(caller.path, ".git"));
    vi.stubEnv("GIT_INDEX_FILE", join(caller.path, ".git/index"));
    const sources = miniatureSources();
    expect(existsSync(join(sources.rulespec.path, ".git"))).toBe(true);
    expect(unavailablePins(sources)).toEqual([]);
    expectBuiltFrom(sources);
  });
});
