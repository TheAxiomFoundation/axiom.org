import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgramBundle } from "./program-bundle";
import { measureDocument, type BundleFileDocument, type BundleRow, type ModuleSource } from "@/lib/axiom/program-bundles";

const AT = "2026-10-06T12:00:00Z";
const NOW = Date.parse("2026-10-06T12:30:00Z");

const bundle: BundleRow = {
  id: "us-az/snap",
  title: "Arizona SNAP",
  program: "snap",
  jurisdiction: "us-az",
  as_of: "2026-10-06",
  parts: [],
  tiers: [
    { id: "screener", title: "Screener-level parity", definition: "Every PolicyEngine-cited document.", membership: {} },
    { id: "full", title: "Full document bundle", definition: "Every primary source.", membership: {} },
  ],
  source: "local",
  collected_at: AT,
};

const doc = (overrides: Partial<BundleFileDocument>): BundleFileDocument => ({
  key: "us/statute/7/2014",
  name: "7 USC 2014",
  layer: "federal",
  part: "Income",
  citation_path: "us/statute/7/2014",
  source_url: null,
  sources: ["plan"],
  scope: "in",
  ...overrides,
});

const nodes = [
  { path: "us/statute/7/2014", child_count: 2 },
  { path: "us/statute/7/2014/a", child_count: 0 },
  { path: "us/statute/7/2014/b", child_count: 0 },
];
const module = (path: string): ModuleSource => ({ module: path, sources: [path] });

const documents = [
  measureDocument(
    "us-az/snap",
    "screener",
    doc({
      cited: [
        { path: "us/statute/7/2014/a", references: 2, part: "Income" },
        { path: "us/statute/7/2014/b", references: 1, part: "Deductions" },
      ],
    }),
    { nodes, modules: [module("us/statute/7/2014/a")], attempts: [] },
    AT
  ),
  measureDocument(
    "us-az/snap",
    "screener",
    doc({
      key: "https://www.fns.usda.gov/x",
      name: "FNS FY2019 table",
      citation_path: null,
      source_url: "https://www.fns.usda.gov/x",
      scope: "excluded",
      reason: "Back-year table: not current law",
    }),
    null,
    AT
  ),
  measureDocument(
    "us-az/snap",
    "full",
    doc({
      key: "us-az/manual/des/faa5/x",
      name: "FAA5 page",
      layer: "state",
      part: "Benefit determination",
      citation_path: "us-az/manual/des/faa5/x",
    }),
    { nodes: [], modules: [], attempts: [] },
    AT
  ),
];

describe("ProgramBundle", () => {
  const withParts = { ...bundle, parts: ["Income", "Deductions", "Benefit determination"] };

  it("counts documents in both tiers by default, a row per part, each cell its own share", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    expect(screen.getByRole("heading", { name: "Arizona SNAP" })).toBeInTheDocument();
    const matrix = screen.getByRole("table", { name: "Parts of the program by tier" });
    const headers = within(matrix).getAllByRole("columnheader");
    expect(headers[1]).toHaveTextContent(/Screener-level parity.*0 of 1 document complete0%/);
    // The screener tier also gives its PolicyEngine parity.
    expect(headers[1]).toHaveTextContent("PolicyEngine parity: 1 of 2 cited provisions · 50%");
    expect(headers[2]).toHaveTextContent(/Full document bundle.*0 of 1 document complete0%/);
    // Rows in the bundle's order of parts.
    expect(within(matrix).getAllByRole("rowheader").map((h) => h.textContent)).toEqual([
      "Income",
      "Benefit determination",
      "Documents?",
      "Provisions?",
    ]);
    expect(
      within(matrix).getByRole("button", { name: "Income, Screener-level parity: 0 of 1 document complete" })
    ).toHaveTextContent("0 of 10%");
  });

  it("switches every cell to provisions, counting documents the corpus lacks apart", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("radio", { name: "Provisions" }));
    const matrix = screen.getByRole("table", { name: "Parts of the program by tier" });
    const headers = within(matrix).getAllByRole("columnheader");
    expect(headers[1]).toHaveTextContent(/1 of 2 provisions encoded50%/);
    expect(
      within(matrix).getByRole("button", { name: "Income, Screener-level parity: 1 of 2 provisions encoded" })
    ).toHaveTextContent("1 of 250%");
    expect(
      within(matrix).getByRole("button", { name: "Benefit determination, Full document bundle: 0 of 0 provisions encoded" })
    ).toHaveTextContent("0 of 0 + 1 not in the corpus");
  });

  it("counts each tier's documents and provisions exactly", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    const matrix = screen.getByRole("table", { name: "Parts of the program by tier" });
    const cells = within(matrix).getAllByRole("cell");
    expect(cells.at(-4)).toHaveTextContent("10 complete1 partly encoded0 not started0 not in the corpus1 excluded");
    expect(cells.at(-2)).toHaveTextContent("21 encoded1 not started");
  });

  it("opens a cell's documents, and the parity drawer's cited provisions", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Income, Screener-level parity: 0 of 1 document complete" }));
    const cell = screen.getByRole("complementary", { name: "Part of the program" });
    expect(within(cell).getByRole("heading", { name: "Income" })).toBeInTheDocument();
    fireEvent.click(within(cell).getByRole("button", { name: /7 USC 2014/ }));
    const document = screen.getByRole("complementary", { name: "Document" });
    expect(within(document).getByText("Encoded").parentElement).toHaveTextContent("Encoded1");
    fireEvent.click(screen.getByRole("button", { name: /PolicyEngine parity: 1 of 2/ }));
    const parity = screen.getByRole("complementary", { name: "PolicyEngine parity" });
    expect(within(parity).getByRole("heading", { name: "1 of 2 cited provisions encoded" })).toBeInTheDocument();
    fireEvent.click(within(parity).getByRole("button", { name: /7 USC 2014 \/b/ }));
    const unit = screen.getByRole("complementary", { name: "Cited provision" });
    expect(within(unit).getByRole("link", { name: "us/statute/7/2014/b" })).toHaveAttribute("href", "/us/statute/7/2014/b");
    expect(within(unit).getByText("Deductions")).toBeInTheDocument();
  });

  it("lists excluded documents with their reasons in the table", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "1 excluded" }));
    const table = screen.getByRole("table", { name: "Screener-level parity documents" });
    expect(within(table).getByText("Back-year table: not current law")).toBeInTheDocument();
  });

  it("says when the bundle tables are not there yet", () => {
    render(<ProgramBundle bundle={null} documents={[]} available={false} referenceMs={NOW} />);
    expect(screen.getByText("The bundle tables are not available yet.")).toBeInTheDocument();
  });
});
