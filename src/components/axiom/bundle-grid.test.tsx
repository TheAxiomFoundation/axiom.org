import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BundleGrid } from "./bundle-grid";
import type { TierCounts } from "@/lib/axiom/program-bundles";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";

const counts = (encoded: number, provisions: number): TierCounts => ({
  documents: 1,
  excluded: 0,
  byStatus: { complete: 0, unvalidated: 0, partly: 1, not_started: 0, not_in_corpus: 0 },
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
  bundle("us", "snap", "SNAP: federal law", counts(40, 155), counts(55, 1059)),
  bundle("us-az", "snap", "Arizona SNAP", counts(40, 157), counts(70, 1271)),
  bundle("us-ca", "snap", "California SNAP", counts(0, 0), counts(0, 12)),
  bundle("us", "medicaid", "Medicaid: federal law", counts(10, 143), counts(97, 8061)),
  bundle("us-az", "medicaid", "Arizona Medicaid", counts(1, 2), counts(97, 8100)),
];

describe("BundleGrid", () => {
  it("lays out a row per program and a column per state, each cell shaded by its page's headline number", () => {
    render(<BundleGrid bundles={bundles} />);
    // Documents complete by default, as each bundle page opens.
    const grid = screen.getByRole("table", { name: "Program bundles, Tier 1, documents" });
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Program", "US", "AZ", "CA"]);
    expect(within(grid).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["SNAP", "Medicaid"]);
    const az = within(grid).getByRole("link", { name: "Arizona SNAP: 0 of 1 documents complete (0%)" });
    expect(az).toHaveAttribute("href", "/ops/bundles/us-az/snap");
    expect(az).toHaveAttribute("data-step", "4");
    expect(within(grid).getByRole("link", { name: "Medicaid" })).toHaveAttribute("href", "/ops/bundles/us/medicaid");
  });

  it("counts provisions on request, and opens the bundle page in that count", () => {
    render(<BundleGrid bundles={bundles} />);
    fireEvent.click(screen.getByRole("radio", { name: "Provisions" }));
    const grid = screen.getByRole("table", { name: "Program bundles, Tier 1, provisions" });
    const az = within(grid).getByRole("link", { name: "Arizona SNAP: 40 of 157 cited provisions encoded (25%)" });
    expect(az).toHaveAttribute("href", "/ops/bundles/us-az/snap?count=provisions");
    expect(az).toHaveAttribute("data-step", "1");
    // Nothing to count yet is its own mark.
    expect(within(grid).getByRole("link", { name: "California SNAP: 0 of 0 cited provisions encoded" })).toHaveAttribute(
      "data-step",
      "empty"
    );
    fireEvent.click(screen.getByRole("radio", { name: "Tier 2 · full bundle" }));
    expect(
      within(screen.getByRole("table", { name: "Program bundles, Tier 2, provisions" })).getByRole("link", {
        name: "Arizona SNAP: 70 of 1,271 provisions encoded (6%)",
      })
    ).toHaveAttribute("data-step", "3");
  });
});
