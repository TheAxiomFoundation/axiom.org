import { describe, expect, it } from "vitest";
import {
  ABANDON_AFTER_MS,
  type Attempt,
  buildPairing,
  classifyGate,
  classifyStep,
  countedLink,
  firstFailingStep,
  GATE_NAMES,
  gateForCheck,
  gateForMessage,
  median,
  nyLabel,
  PAIRING_STATES,
  type PairingEvent,
  pairTargets,
  type Pin,
  splitFinding,
  stateAt,
  timeline,
  tryGate,
} from "./encoding-pairing";
import { attemptEvents } from "./pipeline-events";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const T0 = Date.parse("2026-10-01T12:00:00Z");
const h = (hours: number) => T0 + hours * 3_600_000;
const at = (hours: number) => new Date(h(hours)).toISOString();

// --- gate mapping (prototype tests/test_pairing.py) ---------------------------

describe("classifyGate", () => {
  it.each([
    ["ci: [complete-source-unit:structure] Source branch (1) at us/regulation/12/1006/38(a) is neither encoded nor precisely deferred.", "source-completeness"],
    ["ci: [complete-source-unit:deferral] `module.deferred_outputs[0]` identifies source branch (a)", "source-completeness"],
    ["ci: [complete-source-unit:numeric-recall] Authoritative corpus numeric value 1 has no named scalar", "numeric-recall"],
    ["ci: Ungrounded generated numeric literal: 0.5 does not appear as a substantive numeric value", "numeric-recall"],
    ["ci: [complete-source-unit:tests] Source-stated exceptions require paired positive/blocking cases", "companion-tests"],
    ["ci: Test case `dispute collection ceases` execution failed: missing input `dispute_is_in_writing`", "companion-tests"],
    ["ci: Test input assignment missing: `case` does not assign #input.x", "companion-tests"],
    ["ci: [existing-target-oracle-contract] Replacement must retain valid exact-oracle-mapped surfaces", "oracle"],
    ["compile: Axiom rules engine compile failed: failed to load RuleSpec module `x`: yaml parse error", "compile"],
    ["Generated RuleSpec failed compile validation", "compile"],
    ["ci: 4.test.yaml YAML parse failed: while constructing a mapping", "compile"],
    ["ci: Proof source evidence not found: rule `x` proof atom 0 `y` does not appear in `z`.", "source-evidence"],
    ["External source replacement must preserve the entire legacy scalar rule snap_member_x unchanged", "dependencies"],
    ["ci: [temporal-dependency-coverage] Derived rule `x` version 1 covers 2025-01-01 through unbounded", "dependencies"],
    ["Refusing to overwrite /home/runner/x.yaml — existing file", "apply-guard"],
    ["ValueError: No local corpus source text found for 'us-ga/manual/dfcs/medicaid/2186/block-4'", "corpus-source"],
    ["RuntimeError: dependent review finding is required with dependent citation", "reviewer"],
    ["No RuleSpec content returned", "generation"],
    ["Generated RuleSpec failed CI validation", "ci-other"],
    ["ci: Formula date literal unsupported: `x` uses `y` inside an executable formula", "ci-other"],
  ])("maps %s", (text, gate) => {
    expect(classifyGate(text)).toBe(gate);
  });

  it("is other for unmapped text, never a guess", () => {
    expect(classifyGate("something the table has never seen")).toBe("other");
    expect(classifyGate(null)).toBe("other");
  });

  it("keeps the prototype's gate names", () => {
    expect(GATE_NAMES).toEqual([
      "oracle",
      "numeric-recall",
      "compile",
      "dependencies",
      "companion-tests",
      "source-completeness",
      "source-evidence",
      "reviewer",
      "apply-guard",
      "corpus-source",
      "admission-pin",
      "generation",
      "infra",
      "ci-other",
      "other",
    ]);
  });
});

describe("gateForMessage and splitFinding", () => {
  it("drops the file prefix and keeps the stage", () => {
    expect(splitFinding("regulations/x.yaml: ci: [complete-source-unit:structure] Source")).toEqual(["ci", "[complete-source-unit:structure] Source"]);
    expect(splitFinding("plain words")).toEqual([null, "plain words"]);
    // `^compile:` needs the stage at the start, after the file prefix is gone.
    expect(gateForMessage("regulations/12-cfr/1006/38.yaml: compile: Axiom rules engine compile failed: bad")).toBe("compile");
    expect(gateForMessage("x.yaml: ci: Test case `x` execution failed")).toBe("companion-tests");
    expect(gateForMessage(null)).toBe("other");
  });
});

describe("classifyStep", () => {
  it.each([
    ["Enforce failed-attempt budget", "admission-pin"],
    ["Verify immutable checkout identities", "admission-pin"],
    ["Resolve trusted prior-run repair candidate", "admission-pin"],
    ["Fetch pinned signed corpus release object", "infra"],
    ["Provision protected signing supervisor", "infra"],
    ["Validate atomic source inputs", "source-evidence"],
    ["Some brand new step", "other"],
  ])("maps %s", (step, gate) => {
    expect(classifyStep(step)).toBe(gate);
  });

  it("reads a job-qualified step and a kebab-cased one the same", () => {
    expect(classifyStep("Queue protected signed RuleSpec re-encode / Verify immutable checkout identities")).toBe("admission-pin");
    expect(classifyStep("enforce-failed-attempt-budget")).toBe("admission-pin");
    expect(classifyStep("resolve-trusted-prior-run-repair-candidate")).toBe("admission-pin");
    expect(classifyStep(null)).toBe("other");
  });
});

describe("firstFailingStep", () => {
  it("never takes a signature step after a refusal as the cause", () => {
    const jobs = {
      jobs: [
        {
          name: "Queue",
          conclusion: "failure",
          steps: [
            { name: "Encode, review, validate, and apply", conclusion: "success" },
            { name: "Apply prepared signature 1", conclusion: "failure" },
            { name: "Complete signed encode checkpoints", conclusion: "failure" },
          ],
        },
      ],
    };
    expect(firstFailingStep(jobs)).toEqual(["Queue", "Apply prepared signature 1"]); // only a fallback
    jobs.jobs[0].steps.unshift({ name: "Verify immutable checkout identities", conclusion: "failure" });
    expect(firstFailingStep(jobs)).toEqual(["Queue", "Verify immutable checkout identities"]);
    expect(firstFailingStep(null)).toEqual([null, null]);
    expect(firstFailingStep({ jobs: [{ name: "J", conclusion: "failure", steps: [] }] })).toEqual(["J", null]);
  });
});

describe("gateForCheck", () => {
  it("maps typed check ids by family", () => {
    expect(gateForCheck("complete-source-unit:tests/exception-pair-missing")).toBe("companion-tests");
    expect(gateForCheck("complete-source-unit:tests")).toBe("companion-tests");
    expect(gateForCheck("complete-source-unit:structure/branch-unencoded")).toBe("source-completeness");
    expect(gateForCheck("complete-source-unit:deferral/reason-imprecise")).toBe("source-completeness");
    expect(gateForCheck("complete-source-unit:formula-output/unit-without-output")).toBe("source-completeness");
    expect(gateForCheck("complete-source-unit:numeric-recall/value-unnamed")).toBe("numeric-recall");
    expect(gateForCheck("compile:rules-engine/failed")).toBe("compile");
    expect(gateForCheck("proof:source-evidence/not-found")).toBe("source-evidence");
    expect(gateForCheck("existing-target-oracle-contract")).toBe("oracle");
    expect(gateForCheck("temporal-dependency-coverage")).toBe("dependencies");
    expect(gateForCheck("pin:mismatch")).toBe("admission-pin");
  });

  it("maps an infra check by its step, and an unknown family to null", () => {
    expect(gateForCheck("infra:verify-immutable-checkout-identities")).toBe("admission-pin");
    expect(gateForCheck("infra:validate-atomic-source-inputs")).toBe("source-evidence");
    expect(gateForCheck("infra:fetch-pinned-corpus-provision-objects")).toBe("infra");
    expect(gateForCheck("infra:something-new")).toBeNull();
    expect(gateForCheck("brand-new:check")).toBeNull();
    expect(gateForCheck(null)).toBeNull();
  });
});

// --- events --------------------------------------------------------------------

let seq = 0;
function ev(p: Partial<PairingEvent> & Pick<PairingEvent, "case_id" | "station" | "kind" | "at">): PairingEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    citation: "us/regulation/7/273/7",
    jurisdiction: "us",
    duration_ms: null,
    outcome: null,
    try_no: null,
    rule_id: null,
    message: null,
    actor: null,
    cost_usd: null,
    encoder_version: null,
    source: "pipeline_attempts",
    ref_url: null,
    attrs: {},
    ...p,
  };
}

/** A signed run's events: tries (null error = pass), then publish when it succeeded. */
function runEvents(id: string, start: number, end: number, tries: Array<string | null>, extra: Partial<PairingEvent> = {}): PairingEvent[] {
  const out: PairingEvent[] = [ev({ case_id: id, station: "dispatch", kind: "leave", at: at(start), ref_url: `https://github.com/o/axiom-encode/actions/runs/${id}`, ...extra })];
  tries.forEach((error, i) => {
    const t = at(start + ((end - start) * (i + 0.5)) / tries.length);
    out.push(ev({ case_id: id, station: "generate", kind: "enter", at: t, try_no: i + 1, actor: "gpt-6-luna", ...extra }));
    out.push(
      error == null
        ? ev({ case_id: id, station: "validate", kind: "leave", at: t, try_no: i + 1, outcome: "ok", ...extra })
        : ev({ case_id: id, station: "validate", kind: "fail", at: i === tries.length - 1 ? at(end) : t, try_no: i + 1, outcome: "fail", message: error, ...extra })
    );
  });
  if (tries.at(-1) === null) {
    out.push(ev({ case_id: id, station: "publish", kind: "enter", at: at(end), ...extra }));
  }
  return out;
}

function rulespecPrEvents(caseId: string, created: number, opts: { merged?: number; failing?: string; pinRule?: boolean; attrs?: Record<string, unknown>; version?: string } = {}): PairingEvent[] {
  const url = "https://github.com/o/rulespec-us/pull/20";
  const base = { case_id: caseId, encoder_version: opts.version ?? "0.2.2302" };
  const out = [
    ev({ ...base, station: "publish", kind: "leave", at: at(created), outcome: "ok", ref_url: url }),
    ev({ ...base, station: "pr_checks", kind: "enter", at: at(created) }),
  ];
  if (opts.failing) {
    out.push(
      ev({
        ...base,
        station: "pr_checks",
        kind: opts.merged != null ? "wait" : "fail",
        at: at(created),
        outcome: "fail",
        rule_id: opts.pinRule ? "pin:mismatch" : `check:${opts.failing}`,
        ref_url: `${url}/checks?check_run_id=1`,
        attrs: opts.attrs ?? {},
      })
    );
    if (opts.merged == null) return out;
  }
  out.push(ev({ ...base, station: "pr_checks", kind: "leave", at: at(created), outcome: "ok", ref_url: url }));
  out.push(ev({ ...base, station: "review", kind: "enter", at: at(created) }));
  if (opts.merged != null) {
    out.push(ev({ ...base, station: "review", kind: "leave", at: at(opts.merged), outcome: "ok", ref_url: url }));
    out.push(ev({ ...base, station: "merge", kind: "enter", at: at(opts.merged) }));
    out.push(ev({ ...base, station: "merge", kind: "leave", at: at(opts.merged), outcome: "ok", ref_url: url, attrs: { repo: "rulespec-us" } }));
  }
  return out;
}

function fixEvents(n: number, caseId: string, created: number, opts: { merged?: number; closed?: number; link?: string; confidence?: string; version?: string } = {}): PairingEvent[] {
  const base = {
    case_id: caseId,
    station: "encoder_fix",
    source: "encoder_pr",
    ref_url: `https://github.com/o/axiom-encode/pull/${n}`,
    attrs: { pr: n, title: `fix ${n}`, link: opts.link ?? "declared", ...(opts.confidence ? { confidence: opts.confidence } : {}) },
  };
  const out = [ev({ ...base, kind: "enter", at: at(created) })];
  if (opts.merged != null) out.push(ev({ ...base, kind: "leave", at: at(opts.merged), outcome: "merged", encoder_version: opts.version ?? null }));
  if (opts.closed != null) out.push(ev({ ...base, kind: "cancel", at: at(opts.closed), outcome: "closed" }));
  return out;
}

const target = (events: PairingEvent[], now: number, pins?: Record<string, Array<{ at: string; version: string }>>) => {
  const targets = pairTargets(events, { now, pins });
  expect(targets).toHaveLength(1);
  return targets[0];
};

describe("pairTargets from events", () => {
  it("reads a dispatch that failed in the encode loop, with each try's gate", () => {
    const events = attemptEvents(
      pipelineAttempt({
        encode_started_at: "2026-09-20T10:05:00Z",
        setup_seconds: 60,
        failed_step: "encode_apply",
        tries: [
          { attempt: 1, model: "m1", ms: 1000, cost: 0.1, ok: false, error: "x.yaml: ci: [complete-source-unit:deferral] no" },
          { attempt: 2, model: "m2", ms: 1000, cost: 0.1, ok: false, error: "x.yaml: ci: Test case `t` execution failed: missing input `y`" },
        ],
      })
    );
    const t = target(events, Date.parse("2026-09-21T00:00:00Z"));
    expect(t.citation).toBe("us/statute/7/2017/a");
    expect(t.runs).toHaveLength(1);
    const run = t.runs[0];
    expect(run).toMatchObject({ id: "1001", kind: "signed", outcome: "failure", gate: "companion-tests", gate_basis: "encoder refusal (final try)" });
    expect(run.url).toBe("https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/1001");
    expect(run.tries.map((x) => [x.try, x.model, x.gate])).toEqual([
      [1, "m1", "source-completeness"],
      [2, "m2", "companion-tests"],
    ]);
    expect(t.state).toBe("refused-waiting-fix");
    expect(t.reason).toBe("signed run 1001 refused");
  });

  it("follows a merged dispatch to landed", () => {
    const t = target(attemptEvents(mergedAttempt()), Date.parse("2026-09-22T00:00:00Z"));
    expect(t.runs[0].outcome).toBe("success");
    expect(t.rulespec_prs).toHaveLength(1);
    expect(t.rulespec_prs[0]).toMatchObject({ id: "rulespec-us#42", repo: "rulespec-us", number: 42, landed: "2026-09-21T09:00:00.000Z", why_not_merged: [] });
    expect(t.landings).toEqual(["rulespec-us#42"]);
    expect(t.state).toBe("landed");
    // The publish step opens the PR, so a signed run that opened one never waits for it.
    expect(t.timeline.map((s) => s.state)).toEqual(["generating", "rulespec-PR-open", "landed"]);
  });

  it("places a fix PR under the run it answered and moves the state through the loop", () => {
    const events = [
      ...runEvents("101", 0, 1, ["x.yaml: ci: [complete-source-unit:tests] paired cases required"]),
      ...fixEvents(10, "101", 2, { merged: 5, version: "0.2.2400" }),
      ...runEvents("102", 10, 11, [null]),
      ...rulespecPrEvents("102", 12, { merged: 40 }),
    ];
    const t = target(events, h(50));
    expect(t.fix_prs.map((f) => [f.id, f.fixes_runs, f.counted, f.encoder_version])).toEqual([["axiom-encode#10", ["101"], true, "0.2.2400"]]);
    expect(t.timeline.map((s) => s.state)).toEqual([
      "generating",
      "refused-waiting-fix",
      "fix-PR-in-review",
      "waiting-rerun",
      "generating",
      "rulespec-PR-open",
      "landed",
    ]);
    expect(t.hours_in_state["fix-PR-in-review"]).toBe(3);
    expect(t.state_since).toBe(at(40));
    expect(t.hours_in_current_state).toBe(10);
  });

  it("counts declared and high or medium links only, and prefers a declared link for the same PR", () => {
    const events = [
      ...runEvents("101", 0, 1, ["ci: no"]),
      ...fixEvents(11, "101", 2, { link: "inferred", confidence: "low" }),
      ...fixEvents(12, "101", 2, { link: "inferred", confidence: "medium" }),
      ...fixEvents(13, "101", 3, { link: "inferred", confidence: "low" }),
      ...fixEvents(13, "target:us/regulation/7/273/7", 3, { link: "declared" }),
    ];
    const t = target(events, h(4));
    expect(t.fix_prs.map((f) => [f.id, f.link, f.confidence])).toEqual([
      ["axiom-encode#12", "inferred", "medium"],
      ["axiom-encode#13", "declared", "high"],
    ]);
    expect(t.fix_prs[1].fixes_runs).toEqual([]);
    expect(t.fix_prs_low.map((f) => f.id)).toEqual(["axiom-encode#11"]);
    expect(t.state).toBe("fix-PR-in-review");
    expect(countedLink("inferred", "low")).toBe(false);
    expect(countedLink("declared", "low")).toBe(true);
  });

  it("reads a closed fix PR as no longer in review", () => {
    const events = [...runEvents("101", 0, 1, ["ci: no"]), ...fixEvents(10, "101", 2, { closed: 3 })];
    const t = target(events, h(4));
    expect(t.fix_prs[0].closed).toBe(at(3));
    expect(t.state).toBe("refused-waiting-fix");
  });

  it("blocks on the pin when the collector reports a mismatch on the failing check", () => {
    const events = [
      ...runEvents("101", 0, 1, [null]),
      ...rulespecPrEvents("101", 2, { failing: "validate", pinRule: true, attrs: { pin_version: "0.2.2248", candidate_version: "0.2.2302" } }),
    ];
    const t = target(events, h(3));
    expect(t.state).toBe("blocked-on-pin");
    expect(t.reason).toContain("0.2.2302 vs pin 0.2.2248");
    expect(t.rulespec_prs[0]).toMatchObject({ checks: "failing", pin_source: "check", pin_mismatch: true, failed_checks: [] });
    expect(t.rulespec_prs[0].why_not_merged).toContain("pin mismatch: candidate signed by encoder 0.2.2302, rulespec-us pins 0.2.2248");
  });

  it("blocks on the pin from the pin history only while checks fail and the versions differ", () => {
    const pins = { "rulespec-us": [{ at: "2026-09-01T00:00:00Z", version: "0.2.2248" }] };
    const failing = [...runEvents("101", 0, 1, [null]), ...rulespecPrEvents("101", 2, { failing: "validate-rulespec" })];
    const t = target(failing, h(3), pins);
    expect(t.state).toBe("blocked-on-pin");
    expect(t.rulespec_prs[0]).toMatchObject({ pin_version: "0.2.2248", pin_source: "history", failed_checks: ["validate-rulespec"] });
    expect(t.rulespec_prs[0].why_not_merged.slice(1)).toEqual(["pin mismatch: candidate signed by encoder 0.2.2302, rulespec-us pins 0.2.2248", "failing checks: validate-rulespec"]);
    // The repo moved its pin to the candidate's version: an open PR, no longer blocked.
    const moved = { "rulespec-us": [...pins["rulespec-us"], { at: at(2.5), version: "0.2.2302" }] };
    const t2 = target(failing, h(3), moved);
    expect(t2.timeline.map((s) => s.state)).toEqual(["generating", "blocked-on-pin", "rulespec-PR-open"]);
    // Green checks: open, whatever the pin.
    const green = [...runEvents("101", 0, 1, [null]), ...rulespecPrEvents("101", 2)];
    expect(target(green, h(3), pins).state).toBe("rulespec-PR-open");
    expect(target(green, h(3), pins).rulespec_prs[0].why_not_merged).toContain("checks green");
  });

  it("keeps a PR merged into a side branch open until it reaches main", () => {
    const url = "https://github.com/o/rulespec-us/pull/20";
    const events = [
      ...runEvents("101", 0, 1, [null]),
      ...rulespecPrEvents("101", 2).slice(0, 4),
      ev({ case_id: "101", station: "review", kind: "leave", at: at(3), outcome: "ok", ref_url: url }),
      ev({ case_id: "101", station: "merge", kind: "enter", at: at(3) }),
      ev({ case_id: "101", station: "merge", kind: "wait", at: at(3), outcome: "side_branch", rule_id: "merge:side-branch", ref_url: url }),
    ];
    const t = target(events, h(4));
    expect(t.rulespec_prs[0]).toMatchObject({ merged: at(3), landed: null, side_branch: true });
    expect(t.state).toBe("rulespec-PR-open");
    expect(t.reason).toContain("side branch");
    expect(t.rulespec_prs[0].why_not_merged).toContain("merged into a side branch; waits for that branch's own PR");
  });

  it("reads review holds and pending checks into why-not-merged", () => {
    const url = "https://github.com/o/rulespec-us/pull/20";
    const base = { case_id: "101", encoder_version: null };
    const events = [
      ...runEvents("101", 0, 1, [null]),
      ev({ ...base, station: "pr_checks", kind: "enter", at: at(2) }),
      ev({ ...base, station: "pr_checks", kind: "leave", at: at(2), outcome: "ok", ref_url: url }),
      ev({ ...base, station: "review", kind: "enter", at: at(2) }),
      ev({ ...base, station: "review", kind: "wait", at: at(2), outcome: "awaiting_review", actor: "MaxGhenis", ref_url: url }),
    ];
    const t = target(events, h(50));
    expect(t.rulespec_prs[0].why_not_merged).toEqual([`open since ${nyLabel(h(2))} (2 days)`, "candidate encoder version unknown", "checks green", "waiting review (requested: MaxGhenis)"]);
    const pending = [...runEvents("101", 0, 1, [null]), ev({ ...base, station: "pr_checks", kind: "enter", at: at(2), ref_url: url })];
    expect(target(pending, h(3)).rulespec_prs[0].checks).toBe("pending");
    const changes = [...events.slice(0, -1), ev({ ...base, station: "review", kind: "wait", at: at(2), outcome: "changes_requested", ref_url: url })];
    expect(target(changes, h(3)).rulespec_prs[0].why_not_merged).toContain("changes requested");
  });

  it("waits for a rulespec PR after a signed run that succeeded without one", () => {
    const events = [...runEvents("101", 0, 1, [null]), ev({ case_id: "101", station: "publish", kind: "fail", at: at(1), outcome: "no_pr", rule_id: "infra:no-pr" })];
    const t = target(events, h(2));
    expect(t.runs[0]).toMatchObject({ outcome: "success", gate: null });
    expect(t.state).toBe("signed-waiting-rulespec-PR");
  });

  it("keeps a PR merged into a side branch open until the side branch reaches main", () => {
    const events = attemptEvents(mergedAttempt({ pr_targets_default: false, pr_via_state: "merged", pr_via_merged_at: "2026-09-21T12:00:00Z" }));
    const t = target(events, Date.parse("2026-09-22T00:00:00Z"));
    expect(t.rulespec_prs[0]).toMatchObject({ merged: "2026-09-21T09:00:00.000Z", landed: "2026-09-21T12:00:00.000Z", side_branch: true });
    expect(t.timeline.map((s) => s.state)).toEqual(["generating", "rulespec-PR-open", "landed"]);
    expect(t.timeline[1].end).toBe("2026-09-21T12:00:00.000Z");
  });

  it("reads a side branch whose own PR closed as closed, never landed", () => {
    const events = attemptEvents(mergedAttempt({ pr_targets_default: false, pr_via_state: "closed" }));
    const t = target(events, Date.parse("2026-09-22T00:00:00Z"));
    expect(t.rulespec_prs[0]).toMatchObject({ landed: null, closed: "2026-09-21T09:00:00.000Z", why_not_merged: [] });
    expect(t.state).toBe("signed-waiting-rulespec-PR");
  });

  it("reads a check that failed but did not hold the merge as not failing", () => {
    const pins = { "rulespec-us": [{ at: "2026-09-01T00:00:00Z", version: "0.2.0" }] };
    const events = attemptEvents(mergedAttempt({ pr_targets_default: false, pr_via_state: "open", pr_checks: "failure", encoder_version: "0.2.1" }));
    const t = target(events, Date.parse("2026-09-22T00:00:00Z"), pins);
    expect(t.rulespec_prs[0]).toMatchObject({ checks: "green", side_branch: true, pin_mismatch: false });
    expect(t.state).toBe("rulespec-PR-open");
  });

  it("names a PR with pending checks from its publish event", () => {
    const events = attemptEvents(mergedAttempt({ pr_state: "open", pr_merged_at: null, pr_checks: "pending" }));
    const t = target(events, Date.parse("2026-09-22T00:00:00Z"));
    expect(t.rulespec_prs[0]).toMatchObject({ id: "rulespec-us#42", repo: "rulespec-us", checks: "pending" });
    expect(t.rulespec_prs[0].why_not_merged).toContain("checks pending");
  });

  it("reads an encode-step failure with no refusal from its message, never as infra, and keeps a passing try a pass", () => {
    const events = attemptEvents(
      pipelineAttempt({
        encode_started_at: "2026-09-20T10:05:00Z",
        setup_seconds: 60,
        failed_step: "encode / Encode, review, validate, and apply",
        encoder_status: "apply_blocked_validation",
        encoder_error: "No RuleSpec content returned",
        generation_attempts: 1,
        tries: [{ attempt: 1, model: "m1", ms: 1000, cost: 0.1, ok: true, error: null }],
      })
    );
    const run = target(events, Date.parse("2026-09-21T00:00:00Z")).runs[0];
    expect(run.tries.map((x) => [x.try, x.ok, x.gate])).toEqual([[1, true, null]]);
    expect(run).toMatchObject({ outcome: "failure", gate: "generation", gate_basis: "encode step failed with no refusal line" });
    const untyped = attemptEvents(
      pipelineAttempt({ failed_step: "encode / Encode, review, validate, and apply", encoder_error: "something the table has never seen", generation_attempts: 2 })
    );
    const r2 = target(untyped, Date.parse("2026-09-21T00:00:00Z")).runs[0];
    expect(r2).toMatchObject({ outcome: "failure", gate: "other" });
    expect(r2.tries.every((x) => x.gate == null)).toBe(true);
    expect(gateForCheck("infra:encode-review-validate-and-apply")).toBeNull();
  });

  it("never takes a cascade step from a real row as the cause", () => {
    const events = attemptEvents(pipelineAttempt({ failed_step: "Encode / Apply prepared signature 1", encoder_error: "x.yaml: compile: Axiom rules engine compile failed" }));
    const run = target(events, Date.parse("2026-09-21T00:00:00Z")).runs[0];
    expect(run).toMatchObject({ outcome: "failure", gate: "compile", gate_basis: "encode step failed with no refusal line" });
  });

  it("never reads a step's own name as the finding when the encoder recorded no error", () => {
    const now = Date.parse("2026-09-21T00:00:00Z");
    const encode = attemptEvents(pipelineAttempt({ failed_step: "Encode / Encode, review, validate RuleSpec" }));
    expect(target(encode, now).runs[0]).toMatchObject({ outcome: "failure", gate: "other" });
    const cascade = attemptEvents(pipelineAttempt({ failed_step: "Encode / Apply prepared signature" }));
    expect(target(cascade, now).runs[0]).toMatchObject({ outcome: "failure", gate: "other", gate_basis: "encode step failed with no refusal line" });
  });

  it("reads a run with no known step from the encoder's last refusal", () => {
    const events = [
      ...runEvents("101", 0, 1, ["x.yaml: ci: [complete-source-unit:tests] t", null]),
      ev({ case_id: "101", station: "publish", kind: "fail", at: at(1.5), outcome: "fail", rule_id: "infra:unknown" }),
    ];
    expect(target(events, h(2)).runs[0]).toMatchObject({ outcome: "failure", gate: "companion-tests", gate_basis: "encoder refusal (final try)" });
  });

  it("reads a closed rulespec PR as closed, and the run waits for a new PR", () => {
    const url = "https://github.com/o/rulespec-us/pull/20";
    const events = [
      ...runEvents("101", 0, 1, [null]),
      ev({ case_id: "101", station: "publish", kind: "leave", at: at(1), outcome: "ok", ref_url: url }),
      ev({ case_id: "101", station: "pr_checks", kind: "enter", at: at(2), ref_url: url }),
      ev({ case_id: "101", station: "pr_checks", kind: "cancel", at: at(5), outcome: "closed", ref_url: url }),
    ];
    const t = target(events, h(6));
    expect(t.rulespec_prs[0]).toMatchObject({ closed: at(5), why_not_merged: [] });
    expect(t.state).toBe("signed-waiting-rulespec-PR");
  });

  it("takes the gate of a run that failed before the encoder from its step", () => {
    const events = attemptEvents(
      pipelineAttempt({
        encode_started_at: "2026-09-20T10:01:00Z",
        failed_step: "Queue protected signed RuleSpec re-encode / Verify immutable checkout identities",
      })
    );
    const run = target(events, Date.parse("2026-09-21T00:00:00Z")).runs[0];
    expect(run).toMatchObject({ outcome: "failure", gate: "admission-pin", gate_basis: "workflow step: verify-immutable-checkout-identities" });
  });

  it("takes the encoder's last refusal when a cascade step failed after it", () => {
    const events = [
      ...runEvents("101", 0, 1, ["x.yaml: ci: [complete-source-unit:numeric-recall] value"]),
      ev({ case_id: "101", station: "publish", kind: "fail", at: at(1.5), outcome: "fail", rule_id: "infra:apply-prepared-signature-1" }),
    ];
    const run = target(events, h(2)).runs[0];
    expect(run).toMatchObject({ outcome: "failure", gate: "numeric-recall", gate_basis: "encoder refusal (final try)" });
  });

  it("reads typed checks before the message, and issue events as the try's findings", () => {
    const typed = ev({
      case_id: "101",
      station: "validate",
      kind: "fail",
      at: at(1),
      try_no: 1,
      message: "x.yaml: ci: Test case `t` execution failed",
      attrs: { checks: ["complete-source-unit:structure/branch-unencoded"] },
    });
    expect(tryGate([typed])).toBe("source-completeness");
    expect(tryGate([{ ...typed, attrs: {}, rule_id: "complete-source-unit:numeric-recall" }])).toBe("numeric-recall");
    expect(tryGate([{ ...typed, attrs: {}, rule_id: "text:test-case-execution-failed" }])).toBe("companion-tests");
    expect(tryGate([{ ...typed, attrs: { checks: ["brand-new:check"] }, message: null }])).toBe("other");
    const events = [
      ev({ case_id: "101", station: "generate", kind: "enter", at: at(0), try_no: 1 }),
      ev({ case_id: "101", station: "validate", kind: "issue", at: at(1), try_no: 1, source: "failure_bundle", message: "x.yaml: compile: Axiom rules engine compile failed" }),
    ];
    const run = target(events, h(2)).runs[0];
    expect(run.tries[0].gate).toBe("compile");
    expect(run.outcome).toBe("failure");
  });

  it("reads a local run's success as waiting for a signed run, and a cancel as waiting for a rerun", () => {
    const local = runEvents("local:abc", 0, 1, [null]).filter((e) => e.station !== "dispatch" && e.station !== "publish");
    const t = target(local, h(2));
    expect(t.runs[0]).toMatchObject({ kind: "local", outcome: "success" });
    expect(t.state).toBe("waiting-rerun");
    const cancelled = attemptEvents(pipelineAttempt({ run_conclusion: "cancelled", cancel_stage: "approval" }));
    expect(target(cancelled, Date.parse("2026-09-21T00:00:00Z")).state).toBe("waiting-rerun");
  });

  it("reads a run with no end as generating", () => {
    const queued = attemptEvents(pipelineAttempt({ run_status: "queued", run_conclusion: null, finished_at: null }));
    const t = target(queued, Date.parse("2026-09-20T12:00:00Z"));
    expect(t.runs[0]).toMatchObject({ outcome: null, end: null });
    expect(t.state).toBe("generating");
    expect(t.run_counts.in_progress).toBe(1);
  });

  it("makes targets only from runs, and leaves dependent and outside modules and future events out", () => {
    const events = [
      ...runEvents("101", 0, 1, ["ci: no"]),
      ev({ case_id: "dep:5e2a", station: "generate", kind: "enter", at: at(0), try_no: 1 }),
      ev({ case_id: "pr:rulespec-us#900:x.yaml", station: "merge", kind: "leave", at: at(0) }),
      ...fixEvents(30, "target:us/regulation/9/9/9", 0).map((e) => ({ ...e, citation: "us/regulation/9/9/9" })),
      ...runEvents("999", 100, 101, [null]),
    ];
    const t = target(events, h(2));
    expect(t.runs.map((r) => r.id)).toEqual(["101"]);
    expect(pairTargets([], { now: h(1) })).toEqual([]);
  });
});

// --- the state machine (prototype tests/test_pairing.py) -----------------------

const run = (i: number, start: number, end: number | null, outcome: "success" | "failure" | "cancelled" | null, kind: "signed" | "local" = "signed") => ({
  id: String(i),
  kind,
  start: h(start),
  end: end == null ? null : h(end),
  outcome,
});
const fix = (n: number, created: number, merged?: number, closed?: number) => ({
  id: `axiom-encode#${n}`,
  created: h(created),
  merged: merged == null ? null : h(merged),
  closed: closed == null ? null : h(closed),
});
const rs = (n: number, created: number, merged?: number, failing = false, version = "0.2.2302") => ({
  id: `rulespec-us#${n}`,
  created: h(created),
  merged: merged == null ? null : h(merged),
  closed: null,
  repo: "rulespec-us",
  candidate_version: version,
  checks_failing: failing,
});
const PINS: Record<string, Pin[]> = { "rulespec-us": [{ at: Date.parse("2026-09-01T00:00:00Z"), version: "0.2.2248" }] };

describe("stateAt and timeline", () => {
  it("follows the loop from refusal to landing", () => {
    const a: Attempt = { runs: [run(1, 0, 1, "failure"), run(2, 10, 11, "success")], fixPrs: [fix(10, 2, 5)], rulespecPrs: [rs(20, 12, 40)] };
    expect(stateAt(a, h(0.5))[0]).toBe("generating");
    expect(stateAt(a, h(1.5))[0]).toBe("refused-waiting-fix");
    expect(stateAt(a, h(3))[0]).toBe("fix-PR-in-review");
    expect(stateAt(a, h(6))[0]).toBe("waiting-rerun");
    expect(stateAt(a, h(11.5))[0]).toBe("signed-waiting-rulespec-PR");
    expect(stateAt(a, h(13))[0]).toBe("rulespec-PR-open");
    expect(stateAt(a, h(41))[0]).toBe("landed");
    expect(stateAt(a, h(-1))).toEqual([null, "no activity yet"]);
  });

  it("blocks on the pin only when the PR has failing checks", () => {
    const a: Attempt = { runs: [run(1, 0, 1, "success")], fixPrs: [], rulespecPrs: [rs(20, 2, undefined, true)] };
    const [state, why] = stateAt(a, h(3), PINS);
    expect(state).toBe("blocked-on-pin");
    expect(why).toContain("0.2.2302 vs pin 0.2.2248");
    a.rulespecPrs[0].checks_failing = false;
    expect(stateAt(a, h(3), PINS)[0]).toBe("rulespec-PR-open");
    a.rulespecPrs[0].checks_failing = true;
    a.rulespecPrs[0].candidate_version = "0.2.2248";
    expect(stateAt(a, h(3), PINS)[0]).toBe("rulespec-PR-open");
  });

  it("abandons after seven quiet days and keeps what it waited on", () => {
    expect(ABANDON_AFTER_MS).toBe(7 * 24 * 3_600_000);
    const a: Attempt = { runs: [run(1, 0, 1, "failure")], fixPrs: [fix(10, 2)], rulespecPrs: [] };
    expect(stateAt(a, h(2 + 7 * 24 - 1))[0]).toBe("fix-PR-in-review");
    const [state, why] = stateAt(a, h(2 + 7 * 24));
    expect(state).toBe("abandoned");
    expect(why).toContain("last state fix-PR-in-review");
    const t = target([...runEvents("101", 0, 1, ["ci: no"]), ...fixEvents(10, "101", 2)], h(2 + 8 * 24));
    expect(t.state).toBe("abandoned");
    expect(t.waiting_on).toBe("fix-PR-in-review");
  });

  it("opens a new cycle with a run after landing", () => {
    const a: Attempt = { runs: [run(1, 0, 1, "success"), run(2, 100, 101, "failure")], fixPrs: [], rulespecPrs: [rs(20, 2, 3)] };
    expect(stateAt(a, h(50))[0]).toBe("landed");
    expect(stateAt(a, h(100.5))[0]).toBe("generating");
    expect(stateAt(a, h(102))[0]).toBe("refused-waiting-fix");
  });

  it("waits for a signed run after a local success, and for a rerun after a cancel", () => {
    expect(stateAt({ runs: [run(1, 0, 1, "success", "local")], fixPrs: [], rulespecPrs: [] }, h(2))[0]).toBe("waiting-rerun");
    expect(stateAt({ runs: [run(1, 0, 1, "cancelled")], fixPrs: [], rulespecPrs: [] }, h(2))[0]).toBe("waiting-rerun");
    expect(stateAt({ runs: [], fixPrs: [fix(10, 0, 1)], rulespecPrs: [] }, h(2))).toEqual(["waiting-rerun", "axiom-encode#10 merged after the last run"]);
  });

  it("covers first activity to now without gaps", () => {
    const a: Attempt = { runs: [run(1, 0, 1, "failure"), run(2, 10, 11, "success")], fixPrs: [fix(10, 2, 5)], rulespecPrs: [] };
    const tl = timeline(a, h(20));
    expect(tl.map((s) => s.state)).toEqual(["generating", "refused-waiting-fix", "fix-PR-in-review", "waiting-rerun", "generating", "signed-waiting-rulespec-PR"]);
    expect(tl.reduce((s, x) => s + x.hours, 0)).toBeCloseTo(20);
    tl.slice(1).forEach((s, i) => expect(s.start).toBe(tl[i].end));
    expect(timeline({ runs: [], fixPrs: [], rulespecPrs: [] }, h(1))).toEqual([]);
  });

  it("lists the nine states", () => {
    expect(PAIRING_STATES).toEqual([
      "generating",
      "refused-waiting-fix",
      "fix-PR-in-review",
      "waiting-rerun",
      "signed-waiting-rulespec-PR",
      "rulespec-PR-open",
      "blocked-on-pin",
      "landed",
      "abandoned",
    ]);
  });
});

// --- aggregates ------------------------------------------------------------------

describe("buildPairing aggregates", () => {
  it("counts refusals by gate, fix PRs per landing, time per state and the stuck targets", () => {
    const a = "us/regulation/7/273/7";
    const b = "us/regulation/7/273/9";
    const c = "us-or/manual/odhs/open/page-26";
    const events = [
      // a: refused twice (deferral, then tests), a fix, a pass, landed.
      ...runEvents("101", 0, 2, ["x.yaml: ci: [complete-source-unit:deferral] d", "x.yaml: ci: [complete-source-unit:tests] t"]),
      ...fixEvents(10, "101", 3, { merged: 4 }),
      ...runEvents("102", 5, 6, ["x.yaml: ci: [complete-source-unit:tests] t", null]),
      ...rulespecPrEvents("102", 7, { merged: 8 }),
      // b: refused once, a fix still open.
      ...runEvents("201", 0, 1, ["x.yaml: compile: Axiom rules engine compile failed"]).map((e) => ({ ...e, citation: b })),
      ...fixEvents(11, "201", 2).map((e) => ({ ...e, citation: b })),
      // c: refused once, nothing since.
      ...runEvents("301", 10, 11, ["ci: no"]).map((e) => ({ ...e, citation: c, jurisdiction: "us-or" })),
    ];
    const { targets, aggregates } = buildPairing(events, { now: h(20) });
    expect(targets.map((t) => [t.citation, t.state])).toEqual([
      [b, "fix-PR-in-review"],
      [c, "refused-waiting-fix"],
      [a, "landed"],
    ]);
    expect(targets.find((t) => t.citation === c)?.jurisdiction).toBe("us-or");
    expect(aggregates).toMatchObject({ targets: 3, runs: 4, landed: 1, landed_now: 1, state_counts: { landed: 1, "fix-PR-in-review": 1, "refused-waiting-fix": 1 } });
    expect(aggregates.refusals_by_gate).toEqual({
      all_tries: { "companion-tests": 2, "source-completeness": 1, compile: 1, "ci-other": 1 },
      final_try: { "companion-tests": 1, compile: 1, "ci-other": 1 },
      earlier_tries: { "source-completeness": 1, "companion-tests": 1 },
      failed_runs: { "companion-tests": 1, compile: 1, "ci-other": 1 },
    });
    expect(aggregates.fix_prs_per_landing).toEqual({ landed: 1, fix_prs_on_landed: 1, mean: 1, median: 1, all_linked_per_landed: 2 });
    expect(aggregates.hours_in_state["fix-PR-in-review"]).toEqual({ targets: 2, median_hours: 9.5, total_hours: 19 });
    expect(aggregates.top_stuck.map((s) => [s.citation, s.state, s.hours])).toEqual([
      [b, "fix-PR-in-review", 18],
      [c, "refused-waiting-fix", 9],
    ]);
    expect(buildPairing(events, { now: h(20), topStuck: 1 }).aggregates.top_stuck).toHaveLength(1);
  });

  it("has no ratio without a landing", () => {
    const { aggregates } = buildPairing(runEvents("101", 0, 1, ["ci: no"]), { now: new Date(h(2)) });
    expect(aggregates.fix_prs_per_landing).toEqual({ landed: 0, fix_prs_on_landed: 0, mean: null, median: null, all_linked_per_landed: null });
  });
});

describe("helpers", () => {
  it("takes the median to one decimal", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2])).toBe(1.5);
  });

  it("labels times in New York time with the zone", () => {
    expect(nyLabel("2026-11-08T23:39:00Z")).toBe("2026-11-08 18:39 EST");
    expect(nyLabel(Date.parse("2026-10-01T12:00:00Z"))).toBe("2026-10-01 08:00 EDT");
  });
});
