import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { attemptEvents } from "@/lib/axiom/pipeline-events";
import { caseDetail, citationLanes, mineFlow } from "@/lib/axiom/pipeline-flow";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import { FlowLine, flowHref, JourneyView, type FlowParams } from "./flow-page";

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
const params: FlowParams = { window: 30, j: null, pop: "all", view: "pipeline", station: null, citation: null, case: null, program: null, bundle: null };

function line(overrides: Partial<FlowParams> = {}) {
  return render(<FlowLine model={model} error={null} params={{ ...params, ...overrides }} jurisdictions={["us", "dk"]} />);
}

describe("flowHref", () => {
  it("links the line to the Line tab, keeping the window and scope", () => {
    expect(flowHref(params, {})).toBe("/ops?tab=line");
    expect(flowHref({ ...params, window: 7, j: "us" }, { station: "validate" })).toBe("/ops?tab=line&window=7&j=us&station=validate");
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

  it("switches the path and keeps the window and scope", () => {
    line({ window: 7, j: "us" });
    const path = screen.getByRole("navigation", { name: "Path" });
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
