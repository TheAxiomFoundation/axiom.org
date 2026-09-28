import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TariffLinePage, { generateMetadata } from "./page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const params = (hts10: string) => ({ params: Promise.resolve({ hts10 }) });

describe("tariff line page", () => {
  it("renders the witness beer line with its Section 338 warning and certificate class", async () => {
    render(await TariffLinePage(params("2203000000")));
    expect(screen.getByRole("heading", { level: 1, name: "Beer made from malt" })).toBeInTheDocument();
    const warning = screen.getByText(/Canada Section 338 warning/).closest("aside")!;
    expect(warning).toHaveTextContent("lists subheading 2203.00.00 under heading 9903.03.12");
    expect(warning).toHaveTextContent("applies that heading only to entry 2203.00.00.30");
    // Column 2 is 13.2¢/liter, a specific rate, so the ledger calls the line partially encoded.
    const rateClass = screen.getByText("Certificate line class: Partially encoded.").closest("p")!;
    expect(rateClass).toHaveTextContent("The column 2 rate is specific, so it is not applied; the chapter composition carries the general rate.");
    expect(screen.getByText(/incomplete and not certified/i)).toBeInTheDocument();
    expect(screen.getByText("Section 301 China list scope — U.S. note 20(f), page 273")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "read authority" })).toHaveAttribute("href", "/us/statute/hts/chapter-99/page-273");
  });

  it("names the incidence tables when a line has no membership", async () => {
    render(await TariffLinePage(params("0303690000")));
    expect(screen.getByText(/No membership appears in the 5 incidence tables at the build pin \(U\.S\. note 16, U\.S\. note 18, U\.S\. note 19, U\.S\. note 20, U\.S\. note 2\(aa\)\)/)).toBeInTheDocument();
  });

  it("lists memberships with their authority links", async () => {
    render(await TariffLinePage(params("7001001000")));
    expect(screen.getByText("Certificate line class: Encoded.").closest("p")).toHaveTextContent("Both columns are ad valorem or Free, and the chapter composition carries both rates.");
    const links = screen.getAllByRole("link", { name: "read authority" });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toMatch(/^\/us\/statute\/hts\/chapter-99\/page-\d+$/);
    expect(screen.queryByText(/Canada Section 338 warning/)).not.toBeInTheDocument();
  });

  it("titles known lines and 404s unknown ones", async () => {
    expect(await generateMetadata(params("2203.00.00.00"))).toEqual({ title: "2203.00.00.00 — Tariff schedule" });
    expect(await generateMetadata(params("0000000000"))).toEqual({ title: "Tariff line not found" });
    await expect(TariffLinePage(params("0000000000"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
