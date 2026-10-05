import { describe, expect, it } from "vitest";
import {
  activeWaivers,
  buildAttempts,
  conceptModuleKeys,
  containmentQueries,
  containsKey,
  firstSyncAfter,
  jobPhases,
  mergeValidationKey,
  mergeValidationLookups,
  syncWindowStart,
  oracleVerdicts,
  parseRunJobs,
  runDetailLookups,
  buildCompileIndex,
  buildMirrorIndex,
  checkErrorFromLog,
  checkErrorLookups,
  needsLogRead,
  parseVersion,
  versionLookups,
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
    const previous = new Map([["2", { failure_source: "log" }]]);
    expect(failureLookups(runs, encoder, previous, NOW, 10).map((r) => r.id)).toEqual([5, 1]);
    expect(failureLookups(runs, encoder, previous, NOW, 1).map((r) => r.id)).toEqual([5]);
  });

  it("looks up each citation's latest failure first and never a cancelled run", () => {
    const at = (day: string) => ({ created_at: `2026-09-${day}T00:00:00Z`, run_started_at: null, updated_at: `2026-09-${day}T00:30:00Z` });
    const titled = (citation: string) => `Targeted signed RuleSpec re-encode [adhoc:adhoc:adhoc] ${citation}`;
    const runs = [
      run({ id: 10, display_title: titled("us/a"), ...at("20") }),
      run({ id: 11, display_title: titled("us/a"), ...at("25") }),
      run({ id: 12, display_title: titled("us/b"), ...at("02") }),
      run({ id: 13, display_title: titled("us/c"), ...at("26"), conclusion: "cancelled" }),
      run({ id: 14, display_title: "Targeted signed RuleSpec re-encode", ...at("27") }),
    ];
    // us/b's only run is old but latest for its citation; us/a's older run waits.
    expect(failureLookups(runs, [], new Map(), NOW, 10).map((r) => r.id)).toEqual([11, 12, 14, 10]);
    // An unnamed run named by an earlier collection counts as that citation's.
    const named = new Map([["14", { citation: "us/d" }]]);
    expect(failureLookups(runs, [], named, NOW, 10).map((r) => r.id)).toEqual([14, 11, 12, 10]);
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

  it("times the merge's first index sync from the sync runs, keeping a stored one", () => {
    const syncs = [
      { created_at: "2026-09-30T00:30:00Z", updated_at: "2026-09-30T00:40:00Z" },
      { created_at: "2026-09-30T06:00:00Z", updated_at: "2026-09-30T06:17:00Z" },
      { created_at: "2026-09-30T02:00:00Z", updated_at: "2026-09-30T02:12:00Z" },
    ];
    expect(firstSyncAfter(syncs, "2026-09-30T01:00:00Z")).toBe("2026-09-30T02:12:00Z");
    expect(firstSyncAfter(syncs, "2026-09-30T07:00:00Z")).toBeNull();
    // Sync runs are listed from the oldest indexed (or recent) merge with no first sync recorded.
    const prs = [
      merged({ number: 1, mergedAt: "2026-09-01T00:00:00Z" }),
      merged({ number: 2, mergedAt: "2026-09-02T00:00:00Z" }),
      merged({ number: 3, mergedAt: "2026-08-01T00:00:00Z", baseRefName: "codex/x" }),
      merged({ number: 4, mergedAt: "2026-09-28T00:00:00Z" }),
      merged({ number: 5, mergedAt: "2026-08-15T00:00:00Z" }),
    ];
    const previous = new Map([
      ["a", { pr_repo: "rulespec-us", pr_number: 1, synced_at: "S", indexed_at: "I" }],
      ["b", { pr_repo: "rulespec-us", pr_number: 2, synced_at: "S" }],
    ]);
    expect(syncWindowStart(prs, previous, NOW)).toBe("2026-09-02T00:00:00Z");
    // Never indexed and not recent (number 5): it does not hold the window open.
    expect(syncWindowStart(prs, new Map(), NOW)).toBe("2026-09-28T00:00:00Z");
    expect(syncWindowStart([pr()], new Map(), NOW)).toBeNull();
    const build = (override: Partial<CollectInputs>) =>
      buildAttempts(inputs({ prs: [merged()], mirror: [mirrorRow()], ...override }))[0];
    expect(build({ syncRuns: syncs })).toMatchObject({ synced_at: "2026-09-30T06:17:00Z", indexed_at: "2026-09-30T02:12:00Z" });
    expect(build({ syncRuns: syncs, previous: new Map([["501", { synced_at: "S", indexed_at: "I" }]]) }).indexed_at).toBe("I");
    // No sync runs read: nothing to time it by.
    expect(build({})).not.toHaveProperty("indexed_at");
    // Not indexed: no first sync either.
    expect(build({ syncRuns: syncs, mirror: [] })).not.toHaveProperty("indexed_at");
  });

  it("records the merge's first tests on main from its merge commit's shard: start, end, and result", () => {
    const shardRun = (completedAt: string, conclusion: "success" | "failure" = "success", startedAt: string | null = "2026-09-30T01:05:00Z") => ({
      startedAt,
      completedAt,
      conclusion,
    });
    const atMerge = (shards: Array<[string, ReturnType<typeof shardRun>]>) =>
      new Map([[mergeValidationKey("rulespec-us", MERGE), new Map(shards)]]);
    const build = (override: Partial<CollectInputs>) => buildAttempts(inputs({ prs: [merged()], ...override }))[0];
    expect(build({ mergeValidation: atMerge([["us", shardRun("2026-09-30T01:20:00Z")], ["us-az", shardRun("X")]]) })).toMatchObject({
      tests_first_at: "2026-09-30T01:20:00Z",
      tests_first_started_at: "2026-09-30T01:05:00Z",
      tests_first_status: "pass",
    });
    expect(build({ mergeValidation: atMerge([["", shardRun("2026-09-30T01:25:00Z", "failure", null)]]) })).toMatchObject({
      tests_first_at: "2026-09-30T01:25:00Z",
      tests_first_started_at: null,
      tests_first_status: "fail",
    });
    // A sharded repo whose shard for the module did not finish at the merge.
    expect(build({ mergeValidation: atMerge([["", shardRun("A")], ["us-az", shardRun("X")]]) })).not.toHaveProperty("tests_first_at");
    // A full record is kept; one from before the start and result were kept waits for them.
    expect(build({ previous: new Map([["501", { tests_first_at: "T", tests_first_started_at: "S", tests_first_status: "fail" as const }]]) }))
      .toMatchObject({ tests_first_at: "T", tests_first_started_at: "S", tests_first_status: "fail" });
    const early = build({ previous: new Map([["501", { tests_first_at: "T" }]]) });
    expect(early.tests_first_at).toBe("T");
    expect(early).not.toHaveProperty("tests_first_status");
    expect(buildAttempts(inputs({ prs: [merged({ baseRefName: "codex/x" })], mergeValidation: atMerge([["us", shardRun("Y")]]) }))[0])
      .not.toHaveProperty("tests_first_at");
  });

  it("looks up each default-branch merge's own validation until it is recorded, newest first", () => {
    const prs = [
      merged({ number: 1, mergeCommit: "a", mergedAt: "2026-09-01T00:00:00Z" }),
      merged({ number: 2, mergeCommit: "b", mergedAt: "2026-09-03T00:00:00Z" }),
      merged({ number: 3, mergeCommit: "c", mergedAt: "2026-09-02T00:00:00Z" }),
      merged({ number: 4, mergeCommit: "d", baseRefName: "codex/x" }),
      merged({ number: 5, mergeCommit: null }),
      pr({ number: 6 }),
    ];
    const previous = new Map([["7", { pr_repo: "rulespec-us", pr_merge_commit: "c", tests_first_at: "T" }]]);
    expect(mergeValidationLookups(prs, previous, 10)).toEqual([
      { repo: "rulespec-us", commit: "b" },
      { repo: "rulespec-us", commit: "a" },
    ]);
    expect(mergeValidationLookups(prs, previous, 1)).toHaveLength(1);
    // Once start and result are kept, a merge recorded without them is read once more.
    expect(mergeValidationLookups(prs, previous, 10, { detail: true }).map((l) => l.commit)).toEqual(["b", "c", "a"]);
    const full = new Map([["7", { pr_repo: "rulespec-us", pr_merge_commit: "c", tests_first_at: "T", tests_first_status: "pass" as const }]]);
    expect(mergeValidationLookups(prs, full, 10, { detail: true }).map((l) => l.commit)).toEqual(["b", "a"]);
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
    // A re-emission is stale however recent its stamp or commit.
    const reemitted = buildAttempts(
      inputs({
        prs: [merged()],
        mirror: mirrorWithCommit,
        contains: contains([[MERGE, INDEX, true], [MERGE, REPORT_SHA, true]]),
        oracle: oracleVerdicts([
          {
            name: "axiom-euromod-uk-x.json",
            report: {
              aggregates: [{ concept: "us:regulations/42-cfr/457/800#out", mismatch_count: 0 }],
              provenance: { generated_at: "2026-09-30T02:00:00Z", rulespecs: [{ sha: REPORT_SHA }], reemitted_report: true },
            },
          },
        ]),
      })
    )[0];
    expect(reemitted.oracle_status).toBe("stale");
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
    expect(verdicts.get("rulespec-us:us/statutes/9.yaml")?.reemitted).toBe(false);
  });

  it("prefers a real run over a re-emission, whatever their verdicts", () => {
    const report = (name: string, mismatch: number, reemitted: boolean) => ({
      name,
      report: {
        aggregates: [{ concept: "us:statutes/1#x", mismatch_count: mismatch }],
        provenance: { reemitted_report: reemitted },
      },
    });
    const key = "rulespec-us:us/statutes/1.yaml";
    expect(oracleVerdicts([report("axiom-a-real.json", 0, false), report("axiom-b-re.json", 5, true)]).get(key))
      .toMatchObject({ report: "axiom-a-real.json", status: "match" });
    expect(oracleVerdicts([report("axiom-b-re.json", 5, true), report("axiom-a-real.json", 0, false)]).get(key))
      .toMatchObject({ report: "axiom-a-real.json", status: "match" });
  });
});

describe("run details", () => {
  const encodeJob = (steps: Array<{ conclusion: string | null; started_at?: string }>) => ({
    name: "Queue protected signed RuleSpec re-encode",
    steps,
  });
  const budget = { name: "Enforce failed-attempt budget", steps: [{ conclusion: "success", started_at: "2026-09-30T00:00:10Z" }] };

  it("reads when encoding started and how far a cancelled run got", () => {
    const none = { setup: null, encode: null, publish: null };
    expect(parseRunJobs([budget, encodeJob([{ conclusion: "success", started_at: "2026-09-30T01:00:00Z" }, { conclusion: "skipped" }])], "success"))
      .toMatchObject({ encodeStartedAt: "2026-09-30T01:00:00Z", cancelStage: null });
    expect(parseRunJobs([budget, encodeJob([])], "cancelled")).toEqual({ encodeStartedAt: null, cancelStage: "approval", phases: none });
    expect(parseRunJobs([budget, encodeJob([{ conclusion: "cancelled", started_at: "2026-09-30T01:00:00Z" }])], "cancelled"))
      .toMatchObject({ encodeStartedAt: "2026-09-30T01:00:00Z", cancelStage: "running" });
    expect(parseRunJobs([budget], "cancelled")).toEqual({ encodeStartedAt: null, cancelStage: "before_job", phases: none });
    expect(parseRunJobs([{ name: "build", steps: null }], "failure")).toEqual({ encodeStartedAt: null, cancelStage: null, phases: none });
  });

  it("splits the encode job into setup, the encode step, and publishing", () => {
    const step = (name: string, from: string, to: string, conclusion = "success") => ({
      name,
      conclusion,
      started_at: `2026-10-01T21:${from}Z`,
      completed_at: `2026-10-01T21:${to}Z`,
    });
    const setup = [step("Set up job", "20:27", "20:29"), step("Checkout axiom-corpus", "20:50", "27:08")];
    const encode = step("Encode, review, validate, and apply", "29:04", "50:19");
    const publish = [
      step("Summarize model spend", "50:19", "50:19"),
      step("Verify generated provenance", "50:19", "50:37"),
      step("Push lane branch and open draft pull request", "50:48", "50:52"),
      step("Package failed re-encode diagnostics", "50:52", "50:52", "skipped"),
      step("Post Checkout axiom-corpus", "50:58", "50:59"),
      step("Complete job", "50:59", "51:30"),
    ];
    expect(jobPhases([...setup, encode, ...publish])).toEqual({ setup: 517, encode: 1275, publish: 33 });
    // A failed encode step: its failure bundle is not publishing.
    expect(
      jobPhases([
        ...setup,
        { ...encode, conclusion: "failure" },
        step("Package failed re-encode diagnostics", "50:20", "50:40"),
        step("Upload failed re-encode diagnostics", "50:40", "50:45"),
      ])
    ).toEqual({ setup: 517, encode: 1275, publish: null });
    // Stopped in setup: the time it ran, and nothing after.
    expect(jobPhases([step("Set up job", "20:27", "20:29"), step("Verify immutable checkout identities", "20:29", "20:31", "failure")]))
      .toEqual({ setup: 4, encode: null, publish: null });
    expect(jobPhases([{ name: "Set up job", conclusion: "skipped" }])).toEqual({ setup: null, encode: null, publish: null });
  });

  it("reads each finished run's jobs once, cancelled runs first", () => {
    const runs = [
      run({ id: 1, conclusion: "success", created_at: "2026-09-29T00:00:00Z" }),
      run({ id: 2, conclusion: "cancelled", created_at: "2026-09-01T00:00:00Z" }),
      run({ id: 3, conclusion: "failure", created_at: "2026-09-30T00:00:00Z" }),
      run({ id: 4, status: "waiting", conclusion: null }),
      run({ id: 5, conclusion: "cancelled" }),
    ];
    const previous = new Map([["5", { jobs_checked_at: "2026-09-30T00:00:00Z" }]]);
    expect(runDetailLookups(runs, previous, 10).map((r) => r.id)).toEqual([2, 3, 1]);
    expect(runDetailLookups(runs, previous, 1).map((r) => r.id)).toEqual([2]);
    // Once step times are recorded, runs read before them are read once more, last.
    expect(runDetailLookups(runs, previous, 10, { steps: true }).map((r) => r.id)).toEqual([2, 3, 1, 5]);
    const stepsRead = new Map([["5", { jobs_checked_at: "T", steps_read_at: "T" }]]);
    expect(runDetailLookups(runs, stepsRead, 10, { steps: true }).map((r) => r.id)).toEqual([2, 3, 1]);
    // An early run named after no citation is read only once a collection has stored it.
    const unnamed = run({ id: 6, conclusion: "cancelled", display_title: "Targeted signed RuleSpec re-encode" });
    expect(runDetailLookups([unnamed, ...runs], previous, 10).map((r) => r.id)).toEqual([2, 3, 1]);
    expect(runDetailLookups([unnamed], new Map([["6", { citation: "us/x" }]]), 10).map((r) => r.id)).toEqual([6]);
  });

  it("records the dispatcher and run detail, fresh or carried from the previous collection", () => {
    const [fresh] = buildAttempts(
      inputs({
        runs: [run({ conclusion: "cancelled", triggering_actor: "PavelMakarchuk" })],
        runDetails: new Map([
          ["501", { encodeStartedAt: null, cancelStage: "approval" as const, phases: { setup: 240, encode: 600, publish: null } }],
        ]),
      })
    );
    expect(fresh).toMatchObject({
      dispatched_by: "PavelMakarchuk",
      cancel_stage: "approval",
      encode_started_at: null,
      jobs_checked_at: "2026-09-30T12:00:00.000Z",
      setup_seconds: 240,
      encode_seconds: 600,
      publish_seconds: null,
      steps_read_at: "2026-09-30T12:00:00.000Z",
    });
    const [carried] = buildAttempts(
      inputs({
        previous: new Map([
          ["501", { jobs_checked_at: "T", cancel_stage: "running" as const, encode_started_at: "S", steps_read_at: "T", setup_seconds: 5, encode_seconds: 6, publish_seconds: 7 }],
        ]),
      })
    );
    expect(carried).toMatchObject({
      cancel_stage: "running",
      encode_started_at: "S",
      jobs_checked_at: "T",
      dispatched_by: null,
      setup_seconds: 5,
      encode_seconds: 6,
      publish_seconds: 7,
      steps_read_at: "T",
    });
    // Read before step times were recorded: none to carry.
    const [early] = buildAttempts(inputs({ previous: new Map([["501", { jobs_checked_at: "T" }]]) }));
    expect(early).not.toHaveProperty("steps_read_at");
    const [unread] = buildAttempts(inputs());
    expect(unread).not.toHaveProperty("jobs_checked_at");
  });
});

describe("encoder versions", () => {
  it("records the encoder commit and its version, reading each commit once", () => {
    const previous = new Map([["400", { encoder_sha: "aaa", encoder_version: "0.2.2079" }]]);
    const runs = [run({ id: 501, head_sha: "aaa" }), run({ id: 502, head_sha: "bbb" }), run({ id: 503 })];
    expect(versionLookups(runs, previous)).toEqual(["bbb"]);
    const attempts = buildAttempts(
      inputs({ runs, previous, encoderVersions: new Map([["bbb", "0.2.2080"]]) })
    );
    expect(attempts.map((a) => [a.id, a.encoder_sha, a.encoder_version])).toEqual([
      ["501", "aaa", "0.2.2079"],
      ["502", "bbb", "0.2.2080"],
      ["503", undefined, undefined],
    ]);
    // A run listing without the commit keeps the stored one.
    const kept = buildAttempts(
      inputs({ runs: [run({ id: 400 })], previous, encoderVersions: new Map() })
    );
    expect(kept[0]).toMatchObject({ encoder_sha: "aaa", encoder_version: "0.2.2079" });
    const unknown = buildAttempts(inputs({ runs: [run({ id: 504, head_sha: "ccc" })] }));
    expect(unknown[0]).toMatchObject({ encoder_sha: "ccc", encoder_version: null });
  });

  it("reads the package version from pyproject.toml", () => {
    expect(parseVersion('[project]\nname = "axiom-encode"\nversion = "0.2.2080"\n')).toBe("0.2.2080");
    expect(parseVersion("[project]\nname = \"x\"")).toBeNull();
  });
});

describe("PR check errors", () => {
  const log = (...lines: string[]) =>
    lines.map((line, i) => `2026-08-31T11:10:${String(i).padStart(2, "0")}.0000000Z ${line}`).join("\n");

  it("quotes an explicit error annotation", () => {
    expect(
      checkErrorFromLog(log("##[group]Run tests", "##[endgroup]", "##[error]\u001b[31mschema check failed: bad field\u001b[0m", "##[error]Process completed with exit code 1."))
    ).toBe("schema check failed: bad field");
  });

  it("otherwise quotes what the failing step printed before Actions' exit line", () => {
    expect(
      checkErrorFromLog(
        log(
          "##[group]Run set -euo pipefail",
          "  CARGO_HOME: /home/runner/.cargo",
          "##[endgroup]",
          "Manual RuleSpec changes are not allowed.",
          "- a/b.json validation_execution.axiom_encode does not match the running pinned encoder",
          "",
          "##[error]Process completed with exit code 1."
        )
      )
    ).toBe(
      "Manual RuleSpec changes are not allowed. - a/b.json validation_execution.axiom_encode does not match the running pinned encoder"
    );
    const long = log("##[endgroup]", "one", "two", "three", "four", "five: the cause", "##[error]Process completed with exit code 2.");
    expect(checkErrorFromLog(long)).toBe("four five: the cause");
    expect(checkErrorFromLog(log("##[endgroup]", "x".repeat(500), "##[error]Process completed with exit code 1."))).toHaveLength(400);
  });

  it("names a cancelled job, a step that printed nothing, and a log with no failure", () => {
    expect(checkErrorFromLog(log("##[error]The operation was canceled."))).toBe(
      "Cancelled before it finished (a timeout or a newer run)"
    );
    expect(checkErrorFromLog(log("##[endgroup]", "##[error]Process completed with exit code 3."))).toBe(
      "Process completed with exit code 3."
    );
    expect(checkErrorFromLog(log("all good"))).toBeNull();
  });

  it("reads each open PR's first failing job once, newest PR first", () => {
    const failing = (number: number, id: number, createdAt: string, state: ManifestPr["state"] = "OPEN") =>
      pr({ number, createdAt, state, failedJobs: [{ name: "validate / validate (dk)", id }] });
    const previous = new Map([
      ["x", { pr_check_job_id: 10, pr_check_error: "read before" }],
      ["y", { pr_check_job_id: 11, pr_check_error: null }],
    ]);
    const prs = [
      failing(1, 10, "2026-09-01T00:00:00Z"),
      failing(2, 11, "2026-09-02T00:00:00Z"),
      failing(3, 12, "2026-09-03T00:00:00Z"),
      failing(4, 12, "2026-09-04T00:00:00Z"),
      failing(5, 13, "2026-09-05T00:00:00Z", "MERGED"),
      pr({ number: 6, failedJobs: [] }),
      pr({ number: 7 }),
    ];
    expect(checkErrorLookups(prs, previous, 10)).toEqual([
      { repo: "rulespec-us", jobId: 12 },
      { repo: "rulespec-us", jobId: 11 },
    ]);
    expect(checkErrorLookups(prs, previous, 1)).toHaveLength(1);
  });

  it("stores the error with its job, keeps it while the job is the same, and clears it once the PR is done", () => {
    const failingPr = pr({ failedJobs: [{ name: "validate / validate (us)", id: 77 }] });
    const read = buildAttempts(
      inputs({ prs: [failingPr], checkErrors: new Map([["77", "schema is invalid"]]) })
    );
    expect(read[0]).toMatchObject({ pr_check_job_id: 77, pr_check_error: "schema is invalid" });
    const previous = new Map([["501", { pr_check_job_id: 77, pr_check_error: "schema is invalid" }]]);
    expect(buildAttempts(inputs({ prs: [failingPr], previous }))[0]).toMatchObject({
      pr_check_error: "schema is invalid",
    });
    const rerun = pr({ failedJobs: [{ name: "validate / validate (us)", id: 78 }] });
    expect(buildAttempts(inputs({ prs: [rerun], previous }))[0]).toMatchObject({
      pr_check_job_id: 78,
      pr_check_error: null,
    });
    const merged = pr({ state: "MERGED", mergedAt: "2026-09-30T00:00:00Z", failedJobs: [{ name: "x", id: 79 }] });
    expect(buildAttempts(inputs({ prs: [merged] }))[0]).toMatchObject({ pr_check_job_id: null, pr_check_error: null });
    expect(buildAttempts(inputs({ prs: [pr()] }))[0]).not.toHaveProperty("pr_check_job_id");
  });
});

describe("causes from the failing job's log", () => {
  const log = (...lines: string[]) => lines.map((line) => `2026-09-29T18:04:19.0000000Z ${line}`).join("\n");

  it("quotes the exception a traceback ends in, not the shutdown lines after it", () => {
    expect(
      checkErrorFromLog(
        log(
          "##[endgroup]",
          "Traceback (most recent call last):",
          '  File "x.py", line 1, in <module>',
          "axiom_encode.corpus_resolver.InvalidActiveCorpusSourceError: Active corpus source 'us-ok/statute/68-2355' is repealed",
          "axiom-apply-signer event=shutdown scope=apply_ed25519 signatures=0",
          "##[error]Process completed with exit code 1."
        )
      )
    ).toBe(
      "axiom_encode.corpus_resolver.InvalidActiveCorpusSourceError: Active corpus source 'us-ok/statute/68-2355' is repealed"
    );
  });

  it("re-reads a failure its bundle explained only by the step", () => {
    expect(needsLogRead({ failure_source: "diagnostics", failed_step: "encode_apply" })).toBe(true);
    expect(needsLogRead({ failure_source: "jobs", failed_step: "x / y" })).toBe(true);
    expect(needsLogRead({ failure_source: "diagnostics", encoder_error_rule: "complete-source-unit:tests" })).toBe(false);
    expect(needsLogRead({ failure_source: "diagnostics", encoder_error: "a.yaml: ci: [x-y] z" })).toBe(false);
    expect(needsLogRead({ failure_source: "log", failed_step: "encode_apply" })).toBe(false);
    expect(needsLogRead({ failure_source: "encoder_run" })).toBe(false);
    const previous = new Map([
      ["501", { citation: CITATION, failure_source: "diagnostics", failed_step: "encode_apply" }],
      ["502", { citation: CITATION, failure_source: "log", failed_step: "encode_apply" }],
    ]);
    const runs = [run({ id: 501 }), run({ id: 502, created_at: "2026-09-29T19:00:00Z" })];
    expect(failureLookups(runs, [], previous, NOW, 10).map((r) => r.id)).toEqual([501]);
  });

  it("stores a cause read from the log, and keeps it", () => {
    const detail = {
      source: "log" as const,
      failed_step: "encode_apply",
      error: "ValueError: No local corpus source text found for 'us-ga/x'",
      rule: null,
    };
    const [attempt] = buildAttempts(inputs({ failureDetails: new Map([["501", detail]]) }));
    expect(attempt).toMatchObject({
      failure_source: "log",
      failed_step: "encode_apply",
      encoder_error: "ValueError: No local corpus source text found for 'us-ga/x'",
      encoder_error_rule: null,
    });
    const [kept] = buildAttempts(inputs({ previous: new Map([["501", attempt]]) }));
    expect(kept).toMatchObject({ failure_source: "log", encoder_error: attempt.encoder_error });
  });
});
