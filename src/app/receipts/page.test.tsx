import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ReceiptsPage from "./page";

describe("receipts evidence page", () => {
  it("renders the receipts headline and the package cross-link", () => {
    render(<ReceiptsPage />);

    expect(
      screen.getByRole("heading", { name: /we show our receipts/i })
    ).toBeInTheDocument();

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/receipt");
  });

  it("links every receipt row to a public surface", () => {
    render(<ReceiptsPage />);

    for (const name of [
      "The receipt package",
      "Releases",
      "Encodings",
      "Validation",
      "Certification",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(
      "https://github.com/TheAxiomFoundation/axiom-rules-engine/releases"
    );
    expect(hrefs).toContain("https://github.com/TheAxiomFoundation/rulespec-us");
    expect(hrefs).toContain("https://github.com/TheAxiomFoundation/axiom-oracles");
    // The certification row links the live ledger itself, not a claim
    // about it (empty since issue: ledger bootstrap-empty).
    expect(hrefs).toContain("/api/axiom/certified");
    expect(screen.getByText(/That ledger is empty/)).toBeInTheDocument();
    expect(screen.queryByText(/certifies itself|grants it by hand|not granted/)).not.toBeInTheDocument();
    // The ledger admits human-attested entries; the row must say so.
    expect(screen.getByText(/attested by a human signature/)).toBeInTheDocument();
  });
});
