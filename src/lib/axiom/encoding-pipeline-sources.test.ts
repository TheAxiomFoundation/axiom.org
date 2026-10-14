/**
 * The rows beyond dispatches: modules merged outside the pipeline and
 * modules the encoder wrote inside another citation's run, as the collector
 * builds them.
 */
import { describe, expect, it } from "vitest";
import {
  buildAttempts,
  containedByTime,
  containmentQueries,
  containsKey,
  derivedCitation,
  encoderModulePath,
  indexEncoderRows,
  isModuleBucketPath,
  matchDependentHosts,
  matchEncoderRuns,
  OUTSIDE_SINCE,
  outsideFileLookups,
  outsideListingSince,
  outsideModules,
  type CollectInputs,
  type DependentMatch,
  type EncoderRunRow,
  type ManifestPr,
  type MergedPr,
  type MirrorRow,
  type ShardResult,
  type WorkflowRun,
} from "./encoding-pipeline-collect";
import { attemptSource, attemptStage, citationStates, outsideAttemptId, type PipelineAttempt } from "./encoding-pipeline";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const HOST = "us/statute/42/416/l";

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 501,
    display_title: `Targeted signed RuleSpec re-encode [adhoc:adhoc:adhoc] ${HOST}`,
    status: "completed",
    conclusion: "failure",
    created_at: "2026-09-29T18:00:00Z",
    run_started_at: "2026-09-29T18:00:10Z",
    updated_at: "2026-09-29T18:30:00Z",
    html_url: "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/501",
    run_attempt: 1,
    triggering_actor: "PavelMakarchuk",
    head_sha: "enc1",
    ...overrides,
  };
}

function record(overrides: Partial<EncoderRunRow> = {}): EncoderRunRow {
  return {
    id: "dep00001",
    timestamp: "2026-09-29T18:25:00Z",
    citation: "us/statute/42/402/q",
    status: "apply_blocked_validation",
    apply_error: "statutes/42/402/q.yaml: compile: Axiom rules engine compile failed: unknown field `values`",
    note: null,
    generation_attempt_count: 4,
    estimated_cost_usd: 0.4,
    file_path: "/home/runner/work/_temp/generated/dependent/openai-gpt-6-sol/statutes/42/402/q.yaml",
    encoder_version: "0.2.2037",
    ...overrides,
  };
}

function merged(overrides: Partial<MergedPr> = {}): MergedPr {
  return {
    repo: "rulespec-us",
    number: 900,
    url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/900",
    title: "Encode SNAP allotments",
    author: "MaxGhenis",
    createdAt: "2026-09-22T08:00:00Z",
    mergedAt: "2026-09-23T09:00:00Z",
    baseRefName: "main",
    defaultBranch: "main",
    mergeCommit: "m900",
    files: ["us/statutes/7/2017/a.yaml", "us/statutes/7/2017/a.test.yaml", ".axiom/encoding-manifests/x.json"],
    ...overrides,
  };
}

function mirrorRow(overrides: Partial<MirrorRow> = {}): MirrorRow {
  return {
    repo: "rulespec-us",
    jurisdiction: "us",
    file_path: "statutes/7/2017/a.yaml",
    citation_path: "us/statute/7/2017/a",
    synced_at: "2026-09-24T06:00:00Z",
    raw_yaml_sha256: "sha-a",
    ...overrides,
  };
}

function manifest(overrides: Partial<ManifestPr> = {}): ManifestPr {
  return {
    repo: "rulespec-us",
    number: 1500,
    url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/1500",
    title: `Add signed encoding manifest for ${HOST}`,
    body: "Axiom Encode run: https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/501\n",
    isDraft: false,
    state: "MERGED",
    createdAt: "2026-09-29T18:29:00Z",
    mergedAt: "2026-09-29T20:00:00Z",
    closedAt: null,
    baseRefName: "main",
    defaultBranch: "main",
    checks: "SUCCESS",
    reviewDecision: null,
    files: ["us/statutes/42/416/l.yaml", "us/statutes/42/402/q.yaml"],
    mergeCommit: "m1500",
    ...overrides,
  };
}

function inputs(overrides: Partial<CollectInputs> = {}): CollectInputs {
  return {
    runs: [],
    prs: [],
    encoderRuns: [],
    mirror: [],
    compile: null,
    failureDetails: new Map(),
    previous: new Map(),
    nowMs: NOW,
    ...overrides,
  };
}

describe("modules merged outside the pipeline", () => {
  it("derives a citation from a module's path when the index does not hold it", () => {
    expect(derivedCitation("rulespec-us", "us-az/statutes/46/292.yaml")).toBe("us-az/statute/46/292");
    expect(derivedCitation("rulespec-us", "us/regulations/7-cfr/273/10.yaml")).toBe("us/regulation/7/273/10");
    expect(derivedCitation("rulespec-ca", "policies/cra/benefits-2026/x.yaml")).toBe("ca/policy/cra/benefits-2026/x");
    expect(derivedCitation("rulespec-uk", "uk/programs/universal-credit/fy-2026-27.yaml")).toBe(
      "uk/programs/universal-credit/fy-2026-27"
    );
    // A root directory of jurisdiction directories (rulespec-us programs/) reads as that jurisdiction's.
    expect(derivedCitation("rulespec-us", "programs/us-fl/snap/fy-2026.yaml")).toBe("us-fl/programs/snap/fy-2026");
  });

  it("makes a module of every merge into the default branch that no dispatch stands for", () => {
    const viaBranch = manifest({
      number: 1501,
      baseRefName: "encode/side",
      files: ["us/statutes/7/2015/f.yaml"],
      via: {
        number: 910,
        url: "u",
        state: "MERGED",
        isDraft: false,
        createdAt: "2026-09-25T00:00:00Z",
        mergedAt: "2026-09-26T00:00:00Z",
        mergeCommit: "m910",
      },
    });
    const stored: Partial<PipelineAttempt> = {
      id: outsideAttemptId("rulespec-uk", 12, "uk/statutes/ssa/1992/4/124.yaml"),
      citation: "uk/statute/ssa/1992/4/124",
      run_url: "https://github.com/TheAxiomFoundation/rulespec-uk/pull/12",
      pr_url: "https://github.com/TheAxiomFoundation/rulespec-uk/pull/12",
      dispatched_at: "2026-08-01T00:00:00Z",
      finished_at: "2026-08-02T00:00:00Z",
      pr_created_at: "2026-08-01T00:00:00Z",
      pr_merged_at: "2026-08-02T00:00:00Z",
      pr_merge_commit: "m12",
      pr_base_branch: "main",
      dispatched_by: "PavelMakarchuk",
    };
    const modules = outsideModules(
      [
        merged(),
        // A dispatch's own manifest PR.
        merged({ number: 1500, files: ["us/statutes/42/416/l.yaml"] }),
        // Merged into a side branch, not the default one.
        merged({ number: 902, baseRefName: "encode/side", files: ["us/statutes/9/1.yaml"] }),
        // The side branch's own PR: the dispatch's module is the dispatch's, the other one is outside.
        merged({ number: 910, files: ["us/statutes/7/2015/f.yaml", "us-az/statutes/46/292.yaml"], mergedAt: "2026-09-26T00:00:00Z" }),
        // Listed without its files and never stored: nothing to build from yet.
        merged({ number: 903, files: undefined }),
        // Before the first day collected.
        merged({ number: 1, mergedAt: "2026-07-01T00:00:00Z", files: ["us/statutes/1.yaml"] }),
      ],
      new Map([[stored.id!, stored]]),
      [manifest(), viaBranch],
      [mirrorRow()]
    );
    expect(modules.map((m) => [m.pr.repo, m.pr.number, m.path, m.citation, m.citationFrom])).toEqual([
      // Carried from its stored row: merged before this pass's listing.
      ["rulespec-uk", 12, "uk/statutes/ssa/1992/4/124.yaml", "uk/statute/ssa/1992/4/124", "stored"],
      ["rulespec-us", 900, "us/statutes/7/2017/a.yaml", "us/statute/7/2017/a", "index"],
      ["rulespec-us", 910, "us-az/statutes/46/292.yaml", "us-az/statute/46/292", "path"],
    ]);
    const [uk, us] = modules;
    expect(us.pr).toMatchObject({ state: "MERGED", files: ["us/statutes/7/2017/a.yaml"], jurisdiction: "us", author: "MaxGhenis" });
    expect(uk.pr).toMatchObject({ mergedAt: "2026-08-02T00:00:00Z", mergeCommit: "m12", author: "PavelMakarchuk" });
  });

  it("reads files only of new PRs, and lists from a day before the last pass", () => {
    const stored = { id: outsideAttemptId("rulespec-us", 900, "us/statutes/7/2017/a.yaml"), collected_at: "2026-09-30T11:30:00Z" };
    const previous = new Map([[stored.id, stored]]);
    const listed = [
      merged({ files: undefined }),
      merged({ number: 901, files: undefined }),
      merged({ number: 1500, files: undefined }),
      merged({ number: 902, files: undefined, baseRefName: "encode/side" }),
    ];
    expect(outsideFileLookups(listed, previous, [manifest()]).map((pr) => pr.number)).toEqual([901]);
    // A stored PR's modules are its rows.
    expect(outsideModules([merged({ files: undefined })], previous, [], []).map((m) => m.path)).toEqual(["us/statutes/7/2017/a.yaml"]);
    expect(outsideListingSince(new Map())).toBe(OUTSIDE_SINCE);
    expect(outsideListingSince(previous)).toBe("2026-09-29T11:30:00.000Z");
    expect(outsideListingSince(new Map([["x", { ...stored, collected_at: "2026-07-22T06:00:00Z" }]]))).toBe(OUTSIDE_SINCE);
  });

  it("follows a module merged outside the pipeline through the index and its tests on main", () => {
    const [module] = outsideModules([merged()], new Map(), [], [mirrorRow({ commit_sha: "i1" })]);
    const shard: ShardResult = {
      conclusion: "success",
      headSha: "h1",
      runUrl: "https://github.com/x/runs/9",
      completedAt: "2026-09-29T00:00:00Z",
      // Made on main's own line well after the merge: it holds it, no compare needed.
      headAt: "2026-09-28T23:00:00Z",
      headFirstParent: true,
    };
    const [row] = buildAttempts(
      inputs({
        outside: [module],
        mirror: [mirrorRow({ commit_sha: "i1" })],
        contains: new Map([[containsKey("rulespec-us", "m900", "i1"), true]]),
        validation: new Map([["rulespec-us", new Map([["us", shard]])]]),
      })
    );
    expect(row).toMatchObject({
      id: "pr:rulespec-us#900:us/statutes/7/2017/a.yaml",
      citation: "us/statute/7/2017/a",
      jurisdiction: "us",
      queue_ref: "outside",
      run_url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/900",
      dispatched_at: "2026-09-22T08:00:00Z",
      finished_at: "2026-09-23T09:00:00Z",
      run_status: "completed",
      run_conclusion: "success",
      dispatched_by: "MaxGhenis",
      pr_repo: "rulespec-us",
      pr_number: 900,
      pr_state: "merged",
      pr_targets_default: true,
      pr_merge_commit: "m900",
      module_paths: ["us/statutes/7/2017/a.yaml"],
      index_status: "indexed",
      synced_at: "2026-09-24T06:00:00Z",
      tests_status: "pass",
      tests_run_url: "https://github.com/x/runs/9",
    });
    expect(attemptSource(row)).toBe("outside");
    expect(attemptStage(row)).toBe("verified");
    expect(citationStates([row])[0]).toMatchObject({ stage: "verified", dispatches: 0 });
  });

  it("times a merge's first sync only from a listing of syncs that reaches back to it", () => {
    const [module] = outsideModules([merged()], new Map(), [], [mirrorRow()]);
    const syncRuns = [{ created_at: "2026-09-29T00:00:00Z", updated_at: "2026-09-29T00:20:00Z" }];
    const build = (syncSince: string | null) => buildAttempts(inputs({ outside: [module], mirror: [mirrorRow()], syncRuns, syncSince }))[0];
    // Listed from after the merge: the first sync after it may be missing, so none is recorded.
    expect(build("2026-09-28T00:00:00Z")).not.toHaveProperty("indexed_at");
    expect(build("2026-09-23T09:00:00Z").indexed_at).toBe("2026-09-29T00:20:00Z");
  });
});

describe("modules encoded inside another citation's run", () => {
  const index = (rows: EncoderRunRow[]) => indexEncoderRows(rows);
  const hosts = (runs: WorkflowRun[], rows: EncoderRunRow[], versions: Record<string, string> = {}): DependentMatch[] => {
    const candidates = runs.map((r) => ({
      run: r,
      citation: r.display_title.split(" ").at(-1)!,
      version: versions[String(r.id)] ?? null,
    }));
    return matchDependentHosts(candidates, rows, matchEncoderRuns(candidates, index(rows), NOW), NOW);
  };
  const own = record({ id: "own00001", citation: HOST, timestamp: "2026-09-29T18:10:00Z", file_path: null, encoder_version: null });

  it("finds the run by its encode window among the same repo's runs, and never takes a run's own record", () => {
    const matches = hosts([run()], [own, record(), record({ id: "own00002", citation: HOST, timestamp: "2026-09-29T18:12:00Z" })]);
    // The run keeps its newest own record; the older one is not a dependent.
    expect(matches.map((m) => [m.record.id, m.hostId, m.by, m.ambiguous])).toEqual([["dep00001", "501", "window", false]]);
    // Another repo's citation is never another repo's run's module.
    expect(hosts([run()], [record({ citation: "de/statute/bgb/187" })])).toEqual([]);
    // Just after the window ends, within the clock slack.
    expect(hosts([run()], [record({ timestamp: "2026-09-29T18:35:00Z" })]).map((m) => m.by)).toEqual(["slack"]);
    expect(hosts([run()], [record({ timestamp: "2026-09-29T19:00:00Z" })])).toEqual([]);
    // A record stamped with its run goes to that run.
    expect(hosts([run()], [record({ github_run_id: "501", timestamp: "2026-09-30T00:00:00Z" })]).map((m) => m.by)).toEqual(["stamp"]);
  });

  it("picks among overlapping runs by the encoder version, then by which citation hosts the module elsewhere", () => {
    const other = run({
      id: 502,
      display_title: "Targeted signed RuleSpec re-encode [adhoc:adhoc:adhoc] us/regulation/7/273/4",
      created_at: "2026-09-29T18:05:00Z",
      run_started_at: "2026-09-29T18:05:00Z",
      updated_at: "2026-09-29T18:40:00Z",
      html_url: "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/502",
    });
    const byVersion = hosts([run(), other], [record()], { "501": "0.2.2037", "502": "0.2.2038" });
    expect(byVersion.map((m) => [m.hostId, m.ambiguous])).toEqual([["501", false]]);
    // Same version: the module's other, clear runs say it belongs with 42/416/l.
    const earlier = run({
      id: 400,
      created_at: "2026-09-28T10:00:00Z",
      run_started_at: "2026-09-28T10:00:00Z",
      updated_at: "2026-09-28T10:30:00Z",
    });
    const history = hosts([earlier, run(), other], [record({ id: "dep00000", timestamp: "2026-09-28T10:20:00Z" }), record()]);
    expect(history.map((m) => [m.record.id, m.hostId, m.ambiguous])).toEqual([
      ["dep00000", "400", false],
      ["dep00001", "501", true],
    ]);
    // With nothing else to go by, the run that started last.
    expect(hosts([run(), other], [record()]).map((m) => m.hostId)).toEqual(["502"]);
  });

  it("builds a row on its run, with the run's PR when that PR carries the module", () => {
    const rows = buildAttempts(
      inputs({
        runs: [run()],
        prs: [manifest()],
        encoderRuns: [own, record(), record({ id: "dep00002", citation: "us/statute/42/401", timestamp: "2026-09-29T18:26:00Z", status: "apply_applied", apply_error: null, file_path: "/home/runner/work/_temp/generated/source-01/openai-gpt-6-sol/statutes/42/401.yaml" })],
        mirror: [
          mirrorRow({ file_path: "statutes/42/402/q.yaml", citation_path: "us/statute/42/402/q", synced_at: "2026-09-30T06:00:00Z" }),
        ],
      })
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("501")).toMatchObject({ encoder_run_id: "own00001", pr_number: 1500 });
    expect(byId.get("dep:dep00001")).toMatchObject({
      citation: "us/statute/42/402/q",
      queue_ref: "dependent:501",
      run_url: "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/501",
      dispatched_at: "2026-09-29T18:25:00.000Z",
      run_status: "completed",
      run_conclusion: "failure",
      encoder_status: "apply_blocked_validation",
      encoder_error_rule: null,
      failure_source: "encoder_run",
      generation_attempts: 4,
      cost_usd: 0.4,
      dispatched_by: "PavelMakarchuk",
      // The run's PR carries this module: its stages are the PR's, for this module.
      pr_number: 1500,
      pr_state: "merged",
      module_paths: ["us/statutes/42/402/q.yaml"],
      index_status: "indexed",
    });
    // Applied in the run, but the run's PR does not carry it.
    expect(byId.get("dep:dep00002")).toMatchObject({ run_conclusion: "success", pr_number: null, module_paths: [] });
    expect(attemptStage(byId.get("dep:dep00002")!)).toBe("no_pr");
    expect(encoderModulePath(record().file_path)).toBe("statutes/42/402/q.yaml");
    expect(encoderModulePath(null)).toBeNull();
  });
});

describe("ancestry checks", () => {
  const mergedAt = "2026-09-30T01:00:00Z";

  it("decides by time when the head was made well after the merge on main's own line, or before it", () => {
    expect(containedByTime(mergedAt, { headAt: "2026-09-30T02:00:00Z", headFirstParent: true })).toBe(true);
    expect(containedByTime(mergedAt, { headAt: "2026-09-30T02:00:00Z", headFirstParent: false })).toBeUndefined();
    expect(containedByTime(mergedAt, { headAt: "2026-09-30T01:05:00Z", headFirstParent: true })).toBeUndefined();
    expect(containedByTime(mergedAt, { headAt: "2026-09-30T00:30:00Z", headFirstParent: false })).toBe(false);
    expect(containedByTime(mergedAt, {})).toBeUndefined();
  });

  it("asks only what nothing cheaper decides", () => {
    const pr = manifest({ mergedAt });
    const shard = (headAt: string | null): Map<string, Map<string, ShardResult>> =>
      new Map([["rulespec-us", new Map([["us", { conclusion: "success", headSha: "h1", runUrl: "r", completedAt: "c", headAt, headFirstParent: true }]])]]);
    const mirror = [
      mirrorRow({ file_path: "statutes/42/416/l.yaml", commit_sha: "i1" }),
      mirrorRow({ file_path: "statutes/42/402/q.yaml", commit_sha: "i1" }),
    ];
    const pairs = (queries: Array<{ descendant: string }>) => queries.map((q) => q.descendant).sort();
    expect(pairs(containmentQueries([pr], mirror, shard(null)))).toEqual(["h1", "i1"]);
    // The head was made long after the merge: no compare for it.
    expect(pairs(containmentQueries([pr], mirror, shard("2026-09-30T06:00:00Z")))).toEqual(["i1"]);
    // Every row of the PR has its first sync: the index commit no longer matters.
    const synced = new Map([["501", { pr_repo: "rulespec-us", pr_number: 1500, synced_at: "S" }]]);
    expect(pairs(containmentQueries([pr], mirror, shard(null), new Map(), synced))).toEqual(["h1"]);
    // A module the index does not hold never reaches its tests.
    expect(pairs(containmentQueries([pr], mirror.slice(0, 1), shard(null)))).toEqual(["i1"]);
  });
});

describe("isModuleBucketPath", () => {
  it("keeps modules in bucket folders and leaves out compose specs, worklists, tests and data", () => {
    expect(
      [
        "us/statutes/7/2015/f.yaml",
        "us-co/regulations/10-ccr-2506-1/4.130.yaml",
        "uk-leeds/policies/council-tax-reduction.yaml",
        "statutes/42/416/l.yaml",
        "policies/cra/td1-2026/credits.yaml",
        "us/manual/snap/fns-300.yaml",
        // Not encodings: rulespec-us compose specs, worklists, a test folder, data.
        "programs/us-ak/tanf/fy-2026.yaml",
        "uk/programs/universal-credit.yaml",
        "bulk/worklist.yaml",
        "uk/bulk/worklist.yaml",
        "tests/layout.yaml",
        "data/sources.yaml",
      ].filter(isModuleBucketPath)
    ).toEqual([
      "us/statutes/7/2015/f.yaml",
      "us-co/regulations/10-ccr-2506-1/4.130.yaml",
      "uk-leeds/policies/council-tax-reduction.yaml",
      "statutes/42/416/l.yaml",
      "policies/cra/td1-2026/credits.yaml",
      "us/manual/snap/fns-300.yaml",
    ]);
  });
});
