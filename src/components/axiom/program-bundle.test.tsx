import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgramBundle } from "./program-bundle";
import { measureDocument, type BundleFileDocument, type BundleRow } from "@/lib/axiom/program-bundles";

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
    { id: "full", title: "Full document bundle", definition: "Every primary source.", membership: {}, notes: ["56 FAA5 pages are blocked."] },
  ],
  source: "local",
  collected_at: AT,
};

const doc = (overrides: Partial<BundleFileDocument>): BundleFileDocument => ({
  key: "us/statute/7/2014",
  name: "7 USC 2014",
  layer: "federal",
  citation_path: "us/statute/7/2014",
  source_url: null,
  sources: ["plan"],
  scope: "in",
  ...overrides,
});

const documents = [
  measureDocument(
    "us-az/snap",
    "screener",
    doc({ cited: [{ path: "us/statute/7/2014/a", references: 1 }] }),
    {
      nodes: ["us/statute/7/2014", "us/statute/7/2014/a"],
      ruleCitations: [{ citation_path: "us/statute/7/2014/a", rule: "a#x" }],
      attempts: [],
    },
    AT
  ),
  measureDocument("us-az/snap", "screener", doc({ key: "us/regulation/7/273/9", name: "7 CFR 273.9", citation_path: "us/regulation/7/273/9" }), {
    nodes: ["us/regulation/7/273/9"],
    ruleCitations: [{ citation_path: "us/regulation/7/273/9", rule: "r#y" }],
    attempts: [],
  }, AT),
  measureDocument(
    "us-az/snap",
    "screener",
    doc({ key: "https://www.fns.usda.gov/x", name: "FNS FY2019 table", citation_path: null, source_url: "https://www.fns.usda.gov/x", scope: "excluded", reason: "Back-year table: not current law" }),
    null,
    AT
  ),
  measureDocument(
    "us-az/snap",
    "full",
    doc({ key: "us-az/manual/des/faa5/x", name: "FAA5 page", layer: "state", citation_path: "us-az/manual/des/faa5/x" }),
    { nodes: [], ruleCitations: [], attempts: [] },
    AT
  ),
];

describe("ProgramBundle", () => {
  it("shows each tier's encoded documents, a status bar and the status counts", () => {
    render(<ProgramBundle bundle={bundle} documents={documents} available referenceMs={NOW} />);
    expect(screen.getByRole("heading", { name: "Arizona SNAP" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Screener-level parity", "Full document bundle"]);
    const legend = screen.getByRole("list", { name: "Screener-level parity by status" });
    expect(within(legend).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Encoded1",
      "Partly encoded1",
      "No rules yet0",
      "Not in the corpus0",
    ]);
    expect(screen.getByText(/1 encoded · 0 inside · 0 not encoded/)).toBeInTheDocument();
  });

  it("opens a document from the map, with its provisions and what PolicyEngine cites", () => {
    render(<ProgramBundle bundle={bundle} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "7 USC 2014: Partly encoded" }));
    const detail = screen.getByRole("complementary", { name: "Document" });
    expect(within(detail).getByRole("heading", { name: "7 USC 2014" })).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "us/statute/7/2014" })).toHaveAttribute("href", "/us/statute/7/2014");
    expect(within(detail).getByText("1 of 2")).toBeInTheDocument();
    expect(within(detail).getByText("/a")).toBeInTheDocument();
  });

  it("lists excluded documents with their reasons, and switches tiers", () => {
    render(<ProgramBundle bundle={bundle} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "1 document" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("FNS FY2019 table")).toBeInTheDocument();
    expect(within(table).getByText("Back-year table: not current law")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Full document bundle" }));
    expect(screen.getByRole("tab", { name: "Full document bundle" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "FAA5 page: Not in the corpus" })).toBeInTheDocument();
  });

  it("says when the bundle tables are not there yet", () => {
    render(<ProgramBundle bundle={null} documents={[]} available={false} referenceMs={NOW} />);
    expect(screen.getByText("The bundle tables are not available yet.")).toBeInTheDocument();
  });
});
