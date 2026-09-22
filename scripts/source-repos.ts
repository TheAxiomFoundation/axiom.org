import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type SourceRepo = { path: string; available: boolean };

export function hasCommit(repo: string, commit: string) {
  if (!existsSync(repo)) return false;
  try {
    execFileSync("git", ["-C", repo, "cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ancestors(start: string) {
  const dirs: string[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (dirname(dir) === dir) return dirs;
  }
}

// Sibling repositories are found by walking up from this checkout, so the
// main clone (~/TheAxiomFoundation/axiom.org) and a worktree
// (~/TheAxiomFoundation/_worktrees/<name>) resolve the same clones, and the
// build script and its tests always agree. The first candidate that holds the
// pinned commit wins; an environment variable overrides the search.
export function locateSourceRepo(options: { envVar: string; names: string[]; commit: string; from?: string }): SourceRepo {
  const override = process.env[options.envVar];
  if (override) return { path: override, available: hasCommit(override, options.commit) };
  const candidates = ancestors(dirname(options.from ?? REPO_ROOT)).flatMap((dir) => options.names.map((name) => resolve(dir, name)));
  const found = candidates.find((candidate) => hasCommit(candidate, options.commit));
  if (found) return { path: found, available: true };
  return { path: candidates.find(existsSync) ?? candidates[0], available: false };
}
