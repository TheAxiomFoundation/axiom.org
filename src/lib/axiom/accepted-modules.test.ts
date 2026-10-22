import { describe, expect, it } from "vitest";
import { dependentAttempt, mergedAttempt, outsideAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import {
  acceptedBrief,
  acceptedSeries,
  bundleProgram,
  citationPrograms,
  isoWeek,
  moduleLedger,
  OUT_OF_PLAN,
  programIndex,
  tagPrograms,
  UNTAGGED,
} from "./accepted-modules";
import { attemptEvents } from "./pipeline-events";

const accepted = {
  synced_at: "2026-09-21T10:00:00Z",
  index_status: "indexed" as const,
  compile_status: "ok",
  compile_checked_at: "2026-09-22T03:00:00Z",
  tests_status: "pass" as const,
  tests_first_at: "2026-09-21T09:30:00Z",
};

const index = programIndex([
  { bundle_id: "us/snap", citation_path: "us/statute/7/2017" },
  { bundle_id: "us-or/snap", citation_path: "us/statute/7/2017/a" },
  { bundle_id: "us/tanf", citation_path: "us/statute/7/2017/a" },
  { bundle_id: "us/medicaid", citation_path: null },
]);

describe("programs", () => {
  it("reads the program from the bundle id", () => {
    expect(bundleProgram("us-or/snap")).toBe("snap");
    expect(bundleProgram("us/income_tax")).toBe("income_tax");
  });

  it("finds the programs of a citation and of the paths above it", () => {
    expect(citationPrograms("us/statute/7/2017/a/1", index)).toEqual(["snap", "tanf"]);
    expect(citationPrograms("us/statute/7/2017/b", index)).toEqual(["snap"]);
    expect(citationPrograms("us/policy/usitc/ch01", index)).toEqual([OUT_OF_PLAN]);
  });

  it("tags every event of a case, and leaves encoder changes alone", () => {
    const events = attemptEvents(mergedAttempt());
    const change = { ...events[0], id: "c", case_id: "pr:axiom-encode#1", citation: "axiom-encode", source: "encoder_change" as const, attrs: {} };
    tagPrograms([...events, change], index);
    expect(events.every((e) => (e.attrs.programs as string[]).join() === "snap,tanf")).toBe(true);
    expect(change.attrs).toEqual({});
  });
});

describe("moduleLedger", () => {
  it("accepts a module merged to main that compiles and passes its tests", () => {
    const events = tagPrograms(attemptEvents(mergedAttempt(accepted)), index);
    expect(moduleLedger(events).accepted).toEqual([
      {
        key: "rulespec-us:us/statutes/7/2017/a.yaml",
        repo: "rulespec-us",
        path: "us/statutes/7/2017/a.yaml",
        citation: "us/statute/7/2017/a",
        case_id: "1001",
        route: "pipeline",
        sub_route: "dispatch",
        programs: ["snap", "tanf"],
        accepted_at: "2026-09-21T09:00:00Z",
        week: "2026-09-21",
      },
    ]);
  });

  it("splits failed modules from those not measured, and ignores unmerged ones", () => {
    const at = (id: string) => ({ ...accepted, id, module_paths: [`us/statutes/${id}.yaml`] });
    const rows = [
      mergedAttempt({ ...at("waived"), tests_status: "waived", compile_status: "skipped" }),
      mergedAttempt({ ...at("compile"), compile_status: "exec_error" }),
      mergedAttempt({ ...at("tests"), tests_status: "fail" }),
      mergedAttempt({ ...at("unindexed"), index_status: "missing", compile_status: null, compile_checked_at: null, tests_status: null }),
      mergedAttempt({ ...at("unswept"), compile_status: null, compile_checked_at: null }),
      mergedAttempt({ ...at("side"), pr_targets_default: false, pr_via_state: "open" }),
      pipelineAttempt({ id: "run" }),
    ];
    const ledger = moduleLedger(rows.flatMap(attemptEvents));
    expect(ledger.accepted).toEqual([]);
    expect(ledger.not_accepted.map((m) => m.case_id).sort()).toEqual(["compile", "tests", "waived"]);
    expect(ledger.not_measured.map((m) => m.case_id).sort()).toEqual(["unindexed", "unswept"]);
  });

  it("counts a module once at its first accepting merge, later merges as rework, with sub-routes", () => {
    const rows = [
      mergedAttempt({ ...accepted, id: "late", pr_merged_at: "2026-10-05T09:00:00Z", tests_status: "fail" }),
      mergedAttempt({ ...accepted, id: "early" }),
      mergedAttempt({ ...accepted, id: "before", pr_merged_at: "2026-09-10T09:00:00Z", compile_status: null, compile_checked_at: null }),
      outsideAttempt({ ...accepted, module_paths: ["us/policies/usitc/ch01.yaml"] }),
      dependentAttempt({
        ...accepted,
        run_conclusion: "success",
        pr_repo: "rulespec-us",
        pr_state: "merged",
        pr_targets_default: true,
        pr_created_at: "2026-09-23T09:00:00Z",
        pr_merged_at: "2026-09-24T09:00:00Z",
        module_paths: ["us/statutes/42/402/q.yaml"],
      }),
    ];
    const ledger = moduleLedger(rows.flatMap(attemptEvents));
    expect(ledger.accepted.map((m) => [m.path, m.case_id, m.route, m.sub_route, m.programs.join()])).toEqual([
      ["us/statutes/7/2017/a.yaml", "early", "pipeline", "dispatch", UNTAGGED],
      ["us/policies/usitc/ch01.yaml", "pr:rulespec-us#900:us/statutes/7/2017/a.yaml", "hand", "hand", UNTAGGED],
      ["us/statutes/42/402/q.yaml", "dep:5e2a7c10", "pipeline", "dep", UNTAGGED],
    ]);
    expect(ledger.rework.map((r) => [r.case_id, r.week])).toEqual([["late", "2026-10-05"]]);
    expect(ledger.not_measured).toEqual([]);
  });
});

describe("acceptedSeries", () => {
  it("counts weeks by route, sub-route and program, with rework and not measured beside", () => {
    const events = tagPrograms(
      [
        mergedAttempt(accepted),
        mergedAttempt({ ...accepted, id: "again", pr_merged_at: "2026-09-29T09:00:00Z" }),
        mergedAttempt({ ...accepted, id: "dk", pr_repo: "rulespec-dk", index_status: "missing", compile_status: null, compile_checked_at: null, tests_status: null }),
        outsideAttempt({ ...accepted, citation: "us/policy/usitc/ch01", module_paths: ["us/policies/usitc/ch01.yaml"], pr_merged_at: "2026-10-06T09:00:00Z" }),
      ].flatMap(attemptEvents),
      index
    );
    const series = acceptedSeries(moduleLedger(events), Date.parse("2026-10-08T00:00:00Z"));
    expect(series.weeks.map((w) => w.week)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(series.weeks[0].programs).toEqual({
      snap: { pipeline: 1, dispatch: 1, dep: 0, hand: 0 },
      tanf: { pipeline: 1, dispatch: 1, dep: 0, hand: 0 },
    });
    expect(series.weeks[1].total).toEqual({ pipeline: 0, dispatch: 0, dep: 0, hand: 0 });
    expect(series.weeks[1].rework).toEqual({ pipeline: 1, dispatch: 1, dep: 0, hand: 0 });
    expect(series.totals.total).toEqual({ pipeline: 1, dispatch: 1, dep: 0, hand: 1 });
    expect(series.totals.not_measured).toEqual({ pipeline: 1, dispatch: 1, dep: 0, hand: 0 });
    expect(series.totals.not_measured_by_repo).toEqual({ "rulespec-dk": 1 });
    expect(series.programs).toEqual(["snap", "tanf", OUT_OF_PLAN]);
    const brief = acceptedBrief(series);
    expect(brief).toContain("| out_of_plan | 0 | 0 | 1 |");
    expect(brief).toContain("Not measured (merged, no compile or test result): 1 (rulespec-dk 1).");
    expect(brief).toContain("Rework (later merges of accepted modules): 1.");
    expect(acceptedSeries({ accepted: [], rework: [], not_measured: [], not_accepted: [] }).weeks).toEqual([]);
  });

  it("dates a week from Monday, UTC", () => {
    expect(isoWeek("2026-09-27T23:59:00Z")).toBe("2026-09-21");
    expect(isoWeek("2026-09-28T00:00:00Z")).toBe("2026-09-28");
  });
});
