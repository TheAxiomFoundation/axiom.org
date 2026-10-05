import { describe, expect, it } from "vitest";
import { runRow, runRows } from "./encoding-pipeline-runs";
import { runLedger, sectionStatus } from "./run-ledger";
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
