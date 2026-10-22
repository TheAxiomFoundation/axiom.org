import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { acceptedSeries, moduleLedger } from "@/lib/axiom/accepted-modules";
import { attemptEvents } from "@/lib/axiom/pipeline-events";
import { caseDetail, citationLanes, mineFlow } from "@/lib/axiom/pipeline-flow";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";
import { FlowPage, flowHref, type FlowParams } from "./flow-page";

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

function page(overrides: Partial<Parameters<typeof FlowPage>[0]> = {}) {
  return render(
    <FlowPage
      model={model}
      origin="derived"
      targetsSeeded
      error={null}
      params={params}
      jurisdictions={["us", "dk"]}
      lanes={null}
      detail={null}
      programs={null}
      documents={null}
      bundleTitle={null}
      {...overrides}
    />
  );
}

describe("flowHref", () => {
  it("keeps the window and scope and drops defaults", () => {
    expect(flowHref(params, {})).toBe("/ops/flow");
    expect(flowHref({ ...params, window: 7, j: "us" }, { station: "validate" })).toBe("/ops/flow?window=7&j=us&station=validate");
    expect(flowHref(params, { view: "discovery" })).toBe("/ops/flow?view=discovery");
    expect(flowHref(params, { pop: "runs" })).toBe("/ops/flow?pop=runs");
  });
});

describe("FlowPage", () => {
  it("shows the line as a diagram, with where its reasons come from", () => {
    page();
    expect(screen.getByRole("heading", { name: "The encoding line" })).toBeTruthy();
    expect(screen.getByTestId("pipeline-canvas")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Where do cases end?" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Where do these reasons come from?" })).toBeTruthy();
    expect(screen.getAllByText("Validator check").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Dispatched runs 2/ })).toBeTruthy();
    expect(screen.getByText("Release activation is failing")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Is each station getting better or worse?" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How much can these numbers see?" })).toBeTruthy();
    expect(screen.getByText("How many runs went in?")).toBeTruthy();
    expect(screen.getByText(/Derived from encodings.pipeline_attempts/)).toBeTruthy();
  });

  it("shows the accepted headline with the modules not measured beside it", () => {
    const rows = [
      mergedAttempt({ id: "a", index_status: "indexed", synced_at: "2026-09-21T10:00:00Z", compile_status: "ok", compile_checked_at: "2026-09-22T03:00:00Z", tests_status: "pass" }),
      mergedAttempt({ id: "dk", pr_repo: "rulespec-dk", module_paths: ["dk/x.yaml"], index_status: "missing" }),
    ];
    page({ accepted: acceptedSeries(moduleLedger(rows.flatMap(attemptEvents)), NOW) });
    const headline = screen.getByLabelText("Accepted modules");
    expect(headline.textContent).toContain("How many modules are accepted?1");
    expect(headline.textContent).toContain("Not measured1");
    expect(headline.textContent).toContain("dk 1");
  });

  it("opens a station's detail beside the diagram", () => {
    page({ params: { ...params, station: "validate" } });
    expect(screen.getByRole("complementary", { name: "Validate details" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How cases fail here" })).toBeTruthy();
    expect(screen.getAllByText("r:tests").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/runs ended/).length).toBeGreaterThan(0);
  });

  it("shows discovery as four questions with answers", () => {
    page({ params: { ...params, view: "discovery" } });
    expect(screen.getByRole("heading", { name: "The rules the encoder does not fix, week by week" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "When one rule is fixed, which one comes next" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rules that come back on the next try" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dispatched again and again, never merged" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Common paths" })).toBeNull();
  });

  it("zooms to a citation and to one run", () => {
    page({ params: { ...params, citation: "us/statute/7/2017/a" }, lanes: citationLanes(events, "us/statute/7/2017/a") });
    expect(screen.getByTestId("lanes-canvas")).toBeTruthy();
    const detail = caseDetail(events, "1")!;
    page({ params: { ...params, citation: detail.citation, case: "1" }, detail });
    expect(screen.getByRole("complementary", { name: "Run details" })).toBeTruthy();
  });

  it("shows programs, and a bundle's documents", () => {
    page({ params: { ...params, view: "programs" }, programs: [] });
    expect(screen.getByTestId("programs-canvas")).toBeTruthy();
    page({ params: { ...params, view: "programs", bundle: "us-or/snap" }, documents: [], bundleTitle: "Oregon SNAP" });
    expect(screen.getByTestId("documents-canvas")).toBeTruthy();
    expect(screen.getAllByText("Oregon SNAP").length).toBeGreaterThan(0);
  });
});
