import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { neighborhood, RuleWorkspace, type WorkspaceView } from "./rule-workspace";
import type { ProgramGraph, RuleNode } from "./types";

const rule = (id: string, deps: string[] = []): RuleNode => ({ legalId: id, name: id, fileLegalId: "test", kind: null, entity: null, dtype: null, period: null, unit: null, source: null, ruleDeps: deps, inputDeps: [], relationDeps: [] });
const graph: ProgramGraph = { rules: [rule("result", ["shared", "missing"]), rule("shared"), rule("other", ["shared"])], inputs: [], relations: [], ownOutputs: ["result"], terminalOutputs: ["result"] };

function Harness({ data = graph }: { data?: ProgramGraph }) {
  const [id, setId] = useState("result");
  const [view, setView] = useState<WorkspaceView>("structure");
  return <RuleWorkspace graph={data} selectedId={id} onSelect={setId} view={view} onViewChange={setView} scopeLabel="Test scope" truncated runReady={false} scenario={null} valueOf={(id) => id === "result" ? false : undefined} hasRun stale={false} />;
}

describe("rule workspace", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  it("keeps shared dependencies and relation edges without duplicating a dependency", () => {
    const data = { ...graph, rules: [{ ...graph.rules[0]!, inputDeps: ["shared"], relationDeps: ["people"] }, ...graph.rules.slice(1)] };
    expect(neighborhood(data, "result").dependencies).toEqual(["shared", "missing", "people"]);
    expect(neighborhood(data, "shared").consumers.map((item) => item.legalId)).toEqual(["result", "other"]);
    expect(neighborhood(data, "people").consumers.map((item) => item.legalId)).toEqual(["result"]);
  });
  it("walks a relationship and returns to the previous selection", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Rule Shared Not evaluated/i }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Shared");
    expect(new URLSearchParams(window.location.search).get("selection")).toBe("shared");
    fireEvent.click(screen.getByRole("button", { name: "Back to previous rule" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Result");
    expect(screen.getByRole("button", { name: "Back to previous rule" })).toBeDisabled();
  });
  it("distinguishes false from not evaluated and exposes missing scope", () => {
    render(<Harness />);
    expect(screen.getByText("False")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Outside loaded scope Missing/ })).toBeDisabled();
    expect(screen.getByText(/This graph is partial/)).toBeInTheDocument();
  });
  it("bounds a large neighborhood with an explicit expansion", () => {
    const deps = Array.from({ length: 20 }, (_, i) => `dep_${i}`);
    render(<Harness data={{ ...graph, rules: [rule("result", deps), ...deps.map((id) => rule(id))] }} />);
    expect(screen.queryByRole("button", { name: /Rule Dep 10 /i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 12 more · 14 hidden" }));
    expect(screen.getByRole("button", { name: /Rule Dep 10 /i })).toBeInTheDocument();
  });
  it("shows the RuleSpec file in Read instead of the formula snippet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ filePath: "test.yaml", content: "format: rulespec/v1\nrules: []" }) } as Response));
    render(<Harness data={{ ...graph, rules: [{ ...rule("result"), formula: "2 * 3" }] }} />);
    expect(screen.queryByRole("button", { name: "Logic", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read", exact: true }));
    expect(await screen.findByRole("region", { name: "RuleSpec YAML" })).toHaveTextContent("format: rulespec/v1");
    expect(screen.queryByRole("region", { name: "Encoded formula" })).not.toBeInTheDocument();
  });
  it("connects formula operands to their dependencies and follows them", () => {
    render(<Harness data={{ ...graph, rules: [{ ...rule("result", ["shared"]), formula: "shared + 1" }, rule("shared")] }} />);
    const operand = screen.getByRole("button", { name: "shared", exact: true });
    fireEvent.focus(operand);
    expect(screen.getByRole("button", { name: "Rule Shared Not evaluated" })).toHaveClass("is-highlighted");
    fireEvent.click(operand);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shared");
  });
  it("returns from Read to the graph with the same selected node", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    fireEvent.click(screen.getByRole("button", { name: "Read", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Back to previous rule" }));
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Result");
  });
  it("offers scope search and hides unavailable execution", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Find a rule" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search this scope" }), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Other Rule" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Other");
    expect(screen.queryByRole("button", { name: "Run", exact: true })).not.toBeInTheDocument();
  });
});
