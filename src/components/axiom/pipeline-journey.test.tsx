import { cleanup, render, screen } from "@testing-library/react";
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
          pipelineAttempt({ id: "pr:rulespec-us#9", run_url: "https://github.com/x/pull/9", run_conclusion: "success", pr_state: "closed" }),
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
    expect(screen.getByText("Into codex/x, not the default branch")).toBeInTheDocument();
    expect(screen.getByText("rule-a — detail")).toBeInTheDocument();
    expect(screen.getAllByText("stopped here").length).toBeGreaterThan(0);
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
