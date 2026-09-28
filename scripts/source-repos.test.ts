import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hasCommit, locateSourceRepo } from "./source-repos";

// A throwaway organization folder: org/rulespec-us holds the pinned commit,
// org/_b1wt/rulespec-us is an older clone without it, and the site is checked
// out both as org/axiom.org and as org/_worktrees/tariff.
const org = mkdtempSync(join(tmpdir(), "source-repos-"));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function repoWithCommit(path: string) {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q");
  // The message names the path so the two clones' commits differ.
  git(path, "-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "--allow-empty", "-m", `pin ${path}`);
  return git(path, "rev-parse", "HEAD");
}
const pinned = repoWithCommit(join(org, "rulespec-us"));
repoWithCommit(join(org, "_b1wt", "rulespec-us"));
const mainCheckout = join(org, "axiom.org");
const worktree = join(org, "_worktrees", "tariff");
mkdirSync(mainCheckout, { recursive: true });
mkdirSync(worktree, { recursive: true });
afterAll(() => rmSync(org, { recursive: true, force: true }));

describe("locateSourceRepo", () => {
  const locate = (from: string, envVar = "SOURCE_REPOS_TEST_UNSET") => locateSourceRepo({ envVar, names: ["_b1wt/rulespec-us", "rulespec-us"], commit: pinned, from });

  it("resolves the same clone from the main checkout and from a worktree", () => {
    expect(locate(mainCheckout)).toEqual({ path: join(org, "rulespec-us"), available: true });
    expect(locate(worktree)).toEqual(locate(mainCheckout));
  });

  it("skips a candidate that lacks the pinned commit", () => {
    expect(hasCommit(join(org, "_b1wt", "rulespec-us"), pinned)).toBe(false);
    expect(locate(worktree).path).toBe(join(org, "rulespec-us"));
  });

  it("rejects a shallow clone, whose history cannot date the encodings", () => {
    const shallow = join(org, "shallow", "rulespec-us");
    mkdirSync(join(org, "shallow"), { recursive: true });
    git(join(org, "rulespec-us"), "-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "--allow-empty", "-m", "second");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${join(org, "rulespec-us")}`, shallow]);
    const head = git(shallow, "rev-parse", "HEAD");
    expect(hasCommit(shallow, head)).toBe(false);
    expect(hasCommit(join(org, "rulespec-us"), head)).toBe(true);
  });

  it("reports an unavailable pin instead of guessing", () => {
    const missing = locateSourceRepo({ envVar: "SOURCE_REPOS_TEST_UNSET", names: ["axiom-oracles"], commit: pinned, from: worktree });
    expect(missing.available).toBe(false);
  });

  it("lets an environment variable override the search", () => {
    process.env.SOURCE_REPOS_TEST_OVERRIDE = join(org, "_b1wt", "rulespec-us");
    try {
      expect(locate(worktree, "SOURCE_REPOS_TEST_OVERRIDE")).toEqual({ path: join(org, "_b1wt", "rulespec-us"), available: false });
    } finally {
      delete process.env.SOURCE_REPOS_TEST_OVERRIDE;
    }
  });
});
