import { describe, expect, it } from "vitest";
import { attemptEvents, caseIndex, failedStepStation, infraRuleId, issueEvents, issueRuleId, PRE_ENCODE_GATE_SINCE, runsPreEncodeGate } from "./pipeline-events";
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

  it("stops a run at the target gate when the pre-encode gate blocked it, before any model call", () => {
    const events = attemptEvents(
      pipelineAttempt({
        encode_started_at: "2026-09-20T10:01:00Z",
        setup_seconds: 120,
        failed_step: "encode / Encode, review, validate and apply",
        encoder_status: "pre_encode_blocked",
        encoder_error: "pre-encode gate: no_operative_text",
        generation_attempts: 0,
      })
    );
    expect(path(events)).toEqual(["dispatch.leave", "approval.enter", "approval.leave", "setup.enter", "setup.leave", "target_gate.enter", "target_gate.fail"]);
    expect(events.at(-1)).toMatchObject({ at: "2026-09-20T10:03:00.000Z", rule_id: "gate:pre-encode-blocked", outcome: "blocked", message: "pre-encode gate: no_operative_text", attrs: { untimed: true } });
  });

  it("records no gate pass until the gate's first encoder version is set", () => {
    expect(PRE_ENCODE_GATE_SINCE).toBeNull();
    expect(runsPreEncodeGate("0.2.2300")).toBe(false);
    expect(runsPreEncodeGate("0.2.2300", "0.2.2290")).toBe(true);
    expect(runsPreEncodeGate("0.2.999", "0.2.2290")).toBe(false);
    expect(runsPreEncodeGate(null, "0.2.2290")).toBe(false);
    const events = attemptEvents(mergedAttempt({ encoder_version: "0.2.9999" }));
    expect(events.some((e) => e.station === "target_gate")).toBe(false);
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
    // The PR is still open: the event says so, for the "waiting now" view.
    expect(last.attrs).toMatchObject({ pr_open: true });
  });

  const openPr = (overrides: Parameters<typeof pipelineAttempt>[0] = {}) =>
    pipelineAttempt({
      run_conclusion: "success",
      encode_seconds: 60,
      pr_url: "https://github.com/x/pull/1",
      pr_repo: "rulespec-us",
      pr_number: 1,
      pr_state: "open",
      pr_created_at: "2026-09-20T10:29:00Z",
      pr_checks: "success",
      pr_review: "none",
      ...overrides,
    });
  const last = (events: ReturnType<typeof attemptEvents>) => events.at(-1)!;

  it("ends a passed run at its artifact when the dispatch asked for no PR", () => {
    const end = last(attemptEvents(pipelineAttempt({ run_conclusion: "success", encode_seconds: 60, pr_requested: false })));
    expect([end.station, end.kind, end.rule_id]).toEqual(["publish", "cancel", "publish:artifact-only"]);
    // Asked for one and none found: still the collector's no-PR failure.
    const lost = last(attemptEvents(pipelineAttempt({ run_conclusion: "success", encode_seconds: 60, pr_requested: true })));
    expect([lost.station, lost.kind]).toEqual(["publish", "fail"]);
    expect(lost.rule_id).not.toBe("publish:artifact-only");
  });

  it("holds an open PR at its checks while CI runs, and says how many branch updates restarted it", () => {
    const end = last(attemptEvents(openPr({ pr_checks: "pending", pr_commit_count: 3, pr_checks_started_at: "2026-09-20T15:00:00Z", pr_merge_state: "BLOCKED" })));
    expect([end.station, end.kind, end.rule_id, end.at]).toEqual(["pr_checks", "wait", "check:pending", "2026-09-20T15:00:00Z"]);
    expect(end.message).toBe("CI is running again after 2 branch updates");
    expect(end.attrs).toMatchObject({ branch_updates: 2, merge_state: "BLOCKED" });
    expect(last(attemptEvents(openPr({ pr_checks: "pending" }))).message ?? null).toBeNull();
  });

  it("times the checks to the head commit's last check, and the review from there", () => {
    const events = attemptEvents(
      mergedAttempt({ pr_commit_count: 2, pr_checks_started_at: "2026-09-20T12:00:00Z", pr_checks_finished_at: "2026-09-20T16:29:00Z", pr_approved_at: "2026-09-21T08:00:00Z", pr_approval_on_head: true })
    );
    const checks = events.find((e) => e.station === "pr_checks" && e.kind === "leave")!;
    expect(checks.duration_ms).toBe(6 * 3_600_000);
    expect(checks.attrs).toMatchObject({ branch_updates: 1, last_ci_ms: 269 * 60_000 });
    const review = events.find((e) => e.station === "review" && e.kind === "leave")!;
    expect(review.duration_ms).toBe(Date.parse("2026-09-21T09:00:00Z") - Date.parse("2026-09-20T16:29:00Z"));
    expect(review.attrs).toMatchObject({ approved_at: "2026-09-21T08:00:00Z", approval_on_head: true });
    // A head check that finished after the merge does not time the checks.
    const late = attemptEvents(mergedAttempt({ pr_checks_finished_at: "2026-09-22T00:00:00Z" }));
    const untimed = late.find((e) => e.station === "pr_checks" && e.kind === "leave")!;
    expect(untimed.duration_ms ?? null).toBeNull();
    expect(untimed.attrs).toMatchObject({ untimed: true });
    // Rows from before the columns exist stay untimed.
    expect(attemptEvents(mergedAttempt()).find((e) => e.station === "pr_checks" && e.kind === "leave")!.attrs).toMatchObject({ untimed: true });
  });

  it("says why an open PR with passing checks is not merged: one reason, the first that holds", () => {
    const why = (overrides: Parameters<typeof pipelineAttempt>[0]) => {
      const end = last(attemptEvents(openPr(overrides)));
      return [end.station, end.kind, end.rule_id];
    };
    const approved = { pr_review: "approved" as const, pr_approved_at: "2026-09-20T12:00:00Z" };
    expect(why({ ...approved, pr_approval_on_head: false, pr_merge_state: "BEHIND" })).toEqual(["review", "wait", "merge:behind-base"]);
    expect(why({ ...approved, pr_approval_on_head: false, pr_merge_state: "BLOCKED" })).toEqual(["review", "wait", "review:approval-not-on-head"]);
    expect(why({ pr_approvals_dismissed: 1, pr_merge_state: "BLOCKED" })).toEqual(["review", "wait", "review:approval-dismissed"]);
    expect(why({ pr_merge_state: "DIRTY" })).toEqual(["review", "wait", "merge:conflict"]);
    expect(why({ ...approved, pr_approval_on_head: true, pr_merge_state: "CLEAN" })).toEqual(["review", "wait", "review:approved-not-merged"]);
    expect(why({ pr_requested_reviewers: ["MaxGhenis"] })).toEqual(["review", "wait", "review:awaiting-reviewer"]);
    expect(why({ pr_state: "draft", pr_merge_state: "BLOCKED" })).toEqual(["review", "wait", "review:draft"]);
    expect(why({ pr_review: "changes_requested", pr_merge_state: "BEHIND" })).toEqual(["review", "wait", "review:changes-requested"]);
    expect(why({ pr_requested_reviewers: [], pr_merge_state: "CLEAN" })).toEqual(["review", "wait", "review:no-reviewer-requested"]);
    // Nothing known: the review stays open with no stated reason.
    expect(why({})).toEqual(["review", "enter", null]);
    const behind = last(attemptEvents(openPr({ pr_merge_state: "BEHIND", pr_commit_count: 4 })));
    expect(behind.message).toContain("3 branch updates so far");
  });

  it("follows a closed PR that a merge train carried to main, instead of ending it as closed", () => {
    const carried = pipelineAttempt({
      run_conclusion: "success",
      encode_seconds: 60,
      pr_repo: "rulespec-us",
      pr_number: 2062,
      pr_url: "https://github.com/x/pull/2062",
      pr_state: "closed",
      pr_targets_default: true,
      pr_created_at: "2026-09-20T10:29:00Z",
      pr_closed_at: "2026-09-22T09:05:00Z",
      pr_checks: "failure",
      pr_failed_checks: ["validate / validate (us)"],
      pr_review: "none",
      pr_via_number: 2154,
      pr_via_url: "https://github.com/x/pull/2154",
      pr_via_state: "merged",
      pr_via_merged_at: "2026-09-22T09:00:00Z",
      pr_via_merge_commit: "train1",
      module_paths: ["us/statutes/7/2017/a.yaml"],
      tests_status: "fail",
      tests_first_status: "fail",
    });
    const events = attemptEvents(carried);
    expect(events.some((e) => e.rule_id === "review:closed-unmerged")).toBe(false);
    const review = events.find((e) => e.station === "review" && e.kind === "leave")!;
    expect([review.outcome, review.at, review.attrs?.carried_by]).toEqual(["carried", "2026-09-22T09:00:00Z", 2154]);
    const merge = events.find((e) => e.station === "merge" && e.kind === "leave")!;
    expect(merge.at).toBe("2026-09-22T09:00:00Z");
    const tests = events.find((e) => e.station === "tests" && e.kind === "fail")!;
    expect(tests.rule_id).toBe("tests:failed-at-merge");
    // The same PR with no carrier still ends closed.
    const plain = attemptEvents({ ...carried, pr_via_number: null, pr_via_state: null, pr_via_merged_at: null, pr_checks: "success" });
    expect(last(plain).rule_id).toBe("review:closed-unmerged");
  });

  it("separates a module that failed at the merge from one that broke later, and one with no verdict", () => {
    const rule = (overrides: Parameters<typeof mergedAttempt>[0]) => {
      const e = attemptEvents(mergedAttempt(overrides)).find((x) => x.station === "tests" && x.kind !== "enter")!;
      return [e.kind, e.rule_id];
    };
    expect(rule({ tests_status: "fail", tests_first_status: "fail" })).toEqual(["fail", "tests:failed-at-merge"]);
    expect(rule({ tests_status: "fail", tests_first_status: "pass" })).toEqual(["fail", "tests:broke-after-merge"]);
    expect(rule({ tests_status: "fail" })).toEqual(["fail", "tests:fail-on-main"]);
    expect(rule({})).toEqual(["wait", "tests:no-verdict"]);
    const indexed = attemptEvents(mergedAttempt({ indexed_at: "2026-09-21T12:00:00Z", index_status: "indexed" }));
    expect(indexed.find((e) => e.station === "compile" && e.kind === "wait")?.rule_id).toBe("compile:no-verdict");
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

describe("typed checks and oracle state on events", () => {
  it("puts a failed try's typed checks on its validate event, and leaves the rule id as it was", () => {
    const events = attemptEvents(
      pipelineAttempt({
        failed_step: "encode_apply",
        tries: [
          {
            attempt: 1,
            model: "m",
            ms: 1000,
            cost: 0.01,
            ok: false,
            error: "x.yaml: ci: [complete-source-unit:structure] no",
            checks: [
              { id: "complete-source-unit:structure/branch-unencoded", gate: "ci", n: 2 },
              { id: "compile:rules-engine/failed", gate: "compile", n: 1 },
            ],
            checksMore: 4,
          },
          { attempt: 2, model: "m", ms: 1000, cost: 0.01, ok: false, error: "x.yaml: ci: [r:tests] no" },
        ],
      })
    );
    const fails = events.filter((e) => e.station === "validate" && e.kind === "fail");
    expect(fails[0].rule_id).toBe("complete-source-unit:structure");
    expect(fails[0].attrs).toMatchObject({
      checks: ["complete-source-unit:structure/branch-unencoded", "compile:rules-engine/failed"],
      check_detail: [
        { id: "complete-source-unit:structure/branch-unencoded", gate: "ci", n: 2 },
        { id: "compile:rules-engine/failed", gate: "compile", n: 1 },
      ],
      checks_more: 4,
    });
    // A try whose record names no typed check carries none.
    expect(fails[1].attrs).not.toHaveProperty("checks");
  });

  it("says on the merge what compares the module: a verdict, pending, or none", () => {
    const merge = (overrides: Parameters<typeof mergedAttempt>[0]) =>
      attemptEvents(mergedAttempt({ indexed_at: "2026-09-21T12:00:00Z", index_status: "indexed", tests_status: "waived", ...overrides }));
    const oracleOf = (events: ReturnType<typeof attemptEvents>) => events.find((e) => e.station === "merge" && e.kind === "leave")?.attrs.oracle;
    expect(oracleOf(merge({}))).toBe("none");
    const pending = merge({ oracle_status: "pending" });
    expect(oracleOf(pending)).toBe("pending");
    // Pending is a state of the merged module, not a wait: no oracle visit, so the case still ends landed.
    expect(pending.some((e) => e.station === "oracle")).toBe(false);
    expect(oracleOf(merge({ oracle_status: "match", oracle_checked_at: "2026-09-22T00:00:00Z" }))).toBe("match");
  });
});

describe("the dispatch record on the dispatch event", () => {
  it("says what the dispatch asked for, on runs that carry a record", () => {
    const dispatch = (events: ReturnType<typeof attemptEvents>) => events.find((e) => e.station === "dispatch")!;
    const record = { kind: "repair" as const, open_pr: true, pr_base_branch: "main", repair_run_id: "35160240952" };
    expect(dispatch(attemptEvents(pipelineAttempt({ dispatch_record: record }))).attrs).toMatchObject({
      trigger: "repair",
      open_pr: true,
      pr_base_branch: "main",
      repair_run_id: "35160240952",
    });
    expect(dispatch(attemptEvents(pipelineAttempt())).attrs).not.toHaveProperty("trigger");
  });
});
