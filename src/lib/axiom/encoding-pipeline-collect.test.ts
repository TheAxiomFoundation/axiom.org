import { describe, expect, it } from "vitest";
import {
  activeWaivers,
  buildAttempts,
  conceptModuleKeys,
  containmentQueries,
  containsKey,
  oracleVerdicts,
  buildCompileIndex,
  buildMirrorIndex,
  errorRule,
  failureLookups,
  indexEncoderRows,
  jurisdictionOf,
  linkPrsToRuns,
  matchEncoderRun,
  oldestUnsyncedMerge,
  parseDiagnostics,
  parseRunTitle,
  prCitation,
  prRunId,
  rulespecModulePaths,
  truncateError,
  type CollectInputs,
  type EncoderRunRow,
  type ManifestPr,
  type MirrorRow,
  type ShardResult,
  type WorkflowRun,
} from "./encoding-pipeline-collect";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const CITATION = "us/regulation/42/457/800";

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 501,
    display_title: `Targeted signed RuleSpec re-encode [adhoc:adhoc:adhoc] ${CITATION}`,
    status: "completed",
    conclusion: "failure",
    created_at: "2026-09-29T18:00:00Z",
    run_started_at: "2026-09-29T18:00:10Z",
    updated_at: "2026-09-29T18:30:00Z",
    html_url: "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/501",
    run_attempt: 1,
    ...overrides,
  };
}

function encoderRow(overrides: Partial<EncoderRunRow> = {}): EncoderRunRow {
  return {
    id: "eab51e8d",
    timestamp: "2026-09-29T18:25:00Z",
    citation: CITATION,
    status: "apply_blocked_validation",
    apply_error: "regulations/42-cfr/457/800.yaml: ci: [complete-source-unit:structure] Source branch (a)",
    note: null,
    generation_attempt_count: 4,
    estimated_cost_usd: 0.13,
    ...overrides,
  };
}

function pr(overrides: Partial<ManifestPr> = {}): ManifestPr {
  return {
    repo: "rulespec-us",
    number: 1500,
    url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/1500",
    title: `Add signed encoding manifest for ${CITATION}`,
    body: "Axiom Encode run: https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/501\n",
    isDraft: true,
    state: "OPEN",
    createdAt: "2026-09-29T18:29:00Z",
    mergedAt: null,
    closedAt: null,
    baseRefName: "main",
    defaultBranch: "main",
    checks: "SUCCESS",
    reviewDecision: null,
    files: [
      ".axiom/encoding-manifests/us/regulations/42-cfr/457/800.json",
      "us/regulations/42-cfr/457/800.test.yaml",
      "us/regulations/42-cfr/457/800.yaml",
    ],
    ...overrides,
  };
}

function mirrorRow(overrides: Partial<MirrorRow> = {}): MirrorRow {
  return {
    repo: "rulespec-us",
    jurisdiction: "us",
    file_path: "regulations/42-cfr/457/800.yaml",
    citation_path: "us/regulation/42-cfr/457/800",
    synced_at: "2026-09-30T06:17:00Z",
    raw_yaml_sha256: "sha-now",
    ...overrides,
  };
}

function inputs(overrides: Partial<CollectInputs> = {}): CollectInputs {
  return {
    runs: [run()],
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

describe("parsing", () => {
  it("reads the queue tag and citation from a run name", () => {
    expect(parseRunTitle(run().display_title)).toEqual({ queueRef: "adhoc:adhoc:adhoc", citation: CITATION });
    expect(parseRunTitle("Targeted signed RuleSpec re-encode")).toBeNull();
  });

  it("reads a PR's citation and run", () => {
    expect(prCitation(pr().title)).toBe(CITATION);
    expect(prCitation("Add signed encoding manifest for ")).toBeNull();
    expect(prCitation("Bump engine pin")).toBeNull();
    expect(prRunId(pr().body)).toBe("501");
    expect(prRunId("Axiom Encode run: <https://github.com/o/r/actions/runs/77>")).toBe("77");
    expect(prRunId(null)).toBeNull();
  });

  it("reads validator rules without mistaking an index for one", () => {
    expect(errorRule(encoderRow().apply_error)).toBe("complete-source-unit:structure");
    expect(errorRule("[existing-target-oracle-contract] mismatch")).toBe("existing-target-oracle-contract");
    expect(errorRule("versions[0].formula is missing")).toBeNull();
    expect(errorRule("[source unit] plain words")).toBeNull();
    expect(errorRule(undefined)).toBeNull();
  });

  it("truncates long errors and drops blank ones", () => {
    expect(truncateError("  ")).toBeNull();
    expect(truncateError(null)).toBeNull();
    const long = truncateError("x".repeat(600))!;
    expect(long).toHaveLength(500);
    expect(long.endsWith("…")).toBe(true);
  });

  it("takes the jurisdiction from the citation's first segment", () => {
    expect(jurisdictionOf("us-az/manual/des/faa5")).toBe("us-az");
    expect(jurisdictionOf("Title 7/x")).toBeNull();
  });

  it("keeps RuleSpec modules, not tests or manifests", () => {
    expect(rulespecModulePaths(pr().files)).toEqual(["us/regulations/42-cfr/457/800.yaml"]);
    expect(rulespecModulePaths(["us/a/.hidden/b.yml", "us/b.yml", "README.md"])).toEqual(["us/b.yml"]);
  });

  it("reads a diagnostics bundle", () => {
    expect(
      parseDiagnostics(
        { failed_steps: ["encode_apply", 3], citation: CITATION },
        { issues: ["a.yaml: ci: [complete-source-unit:tests] Companion tests", 7] }
      )
    ).toEqual({
      source: "diagnostics",
      citation: CITATION,
      failed_step: "encode_apply",
      error: "a.yaml: ci: [complete-source-unit:tests] Companion tests",
      rule: "complete-source-unit:tests",
    });
    expect(parseDiagnostics(null, null)).toEqual({
      source: "diagnostics",
      citation: null,
      failed_step: null,
      error: null,
      rule: null,
    });
  });
});

describe("indexes", () => {
  it("finds index rows by either repo layout and tracks sync times", () => {
    const index = buildMirrorIndex([
      mirrorRow(),
      mirrorRow({ repo: "rulespec-ca", jurisdiction: "ca", file_path: "statutes/x.yaml", synced_at: "2026-09-30T00:17:00Z" }),
    ]);
    expect(index.byPath.get("rulespec-us:us/regulations/42-cfr/457/800.yaml")).toBeDefined();
    expect(index.byPath.get("rulespec-ca:statutes/x.yaml")).toBeDefined();
    expect(index.repoSyncedAt.get("rulespec-ca")).toBe("2026-09-30T00:17:00Z");
    expect(index.lastSyncedAt).toBe("2026-09-30T06:17:00Z");
    expect(buildCompileIndex(null).size).toBe(0);
  });

  it("matches the encoder record inside the run's window", () => {
    const index = indexEncoderRows([
      encoderRow({ id: "before", timestamp: "2026-09-29T17:00:00Z" }),
      encoderRow({ id: "early", timestamp: "2026-09-29T18:05:00Z" }),
      encoderRow({ id: "late", timestamp: "2026-09-29T18:35:00Z" }),
      encoderRow({ id: "no-citation", citation: null }),
    ]);
    expect(matchEncoderRun(run(), CITATION, index, NOW)?.id).toBe("late");
    expect(matchEncoderRun(run(), "other", index, NOW)).toBeNull();
    // A running dispatch's window stays open until now.
    const running = run({ status: "in_progress", run_started_at: null, updated_at: "2026-09-29T18:01:00Z" });
    const later = indexEncoderRows([encoderRow({ timestamp: "2026-09-30T11:00:00Z" })]);
    expect(matchEncoderRun(running, CITATION, later, NOW)).not.toBeNull();
  });

  it("prefers the record stamped with the run's id, and never borrows another run's", () => {
    const index = indexEncoderRows([
      encoderRow({ id: "window", timestamp: "2026-09-29T18:20:00Z" }),
      encoderRow({ id: "stamped", timestamp: "2026-09-29T18:10:00Z", github_run_id: "501" }),
      encoderRow({ id: "other-run", timestamp: "2026-09-29T18:25:00Z", github_run_id: "999" }),
    ]);
    expect(matchEncoderRun(run(), CITATION, index, NOW)?.id).toBe("stamped");
    expect(matchEncoderRun(run({ id: 502 }), CITATION, index, NOW)?.id).toBe("window");
  });
});

describe("linkPrsToRuns", () => {
  it("links by the body's run URL, then by citation and time, and keeps the rest as orphans", () => {
    const other = run({ id: 502, created_at: "2026-09-29T20:00:00Z", updated_at: "2026-09-29T20:30:00Z" });
    const { byRun, orphans } = linkPrsToRuns([run(), other], [
      pr(),
      pr({ number: 1501, body: "", createdAt: "2026-09-29T20:20:00Z" }),
      pr({ number: 1502, body: "", createdAt: "2026-01-01T00:00:00Z" }),
      pr({ number: 1503, body: "", title: "Unrelated" }),
    ]);
    expect(byRun.get("501")?.number).toBe(1500);
    expect(byRun.get("502")?.number).toBe(1501);
    expect(orphans.map((p) => p.number)).toEqual([1502, 1503]);
  });

  it("keeps the newer PR when two claim one run", () => {
    const { byRun, orphans } = linkPrsToRuns([run()], [
      pr({ number: 1, createdAt: "2026-09-29T18:10:00Z" }),
      pr({ number: 2, createdAt: "2026-09-29T18:20:00Z" }),
      pr({ number: 3, createdAt: "2026-09-29T18:15:00Z" }),
    ]);
    expect(byRun.get("501")?.number).toBe(2);
    expect(orphans.map((p) => p.number).sort()).toEqual([1, 3]);
  });

  it("ignores unnamed runs when linking by citation", () => {
    const { orphans } = linkPrsToRuns([run({ display_title: "Targeted signed RuleSpec re-encode" })], [pr({ body: "" })]);
    expect(orphans).toHaveLength(1);
  });
});

describe("buildAttempts", () => {
  it("records a failed dispatch with the encoder's reason", () => {
    const [attempt] = buildAttempts(inputs({ encoderRuns: [encoderRow()] }));
    expect(attempt).toMatchObject({
      id: "501",
      citation: CITATION,
      jurisdiction: "us",
      queue_ref: "adhoc:adhoc:adhoc",
      run_conclusion: "failure",
      encoder_run_id: "eab51e8d",
      encoder_status: "apply_blocked_validation",
      encoder_error_rule: "complete-source-unit:structure",
      failure_source: "encoder_run",
      generation_attempts: 4,
      cost_usd: 0.13,
      collected_at: "2026-09-30T12:00:00.000Z",
    });
  });

  it("uses the encoder's note when a failed status has no apply error", () => {
    const [attempt] = buildAttempts(
      inputs({ encoderRuns: [encoderRow({ apply_error: null, note: "status=apply_blocked_generation; [gen-rule:x] boom" })] })
    );
    expect(attempt.encoder_error_rule).toBe("gen-rule:x");
    const [applied] = buildAttempts(
      inputs({ runs: [run({ conclusion: "success" })], encoderRuns: [encoderRow({ status: "apply_applied", apply_error: null, note: "ok" })] })
    );
    expect(applied.failure_source).toBeNull();
    expect(applied.encoder_error).toBeNull();
  });

  it("falls back to a looked-up detail, then to the previous collection", () => {
    const detail = { source: "diagnostics" as const, failed_step: "encode_apply", error: "e", rule: "r-x" };
    const [fresh] = buildAttempts(inputs({ failureDetails: new Map([["501", detail]]) }));
    expect(fresh).toMatchObject({ failure_source: "diagnostics", failed_step: "encode_apply", encoder_error_rule: "r-x" });
    const [kept] = buildAttempts(
      inputs({ previous: new Map([["501", { failure_source: "jobs", failed_step: "Build / step" }]]) })
    );
    expect(kept).toMatchObject({ failure_source: "jobs", failed_step: "Build / step", encoder_error: null });
    const [none] = buildAttempts(inputs());
    expect(none.failure_source).toBeNull();
  });

  it("names an unnamed early run from its PR, its bundle, or the previous collection", () => {
    const unnamed = run({ display_title: "Targeted signed RuleSpec re-encode" });
    expect(buildAttempts(inputs({ runs: [unnamed], prs: [pr()] }))[0].citation).toBe(CITATION);
    expect(
      buildAttempts(inputs({ runs: [unnamed], failureDetails: new Map([["501", { source: "diagnostics", citation: "us/x", failed_step: null, error: null, rule: null }]]) }))[0]
        .citation
    ).toBe("us/x");
    expect(buildAttempts(inputs({ runs: [unnamed], previous: new Map([["501", { citation: "us/y" }]]) }))[0].citation).toBe("us/y");
    expect(buildAttempts(inputs({ runs: [unnamed] }))).toEqual([]);
  });

  it("records an in-progress run without a finish", () => {
    const [attempt] = buildAttempts(inputs({ runs: [run({ status: "in_progress", conclusion: null, run_started_at: undefined })] }));
    expect(attempt).toMatchObject({ run_status: "in_progress", finished_at: null, run_conclusion: null, started_at: null });
  });

  it("carries the PR's state, checks, review, and modules", () => {
    const [draft] = buildAttempts(inputs({ runs: [run({ conclusion: "success" })], prs: [pr()] }));
    expect(draft).toMatchObject({
      pr_state: "draft",
      pr_checks: "success",
      pr_review: "none",
      pr_targets_default: true,
      module_paths: ["us/regulations/42-cfr/457/800.yaml"],
      pr_closed_at: null,
    });
    const variants: Array<[Partial<ManifestPr>, Record<string, unknown>]> = [
      [{ isDraft: false, checks: "FAILURE", reviewDecision: "APPROVED" }, { pr_state: "open", pr_checks: "failure", pr_review: "approved" }],
      [{ checks: "ERROR", reviewDecision: "CHANGES_REQUESTED" }, { pr_checks: "failure", pr_review: "changes_requested" }],
      [{ checks: "PENDING", reviewDecision: "REVIEW_REQUIRED" }, { pr_checks: "pending", pr_review: "review_required" }],
      [{ checks: "EXPECTED" }, { pr_checks: "pending" }],
      [{ checks: null }, { pr_checks: "none" }],
      [{ state: "CLOSED", closedAt: "2026-09-30T00:00:00Z" }, { pr_state: "closed", pr_closed_at: "2026-09-30T00:00:00Z" }],
      [{ defaultBranch: null }, { pr_targets_default: null }],
    ];
    for (const [override, expected] of variants) {
      expect(buildAttempts(inputs({ prs: [pr(override)] }))[0]).toMatchObject(expected);
    }
  });

  const merged = (override: Partial<ManifestPr> = {}) =>
    pr({ state: "MERGED", isDraft: false, mergedAt: "2026-09-30T01:00:00Z", ...override });

  it("marks a merge off the default branch without looking at the index", () => {
    const [attempt] = buildAttempts(inputs({ prs: [merged({ baseRefName: "codex/x" })], mirror: [mirrorRow()] }));
    expect(attempt).toMatchObject({ pr_state: "merged", pr_targets_default: false, synced_at: null, index_status: null });
  });

  it("indexes a merge once a later sync shows every module", () => {
    const [attempt] = buildAttempts(inputs({ prs: [merged()], mirror: [mirrorRow()] }));
    expect(attempt).toMatchObject({ synced_at: "2026-09-30T06:17:00Z", index_status: "indexed", compile_status: null });
  });

  it("waits for a sync that has not run since the merge", () => {
    const [attempt] = buildAttempts(inputs({ prs: [merged({ mergedAt: "2026-09-30T08:00:00Z" })], mirror: [mirrorRow()] }));
    expect(attempt).toMatchObject({ synced_at: null, index_status: null });
  });

  it("flags modules a later sync left out, including a repo absent from the index", () => {
    const [missing] = buildAttempts(inputs({ prs: [merged()], mirror: [mirrorRow({ file_path: "other.yaml" })] }));
    expect(missing).toMatchObject({ synced_at: null, index_status: "missing" });
    const [absentRepo] = buildAttempts(inputs({ prs: [merged({ repo: "rulespec-de" })], mirror: [mirrorRow()] }));
    expect(absentRepo.index_status).toBe("missing");
  });

  it("keeps the first sync time from the previous collection", () => {
    const [attempt] = buildAttempts(
      inputs({ prs: [merged()], mirror: [mirrorRow()], previous: new Map([["501", { synced_at: "2026-09-30T02:17:00Z" }]]) })
    );
    expect(attempt.synced_at).toBe("2026-09-30T02:17:00Z");
  });

  it("indexes a merge that changed no module, with nothing to compile", () => {
    const [attempt] = buildAttempts(inputs({ prs: [merged({ files: ["README.md"] })], mirror: [mirrorRow()] }));
    expect(attempt).toMatchObject({ index_status: "indexed", compile_status: "skipped", compile_checked_at: null });
  });

  it("takes the compile sweep's verdict only for the module version in the index", () => {
    const sweep = (status: string, sha = "sha-now", error: string | null = null) => ({
      generated_at: "2026-09-30T07:41:00Z",
      rows: [{ repo: "rulespec-us", file_path: "regulations/42-cfr/457/800.yaml", citation_path: "us/regulation/42-cfr/457/800", raw_yaml_sha256: sha, status, error }],
    });
    const verdict = (compile: CollectInputs["compile"]) =>
      buildAttempts(inputs({ prs: [merged()], mirror: [mirrorRow()], compile }))[0];
    expect(verdict(sweep("ok"))).toMatchObject({ compile_status: "ok", compile_checked_at: "2026-09-30T07:41:00Z" });
    expect(verdict(sweep("compile_error", "sha-now", "unknown import"))).toMatchObject({
      compile_status: "compile_error",
      compile_error: "unknown import",
    });
    expect(verdict(sweep("skipped"))).toMatchObject({ compile_status: "skipped" });
    expect(verdict(sweep("ok", "sha-old"))).toMatchObject({ compile_status: null, compile_checked_at: null });
  });

  it("aggregates the verdict over several modules", () => {
    const rows = [
      mirrorRow(),
      mirrorRow({ file_path: "regulations/42-cfr/457/801.yaml", citation_path: "us/regulation/42-cfr/457/801" }),
    ];
    const files = ["us/regulations/42-cfr/457/800.yaml", "us/regulations/42-cfr/457/801.yaml"];
    const compile = {
      generated_at: "2026-09-30T07:41:00Z",
      rows: [
        { repo: "rulespec-us", file_path: "", citation_path: "us/regulation/42-cfr/457/800", raw_yaml_sha256: "sha-now", status: "skipped", error: null },
        { repo: "rulespec-us", file_path: "", citation_path: "us/regulation/42-cfr/457/801", raw_yaml_sha256: "sha-now", status: "ok", error: null },
      ],
    };
    expect(buildAttempts(inputs({ prs: [merged({ files })], mirror: rows, compile }))[0].compile_status).toBe("ok");
    const partial = { ...compile, rows: [compile.rows[1]] };
    expect(buildAttempts(inputs({ prs: [merged({ files })], mirror: rows, compile: partial }))[0].compile_status).toBeNull();
  });

  it("keeps a PR whose dispatch is gone as its own attempt", () => {
    const attempts = buildAttempts(inputs({ runs: [], prs: [pr({ body: "", createdAt: "2026-07-01T00:00:00Z" })] }));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ id: "pr:rulespec-us#1500", run_conclusion: "success", pr_state: "draft" });
    expect(buildAttempts(inputs({ runs: [], prs: [pr({ body: "", title: "Add signed encoding manifest for " })] }))).toEqual([]);
  });
});

describe("failureLookups", () => {
  it("picks failed runs no encoder record or earlier lookup explains, newest first", () => {
    const runs = [
      run({ id: 1, created_at: "2026-09-01T00:00:00Z", run_started_at: null, updated_at: "2026-09-01T00:30:00Z" }),
      run({ id: 2, created_at: "2026-09-02T00:00:00Z", run_started_at: null, updated_at: "2026-09-02T00:30:00Z" }),
      run({ id: 3, conclusion: "success" }),
      run({ id: 4, created_at: "2026-09-04T00:00:00Z", run_started_at: null, updated_at: "2026-09-04T00:30:00Z" }),
      run({ id: 5, display_title: "Targeted signed RuleSpec re-encode", created_at: "2026-09-05T00:00:00Z" }),
      run({ id: 6, status: "in_progress", conclusion: null }),
    ];
    const encoder = [encoderRow({ timestamp: "2026-09-04T00:20:00Z" })];
    const previous = new Map([["2", { failure_source: "jobs" }]]);
    expect(failureLookups(runs, encoder, previous, NOW, 10).map((r) => r.id)).toEqual([5, 1]);
    expect(failureLookups(runs, encoder, previous, NOW, 1).map((r) => r.id)).toEqual([5]);
  });
});

describe("oldestUnsyncedMerge", () => {
  it("finds the oldest default-branch merge still waiting for the index", () => {
    expect(
      oldestUnsyncedMerge(
        [
          mergedAttempt({ pr_merged_at: "2026-09-30T11:58:00Z" }),
          mergedAttempt({ pr_merged_at: "2026-09-30T10:00:00Z" }),
          mergedAttempt({ pr_merged_at: "2026-09-30T09:00:00Z" }),
          mergedAttempt({ pr_merged_at: "2026-09-30T08:00:00Z", synced_at: "2026-09-30T08:17:00Z" }),
          mergedAttempt({ pr_merged_at: "2026-09-29T00:00:00Z", pr_targets_default: false }),
          mergedAttempt({ pr_merged_at: "2026-09-29T00:00:00Z", index_status: "missing" }),
          mergedAttempt({ pr_merged_at: null }),
          pipelineAttempt(),
        ],
        NOW
      )
    ).toBe("2026-09-30T09:00:00Z");
    expect(oldestUnsyncedMerge([], NOW)).toBeNull();
  });
});

describe("stage joins", () => {
  const MERGE = "m1";
  const INDEX = "i1";
  const HEAD = "h1";
  const REPORT_SHA = "r1";
  const merged = (override: Partial<ManifestPr> = {}) =>
    pr({ state: "MERGED", isDraft: false, mergedAt: "2026-09-30T01:00:00Z", mergeCommit: MERGE, ...override });
  const shard = (conclusion: ShardResult["conclusion"], headSha = HEAD): ShardResult => ({
    conclusion,
    headSha,
    runUrl: "https://github.com/x/runs/1",
    completedAt: "2026-09-30T10:00:00Z",
  });
  const mirrorWithCommit = [mirrorRow({ commit_sha: INDEX })];
  const contains = (pairs: Array<[string, string, boolean]>) =>
    new Map(pairs.map(([a, d, v]) => [containsKey("rulespec-us", a, d), v]));

  it("carries a PR's failing checks, cancellations, reviewers, and merge commit", () => {
    const [attempt] = buildAttempts(
      inputs({
        prs: [pr({ failedChecks: ["validate / validate (us)"], cancelledChecks: 3, requestedReviewers: ["MaxGhenis"], mergeCommit: null })],
      })
    );
    expect(attempt).toMatchObject({
      pr_failed_checks: ["validate / validate (us)"],
      pr_cancelled_checks: 3,
      pr_requested_reviewers: ["MaxGhenis"],
      pr_merge_commit: null,
    });
    const [bare] = buildAttempts(inputs({ prs: [pr()] }));
    expect(bare).not.toHaveProperty("pr_failed_checks");
  });

  it("counts a sync only when the commit it read contains the merge", () => {
    const sync = (pairs: Array<[string, string, boolean]>) =>
      buildAttempts(inputs({ prs: [merged()], mirror: mirrorWithCommit, contains: contains(pairs) }))[0];
    expect(sync([[MERGE, INDEX, true]]).index_status).toBe("indexed");
    // Synced after the merge by the clock, but read an older commit.
    expect(sync([[MERGE, INDEX, false]])).toMatchObject({ synced_at: null, index_status: null });
    // Unknown ancestry falls back to the clock.
    expect(sync([]).index_status).toBe("indexed");
    expect(buildMirrorIndex(mirrorWithCommit).repoCommit.get("rulespec-us")).toBe(INDEX);
  });

  it("takes tests from the module's jurisdiction shard on a commit with the merge", () => {
    const tests = (
      shards: Array<[string, ShardResult]>,
      pairs: Array<[string, string, boolean]>,
      waivers?: Map<string, Set<string>>
    ) =>
      buildAttempts(
        inputs({
          prs: [merged()],
          mirror: mirrorWithCommit,
          contains: contains([[MERGE, INDEX, true], ...pairs]),
          validation: new Map([["rulespec-us", new Map(shards)]]),
          waivers,
        })
      )[0];
    expect(tests([["us", shard("success")]], [[MERGE, HEAD, true]])).toMatchObject({
      tests_status: "pass",
      tests_run_url: "https://github.com/x/runs/1",
      tests_checked_at: "2026-09-30T10:00:00Z",
    });
    expect(tests([["us", shard("failure")]], [[MERGE, HEAD, true]]).tests_status).toBe("fail");
    expect(tests([["us", shard("success")]], [[MERGE, HEAD, false]]).tests_status).toBeUndefined();
    // An unsharded repo's single validate job stands in; a sharded repo's aggregate never does.
    expect(tests([["", shard("success")]], [[MERGE, HEAD, true]]).tests_status).toBe("pass");
    expect(tests([["", shard("success")], ["us-az", shard("success")]], [[MERGE, HEAD, true]]).tests_status).toBeUndefined();
    const waived = new Map([["rulespec-us", new Set(["us/regulations/42-cfr/457/800.yaml"])]]);
    expect(tests([["us", shard("success")]], [[MERGE, HEAD, true]], waived).tests_status).toBe("waived");
  });

  it("keeps an oracle verdict current only if its report compared the merge", () => {
    const verdicts = oracleVerdicts([
      {
        name: "axiom-policyengine-us-x.json",
        report: {
          aggregates: [{ concept: "us:regulations/42-cfr/457/800#out", mismatch_count: 0 }],
          provenance: { generated_at: "2026-09-20T00:00:00Z", rulespecs: [{ sha: REPORT_SHA }] },
        },
      },
    ]);
    const oracle = (pairs: Array<[string, string, boolean]>, previous = new Map()) =>
      buildAttempts(
        inputs({
          prs: [merged()],
          mirror: mirrorWithCommit,
          contains: contains([[MERGE, INDEX, true], ...pairs]),
          oracle: pairs.length ? verdicts : undefined,
          previous,
        })
      )[0];
    expect(oracle([[MERGE, REPORT_SHA, true]])).toMatchObject({
      oracle_status: "match",
      oracle_engine: "policyengine",
      oracle_report: "axiom-policyengine-us-x.json",
      oracle_checked_at: "2026-09-20T00:00:00Z",
    });
    expect(oracle([[MERGE, REPORT_SHA, false]]).oracle_status).toBe("stale");
    // A report without a recorded commit (EUROMOD/UKMOD) is current when generated after the merge.
    const unpinned = (generatedAt: string) =>
      buildAttempts(
        inputs({
          prs: [merged()],
          mirror: mirrorWithCommit,
          contains: contains([[MERGE, INDEX, true]]),
          oracle: oracleVerdicts([
            {
              name: "axiom-euromod-uk-x.json",
              report: {
                aggregates: [{ concept: "us:regulations/42-cfr/457/800#out", mismatch_count: 0 }],
                provenance: { generated_at: generatedAt, rulespecs: [{}] },
              },
            },
          ]),
        })
      )[0];
    expect(unpinned("2026-09-30T02:00:00Z")).toMatchObject({ oracle_status: "match", oracle_engine: "euromod" });
    expect(unpinned("2026-09-29T00:00:00Z").oracle_status).toBe("stale");
    // Between refreshes the previous verdict stays.
    const kept = oracle([], new Map([["501", { oracle_status: "disagree" as const, oracle_engine: "taxsim" }]]));
    expect(kept).toMatchObject({ oracle_status: "disagree", oracle_engine: "taxsim", oracle_report: null });
    expect(oracle([]).oracle_status).toBeUndefined();
  });

  it("lists the ancestry checks the joins need", () => {
    const queries = containmentQueries(
      [
        merged(),
        merged({ number: 2, mergeCommit: null }),
        merged({ number: 3, baseRefName: "codex/x" }),
        pr({ number: 4 }),
      ],
      mirrorWithCommit,
      new Map([["rulespec-us", new Map([["us", shard("success")]])]]),
      oracleVerdicts([
        {
          name: "axiom-policyengine-us-x.json",
          report: {
            aggregates: [{ concept: "us:regulations/42-cfr/457/800#out" }],
            provenance: { rulespecs: [{ sha: REPORT_SHA }] },
          },
        },
      ])
    );
    expect(queries.map((q) => q.descendant).sort()).toEqual([HEAD, INDEX, REPORT_SHA]);
    expect(queries.every((q) => q.ancestor === MERGE)).toBe(true);
    expect(containmentQueries([merged({ title: "Unrelated" })], [], new Map())).toEqual([]);
  });
});

describe("waivers and oracle reports", () => {
  it("reads active validation waivers", () => {
    expect(
      [...activeWaivers({
        validate_failures: {
          "us/a.yaml": { active: { fingerprint: "x" } },
          "us/b.yaml": { pending: { fingerprint: "y" } },
          "us/c.yaml": null,
        },
      })]
    ).toEqual(["us/a.yaml"]);
    expect(activeWaivers(null).size).toBe(0);
    expect(activeWaivers({ validate_failures: "nope" }).size).toBe(0);
  });

  it("maps an oracle concept to its module in either repo layout", () => {
    expect(conceptModuleKeys("us-az:policies/des/faa5/x#out")).toEqual([
      "rulespec-us:us-az/policies/des/faa5/x.yaml",
      "rulespec-us:policies/des/faa5/x.yaml",
    ]);
    expect(conceptModuleKeys("ca:statutes/1")).toEqual(["rulespec-ca:ca/statutes/1.yaml", "rulespec-ca:statutes/1.yaml"]);
    expect(conceptModuleKeys("not a concept")).toEqual([]);
  });

  it("keeps each module's worst verdict across reports", () => {
    const verdicts = oracleVerdicts([
      {
        name: "axiom-policyengine-az-snap.json",
        report: {
          aggregates: [{ concept: "us:statutes/7/2014/u#snap_benefit" }, { concept: "us:statutes/7/2014/o#snap_eligible" }],
          summary: {
            mismatches_by_concept: [{ value: "us:statutes/7/2014/u#snap_benefit", count: 3 }, { value: "us:statutes/7/2015/f#x", count: 1 }],
            dispositioned: { counts: { axiom_encoding_gap: 0, unexplained: 0, upstream_engine_gap: 4 } },
          },
          provenance: { rulespecs: [{ sha: "a" }], generated_at: "G" },
        },
      },
      {
        name: "axiom-taxsim-us-tax.json",
        report: {
          aggregates: [{ concept: "us:statutes/7/2014/o#snap_eligible", mismatch_count: 2 }],
          summary: { dispositioned: { counts: { unexplained: 2 } } },
        },
      },
      { name: "weird.json", report: { aggregates: [{ concept: "us:statutes/9#x", mismatch_count: 1 }, {}] } },
    ]);
    expect(verdicts.get("rulespec-us:us/statutes/7/2014/u.yaml")).toMatchObject({ status: "explained", engine: "policyengine", rulespecSha: "a", generatedAt: "G" });
    expect(verdicts.get("rulespec-us:us/statutes/7/2014/o.yaml")).toMatchObject({ status: "disagree", engine: "taxsim", rulespecSha: null });
    expect(verdicts.get("rulespec-us:us/statutes/7/2015/f.yaml")?.status).toBe("explained");
    // No dispositions recorded: a mismatch is unexplained.
    expect(verdicts.get("rulespec-us:us/statutes/9.yaml")).toMatchObject({ status: "disagree", engine: "oracle" });
  });
});
