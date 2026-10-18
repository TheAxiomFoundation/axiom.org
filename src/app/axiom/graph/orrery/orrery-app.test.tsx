import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphExplorerProps } from "@axiom-foundation/orrery/react";
import type { ProgramGraph } from "@/components/axiom/graph-viewer/types";

const mocks = vi.hoisted(() => ({ programs: vi.fn(), graph: vi.fn(), compose: vi.fn() }));
vi.mock("@/components/axiom/graph-viewer/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/axiom/graph-viewer/api")>(),
  fetchAllPrograms: mocks.programs, fetchProgramGraph: mocks.graph, fetchComposedGraph: mocks.compose,
}));
vi.mock("@axiom-foundation/orrery/react", () => ({
  GraphExplorer: (props: GraphExplorerProps) => <div data-testid="shared-graph">
    <output data-testid="projected">{JSON.stringify(props.document)}</output>
    <output data-testid="location">{JSON.stringify(props.location)}</output>
    <button onClick={() => props.onLocationChange?.({ selectedId: props.document.nodes[0]!.id, selectedType: "node" }, { reason: "select" })}>Select fixture record</button>
    {props.renderNodeDetails?.(props.document.nodes[0]!, props.document)}
  </div>,
}));
import { OrreryApp } from "./orrery-app";

// Synthetic host-wiring data; this fixture performs no domain evaluation.
const fixture: ProgramGraph = {
  rules: [{ legalId: "us:statutes/26/1#amount", name: "Amount", fileLegalId: "us:statutes/26/1", kind: "rule", entity: "person", dtype: "integer", period: "year", unit: null, source: "26 USC 1", formula: "input", ruleDeps: [], inputDeps: ["us:statutes/26/1#input"], relationDeps: [], certificationStatus: "encoded" }],
  inputs: [{ legalId: "us:statutes/26/1#input", name: "Input", fileLegalId: "us:statutes/26/1" }], relations: [],
  ownOutputs: ["us:statutes/26/1#amount"], terminalOutputs: ["us:statutes/26/1#amount"],
};

beforeEach(() => {
  window.history.replaceState(null, "", "/axiom/graph/orrery?program=us/oasdi");
  mocks.programs.mockResolvedValue([{ jurisdiction: "us", programId: "oasdi", runtimeId: "test", mode: "test", status: "ready", defaultOutputs: [] }]);
  mocks.graph.mockResolvedValue(fixture);
  mocks.compose.mockResolvedValue({ graph: fixture, truncated: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Axiom Orrery host", () => {
  it("projects actual API-shaped dependencies and preserves native source/navigation", async () => {
    render(<OrreryApp />);
    await screen.findByTestId("shared-graph");
    expect(mocks.graph).toHaveBeenCalledWith({ jurisdiction: "us", programId: "oasdi" });
    const projected = JSON.parse(screen.getByTestId("projected").textContent!);
    expect(projected.nodes).toHaveLength(2);
    expect(projected.edges[0]).toMatchObject({ source: fixture.inputs[0]!.legalId, target: fixture.rules[0]!.legalId, kind: "input_dependency" });
    expect(projected.nodes[0].data.formula).toBe("input");
    expect(projected.receipts).toBeUndefined();
    expect(projected.assessments).toBeUndefined();
    expect(screen.getByRole("link", { name: "Read the source law ↗" })).toHaveAttribute("href", "/us/statute/26/1");
    expect(screen.getByRole("link", { name: "Open Axiom viewer ↗" })).toHaveAttribute("href", "/axiom/graph?program=us%2Foasdi");
    fireEvent.click(screen.getByText("Select fixture record"));
    expect(new URL(window.location.href).searchParams.get("program")).toBe("us/oasdi");
    expect(new URLSearchParams(window.location.hash.slice(1)).get("selectedId")).toBe(fixture.rules[0]!.legalId);
    expect(mocks.graph).toHaveBeenCalledTimes(1);
  });

  it("loads explicit programs even when the registry is unavailable", async () => {
    mocks.programs.mockRejectedValue(new Error("offline"));
    render(<OrreryApp />);
    await screen.findByTestId("shared-graph");
    expect(await screen.findByText(/program list is unavailable/)).toBeInTheDocument();
  });

  it("surfaces native API failure without substituting demo data", async () => {
    mocks.graph.mockRejectedValue(new Error("offline"));
    render(<OrreryApp />);
    expect(await screen.findByRole("alert")).toHaveTextContent("native Axiom graph could not be loaded");
    expect(screen.queryByTestId("shared-graph")).toBeNull();
  });

  it("carries native compose truncation and uses the existing compose API", async () => {
    window.history.replaceState(null, "", "/axiom/graph/orrery?compose=us%3Astatutes%2F26%2F1");
    render(<OrreryApp />);
    await screen.findByTestId("shared-graph");
    expect(mocks.compose).toHaveBeenCalledWith("us:statutes/26/1");
    expect(mocks.graph).not.toHaveBeenCalled();
    expect(screen.getByText("The native API truncated this graph.")).toBeInTheDocument();
  });

  it("ignores a late graph response after a program change", async () => {
    let finish!: (graph: ProgramGraph) => void;
    mocks.graph.mockImplementationOnce(() => new Promise<ProgramGraph>(resolve => { finish = resolve; }));
    render(<OrreryApp />);
    await waitFor(() => expect(mocks.graph).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("combobox", { name: "Program" }), { target: { value: "" } });
    finish(fixture);
    await screen.findByText(/Choose a program to inspect/);
    expect(screen.queryByTestId("shared-graph")).toBeNull();
  });

  it("restores initial native query focus when Back returns from selection", async () => {
    const focus = fixture.rules[0]!.legalId;
    window.history.replaceState(null, "", `/axiom/graph/orrery?program=us/oasdi&focus=${encodeURIComponent(focus)}`);
    render(<OrreryApp />);
    await screen.findByTestId("shared-graph");
    await waitFor(() => expect(new URLSearchParams(window.location.hash.slice(1)).get("focusId")).toBe(focus));
    const initialUrl = window.location.href;
    fireEvent.click(screen.getByText("Select fixture record"));
    expect(new URLSearchParams(window.location.hash.slice(1)).get("focusId")).toBeNull();
    window.history.back();
    await waitFor(() => expect(window.location.href).toBe(initialUrl));
    await waitFor(() => expect(JSON.parse(screen.getByTestId("location").textContent!).focusId).toBe(focus));
    expect(mocks.graph).toHaveBeenCalledTimes(1);
  });

  it("applies a new native query focus on the same graph without refetching", async () => {
    render(<OrreryApp />);
    await screen.findByTestId("shared-graph");
    const focus = fixture.inputs[0]!.legalId;
    window.history.pushState(null, "", `/axiom/graph/orrery?program=us/oasdi&focus=${encodeURIComponent(focus)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(JSON.parse(screen.getByTestId("location").textContent!).focusId).toBe(focus));
    expect(new URLSearchParams(window.location.hash.slice(1)).get("selectedId")).toBe(focus);
    expect(mocks.graph).toHaveBeenCalledTimes(1);
  });
});
