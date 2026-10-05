import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineJourney } from "./pipeline-journey";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");

afterEach(cleanup);

describe("PipelineJourney", () => {
  it("shows the current stage and each dispatch's steps, newest first", () => {
    render(
      <PipelineJourney
        citation="us/statute/7/2017/a"
        available
        referenceMs={NOW}
        attempts={[
          mergedAttempt({ id: "2002", pr_targets_default: false, pr_base_branch: "codex/x", pr_merged_at: "2026-09-29T12:00:00Z", cost_usd: 0.021 }),
          pipelineAttempt({ id: "2001", encoder_error_rule: "rule-a", encoder_error: "detail" }),
          pipelineAttempt({
            id: "pr:rulespec-us#9",
            run_url: "https://github.com/x/pull/9",
            run_conclusion: "success",
            pr_state: "closed",
            pr_url: "https://github.com/x/pull/9",
            pr_created_at: "2026-09-20T10:29:00Z",
            pr_closed_at: "2026-09-20T12:00:00Z",
          }),
        ]}
      />
    );
    expect(screen.getByRole("heading", { level: 1, name: "us/statute/7/2017/a" })).toBeInTheDocument();
    expect(screen.getByText("Merged off main")).toBeInTheDocument();
    expect(screen.getByText(/for 24h\. 3 dispatches, the first Sep 20, 10:00 UTC\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read the law" })).toHaveAttribute("href", "/us/statute/7/2017/a");
    expect(screen.getByRole("heading", { name: "Latest dispatch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dispatch 2" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "run 2002" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR" })).toHaveAttribute("href", "https://github.com/x/pull/9");
    expect(screen.getByText(/\$0\.02/)).toBeInTheDocument();
    // Each dispatch as a timeline: the encode run on one clock, then the steps after its PR.
    expect(screen.getAllByRole("region", { name: "Encode run" })).toHaveLength(3);
    const [offMain, closed] = screen.getAllByRole("region", { name: "After the PR" });
    expect(within(offMain).getByText(/Into codex\/x, not the default branch$/)).toBeInTheDocument();
    expect(within(closed).getByRole("link", { name: "Closed" })).toHaveAttribute("href", "https://github.com/x/pull/9");
    expect(screen.getByText("Failed validation: rule-a — detail")).toBeInTheDocument();
  });

  it("follows a merge into main through the index, its tests, the compile sweep, and the oracle", () => {
    render(
      <PipelineJourney
        citation="us/statute/7/2017/a"
        available
        referenceMs={NOW}
        attempts={[
          mergedAttempt({
            synced_at: "2026-09-21T13:00:00Z",
            indexed_at: "2026-09-21T13:00:00Z",
            index_status: "indexed",
            module_paths: ["a.yaml", "b.yaml"],
            tests_status: "pass",
            tests_first_started_at: "2026-09-21T09:10:00Z",
            tests_first_at: "2026-09-21T10:00:00Z",
            tests_first_status: "pass",
            compile_status: "ok",
            oracle_status: "match",
            oracle_report: "r.json",
          }),
        ]}
      />
    );
    const after = screen.getByRole("region", { name: "After the PR" });
    expect(within(after).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Review22h 31mMerged · checks success · Into main",
      "Index4h2 modules",
      "Tests on main1hwait 10m · run 50m · first result pass",
      "Compiles and runs—",
      expect.stringMatching(/^Matches an oracle—/),
    ]);
  });

  it("explains an empty journey", () => {
    render(<PipelineJourney citation={null} attempts={[]} available referenceMs={NOW} />);
    expect(screen.getByText(/Pick a citation/)).toBeInTheDocument();
    cleanup();
    render(<PipelineJourney citation="us/x" attempts={[]} available referenceMs={NOW} />);
    expect(screen.getByText(/No targeted re-encode dispatch/)).toBeInTheDocument();
    cleanup();
    render(<PipelineJourney citation="us/x" attempts={[]} available={false} referenceMs={NOW} />);
    expect(screen.getByText(/not available yet/)).toBeInTheDocument();
  });

  it("falls back when the stage has no start time", () => {
    render(
      <PipelineJourney
        citation="us/x"
        available
        referenceMs={NOW}
        attempts={[pipelineAttempt({ pr_state: "open", pr_created_at: null })]}
      />
    );
    expect(screen.getByText(/for a moment\./)).toBeInTheDocument();
  });
});
