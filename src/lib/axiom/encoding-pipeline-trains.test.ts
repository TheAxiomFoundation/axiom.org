/**
 * Modules a merge train or a side branch's PR carried to main for signed
 * PRs that hold only their manifest, on recorded rulespec-us payloads
 * (src/test/rulespec-merge-train-prs.json, no network): the promotion
 * lane's #2202-#2204 into candidate branches, closed when train #2205
 * merged; #2192 into #2045's branch; and #1347, a one-PR landing. Also the
 * citation a module merged outside the pipeline takes, and the status of a
 * provision two modules merged at once encode (#1112, us-nd 57-38-30.3).
 */
import { describe, expect, it } from "vitest";
import recorded from "@/test/rulespec-merge-train-prs.json";
import {
  buildAttempts,
  carrierIndex,
  carrierPrFor,
  containmentQueries,
  landedModulePaths,
  mainMerge,
  manifestModulePaths,
  moduleCitation,
  moduleSourceLookups,
  moduleSourceOf,
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
import {
  attemptStage,
  citationStates,
  mergeDetail,
  outsideAttemptId,
  statusAttempt,
  type PipelineAttempt,
} from "./encoding-pipeline";

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
const rawYaml = recorded.rawYaml as Record<string, string>;
/** A fresh copy of the recorded index rows: the collector sets each one's declared source. */
const mirrorRows = () => structuredClone(recorded.mirror) as MirrorRow[];
const mirrorRow = (jurisdiction: string, filePath: string) =>
  mirrorRows().find((row) => row.jurisdiction === jurisdiction && row.file_path === filePath)!;
/** What the collector's readModuleSources sets on a row from its YAML. */
const readSource = (row: MirrorRow) => {
  row.module_source = moduleSourceOf(rawYaml[`${row.repo}:${row.jurisdiction}/${row.file_path}`]);
  return row;
};

/** The collector's order: side branches, merged PRs, merge trains, outside modules (their sources read), then the rows. */
function collect(previous: Map<string, Partial<PipelineAttempt>> = new Map(), filesRead = true) {
  const mirror = mirrorRows();
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
  let outside = outsideModules(merged, previous, prs, mirror);
  const sourceRows = moduleSourceLookups(outside, mirror);
  if (sourceRows.length) {
    sourceRows.forEach(readSource);
    outside = outsideModules(merged, previous, prs, mirror);
  }
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
  return { prs, outside, attempts, mirror, sourceRows };
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
    const row = mirrorRow("us", "statutes/7/2015/f.yaml");
    expect(row.value_citation_paths).toHaveLength(2);
    expect(moduleCitation(row)).toBe("us/statute/7/2015/f");
    expect(moduleCitation({ citation_path: "us/statute/7/2015/f" })).toBe("us/statute/7/2015/f");
    expect(moduleCitation({ citation_path: "us/statute/7/2015/f", value_citation_paths: [] })).toBe("us/statute/7/2015/f");
    // Two grounding citations, the first not its own: still its own, even with that one as its source.
    expect(
      moduleCitation({
        citation_path: "us/policy/income_tax/x",
        value_citation_paths: ["us/statute/26/164", "us/statute/26/911"],
        module_source: "us/statute/26/164",
      })
    ).toBe("us/policy/income_tax/x");
  });
});

describe("the citation of a module merged outside the pipeline", () => {
  it("stays the exact provision when that sits under the module's source (26 USC 63(c), NC 105-153.5(a), (a1), (b), 7 CFR 273.11(c))", () => {
    for (const [jurisdiction, filePath, citation] of [
      ["us", "statutes/26/63/c.yaml", "us/statute/26/63/c"],
      ["us-nc", "statutes/105/105-153.5/a.yaml", "us-nc/statute/105/105-153.5/a"],
      ["us-nc", "statutes/105/105-153.5/a1.yaml", "us-nc/statute/105/105-153.5/a1"],
      ["us-nc", "statutes/105/105-153.5/b.yaml", "us-nc/statute/105/105-153.5/b"],
      ["us", "regulations/7-cfr/273/11/c.yaml", "us/regulation/7/273/11/c"],
    ]) {
      const row = mirrorRow(jurisdiction, filePath);
      // Its one grounding citation is the section above it, which is also its declared source.
      expect(row.value_citation_paths).toHaveLength(1);
      expect(citation.startsWith(`${row.value_citation_paths![0]}/`)).toBe(true);
      expect(moduleCitation({ ...row, module_source: row.value_citation_paths![0] })).toBe(citation);
      // No YAML read is needed for it.
      expect(moduleSourceLookups([{ pr: { repo: row.repo } as ManifestPr, path: `${jurisdiction}/${filePath}`, citation, citationFrom: "index" }], [row])).toEqual([]);
    }
  });

  it("stays the module's own for a legacy plural list of sources (salt_deduction_pipeline: six sections)", () => {
    const row = readSource(mirrorRow("us", "policies/income_tax/salt_deduction_pipeline.yaml"));
    expect(row.value_citation_paths).toEqual(["us/statute/26/164"]);
    expect(row.module_source).toBeNull();
    expect(moduleCitation(row)).toBe("us/policy/income_tax/salt_deduction_pipeline");
  });

  it("moves to the singular source only once that is read, and reads only rows whose citation depends on it", () => {
    const { mirror, sourceRows } = collect();
    // #2205's and #2045's modules are carried: only the candidates' rows (#2046-#2048) are read.
    expect(sourceRows.map((row) => row.file_path)).toEqual([
      "policies/des/faa5/na-medical-expenses-and-deduction/block-11.yaml",
      "policies/des/faa5/na-medical-expenses-and-deduction/block-12.yaml",
      "policies/des/faa5/na-medical-expenses-and-deduction/block-7.yaml",
    ]);
    const block7 = mirror.find((row) => row.file_path.endsWith("na-medical-expenses-and-deduction/block-7.yaml"))!;
    expect(block7.module_source).toBe("us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-7");
    expect(moduleCitation({ ...block7, module_source: undefined })).toBe(block7.citation_path);
    expect(moduleCitation({ ...block7, module_source: null })).toBe(block7.citation_path);
    expect(moduleSourceOf("not: [valid")).toBeNull();
    expect(moduleSourceOf(undefined)).toBeNull();
  });
});

describe("a provision two modules merged at once encode (#1112, us-nd 57-38-30.3)", () => {
  const [schedule, core] = recorded.ndAttempts as unknown as PipelineAttempt[];

  it("takes its status from the less advanced module, whichever order the rows come in", () => {
    expect(schedule.citation).toBe(core.citation);
    expect(schedule.finished_at).toBe(core.finished_at);
    expect(attemptStage(schedule)).toBe("verified");
    expect(core.tests_status).toBe("waived");
    expect(attemptStage(core)).toBe("indexed");
    for (const rows of [
      [schedule, core],
      [core, schedule],
    ]) {
      expect(statusAttempt(rows)?.id).toBe(core.id);
      expect(citationStates(rows)[0]).toMatchObject({ stage: "indexed", latest: { id: core.id } });
    }
    // A newer attempt still wins over an older, less advanced one.
    const later = {
      ...schedule,
      id: outsideAttemptId(REPO, 1113, "us-nd/policies/income_tax/2026_nd1es_estimated_schedule.yaml"),
      finished_at: "2026-08-01T00:00:00+00:00",
      pr_merged_at: "2026-08-01T00:00:00+00:00",
    };
    expect(statusAttempt([core, later])?.id).toBe(later.id);
  });
});

describe("what a carrier must hold", () => {
  const prs = () => recorded.manifestPrs.map(manifestPr);
  const merged = () => recorded.mergedPrs.map((node) => mergedPr(node));

  it("a train read this pass holds the signed manifest too, not only the module (#2046 holds block 7 unsigned)", () => {
    const pr = byPr(prs(), 2204);
    const candidateOnly = { ...pr, crossRefs: pr.crossRefs!.filter((ref) => ref.number === 2046) };
    expect(carrierPrFor(candidateOnly, carrierIndex(merged(), new Map()))).toBeNull();
    // Known from stored rows alone (modules only), the module is what can be checked.
    const stored = new Map<string, Partial<PipelineAttempt>>([
      [outsideAttemptId(REPO, 2046, `${MEDICAL}/block-7.yaml`), { id: outsideAttemptId(REPO, 2046, `${MEDICAL}/block-7.yaml`) }],
    ]);
    expect(carrierPrFor(candidateOnly, carrierIndex([], stored))?.number).toBe(2046);
    expect(carrierPrFor(pr, carrierIndex(merged(), new Map()))?.number).toBe(2205);
  });

  it("holds every module the closed PR's manifests name, not some", () => {
    const pr = byPr(prs(), 2204);
    const both = { ...pr, files: [...pr.files, ...byPr(prs(), 2202).files] };
    const partial = merged().map((m) =>
      m.number === 2205 ? { ...m, files: m.files!.filter((path) => path.includes("/block-7.")) } : m
    );
    expect(carrierPrFor(both, carrierIndex(partial, new Map()))).toBeNull();
    expect(carrierPrFor(both, carrierIndex(merged(), new Map()))?.number).toBe(2205);
    // From stored rows (modules only, no manifest to check): one of the two modules is not enough.
    const row = (path: string) => [outsideAttemptId(REPO, 2205, path), { id: outsideAttemptId(REPO, 2205, path) }] as const;
    const one = new Map<string, Partial<PipelineAttempt>>([row(`${MEDICAL}/block-7.yaml`)]);
    expect(carrierPrFor(both, carrierIndex([], one))).toBeNull();
    const two = new Map<string, Partial<PipelineAttempt>>([row(`${MEDICAL}/block-7.yaml`), row(`${MEDICAL}/block-11.yaml`)]);
    expect(carrierPrFor(both, carrierIndex([], two))?.number).toBe(2205);
  });
});

describe("modules a manifest-only PR landed", () => {
  it("decide the tests ancestry check: none while the index lacks the module", () => {
    const { prs, mirror } = collect();
    const pr = byPr(prs, 2204);
    const shard = { conclusion: "success" as const, headSha: "h1", runUrl: "u", completedAt: "2026-11-15T09:00:00Z" };
    const validation = new Map([[REPO, new Map([["us-az", shard]])]]);
    const toHead = (queries: Array<{ descendant: string }>) => queries.filter((query) => query.descendant === "h1");
    expect(toHead(containmentQueries([pr], mirror, validation))).toEqual([{ repo: REPO, ancestor: TRAIN_COMMIT, descendant: "h1" }]);
    const without = mirror.filter((row) => !row.file_path.endsWith("na-medical-expenses-and-deduction/block-7.yaml"));
    expect(toHead(containmentQueries([pr], without, validation))).toEqual([]);
  });

  it("are none while the PR that would carry it is still open", () => {
    const pr = byPr(recorded.manifestPrs.map(manifestPr), 2192);
    const open: BranchPr = { number: 2045, url: "u", state: "OPEN", isDraft: false, createdAt: pr.createdAt, mergedAt: null, mergeCommit: null };
    expect(landedModulePaths({ ...pr, via: open })).toEqual([]);
    expect(landedModulePaths({ ...pr, via: null })).toEqual([]);
    const [attempt] = buildAttempts({
      runs: runs.filter((run) => run.id === 43290017621),
      prs: [{ ...pr, via: open }],
      encoderRuns: [],
      mirror: mirrorRows(),
      compile: null,
      failureDetails: new Map(),
      previous: new Map(),
      nowMs: NOW,
    });
    expect(attempt).toMatchObject({ pr_via_number: 2045, pr_via_state: "open", module_paths: [] });
  });
});
