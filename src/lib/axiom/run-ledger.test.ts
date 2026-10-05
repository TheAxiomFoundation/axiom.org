import { describe, expect, it } from "vitest";
import { runRow, runRows } from "./encoding-pipeline-runs";
import { causeHeadline, runLedger, sectionOverview, sectionStatus } from "./run-ledger";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T10:00:00Z`;

describe("sectionStatus", () => {
  it("reads a section's status from its latest run", () => {
    const status = (overrides: Parameters<typeof pipelineAttempt>[0]) => sectionStatus(runRow(pipelineAttempt(overrides)));
    expect(status({ run_status: "waiting", run_conclusion: null })).toEqual({ status: "Waiting for approval", tone: "waiting" });
    expect(status({ encoder_error_rule: "rule-a", failure_source: "diagnostics" })).toEqual({ status: "Validation rules", tone: "failed" });
    expect(status({ run_conclusion: "cancelled", cancel_stage: "approval" })).toEqual({ status: "Cancelled at approval", tone: "failed" });
    expect(status({ run_conclusion: "success" })).toEqual({ status: "No PR", tone: "failed" });
    expect(status({ run_conclusion: "success", pr_state: "draft", pr_url: "u" })).toEqual({ status: "In review", tone: "waiting" });
    expect(status({ run_conclusion: "success", pr_state: "closed", pr_url: "u" })).toEqual({ status: "PR closed", tone: "failed" });
    const merged = (overrides: Parameters<typeof mergedAttempt>[0]) => sectionStatus(runRow(mergedAttempt(overrides)));
    expect(merged({ pr_targets_default: false })).toEqual({ status: "Merged off main", tone: "failed" });
    expect(merged({ tests_status: "pass" })).toEqual({ status: "Tests pass", tone: "done" });
    expect(merged({ tests_status: "fail" })).toEqual({ status: "Tests fail", tone: "failed" });
    expect(merged({ index_status: "missing" })).toEqual({ status: "Not in the index", tone: "failed" });
    expect(merged({})).toEqual({ status: "In main", tone: "waiting" });
  });
});

describe("runLedger", () => {
  it("groups runs by jurisdiction, document, and section, newest activity first", () => {
    const rows = runRows([
      pipelineAttempt({ id: "a1", citation: "us/statute/7/2015/f", jurisdiction: "us", dispatched_at: day(1) }),
      mergedAttempt({ id: "a2", citation: "us/statute/7/2015/f", jurisdiction: "us", dispatched_at: day(3), tests_status: "pass" }),
      pipelineAttempt({ id: "b", citation: "us/statute/7/2017/a", jurisdiction: "us", dispatched_at: day(2) }),
      pipelineAttempt({ id: "c", citation: "us/regulation/7/273/4", jurisdiction: "us", dispatched_at: day(4) }),
      pipelineAttempt({ id: "d", citation: "us-la/statute/47/32", jurisdiction: "us-la", dispatched_at: day(1) }),
    ]);
    const ledger = runLedger(
      rows,
      { "us/statute/7": "Agriculture", "us/statute/7/2015/f": "Disqualification", "us/statute/7/2015": "Eligibility" },
      {}
    );
    expect(ledger.map((j) => j.name)).toEqual(["US Federal", "Louisiana"]);
    const [federal] = ledger;
    expect(federal.documents.map((d) => [d.key, d.title, d.titled])).toEqual([
      ["us:regulation/7", "7", false],
      ["us:statute/7", "Agriculture", true],
    ]);
    const statute = federal.documents[1];
    expect(statute.sections.map((s) => [s.designator, s.label, s.status, s.runs.map((r) => r.id)])).toEqual([
      ["2015/f", "Disqualification", "Tests pass", ["a2", "a1"]],
      ["2017/a", null, "Cause not looked up yet", ["b"]],
    ]);
    expect(statute.lastAt).toBe(day(3));
  });

  it("takes a citation's source document from the corpus when it is known", () => {
    const rows = runRows([pipelineAttempt({ id: "x", citation: "us/guidance/usda/fns/snap-fy2026-cola/page-1", jurisdiction: "us" })]);
    const ledger = runLedger(
      rows,
      { "us/guidance/usda/fns/snap-fy2026-cola": "SNAP FY 2026 Maximum Allotments" },
      { "us/guidance/usda/fns/snap-fy2026-cola/page-1": "us/guidance/usda/fns/snap-fy2026-cola" }
    );
    const [document] = ledger[0].documents;
    expect([document.key, document.title, document.sections[0].designator]).toEqual([
      "us:guidance/usda/fns/snap-fy2026-cola",
      "SNAP FY 2026 Maximum Allotments",
      "page-1",
    ]);
  });
});

describe("sectionOverview", () => {
  it("sums a section's runs: span, encoders, where they ended, why they failed, and the latest", () => {
    const rows = runRows([
      pipelineAttempt({ id: "1", citation: "us/statute/42/416/l", dispatched_at: day(1), encoder_version: "0.2.2018", encoder_error_rule: "complete-source-unit:tests", failure_source: "diagnostics" }),
      pipelineAttempt({ id: "2", citation: "us/statute/42/416/l", dispatched_at: day(2), encoder_version: "0.2.2023", encoder_error_rule: "complete-source-unit:tests", failure_source: "diagnostics" }),
      pipelineAttempt({ id: "3", citation: "us/statute/42/416/l", dispatched_at: day(3), encoder_version: "0.2.2033", failed_step: "compile", encoder_error: "compile: engine failed", failure_source: "log" }),
      mergedAttempt({ id: "4", citation: "us/statute/42/416/l", dispatched_at: day(4), encoder_version: "0.2.2087", pr_targets_default: false }),
    ]);
    const [section] = runLedger(rows)[0].documents[0].sections;
    const overview = sectionOverview(section);
    expect(overview).toMatchObject({ runs: 4, firstAt: day(1), lastAt: day(4), encoders: { from: "0.2.2018", to: "0.2.2087" } });
    expect(overview.ended.map((e) => `${e.label}:${e.tone}:${e.count}`)).toEqual([
      "Validation rules:failed:2",
      "Merged off main:failed:1",
      expect.stringMatching(/:failed:1$/),
    ]);
    expect(overview.causes[0]).toEqual({ label: "Completeness rule: tests", count: 2, detail: "complete-source-unit:tests" });
    expect(overview.latest.id).toBe("4");
  });
});

describe("causeHeadline", () => {
  it("names a failure in a few words, without where it came from", () => {
    expect(causeHeadline("complete-source-unit:structure")).toBe("Completeness rule: structure");
    expect(causeHeadline("ci: Ungrounded generated numeric literal: N does not appear as a substantive numeric value in the source text.")).toBe(
      "Ungrounded generated numeric literal"
    );
    expect(causeHeadline("ci: Test case … execution failed: derived … has no formula version at N-N-N")).toBe("Test case … execution failed");
    expect(causeHeadline("ci: Test case … output … expected integer N, got decimal N.")).toBe("Test case … output … expected integer N, got decimal N");
    expect(causeHeadline("compile: Axiom rules engine compile failed: failed to load RuleSpec module …")).toBe("Axiom rules engine compile failed");
    expect(causeHeadline("RuntimeError: reviewed candidate validation produced …")).toBe("reviewed candidate validation produced …");
    expect(causeHeadline("x".repeat(100))).toHaveLength(72);
  });
});
