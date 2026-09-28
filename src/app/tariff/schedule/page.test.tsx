import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { displayStatus } from "@/lib/tariff-coverage";
import { getTariffMetadata } from "@/lib/tariff-schedule";
import TariffSchedulePage, { metadata } from "./page";

const tariff = getTariffMetadata();

describe("tariff schedule and coverage browser", () => {
  it("renders search, status, downloads, and corrections", () => {
    render(<TariffSchedulePage />);
    expect(screen.getByRole("heading", { name: /tariff schedule and coverage browser/i })).toBeInTheDocument();
    expect(screen.getByText(/incomplete and not certified/i)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search by HTS code prefix or description/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download json/i })).toHaveAttribute("href", "/downloads/tariff-schedule.json");
    expect(screen.getByRole("link", { name: /changelog and corrections/i })).toHaveAttribute("href", "https://github.com/TheAxiomFoundation/rulespec-us/issues");
  });

  it("states the artifact's line count and pins", () => {
    const { container } = render(<TariffSchedulePage />);
    expect(screen.getByText(/Search 13,790 rated Harmonized Tariff Schedule lines/)).toBeInTheDocument();
    expect(tariff.lineCount).toBe(13_790);
    const text = container.textContent ?? "";
    expect(text).toContain(`rulespec-us ${tariff.rulespecCommit.slice(0, 10)}`);
    expect(text).toContain(`evaluated commit ${tariff.certificateRulespecCommit.slice(0, 10)}`);
    expect(text).toContain(`axiom-corpus scope ${tariff.corpusRelease} at ${tariff.corpusCommit.slice(0, 10)}`);
  });

  it("shows the certificate the downloads name, and only that one", () => {
    const { container } = render(<TariffSchedulePage />);
    const vendored = createHash("sha256").update(readFileSync("public/downloads/us-tariff-duty.certificate.json")).digest("hex");
    expect(tariff.certificateSha256).toBe(vendored);
    const shas = new Set((container.textContent ?? "").match(/\b[0-9a-f]{64}\b/g));
    expect([...shas]).toEqual([vendored]);
  });

  it("renders one coverage row per ledger family with the ledger's status", () => {
    render(<TariffSchedulePage />);
    const table = within(screen.getByRole("heading", { name: /coverage by action family/i }).closest("section")!).getByRole("table");
    for (const row of tariff.coverageFamilies) {
      const header = within(table).getByRole("rowheader", { name: row.family });
      const cells = within(header.closest("tr")!).getAllByRole("cell");
      expect(cells.map((cell) => cell.textContent)).toEqual([displayStatus(row.status), row.note]);
    }
    expect(within(table).getAllByRole("row")).toHaveLength(tariff.coverageFamilies.length + 1);
    expect(within(table).getByRole("rowheader", { name: "Section 338 Canada (note 51)" })).toBeInTheDocument();
    expect(screen.queryByText(/pending merge/i)).not.toBeInTheDocument();
    expect(screen.getByText(/the ledger's stated reason \(not fed into the final composition\) disagrees with those rules/)).toBeInTheDocument();
  });

  it("names the incidence tables and the missing ones", () => {
    render(<TariffSchedulePage />);
    const list = screen.getByRole("heading", { name: /incidence tables behind line memberships/i }).closest("section")!;
    for (const table of tariff.incidenceTables) expect(within(list).getByText(`${table.note}, ${table.family}`)).toBeInTheDocument();
    expect(within(list).getAllByText(/No table at the build pin/)).toHaveLength(4);
    const steel = within(list).getByText("U.S. note 16, Section 232 steel").closest("li")!;
    expect(steel).toHaveTextContent("subdivisions 16(c)(iii), 16(c)(iv), 16(c)(vii), 16(c)(x), 16(c)(xi); 735 rate lines, 30 of them through statistical numbers only");
    expect(within(list).getByText("U.S. note 18, Section 201 solar").closest("li")).toHaveTextContent("subdivisions 18(c)(i); 1 rate line");
  });

  it("keeps the Section 338 notice to what the corpus and encodings show", () => {
    render(<TariffSchedulePage />);
    const notice = screen.getByText(/Canada Section 338 notice/).closest("aside")!;
    expect(notice).toHaveTextContent("heading 9903.03.12");
    expect(notice).toHaveTextContent("2203.00.00.30");
    expect(notice).not.toHaveTextContent("9903.03.14");
  });

  it("uses descriptive metadata", () => { expect(metadata.title).toMatch(/tariff schedule and coverage browser/i); });
});
