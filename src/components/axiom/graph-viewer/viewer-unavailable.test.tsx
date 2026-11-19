import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import type { ProgramGraph } from "./types";
import { GraphViewerApp } from "./viewer-app";

const root = "us:statutes/26/21";
const output = `${root}#credit`;
const graph: ProgramGraph = {
  rules: [{ legalId: output, name: "credit", fileLegalId: root, kind: "derived", entity: "TaxUnit", dtype: "decimal", period: null, unit: null, formula: "0", ruleDeps: [], inputDeps: [], relationDeps: [], source: null, sourceUrl: null }],
  inputs: [], relations: [], ownOutputs: [output], terminalOutputs: [output],
};

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  fetchAllPrograms: vi.fn(async () => []),
  fetchComposedGraph: vi.fn(),
  fetchRootInputs: vi.fn(async () => []),
  fetchRootCatalog: vi.fn(async () => ({ inputs: [], relationMembership: "convention", relations: [] })),
}));
vi.mock("./InteractiveRuleGraph", async () => {
  const { createContext, useEffect } = await import("react");
  return {
    InputEditContext: createContext(null),
    initialCollapse: () => new Set(),
    InteractiveRuleGraph: ({ onReady }: { onReady?: () => void }) => {
      useEffect(() => { onReady?.(); }, [onReady]);
      return <output data-testid="canvas" />;
    },
  };
});
vi.mock("./inspector-mini-graph", () => ({ InspectorMiniGraph: () => null }));
vi.mock("./corpus-library", () => ({ CorpusLibrary: () => null }));
vi.mock("@/lib/analytics", () => ({ trackAxiomEvent: vi.fn() }));
vi.mock("./styles.css", () => ({}));
vi.mock("./graph-styles.css", () => ({}));
vi.mock("./plane.css", () => ({}));
vi.mock("./workspace.css", () => ({}));

beforeEach(() => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(root)}`);
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(api.fetchComposedGraph).mockReset(); });

// The response of 2026-11-19, which the page printed in full.
const outage = () => new api.ApiRequestError("unavailable", api.UNAVAILABLE_MESSAGE, {
  status: 500, code: "internal_error", requestId: "req-123",
});

it("shows a calm unavailable state for a compose outage, then the graph after Retry", async () => {
  vi.mocked(api.fetchComposedGraph)
    .mockRejectedValueOnce(outage())
    .mockResolvedValueOnce({ graph, files: [root], truncated: false });
  render(<GraphViewerApp />);

  const notice = (await screen.findByText("Temporarily unavailable")).closest(".status")!;
  expect(notice).toHaveAttribute("role", "status");
  expect(notice).toHaveTextContent(api.UNAVAILABLE_MESSAGE);
  expect(notice).toHaveTextContent("Reference for support: HTTP 500 · internal_error · request req-123");
  // Never the raw failure text or a response body.
  expect(document.body.textContent).not.toMatch(/compose request failed|"status":"error"|ApiRequestError/);
  // The original error is in the console for support.
  expect(console.warn).toHaveBeenCalledWith("[axiom] load failed", "HTTP 500 · internal_error · request req-123", expect.any(api.ApiRequestError));

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(api.fetchComposedGraph).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("Temporarily unavailable")).toBeNull());
});

it("paces a second Retry when the outage continues", async () => {
  vi.mocked(api.fetchComposedGraph).mockRejectedValue(outage());
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(api.fetchComposedGraph).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("button", { name: /Retry in \d+ s/ })).toBeDisabled();
});

it("says why Run is absent when only the run check is down, and offers a retry", async () => {
  vi.mocked(api.fetchComposedGraph).mockResolvedValue({ graph, files: [root], truncated: false });
  vi.mocked(api.fetchRootCatalog)
    .mockRejectedValueOnce(new api.ApiRequestError("unavailable", api.MIRROR_UNAVAILABLE_MESSAGE, { status: 503, code: "mirror_unavailable" }))
    .mockResolvedValue({ inputs: [], relationMembership: "convention", relations: [] });
  render(<GraphViewerApp />);

  const reason = await screen.findByText(api.MIRROR_UNAVAILABLE_MESSAGE);
  expect(reason.closest("p")).toHaveTextContent("Run unavailable.");
  const before = vi.mocked(api.fetchRootCatalog).mock.calls.length;
  fireEvent.click(within(reason.closest("p")!).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText(api.MIRROR_UNAVAILABLE_MESSAGE)).toBeNull());
  expect(vi.mocked(api.fetchRootCatalog).mock.calls.length).toBeGreaterThan(before);
});
