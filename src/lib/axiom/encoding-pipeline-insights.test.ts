import { describe, expect, it } from "vitest";
import {
  attemptJurisdiction,
  checkErrorGroups,
  compareVersions,
  inScope,
  parseScope,
  pipelineFunnel,
  pipelineInsights,
  rootJurisdiction,
  runStats,
  scopeOptions,
  versionBins,
} from "./encoding-pipeline-insights";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T10:00:00Z`;

describe("pipelineFunnel", () => {
  it("counts citations by the furthest any dispatch got", () => {
    expect(
      pipelineFunnel([
        pipelineAttempt({ id: "a1", citation: "us/a" }),
        mergedAttempt({ id: "a2", citation: "us/a", tests_status: "pass" }),
        mergedAttempt({ id: "b1", citation: "us/b", pr_targets_default: false }),
        mergedAttempt({ id: "c1", citation: "us/c", tests_status: "fail" }),
        pipelineAttempt({ id: "d1", citation: "us/d", run_conclusion: "success" }),
        pipelineAttempt({ id: "e1", citation: "us/e" }),
      ])
    ).toEqual({ citations: 5, encoded: 4, merged: 3, mergedMain: 2, passing: 1 });
  });
});

describe("runStats", () => {
  it("rates first attempts and each retry, ranks re-dispatched citations, and totals cost", () => {
    const outcomes = ["failure", "failure", "success", "failure", "failure", "failure", "success"];
    const attempts = [
      ...outcomes.map((run_conclusion, i) =>
        pipelineAttempt({ id: `x${i}`, citation: "us/x", dispatched_at: day(i + 1), run_conclusion })
      ),
      pipelineAttempt({ id: "x-cancel", citation: "us/x", dispatched_at: day(20), run_conclusion: "cancelled" }),
      pipelineAttempt({ id: "x-run", citation: "us/x", dispatched_at: day(21), run_status: "in_progress", run_conclusion: null }),
      mergedAttempt({ id: "y1", citation: "us/y", dispatched_at: day(1), cost_usd: 0.25 }),
      pipelineAttempt({ id: "y2", citation: "us/y", dispatched_at: day(2), cost_usd: 1.5 }),
      pipelineAttempt({ id: "y3", citation: "us/y", dispatched_at: day(3), run_conclusion: "cancelled", cost_usd: 0.5 }),
      pipelineAttempt({ id: "z1", citation: "us/z", dispatched_at: day(1), run_conclusion: "success" }),
    ];
    const stats = runStats(attempts);
    expect(stats.firstAttempt).toEqual({ success: 2, total: 3 });
    expect(stats.byAttempt).toEqual([
      { label: "1st", success: 2, total: 3 },
      { label: "2nd", success: 0, total: 2 },
      { label: "3rd", success: 1, total: 1 },
      { label: "4th", success: 0, total: 1 },
      { label: "5th", success: 0, total: 1 },
      { label: "6th+", success: 1, total: 2 },
    ]);
    expect(stats.mostDispatched).toEqual([
      { citation: "us/x", dispatches: 9, successes: 2, merged: 0 },
      { citation: "us/y", dispatches: 3, successes: 1, merged: 1 },
    ]);
    expect(stats.cost).toEqual({ recorded: 3, finished: 10, total: 2.25, onFailures: 1.5 });
  });

  it("leaves out attempt places nobody reached, and ranks nothing below three dispatches", () => {
    const stats = runStats([pipelineAttempt({ citation: "us/a" }), pipelineAttempt({ id: "2", citation: "us/a", dispatched_at: day(25) })]);
    expect(stats.byAttempt.map((b) => b.label)).toEqual(["1st", "2nd"]);
    expect(stats.mostDispatched).toEqual([]);
  });
});

describe("encoder versions", () => {
  it("orders versions numerically", () => {
    expect(["0.2.2080", "0.2.999", "0.2.1000", "0.10", "0.2"].sort(compareVersions)).toEqual([
      "0.2",
      "0.2.999",
      "0.2.1000",
      "0.2.2080",
      "0.10",
    ]);
    expect(compareVersions("0.2.rc1", "0.2.rc2")).toBeLessThan(0);
    expect(compareVersions("1.0", "1.0")).toBe(0);
  });

  it("pools consecutive versions until each bin holds ten finished runs, newest bins last", () => {
    const runs = (version: string, count: number, successes: number, at: string) =>
      Array.from({ length: count }, (_, i) =>
        pipelineAttempt({
          id: `${version}-${i}`,
          citation: `us/${version}/${i}`,
          encoder_version: version,
          dispatched_at: at,
          run_conclusion: i < successes ? "success" : "failure",
        })
      );
    const bins = versionBins([
      ...runs("0.2.10", 7, 1, day(5)),
      ...runs("0.2.9", 4, 2, day(4)),
      ...runs("0.2.11", 12, 6, day(6)),
      ...runs("0.2.12", 2, 2, day(7)),
      pipelineAttempt({ id: "none", encoder_version: null }),
      pipelineAttempt({ id: "cancelled", encoder_version: "0.2.12", run_conclusion: "cancelled" }),
    ]);
    expect(bins).toEqual([
      { from: "0.2.9", to: "0.2.10", runs: 11, successes: 3, lastAt: day(5) },
      { from: "0.2.11", to: "0.2.11", runs: 12, successes: 6, lastAt: day(6) },
      { from: "0.2.12", to: "0.2.12", runs: 2, successes: 2, lastAt: day(7) },
    ]);
    const many = Array.from({ length: 12 }, (_, v) => runs(`1.${v}`, 10, 0, day(1))).flat();
    expect(versionBins(many).map((bin) => bin.from)).toEqual(
      Array.from({ length: 8 }, (_, i) => `1.${i + 4}`)
    );
  });
});

describe("checkErrorGroups", () => {
  it("groups PRs in review by what their failing check printed, setting paths, hashes, and counts aside", () => {
    const review = (id: string, error: string | null) =>
      pipelineAttempt({
        id,
        citation: `dk/${id}`,
        run_conclusion: "success",
        pr_state: "draft",
        pr_created_at: day(1),
        pr_url: `https://github.com/x/pull/${id}`,
        pr_check_error: error,
      });
    const groups = checkErrorGroups(
      [
        review("a", "- dk/a.json validation_execution.axiom_encode does not match the running pinned encoder"),
        review("b", "- dk/b.json validation_execution.axiom_encode does not match the running pinned encoder"),
        review("c", "+ ] 3 failed, 25 passed in 85.50s (0:01:25)"),
        review("d", "+ ] 3 failed, 25 passed in 56.50s"),
        review("e", "commit 0123456789abcdef is stale"),
        review("f", null),
        pipelineAttempt({ id: "g", citation: "dk/g", pr_check_error: "not in review" }),
      ],
      NOW
    );
    expect(groups.map((g) => [g.label, g.count, g.items.map((i) => i.citation)])).toEqual([
      ["- … validation_execution.axiom_encode does not match the running pinned encoder", 2, ["dk/a", "dk/b"]],
      ["+ ] 3 failed, 25 passed in 85.50s (0:01:25)", 2, ["dk/c", "dk/d"]],
      ["commit … is stale", 1, ["dk/e"]],
    ]);
  });
});

describe("pipelineInsights", () => {
  it("bundles every read", () => {
    const insights = pipelineInsights([pipelineAttempt()], NOW);
    expect(insights.funnel.citations).toBe(1);
    expect(insights.runs.firstAttempt.total).toBe(1);
    expect(insights).toMatchObject({ versions: [], checkErrors: [] });
  });
});

describe("scopes", () => {
  it("reads the scope from the URL", () => {
    expect(parseScope({})).toBeNull();
    expect(parseScope({ j: " US " })).toEqual({ jurisdiction: "us", only: false });
    expect(parseScope({ j: ["us-nc:manual"], only: ["1"] })).toEqual({ jurisdiction: "us-nc:manual", only: true });
    expect(parseScope({ j: "us", only: "yes" })).toEqual({ jurisdiction: "us", only: false });
    expect(parseScope({ j: "../etc" })).toBeNull();
  });

  it("matches a jurisdiction and those under it, or that one alone", () => {
    expect(inScope("us-la", null)).toBe(true);
    expect(inScope("us-la", { jurisdiction: "us", only: false })).toBe(true);
    expect(inScope("usx", { jurisdiction: "us", only: false })).toBe(false);
    expect(inScope("us-la", { jurisdiction: "us", only: true })).toBe(false);
    expect(inScope("us", { jurisdiction: "us", only: true })).toBe(true);
    expect(rootJurisdiction("uk-wakefield")).toBe("uk");
    expect(attemptJurisdiction({ jurisdiction: null, citation: "dk/statute/x" })).toBe("dk");
  });

  it("offers each top-level jurisdiction, and the ones within the selected", () => {
    const attempts = [
      pipelineAttempt({ id: "1", citation: "us/a", jurisdiction: "us" }),
      pipelineAttempt({ id: "2", citation: "us/a", jurisdiction: "us" }),
      pipelineAttempt({ id: "3", citation: "us-la/b", jurisdiction: "us-la" }),
      pipelineAttempt({ id: "4", citation: "us-la/c", jurisdiction: "us-la" }),
      pipelineAttempt({ id: "5", citation: "dk/d", jurisdiction: "dk" }),
      pipelineAttempt({ id: "6", citation: "be/e", jurisdiction: "be" }),
    ];
    const all = scopeOptions(attempts, null);
    expect(all.roots.map((o) => [o.label, o.citations])).toEqual([
      ["us", 3],
      ["be", 1],
      ["dk", 1],
    ]);
    expect(all.within).toEqual([]);
    expect(scopeOptions(attempts, { jurisdiction: "us-la", only: false }).within).toEqual([
      { jurisdiction: "us", only: true, label: "us only", citations: 1 },
      { jurisdiction: "us-la", only: false, label: "us-la", citations: 2 },
    ]);
    expect(scopeOptions(attempts, { jurisdiction: "dk", only: false }).within).toEqual([]);
  });
});
