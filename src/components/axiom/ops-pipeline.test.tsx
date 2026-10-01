import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsPipeline } from "./ops-pipeline";
import { pipelineView } from "@/lib/axiom/encoding-pipeline";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");

const scrollIntoView = vi.fn();
let frames: FrameRequestCallback[] = [];
const flushFrames = () => frames.splice(0).forEach((frame) => frame(0));

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  scrollIntoView.mockReset();
});

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
    blockedNote: null,
    pausedReason: "Awaiting a green tip.",
  }
) {
  return render(
    <OpsPipeline view={pipelineView(attempts, NOW)} queued={queued} referenceMs={NOW} />
  );
}

const openList = () => screen.getByRole("region", { name: / citations$/ });
const card = (name: string) => screen.getByRole("group", { name });

describe("OpsPipeline", () => {
  it("lays out the stage strip and the drop-outs, with no list open", () => {
    renderPipeline();
    expect(screen.getByText("6 citations · 7 dispatches since Sep 1, 2026")).toBeInTheDocument();
    const stages = screen.getByRole("list", { name: "Pipeline stages" });
    expect(within(stages).getByText("18,615")).toBeInTheDocument();
    expect(within(stages).getByText("paused")).toHaveAttribute("title", "Awaiting a green tip.");
    expect(within(stages).getByRole("button", { name: /In review\s*1\s*1 stuck · 3w/ })).toBeInTheDocument();
    expect(within(stages).getByRole("button", { name: /Runs\s*0\s*no engine sweep yet/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^3\s*last encode failed$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\s*encoded, no PR/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\s*merged off main/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /missing from the index/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 duplicate open PR")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: / citations$/ })).not.toBeInTheDocument();
  });

  it("opens the biggest bottleneck, scrolls to it, and closes", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000 } as DOMRect);
    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: /Biggest bottleneck: 3 last encode failed/ }));
    flushFrames();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    const list = openList();
    expect(within(list).getByRole("heading", { name: /Last encode failed\s*3/ })).toBeInTheDocument();
    expect(within(list).getByText("Source branch (a) is neither encoded nor deferred.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^3\s*last encode failed$/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(list).getByRole("button", { name: "Close list" }));
    expect(screen.queryByRole("region", { name: / citations$/ })).not.toBeInTheDocument();
  });

  it("lists a stage's citations with why they are there, links, and flags", () => {
    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: /In review/ }));
    flushFrames();
    expect(scrollIntoView).not.toHaveBeenCalled();
    const list = openList();
    expect(within(list).getByRole("link", { name: "us/d" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fd");
    expect(within(list).getByRole("link", { name: "rulespec-us#7" })).toHaveAttribute("href", "https://github.com/x/pull/7");
    expect(within(list).getByText("Changes requested")).toBeInTheDocument();
    expect(within(list).getByText("2 dispatches · 2 open PRs · an earlier version is in the index")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /merged off main/ }));
    expect(within(openList()).getByText("Merged into codex/x")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /1\s*encoded, no PR/ }));
    expect(within(openList()).getByRole("link", { name: "run" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Runs/ }));
    expect(within(openList()).getByText("Nothing here right now.")).toBeInTheDocument();
  });

  it("breaks failed encodes down by step or cause, and opens a group without repeating it", () => {
    renderPipeline();
    const failures = card("Why encodes fail");
    expect(within(failures).getByText("3 citations whose latest encode failed")).toBeInTheDocument();
    const byCause = within(failures).getByRole("button", { name: "By cause" });
    fireEvent.click(byCause);
    expect(byCause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(failures).getByRole("button", { name: /rule-a\s*2/ }));
    const list = openList();
    expect(within(list).getByRole("heading", { name: /Failed: rule-a\s*2/ })).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "us/a" })).toBeInTheDocument();
    expect(within(list).queryByText("rule-a")).not.toBeInTheDocument();

    fireEvent.click(within(failures).getByRole("button", { name: "By step" }));
    expect(within(failures).queryByRole("button", { name: /rule-a/ })).not.toBeInTheDocument();
  });

  it("follows citations through review holds, the index, and main", () => {
    const indexed = { synced_at: "2026-09-21T12:00:00Z", index_status: "indexed" as const, compile_status: "ok" };
    renderPipeline([
      pipelineAttempt({ id: "1", citation: "us/a", encoder_error: "a.yaml: ci: [rule-a] x", encoder_error_rule: "rule-a" }),
      pipelineAttempt({ id: "2", citation: "us/b", run_conclusion: "cancelled" }),
      pipelineAttempt({ id: "3", citation: "us/c", pr_state: "draft", pr_checks: "failure", pr_failed_checks: ["validate / validate (us-ak)"], pr_cancelled_checks: 4 }),
      mergedAttempt({ id: "4", citation: "us/d", ...indexed, tests_status: "pass", tests_run_url: "https://github.com/x/runs/9", oracle_status: "match", oracle_engine: "policyengine" }),
      mergedAttempt({ id: "5", citation: "us/e", ...indexed, tests_status: "fail" }),
      mergedAttempt({ id: "6", citation: "us/f", ...indexed, oracle_status: "disagree", oracle_engine: "taxsim" }),
    ]);
    const stages = screen.getByRole("list", { name: "Pipeline stages" });
    expect(within(stages).getByRole("button", { name: /Tests pass\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\s*fails validation on main/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\s*disagrees with an oracle/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Cancelled or timed out\s*1/ }));
    expect(within(openList()).getByRole("link", { name: "us/b" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Blocked by another jurisdiction's failing check\s*1/ }));
    const holds = openList();
    expect(within(holds).getByRole("heading", { name: /In review: Blocked by another/ })).toBeInTheDocument();
    expect(within(holds).getByText("failing: validate / validate (us-ak) · 4 checks cancelled")).toBeInTheDocument();

    fireEvent.click(within(stages).getByRole("button", { name: /Tests pass/ }));
    const verified = openList();
    expect(within(verified).getByRole("link", { name: "validation" })).toHaveAttribute("href", "https://github.com/x/runs/9");
    expect(within(verified).getAllByText(/Matches PolicyEngine/).length).toBeGreaterThan(0);
  });

  it("shows the latest of a long exit, the oldest of a long stage, and a checked compile sweep", () => {
    const attempts = [
      ...Array.from({ length: 65 }, (_, i) => pipelineAttempt({ id: `f${i}`, citation: `us/x/${i}` })),
      ...Array.from({ length: 62 }, (_, i) =>
        pipelineAttempt({ id: `r${i}`, citation: `us/r/${i}`, pr_state: "open", pr_created_at: "2026-09-30T00:00:00Z" })
      ),
      mergedAttempt({ id: "ok", citation: "us/ok", synced_at: "2026-09-22T00:00:00Z", compile_status: "ok", compile_checked_at: "2026-09-30T07:00:00Z", pr_checks: "pending", pr_review: "approved" }),
    ];
    renderPipeline(attempts);
    expect(screen.queryByText("no engine sweep yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^65\s*last encode failed$/ }));
    expect(within(openList()).getByText("Latest 60 of 65")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /In review/ }));
    expect(within(openList()).getByText("Oldest 60 of 62")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Runs/ }));
    expect(within(openList()).getByRole("link", { name: "us/ok" })).toBeInTheDocument();
  });

  it("charts weekly throughput with a hover readout and a table", () => {
    renderPipeline();
    expect(screen.getByText("71%")).toBeInTheDocument();
    expect(screen.getByText("of runs failed, last 14 days (5 of 7)")).toBeInTheDocument();
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

  it("summarizes the queue as blocked, paused, in flight, or absent", () => {
    const quiet = [pipelineAttempt({ run_conclusion: "success", pr_state: "open", pr_created_at: "2026-09-30T00:00:00Z" })];
    renderPipeline(quiet, {
      pending: 5,
      queues: 1,
      inFlight: 1,
      blocked: 19,
      blockedNote: { note: "skipped for the pilot", count: 19 },
      pausedReason: null,
    });
    expect(screen.getByText("19 blocked")).toHaveAttribute("title", "skipped for the pilot");
    expect(screen.queryByRole("button", { name: /Biggest bottleneck/ })).not.toBeInTheDocument();
    cleanup();
    renderPipeline(quiet, { pending: 5, queues: 1, inFlight: 0, blocked: 2, blockedNote: null, pausedReason: null });
    expect(screen.getByText("2 blocked")).not.toHaveAttribute("title");
    cleanup();
    renderPipeline(quiet, { pending: 5, queues: 3, inFlight: 4, blocked: 0, blockedNote: null, pausedReason: null });
    expect(screen.getByText("4 in flight")).not.toHaveAttribute("title");
    cleanup();
    renderPipeline(quiet, null);
    expect(within(screen.getByRole("list", { name: "Pipeline stages" })).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("no queues")).toBeInTheDocument();
  });

  it("shows the signing-approval gate and every cancellation", () => {
    renderPipeline([
      pipelineAttempt({ id: "a", citation: "us/a", run_conclusion: "success", dispatched_at: "2026-09-29T00:00:00Z", encode_started_at: "2026-09-29T00:01:00Z" }),
      pipelineAttempt({ id: "b", citation: "us/b", run_conclusion: "success", dispatched_at: "2026-09-29T00:00:00Z", encode_started_at: "2026-09-29T04:00:00Z" }),
      pipelineAttempt({ id: "w", citation: "us/w", run_status: "waiting", run_conclusion: null, dispatched_at: "2026-09-29T00:00:00Z" }),
      pipelineAttempt({ id: "x", citation: "us/x", run_conclusion: "cancelled", cancel_stage: "approval", dispatched_at: "2026-09-20T00:00:00Z", finished_at: "2026-09-20T02:00:00Z" }),
      pipelineAttempt({ id: "y", citation: "us/y", run_conclusion: "cancelled", dispatched_at: "2026-09-20T00:00:00Z" }),
    ]);
    const approval = card("Signing approval");
    expect(within(approval).getByText("4h")).toBeInTheDocument();
    expect(within(approval).getByText("slowest 10% of approvals, last 14 days (half within 4h)")).toBeInTheDocument();
    expect(within(approval).getByText("waiting now, oldest 36h")).toBeInTheDocument();
    expect(within(approval).getByText("Cancelled runs")).toBeInTheDocument();
    expect(within(approval).getByText("While waiting for signing approval")).toBeInTheDocument();
    expect(within(approval).getByText("Not read yet")).toBeInTheDocument();
    expect(within(approval).getByText("1 of 1 waited over an hour before being cancelled.")).toBeInTheDocument();
  });

  it("says when no approval timing or waiting runs exist yet", () => {
    renderPipeline([pipelineAttempt({ run_conclusion: "success" })]);
    const approval = card("Signing approval");
    expect(within(approval).getByText("—")).toBeInTheDocument();
    expect(within(approval).getByText("slowest 10% of approvals, last 14 days")).toBeInTheDocument();
    expect(within(approval).getByText("waiting now")).toBeInTheDocument();
    expect(within(approval).queryByText("Cancelled runs")).not.toBeInTheDocument();
  });
});
