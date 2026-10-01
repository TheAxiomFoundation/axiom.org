import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OpsPipeline } from "./ops-pipeline";
import { pipelineView } from "@/lib/axiom/encoding-pipeline";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");

afterEach(cleanup);

function renderPipeline(
  attempts = [
    pipelineAttempt({ id: "1", citation: "us/a", encoder_error_rule: "rule-a", encoder_error: "Source branch (a) is neither encoded nor deferred." }),
    pipelineAttempt({ id: "2", citation: "us/b", encoder_error_rule: "rule-a" }),
    pipelineAttempt({ id: "3", citation: "us/c", failed_step: "encode_apply", dispatched_at: "2026-09-29T00:00:00Z", finished_at: "2026-09-29T01:00:00Z" }),
    pipelineAttempt({ id: "4", citation: "us/d", pr_state: "draft", pr_repo: "rulespec-us", pr_number: 7, pr_url: "https://github.com/x/pull/7", pr_created_at: "2026-09-10T00:00:00Z", pr_checks: "failure", pr_review: "changes_requested" }),
    pipelineAttempt({ id: "5", citation: "us/d", pr_state: "open", pr_created_at: "2026-09-01T00:00:00Z", dispatched_at: "2026-09-01T00:00:00Z", synced_at: "2026-09-02T00:00:00Z" }),
    pipelineAttempt({ id: "6", citation: "us/e", run_conclusion: "success" }),
    mergedAttempt({ id: "7", citation: "us/f", pr_targets_default: false, pr_base_branch: "codex/x" }),
  ],
  queued: Parameters<typeof OpsPipeline>[0]["queued"] = {
    pending: 18615,
    queues: 2,
    inFlight: 0,
    blocked: 0,
    pausedReason: "Awaiting a green tip.",
  }
) {
  return render(
    <OpsPipeline view={pipelineView(attempts, NOW)} queued={queued} referenceMs={NOW} />
  );
}

describe("OpsPipeline", () => {
  it("lays out every stage with counts, stuck totals, and exits", () => {
    renderPipeline();
    const stages = screen.getByRole("list", { name: "Pipeline stages" });
    expect(within(stages).getByText("18,615")).toBeInTheDocument();
    expect(within(stages).getByText("paused")).toBeInTheDocument();
    expect(screen.getByText("Awaiting a green tip.")).toBeInTheDocument();
    expect(within(stages).getByRole("button", { name: /In review\s*1/ })).toBeInTheDocument();
    expect(within(stages).getByRole("button", { name: /3\s*last encode failed/ })).toBeInTheDocument();
    expect(within(stages).getByRole("button", { name: /1\s*encoded, no pr/ })).toBeInTheDocument();
    expect(within(stages).getByRole("button", { name: /1\s*merged off main/ })).toBeInTheDocument();
    expect(screen.getByText("+1 duplicate open PR")).toBeInTheDocument();
    expect(screen.getByText("sweep not running yet")).toBeInTheDocument();
    expect(screen.getByText(/6 citations across 7 dispatches since Sep 1, 2026/)).toBeInTheDocument();
  });

  it("opens on the biggest pile and filters it by failure reason", () => {
    renderPipeline();
    expect(screen.getByRole("button", { name: /Biggest pile: 3 last encode failed/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Last encode failed/ })).toBeInTheDocument();
    expect(screen.getByText("3 citations")).toBeInTheDocument();
    const reason = screen.getByRole("button", { name: /rule-a\s*2/ });
    fireEvent.click(reason);
    expect(reason).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("rule-a: 2 citations")).toBeInTheDocument();
    expect(screen.getByText("Source branch (a) is neither encoded nor deferred.")).toBeInTheDocument();
    fireEvent.click(reason);
    expect(screen.getByText("3 citations")).toBeInTheDocument();
  });

  it("shows a stage's items with their PR state and history", () => {
    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: /In review/ }));
    const item = screen.getByRole("link", { name: "us/d" });
    expect(item).toHaveAttribute("href", "/ops/journey?citation=us%2Fd");
    expect(screen.getByRole("link", { name: "rulespec-us#7" })).toHaveAttribute("href", "https://github.com/x/pull/7");
    expect(screen.getByText(/draft · checks failing · changes requested · 2 dispatches · 2 open PRs · an earlier encoding is in the index/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /merged off main/ }));
    expect(screen.getByText(/Merged into codex\/x/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Runs/ }));
    expect(screen.getByText("Nothing here right now.")).toBeInTheDocument();
  });

  it("charts weekly throughput with a hover readout and a table", () => {
    renderPipeline();
    expect(screen.getByText(/of finished runs failed in the last 14 days \(5 of 7\)/)).toBeInTheDocument();
    expect(screen.getByText("71%")).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /Weekly dispatches/ });
    const bands = chart.querySelectorAll("rect");
    expect(bands).toHaveLength(8);
    fireEvent.mouseEnter(bands[7]);
    const tooltip = screen.getByRole("status");
    expect(within(tooltip).getByText("Week of Sep 28")).toBeInTheDocument();
    fireEvent.mouseLeave(chart);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("handles an unpaused queue, no queues, and a quiet pipeline", () => {
    renderPipeline([pipelineAttempt({ run_conclusion: "success", pr_state: "open", pr_created_at: "2026-09-30T00:00:00Z" })], {
      pending: 5,
      queues: 1,
      inFlight: 1,
      blocked: 19,
      pausedReason: null,
    });
    expect(screen.getByText("1 in flight")).toBeInTheDocument();
    expect(screen.getByText(/19 blocked, need a person/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Biggest pile/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /In review/ })).toBeInTheDocument();
    cleanup();
    renderPipeline([pipelineAttempt({ run_conclusion: "success" })], null);
    expect(screen.getByText("no durable queues")).toBeInTheDocument();
    cleanup();
    renderPipeline([pipelineAttempt({ run_conclusion: "success" })], { pending: 5, queues: 3, inFlight: 4, blocked: 0, pausedReason: null });
    expect(screen.getByText("4 in flight")).toBeInTheDocument();
    expect(screen.queryByText(/blocked, need a person/)).not.toBeInTheDocument();
  });

  it("lists the latest of a long exit and marks a checked compile sweep", () => {
    const attempts = Array.from({ length: 65 }, (_, i) =>
      pipelineAttempt({ id: String(i), citation: `us/x/${i}` })
    );
    attempts.push(
      mergedAttempt({ id: "ok", citation: "us/ok", synced_at: "2026-09-22T00:00:00Z", compile_status: "ok", compile_checked_at: "2026-09-30T07:00:00Z", pr_checks: "pending", pr_review: "approved" })
    );
    renderPipeline(attempts);
    expect(screen.getByText("Latest 60 of 65")).toBeInTheDocument();
    expect(screen.queryByText("sweep not running yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Runs/ }));
    expect(screen.getByText("1 citation")).toBeInTheDocument();
  });
});
