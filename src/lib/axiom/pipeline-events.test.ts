import { describe, expect, it } from "vitest";
import { attemptEvents, caseIndex, failedStepStation, infraRuleId, issueEvents, issueRuleId } from "./pipeline-events";
import { dependentAttempt, mergedAttempt, outsideAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const path = (events: ReturnType<typeof attemptEvents>) => events.map((e) => `${e.station}.${e.kind}`);

describe("issueRuleId", () => {
  it("reads a bracketed validator rule", () => {
    expect(issueRuleId("statutes/1.yaml: ci: [complete-source-unit:tests] Source branch (a) is not tested.")).toBe("complete-source-unit:tests");
  });

  it("groups a message without a rule by its leading words, without paths, numbers or quotes", () => {
    const a = issueRuleId("regulations/7-cfr/273/4.yaml: ci: Test case `x_1` output expected holds, got 12 at /tmp/a.yaml");
    const b = issueRuleId("statutes/42/1.yaml: ci: Test case `other` output expected holds, got 3 at /tmp/b.yaml");
    expect(a).toBe(b);
    expect(a).toBe("text:test-case-output-expected-holds-got");
    expect(issueRuleId("123 456")).toBe("text:unknown");
  });
});

describe("failedStepStation and infraRuleId", () => {
  it("places encoder steps and workflow steps", () => {
    expect(failedStepStation("encode_apply")).toBe("validate");
    expect(failedStepStation("verify_generated_provenance")).toBe("publish");
    expect(failedStepStation("Queue protected signed RuleSpec re-encode / Encode, review, validate, and apply")).toBe("validate");
    expect(failedStepStation("Queue protected signed RuleSpec re-encode / Push lane branch and open draft pull request")).toBe("publish");
    expect(failedStepStation("Queue protected signed RuleSpec re-encode / Verify immutable checkout identities")).toBe("setup");
    expect(infraRuleId("Queue protected signed RuleSpec re-encode / Verify immutable checkout identities")).toBe("infra:verify-immutable-checkout-identities");
  });
});

describe("attemptEvents", () => {
  it("times publishing from the end of the encoder's loop, not the job's step split", () => {
    const events = attemptEvents(
      mergedAttempt({
        encode_started_at: "2026-09-20T10:05:00Z",
        setup_seconds: 300,
        // Read before the lane steps counted as encode time: the loop sits in publish.
        encode_seconds: 8,
        publish_seconds: 1400,
        encode_loop: { startedAt: "2026-09-20T10:10:00Z", wallMs: 18 * 60_000, setupMs: null, triesMs: null, betweenMs: null, finalizeMs: null },
        tries: [{ attempt: 1, model: "m", ms: 1000, cost: 0.1, ok: true, error: null }],
      })
    );
    const publish = events.find((e) => e.station === "publish" && e.kind === "leave");
    // Loop ends 10:28; the PR opened 10:29.
    expect(publish?.duration_ms).toBe(60_000);
  });

  it("follows a dispatch that failed in the encode loop, one generate and validate per try", () => {
    const events = attemptEvents(
      pipelineAttempt({
        encode_started_at: "2026-09-20T10:05:00Z",
        setup_seconds: 60,
        failed_step: "encode_apply",
        encoder_error_rule: "complete-source-unit:tests",
        tries: [
          { attempt: 1, model: "m", ms: 1000, cost: 0.1, ok: false, error: "x.yaml: ci: [complete-source-unit:deferral] no" },
          { attempt: 2, model: "m", ms: 1000, cost: 0.1, ok: false, error: "x.yaml: ci: [complete-source-unit:tests] no" },
        ],
      })
    );
    expect(path(events)).toEqual([
      "dispatch.leave",
      "approval.enter",
      "approval.leave",
      "setup.enter",
      "setup.leave",
      "generate.enter",
      "generate.leave",
      "validate.enter",
      "validate.fail",
      "generate.enter",
      "generate.leave",
      "validate.enter",
      "validate.fail",
    ]);
    const fails = events.filter((e) => e.kind === "fail");
    expect(fails.map((e) => [e.try_no, e.rule_id])).toEqual([
      [1, "complete-source-unit:deferral"],
      [2, "complete-source-unit:tests"],
    ]);
    // Tries before the encoder's own clock have untimed checks.
    expect(fails[0].duration_ms).toBeNull();
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("stops at the approval when a run was cancelled there", () => {
    const events = attemptEvents(pipelineAttempt({ run_conclusion: "cancelled", cancel_stage: "approval" }));
    expect(path(events)).toEqual(["dispatch.leave", "approval.enter", "approval.cancel"]);
  });

  it("leaves a queued run open at the approval", () => {
    const events = attemptEvents(pipelineAttempt({ run_status: "queued", run_conclusion: null, finished_at: null }));
    expect(path(events).at(-1)).toBe("approval.enter");
  });

  it("follows a merge through index, tests on main (from the merge) and compile", () => {
    const events = attemptEvents(
      mergedAttempt({
        encode_started_at: "2026-09-20T10:01:00Z",
        encode_seconds: 600,
        indexed_at: "2026-09-21T12:00:00Z",
        index_status: "indexed",
        tests_status: "waived",
        compile_status: "compile_error",
        compile_checked_at: "2026-09-22T03:00:00Z",
      })
    );
    expect(path(events).slice(-9)).toEqual([
      "review.leave",
      "merge.enter",
      "merge.leave",
      "index.enter",
      "tests.enter",
      "tests.leave",
      "index.leave",
      "compile.enter",
      "compile.fail",
    ]);
    const tests = events.find((e) => e.station === "tests" && e.kind === "leave")!;
    expect(tests.outcome).toBe("waived");
    expect(tests.at).toBe("2026-09-21T09:00:00Z");
    expect(events.find((e) => e.station === "compile" && e.kind === "fail")!.rule_id).toBe("compile:compile_error");
  });

  it("holds an open PR with failing checks at its checks", () => {
    const events = attemptEvents(
      pipelineAttempt({
        run_conclusion: "success",
        encode_seconds: 60,
        pr_url: "https://github.com/x/pull/1",
        pr_repo: "rulespec-us",
        pr_state: "draft",
        pr_created_at: "2026-09-20T10:29:00Z",
        pr_checks: "failure",
        pr_failed_checks: ["validate / validate (dk)"],
      })
    );
    const last = events.at(-1)!;
    expect([last.station, last.kind, last.rule_id]).toEqual(["pr_checks", "fail", "check:validate / validate (dk)"]);
  });

  it("starts an outside merge at its PR and a dependent module at its own tries", () => {
    expect(path(attemptEvents(outsideAttempt()))[0]).toBe("pr_checks.enter");
    const dep = attemptEvents(
      dependentAttempt({
        tries: [{ attempt: 1, model: "m", ms: 1000, cost: 0.1, ok: false, error: "x: compile: Axiom rules engine compile failed: boom" }],
      })
    );
    expect(path(dep)).toEqual(["generate.enter", "generate.leave", "validate.enter", "validate.fail"]);
  });
});

describe("issueEvents", () => {
  it("places bundle issues on their run's last try and local runs on their own cases", () => {
    const base = attemptEvents(
      pipelineAttempt({ failed_step: "encode_apply", tries: [{ attempt: 3, model: "m", ms: 1, cost: 0, ok: false, error: "[a:b] x" }] })
    );
    const issues = issueEvents(
      [
        { src: "bundle_final", run: "1001", citation: "us/statute/7/2017/a", final: true, msg: "[complete-source-unit:tests] x" },
        { src: "ab_attempt", run: "r9", citation: "us/statute/1", attempt: 2, msg: "[complete-source-unit:structure] y" },
      ],
      caseIndex(base),
      "2026-10-21T00:00:00Z"
    );
    expect(issues.map((e) => [e.case_id, e.try_no, e.rule_id, e.source])).toEqual([
      ["1001", 3, "complete-source-unit:tests", "failure_bundle"],
      ["local:r9", 2, "complete-source-unit:structure", "local_ab"],
    ]);
    expect(issues[1].at).toBe("2026-10-21T00:00:00Z");
  });
});
