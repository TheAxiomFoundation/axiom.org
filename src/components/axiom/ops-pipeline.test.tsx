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
    blockedNote: null,
    pausedReason: "Awaiting a green tip.",
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
  blockedNote: null,
  pausedReason: null,
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
    renderPipeline(quiet, queuedWith({ inFlight: 1, blocked: 19, blockedNote: { note: "skipped for the pilot", count: 19 } }));
    expect(screen.getByText("19 blocked")).toHaveAttribute("title", "skipped for the pilot");
    expect(screen.queryByRole("button", { name: /Biggest bottleneck/ })).not.toBeInTheDocument();
    cleanup();
    renderPipeline(quiet, queuedWith({ blocked: 2 }));
    expect(screen.getByText("2 blocked")).not.toHaveAttribute("title");
    cleanup();
    renderPipeline(quiet, queuedWith({ queues: 3, inFlight: 4 }));
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
        blocked: 3,
        inFlight: 1,
        pausedReason: "Paused",
        items: [
          item("us-or/a", "blocked", { why: "skipped for the pilot", label: "Page 26", attempts: 0, lastAt: null, runUrl: null }),
          item("us-or/b", "blocked", { why: "failed 2 times", attempts: 2 }),
          item("us-or/e", "blocked", { why: "skipped for the pilot", label: "Page 27", attempts: 0, lastAt: null, runUrl: null }),
          item("us-ut/c", "dispatched", { prUrl: "https://github.com/x/pull/1" }),
          item("us-ut/d", "retrying", { why: "failure: Encode, review, validate, and apply" }),
        ],
        notStarted: [
          { jurisdiction: "us-or", count: 562 },
          { jurisdiction: "us-ut", count: 353 },
        ],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Queued\s*935\s*3 blocked/ }));
    const list = screen.getByRole("region", { name: "Queued items" });
    expect(within(list).getByText(/^Paused; nothing new is dispatched\./)).toBeInTheDocument();
    const blocked = within(list).getByRole("region", { name: "Needs a person" });
    expect(within(blocked).getByRole("link", { name: "us-or/a" })).toHaveAttribute("href", "/ops/journey?citation=us-or%2Fa");
    expect(within(blocked).getByText("Page 26")).toBeInTheDocument();
    expect(within(blocked).getByText("2 runs")).toBeInTheDocument();
    // Shared reasons are said once, with how many items share them.
    expect(within(blocked).getAllByText("skipped for the pilot")).toHaveLength(1);
    expect(within(blocked).getByText("skipped for the pilot").textContent).toBe("skipped for the pilot2");
    expect(within(list).getByRole("region", { name: "Run open" })).toHaveTextContent("PR");
    expect(within(list).getByRole("region", { name: "Retrying after a failed run" })).toHaveTextContent(
      "failure: Encode, review, validate, and apply"
    );
    expect(within(list).getByRole("region", { name: "Run open" }).querySelector("p")).toBeNull();
    expect(within(list).getByText("Not started yet: us-or 562 · us-ut 353")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Queued/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(list).getByRole("button", { name: "Close list" }));
    expect(screen.queryByRole("region", { name: "Queued items" })).not.toBeInTheDocument();

    cleanup();
    renderPipeline([pipelineAttempt({ run_conclusion: "success" })], queuedWith({ pausedReason: "Awaiting a green tip." }));
    fireEvent.click(screen.getByRole("button", { name: /Queued/ }));
    expect(screen.getByText(/^Paused: Awaiting a green tip\.; nothing new/)).toBeInTheDocument();
    expect(screen.queryByText(/Not started yet/)).not.toBeInTheDocument();
  });

  it("opens the corpus releases that are out of sync, and names the ones up to date", () => {
    const row = (overrides: Partial<CorpusJurisdiction>): CorpusJurisdiction => ({
      jurisdiction: "uk",
      name: "United Kingdom",
      status: "current",
      serving: { release: "uk-rulespec-2026-09-07", since: "2026-09-13T00:00:00Z", scopes: 191 },
      newest: { release: "uk-rulespec-2026-09-07", signedAt: "2026-09-13T00:00:00Z", scopes: 191 },
      encoder: { repo: "rulespec-uk", release: "uk-rulespec-2026-09-07", registered: true },
      since: null,
      ...overrides,
    });
    const corpus: CorpusView = {
      outOfSync: 3,
      openPrs: { count: 47, oldestAt: "2026-07-16T00:00:00Z", url: "https://github.com/c/pulls" },
      lastPublish: { conclusion: "failure", at: "2026-09-25T12:00:00Z", url: "https://github.com/c/runs/1" },
      jurisdictions: [
        row({
          jurisdiction: "de",
          name: "Germany",
          status: "not_serving",
          serving: null,
          newest: { release: "de-rulespec-2026-09-15-x", signedAt: "2026-09-15T00:00:00Z", scopes: 62 },
          encoder: { repo: "rulespec-de", release: "de-2026-09-15-y", registered: false },
          since: "2026-09-08T00:00:00Z",
        }),
        row({
          jurisdiction: "us",
          name: "United States",
          status: "encoder_behind",
          serving: { release: "us-rulespec-2026-09-14-union", since: "2026-09-14T00:00:00Z", scopes: 1040 },
          newest: { release: "us-rulespec-2026-09-14-union", signedAt: "2026-09-14T00:00:00Z", scopes: 1040 },
          encoder: null,
          since: "2026-09-14T00:00:00Z",
        }),
        row({
          jurisdiction: "ng",
          name: "Nigeria",
          status: "not_serving",
          serving: null,
          newest: { release: "ng-rulespec-2026-07-10", signedAt: "2026-07-12T00:00:00Z", scopes: 1 },
          encoder: null,
          since: "2026-07-12T00:00:00Z",
        }),
        row({}),
        row({ jurisdiction: "nz", name: "New Zealand" }),
      ],
    };
    renderPipeline(undefined, undefined, corpus);
    const corpusTile = screen.getByRole("button", { name: /Corpus\s*5\s*3 out of sync/ });
    fireEvent.click(corpusTile);
    expect(corpusTile).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByRole("region", { name: "Corpus releases" });
    expect(within(list).getByRole("link", { name: "47 open PRs in axiom-corpus, oldest 11w" })).toHaveAttribute(
      "href",
      "https://github.com/c/pulls"
    );
    expect(within(list).getByRole("link", { name: "Last publish failed 5d ago" })).toBeInTheDocument();
    const groups = within(list).getAllByRole("region").map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Encoder reads an older release", "Not serving: no release activated"]);
    const notServing = within(list).getByRole("region", { name: "Not serving: no release activated" });
    expect(within(notServing).getAllByRole("listitem").map((item) => item.textContent?.split(" · ")[0])).toEqual([
      "Germany",
      "Nigeria",
    ]);
    expect(
      within(list).getByText("Serving nothing · newest 2026-09-15-x (62 scopes) · encoder reads 2026-09-15-y (not a registered release)")
    ).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "pin" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/rulespec-de/blob/main/.axiom/toolchain.toml"
    );
    expect(within(list).getByText("Serving 2026-09-14-union")).toBeInTheDocument();
    expect(within(list).getByText("Up to date: United Kingdom, New Zealand")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Close list" }));
    expect(screen.queryByRole("region", { name: "Corpus releases" })).not.toBeInTheDocument();

    cleanup();
    renderPipeline(undefined, undefined, {
      ...corpus,
      outOfSync: 0,
      openPrs: { count: 1, oldestAt: null, url: "u" },
      lastPublish: { conclusion: "success", at: "2026-09-29T12:00:00Z", url: "r" },
      jurisdictions: [row({ jurisdiction: "uk-x", name: "Somewhere", serving: { release: "other-name", since: "s", scopes: 1 } })],
    });
    fireEvent.click(screen.getByRole("button", { name: /Corpus\s*1\s*all in sync/ }));
    expect(screen.getByRole("link", { name: "1 open PR in axiom-corpus" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last publish succeeded 24h ago" })).toBeInTheDocument();

    cleanup();
    renderPipeline(undefined, undefined, { ...corpus, openPrs: null, lastPublish: null, jurisdictions: [row({ status: "encoder_off", since: "2026-09-20T00:00:00Z", newest: { release: "elsewhere", signedAt: "x", scopes: 3 } })] });
    fireEvent.click(screen.getByRole("button", { name: /Corpus/ }));
    expect(screen.getByText("Serving 2026-09-07 · newest elsewhere (3 scopes) · encoder reads 2026-09-07")).toBeInTheDocument();
    expect(screen.queryByText(/in axiom-corpus/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Up to date/)).not.toBeInTheDocument();
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
    expect(within(bar).getByRole("link", { name: /^All\s*3$/ })).toHaveAttribute("href", "/ops#pipeline-title");
    expect(within(bar).getByRole("link", { name: /^United States\s*2$/ })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: /^Denmark\s*1$/ })).toHaveAttribute("href", "/ops?j=dk#pipeline-title");
    const select = within(bar).getByRole("combobox", { name: "Within United States" });
    // All first, then the federal level, then the states by name.
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "All (2)",
      "US Federal only (1)",
      "Louisiana (1)",
    ]);
    expect(select.querySelector("optgroup")).toHaveAttribute("label", "States");
    fireEvent.change(select, { target: { value: "us:only" } });
    expect(push).toHaveBeenLastCalledWith("/ops?j=us&only=1#pipeline-title");
    fireEvent.change(select, { target: { value: "us-la" } });
    expect(push).toHaveBeenLastCalledWith("/ops?j=us-la#pipeline-title");
    fireEvent.change(select, { target: { value: "" } });
    expect(push).toHaveBeenLastCalledWith("/ops?j=us#pipeline-title");

    const funnel = screen.getByRole("list", { name: "How far each citation got" });
    expect(funnel).toHaveTextContent(/^3citations.*2encoded.*1merged.*1in main.*1tests pass$/);
    // Between the steps: what is stuck there now.
    expect(within(funnel).getByRole("button", { name: "1 failed" })).toBeInTheDocument();
    expect(within(funnel).getByRole("button", { name: "1 in review" })).toBeInTheDocument();

    const runs = screen.getByRole("group", { name: "Runs and retries" });
    expect(within(runs).getByText("of citations encode on the first attempt (2 of 3)")).toBeInTheDocument();
    expect(within(runs).getByText(/of recorded cost went to failed runs \(\$4 of \$5; 5 of 6 runs record a cost\)/)).toBeInTheDocument();
    expect(within(runs).getByText("1st attempt")).toBeInTheDocument();
    expect(within(runs).getByRole("link", { name: "us/x" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fx");
    expect(within(runs).getByText("4 dispatches · 0 encoded · 0 merged")).toBeInTheDocument();

    const versions = screen.getByRole("group", { name: "By encoder version" });
    expect(within(versions).getByText("0.2.9 – 10")).toBeInTheDocument();

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

    const funnel = screen.getByRole("list", { name: "How far each citation got" });
    expect(funnel).toHaveTextContent(/^6citations.*3encoded.*2merged.*1in main.*1tests pass$/);
    fireEvent.click(within(funnel).getByRole("button", { name: "3 failed" }));
    expect(within(openList()).getByRole("heading", { name: /Last encode failed\s*3/ })).toBeInTheDocument();
    expect(within(funnel).getByRole("button", { name: "3 failed" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(funnel).getByRole("button", { name: "1 off main" }));
    expect(within(openList()).getByText("Merged into codex/x")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "935 queued" }));
    expect(screen.getByRole("region", { name: "Queued items" })).toBeInTheDocument();

    // The largest piles first, wherever they sit; each opens its citations.
    const blockers = screen.getByRole("group", { name: "Top blockers" });
    const rows = within(within(blockers).getByRole("list")).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "EncodeValidation rules3",
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
    press(screen.getByRole("button", { name: "What Citations: how far each got means" }));
    expect(screen.getByRole("note")).toHaveTextContent(/^Each number counts citations, not runs/);
    expect(within(blockers).getByRole("button", { name: "What Top blockers means" })).toBeInTheDocument();

  });

  it("splits each drop in the summary into chips that add up to it, with re-runs apart", () => {
    const attempts = [
      pipelineAttempt({ id: "a", citation: "us/a" }),
      pipelineAttempt({ id: "c1", citation: "us/c", dispatched_at: "2026-09-21T10:00:00Z", run_conclusion: "success" }),
      pipelineAttempt({ id: "c2", citation: "us/c", dispatched_at: "2026-09-22T10:00:00Z" }),
      mergedAttempt({ id: "g", citation: "us/g", tests_status: "pass", synced_at: "S", index_status: "indexed" }),
    ];
    render(<OpsPipeline view={pipelineView(attempts, NOW)} insights={pipelineInsights(attempts, NOW)} queued={null} referenceMs={NOW} />);
    const funnel = screen.getByRole("list", { name: "How far each citation got" });
    // 3 citations, 2 encoded: one never encoded (1 failed); one encoded once, then a re-run failed.
    expect(funnel).toHaveTextContent(/^3citations→1 failed2encoded→1 re-run failed1merged/);
    fireEvent.click(within(funnel).getByRole("button", { name: "1 re-run failed" }));
    const list = screen.getByRole("region", { name: /^Re-run failed/ });
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
        "Default branch?—1 of 1—",
        "Index?—1 of 1—",
        "Tests on main?—1 of 1—",
      ]);
      const flow = within(screen.getByRole("region", { name: "Steps" })).getByRole("table");
      // Encode failures fold into one "failed" that opens their reasons.
      const failed = within(flow).getByRole("button", { name: "1 failed" });
      expect(failed).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(failed);
      const reasons = within(flow).getByRole("group", { name: "Why encode runs failed" });
      fireEvent.click(within(reasons).getByRole("button", { name: "Validation rules 1" }));
      const list = await screen.findByRole("region", { name: "Encode run: Validation rules runs" });
      expect(fetch).toHaveBeenCalledWith("/ops/runs?j=us&only=1");
      expect(within(list).getByRole("link", { name: "us/v" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fv");
      expect(within(list).getByText("Validation rules · rule-a")).toBeInTheDocument();
      expect(within(list).getByText(/by Pavel · encoder 0.2.9/)).toBeInTheDocument();
      // Every number opens its runs, reusing the runs already loaded.
      fireEvent.click(within(flow).getByRole("button", { name: "1 tests pass" }));
      await screen.findByRole("region", { name: "Tests on main: Tests pass runs" });
      fireEvent.click(within(flow).getByRole("button", { name: "1 cancelled" }));
      await screen.findByRole("region", { name: "Signing approval: Cancelled at approval runs" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("opens a section's runs in the ledger, and a run's timeline under it", async () => {
      renderFlow();
      // The ledger sits above the summary, not behind a Details tab.
      expect(screen.getByRole("region", { name: "Ledger" })).toBeInTheDocument();
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Flow", "Breakdowns"]);
      const section = await screen.findByRole("button", { name: "Runs of us/m" });
      expect(section).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: /^Timeline of us\/m/ })).not.toBeInTheDocument();
      fireEvent.click(section);
      expect(section).toHaveAttribute("aria-expanded", "true");
      const toggle = screen.getByRole("button", { name: /^Timeline of us\/m, dispatched/ });
      fireEvent.click(toggle);
      const after = screen.getByRole("region", { name: "After the PR" });
      expect(within(after).getAllByRole("listitem").map((row) => row.querySelector("span")?.textContent)).toEqual([
        "Review",
        "Index",
        "Tests on main",
      ]);
      expect(screen.getByRole("region", { name: "Encode run" })).toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.queryByRole("region", { name: "After the PR" })).not.toBeInTheDocument();
      // Closing the section closes its runs.
      fireEvent.click(section);
      expect(screen.queryByRole("button", { name: /^Timeline of us\/m/ })).not.toBeInTheDocument();
    });

    it("lists an open section's ten newest runs, and links to the rest", async () => {
      const many = runRows(
        Array.from({ length: 12 }, (_, i) =>
          pipelineAttempt({ id: `r${i}`, citation: "us/statute/7/2015/f", dispatched_at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z` })
        )
      );
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ rows: many }) }) as Response));
      render(<OpsPipeline view={pipelineView(attempts, NOW)} queued={null} flow={dispatchFlow(rows)} referenceMs={NOW} />);
      fireEvent.click(await screen.findByRole("button", { name: "Runs of us/statute/7/2015/f" }));
      expect(screen.getAllByRole("button", { name: /^Timeline of / })).toHaveLength(10);
      expect(screen.getByRole("link", { name: "All 12 runs, each with its timeline" })).toHaveAttribute(
        "href",
        "/ops/journey?citation=us%2Fstatute%2F7%2F2015%2Ff"
      );
    });

    it("filters the ledger's sections and exports their runs", async () => {
      renderFlow();
      expect(screen.getByText("Loading runs…")).toBeInTheDocument();
      await screen.findByText("3 of 3 sections · 3 runs");
      expect(fetch).toHaveBeenCalledWith("/ops/runs");
      // Each section with its latest status.
      const status = (citation: string) =>
        screen.getByRole("button", { name: `Runs of ${citation}` }).closest("tr")?.querySelector("[data-tone]")?.textContent;
      expect([status("us/c"), status("us/v"), status("us/m")]).toEqual(["Cancelled at approval", "Validation rules", "Tests pass"]);
      fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "Validation rules" } });
      expect(screen.getByText("1 of 3 sections · 1 run")).toBeInTheDocument();
      fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "" } });
      fireEvent.change(screen.getByRole("combobox", { name: "Encoder version" }), { target: { value: "0.2.10" } });
      expect(screen.getByRole("button", { name: "Runs of us/m" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Runs of us/v" })).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole("combobox", { name: "Encoder version" }), { target: { value: "" } });
      fireEvent.change(screen.getByRole("searchbox", { name: "Search citations or names" }), { target: { value: "US/C" } });
      expect(screen.getByText("1 of 3 sections · 1 run")).toBeInTheDocument();

      const created: string[] = [];
      vi.stubGlobal("URL", Object.assign(URL, {
        createObjectURL: vi.fn((blob: Blob) => {
          void blob.text().then((text) => created.push(text));
          return "blob:x";
        }),
        revokeObjectURL: vi.fn(),
      }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
      expect(click).toHaveBeenCalled();
      await waitFor(() => expect(created).toHaveLength(1));
      const [header, line] = created[0].split("\n");
      expect(header.split(",").slice(0, 3)).toEqual(["dispatched_at", "citation", "jurisdiction"]);
      expect(line).toContain("us/c");
      expect(line).toContain("Cancelled at approval");
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
        "Pull request?—1 of 1110 no PR",
        "Review?22h 31m1 of 1—",
        "Default branch?—1 of 1—",
        "Index?—0 of 11 waiting for the index",
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

    it("pages a long ledger by sections, names them, and says when it cannot load", async () => {
      const many = runRows(
        Array.from({ length: 60 }, (_, i) => pipelineAttempt({ id: `r${i}`, citation: `us/statute/7/2015/${i}` }))
      );
      const labels = { "us/statute/7": "Agriculture", "us/statute/7/2015/0": "The zeroth rule" };
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ rows: many, labels }) }) as Response));
      render(
        <OpsPipeline view={pipelineView(attempts, NOW)} queued={null} flow={dispatchFlow(rows)} referenceMs={NOW} />
      );
      await screen.findByText("60 of 60 sections · 60 runs");
      expect(screen.getAllByRole("button", { name: /^Runs of / })).toHaveLength(20);
      fireEvent.click(screen.getByRole("button", { name: "Show 20 more sections" }));
      fireEvent.click(screen.getByRole("button", { name: "Show 20 more sections" }));
      expect(screen.getAllByRole("button", { name: /^Runs of / })).toHaveLength(60);
      expect(screen.queryByRole("button", { name: /^Show \d+ more sections$/ })).not.toBeInTheDocument();
      // Sections under their source document, with their names from the corpus.
      expect(screen.getByText("Agriculture")).toBeInTheDocument();
      expect(screen.getByText("The zeroth rule")).toBeInTheDocument();
      cleanup();

      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 }) as Response));
      render(<OpsPipeline view={pipelineView(attempts, NOW)} queued={null} flow={dispatchFlow(rows)} referenceMs={NOW} />);
      await screen.findByText("The ledger could not load. Try again later.");
      // The breakdowns are still one tab away.
      await act(async () => {
        fireEvent.click(screen.getByRole("tab", { name: "Breakdowns" }));
      });
      expect(screen.getByRole("group", { name: "Why encodes fail" })).toBeInTheDocument();
    });
  });
});
