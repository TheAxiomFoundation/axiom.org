import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeRelation } from "@/lib/axiom/runtime/relation-roles";
import type { ProgramGraph } from "./types";
import { GraphViewerApp } from "./viewer-app";

const fixture = vi.hoisted(() => {
  const root = "us:statutes/26/22";
  const input = `${root}#input.payment_amount`;
  return { root, input, output: `${root}#credit` };
});
const graph: ProgramGraph = {
  rules: [{ legalId: fixture.output, name: "credit", fileLegalId: fixture.root, kind: "derived", entity: "TaxUnit", dtype: "decimal", period: null, unit: null, source: "26 USC 22", formula: "payment_amount", ruleDeps: [], inputDeps: [fixture.input], relationDeps: [] }],
  inputs: [{ legalId: fixture.input, name: "payment_amount", fileLegalId: fixture.root, entity: "Payment", sample: 0 }],
  relations: [], ownOutputs: [fixture.output], terminalOutputs: [fixture.output],
};
// The same scope with a rule the trace reaches but the root's branch can
// skip: a run traces `phase_in` though the root may never read it.
const phaseIn = `${fixture.root}#phase_in`;
const withTraceOnlyRule: ProgramGraph = {
  ...graph,
  rules: [
    { ...graph.rules[0]!, ruleDeps: [phaseIn] },
    { legalId: phaseIn, name: "phase_in", fileLegalId: fixture.root, kind: "derived", entity: "TaxUnit", dtype: "decimal", period: null, unit: null, source: "26 USC 22", formula: "0", ruleDeps: [], inputDeps: [], relationDeps: [] },
  ],
};
// ...plus a rule this engine cannot trace ("unknown derived output").
const untraceable = `${fixture.root}#untraceable`;
const withUntraceableRule: ProgramGraph = {
  ...withTraceOnlyRule,
  rules: [
    { ...withTraceOnlyRule.rules[0]!, ruleDeps: [phaseIn, untraceable] },
    withTraceOnlyRule.rules[1]!,
    { ...withTraceOnlyRule.rules[1]!, legalId: untraceable, name: "untraceable" },
  ],
};
// The graph the composed-graph mock serves; a test may swap it.
let composedGraph = graph;

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  fetchAllPrograms: vi.fn(async () => []),
  fetchComposedGraph: vi.fn(async () => ({ graph: composedGraph, files: [fixture.root], truncated: false })),
  fetchRootInputs: vi.fn(async () => [{ name: "payment_amount", dtype: "decimal", default: 0, entity: "Payment" }]),
  fetchRootCatalog: vi.fn(async () => ({ inputs: [], relationMembership: "explicit", relations: [describeRelation({ name: "payment_of_tax_unit", kind: "data_relation", data_relation: { arity: 2, arguments: ["TaxUnit", "Payment"] } }, fixture.root)] })),
}));
// Keep the real scenario controls and Relationships view; jsdom has no canvas layout.
vi.mock("./InteractiveRuleGraph", async () => {
  const { createContext, useEffect } = await import("react");
  return {
  InputEditContext: createContext(null),
  initialCollapse: () => new Set(),
  InteractiveRuleGraph: ({ onReady, traces }: { onReady?: () => void; traces: unknown }) => {
    useEffect(() => { onReady?.(); }, [onReady]);
    return <output data-testid="canvas-evidence">{JSON.stringify(traces)}</output>;
  },
  };
});
vi.mock("./inspector-mini-graph", () => ({ InspectorMiniGraph: () => null }));
vi.mock("./corpus-library", () => ({ CorpusLibrary: () => null }));
vi.mock("@/lib/analytics", () => ({ trackAxiomEvent: vi.fn() }));
// These assertions concern submitted values; canvas styles make jsdom's
// accessible-role queries spend most of their time computing styles.
vi.mock("./styles.css", () => ({}));
vi.mock("./graph-styles.css", () => ({}));
vi.mock("./plane.css", () => ({}));
vi.mock("./workspace.css", () => ({}));

beforeEach(() => {
  composedGraph = graph;
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&selection=${encodeURIComponent(fixture.input)}&view=structure`);
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type CalculateRequest = { period?: string; variables: string[] };
/** Serves calculate requests from `answer`, recording each one. */
function stubCalculate(answer: (request: CalculateRequest) => Response | Promise<Response>) {
  const requests: CalculateRequest[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/axiom/runtime/calculate") {
      const request = JSON.parse(String(init?.body)) as CalculateRequest;
      requests.push(request);
      return Promise.resolve(answer(request));
    }
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  return requests;
}
const computed = () => Response.json({ outputs: { credit: 0 }, trace: [], allocated_instances: { Payment: {} } });
const noVersion = (rule: string) => Response.json(
  { error: "runtime_error", message: `derived \`${rule}\` has no formula version at 2026-11-01` },
  { status: 422 },
);

it("shows submitted payment answers in Relationships and retains them until the next run", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request.instances).toEqual({ Payment: { payment_1: { payment_amount: expect.any(Number) } } });
    return Response.json({ outputs: { credit: 0 }, trace: [], allocated_instances: { Payment: { payment_1: "payment:1:1" } } });
  });
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/axiom/runtime/calculate") return fetcher(url, init);
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(screen.getByRole("button", { name: "＋ Add payment" }));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.click(within(screen.getByRole("navigation", { name: "Workspace views" })).getByRole("button", { name: "Relationships" }));
  fireEvent.click(screen.getByRole("button", { name: "Find a rule" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search this scope" }), { target: { value: "payment_amount" } });
  fireEvent.click(screen.getByRole("button", { name: /^Payment amount Input$/i }));
  const result = await screen.findByRole("region", { name: /^Result for Payment amount$/i });
  expect(result).toHaveTextContent("1000");
  expect(within(result).getByText("Payment 1")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Payment amount$/i }), { target: { value: "2000" } });
  await waitFor(() => expect(within(result).getByText("Previous result")).toBeInTheDocument());
  expect(within(result).getByText("1000")).toBeInTheDocument();
  expect(within(result).queryByText("2000")).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas-evidence")).toHaveTextContent("1000");
  expect(screen.getByTestId("canvas-evidence")).not.toHaveTextContent("2000");
  fireEvent.click(screen.getByRole("button", { name: "Run again" }));
  await waitFor(() => expect(within(result).getByText("2000")).toBeInTheDocument());
  expect(screen.getByTestId("canvas-evidence")).toHaveTextContent("2000");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("runs the month named by period= and the month field, and keeps the URL in step", async () => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2027-01&view=structure`);
  const periods: unknown[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/axiom/runtime/calculate") {
      periods.push(JSON.parse(String(init?.body)).period);
      return Promise.resolve(Response.json({ outputs: { credit: 0 }, trace: [], allocated_instances: { Payment: {} } }));
    }
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  const month = screen.getByLabelText("Month") as HTMLInputElement;
  expect(month.value).toBe("2027-01");
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(periods).toEqual(["2027-01"]));
  fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2027-03" } });
  await waitFor(() => expect(new URL(window.location.href).searchParams.get("period")).toBe("2027-03"));
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(periods).toEqual(["2027-01", "2027-03"]));
  fireEvent.change(screen.getByLabelText("Month"), { target: { value: "" } });
  await waitFor(() => expect(new URL(window.location.href).searchParams.has("period")).toBe(false));
});

it("keeps a partly typed month in the field and runs only a whole month", async () => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2027-01&view=structure`);
  const periods: unknown[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/axiom/runtime/calculate") {
      periods.push(JSON.parse(String(init?.body)).period);
      return Promise.resolve(Response.json({ outputs: { credit: 0 }, trace: [], allocated_instances: { Payment: {} } }));
    }
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  const month = screen.getByLabelText("Month") as HTMLInputElement;
  // A browser without a month picker renders the field as plain text and
  // reports every keystroke; switch jsdom's field to text for the keystroke.
  // (jsdom supports type="month" and sanitizes the partial value once the
  // field is a month field again, so its text is checked through state: the
  // hint and aria-invalid.)
  month.setAttribute("type", "text");
  fireEvent.change(month, { target: { value: "2027-0" } });
  expect(month).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("type a whole month as YYYY-MM to run")).toBeInTheDocument();
  expect(new URL(window.location.href).searchParams.get("period")).toBe("2027-01");
  // Run would compute 2027-01, a month the field no longer shows: it waits
  // for a whole month.
  expect(screen.getByRole("button", { name: "Run scenario" })).toBeDisabled();
  fireEvent.change(month, { target: { value: "2027-02" } });
  expect(screen.getByRole("button", { name: "Run scenario" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(periods).toEqual(["2027-02"]));
  fireEvent.change(month, { target: { value: "2027-03" } });
  await waitFor(() => expect(new URL(window.location.href).searchParams.get("period")).toBe("2027-03"));
  expect(month.value).toBe("2027-03");
});

it("shows a month the rule does not cover as a run error and keeps the Month field", async () => {
  composedGraph = withTraceOnlyRule;
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2026-11&view=structure`);
  // The root itself has no version at 2026-11: every request refuses.
  const requests = stubCalculate(({ period }) => (period === "2026-11" ? noVersion("credit") : computed()));
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  expect((await screen.findAllByText(/has no formula version at 2026-11-01\. Set the Month field/)).length).toBeGreaterThan(0);
  // The traced request's refusal goes to the outputs-only request, whose
  // refusal is the run error: no output-name probing past it.
  expect(requests.map(({ period, variables }) => [period, variables])).toEqual([
    ["2026-11", ["credit", "phase_in"]],
    ["2026-11", []],
  ]);
  // A run error, not the blocked state: Run and the Month field stay.
  const month = screen.getByLabelText("Month") as HTMLInputElement;
  expect(screen.getByRole("button", { name: "Run scenario" })).toBeEnabled();
  fireEvent.change(month, { target: { value: "2027-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(requests.map(({ period }) => period)).toEqual(["2026-11", "2026-11", "2027-01"]));
  await waitFor(() => expect(screen.queryByText(/has no formula version/)).not.toBeInTheDocument());
});

it("drops a traced rule with no version at the month when the root itself computes", async () => {
  composedGraph = withTraceOnlyRule;
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2026-11&view=structure`);
  // phase_in has no version at 2026-11, and the root's branch at that
  // month never reads it: only a request that traces it refuses.
  const requests = stubCalculate(({ variables }) => (variables.includes("phase_in") ? noVersion("phase_in") : computed()));
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await screen.findByRole("button", { name: "Dismiss results" });
  // The outputs-only request confirms the root computes; the trace then
  // sheds the rule the refusal named, not a chunk of names.
  expect(requests.map(({ variables }) => variables)).toEqual([["credit", "phase_in"], [], ["credit"]]);
  expect(screen.queryByText(/has no formula version/)).not.toBeInTheDocument();
});

it("lets no partial trace stand for a root with no version at the month", async () => {
  composedGraph = withUntraceableRule;
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2026-11&view=structure`);
  // The first refusal is the untraceable name, so the month problem first
  // shows in a chunk probe; the chunk without the root computes.
  const requests = stubCalculate(({ variables }) => {
    if (variables.includes("untraceable")) {
      return Response.json({ error: "runtime_error", message: "unknown derived output: untraceable" }, { status: 422 });
    }
    return variables.length === 0 || variables.includes("credit") ? noVersion("credit") : computed();
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  expect((await screen.findAllByText(/has no formula version at 2026-11-01\. Set the Month field/)).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Dismiss results" })).not.toBeInTheDocument();
  expect(requests.at(-1)?.variables).toEqual([]);
});

it("keeps the previous month's results marked stale when a run at another month fails", async () => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2027-01&view=structure`);
  stubCalculate(({ period }) => (period === "2026-11" ? noVersion("credit") : computed()));
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await screen.findByRole("button", { name: "Dismiss results" });
  const stale = "Inputs have changed. Run again to update this result.";
  expect(screen.queryByText(stale)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-11" } });
  expect(await screen.findByText(stale)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  expect((await screen.findAllByText(/has no formula version at 2026-11-01\. Set the Month field/)).length).toBeGreaterThan(0);
  // The 2027-01 outputs stay on screen, still marked as another question's.
  expect(screen.getByRole("button", { name: "Dismiss results" })).toBeInTheDocument();
  expect(screen.getByText(stale)).toBeInTheDocument();
});

it("runs nothing while the Month field holds part of a month, from Relationships too", async () => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2027-01&view=structure`);
  const requests = stubCalculate(() => computed());
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  const month = screen.getByLabelText("Month") as HTMLInputElement;
  // Chromium's month picker reports a partly filled field as value "" with
  // validity.badInput: an unfinished entry, not a clear.
  Object.defineProperty(month, "validity", { configurable: true, value: { badInput: true } });
  fireEvent.change(month, { target: { value: "" } });
  expect(month).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("type a whole month as YYYY-MM to run")).toBeInTheDocument();
  expect(new URL(window.location.href).searchParams.get("period")).toBe("2027-01");
  expect(screen.getByRole("button", { name: "Run scenario" })).toBeDisabled();
  // Relationships' Run household reaches the same guard.
  const views = screen.getByRole("navigation", { name: "Workspace views" });
  fireEvent.click(within(views).getByRole("button", { name: "Relationships" }));
  fireEvent.click(await screen.findByRole("button", { name: "Run household" }));
  const relationships = screen.getByRole("region", { name: "Immediate dependencies" });
  expect(await within(relationships).findByRole("alert")).toHaveTextContent("Type a whole month as YYYY-MM in the Month field to run.");
  expect(requests).toEqual([]);
  // Back in Run, emptying the last segment (value "" without badInput, so
  // no change event) is a clear: the default month runs again.
  fireEvent.click(within(views).getByRole("button", { name: "Run" }));
  const field = screen.getByLabelText("Month") as HTMLInputElement;
  Object.defineProperty(field, "validity", { configurable: true, value: { badInput: false } });
  fireEvent.input(field, { target: { value: "" } });
  await waitFor(() => expect(new URL(window.location.href).searchParams.has("period")).toBe(false));
  expect(screen.getByText("blank runs the runtime's default month")).toBeInTheDocument();
  expect(screen.queryByText("Type a whole month as YYYY-MM in the Month field to run.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run scenario" })).toBeEnabled();
});

it("shows a run error in Relationships after the graph has been visited", async () => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2026-11&view=structure`);
  stubCalculate(() => noVersion("credit"));
  render(<GraphViewerApp />);
  const views = await screen.findByRole("navigation", { name: "Workspace views" });
  fireEvent.click(within(views).getByRole("button", { name: "Graph" }));
  fireEvent.click(within(views).getByRole("button", { name: "Relationships" }));
  fireEvent.click(await screen.findByRole("button", { name: "Run household" }));
  // The graph stage is hidden and inert here; the error must show where
  // the user ran.
  const relationships = screen.getByRole("region", { name: "Immediate dependencies" });
  expect(await within(relationships).findByRole("alert")).toHaveTextContent(/has no formula version at 2026-11-01\. Set the Month field/);
});

it("locks the Month field while a run is in flight", async () => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2027-01&view=structure`);
  // A late answer for the month a run asked about must not land on a month
  // chosen after it left (a late refusal would hide Run for the new one).
  let answer: (response: Response) => void = () => {};
  stubCalculate(() => new Promise<Response>((resolve) => { answer = resolve; }));
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(screen.getByLabelText("Month")).toBeDisabled());
  answer(computed());
  await waitFor(() => expect(screen.getByLabelText("Month")).toBeEnabled());
});

it("ignores a period= value that is not a month", async () => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&period=2027&view=structure`);
  vi.stubGlobal("fetch", (url: string) => {
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  expect((screen.getByLabelText("Month") as HTMLInputElement).value).toBe("");
  await waitFor(() => expect(new URL(window.location.href).searchParams.has("period")).toBe(false));
});
