import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RootInputSlot } from "./api";
import type { ProgramGraph } from "./types";
import { GraphViewerApp } from "./viewer-app";

// Wellington City District Plan supermarket zoning, as the API composed
// it before axiom-api#309 (GET /v1/graph/compose, 2026-11-03): the
// formula scan read "Non-complying" and "Out of scope" as code, so the
// census carries `complying` and `scope`, which no formula reads.
const fixture = vi.hoisted(() => {
  const root = "nz:regulations/rma_district_plans/wellington_city/supermarket_zoning";
  const id = (name: string) => `${root}#${name}`;
  return {
    root,
    id,
    cap: id("wcc_muz_supermarket_permitted_gfa_cap_m2"),
    status: id("wcc_supermarket_activity_status"),
    permitted: id("wcc_supermarket_permitted"),
  };
});
const STATUS_FORMULA = [
  'if wcc_supermarket_zone == "CCZ":',
  '    "Permitted"',
  'elif wcc_supermarket_zone == "MCZ":',
  '    "Permitted"',
  'elif wcc_supermarket_zone == "LCZ":',
  '    "Permitted"',
  'elif wcc_supermarket_zone == "NCZ":',
  '    "Permitted"',
  'elif wcc_supermarket_zone == "MUZ":',
  "    if wcc_proposed_supermarket_gfa_m2 <= wcc_muz_supermarket_permitted_gfa_cap_m2:",
  '        "Permitted"',
  "    else:",
  '        "Restricted Discretionary"',
  'elif wcc_supermarket_zone == "GIZ":',
  '    "Non-complying"',
  "else:",
  '    "Out of scope"',
].join("\n");
const rule = (legalId: string, patch: Partial<ProgramGraph["rules"][number]>) => ({
  legalId,
  name: legalId.split("#")[1]!,
  fileLegalId: fixture.root,
  kind: "derived",
  entity: "Person",
  dtype: null,
  period: "Year",
  unit: null,
  source: "Wellington City District Plan 2024",
  ruleDeps: [],
  inputDeps: [],
  relationDeps: [],
  ...patch,
});
const census = ["wcc_supermarket_zone", "wcc_proposed_supermarket_gfa_m2", "complying", "scope"];
const graph: ProgramGraph = {
  rules: [
    rule(fixture.cap, { kind: "parameter", entity: null, dtype: "Count", period: null, unit: "square_metre", formula: "1500" }),
    rule(fixture.status, { dtype: "Text", formula: STATUS_FORMULA, ruleDeps: [fixture.cap], inputDeps: census.map(fixture.id) }),
    rule(fixture.permitted, { dtype: "Judgment", formula: 'wcc_supermarket_activity_status == "Permitted"', ruleDeps: [fixture.status] }),
  ],
  inputs: census.map((name) => ({ legalId: fixture.id(name), name, fileLegalId: fixture.root, entity: "Person", sample: null })),
  relations: [],
  ownOutputs: [fixture.cap, fixture.status, fixture.permitted],
  terminalOutputs: [fixture.cap, fixture.status, fixture.permitted],
};
// GET /v1/runtime/root-inputs for the same root, 2026-11-03.
const catalog: RootInputSlot[] = [
  { name: "wcc_proposed_supermarket_gfa_m2", dtype: "decimal", default: 0, entity: "Person" },
  { name: "wcc_supermarket_zone", dtype: "text", default: "none", entity: "Person", values: ["CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "none"] },
];

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  fetchAllPrograms: vi.fn(async () => []),
  fetchComposedGraph: vi.fn(async () => ({ graph, files: [fixture.root], truncated: false })),
  fetchRootInputs: vi.fn(async () => catalog),
  fetchRootCatalog: vi.fn(async () => ({ inputs: catalog, relationMembership: "convention", relations: [] })),
}));
// jsdom has no canvas layout; the stand-in shows what the canvas was handed.
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
vi.mock("./styles.css", () => ({}));
vi.mock("./graph-styles.css", () => ({}));
vi.mock("./plane.css", () => ({}));
vi.mock("./workspace.css", () => ({}));

beforeEach(() => {
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(fixture.root)}&view=structure`);
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The activity status the canvas was handed after the last run. */
const tracedStatus = () =>
  (JSON.parse(screen.getByTestId("canvas-evidence").textContent || "{}") as Record<string, { value?: unknown }>)[
    fixture.status
  ]?.value;

it("runs Wellington supermarket zoning with a zone code, and asks no phantom questions", async () => {
  const outcomes = [
    { wcc_supermarket_activity_status: "Restricted Discretionary", wcc_supermarket_permitted: false },
    { wcc_supermarket_activity_status: "Permitted", wcc_supermarket_permitted: true },
  ];
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/axiom/runtime/calculate") {
      requests.push(JSON.parse(String(init?.body)));
      return Promise.resolve(Response.json({ outputs: outcomes[requests.length - 1], trace: [] }));
    }
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));

  const zone = (await screen.findByRole("combobox", { name: /supermarket zone/i })) as HTMLSelectElement;
  expect([...zone.options].map((option) => option.textContent)).toEqual(["none", "CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ"]);
  const area = screen.getByRole("spinbutton", { name: /supermarket gfa/i });
  // The run panel asks exactly the two questions the catalog lists.
  const questions = [...document.querySelectorAll(".household-fields label > span")].map((span) => span.textContent);
  expect(questions).toHaveLength(2);
  expect(questions.join(" | ")).not.toMatch(/complying|scope/i);

  fireEvent.change(zone, { target: { value: "MUZ" } });
  fireEvent.change(area, { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    root: fixture.root,
    facts: { wcc_supermarket_zone: "MUZ", wcc_proposed_supermarket_gfa_m2: 2000 },
  });
  await waitFor(() => expect(tracedStatus()).toBe("Restricted Discretionary"));

  // Within the 1,500 m² cap the same zone is permitted.
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  const again = (await screen.findByRole("combobox", { name: /supermarket zone/i })) as HTMLSelectElement;
  expect(again.value).toBe("MUZ");
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({
    facts: { wcc_supermarket_zone: "MUZ", wcc_proposed_supermarket_gfa_m2: 1000 },
  });
  await waitFor(() => expect(tracedStatus()).toBe("Permitted"));
});
