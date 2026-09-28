import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TariffSchedulePage, { metadata } from "./page";

describe("tariff schedule and coverage browser", () => {
  it("renders search, status, downloads, and corrections", () => {
    render(<TariffSchedulePage />);
    expect(screen.getByRole("heading", { name: /tariff schedule and coverage browser/i })).toBeInTheDocument();
    expect(screen.getByText(/incomplete and not certified/i)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search by HTS code prefix or description/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download json/i })).toHaveAttribute("href", "/downloads/tariff-schedule.json");
    expect(screen.getByRole("link", { name: /changelog and corrections/i })).toHaveAttribute("href", "https://github.com/TheAxiomFoundation/rulespec-us/issues");
  });
  it("uses descriptive metadata", () => { expect(metadata.title).toMatch(/tariff schedule and coverage browser/i); });
});
