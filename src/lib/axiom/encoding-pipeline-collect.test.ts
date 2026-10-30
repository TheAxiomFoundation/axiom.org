import { describe, expect, it } from "vitest";
import {
  activeWaivers,
  bookkeepingCause,
  buildAttempts,
  encodeWindow,
  mainMerge,
  matchEncoderRuns,
  sideBranchLookups,
  viaPrFor,
  type BranchPr,
  type RunDetail,
  conceptModuleKeys,
  containmentQueries,
  containsKey,
  encoderLoop,
  encoderTries,
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
  needsStepRead,
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
import { attemptStage, citationStates, pipelineItem } from "./encoding-pipeline";
import { runRow, runTimeline } from "./encoding-pipeline-runs";

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
    const long = truncateError("x".repeat(1200))!;
    expect(long).toHaveLength(1000);
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

  it("leaves out the repo-root ledgers a PR also touches", () => {
    // rulespec-us#1470 and rulespec-ca#21 changed these with their modules;
    // the index never carries them, so they read as missing from it.
    expect(
      rulespecModulePaths([
        "known-validation-gaps.yaml",
        "known-missing-money-atoms.yaml",
        "oracle-coverage-pending.yaml",
        "us/policies/usda/snap/fy-2024-cola/income-eligibility-standards.yaml",
        "policies/cra/td1-2026/provincial-territorial-personal-credits.yaml",
      ])
    ).toEqual([
      "policies/cra/td1-2026/provincial-territorial-personal-credits.yaml",
      "us/policies/usda/snap/fy-2024-cola/income-eligibility-standards.yaml",
    ]);
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
    const previous = new Map([["2", { failure_source: "log", failed_step: "job / Verify immutable checkout identities" }]]);
    expect(failureLookups(runs, encoder, previous, NOW, 10).map((r) => r.id)).toEqual([5, 1]);
    expect(failureLookups(runs, encoder, previous, NOW, 1).map((r) => r.id)).toEqual([5]);
    // A failure its log explains without the step it failed in is read again, for the step.
    const stepless = new Map([["2", { failure_source: "log", encoder_error: "jq: error: syntax error" }]]);
    expect(needsStepRead(stepless.get("2")!)).toBe(true);
    expect(failureLookups(runs, encoder, stepless, NOW, 10).map((r) => r.id)).toEqual([5, 2, 1]);
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
    // From encoder 0.2.2218 the lanes run the encode loop after the encode step.
    expect(
      jobPhases([
        ...setup,
        step("Encode, review, validate, and apply", "29:04", "29:12"),
        step("Apply prepared signature 1", "29:12", "41:10"),
        step("Apply prepared signature 2", "41:10", "41:10", "skipped"),
        step("Verify generated provenance", "41:10", "41:30"),
        step("Push lane branch and open draft pull request", "41:40", "41:44"),
      ])
    ).toEqual({ setup: 517, encode: 726, publish: 34 });
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
    expect(checkErrorFromLog(log("##[endgroup]", "x".repeat(1500), "##[error]Process completed with exit code 1."))).toHaveLength(1000);
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

describe("encoder tries", () => {
  it("keeps each try's model, time, cost, outcome, and first error from the encoder's record", () => {
    const iterations = [
      {
        attempt: 1,
        model: "gpt-6-luna",
        success: false,
        duration_ms: 18226,
        estimated_cost_usd: 0.0096,
        errors: [{ message: "statutes/42/402/q.yaml: ci: Embedded scalar literal: 5", error_type: "validation" }],
      },
      { attempt: 2, model: "gpt-6-sol", success: true, duration_ms: 41164, estimated_cost_usd: 0.25, errors: [] },
      "not a try",
    ];
    expect(encoderTries(encoderRow({ iterations }))).toEqual([
      { attempt: 1, model: "gpt-6-luna", ms: 18226, cost: 0.0096, ok: false, error: "statutes/42/402/q.yaml: ci: Embedded scalar literal: 5" },
      { attempt: 2, model: "gpt-6-sol", ms: 41164, cost: 0.25, ok: true, error: null },
    ]);
    expect(encoderTries(encoderRow({ iterations: null }))).toBeNull();
    expect(encoderTries(encoderRow({ iterations: [] }))).toBeNull();
    // A record with no attempt numbers counts its tries in order.
    expect(encoderTries(encoderRow({ iterations: [{ model: "m" }] }))?.[0]).toMatchObject({ attempt: 1, ms: null, ok: false });
  });

  it("puts the matched encoder record's tries on the attempt", () => {
    const [attempt] = buildAttempts(
      inputs({ encoderRuns: [encoderRow({ iterations: [{ attempt: 1, model: "m", duration_ms: 5 }] })] })
    );
    expect(attempt.tries).toEqual([{ attempt: 1, model: "m", ms: 5, cost: null, ok: false, error: null }]);
    // Written as null, so a run that loses a wrongly joined record loses its tries too.
    const [unmatched] = buildAttempts(inputs());
    expect(unmatched.tries).toBeNull();
  });

  it("keeps a timed try's start, whole time, and phases, with a check phase's time by tool", () => {
    const iterations = [
      {
        attempt: 1,
        model: "m",
        duration_ms: 40_000,
        started_at: "2026-10-07T15:21:07.200Z",
        finished_at: "2026-10-07T15:23:47.200Z",
        wall_duration_ms: 160_000,
        phases: [
          { name: "prepare", started_at: "2026-10-07T15:21:07.200Z", duration_ms: 5_000 },
          { name: "model_call", duration_ms: 40_000 },
          {
            name: "candidate_validation",
            duration_ms: 100_000,
            breakdown_ms: { ci_test_cases: 70_000, rules_engine_compile: 20_000, other: 10_000, broken: "x" },
          },
          { name: "retry_handoff", duration_ms: 15_000 },
          { duration_ms: 3 },
        ],
      },
    ];
    expect(encoderTries(encoderRow({ iterations }))).toEqual([
      {
        attempt: 1,
        model: "m",
        ms: 40_000,
        cost: null,
        ok: false,
        error: null,
        startedAt: "2026-10-07T15:21:07.200Z",
        wallMs: 160_000,
        phases: [
          { name: "prepare", ms: 5_000 },
          { name: "model_call", ms: 40_000 },
          { name: "candidate_validation", ms: 100_000, tools: { ci_test_cases: 70_000, rules_engine_compile: 20_000, other: 10_000 } },
          { name: "retry_handoff", ms: 15_000 },
        ],
      },
    ]);
    // A try without its start or whole time keeps the model time only, as older records do.
    const untimed = encoderTries(encoderRow({ iterations: [{ ...iterations[0], started_at: undefined }] }));
    expect(untimed?.[0]).not.toHaveProperty("phases");
  });

  it("reads the encoder record's loop clock, and none from an older record", () => {
    const loop_timing = {
      schema: "axiom-encode/encode-loop-timing/v1",
      started_at: "2026-10-07T15:20:00.000Z",
      finished_at: "2026-10-07T15:23:20.000Z",
      wall_duration_ms: 200_000,
      setup_ms: 20_000,
      tries_ms: 160_000,
      between_tries_ms: 0,
      finalize_ms: 20_000,
      try_count: 1,
    };
    expect(encoderLoop(encoderRow({ loop_timing }))).toEqual({
      startedAt: "2026-10-07T15:20:00.000Z",
      wallMs: 200_000,
      setupMs: 20_000,
      triesMs: 160_000,
      betweenMs: 0,
      finalizeMs: 20_000,
    });
    expect(encoderLoop(encoderRow())).toBeNull();
    expect(encoderLoop(encoderRow({ loop_timing: { setup_ms: 1 } }))).toBeNull();
    const [attempt] = buildAttempts(inputs({ encoderRuns: [encoderRow({ loop_timing })] }));
    expect(attempt.encode_loop).toMatchObject({ wallMs: 200_000, setupMs: 20_000 });
    const [older] = buildAttempts(inputs({ encoderRuns: [encoderRow()] }));
    expect(older.encode_loop).toBeNull();
  });
});

describe("encoder records join one run each", () => {
  // Two dispatches of one citation that overlap, each with its encode step read.
  const first = run({ id: 601 });
  const second = run({
    id: 602,
    created_at: "2026-09-29T18:20:00Z",
    run_started_at: "2026-09-29T18:20:05Z",
    updated_at: "2026-09-29T18:50:00Z",
  });
  const steps = (encodeStartedAt: string, setup: number, encode: number | null) => ({
    jobs_checked_at: "R",
    steps_read_at: "R",
    encode_started_at: encodeStartedAt,
    setup_seconds: setup,
    encode_seconds: encode,
    cancel_stage: null,
  });
  // Encode steps 18:04-18:24 and 18:25-18:45.
  const known = new Map([
    ["601", steps("2026-09-29T18:02:00Z", 120, 1200)],
    ["602", steps("2026-09-29T18:22:00Z", 180, 1200)],
  ]);

  it("gives each record to the run whose encode step holds it, never to two", () => {
    const records = [
      encoderRow({ id: "a", timestamp: "2026-09-29T18:23:00Z" }),
      encoderRow({ id: "b", timestamp: "2026-09-29T18:38:00Z" }),
    ];
    const matched = matchEncoderRuns(
      [first, second].map((r) => ({ run: r, citation: CITATION, known: known.get(String(r.id)) })),
      indexEncoderRows(records),
      NOW
    );
    // By the runs' windows and slack alone, "b" fell inside both.
    expect([matched.get("601")?.id, matched.get("602")?.id]).toEqual(["a", "b"]);
    const attempts = buildAttempts(inputs({ runs: [first, second], encoderRuns: records, previous: known }));
    expect(attempts.map((a) => a.encoder_run_id)).toEqual(["a", "b"]);
  });

  it("gives none to a run whose encode step never ran", () => {
    const index = indexEncoderRows([encoderRow({ timestamp: "2026-09-29T18:20:00Z" })]);
    const one = (k?: Parameters<typeof encodeWindow>[1]) =>
      matchEncoderRuns([{ run: run(), citation: CITATION, known: k }], index, NOW).get("501")?.id ?? null;
    // Jobs not read yet: the run's own window.
    expect(one()).toBe("eab51e8d");
    expect(one({ cancel_stage: "approval" })).toBeNull();
    expect(one({ cancel_stage: "before_job" })).toBeNull();
    // The encode job ran no step, or stopped in setup before the encode step.
    expect(one({ jobs_checked_at: "R", encode_started_at: null })).toBeNull();
    expect(one(steps("2026-09-29T18:01:00Z", 150, null))).toBeNull();
    expect(encodeWindow(run(), steps("2026-09-29T18:01:00Z", 60, 600), NOW)).toEqual({
      start: Date.parse("2026-09-29T18:02:00Z"),
      end: Date.parse("2026-09-29T18:12:00Z"),
    });
  });

  it("else gives it to the run that ended last before it, within the clock slack", () => {
    const one = (timestamp: string) =>
      matchEncoderRuns(
        [{ run: first, citation: CITATION, known: known.get("601") }],
        indexEncoderRows([encoderRow({ timestamp })]),
        NOW
      ).get("601")?.id ?? null;
    expect(one("2026-09-29T18:30:00Z")).toBe("eab51e8d");
    expect(one("2026-09-29T18:40:00Z")).toBeNull();
    // Before its encode step started: an earlier run's.
    expect(one("2026-09-29T18:03:00Z")).toBeNull();
  });

  it("drops a record an earlier pass joined to a run that never encoded, with its tries, cost, and cause", () => {
    const cancelled = run({ conclusion: "cancelled" });
    const stale = { failure_source: "encoder_run", encoder_error: "old", encoder_error_rule: "x-y" };
    const atApproval = new Map([
      ["501", { jobs_checked_at: "R", cancel_stage: "approval" as const, encode_started_at: null, ...stale }],
    ]);
    const records = [encoderRow({ iterations: [{ attempt: 1, model: "m" }] })];
    expect(buildAttempts(inputs({ runs: [cancelled], encoderRuns: records, previous: atApproval }))[0]).toMatchObject({
      cancel_stage: "approval",
      encoder_run_id: null,
      generation_attempts: null,
      cost_usd: null,
      tries: null,
      failure_source: null,
      encoder_error: null,
    });
    // A run that failed in setup: its stale cause is not carried, and its failure is looked up again.
    const inSetup = new Map([["501", { ...steps("2026-09-29T18:01:00Z", 150, null), ...stale }]]);
    expect(buildAttempts(inputs({ encoderRuns: records, previous: inSetup }))[0]).toMatchObject({
      encoder_run_id: null,
      failure_source: null,
      encoder_error: null,
    });
    expect(failureLookups([run()], records, inSetup, NOW, 10).map((r) => r.id)).toEqual([501]);
    // The jobs read this pass decide too.
    const setupFailure: RunDetail = {
      encodeStartedAt: "2026-09-29T18:01:00Z",
      cancelStage: null,
      phases: { setup: 150, encode: null, publish: null },
    };
    expect(failureLookups([run()], records, new Map(), NOW, 10).map((r) => r.id)).toEqual([]);
    expect(
      failureLookups([run()], records, new Map(), NOW, 10, new Map([["501", setupFailure]])).map((r) => r.id)
    ).toEqual([501]);
  });
});

describe("causes from the encoder's log", () => {
  const encoderLog = (...lines: string[]) =>
    [
      "##[group]Run set -euo pipefail",
      "  CARGO_HOME: /home/runner/.cargo",
      "##[endgroup]",
      ...lines,
      "##[error]Process completed with exit code 1.",
    ]
      .map((line) => `2026-09-02T10:59:06.7130890Z ${line}`)
      .join("\n");
  const result = (...lines: string[]) => [
    "Output root: /home/runner/work/_temp/generated/target",
    "Corpus release: us-rulespec-2026-08-08-obbb-alien-snap (0d69a0cd)",
    "Runner: openai:gpt-5.6-terra",
    "Mode: repo-augmented",
    "",
    "us/regulation/7/273/4 [openai-gpt-5.6-terra]",
    "  standalone_success=False duration_ms=31071 cost_est=$0.2721",
    "  tokens in=205203 out=2162 cache_read=91231 cache_write=0 reasoning_out=1388",
    "  compile=yes ci=no",
    "  error=Generated RuleSpec failed CI validation",
    "  file=/home/runner/work/_temp/generated/target/openai-gpt-5.6-terra/regulations/7-cfr/273/4.yaml",
    "  run_id=57480cb2",
    ...lines,
  ];
  const applied = result(
    "  apply=/home/runner/work/axiom-encode/axiom-encode/rulespec-us/us/regulations/7-cfr/273/4.yaml",
    "  outcome=apply_applied final_success=True",
    "  supabase_sync=skipped",
    "axiom-apply-signer event=shutdown scope=apply_ed25519 signatures=1 ts=2026-09-02T09:49:43Z"
  );
  const SHUTDOWN = "axiom-apply-signer event=shutdown scope=apply_ed25519 signatures=0 ts=2026-09-02T10:59:06Z";

  it("quotes the final result's blocked apply, not the signer's shutdown line (run 33613765722)", () => {
    const log = encoderLog(
      "WARNING: run 3dc1da0f (us/regulation/7/273/4) was NOT synced to Supabase; it will not appear on the ops dashboard.",
      ...applied,
      "retired manifest inventory unchanged",
      ...result(
        "  apply=blocked_manifest:Refusing to shrink existing apply manifest coverage; dropped files: us/policies/usda/snap/state-plan-composition.test.yaml.",
        "  outcome=apply_blocked_manifest final_success=False",
        "  repair_manifest=/home/runner/work/_temp/generated/target/openai-gpt-5.6-terra/regulations/7-cfr/273/4.repair.json",
        "  supabase_sync=skipped",
        SHUTDOWN
      )
    );
    expect(checkErrorFromLog(log)).toBe(
      "Refusing to shrink existing apply manifest coverage; dropped files: us/policies/usda/snap/state-plan-composition.test.yaml."
    );
  });

  it("quotes a blocked validation with its rule, the encoder's own error, or a later tool error", () => {
    const blocked = checkErrorFromLog(
      encoderLog(
        ...result(
          "  apply=blocked_validation:regulations/7-cfr/273/4.yaml: ci: [complete-source-unit:structure] Source branch (E) is neither encoded nor precisely deferred.",
          "  outcome=apply_blocked_validation final_success=False",
          SHUTDOWN
        )
      )
    );
    expect(blocked).toBe(
      "regulations/7-cfr/273/4.yaml: ci: [complete-source-unit:structure] Source branch (E) is neither encoded nor precisely deferred."
    );
    expect(errorRule(blocked)).toBe("complete-source-unit:structure");
    expect(
      checkErrorFromLog(encoderLog(...result("  outcome=apply_blocked_generation final_success=False", SHUTDOWN)))
    ).toBe("Generated RuleSpec failed CI validation");
    // An applied result's repaired errors do not explain what failed after it.
    expect(
      checkErrorFromLog(encoderLog(...applied, "error: retired manifest inventory lacks one canonical top-level assignment"))
    ).toBe("error: retired manifest inventory lacks one canonical top-level assignment");
    expect(
      checkErrorFromLog(encoderLog(...applied, "signing supervisor: private keys are forbidden in the signing supervisor"))
    ).toBe("signing supervisor: private keys are forbidden in the signing supervisor");
  });

  it("reads a stored signer bookkeeping cause once more", () => {
    const stored = `supabase_sync=skipped ${SHUTDOWN}`;
    expect(bookkeepingCause(stored)).toBe(true);
    expect(bookkeepingCause("repair_manifest=/tmp/4.repair.json axiom-apply-signer event=shutdown signatures=0")).toBe(true);
    expect(bookkeepingCause("error: rulespec ref is not the exact pull request base branch tip")).toBe(false);
    expect(bookkeepingCause(null)).toBe(false);
    expect(needsLogRead({ failure_source: "log", failed_step: "encode_apply", encoder_error: stored })).toBe(true);
    expect(needsLogRead({ failure_source: "log", failed_step: "encode_apply", encoder_error: "Refusing to shrink" })).toBe(false);
    const previous = new Map([
      ["501", { citation: CITATION, failure_source: "log", failed_step: "encode_apply", encoder_error: stored }],
    ]);
    expect(failureLookups([run()], [], previous, NOW, 10).map((r) => r.id)).toEqual([501]);
  });
});

describe("merges into a side branch", () => {
  const SIDE = "fix/1248-snap-immigration-status";
  const sideMerged = (via?: BranchPr | null) =>
    pr({
      state: "MERGED",
      isDraft: false,
      createdAt: "2026-09-25T17:00:00Z",
      baseRefName: SIDE,
      mergedAt: "2026-09-25T17:31:05Z",
      mergeCommit: "side1",
      ...(via !== undefined ? { via } : {}),
    });
  const branchPr = (override: Partial<BranchPr> = {}): BranchPr => ({
    number: 1392,
    url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/1392",
    state: "MERGED",
    isDraft: false,
    createdAt: "2026-09-24T15:17:18Z",
    mergedAt: "2026-09-25T20:11:12Z",
    mergeCommit: "main1",
    ...override,
  });
  const unmerged = { mergedAt: null, mergeCommit: null };

  it("finds the side branch's own PR that carries a merge to main", () => {
    const intoMain = pr({ state: "MERGED", mergedAt: "2026-09-25T00:00:00Z" });
    expect(sideBranchLookups([sideMerged(), sideMerged(), intoMain, pr({ baseRefName: SIDE })])).toEqual([
      { repo: "rulespec-us", branch: SIDE, base: "main" },
    ]);
    const earlier = branchPr({ number: 1300, mergedAt: "2026-09-20T00:00:00Z", mergeCommit: "old" });
    const open = branchPr({ number: 1500, state: "OPEN", createdAt: "2026-09-26T00:00:00Z", ...unmerged });
    const closed = branchPr({ number: 1400, state: "CLOSED", ...unmerged });
    expect(viaPrFor(sideMerged(), [earlier, branchPr(), open])?.number).toBe(1392);
    // One that merged before the side-branch merge carried earlier work.
    expect(viaPrFor(sideMerged(), [earlier, open, closed])?.number).toBe(1500);
    expect(viaPrFor(sideMerged(), [earlier, closed])?.number).toBe(1400);
    expect(viaPrFor(sideMerged(), [])).toBeNull();
    expect(viaPrFor(intoMain, [branchPr()])).toBeNull();
  });

  it("counts it merged into main once that PR merged, at the commit main got (rulespec-us#1412 by #1392)", () => {
    const mirror = [mirrorRow({ commit_sha: "idx", synced_at: "2026-09-26T00:17:00Z" })];
    const contains = new Map([
      [containsKey("rulespec-us", "main1", "idx"), true],
      [containsKey("rulespec-us", "main1", "head"), true],
    ]);
    const latest: ShardResult = {
      conclusion: "success",
      headSha: "head",
      runUrl: "https://github.com/x/runs/latest",
      completedAt: "2026-09-27T00:00:00Z",
    };
    const validation = new Map([["rulespec-us", new Map([["us", latest]])]]);
    const firstRun = {
      startedAt: "2026-09-25T20:12:00Z",
      completedAt: "2026-09-25T20:40:00Z",
      conclusion: "success" as const,
      url: "https://github.com/x/runs/first",
    };
    const mergeValidation = new Map([[mergeValidationKey("rulespec-us", "main1"), new Map([["us", firstRun]])]]);
    const prs = [sideMerged(branchPr())];
    const [attempt] = buildAttempts(inputs({ prs, mirror, contains, validation, mergeValidation }));
    expect(attempt).toMatchObject({
      pr_base_branch: SIDE,
      pr_targets_default: false,
      pr_merged_at: "2026-09-25T17:31:05Z",
      pr_merge_commit: "side1",
      pr_via_number: 1392,
      pr_via_state: "merged",
      pr_via_merged_at: "2026-09-25T20:11:12Z",
      pr_via_merge_commit: "main1",
      index_status: "indexed",
      tests_status: "pass",
      tests_run_url: "https://github.com/x/runs/latest",
      tests_first_status: "pass",
      tests_first_run_url: "https://github.com/x/runs/first",
    });
    expect(attemptStage(attempt)).toBe("verified");
    expect(mainMerge(prs[0])).toEqual({ mergedAt: "2026-09-25T20:11:12Z", mergeCommit: "main1" });
    expect(containmentQueries(prs, mirror, validation)).toEqual([
      { repo: "rulespec-us", ancestor: "main1", descendant: "idx" },
      { repo: "rulespec-us", ancestor: "main1", descendant: "head" },
    ]);
    expect(mergeValidationLookups(prs, new Map(), 10)).toEqual([{ repo: "rulespec-us", commit: "main1" }]);
    expect(oldestUnsyncedMerge([{ ...attempt, synced_at: null, index_status: null }], NOW)).toBe(
      "2026-09-25T20:11:12Z"
    );
    const row = runRow(attempt);
    expect(row).toMatchObject({
      merged: "main",
      mainMergedAt: "2026-09-25T20:11:12Z",
      via: { label: "rulespec-us#1392", state: "merged" },
    });
    const steps = runTimeline(row, NOW).after;
    expect(steps.map((step) => step.key)).toEqual(["review", "side", "index", "tests"]);
    expect(steps[1]).toMatchObject({ state: "done", detail: "Into main by rulespec-us#1392" });
    expect(steps[1].ms).toBe(Date.parse("2026-09-25T20:11:12Z") - Date.parse("2026-09-25T17:31:05Z"));
    // The tests on main open the first run at the merge commit, which they time from main's merge.
    expect(steps[3].href).toBe("https://github.com/x/runs/first");
    expect(steps[3].ms).toBe(Date.parse("2026-09-25T20:40:00Z") - Date.parse("2026-09-25T20:11:12Z"));
  });

  it("keeps a merge whose side branch's PR is still open off main, waiting for that PR", () => {
    const open = branchPr({
      number: 911,
      state: "OPEN",
      url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/911",
      ...unmerged,
    });
    const [attempt] = buildAttempts(inputs({ prs: [sideMerged(open)], mirror: [mirrorRow()] }));
    expect(attempt).toMatchObject({
      pr_via_number: 911,
      pr_via_state: "open",
      pr_via_merged_at: null,
      pr_via_merge_commit: null,
      synced_at: null,
      index_status: null,
    });
    expect(attemptStage(attempt)).toBe("merged_off_main");
    const [state] = citationStates([attempt]);
    expect(pipelineItem(state, NOW).reason).toBe(`Merged into ${SIDE}; waits for rulespec-us#911`);
    expect(runTimeline(runRow(attempt), NOW).after.find((step) => step.key === "side")).toMatchObject({
      state: "waiting",
      detail: "Waits for rulespec-us#911 to merge into main",
      href: open.url,
    });
    // No PR from the branch: off main as before. Not looked up: no side-branch columns written.
    expect(buildAttempts(inputs({ prs: [sideMerged(null)] }))[0]).toMatchObject({ pr_via_number: null, pr_via_state: null });
    expect(buildAttempts(inputs({ prs: [sideMerged()] }))[0]).not.toHaveProperty("pr_via_number");
    expect(buildAttempts(inputs({ prs: [pr({ via: null })] }))[0]).toMatchObject({ pr_via_number: null });
  });
});

describe("first tests run's page", () => {
  const merged = pr({ state: "MERGED", isDraft: false, mergedAt: "2026-09-30T01:00:00Z", mergeCommit: "m1" });
  const stored = { tests_first_at: "C", tests_first_started_at: "S", tests_first_status: "pass" as const };

  it("records it from the merge commit's shard run, and keeps it", () => {
    const shards = new Map([
      ["us", { startedAt: "S", completedAt: "C", conclusion: "success" as const, url: "https://github.com/x/runs/first" }],
    ]);
    const atMerge = new Map([[mergeValidationKey("rulespec-us", "m1"), shards]]);
    // A merge recorded before pages were kept is read once more, and the read adds it.
    expect(
      buildAttempts(inputs({ prs: [merged], previous: new Map([["501", stored]]), mergeValidation: atMerge }))[0]
    ).toMatchObject({ ...stored, tests_first_run_url: "https://github.com/x/runs/first" });
    const kept = new Map([["501", { ...stored, tests_first_run_url: "U" }]]);
    expect(buildAttempts(inputs({ prs: [merged], previous: kept }))[0]).toMatchObject({
      tests_first_at: "C",
      tests_first_run_url: "U",
    });
    const previous = new Map([["x", { pr_repo: "rulespec-us", pr_merge_commit: "m1", ...stored }]]);
    expect(mergeValidationLookups([merged], previous, 10, { detail: true })).toEqual([]);
    expect(mergeValidationLookups([merged], previous, 10, { detail: true, url: true })).toEqual([
      { repo: "rulespec-us", commit: "m1" },
    ]);
  });
});
