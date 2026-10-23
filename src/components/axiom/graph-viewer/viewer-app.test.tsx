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

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  fetchAllPrograms: vi.fn(async () => []),
  fetchComposedGraph: vi.fn(async () => ({ graph, files: [fixture.root], truncated: false })),
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
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&selection=${encodeURIComponent(fixture.input)}&view=structure`);
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
