import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { attemptEvents } from "@/lib/axiom/pipeline-events";
import { caseDetail, citationLanes, mineFlow, type StationStats } from "@/lib/axiom/pipeline-flow";
import { ingestEvents } from "@/lib/axiom/pipeline-ingest";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import { FlowLine, flowHref, JourneyView, type FlowParams } from "./flow-page";
import { layoutRows, wrapWords } from "./pipeline-diagram";

// The canvases need a real browser (React Flow measures the DOM).
vi.mock("./level-canvases", () => ({
  LanesCanvas: () => <div data-testid="lanes-canvas" />,
  CaseCanvas: () => <div data-testid="case-canvas" />,
}));

const NOW = Date.parse("2026-09-30T12:00:00Z");
const tryOf = (attempt: number, ok: boolean) => ({ attempt, model: "m", ms: 1000, cost: 0.01, ok, error: ok ? null : "x: ci: [r:tests] no" });
const events = [
  pipelineAttempt({ id: "1", failed_step: "encode_apply", tries: [tryOf(1, false), tryOf(2, false)] }),
  mergedAttempt({ id: "2", citation: "us/b", tries: [tryOf(1, false), tryOf(2, true)], indexed_at: "2026-09-21T12:00:00Z", tests_status: "pass", tests_first_at: "2026-09-21T10:00:00Z" }),
].flatMap(attemptEvents);
const model = mineFlow(events, {
  now: NOW,
  days: 30,
  targets: [{ station: "validate", min_yield: 0.9, max_p95_hours: null, max_wip: null, sla_hours: null }],
  workflows: [{ label: "Release activation", grade: "failing", url: "https://x", detail: "Last run failed" }],
});
const params: FlowParams = { window: 30, j: null, only: false, pop: "all", view: "pipeline", station: null, citation: null, case: null, program: null, bundle: null };

function line(overrides: Partial<FlowParams> = {}) {
  return render(<FlowLine model={model} error={null} params={{ ...params, ...overrides }} jurisdictions={["us", "dk"]} />);
}

describe("flowHref", () => {
  it("links the line to the Line tab, keeping the window and scope", () => {
    expect(flowHref(params, {})).toBe("/ops?tab=line");
    expect(flowHref({ ...params, window: 7, j: "us" }, { station: "validate" })).toBe("/ops?tab=line&window=7&j=us&station=validate");
    // The US alone (Federal); without a jurisdiction, `only` drops out.
    expect(flowHref({ ...params, j: "us", only: true }, {})).toBe("/ops?tab=line&j=us&only=1");
    expect(flowHref({ ...params, only: true }, {})).toBe("/ops?tab=line");
    expect(flowHref(params, { pop: "prs" })).toBe("/ops?tab=line&pop=prs");
  });

  it("links a citation and a run to the journey, and programs to the Programs tab", () => {
    expect(flowHref(params, { citation: "us/a", case: "7" })).toBe("/ops/journey?citation=us%2Fa&case=7");
    expect(flowHref(params, { view: "programs", bundle: "us-or/snap" })).toBe("/ops?tab=programs&bundle=us-or%2Fsnap");
    expect(flowHref(params, { view: "programs", program: "snap" })).toBe("/ops?tab=programs&program=snap");
  });
});

describe("FlowLine", () => {
  it("shows each stage as evidence: counts, result, times and the main exit reason", () => {
    line();
    expect(screen.getByRole("table", { name: "Stages" })).toBeTruthy();
    const validate = screen.getByRole("rowheader", { name: "Validate" }).closest("tr")!;
    expect(validate.textContent).toContain("R: tests");
    // Validate passed one of two runs; its tries passed one of four.
    expect(validate.textContent).toContain("50%");
    expect(validate.textContent).toContain("tries 25%");
    // A person acts at review and merge.
    expect(screen.getAllByLabelText("A person acts here").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Encode loop" }).textContent).toContain("1 of 2");
    // No targets, alerts or advice on the page.
    expect(screen.queryByText("Release activation is failing")).toBeNull();
    expect(screen.queryByText(/on target|off target|no target/i)).toBeNull();
  });

  it("draws the line as a diagram: a row per phase, each stage with its counts and the retry loop", () => {
    line();
    const diagram = screen.getByRole("figure", { name: "The pipeline as a diagram" });
    const text = diagram.textContent ?? "";
    expect(text).toContain("ENCODE");
    expect(text).toContain("VALIDATE");
    expect(text).toContain("50% passed");
    expect(text).toContain("tries: 1 of 4 passed");
    expect(text).toContain("1 left the line");
    // Two runs reached Generate with four tries: two were retries.
    expect(text).toContain("↺ 2 retries");
    expect(text).toContain("REVIEW · PERSON");
  });

  it("lists the failed cases by failure class, with who owns the fix", () => {
    line();
    const table = screen.getByRole("table", { name: "Failure classes" });
    const row = within(table).getByRole("rowheader", { name: "Validator rejected the output" }).closest("tr")!;
    expect(row.textContent).toContain("Encoder or validator");
    expect(row.textContent).toContain("stage or rule");
  });

  it("draws the corpus line first, and a stage with no event dashed with why it is not measured", () => {
    const releases = ingestEvents({
      releases: [{ name: "us-rulespec-r1", signedAt: "2026-09-20T01:00:00Z" }],
      runs: [],
      prs: {},
      activations: [{ release_name: "us-rulespec-r1", activated_at: "2026-09-20T05:00:00Z" }],
      pins: [{ repo: "rulespec-us", release: "us-rulespec-r1", at: "2026-09-21T01:00:00Z", ref_url: null }],
      toActivate: [],
    });
    const withIngest = mineFlow([...events, ...releases], { now: NOW, days: 30, unmeasured: { target_gate: "gate not live yet" } });
    render(<FlowLine model={withIngest} error={null} params={params} jurisdictions={[]} />);
    const text = screen.getByRole("figure", { name: "The pipeline as a diagram" }).textContent ?? "";
    expect(text.indexOf("INGEST")).toBeLessThan(text.indexOf("START"));
    expect(text).toContain("RELEASE ACTIVATE · PERSON");
    expect(text).toContain("RELEASE PIN · PERSON");
    // Activate and pin do not wait for each other: one column, side by side.
    expect(text).toContain("IN PARALLEL");
    expect(text).toContain("TARGET GATE");
    expect(text).toContain("gate not live yet");
    expect(text).toContain("not measured yet");
    const gate = screen.getByRole("rowheader", { name: "Target gate" }).closest("tr")!;
    expect(gate.textContent).toContain("not measured");
    expect(gate.textContent).toContain("Gate not live yet");
    const covers = screen.getByRole("region", { name: "What the data covers" }).textContent ?? "";
    expect(covers).toContain("Not measured: Target gate (gate not live yet).");
    expect(covers).toContain("1 corpus releases in the window.");
  });

  it("labels the three filters and gives the Stages panel no subtitle", () => {
    line();
    const filters = screen.getByRole("navigation", { name: "Window" }).closest("header")!;
    expect(filters.textContent).toMatch(/^Window.*Runs.*Jurisdiction/);
    expect(screen.getByRole("combobox", { name: "Jurisdiction" })).toBeTruthy();
    const stages = screen.getByRole("region", { name: "Stages" });
    expect(stages.querySelector("header p")).toBeNull();
    expect(stages.textContent).not.toContain("Cases that reached");
  });

  it("stacks parallel stages in one column and makes their row taller", () => {
    const stage = (id: string) => ({ id }) as StationStats;
    const [ingest, start] = layoutRows([
      { id: "ingest", label: "Ingest", stations: ["a", "b", "c", "d"].map(stage), parallel: ["c", "d"] },
      { id: "start", label: "Start", stations: ["e", "f"].map(stage) },
    ]);
    expect(ingest.cols.map((col) => col.map((p) => p.s.id))).toEqual([["a"], ["b"], ["c", "d"]]);
    expect(ingest.cols[2][0].x).toBe(ingest.cols[2][1].x);
    expect(ingest.cols[2][1].y).toBeGreaterThan(ingest.cols[2][0].y);
    // A single stage sits halfway down the taller row.
    expect(ingest.cols[0][0].y).toBe((ingest.cols[2][0].y + ingest.cols[2][1].y) / 2);
    expect(start.top).toBeGreaterThan(ingest.top + ingest.height);
    expect(start.height).toBeLessThan(ingest.height);
  });

  it("wraps a stage's note into short lines", () => {
    expect(wrapWords("needs a GitHub token to read the pin history")).toEqual(["needs a GitHub token to", "read the pin history"]);
    expect(wrapWords("one two three four five six seven eight nine ten eleven twelve", 10, 2)).toEqual(["one two", "three fou…"]);
  });

  it("switches the path and keeps the window and scope", () => {
    line({ window: 7, j: "us" });
    const path = screen.getByRole("navigation", { name: "Runs" });
    expect(path.querySelector('[aria-current="page"]')?.textContent).toBe("All");
    expect(screen.getByRole("link", { name: "Hand-made PRs" }).getAttribute("href")).toBe("/ops?tab=line&window=7&j=us&pop=prs");
  });
});

describe("JourneyView", () => {
  const stationOrder = model.stations.map((s) => s.id);

  it("shows a citation's lanes, and one run", () => {
    render(
      <JourneyView
        citation="us/statute/7/2017/a"
        stationOrder={stationOrder}
        lanes={citationLanes(events, "us/statute/7/2017/a")}
        detail={null}
        bundles={[{ bundle_id: "us/snap", bundle_title: "SNAP", tiers: [{ tier: "full", index: 2, title: "Full", document: "7 USC 2017" }] }]}
       
        error={null}
      />
    );
    expect(screen.getByTestId("lanes-canvas")).toBeTruthy();
    expect(screen.getByRole("link", { name: "SNAP" })).toHaveAttribute("href", "/ops?tab=programs&bundle=us/snap");
    cleanup();
    const detail = caseDetail(events, "1")!;
    render(<JourneyView citation={detail.citation} stationOrder={stationOrder} lanes={[]} detail={detail} bundles={[]} error={null} />);
    expect(screen.getByRole("complementary", { name: "Run details" })).toBeTruthy();
  });

  it("shows a plain title with no citation", () => {
    render(<JourneyView citation={null} stationOrder={[]} lanes={[]} detail={null} bundles={[]} error={null} />);
    expect(screen.getByRole("heading", { name: "Encoding journey" })).toBeTruthy();
  });
});

describe("Waiting now", () => {
  it("lists where open cases wait, why, since when, and links the oldest to its journey", () => {
    const open = pipelineAttempt({
      id: "9",
      citation: "us/behind",
      run_conclusion: "success",
      encode_seconds: 60,
      pr_repo: "rulespec-us",
      pr_number: 9,
      pr_url: "https://github.com/x/pull/9",
      pr_state: "open",
      pr_created_at: "2026-09-20T10:29:00Z",
      pr_checks: "success",
      pr_review: "none",
      pr_merge_state: "BEHIND",
      pr_commit_count: 3,
    });
    const waiting = mineFlow(attemptEvents(open), { now: NOW, days: 30 });
    render(<FlowLine model={waiting} error={null} params={params} jurisdictions={[]} />);
    const table = screen.getByRole("table", { name: "Waiting now" });
    const row = within(table).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Behind the default branch");
    expect(row).toHaveTextContent("10d");
    expect(within(row).getByRole("link", { name: "us/behind" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fbehind");
    cleanup();
  });

  it("has no panel when nothing is open", () => {
    const done = mineFlow(attemptEvents(pipelineAttempt({ id: "1", failed_step: "encode_apply", tries: [tryOf(1, false)] })), { now: NOW, days: 30 });
    render(<FlowLine model={done} error={null} params={params} jurisdictions={[]} />);
    expect(screen.queryByRole("table", { name: "Waiting now" })).toBeNull();
    cleanup();
  });
});
