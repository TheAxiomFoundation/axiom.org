import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleBrowser } from "./schedule-browser";

const line = (hts10: string, description: string) => ({ hts10, displayCode: hts10.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1.$2.$3.$4"), description, generalRate: "Free", column2Rate: "13.2¢/liter", generalDisposition: "free", column2Disposition: "specific", citations: [], memberships: [], canada338Warning: false });
const lines = [line("2203000000", "Beer made from malt"), line("2204100000", "Sparkling wine"), ...Array.from({ length: 120 }, (_, i) => line(String(3000000000 + i), `Plastic article ${i}`))];

describe("ScheduleBrowser", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ lines }) }))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("loads the schedule, filters by code prefix and by description, and paginates", async () => {
    render(<ScheduleBrowser />);
    expect(screen.getByText(/loading schedule/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/122 results/i)).toBeInTheDocument());
    expect(screen.getAllByRole("row")).toHaveLength(101);
    const button = screen.getByRole("button", { name: /show 100 more/i });
    await act(async () => { fireEvent.click(button); });
    expect(screen.getAllByRole("row")).toHaveLength(123);
    const search = screen.getByRole("searchbox");
    await act(async () => { fireEvent.change(search, { target: { value: "2203" } }); });
    await waitFor(() => expect(screen.getByText(/1 results/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "2203.00.00.00" })).toHaveAttribute("href", "/tariff/schedule/2203000000");
    await act(async () => { fireEvent.change(search, { target: { value: "sparkling" } }); });
    await waitFor(() => expect(screen.getByText(/sparkling wine/i)).toBeInTheDocument());
    await act(async () => { fireEvent.change(search, { target: { value: "" } }); });
    await waitFor(() => expect(screen.getByText(/122 results/i)).toBeInTheDocument());
  });

  it("fails closed when the artifact is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<ScheduleBrowser />);
    await waitFor(() => expect(screen.getByText(/schedule unavailable/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /show 100 more/i })).not.toBeInTheDocument();
  });
});
