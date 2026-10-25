import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRONT_DOOR, TOOL_PILOT, freePlanProblems } from "@/lib/aspen/content";
import { EMPTY_SUMMARY } from "@/lib/aspen/results";
import type { Control } from "@/lib/aspen/types";
import { MOCK_FREE_PLAN_PILOT } from "@/test/aspen-free-plan.mock";
import { FreePlanSlide, PresenterApp, scaleSlides } from "./presenter-app";

// The app reads FREE_PLAN_PILOT at load; here it's the MOCK, so At scale gets the slide.
vi.mock("@/lib/aspen/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aspen/content")>()),
  FREE_PLAN_PILOT: (await import("@/test/aspen-free-plan.mock")).MOCK_FREE_PLAN_PILOT,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scaleSlides", () => {
  it("puts the free-plan pilot after the tool pilot, only when it has numbers, and keeps the live demo last", () => {
    const without = scaleSlides(null);
    expect(without).toEqual(["share", "household", "break", "miss", "front-door", "tool", "live-demo"]);
    const withPilot = scaleSlides(MOCK_FREE_PLAN_PILOT);
    expect(withPilot).toEqual(["share", "household", "break", "miss", "front-door", "tool", "free-plan", "live-demo"]);
    expect(withPilot.at(-1)).toBe("live-demo");
  });
});

describe("FreePlanSlide", () => {
  it("prints the change inside its interval when the exact change sits just past a rounded end", () => {
    // As the converter makes PolicyBench's synthetic 0 of 801 to 100 of 801, rounded to 12.5 all three ways: the exact change is 12.48.
    const c = (k: number) => ({ k, n: 801 });
    const pilot = {
      ...MOCK_FREE_PLAN_PILOT,
      rows: [{ ...MOCK_FREE_PLAN_PILOT.rows[0], counts: { web: c(0), both: c(100) }, bothVsWeb: { points: (100 * 100) / 801, lo: 12.5, hi: 12.5 } }],
    };
    expect(freePlanProblems(pilot)).toEqual([]);
    render(<FreePlanSlide pilot={pilot} />);
    expect(screen.getByText("+13")).toBeInTheDocument();
    expect(screen.getByText("+13 to +13")).toBeInTheDocument();
    expect(screen.queryByText("+12")).toBeNull();
  });

  it("shows each model's share in both settings as a whole percent with its count, and its change from adding the tool", () => {
    render(<FreePlanSlide pilot={MOCK_FREE_PLAN_PILOT} />);
    const p = MOCK_FREE_PLAN_PILOT;
    expect(screen.getByText(p.title)).toBeInTheDocument();
    // The label rides beside the title, so a screenshot can't lose it.
    expect(screen.getByText("MOCK DATA, not results")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Share of amounts right, by model and setting/ });
    for (const arm of p.arms) expect(within(table).getByRole("columnheader", { name: arm.label })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Adding the tool, in points, with its 95% interval" })).toBeInTheDocument();
    expect(p.arms.map((a) => a.label)).toEqual(["Web search available", "Web search and the PolicyEngine tool available"]);

    const a = within(table).getByRole("row", { name: /Mock model A/ });
    expect(a).toHaveTextContent("On mock plan A");
    // 20 and 41 of 48: 41.7 and 85.4%, shown whole; the change, 43.8, shown whole too.
    expect(within(a).getAllByRole("cell").map((c) => c.textContent)).toEqual(["42%20 of 48", "85%41 of 48", "+44+27 to +59"]);

    // 13 of 47 is 27.7%, shown as 28; the change's interval includes zero, and the slide says so in words.
    const c = within(table).getByRole("row", { name: /Mock model C/ });
    expect(within(c).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["28%13 of 47", "34%16 of 47", "+6−11 to +25, includes 0"]);
    expect(within(c).getByText("+6")).toHaveClass("text-[var(--color-ink-muted)]");
    expect(within(a).getByText("+44")).toHaveClass("text-[var(--color-ink)]");

    // A comparison model has no free-plan line.
    const d = within(table).getByRole("rowheader", { name: "Mock model D" });
    expect(d.textContent).toBe("Mock model D");

    expect(screen.getByText(p.caveat)).toBeInTheDocument();
    // The footnotes run in as one paragraph, so a short one shares a line.
    expect(screen.getByText(p.footnotes.join(" "))).toBeInTheDocument();
    expect(screen.getByText(p.source)).toBeInTheDocument();
  });

  it("draws each bar at its whole-percent share", () => {
    const { container } = render(<FreePlanSlide pilot={MOCK_FREE_PLAN_PILOT} />);
    const widths = [...container.querySelectorAll<HTMLElement>("td span[aria-hidden] > span")].map((s) => s.style.width);
    expect(widths.slice(0, 2)).toEqual(["42%", "85%"]);
    expect(widths).toHaveLength(MOCK_FREE_PLAN_PILOT.rows.length * MOCK_FREE_PLAN_PILOT.arms.length);
  });

  it("leaves a setting's cell empty when a model has no count for it, and gives up to three models more room", () => {
    const p = MOCK_FREE_PLAN_PILOT;
    const rows = p.rows.slice(0, 2).map((r, i) => (i === 0 ? { ...r, counts: { ...r.counts, web: undefined } } : r));
    render(<FreePlanSlide pilot={{ ...p, rows }} />);
    const a = screen.getByRole("row", { name: /Mock model A/ });
    const cells = within(a).getAllByRole("cell");
    expect(cells[0].textContent).toBe("");
    expect(cells[0]).toHaveClass("py-[10px]");
    // With PolicyBench's caveat and footnotes at full length, roomy rows fit 1600×900 only up to three.
    for (const [n, cell] of [[3, "py-[10px]"], [4, "py-[1px]"], [6, "py-[1px]"]] as const) {
      cleanup();
      render(<FreePlanSlide pilot={{ ...p, rows: p.rows.slice(0, n) }} />);
      expect(within(screen.getByRole("row", { name: /Mock model A/ })).getAllByRole("cell")[0]).toHaveClass(cell);
    }
  });
});

describe("PresenterApp with the free-plan pilot set", () => {
  it("steps through At scale as eight slides: the tool pilot, the free-plan pilot, then the live demo", async () => {
    let control: Control = { runId: "r1", stage: "scale", live: true, updatedAt: null };
    const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/api/aspen/results")) return json({ runId: "r1", live: true, summary: EMPTY_SUMMARY });
        if (url === "/api/aspen/state" && init?.method === "POST") {
          control = { ...control, ...(JSON.parse(String(init.body)) as Partial<Control>) };
          return json(control);
        }
        if (url === "/api/aspen/state") return json(control);
        throw new Error(`unexpected ${url}`);
      }),
    );
    render(<PresenterApp joinPassword="phoenix-2026" />);
    await waitFor(() => expect(screen.getByText("1/8")).toBeInTheDocument());
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("6/8")).toBeInTheDocument();
    expect(screen.getByText(TOOL_PILOT.title)).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("7/8")).toBeInTheDocument();
    expect(screen.getByText(MOCK_FREE_PLAN_PILOT.title)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: FRONT_DOOR.heading })).toBeInTheDocument();
    // The demo's link stays on the demo.
    expect(screen.queryByRole("link", { name: /Open demo in a new tab/ })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("8/8")).toBeInTheDocument();
    expect(screen.getByTitle(/Live chatbot demo/)).toBeInTheDocument();
    // The front door's heading holds to the end of the stage, however many slides it has.
    expect(screen.getByRole("heading", { level: 1, name: FRONT_DOOR.heading })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open demo in a new tab/ })).toBeInTheDocument();
  });
});
