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
  it("shows each tier's headline and its work in rows by part, one square per unit", () => {
    render(<ProgramBundle bundle={bundle} documents={documents} available referenceMs={NOW} />);
    expect(screen.getByRole("heading", { name: "Arizona SNAP" })).toBeInTheDocument();
    const screener = screen.getByRole("region", { name: "Screener-level parity" });
    expect(within(screener).getByText(/cited provisions encoded/).parentElement).toHaveTextContent(
      "1of 2 cited provisions encoded50%"
    );
    const map = within(screener).getByRole("group", { name: /by part of the calculation/ });
    expect(within(map).getByText("Income").parentElement).toHaveTextContent("Income1 / 1");
    expect(within(map).getByText("Deductions").parentElement).toHaveTextContent("Deductions0 / 1");
    expect(within(screener).getByRole("list", { name: "Screener-level parity by state" })).toHaveTextContent(
      "Encoded1Partly encoded0In progress0Failed0Not encoded1Not in the corpus0"
    );
    const full = screen.getByRole("region", { name: "Full document bundle" });
    expect(within(full).getByText(/sections complete/).parentElement).toHaveTextContent("0of 1 sections complete0%");
  });

  it("counts a tier's documents and provisions exactly", () => {
    render(<ProgramBundle bundle={bundle} documents={documents} available referenceMs={NOW} />);
    const screener = screen.getByRole("region", { name: "Screener-level parity" });
    expect(within(screener).getByText("Documents").closest("div")).toHaveTextContent(
      "Documents?10 complete1 partly encoded0 not started0 not in the corpus1 excluded"
    );
    expect(within(screener).getByText("Provisions").closest("div")).toHaveTextContent(
      /^Provisions\?21 encoded1 not started$/
    );
  });

  it("opens a cited provision from its square, with its state, part and document", () => {
    render(<ProgramBundle bundle={bundle} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "7 USC 2014 /b: Not encoded" }));
    const drawer = screen.getByRole("complementary", { name: "Cited provision" });
    expect(within(drawer).getByRole("link", { name: "us/statute/7/2014/b" })).toHaveAttribute("href", "/us/statute/7/2014/b");
    expect(within(drawer).getByText("Deductions")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "7 USC 2014" }));
    const document = screen.getByRole("complementary", { name: "Document" });
    expect(within(document).getByText("Encoded").parentElement).toHaveTextContent("Encoded1");
  });

  it("lists excluded documents with their reasons in the table", () => {
    render(<ProgramBundle bundle={bundle} documents={documents} available referenceMs={NOW} />);
    const screener = screen.getByRole("region", { name: "Screener-level parity" });
    fireEvent.click(within(screener).getByRole("button", { name: "1 excluded" }));
    const table = screen.getByRole("table", { name: "Screener-level parity documents" });
    expect(within(table).getByText("Back-year table: not current law")).toBeInTheDocument();
  });

  it("says when the bundle tables are not there yet", () => {
    render(<ProgramBundle bundle={null} documents={[]} available={false} referenceMs={NOW} />);
    expect(screen.getByText("The bundle tables are not available yet.")).toBeInTheDocument();
  });
});
