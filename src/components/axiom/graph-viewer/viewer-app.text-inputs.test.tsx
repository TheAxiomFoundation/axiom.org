import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchComposedGraph, fetchRootCatalog, type RootCatalog, type RootInputSlot } from "./api";
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
    // A second scope that reads the same zone, for a scope switch.
    retail: "nz:regulations/rma_district_plans/wellington_city/retail_zoning",
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

const wellingtonCatalog: RootCatalog = { inputs: catalog, relationMembership: "convention", relations: [] };

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  fetchAllPrograms: vi.fn(async () => []),
  fetchComposedGraph: vi.fn(),
  fetchRootCatalog: vi.fn(),
}));
// jsdom has no canvas layout; the stand-in shows what the canvas was handed,
// and gives each input card in it the canvas's own answer box
// (`InlineAnswer`, which a package graph's `#input.<name>` card renders).
type TracedNode = { legalId: string; dtype?: string; value?: unknown; inputSource?: string; children?: TracedNode[] };
vi.mock("./InteractiveRuleGraph", async (original) => {
  const actual = await original<typeof import("./InteractiveRuleGraph")>();
  const { useEffect } = await import("react");
  return {
    ...actual,
    initialCollapse: () => new Set(),
    InteractiveRuleGraph: ({ onReady, traces }: { onReady?: () => void; traces: Record<string, TracedNode> }) => {
      useEffect(() => { onReady?.(); }, [onReady]);
      const cards = new Set<string>();
      const visit = (node: TracedNode) => {
        if (node.dtype === "input") cards.add(node.legalId.replace("#", "#input."));
        node.children?.forEach(visit);
      };
      Object.values(traces).forEach(visit);
      return (
        <>
          <output data-testid="canvas-evidence">{JSON.stringify(traces)}</output>
          <div data-testid="canvas-cards">
            {[...cards].map((card) => <actual.InlineAnswer key={card} legalId={card} />)}
          </div>
        </>
      );
    },
  };
});
vi.mock("./inspector-mini-graph", () => ({ InspectorMiniGraph: () => null }));
// The launcher's stand-in opens the second scope.
vi.mock("./corpus-library", () => ({
  CorpusLibrary: ({ active, onPick }: { active: boolean; onPick: (target: string) => void }) =>
    active ? <button type="button" onClick={() => onPick(fixture.retail)}>Open retail zoning</button> : null,
}));
vi.mock("@/lib/analytics", () => ({ trackAxiomEvent: vi.fn() }));
vi.mock("./styles.css", () => ({}));
vi.mock("./graph-styles.css", () => ({}));
vi.mock("./plane.css", () => ({}));
vi.mock("./workspace.css", () => ({}));

beforeEach(() => {
  vi.mocked(fetchComposedGraph).mockReset().mockImplementation(async () => ({ graph, files: [fixture.root], truncated: false }));
  vi.mocked(fetchRootCatalog).mockReset().mockImplementation(async () => wellingtonCatalog);
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

/** The canvas's node for one of the scope's inputs, under the activity status. */
const tracedInput = (name: string) => {
  const status = (JSON.parse(screen.getByTestId("canvas-evidence").textContent || "{}") as Record<string, TracedNode>)[fixture.status];
  return status?.children?.find((child) => child.legalId === fixture.id(name));
};

/** Answers every run with `outputs` and records each request body. */
function stubRuns(outputs: Array<Record<string, unknown>>) {
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/axiom/runtime/calculate") {
      requests.push(JSON.parse(String(init?.body)));
      return Promise.resolve(Response.json({ outputs: outputs[requests.length - 1] ?? {}, trace: [] }));
    }
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  return requests;
}

/** Opens the activity status in the Relationships view, where each
 *  input it reads has a field beside it. */
async function openActivityStatus() {
  fireEvent.click(await screen.findByRole("button", { name: "Find a rule" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search this scope" }), { target: { value: "activity status" } });
  const results = screen.getByRole("region", { name: "Find a rule in this scope" });
  fireEvent.click(within(results).getByRole("button", { name: /supermarket activity status/i }));
}

const relationshipQuestions = () =>
  [...document.querySelectorAll(".relationship-inputs label > span:first-child")].map((span) => span.textContent ?? "");

it("runs Wellington supermarket zoning with a zone code, and asks no phantom questions", async () => {
  const requests = stubRuns([
    { wcc_supermarket_activity_status: "Restricted Discretionary", wcc_supermarket_permitted: false },
    { wcc_supermarket_activity_status: "Permitted", wcc_supermarket_permitted: true },
  ]);
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));

  const zone = (await screen.findByRole("combobox", { name: /supermarket zone/i })) as HTMLSelectElement;
  expect([...zone.options].map((option) => option.textContent)).toEqual(["none", "CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "Other…"]);
  const area = screen.getByRole("spinbutton", { name: /supermarket gfa/i });
  // The run panel asks exactly the two questions the catalog lists.
  const questions = [...document.querySelectorAll(".household-fields label > span:first-child")].map((span) => span.textContent);
  expect(questions).toHaveLength(2);
  expect(questions.join(" | ")).not.toMatch(/complying|scope/i);

  fireEvent.change(zone, { target: { value: "MUZ" } });
  fireEvent.change(area, { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ root: fixture.root });
  expect(requests[0]!.facts).toEqual({ wcc_supermarket_zone: "MUZ", wcc_proposed_supermarket_gfa_m2: 2000 });
  await waitFor(() => expect(tracedStatus()).toBe("Restricted Discretionary"));

  // Within the 1,500 m² cap the same zone is permitted.
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  const again = (await screen.findByRole("combobox", { name: /supermarket zone/i })) as HTMLSelectElement;
  expect(again.value).toBe("MUZ");
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.facts).toEqual({ wcc_supermarket_zone: "MUZ", wcc_proposed_supermarket_gfa_m2: 1000 });
  await waitFor(() => expect(tracedStatus()).toBe("Permitted"));
});

it("answers the zone in the Relationships view with the same choices", async () => {
  const requests = stubRuns([{ wcc_supermarket_activity_status: "Restricted Discretionary", wcc_supermarket_permitted: false }]);
  render(<GraphViewerApp />);
  await openActivityStatus();
  const zone = (await screen.findByRole("combobox", { name: /supermarket zone/i })) as HTMLSelectElement;
  expect([...zone.options].map((option) => option.textContent)).toEqual(["none", "CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "Other…"]);
  // The census's phantom inputs keep their graph nodes until axiom-api#309
  // deploys, but nothing asks them.
  expect(relationshipQuestions().map((text) => text.toLowerCase())).toEqual([
    "wcc supermarket zone",
    "wcc proposed supermarket gfa m2",
  ]);
  fireEvent.change(zone, { target: { value: "MUZ" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run household" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]!.facts).toEqual({ wcc_supermarket_zone: "MUZ", wcc_proposed_supermarket_gfa_m2: 2000 });
});

it("drops a number typed into the zone's census field once the catalog types the zone as text", async () => {
  const requests = stubRuns([{}]);
  let deliver!: (value: RootCatalog) => void;
  vi.mocked(fetchRootCatalog).mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
  render(<GraphViewerApp />);
  await openActivityStatus();
  // Until the catalog arrives, the census offers a number field for each input.
  const census = await screen.findByRole("spinbutton", { name: /supermarket zone/i });
  fireEvent.change(census, { target: { value: "5" } });
  await act(async () => deliver(wellingtonCatalog));
  await screen.findByRole("combobox", { name: /supermarket zone/i });
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run household" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]!.facts).toEqual({ wcc_proposed_supermarket_gfa_m2: 2000 });
  // The household no longer states the number, not only the run.
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(await screen.findByText(/^1 household inputs answered/)).toBeTruthy();
});

it("never sends the census field's number from the commit that first shows the zone as a select", async () => {
  const requests = stubRuns([{}]);
  let deliver!: (value: RootCatalog) => void;
  vi.mocked(fetchRootCatalog).mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
  render(<GraphViewerApp />);
  await openActivityStatus();
  fireEvent.change(await screen.findByRole("spinbutton", { name: /supermarket zone/i }), { target: { value: "5" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "2000" } });
  // Press Run as the select appears: the prune has not run yet.
  let pressed = false;
  const observer = new MutationObserver(() => {
    const run = screen.queryByRole("button", { name: "Run household" }) as HTMLButtonElement | null;
    if (pressed || !run || run.disabled || !screen.queryByRole("combobox", { name: /supermarket zone/i })) return;
    pressed = true;
    run.click();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  // Deliver while waitFor holds act off: React then commits each render in
  // its own task, as in a browser, and the observer sees the commit that
  // first shows the select. Inside act, React would flush every commit,
  // the prune's included, before the observer ran.
  const sent = waitFor(() => expect(requests).toHaveLength(1));
  deliver(wellingtonCatalog);
  await sent;
  observer.disconnect();
  expect(requests[0]!.facts).toEqual({ wcc_proposed_supermarket_gfa_m2: 2000 });
});

it("never sends an added person's number for the zone once a re-read catalog types the zone as text", async () => {
  // A runtime that still typed the zone as a number refuses the first run
  // for its relations, so the app reads the catalog again and keeps what
  // the user stated; by then the zone is text.
  const numericZone: RootCatalog = {
    ...wellingtonCatalog,
    inputs: catalog.map((slot) =>
      slot.name === "wcc_supermarket_zone" ? { name: slot.name, dtype: "decimal", default: 0, entity: "Person" } : slot,
    ),
  };
  vi.mocked(fetchRootCatalog).mockReset().mockResolvedValueOnce(numericZone).mockResolvedValue(wellingtonCatalog);
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/axiom/runtime/calculate") {
      requests.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        requests.length === 1
          ? Response.json({ error: "unknown_relation", message: "This scope's relations changed." }, { status: 422 })
          : Response.json({ outputs: {}, trace: [] }),
      );
    }
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(await screen.findByRole("button", { name: /add person/i }));
  fireEvent.click(screen.getByRole("button", { name: "Person 2" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket zone/i }), { target: { value: "5" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "2000" } });
  // Press Run in the very commit that first shows the zone as a select, as
  // a person would on seeing it: the state still holds the number then,
  // because the prune runs in an effect after that commit.
  let pressed = false;
  const observer = new MutationObserver(() => {
    const run = screen.queryByRole("button", { name: "Run scenario" }) as HTMLButtonElement | null;
    if (pressed || !run || run.disabled || !screen.queryByRole("combobox", { name: /supermarket zone/i })) return;
    pressed = true;
    run.click();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  observer.disconnect();
  expect(requests[0]!.people).toEqual({ person_2: { wcc_supermarket_zone: 5, wcc_proposed_supermarket_gfa_m2: 2000 } });
  expect(requests[1]!.people).toEqual({ person_2: { wcc_proposed_supermarket_gfa_m2: 2000 } });
  // Person 2 no longer states the number either.
  expect(await screen.findByText(/^1 household inputs answered/)).toBeTruthy();
});

it("keeps the zone in the results strip when Other… opens its field", async () => {
  const requests = stubRuns([
    { wcc_supermarket_activity_status: "Restricted Discretionary", wcc_supermarket_permitted: false },
    { wcc_supermarket_activity_status: "Out of scope", wcc_supermarket_permitted: false },
  ]);
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.change(await screen.findByRole("combobox", { name: /supermarket zone/i }), { target: { value: "MUZ" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(tracedStatus()).toBe("Restricted Discretionary"));

  fireEvent.click(screen.getByRole("button", { name: "Graph" }));
  const strip = (await screen.findByLabelText("Adjust and run again")) as HTMLElement;
  const zone = within(strip).getAllByRole("combobox").find((select) =>
    [...(select as HTMLSelectElement).options].some((option) => option.textContent === "Other…"),
  ) as HTMLSelectElement;
  const other = [...zone.options].find((option) => option.textContent === "Other…")!;
  fireEvent.change(zone, { target: { value: other.value } });
  // The row stays, its field holding the answer to edit.
  const field = within(strip).getByRole("textbox", { name: "Other value" }) as HTMLInputElement;
  expect(field.value).toBe("MUZ");
  fireEvent.change(field, { target: { value: "OSZ" } });

  fireEvent.click(within(strip).getByRole("button", { name: "Run again" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.facts).toEqual({ wcc_supermarket_zone: "OSZ", wcc_proposed_supermarket_gfa_m2: 2000 });
});

it("names each answer a run did not use, and does not claim it", async () => {
  // The proxy holds back a text answer its fresh catalog no longer types
  // as text (a runtime deploy between the page's catalog read and the run).
  vi.stubGlobal("fetch", (url: string) => {
    if (url === "/api/axiom/runtime/calculate") {
      return Promise.resolve(Response.json({
        outputs: { wcc_supermarket_activity_status: "Out of scope", wcc_supermarket_permitted: false },
        trace: [],
        applied: ["wcc_proposed_supermarket_gfa_m2"],
        dropped: ["wcc_supermarket_zone"],
      }));
    }
    if (url.startsWith("/api/axiom/rulespec?")) return Promise.resolve(Response.json({ content: "" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.change(await screen.findByRole("combobox", { name: /supermarket zone/i }), { target: { value: "MUZ" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  // The results sheet carries the note under its heading, on the Run view
  // and the Graph view.
  const note = "This run did not use your answer for Wcc Supermarket Zone; the result uses its default.";
  const underHeading = (element: HTMLElement) => element.previousElementSibling?.matches(".results-sheet > .results-head") ?? false;
  expect(underHeading(await screen.findByText(note))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Graph" }));
  expect(underHeading(screen.getByText(note))).toBe(true);
  // The canvas shows the floor area the run used, and the zone's default.
  expect(tracedInput("wcc_proposed_supermarket_gfa_m2")).toMatchObject({ value: 2000, inputSource: "user" });
  expect(tracedInput("wcc_supermarket_zone")).toMatchObject({ value: null, inputSource: "default" });
});

it("answers the zone on a canvas card", async () => {
  const requests = stubRuns([
    { wcc_supermarket_activity_status: "Restricted Discretionary", wcc_supermarket_permitted: false },
    { wcc_supermarket_activity_status: "Permitted", wcc_supermarket_permitted: true },
    { wcc_supermarket_activity_status: "Out of scope", wcc_supermarket_permitted: false },
  ]);
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.change(await screen.findByRole("combobox", { name: /supermarket zone/i }), { target: { value: "MUZ" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /supermarket gfa/i }), { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(tracedStatus()).toBe("Restricted Discretionary"));

  // On the Graph view, the zone's card takes text and the floor area's a
  // number, each holding the answer the run used.
  fireEvent.click(screen.getByRole("button", { name: "Graph" }));
  const cards = screen.getByTestId("canvas-cards");
  // The census's phantom inputs keep their cards, with no answer box.
  expect(cards.querySelectorAll(".irg-answer")).toHaveLength(2);
  const zoneCard = within(cards).getByRole("textbox", { name: "Answer" }) as HTMLInputElement;
  expect(zoneCard.value).toBe("MUZ");
  expect((within(cards).getByRole("spinbutton", { name: "Answer" }) as HTMLInputElement).value).toBe("2000");
  fireEvent.change(zoneCard, { target: { value: "CCZ" } });
  const runAgain = () => within(screen.getByLabelText("Adjust and run again")).getByRole("button", { name: "Run again" });
  fireEvent.click(runAgain());
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.facts).toEqual({ wcc_supermarket_zone: "CCZ", wcc_proposed_supermarket_gfa_m2: 2000 });

  // Clearing the card withdraws the answer and leaves an empty text box.
  await waitFor(() => expect(runAgain().hasAttribute("disabled")).toBe(false));
  fireEvent.change(within(screen.getByTestId("canvas-cards")).getByRole("textbox", { name: "Answer" }), { target: { value: "" } });
  expect((within(screen.getByTestId("canvas-cards")).getByRole("textbox", { name: "Answer" }) as HTMLInputElement).value).toBe("");
  fireEvent.click(runAgain());
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]!.facts).toEqual({ wcc_proposed_supermarket_gfa_m2: 2000 });
});

it("types the next scope's fields from its own census while its catalog loads", async () => {
  // The supermarket scope's catalog types the zone as text. The retail
  // scope reads the same zone and asks its own site area; its catalog has
  // not arrived, so its census, not the last scope's catalog, types both.
  const retailStatus = `${fixture.retail}#wcc_retail_activity_status`;
  const retailInputs = ["wcc_supermarket_zone", "wcc_retail_site_area_m2"];
  const retailGraph: ProgramGraph = {
    rules: [rule(retailStatus, { fileLegalId: fixture.retail, dtype: "Text", formula: 'if wcc_supermarket_zone == "MUZ":\n    "Permitted"\nelse:\n    "Out of scope"', inputDeps: retailInputs.map((name) => `${fixture.retail}#${name}`) })],
    inputs: retailInputs.map((name) => ({ legalId: `${fixture.retail}#${name}`, name, fileLegalId: fixture.retail, entity: "Person", sample: null })),
    relations: [],
    ownOutputs: [retailStatus],
    terminalOutputs: [retailStatus],
  };
  vi.mocked(fetchComposedGraph).mockImplementation(async (focus) =>
    focus === fixture.retail ? { graph: retailGraph, files: [fixture.retail], truncated: false } : { graph, files: [fixture.root], truncated: false },
  );
  stubRuns([]);
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  await screen.findByRole("combobox", { name: /supermarket zone/i });

  vi.mocked(fetchRootCatalog).mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByTestId("back-to-overview"));
  fireEvent.click(await screen.findByRole("button", { name: "Open retail zoning" }));
  fireEvent.click(await screen.findByRole("button", { name: "Find a rule" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search this scope" }), { target: { value: "retail activity status" } });
  const results = screen.getByRole("region", { name: "Find a rule in this scope" });
  fireEvent.click(within(results).getByRole("button", { name: /retail activity status/i }));
  fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
  expect(await screen.findByRole("spinbutton", { name: /supermarket zone/i })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: /supermarket zone/i })).toBeNull();
  expect(relationshipQuestions().map((text) => text.toLowerCase())).toEqual(["wcc supermarket zone", "wcc retail site area m2"]);
});

it("reads an input named like an object built-in as any other input", async () => {
  // `constructor` is a valid RuleSpec name and a key every object
  // inherits, so a lookup by input name must read own entries only.
  const root = "nz:regulations/rma_district_plans/wellington_city/building_consent";
  const required = `${root}#wcc_consent_required`;
  const builder = `${root}#constructor`;
  const consentGraph: ProgramGraph = {
    rules: [rule(required, { fileLegalId: root, dtype: "Judgment", formula: "constructor > 0", inputDeps: [builder] })],
    inputs: [{ legalId: builder, name: "constructor", fileLegalId: root, entity: "Person", sample: null }],
    relations: [],
    ownOutputs: [required],
    terminalOutputs: [required],
  };
  vi.mocked(fetchComposedGraph).mockImplementation(async () => ({ graph: consentGraph, files: [root], truncated: false }));
  vi.mocked(fetchRootCatalog).mockImplementation(async () => ({
    inputs: [{ name: "constructor", dtype: "decimal", default: 0, entity: "Person" }],
    relationMembership: "convention",
    relations: [],
  }));
  window.history.replaceState({}, "", `/app?compose=${encodeURIComponent(root)}&view=structure`);
  const requests = stubRuns([{ wcc_consent_required: true }]);
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Find a rule" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search this scope" }), { target: { value: "constructor" } });
  fireEvent.click(within(screen.getByRole("region", { name: "Find a rule in this scope" })).getByRole("button", { name: /^Constructor Input$/i }));
  fireEvent.click(screen.getByRole("button", { name: "Graph" }));
  // Before a run, neither its card nor the inspector takes an answer.
  expect(await screen.findByLabelText("Run results and node details")).toBeTruthy();
  expect(screen.getByTestId("canvas-cards").querySelectorAll(".irg-answer")).toHaveLength(0);
  expect(screen.queryByText("Your answer")).toBeNull();
  expect(screen.queryByRole("button", { name: "Run with these values" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  fireEvent.change(await screen.findByRole("spinbutton", { name: /constructor/i }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]!.facts).toEqual({ constructor: 5 });
  fireEvent.click(screen.getByRole("button", { name: "Graph" }));
  const strip = await screen.findByLabelText("Adjust and run again");
  expect(within(strip).getByRole("spinbutton").getAttribute("placeholder")).toBe("e.g. 0");
  expect((within(screen.getByTestId("canvas-cards")).getByRole("spinbutton", { name: "Answer" }) as HTMLInputElement).value).toBe("5");
});

it("asks nothing and offers no input retry when the catalog lists no inputs", async () => {
  vi.mocked(fetchRootCatalog).mockImplementation(async () => ({ inputs: [], relationMembership: "convention", relations: [] }));
  stubRuns([]);
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  await screen.findByRole("button", { name: "Run scenario" });
  expect(document.querySelectorAll(".household-fields label")).toHaveLength(0);
  // An empty catalog is the runtime's answer, not a failed load.
  expect(screen.queryByRole("button", { name: "Retry loading inputs" })).toBeNull();
});

it("refetches the graph when Retry follows a failed load", async () => {
  vi.mocked(fetchComposedGraph).mockRejectedValueOnce(new Error("compose request failed (502)"));
  stubRuns([]);
  render(<GraphViewerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Run" });
  expect(fetchComposedGraph).toHaveBeenCalledTimes(2);
});
