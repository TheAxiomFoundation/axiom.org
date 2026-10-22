import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { acceptedSeries, moduleLedger } from "@/lib/axiom/accepted-modules";
import { attemptEvents } from "@/lib/axiom/pipeline-events";
import { caseDetail, citationLanes, mineFlow } from "@/lib/axiom/pipeline-flow";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import { AcceptedHeadline, FlowLine, flowHref, JourneyView, ProgramsMap, type FlowParams } from "./flow-page";

// The canvases need a real browser (React Flow measures the DOM).
vi.mock("./pipeline-canvas", () => ({
  PipelineCanvas: () => <div data-testid="pipeline-canvas" />,
}));
vi.mock("./level-canvases", () => ({
  LanesCanvas: () => <div data-testid="lanes-canvas" />,
  CaseCanvas: () => <div data-testid="case-canvas" />,
  ProgramsCanvas: () => <div data-testid="programs-canvas" />,
  DocumentsCanvas: () => <div data-testid="documents-canvas" />,
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
const params: FlowParams = { window: 30, j: null, pop: "all", view: "pipeline", station: null, citation: null, case: null, program: null, bundle: null };

function line(overrides: Partial<FlowParams> = {}) {
  return render(<FlowLine model={model} origin="derived" targetsSeeded error={null} params={{ ...params, ...overrides }} jurisdictions={["us", "dk"]} />);
}

describe("flowHref", () => {
  it("links the line to the Line tab, keeping the window and scope", () => {
    expect(flowHref(params, {})).toBe("/ops?tab=line");
    expect(flowHref({ ...params, window: 7, j: "us" }, { station: "validate" })).toBe("/ops?tab=line&window=7&j=us&station=validate");
    expect(flowHref(params, { view: "discovery" })).toBe("/ops?tab=line&view=discovery");
    expect(flowHref(params, { pop: "runs" })).toBe("/ops?tab=line&pop=runs");
  });

  it("links a citation and a run to the journey, and programs to the Programs tab", () => {
    expect(flowHref(params, { citation: "us/a", case: "7" })).toBe("/ops/journey?citation=us%2Fa&case=7");
    expect(flowHref(params, { view: "programs", bundle: "us-or/snap" })).toBe("/ops?tab=programs&bundle=us-or%2Fsnap");
    expect(flowHref(params, { view: "programs", program: "snap" })).toBe("/ops?tab=programs&program=snap");
  });
});

describe("FlowLine", () => {
  it("shows the line as a diagram, with where its reasons come from", () => {
    line();
    expect(screen.getByTestId("pipeline-canvas")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where do these reasons come from?" })).toBeTruthy();
    expect(screen.getAllByText("Validator check").length).toBeGreaterThan(0);
    expect(screen.queryByRole("navigation", { name: "Which cases" })).toBeNull();
    expect(screen.getByText("Release activation is failing")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Is each station getting better or worse?" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How much can these numbers see?" })).toBeTruthy();
    expect(screen.getByText("How many runs went in?")).toBeTruthy();
    expect(screen.getByText(/Derived from encodings.pipeline_attempts/)).toBeTruthy();
  });

  it("opens a station's detail beside the diagram", () => {
    line({ station: "validate" });
    expect(screen.getByRole("complementary", { name: "Validate details" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How cases fail here" })).toBeTruthy();
    expect(screen.getAllByText("r:tests").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/runs ended/).length).toBeGreaterThan(0);
  });

  it("shows loops and rules as four questions with answers", () => {
    line({ view: "discovery" });
    expect(screen.getByRole("heading", { name: "The rules the encoder does not fix, week by week" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "When one rule is fixed, which one comes next" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rules that come back on the next try" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dispatched again and again, never merged" })).toBeTruthy();
  });
});

describe("AcceptedHeadline", () => {
  it("shows the accepted headline with the modules not measured beside it", () => {
    const rows = [
      mergedAttempt({ id: "a", index_status: "indexed", synced_at: "2026-09-21T10:00:00Z", compile_status: "ok", compile_checked_at: "2026-09-22T03:00:00Z", tests_status: "pass" }),
      mergedAttempt({ id: "dk", pr_repo: "rulespec-dk", module_paths: ["dk/x.yaml"], index_status: "missing" }),
    ];
    render(<AcceptedHeadline series={acceptedSeries(moduleLedger(rows.flatMap(attemptEvents)), NOW)} />);
    const headline = screen.getByLabelText("Accepted modules");
    expect(headline.textContent).toContain("How many modules are accepted?1");
    expect(headline.textContent).toContain("Not measured1");
    expect(headline.textContent).toContain("dk 1");
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
        origin="derived"
        error={null}
      />
    );
    expect(screen.getByTestId("lanes-canvas")).toBeTruthy();
    expect(screen.getByRole("link", { name: "SNAP" })).toHaveAttribute("href", "/ops?tab=programs&bundle=us/snap");
    cleanup();
    const detail = caseDetail(events, "1")!;
    render(<JourneyView citation={detail.citation} stationOrder={stationOrder} lanes={[]} detail={detail} bundles={[]} origin="derived" error={null} />);
    expect(screen.getByRole("complementary", { name: "Run details" })).toBeTruthy();
  });

  it("says what to do with no citation", () => {
    render(<JourneyView citation={null} stationOrder={[]} lanes={[]} detail={null} bundles={[]} origin="table" error={null} />);
    expect(screen.getByText(/Pick a citation from the Line tab/)).toBeTruthy();
  });
});

describe("ProgramsMap", () => {
  it("shows programs, or a bundle's documents", () => {
    render(<ProgramsMap programs={[{ id: "snap", title: "SNAP", bundles: [], documents: 1, done: 0, href: "/x" }]} documents={null} />);
    expect(screen.getByTestId("programs-canvas")).toBeTruthy();
    cleanup();
    render(<ProgramsMap programs={null} documents={[]} />);
    expect(screen.getByTestId("documents-canvas")).toBeTruthy();
    cleanup();
    const { container } = render(<ProgramsMap programs={[]} documents={null} />);
    expect(container.innerHTML).toBe("");
  });
});
