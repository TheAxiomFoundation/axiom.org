import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsPipeline } from "./ops-pipeline";
import { pipelineView } from "@/lib/axiom/encoding-pipeline";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import type { QueuedSummary, QueueItemView } from "@/lib/axiom/encoding-queues";
import type { CorpusJurisdiction, CorpusView } from "@/lib/axiom/corpus-releases";
import { pipelineInsights, scopeOptions } from "@/lib/axiom/encoding-pipeline-insights";
import { dispatchFlow, encodeParts, runRows, stepTimes, testsParts } from "@/lib/axiom/encoding-pipeline-runs";
import { act, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/ops", useRouter: () => ({ push }) }));

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
    skipped: 0,
    blockedNote: null,
    paused: true,
    pausedReason: "Awaiting a green tip.",
    pausedSince: null,
    dispatchDisabled: false,
    items: [],
    notStarted: [],
  },
  corpus: CorpusView | null = null
) {
  return render(
    <OpsPipeline view={pipelineView(attempts, NOW)} queued={queued} corpus={corpus} referenceMs={NOW} />
  );
}

const queuedWith = (overrides: Partial<QueuedSummary>): QueuedSummary => ({
  pending: 5,
  queues: 1,
  inFlight: 0,
  blocked: 0,
  skipped: 0,
  blockedNote: null,
  paused: false,
  pausedReason: null,
  pausedSince: null,
  dispatchDisabled: false,
  items: [],
  notStarted: [],
  ...overrides,
});

const openList = () => screen.getByRole("region", { name: / citations$/ });
const card = (name: string) => screen.getByRole("group", { name });

/** The step table's rows, as text: name and "?", time, went on, stopped or waiting. */
function stepRows() {
  const table = within(screen.getByRole("region", { name: "Steps" })).getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);
}

/** A click as a browser sends it: the pointer goes down first, which closes any open "?" note elsewhere. */
function press(element: HTMLElement) {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
}

describe("OpsPipeline", () => {
  it("lays out the stage strip and the drop-outs, with no list open", () => {
    renderPipeline();
    expect(screen.queryByText(/citations since/)).not.toBeInTheDocument();
    const stages = screen.getByRole("list", { name: "Pipeline stages" });
    expect(within(stages).getByText("18,615")).toBeInTheDocument();
    // A tile shows its name and count; its status is the tooltip.
    expect(within(stages).getByRole("button", { name: /^Queued/ })).toHaveAttribute("title", "Paused: Awaiting a green tip");
    expect(within(stages).getByRole("button", { name: /^In review\s*1$/ })).toHaveAttribute("title", "1 stuck · 3w");
    expect(within(stages).getByRole("button", { name: /^Runs\s*0$/ })).toHaveAttribute("title", "no engine sweep yet");
    expect(screen.getByRole("button", { name: /^3\s*last encode failed$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\s*encoded, no PR/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\s*merged off main/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /missing from the index/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 duplicate open PR")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: / citations$/ })).not.toBeInTheDocument();
  });

  it("opens a drop-out, scrolls to it, and closes", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000 } as DOMRect);
    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: /^3\s*last encode failed$/ }));
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
    fireEvent.click(within(screen.getByRole("list", { name: "Pipeline stages" })).getByRole("button", { name: /In review/ }));
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

  it("folds the groups past the seventh into one row, so the rows add up", () => {
    renderPipeline(
      Array.from({ length: 9 }, (_, i) =>
        pipelineAttempt({
          id: String(i + 1),
          citation: `us/c${i + 1}`,
          encoder_error: `c.yaml: ci: [rule-${i + 1}] x`,
          encoder_error_rule: `rule-${i + 1}`,
        })
      )
    );
    const failures = card("Why encodes fail");
    fireEvent.click(within(failures).getByRole("button", { name: "By cause" }));
    expect(within(failures).getByRole("button", { name: /rule-7\s*1/ })).toBeInTheDocument();
    expect(within(failures).queryByRole("button", { name: /rule-8/ })).not.toBeInTheDocument();
    fireEvent.click(within(failures).getByRole("button", { name: /2 other groups\s*2/ }));
    const list = openList();
    expect(within(list).getByRole("link", { name: "us/c8" })).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "us/c9" })).toBeInTheDocument();
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

    fireEvent.click(within(card("Why encodes fail")).getByRole("button", { name: /Cancelled or timed out\s*1/ }));
    expect(within(openList()).getByRole("link", { name: "us/b" })).toBeInTheDocument();

    fireEvent.click(
      within(card("What holds PRs in review")).getByRole("button", { name: /Blocked by another jurisdiction's failing check\s*1/ })
    );
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
    expect(within(screen.getByRole("list", { name: "Pipeline stages" })).getByRole("button", { name: /^Runs/ })).not.toHaveAttribute(
      "title",
      "no engine sweep yet"
    );
    fireEvent.click(screen.getByRole("button", { name: /^65\s*last encode failed$/ }));
    expect(within(openList()).getByText("Latest 60 of 65")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("list", { name: "Pipeline stages" })).getByRole("button", { name: /In review/ }));
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
    const queueTile = () => within(screen.getByRole("list", { name: "Pipeline stages" })).getByRole("button", { name: /^Queued/ });
    renderPipeline(quiet, queuedWith({ inFlight: 1, blocked: 19, blockedNote: { note: "skipped for the pilot", count: 19 } }));
    expect(queueTile()).toHaveAttribute("title", "19 blocked: skipped for the pilot");
    expect(screen.queryByRole("button", { name: /Biggest bottleneck/ })).not.toBeInTheDocument();
    cleanup();
    renderPipeline(quiet, queuedWith({ blocked: 2 }));
    expect(queueTile()).toHaveAttribute("title", "2 blocked");
    cleanup();
    renderPipeline(quiet, queuedWith({ queues: 3, inFlight: 4 }));
    expect(queueTile()).toHaveAttribute("title", "4 in flight");
    cleanup();
    // Skipped items are not blocked: they are named, but the tile is not stuck.
    renderPipeline(quiet, queuedWith({ skipped: 19, paused: true, pausedSince: "2026-09-17T12:00:00Z", dispatchDisabled: true }));
    expect(queueTile()).toHaveAttribute("title", "Paused 13d · dispatch workflow disabled · 19 skipped");
    expect(queueTile().className).not.toMatch(/tileStuck/);
    cleanup();
    renderPipeline(quiet, queuedWith({ blocked: 1, skipped: 19 }));
    expect(queueTile()).toHaveAttribute("title", "1 blocked · 19 skipped");
    expect(queueTile().className).toMatch(/tileStuck/);
    cleanup();
    renderPipeline(quiet, queuedWith({ dispatchDisabled: true }));
    expect(queueTile()).toHaveAttribute("title", "Dispatch workflow disabled · 0 in flight");
    cleanup();
    renderPipeline(quiet, null);
    expect(within(screen.getByRole("list", { name: "Pipeline stages" })).getByText("—")).toBeInTheDocument();
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

  it("lists the queue's items by what they need, and what has not started", () => {
    const item = (citation: string, state: QueueItemView["state"], extra: Partial<QueueItemView> = {}): QueueItemView => ({
      queueId: "pilot",
      citation,
      label: null,
      state,
      why: null,
      attempts: 1,
      lastAt: "2026-09-30T06:00:00Z",
      runUrl: `https://github.com/x/runs/${citation}`,
      prUrl: null,
      ...extra,
    });
    renderPipeline(
      [pipelineAttempt({ run_conclusion: "success" })],
      queuedWith({
        pending: 935,
        blocked: 1,
        skipped: 2,
        inFlight: 1,
        paused: true,
        pausedSince: "2026-09-17T12:00:00Z",
        dispatchDisabled: true,
        items: [
          item("us-or/b", "blocked", { why: "failed 2 times", attempts: 2 }),
          item("us-ut/c", "dispatched", { prUrl: "https://github.com/x/pull/1" }),
          item("us-ut/d", "retrying", { why: "failure: Encode, review, validate, and apply" }),
          item("us-or/a", "skipped", { why: "skipped for the pilot", label: "Page 26", attempts: 0, lastAt: null, runUrl: null }),
          item("us-or/e", "skipped", { why: "skipped for the pilot", label: "Page 27", attempts: 0, lastAt: null, runUrl: null }),
        ],
        notStarted: [
          { jurisdiction: "us-or", count: 562 },
          { jurisdiction: "us-ut", count: 353 },
        ],
      })
    );
    // A paused queue says so where its count shows: for how long, and that its workflow is off.
    expect(screen.getByRole("button", { name: "935 queued · paused" })).toHaveAttribute(
      "title",
      "Paused 13d · dispatch workflow disabled; nothing new is dispatched."
    );
    expect(screen.getByRole("button", { name: /^Queued\s*935$/ })).toHaveAttribute(
      "title",
      "Paused 13d · dispatch workflow disabled · 1 blocked · 2 skipped"
    );
    fireEvent.click(screen.getByRole("button", { name: /^Queued\s*935$/ }));
    const list = screen.getByRole("region", { name: "Queued items" });
    expect(within(list).getByText(/^Paused 13d · dispatch workflow disabled; nothing new is dispatched\./)).toBeInTheDocument();
    const blocked = within(list).getByRole("region", { name: "Needs a person" });
    expect(within(blocked).getByRole("link", { name: "us-or/b" })).toHaveAttribute("href", "/ops/journey?citation=us-or%2Fb");
    expect(within(blocked).getByText("2 runs")).toBeInTheDocument();
    expect(within(blocked).queryByText(/skipped/)).not.toBeInTheDocument();
    // Skipped items have their own group; shared reasons are said once, with how many share them.
    const skipped = within(list).getByRole("region", { name: "Skipped" });
    expect(within(skipped).getByText("Page 26")).toBeInTheDocument();
    expect(within(skipped).getAllByText("skipped for the pilot")).toHaveLength(1);
    expect(within(skipped).getByText("skipped for the pilot").textContent).toBe("skipped for the pilot2");
    expect(within(list).getByRole("region", { name: "Run open" })).toHaveTextContent("PR");
    // While paused, a failed item retries only once the queue resumes.
    expect(within(list).getByRole("region", { name: "Will retry when resumed" })).toHaveTextContent(
      "failure: Encode, review, validate, and apply"
    );
    expect(within(list).queryByRole("region", { name: "Retrying after a failed run" })).not.toBeInTheDocument();
    expect(within(list).getByRole("region", { name: "Run open" }).querySelector("p")).toBeNull();
    expect(within(list).getByText("Not started yet: us-or 562 · us-ut 353")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Queued/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(list).getByRole("button", { name: "Close list" }));
    expect(screen.queryByRole("region", { name: "Queued items" })).not.toBeInTheDocument();

    cleanup();
    renderPipeline(
      [pipelineAttempt({ run_conclusion: "success" })],
      queuedWith({ paused: true, pausedReason: "Awaiting a green tip.", items: [item("us-ut/d", "retrying", { why: "Failed" })] })
    );
    fireEvent.click(screen.getByRole("button", { name: /Queued/ }));
    expect(screen.getByText(/^Paused: Awaiting a green tip; nothing new/)).toBeInTheDocument();
    expect(screen.queryByText(/Not started yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Will retry when resumed" })).toBeInTheDocument();

    cleanup();
    renderPipeline([pipelineAttempt({ run_conclusion: "success" })], queuedWith({ items: [item("us-ut/d", "retrying", { why: "Failed" })] }));
    fireEvent.click(screen.getByRole("button", { name: /Queued/ }));
    expect(screen.getByRole("region", { name: "Retrying after a failed run" })).toBeInTheDocument();
    expect(screen.queryByText(/nothing new is dispatched/)).not.toBeInTheDocument();
  });

  it("opens the corpus releases by what is out of sync, with every flag, and lists the ones up to date", () => {
    const row = (overrides: Partial<CorpusJurisdiction>): CorpusJurisdiction => ({
      jurisdiction: "nz",
      name: "New Zealand",
      flags: [],
      serving: { release: "nz-rulespec-2026-07-25", since: "2026-07-25T20:22:00Z", releases: 1, scopes: 8, provisions: 11774 },
      newest: { release: "nz-rulespec-2026-07-25", signedAt: "2026-07-25T20:22:00Z", scopes: 8 },
      next: null,
      other: null,
      encoder: { repo: "rulespec-nz", release: "nz-rulespec-2026-07-25", state: "signed", lacks: 0, extra: 0 },
      since: null,
      ...overrides,
    });
    const corpus: CorpusView = {
      outOfSync: 8,
      openPrs: { count: 68, draft: 31, oldestAt: "2026-07-16T00:00:00Z", url: "https://github.com/c/pulls" },
      lastPublish: { conclusion: "failure", at: "2026-09-25T12:00:00Z", url: "https://github.com/c/runs/1" },
      jurisdictions: [
        row({
          jurisdiction: "us",
          name: "United States",
          flags: ["encoder_lacks"],
          serving: { release: "us-rulespec-2026-09-14-union", since: "2026-09-29T12:00:00Z", releases: 1, scopes: 1567, provisions: 408541 },
          newest: { release: "us-rulespec-2026-09-28-snap-memo", signedAt: "2026-09-28T12:00:00Z", scopes: 272 },
          // The side release is the one the encoder pins: it is said once.
          other: { release: "us-rulespec-2026-09-28-snap-memo", signedAt: "2026-09-28T12:00:00Z", scopes: 272, lacks: 1339 },
          encoder: { repo: "rulespec-us", release: "us-rulespec-2026-09-28-snap-memo", state: "signed", lacks: 1339, extra: 44 },
          since: "2026-09-28T12:00:00Z",
        }),
        row({
          jurisdiction: "uk",
          name: "United Kingdom",
          flags: ["encoder_lacks"],
          serving: { release: "uk-rulespec-2026-09-07", since: "2026-09-13T15:28:00Z", releases: 2, scopes: 192, provisions: 21976 },
          newest: { release: "uk-rulespec-2026-09-20-side", signedAt: "2026-09-20T00:00:00Z", scopes: 5 },
          other: { release: "uk-rulespec-2026-09-20-side", signedAt: "2026-09-20T00:00:00Z", scopes: 5, lacks: 187 },
          encoder: { repo: "rulespec-uk", release: "uk-rulespec-2026-09-07", state: "signed", lacks: 1, extra: 0 },
          since: "2026-09-13T15:28:00Z",
        }),
        row({
          jurisdiction: "be",
          name: "Belgium",
          flags: ["newer_not_active", "encoder_other"],
          serving: { release: "be-rulespec-2026-08-23", since: "2026-08-23T21:44:00Z", releases: 1, scopes: 13, provisions: 626 },
          newest: { release: "be-rulespec-2026-08-29", signedAt: "2026-08-30T01:15:00Z", scopes: 13 },
          next: { release: "be-rulespec-2026-08-29", signedAt: "2026-08-30T01:15:00Z", scopes: 13, adds: 1 },
          encoder: { repo: "rulespec-be", release: "be-rulespec-2026-07-10", state: "signed", lacks: 0, extra: 0 },
          since: "2026-08-30T01:15:00Z",
        }),
        row({
          jurisdiction: "ee",
          name: "Estonia",
          flags: ["newer_not_active", "encoder_off"],
          serving: { release: "ee-rulespec-1", since: "2026-09-01T12:00:00Z", releases: 1, scopes: 1, provisions: null },
          newest: { release: "ee-rulespec-2", signedAt: "2026-09-02T00:00:00Z", scopes: 2 },
          next: { release: "ee-rulespec-2", signedAt: "2026-09-02T00:00:00Z", scopes: 2, adds: 1 },
          encoder: { repo: "rulespec-ee", release: "ee-rulespec-2", state: "signed", lacks: 0, extra: 1 },
          since: "2026-09-02T00:00:00Z",
        }),
        row({
          jurisdiction: "tz",
          name: "Tanzania",
          flags: ["not_serving", "pin_unsigned"],
          serving: null,
          newest: { release: "tz-rulespec-2026-07-16", signedAt: "2026-07-16T16:09:00Z", scopes: 3 },
          encoder: { repo: "rulespec-tz", release: "tz-rulespec-2026-07-21", state: "manifest", lacks: null, extra: null },
          since: "2026-07-16T16:09:00Z",
        }),
        row({
          jurisdiction: "bo",
          name: "Bolivia",
          flags: ["pin_unsigned"],
          serving: null,
          newest: null,
          encoder: { repo: "rulespec-bo", release: "bo-rulespec-2026-07-24-r2", state: "manifest", lacks: null, extra: null },
        }),
        row({
          jurisdiction: "qq",
          name: "Qq",
          flags: ["pin_unknown"],
          serving: null,
          newest: null,
          encoder: { repo: "rulespec-qq", release: "qq-ghost", state: "unknown", lacks: null, extra: null },
        }),
        row({
          jurisdiction: "ch",
          name: "Switzerland",
          flags: ["no_release"],
          serving: null,
          newest: null,
          encoder: { repo: "rulespec-ch", release: null, state: "placeholder", lacks: null, extra: null },
        }),
        row({}),
        row({
          jurisdiction: "ca",
          name: "Canada",
          serving: { release: "ca-rulespec-1", since: "2026-09-30T06:00:00Z", releases: 1, scopes: 1, provisions: null },
          encoder: { repo: "rulespec-ca", release: "ca-rulespec-0", state: "signed", lacks: 0, extra: 0 },
        }),
      ],
    };
    renderPipeline(undefined, undefined, corpus);
    const corpusTile = screen.getByRole("button", { name: /^Corpus\s*10$/ });
    expect(corpusTile).toHaveAttribute("title", "8 out of sync");
    fireEvent.click(corpusTile);
    expect(corpusTile).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByRole("region", { name: "Corpus releases" });
    expect(
      within(list).getByRole("link", { name: "68 open PRs in axiom-corpus (37 ready · 31 draft), oldest 11w" })
    ).toHaveAttribute("href", "https://github.com/c/pulls");
    expect(within(list).getByRole("link", { name: "Last publish failed 5d ago" })).toBeInTheDocument();
    const groups = within(list).getAllByRole("region").map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual([
      "Newer release not activated",
      "Encoder reads a release that lacks served scope versions",
      "Not serving: no release activated",
      "Pin names an unsigned manifest",
      "Pin names no known release",
      "No release cut yet",
      "Up to date",
    ]);
    const names = (group: string) =>
      within(within(list).getByRole("region", { name: group }))
        .getAllByRole("listitem")
        .map((item) => item.textContent?.split(" · ")[0]);
    // Most recently signed first.
    expect(names("Newer release not activated")).toEqual(["Estonia", "Belgium"]);
    expect(names("Encoder reads a release that lacks served scope versions")).toEqual(["United States", "United Kingdom"]);
    expect(names("Up to date")).toEqual(["Canada", "New Zealand"]);
    const item = (title: string) => within(list).getByText(title).closest("li") as HTMLElement;

    // The US: no successor to activate, and the encoder reads a narrow release.
    const us = item("United States · us");
    expect(
      within(us).getByText(
        "Serving 2026-09-14-union · encoder reads 2026-09-28-snap-memo, which lacks 1,339 served scope versions and has 44 scope versions the site doesn't serve"
      )
    ).toBeInTheDocument();
    expect(within(us).getByText("Activated 24h ago · 408,541 provisions · 1,567 scope versions")).toBeInTheDocument();
    expect(within(us).getByRole("link", { name: "pin" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/.axiom/toolchain.toml"
    );
    expect(
      within(item("United Kingdom · uk")).getByText(
        "Serving 2026-09-07 and 1 other release · also signed 2026-09-20-side (5 scopes), which lacks 187 served scope versions · encoder reads 2026-09-07, which lacks 1 served scope version"
      )
    ).toBeInTheDocument();
    // Belgium shows every flag: the next release, and the encoder's other pin.
    const be = item("Belgium · be");
    expect(
      within(be).getByText("Serving 2026-08-23 · next 2026-08-29 (13 scopes, adds 1) · encoder pins 2026-07-10, with the same scopes as serving")
    ).toBeInTheDocument();
    expect(within(be).getByText("also: encoder pins another release")).toBeInTheDocument();
    expect(within(be).getByText("4w")).toBeInTheDocument();
    expect(
      within(item("Estonia · ee")).getByText("Serving 1 · next 2 (2 scopes, adds 1) · encoder reads 2, with 1 scope version the site doesn't serve")
    ).toBeInTheDocument();
    expect(within(item("Estonia · ee")).getByText("Activated 4w ago · 1 scope version")).toBeInTheDocument();
    const tz = item("Tanzania · tz");
    expect(within(tz).getByText("Serving nothing · newest 2026-07-16 (3 scopes) · encoder pins 2026-07-21, an unsigned manifest")).toBeInTheDocument();
    expect(within(tz).getByText("also: pin names an unsigned manifest")).toBeInTheDocument();
    expect(within(item("Bolivia · bo")).getByText("No signed release · encoder pins 2026-07-24-r2, an unsigned manifest")).toBeInTheDocument();
    expect(within(item("Qq · qq")).getByText("No signed release · encoder pins ghost, not a known release")).toBeInTheDocument();
    expect(within(item("Switzerland · ch")).getByText("No signed release · encoder pins no release yet (placeholder)")).toBeInTheDocument();
    // Up-to-date rows say when they were activated and how much serves.
    const nz = item("New Zealand · nz");
    expect(within(nz).getByText("Serving 2026-07-25 · encoder reads the same release")).toBeInTheDocument();
    expect(within(nz).getByText("Activated 10w ago · 11,774 provisions · 8 scope versions")).toBeInTheDocument();
    expect(within(item("Canada · ca")).getByText("Serving 1 · encoder reads 0")).toBeInTheDocument();
    expect(within(item("Canada · ca")).getByText("Activated 6h ago · 1 scope version")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Close list" }));
    expect(screen.queryByRole("region", { name: "Corpus releases" })).not.toBeInTheDocument();

    cleanup();
    renderPipeline(undefined, undefined, {
      ...corpus,
      outOfSync: 0,
      openPrs: { count: 1, draft: null, oldestAt: null, url: "u" },
      lastPublish: { conclusion: "success", at: "2026-09-29T12:00:00Z", url: "r" },
      jurisdictions: [row({ jurisdiction: "uk-x", name: "Somewhere", encoder: null })],
    });
    expect(screen.getByRole("button", { name: /^Corpus\s*1$/ })).toHaveAttribute("title", "all in sync");
    fireEvent.click(screen.getByRole("button", { name: /^Corpus\s*1$/ }));
    expect(screen.getByRole("link", { name: "1 open PR in axiom-corpus" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last publish succeeded 24h ago" })).toBeInTheDocument();
    expect(screen.getByText("Serving nz-rulespec-2026-07-25")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "pin" })).not.toBeInTheDocument();

    cleanup();
    renderPipeline(undefined, undefined, { ...corpus, openPrs: null, lastPublish: null, jurisdictions: corpus.jurisdictions.slice(0, 1) });
    fireEvent.click(screen.getByRole("button", { name: /Corpus/ }));
    expect(screen.queryByText(/in axiom-corpus/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Up to date" })).not.toBeInTheDocument();
  });

  it("narrows to a jurisdiction, and reads the funnel, runs, encoder versions, and check errors", () => {
    push.mockReset();
    const attempts = [
      ...Array.from({ length: 4 }, (_, i) =>
        pipelineAttempt({ id: `x${i}`, citation: "us/x", dispatched_at: `2026-09-0${i + 1}T00:00:00Z`, encoder_version: "0.2.9", cost_usd: 1 })
      ),
      mergedAttempt({ id: "m", citation: "us-la/m", jurisdiction: "us-la", tests_status: "pass", encoder_version: "0.2.10", cost_usd: 0.5 }),
      pipelineAttempt({
        id: "r",
        citation: "dk/r",
        jurisdiction: "dk",
        run_conclusion: "success",
        pr_state: "draft",
        pr_created_at: "2026-09-29T00:00:00Z",
        pr_url: "https://github.com/x/pull/9",
        pr_checks: "failure",
        pr_failed_checks: ["validate / validate (dk)"],
        pr_check_error: "- dk/r.json does not match the running pinned encoder",
      }),
    ];
    const scope = { jurisdiction: "us", only: false };
    render(
      <OpsPipeline
        view={pipelineView(attempts, NOW)}
        insights={pipelineInsights(attempts, NOW)}
        scope={scope}
        scopes={scopeOptions(attempts, scope)}
        queued={null}
        referenceMs={NOW}
      />
    );
    const bar = screen.getByRole("navigation", { name: "Jurisdiction" });
    // Details names what it is narrowed to.
    expect(screen.getByRole("heading", { name: "Details" }).parentElement).toHaveTextContent(/^DetailsUnited States$/);
    // Countries by name, each with its citation count, and All with the total.
    expect(within(bar).getByRole("link", { name: /^All\s*3$/ })).toHaveAttribute("href", "/ops?tab=pipeline#pipeline-title");
    expect(within(bar).getByRole("link", { name: /^United States\s*2$/ })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: /^Denmark\s*1$/ })).toHaveAttribute("href", "/ops?tab=pipeline&j=dk#pipeline-title");
    const select = within(bar).getByRole("combobox", { name: "Within United States" });
    // All first, then the federal level, then the states by name.
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "All (2)",
      "US Federal only (1)",
      "Louisiana (1)",
    ]);
    expect(select.querySelector("optgroup")).toHaveAttribute("label", "States");
    fireEvent.change(select, { target: { value: "us:only" } });
    expect(push).toHaveBeenLastCalledWith("/ops?tab=pipeline&j=us&only=1#pipeline-title");
    fireEvent.change(select, { target: { value: "us-la" } });
    expect(push).toHaveBeenLastCalledWith("/ops?tab=pipeline&j=us-la#pipeline-title");
    fireEvent.change(select, { target: { value: "" } });
    expect(push).toHaveBeenLastCalledWith("/ops?tab=pipeline&j=us#pipeline-title");

    // Each citation once, where its latest run left it, in pipeline order.
    expect(screen.getByText("3 citations · where each one is now")).toBeInTheDocument();
    const states = screen.getByRole("list", { name: "Where each citation is now" });
    // A row is a name and a count; what it means is the tooltip.
    expect(within(states).getAllByRole("button").map((row) => [row.textContent, row.title])).toEqual([
      ["Encoding fails1", "latest run failed"],
      ["In review1", "PR open"],
      ["In main1", "1 pending index"],
    ]);

    const runs = screen.getByRole("group", { name: "Runs and retries" });
    expect(within(runs).getByText("of citations encode on the first attempt (2 of 3)")).toBeInTheDocument();
    expect(within(runs).getByText(/of recorded cost went to failed runs \(\$4 of \$5; 5 of 6 runs record a cost\)/)).toBeInTheDocument();
    expect(within(runs).getByText("1st attempt")).toBeInTheDocument();
    expect(within(runs).getByRole("link", { name: "us/x" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fx");
    expect(within(runs).getByText("4 dispatches · 0 encoded · 0 merged")).toBeInTheDocument();

    const versions = screen.getByRole("group", { name: "By encoder version" });
    expect(within(versions).getByText("0.2.9 – 10")).toBeInTheDocument();
    // The newest group is still collecting runs, and says so.
    expect(versions).toHaveTextContent(/The newest group is the current encoder so far: 5 runs\./);

    const holds = screen.getByRole("group", { name: "What holds PRs in review" });
    fireEvent.click(within(holds).getByRole("button", { name: "By error" }));
    fireEvent.click(within(holds).getByRole("button", { name: /does not match the running pinned encoder\s*1/ }));
    const list = screen.getByRole("region", { name: /^In review: - … does not match/ });
    // The row's detail keeps the failing check but not the error its group already names.
    expect(within(list).getByText("failing: validate / validate (dk)")).toBeInTheDocument();
  });

  it("says when no cost or encoder versions are recorded, and needs no scope bar for one jurisdiction", () => {
    const attempts = [pipelineAttempt()];
    render(
      <OpsPipeline
        view={pipelineView(attempts, NOW)}
        insights={pipelineInsights(attempts, NOW)}
        scopes={scopeOptions(attempts, null)}
        queued={null}
        referenceMs={NOW}
      />
    );
    expect(screen.queryByRole("navigation", { name: "Jurisdiction" })).not.toBeInTheDocument();
    expect(screen.getByText("No run records its cost yet")).toBeInTheDocument();
    expect(screen.getByText("No encoder versions recorded yet.")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Runs and retries" })).queryByText("Dispatched most")).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "What holds PRs in review" })).queryByRole("button", { name: "By error" })).not.toBeInTheDocument();
  });

  it("summarizes on one screen, with Details open below it", () => {
    const attempts = [
      ...["us/a", "us/b", "us/c"].map((citation, i) =>
        pipelineAttempt({ id: `f${i}`, citation, encoder_error_rule: "rule-a", failure_source: "diagnostics" })
      ),
      pipelineAttempt({ id: "r", citation: "us/r", run_conclusion: "success", pr_state: "draft", pr_created_at: "2026-09-01T00:00:00Z", pr_checks: "failure", pr_failed_checks: ["validate / validate (us)"] }),
      mergedAttempt({ id: "m", citation: "us/m", synced_at: "2026-09-22T00:00:00Z", index_status: "indexed", tests_status: "pass" }),
      mergedAttempt({ id: "o", citation: "us/o", pr_targets_default: false, pr_base_branch: "codex/x" }),
    ];
    render(
      <OpsPipeline
        view={pipelineView(attempts, NOW)}
        insights={pipelineInsights(attempts, NOW)}
        queued={queuedWith({ pending: 935 })}
        referenceMs={NOW}
      />
    );
    // Details is always open: the stage strip and the cards show without a click.
    expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Pipeline stages" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Why encodes fail" })).toBeInTheDocument();

    const states = screen.getByRole("list", { name: "Where each citation is now" });
    fireEvent.click(within(states).getByRole("button", { name: /^Encoding fails\s*3$/ }));
    expect(within(openList()).getByRole("heading", { name: /Encoding fails\s*3/ })).toBeInTheDocument();
    expect(within(states).getByRole("button", { name: /^Encoding fails\s*3$/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(states).getByRole("button", { name: /^Merged elsewhere\s*1$/ }));
    expect(within(openList()).getByText("Merged into codex/x")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "935 queued" }));
    expect(screen.getByRole("region", { name: "Queued items" })).toBeInTheDocument();

    // The largest piles first, wherever they sit; each opens its citations.
    const blockers = screen.getByRole("group", { name: "Top blockers" });
    const rows = within(within(blockers).getByRole("list")).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "EncodeFailed validation3",
      "ReviewFails its own checks1",
      "MergeMerged off main1",
    ]);
    fireEvent.click(rows[1]);
    expect(within(openList()).getByRole("heading", { name: /In review: Fails its own checks\s*1/ })).toBeInTheDocument();

    // The last full week, since the current one has only begun; its "?" says so.
    const trend = screen.getByRole("group", { name: "Weekly trend" });
    expect(trend.querySelectorAll("[title^='Week of']")).toHaveLength(3 * 8);
    fireEvent.click(within(trend).getByRole("button", { name: "What Weekly means" }));
    expect(within(trend).getByRole("note")).toHaveTextContent(/last 8 weeks\. The number is the last full week\./);
    // Names and numbers only; meanings sit behind each "?".
    expect(screen.queryByText(/stages · corpus/)).not.toBeInTheDocument();
    press(screen.getByRole("button", { name: "What Where each citation is now means" }));
    expect(screen.getByRole("note")).toHaveTextContent(/^Each citation counts once, at the stage its latest run reached/);
    expect(within(blockers).getByRole("button", { name: "What Top blockers means" })).toBeInTheDocument();

  });

  it("puts every citation in one group, by where its latest run left it, adding up to all of them", () => {
    const attempts = [
      pipelineAttempt({ id: "a", citation: "us/a" }),
      pipelineAttempt({ id: "b", citation: "us/b", run_conclusion: "success" }),
      pipelineAttempt({ id: "c", citation: "us/c", run_conclusion: "success", pr_state: "closed", pr_url: "u" }),
      mergedAttempt({ id: "g", citation: "us/g", tests_status: "pass", synced_at: "S", index_status: "indexed" }),
    ];
    render(<OpsPipeline view={pipelineView(attempts, NOW)} insights={pipelineInsights(attempts, NOW)} queued={null} referenceMs={NOW} />);
    expect(screen.getByText("4 citations · where each one is now")).toBeInTheDocument();
    const states = screen.getByRole("list", { name: "Where each citation is now" });
    // A group of several stages names its parts.
    expect(within(states).getAllByRole("button").map((row) => [row.textContent, row.title])).toEqual([
      ["Encoding fails1", "latest run failed"],
      ["No open PR2", "1 without a PR · 1 PR closed"],
      ["Done1", "tests pass on main"],
    ]);
    fireEvent.click(within(states).getByRole("button", { name: /^No open PR\s*2$/ }));
    const list = screen.getByRole("region", { name: /^No open PR/ });
    expect(within(list).getByRole("link", { name: "us/b" })).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "us/c" })).toBeInTheDocument();
  });

  it("says when nothing is stuck", () => {
    const attempts = [mergedAttempt({ synced_at: "2026-09-22T00:00:00Z", index_status: "indexed", tests_status: "pass" })];
    render(<OpsPipeline view={pipelineView(attempts, NOW)} queued={null} referenceMs={NOW} />);
    expect(within(screen.getByRole("group", { name: "Top blockers" })).getByText("Nothing is stuck.")).toBeInTheDocument();
  });

  describe("flow and run log", () => {
    const attempts = [
      pipelineAttempt({ id: "c", citation: "us/c", run_conclusion: "cancelled", cancel_stage: "approval" }),
      pipelineAttempt({ id: "v", citation: "us/v", encoder_error_rule: "rule-a", encoder_error: "a.yaml: ci: [rule-a] x", failure_source: "diagnostics", encoder_version: "0.2.9", dispatched_by: "Pavel" }),
      mergedAttempt({ id: "m", citation: "us/m", encoder_version: "0.2.10", synced_at: "S", index_status: "indexed", tests_status: "pass" }),
    ];
    const rows = runRows(attempts);
    const renderFlow = (scope: { jurisdiction: string; only: boolean } | null = null) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ rows }) }) as Response)
      );
      render(
        <OpsPipeline
          view={pipelineView(attempts, NOW)}
          insights={pipelineInsights(attempts, NOW)}
          scope={scope}
          queued={null}
          flow={dispatchFlow(rows).map((g) => ({ ...g, segments: g.segments.map((seg) => ({ ...seg, ids: [] })) }))}
          referenceMs={NOW}
        />
      );
    };

    it("opens on the flow, and lists the runs behind a part of it", async () => {
      renderFlow({ jurisdiction: "us", only: true });
      expect(screen.getByRole("tab", { name: "Flow" })).toHaveAttribute("aria-selected", "true");
      // One row per step: its time, how many went on of those that reached it, and what stopped there.
      expect(stepRows()).toEqual([
        "Signing approval?—2 of 31 cancelled",
        "Encode run?—1 of 21 failed ▾",
        "Pull request?—1 of 1—",
        "Review?—1 of 1—",
        "Main branch?—1 of 1—",
        "Index?—1 of 1—",
        "Tests on main?—1 of 1—",
      ]);
      const flow = within(screen.getByRole("region", { name: "Steps" })).getByRole("table");
      // Encode failures fold into one "failed" that opens their reasons.
      const failed = within(flow).getByRole("button", { name: "1 failed" });
      expect(failed).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(failed);
      const reasons = within(flow).getByRole("group", { name: "Why encode runs failed" });
      fireEvent.click(within(reasons).getByRole("button", { name: "Failed validation 1" }));
      const list = await screen.findByRole("region", { name: "Encode run: Failed validation runs" });
      expect(fetch).toHaveBeenCalledWith("/ops/runs?j=us&only=1");
      expect(within(list).getByRole("link", { name: "us/v" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fv");
      expect(within(list).getByText("Failed validation · rule-a")).toBeInTheDocument();
      expect(within(list).getByText(/by Pavel · encoder 0.2.9/)).toBeInTheDocument();
      // Every number opens its runs, reusing the runs already loaded.
      fireEvent.click(within(flow).getByRole("button", { name: "1 tests pass" }));
      await screen.findByRole("region", { name: "Tests on main: Tests pass runs" });
      fireEvent.click(within(flow).getByRole("button", { name: "1 cancelled" }));
      await screen.findByRole("region", { name: "Signing approval: Cancelled at approval runs" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("times each step in the table, with every timing behind its \"?\"", () => {
      const minute = (n: number) => new Date(Date.parse("2026-09-20T10:00:00Z") + n * 60_000).toISOString();
      const timed = runRows([
        ...Array.from({ length: 10 }, (_, i) =>
          pipelineAttempt({
            id: `t${i}`,
            encode_started_at: minute(i + 1),
            finished_at: minute(i + 11),
            run_conclusion: "success",
          })
        ),
        mergedAttempt({ id: "m" }),
      ]);
      render(
        <OpsPipeline
          view={pipelineView(attempts, NOW)}
          queued={null}
          flow={dispatchFlow(timed)}
          times={stepTimes(timed, NOW)}
          referenceMs={NOW}
        />
      );
      // The typical time per step; a step that takes none, or is not timed yet, shows a dash.
      expect(stepRows()).toEqual([
        "Signing approval?6m11 of 11—",
        "Encode run?10m11 of 11—",
        "Pull request?—1 of 1110 without a PR",
        "Review?22h 31m1 of 1—",
        "Main branch?—1 of 1—",
        "Index?—0 of 11 pending index",
      ]);
      const table = within(screen.getByRole("region", { name: "Steps" })).getByRole("table");
      const help = within(table).getByRole("button", { name: "What Signing approval means" });
      expect(help).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(help);
      expect(help).toHaveAttribute("aria-expanded", "true");
      expect(within(table).getByRole("note")).toHaveTextContent(
        "From the dispatch until a person approves the signing and the encode job starts.6m typical over 10 runs; the slowest 10% 9m or more"
      );
      // One merged PR: a typical time with no slowest tenth.
      press(within(table).getByRole("button", { name: "What Review means" }));
      expect(within(table).getByRole("note")).toHaveTextContent(/Merged: 22h 31m typical over 1 run$/);
      // A click elsewhere closes it, and so does Escape.
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      fireEvent.click(help);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });

    it("opens up the encode run into its parts and the tries its loop used", () => {
      const runs = runRows([
        pipelineAttempt({ id: "e", run_conclusion: "success", setup_seconds: 250, encode_seconds: 370, publish_seconds: 35, generation_attempts: 2 }),
        pipelineAttempt({ id: "f", run_conclusion: "failure", setup_seconds: 260, encode_seconds: 1210, generation_attempts: 4 }),
        pipelineAttempt({ id: "n", run_conclusion: "failure" }),
      ]);
      render(
        <OpsPipeline
          view={pipelineView(attempts, NOW)}
          queued={null}
          flow={dispatchFlow(runs)}
          parts={encodeParts(runs)}
          referenceMs={NOW}
        />
      );
      const section = screen.getByRole("region", { name: "Inside the encode run" });
      const parts = within(section).getAllByRole("listitem");
      expect(parts.map((part) => part.textContent)).toEqual([
        "Setup?4m",
        "Encode loop?Encoded6mFailed20m",
        "Model time?Not timed yet",
        "Check time?Not timed yet",
        "Sign and open the PR?35s",
      ]);
      fireEvent.click(within(parts[1]).getByRole("button", { name: "What Encode loop means" }));
      expect(within(parts[1]).getByRole("note")).toHaveTextContent(/^The "Encode, review, validate, and apply" step/);
      press(within(section).getByRole("button", { name: "What Tries used means" }));
      expect(within(section).getByRole("note")).toHaveTextContent(/which 2 of 3 finished runs have\.$/);
      const table = within(section).getByRole("table");
      expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
        "Tries1234",
        "Encoded0100",
        "Failed0001",
      ]);
    });

    it("puts the tests on main's wait, run, and first results behind its \"?\"", () => {
      const runs = runRows([
        mergedAttempt({
          id: "a",
          pr_merged_at: "2026-09-21T09:00:00Z",
          synced_at: "S",
          index_status: "indexed",
          tests_status: "pass",
          tests_first_started_at: "2026-09-21T09:16:00Z",
          tests_first_at: "2026-09-21T11:07:00Z",
          tests_first_status: "pass",
        }),
      ]);
      render(
        <OpsPipeline
          view={pipelineView(attempts, NOW)}
          queued={null}
          flow={dispatchFlow(runs)}
          times={stepTimes(runs, NOW)}
          testParts={testsParts(runs)}
          referenceMs={NOW}
        />
      );
      expect(screen.queryByRole("region", { name: "Inside the tests on main" })).not.toBeInTheDocument();
      expect(stepRows().at(-1)).toBe("Tests on main?2h 7m1 of 1—");
      fireEvent.click(screen.getByRole("button", { name: "What Tests on main means" }));
      expect(screen.getByRole("note")).toHaveTextContent(
        /Wait to start: 16m typical over 1 runValidation run: 1h 51m typical over 1 runFirst result at the merge: 1 pass, 0 fail$/
      );
    });

    it("stops the rows after a step nothing went on from", () => {
      const cancelled = runRows([pipelineAttempt({ run_conclusion: "cancelled", cancel_stage: "approval" })]);
      render(<OpsPipeline view={pipelineView(attempts, NOW)} queued={null} flow={dispatchFlow(cancelled)} referenceMs={NOW} />);
      expect(stepRows()).toEqual(["Signing approval?—0 of 11 cancelled"]);
    });

  });
});
