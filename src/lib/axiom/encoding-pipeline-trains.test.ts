/**
 * Modules a merge train or a side branch's PR carried to main for signed
 * PRs that hold only their manifest, on recorded rulespec-us payloads
 * (src/test/rulespec-merge-train-prs.json, no network): the promotion
 * lane's #2202-#2204 into candidate branches, closed when train #2205
 * merged; #2192 into #2045's branch; and #1347, a one-PR landing.
 */
import { describe, expect, it } from "vitest";
import recorded from "@/test/rulespec-merge-train-prs.json";
import {
  buildAttempts,
  carrierIndex,
  carrierPrFor,
  landedModulePaths,
  mainMerge,
  manifestModulePaths,
  moduleCitation,
  outsideModules,
  prGate,
  rulespecModulePaths,
  viaPrFor,
  type BranchPr,
  type ManifestPr,
  type MergedPr,
  type MirrorRow,
  type PrGateNode,
  type WorkflowRun,
} from "./encoding-pipeline-collect";
import { attemptStage, citationStates, mergeDetail, outsideAttemptId, type PipelineAttempt } from "./encoding-pipeline";

const NOW = Date.parse("2026-11-15T23:00:00Z");
const REPO = recorded.repo;
const MEDICAL = "us-az/policies/des/faa5/na-medical-expenses-and-deduction";
const UTILITY = "us-az/policies/des/faa5/na-utility-expenses-and-allowances";
const TRAIN_COMMIT = "ccdfdcf7ceaba602065eb3a1d8da3a56d66bfbf7";

type ManifestNode = (typeof recorded.manifestPrs)[number];
type MergedNode = (typeof recorded.mergedPrs)[number];

/** A search node as the collector's searchPrs keeps it. */
function manifestPr(node: ManifestNode): ManifestPr {
  return {
    repo: node.repository.name,
    number: node.number,
    url: node.url,
    title: node.title,
    body: node.body ?? "",
    isDraft: node.isDraft,
    state: node.state as ManifestPr["state"],
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    closedAt: node.closedAt,
    baseRefName: node.baseRefName,
    defaultBranch: node.repository.defaultBranchRef?.name ?? null,
    checks: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
    reviewDecision: node.reviewDecision,
    files: node.files.nodes.map((file) => file.path),
    mergeCommit: node.mergeCommit?.oid ?? null,
    ...prGate(node as PrGateNode),
  };
}

/** A merged-PR node as listMergedPrs keeps it, with the files readPrFiles reads (or none, when stored). */
function mergedPr(node: MergedNode, withFiles = true): MergedPr {
  return {
    repo: REPO,
    number: node.number,
    url: node.url,
    title: node.title,
    author: node.author?.login ?? null,
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    baseRefName: node.baseRefName,
    defaultBranch: recorded.defaultBranch,
    mergeCommit: node.mergeCommit?.oid ?? null,
    ...(withFiles ? { files: node.files.nodes.filter((file) => file.changeType !== "DELETED").map((file) => file.path) } : {}),
  };
}

/** The side branches' own PRs as readBranchPrs keeps them. */
const branchPrs = new Map<string, BranchPr[]>(
  Object.entries(recorded.sideBranchPrs).map(([branch, list]) => [
    branch,
    list.map((pr) => ({
      number: pr.number,
      url: pr.html_url,
      state: pr.merged_at ? ("MERGED" as const) : pr.state === "open" ? ("OPEN" as const) : ("CLOSED" as const),
      isDraft: !!pr.draft,
      createdAt: pr.created_at,
      mergedAt: pr.merged_at ?? null,
      mergeCommit: pr.merged_at ? (pr.merge_commit_sha ?? null) : null,
    })),
  ])
);

const runs = recorded.runs as WorkflowRun[];
const mirror = recorded.mirror as MirrorRow[];

/** The collector's order: side branches, merged PRs, merge trains, outside modules, then the rows. */
function collect(previous: Map<string, Partial<PipelineAttempt>> = new Map(), filesRead = true) {
  const prs = recorded.manifestPrs.map(manifestPr);
  for (const pr of prs) {
    const listed = branchPrs.get(pr.baseRefName);
    pr.via = listed ? viaPrFor(pr, listed) : null;
  }
  const merged = recorded.mergedPrs.map((node) => mergedPr(node, filesRead));
  const carriers = carrierIndex(merged, previous);
  for (const pr of prs) {
    const carrier = carrierPrFor(pr, carriers);
    if (carrier) pr.via = carrier;
  }
  const outside = outsideModules(merged, previous, prs, mirror);
  const attempts = buildAttempts({
    runs,
    prs,
    encoderRuns: [],
    mirror,
    compile: null,
    failureDetails: new Map(),
    previous,
    nowMs: NOW,
    outside,
  });
  return { prs, outside, attempts };
}

const byPr = (prs: ManifestPr[], number: number) => prs.find((pr) => pr.number === number)!;
const byRun = (attempts: PipelineAttempt[], id: number) => attempts.find((attempt) => attempt.id === String(id))!;

describe("signed PRs that hold only their manifest", () => {
  it("name the module each manifest stands for, at the repo root or under a jurisdiction", () => {
    expect(manifestModulePaths(byPr(recorded.manifestPrs.map(manifestPr), 2204).files)).toEqual([`${MEDICAL}/block-7.yaml`]);
    expect(
      manifestModulePaths([
        "us-az/.axiom/encoding-manifests/policies/des/faa5/x.json",
        ".axiom/encoding-manifests/policies/cdhs/snap/fy-2026.json",
        ".axiom/index/provisions_to_rules.json",
        ".axiom/legacy-replacements/abc.json",
        "us-az/policies/des/faa5/x.yaml",
      ])
    ).toEqual(["policies/cdhs/snap/fy-2026.yaml", "us-az/policies/des/faa5/x.yaml"]);
  });

  it("link the closed signed PRs to train #2205, which holds their modules, and count them merged at its commit", () => {
    const { prs, attempts } = collect();
    for (const [number, run, block] of [
      [2202, 43376624427, 11],
      [2203, 43376652240, 12],
      [2204, 43376596010, 7],
    ] as const) {
      const pr = byPr(prs, number);
      // #2046 mentions the PRs and holds block 7 too; the train merged first.
      expect(pr.via).toMatchObject({ number: 2205, state: "MERGED", mergeCommit: TRAIN_COMMIT });
      expect(mainMerge(pr)).toEqual({ mergedAt: "2026-11-15T07:53:48Z", mergeCommit: TRAIN_COMMIT });
      expect(landedModulePaths(pr)).toEqual([`${MEDICAL}/block-${block}.yaml`]);
      const attempt = byRun(attempts, run);
      expect(attempt).toMatchObject({
        citation: `us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-${block}`,
        pr_number: number,
        pr_state: "closed",
        pr_via_number: 2205,
        pr_via_state: "merged",
        pr_via_merged_at: "2026-11-15T07:53:48Z",
        pr_via_merge_commit: TRAIN_COMMIT,
        module_paths: [`${MEDICAL}/block-${block}.yaml`],
        index_status: "indexed",
      });
      expect(mergeDetail(attempt)).toBe(`Closed; ${REPO}#2205 carried it into the default branch`);
      expect(attemptStage(attempt)).not.toBe("closed");
    }
  });

  it("drop the train's own rows for the modules it carried, and the side branch's PR's (#2045)", () => {
    const { outside } = collect();
    const ids = outside.map((module) => module.pr.number);
    expect(ids).not.toContain(2205);
    expect(ids).not.toContain(2045);
  });

  it("follow a manifest merged into a side branch to the module its branch's PR merged (#2192 by #2045)", () => {
    const { prs, attempts } = collect();
    const pr = byPr(prs, 2192);
    expect(pr.via).toMatchObject({ number: 2045, state: "MERGED", mergeCommit: "8081f0cc69a7c5a566325061b7e210f765809a96" });
    expect(byRun(attempts, 43290017621)).toMatchObject({
      citation: "us-az/manual/des/faa5/na-utility-expenses-and-allowances/block-13",
      pr_state: "merged",
      pr_targets_default: false,
      pr_via_number: 2045,
      pr_via_state: "merged",
      module_paths: [`${UTILITY}/block-13.yaml`],
      index_status: "indexed",
    });
  });

  it("give a merged PR's module the provision it encodes, in the dispatches' group (#2046-#2048)", () => {
    const { outside, attempts } = collect();
    expect(outside.map((module) => [module.pr.number, module.citation, module.citationFrom])).toEqual([
      [2047, "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-11", "index"],
      [2048, "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-12", "index"],
      [2046, "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-7", "index"],
    ]);
    // No group under the module's own path (us-az/policy/...): every row is under the manual.
    const citations = citationStates(attempts).map((state) => state.citation);
    expect(citations.filter((citation) => citation.startsWith("us-az/policy/"))).toEqual([]);
    expect(citations.filter((citation) => citation.startsWith("us-az/manual/des/faa5/")).sort()).toEqual([
      "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-11",
      "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-12",
      "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-7",
      "us-az/manual/des/faa5/na-utility-expenses-and-allowances/block-13",
    ]);
  });

  it("do the same from the train's stored rows when its files are not read again (the pass after it merged)", () => {
    // What the table held before this change: #2205's and #2045's rows under the module's own path.
    const stored = new Map<string, Partial<PipelineAttempt>>();
    for (const node of recorded.mergedPrs) {
      const pr = mergedPr(node);
      for (const path of rulespecModulePaths(pr.files!)) {
        if (!path.includes("/policies/")) continue;
        const id = outsideAttemptId(REPO, pr.number, path);
        stored.set(id, {
          id,
          citation: path.replace("/policies/", "/policy/").replace(/\.yaml$/, ""),
          pr_repo: REPO,
          pr_number: pr.number,
          pr_url: pr.url,
          pr_created_at: pr.createdAt,
          pr_merged_at: pr.mergedAt,
          pr_base_branch: "main",
          pr_merge_commit: pr.mergeCommit,
          dispatched_by: pr.author,
          collected_at: "2026-11-15T22:40:00Z",
        });
      }
    }
    const { prs, outside } = collect(stored, false);
    for (const number of [2202, 2203, 2204]) expect(byPr(prs, number).via?.number).toBe(2205);
    expect(outside.map((module) => [module.pr.number, module.citation])).toEqual([
      [2047, "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-11"],
      [2048, "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-12"],
      [2046, "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-7"],
    ]);
  });
});

describe("a one-PR landing (#1347)", () => {
  it("is unchanged: its own module, its own merge, no carrier", () => {
    const { prs, attempts } = collect();
    const pr = byPr(prs, 1347);
    expect(pr.via ?? null).toBeNull();
    expect(landedModulePaths(pr)).toEqual(rulespecModulePaths(pr.files));
    expect(landedModulePaths(pr)).toEqual(["us/statutes/7/2015/f.yaml"]);
    expect(mainMerge(pr)).toEqual({ mergedAt: pr.mergedAt, mergeCommit: pr.mergeCommit });
    expect(byRun(attempts, 34204901922)).toMatchObject({
      citation: "us/statute/7/2015/f",
      pr_state: "merged",
      pr_targets_default: true,
      pr_merge_commit: pr.mergeCommit,
      module_paths: ["us/statutes/7/2015/f.yaml"],
    });
    expect(byRun(attempts, 34204901922)).not.toHaveProperty("pr_via_number", 2205);
  });

  it("keeps a module grounded in several provisions under its own citation", () => {
    const row = mirror.find((r) => r.file_path === "statutes/7/2015/f.yaml")!;
    expect(row.value_citation_paths).toHaveLength(2);
    expect(moduleCitation(row)).toBe("us/statute/7/2015/f");
    expect(moduleCitation({ citation_path: "us/statute/7/2015/f" })).toBe("us/statute/7/2015/f");
    expect(moduleCitation({ citation_path: "us/statute/7/2015/f", value_citation_paths: [] })).toBe("us/statute/7/2015/f");
  });
});
