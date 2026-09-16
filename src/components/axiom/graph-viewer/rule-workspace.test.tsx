import { clearReaderCache } from "./reader-cache";
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { neighborhood, RuleWorkspace, type WorkspaceView } from "./rule-workspace";
import type { ProgramGraph, RuleNode } from "./types";

beforeEach(() => clearReaderCache());

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
  it("shows only the selected RuleSpec definition in Read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ filePath: "test.yaml", content: "format: rulespec/v1\nrules:\n  - name: result\n    kind: derived\n  - name: sibling\n    kind: input" }) } as Response));
    render(<Harness data={{ ...graph, rules: [{ ...rule("result"), formula: "2 * 3" }] }} />);
    expect(screen.queryByRole("button", { name: "Logic", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read", exact: true }));
    expect(await screen.findByRole("region", { name: "RuleSpec YAML" })).toHaveTextContent("name: result");
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

describe("rule workspace: source reader and pointer affordances", () => {
  const named = (id: string, deps: string[] = []): RuleNode => ({ ...rule(id, deps), name: id.split("#").at(-1)!, fileLegalId: "us:statutes/26/32" });
  const sourced: ProgramGraph = {
    rules: [{ ...named("us:statutes/26/32#result", ["us:statutes/26/32#shared"]), source: "26 USC 32", formula: "shared + 1" }, named("us:statutes/26/32#shared")],
    inputs: [{ legalId: "us:statutes/26/32#age", name: "input.age", kind: "input", dtype: "int" } as unknown as ProgramGraph["inputs"][number]],
    relations: [{ legalId: "us:statutes/26/32#members", name: "members", kind: "relation" } as unknown as ProgramGraph["relations"][number]],
    ownOutputs: ["us:statutes/26/32#result"], terminalOutputs: ["us:statutes/26/32#result"],
  };
  function SourcedHarness({ view: initial = "read" }: { view?: WorkspaceView }) {
    const [id, setId] = useState("us:statutes/26/32#result");
    const [view, setView] = useState<WorkspaceView>(initial);
    return <RuleWorkspace graph={sourced} selectedId={id} onSelect={setId} view={view} onViewChange={setView} scopeLabel="EITC" truncated={false} runReady={false} scenario={null} valueOf={() => 1} hasRun stale={false} />;
  }
  const source = { citationPath: "us/statute/26/32", heading: "Earned income", officialUrl: "https://law.example/32", effectiveDate: "2026-01-01", focusAnchor: "b", truncated: true, blocks: [
    { anchor: "a", heading: "In general", body: "Text A", citationPath: "us/statute/26/32/a", refs: [] },
    { anchor: "b", heading: "Definitions", body: "Text B", citationPath: "us/statute/26/32/b", refs: [] },
  ] };
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  it("opens source references inside Read and restores the original source on Back", async () => {
    window.history.replaceState({}, "", "/app?compose=us%3Astatutes%2F26%2F32&view=read");
    const originalUrl = window.location.href;
    const path = "us-ny/regulation/18-nycrr/387.10";
    const linkedSource = { ...source, blocks: [{ anchor: "root", heading: null, body: "section 387.10", citationPath: source.citationPath, refs: [{ direction: "outgoing", citation_text: "section 387.10", pattern_kind: "section", confidence: 1, start_offset: 0, end_offset: 13, other_citation_path: path, other_provision_id: "resolved", other_heading: null, target_resolved: true }] }] };
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes("/rulespec?") ? { content: "rules:\n  - name: result\n    kind: derived\n" } : url.endsWith(path) ? { ...source, heading: "Income limits", blocks: [{ anchor: "root", body: "Referenced income limits", refs: [] }] } : linkedSource })));
    render(<SourcedHarness />);
    const link = await screen.findByRole("link", { name: "section 387.10" });
    expect(link.getAttribute("href")).toContain("/app?");
    fireEvent.click(link);
    expect(await screen.findByText("Referenced income limits")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("source")).toBe(path);
    expect(screen.queryByRole("region", { name: "RuleSpec YAML" })).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState({}, "", originalUrl);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("link", { name: "section 387.10" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "RuleSpec YAML" })).toBeInTheDocument();
  });
  it("waits for both responses and reuses them when reopening", async () => {
    let finish!: (value: unknown) => void;
    const fetcher = vi.fn((url: string) => url.includes("/api/axiom/source")
      ? Promise.resolve({ ok: true, json: async () => source })
      : new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const first = render(<SourcedHarness />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("Text A")).not.toBeInTheDocument();
    await act(async () => { finish({ ok: true, json: async () => ({ content: "rules:\n  - name: result\n    kind: derived\n" }) }); });
    expect(screen.getByText("Text A")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "RuleSpec YAML" })).toHaveTextContent("name: result");
    first.unmount();
    render(<SourcedHarness />);
    expect(screen.queryByRole("status", { name: "Loading rule" })).not.toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("renders the fetched provision with its subsections, date, and partial notice", async () => {
    const fetcher = vi.fn((url: string) => Promise.resolve(url.includes("/api/axiom/source") ? { ok: true, json: async () => source } : { ok: false }));
    vi.stubGlobal("fetch", fetcher);
    const { unmount } = render(<SourcedHarness />);
    expect(await screen.findByText("Effective 2026-01-01")).toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url]) => String(url))).toContain("/api/axiom/source/us/statute/26/32");
    expect(screen.getByRole("navigation", { name: "Source subsections" })).toHaveTextContent("Definitions");
    expect(screen.getByRole("link", { name: /Official source/ })).toHaveAttribute("href", "https://law.example/32");
    expect(screen.getByText(/partially loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/Current official source text/)).not.toBeInTheDocument();
    unmount();
  });
  it("labels live official text and retries both the provision and the RuleSpec file", async () => {
    let calls = 0;
    const fetcher = vi.fn((url: string) => {
      calls += 1;
      if (url.includes("/api/axiom/source")) return Promise.resolve(calls > 2 ? { ok: true, json: async () => ({ ...source, origin: "official-live", blocks: [] }) } : { ok: false });
      return Promise.resolve({ ok: false });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<SourcedHarness />);
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: "Try again" })) fireEvent.click(button);
    expect(await screen.findByText(/Current official source text/)).toBeInTheDocument();
    expect(screen.getByText("No provision text is available for this source.")).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/api/axiom/rulespec"))).toHaveLength(2);
  });
  it("closes the rule finder on Escape and on focus leaving it", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<SourcedHarness view="structure" />);
    fireEvent.click(screen.getByRole("button", { name: "Find a rule" }));
    const input = screen.getByRole("textbox", { name: "Search this scope" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search this scope" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find a rule" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search this scope" }), { target: { value: "age" } });
    expect(within(screen.getByRole("region", { name: "Find a rule in this scope" })).getByRole("button", { name: /age/i })).toBeInTheDocument();
    fireEvent.blur(screen.getByRole("textbox", { name: "Search this scope" }), { relatedTarget: document.body });
    expect(screen.queryByRole("textbox", { name: "Search this scope" })).not.toBeInTheDocument();
  });
  it("highlights a dependency from the formula and from the neighbor column, then opens Read", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<SourcedHarness view="structure" />);
    const operand = screen.getByRole("button", { name: "shared", exact: true });
    const neighbor = screen.getByRole("button", { name: /^Rule Shared/ });
    fireEvent.mouseEnter(operand);
    expect(neighbor).toHaveClass("is-highlighted");
    fireEvent.mouseLeave(operand);
    expect(neighbor).not.toHaveClass("is-highlighted");
    fireEvent.focus(operand);
    expect(neighbor).toHaveClass("is-highlighted");
    fireEvent.blur(operand);
    fireEvent.mouseEnter(neighbor);
    expect(operand).toHaveClass("is-highlighted");
    fireEvent.mouseLeave(neighbor);
    fireEvent.focus(neighbor);
    expect(operand).toHaveClass("is-highlighted");
    fireEvent.blur(neighbor);
    expect(operand).not.toHaveClass("is-highlighted");
    fireEvent.click(screen.getByRole("button", { name: /Read this rule/ }));
    expect(screen.getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-current", "page");
  });
});
