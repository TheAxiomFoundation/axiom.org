import { describe, expect, it } from "vitest";
import { dependentAttempt, mergedAttempt, outsideAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import {
  acceptedBrief,
  acceptedModules,
  acceptedSeries,
  bundleProgram,
  citationPrograms,
  isoWeek,
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

describe("acceptedModules", () => {
  it("counts a module merged to main that compiles and passes its tests", () => {
    const events = tagPrograms(attemptEvents(mergedAttempt(accepted)), index);
    expect(acceptedModules(events)).toEqual([
      {
        key: "rulespec-us:us/statutes/7/2017/a.yaml",
        repo: "rulespec-us",
        path: "us/statutes/7/2017/a.yaml",
        citation: "us/statute/7/2017/a",
        case_id: "1001",
        route: "pipeline",
        programs: ["snap", "tanf"],
        accepted_at: "2026-09-21T09:00:00Z",
        week: "2026-09-21",
      },
    ]);
  });

  it("leaves out waived, failing, unmerged and unswept modules", () => {
    const rows = [
      mergedAttempt({ ...accepted, id: "w", tests_status: "waived", compile_status: "skipped" }),
      mergedAttempt({ ...accepted, id: "c", compile_status: "exec_error" }),
      mergedAttempt({ ...accepted, id: "t", tests_status: "fail" }),
      mergedAttempt({ ...accepted, id: "i", index_status: "missing", compile_status: null, compile_checked_at: null }),
      mergedAttempt({ ...accepted, id: "s", pr_targets_default: false, pr_via_state: "open" }),
      pipelineAttempt({ id: "r" }),
    ];
    expect(acceptedModules(rows.flatMap(attemptEvents))).toEqual([]);
  });

  it("splits routes, counts a module once at its first accepting merge, and marks untagged cases", () => {
    const rows = [
      mergedAttempt({ ...accepted, id: "late", pr_merged_at: "2026-10-05T09:00:00Z" }),
      mergedAttempt({ ...accepted, id: "early" }),
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
    const modules = acceptedModules(rows.flatMap(attemptEvents));
    expect(modules.map((m) => [m.path, m.case_id, m.route, m.programs.join()])).toEqual([
      ["us/statutes/7/2017/a.yaml", "early", "pipeline", UNTAGGED],
      ["us/policies/usitc/ch01.yaml", "pr:rulespec-us#900:us/statutes/7/2017/a.yaml", "hand", UNTAGGED],
      ["us/statutes/42/402/q.yaml", "dep:5e2a7c10", "pipeline", UNTAGGED],
    ]);
  });
});

describe("acceptedSeries", () => {
  it("counts weeks by route and program, empty weeks included", () => {
    const events = tagPrograms(
      [
        mergedAttempt(accepted),
        outsideAttempt({ ...accepted, citation: "us/policy/usitc/ch01", module_paths: ["us/policies/usitc/ch01.yaml"], pr_merged_at: "2026-10-06T09:00:00Z" }),
      ].flatMap(attemptEvents),
      index
    );
    const series = acceptedSeries(acceptedModules(events), Date.parse("2026-10-08T00:00:00Z"));
    expect(series.weeks.map((w) => w.week)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(series.weeks[0].programs).toEqual({ snap: { pipeline: 1, hand: 0 }, tanf: { pipeline: 1, hand: 0 } });
    expect(series.weeks[1].total).toEqual({ pipeline: 0, hand: 0 });
    expect(series.totals.total).toEqual({ pipeline: 1, hand: 1 });
    expect(series.programs).toEqual(["snap", "tanf", OUT_OF_PLAN]);
    expect(acceptedBrief(series)).toContain("| out_of_plan | 0 | 1 |");
    expect(acceptedSeries([]).weeks).toEqual([]);
  });

  it("dates a week from Monday, UTC", () => {
    expect(isoWeek("2026-09-27T23:59:00Z")).toBe("2026-09-21");
    expect(isoWeek("2026-09-28T00:00:00Z")).toBe("2026-09-28");
  });
});
