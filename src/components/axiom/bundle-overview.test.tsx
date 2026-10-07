import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BundleOverview } from "./bundle-overview";
import type { TierCounts } from "@/lib/axiom/program-bundles";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";

const counts = (complete: number, documents: number, encoded: number, provisions: number): TierCounts => ({
  documents,
  excluded: 0,
  byStatus: { complete, unvalidated: 0, partly: 0, not_started: documents - complete, not_in_corpus: 0 },
  provisions,
  byProvisionState: { encoded, unvalidated: 0, partly: 0, deferred: 0, in_progress: 0, failed: 0, not_started: provisions - encoded },
  units: 0,
  byUnitState: { encoded: 0, unvalidated: 0, partly: 0, deferred: 0, in_progress: 0, failed: 0, not_encoded: 0, not_in_corpus: 0 },
});

const bundle = (jurisdiction: string, program: string, title: string, screener: TierCounts, full: TierCounts): BundleSummary => ({
  id: `${jurisdiction}/${program}`,
  title,
  program,
  jurisdiction,
  counts: { screener, full },
});

const bundles = [
  bundle("us", "snap", "SNAP: federal law", counts(1, 56, 40, 155), counts(1, 144, 55, 1059)),
  bundle("us-az", "snap", "Arizona SNAP", counts(1, 58, 68, 527), counts(4, 187, 71, 1212)),
  bundle("us-ca", "snap", "California SNAP", counts(4, 60, 70, 600), counts(5, 190, 80, 1300)),
  bundle("us", "medicaid", "Medicaid: federal law", counts(0, 115, 10, 143), counts(1, 416, 97, 8061)),
  bundle("us-az", "medicaid", "Arizona Medicaid", counts(0, 120, 1, 2), counts(2, 450, 97, 8100)),
];

describe("BundleOverview", () => {
  it("counts what rests on a validation waiver as done, and apart as not validated", () => {
    const waived = counts(3, 10, 0, 0);
    // Two of the three complete documents rest on waived modules.
    waived.byStatus = { ...waived.byStatus, complete: 1, unvalidated: 2 };
    render(
      <BundleOverview
        bundles={[
          bundle("us", "snap", "SNAP: federal law", waived, waived),
          bundle("us-az", "snap", "Arizona SNAP", waived, waived),
        ]}
      />
    );
    const federal = within(screen.getByRole("table", { name: "SNAP by state" })).getByRole("link", { name: "Federal law" });
    expect(federal.closest("tr")).toHaveTextContent("30%3 of 10 documents · 1 validated");
  });

  it("lists the programs by their completeness, and the chosen program's federal law and states", () => {
    render(<BundleOverview bundles={bundles} />);
    const programs = screen.getByRole("list", { name: "Programs" });
    expect(within(programs).getByRole("button", { name: /SNAP/ })).toHaveAttribute("aria-pressed", "true");
    // Every document once: the federal law (1 of 56), Arizona's own (0 of 2), California's own (3 of 4).
    const snap = within(programs).getByRole("button", { name: /SNAP/ });
    expect(snap).toHaveTextContent("SNAP6%");
    expect(snap).toHaveAttribute(
      "title",
      "SNAP: 4 of 62 documents complete (4 validated), across the federal law and 2 states"
    );
    const table = screen.getByRole("table", { name: "SNAP by state" });
    const rows = within(table).getAllByRole("row").slice(1);
    // The federal law first, then the states in alphabetical order.
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Federal lawshared by every state",
      "Arizona",
      "California",
    ]);
    expect(rows[1]).toHaveTextContent("2%1 of 58 documents · 1 validated2%4 of 187 documents · 4 validated");
    expect(within(rows[1]).getByRole("link", { name: "Arizona" })).toHaveAttribute("href", "/ops?tab=bundles&bundle=us-az/snap");
    // The programs in alphabetical order too.
    expect(within(programs).getAllByRole("button").map((b) => b.textContent?.replace(/\d+%$/, ""))).toEqual([
      "Medicaid",
      "SNAP",
    ]);
  });

  it("counts provisions on request, opening each bundle in that count, and switches program", () => {
    render(<BundleOverview bundles={bundles} />);
    fireEvent.click(screen.getByRole("radio", { name: "Provisions" }));
    const table = screen.getByRole("table", { name: "SNAP by state" });
    const arizona = within(table).getByRole("link", { name: "Arizona" });
    expect(arizona).toHaveAttribute("href", "/ops?tab=bundles&bundle=us-az/snap&count=provisions");
    expect(arizona.closest("tr")).toHaveTextContent("13%68 of 527 cited provisions · 68 validated6%71 of 1,212 provisions · 71 validated");
    fireEvent.click(within(screen.getByRole("list", { name: "Programs" })).getByRole("button", { name: /Medicaid/ }));
    expect(screen.getByRole("table", { name: "Medicaid by state" })).toBeInTheDocument();
  });

  it("gives the programs' completeness in either tier", () => {
    render(<BundleOverview bundles={bundles} />);
    const toggle = screen.getByRole("radiogroup", { name: "Completeness, by tier" });
    fireEvent.click(within(toggle).getByRole("radio", { name: "Tier 2" }));
    // The federal law (1 of 144), Arizona's own (3 of 43), California's own (4 of 46).
    expect(within(screen.getByRole("list", { name: "Programs" })).getByRole("button", { name: /SNAP/ })).toHaveAttribute(
      "title",
      "SNAP: 8 of 233 documents complete (8 validated), across the federal law and 2 states"
    );
  });

  it("views by state: the federal law and each state count only their own documents", () => {
    render(<BundleOverview bundles={bundles} />);
    fireEvent.click(screen.getByRole("radio", { name: "By state" }));
    const list = screen.getByRole("list", { name: "Jurisdictions" });
    const federal = within(list).getByRole("button", { name: /Federal law/ });
    expect(federal).toHaveAttribute("aria-pressed", "true");
    // SNAP's federal law (1 of 56) and Medicaid's (0 of 115).
    expect(federal).toHaveAttribute("title", "Federal law: 1 of 171 documents complete (1 validated), the federal law of 2 programs");
    const federalTable = screen.getByRole("table", { name: "Federal law by program" });
    expect(within(federalTable).getByRole("link", { name: "SNAP" })).toHaveAttribute("href", "/ops?tab=bundles&bundle=us/snap");
    fireEvent.click(within(list).getByRole("button", { name: /Arizona/ }));
    // Arizona's own: SNAP 0 of 2 (1 of 58 less the federal 1 of 56), Medicaid 0 of 5.
    expect(within(list).getByRole("button", { name: /Arizona/ })).toHaveAttribute(
      "title",
      "Arizona: 0 of 7 documents complete (0 validated), the state's own documents in 2 programs"
    );
    const arizona = screen.getByRole("table", { name: "Arizona by program" });
    const snap = within(arizona).getByRole("link", { name: "SNAP" });
    expect(snap).toHaveAttribute("href", "/ops?tab=bundles&bundle=us-az/snap");
    expect(snap.closest("tr")).toHaveTextContent("SNAP0%0 of 2 documents · 0 validated7%3 of 43 documents · 3 validated");
  });
});
