import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import Page, { metadata } from "@/app/verify/page";

describe("Verify page", () => {
  it("is indexable for the US launch", () => {
    expect(metadata.robots).toBeUndefined();
    expect(metadata.description).toMatch(/^US launch verification evidence/);
  });

  it("keeps the launch evidence US-only and uses the committed figures", () => {
    render(<Page />);

    expect(
      screen.getByText(
        "The corpus includes other jurisdictions, but this launch reports US verification only.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("2,144 comparisons")).toBeInTheDocument();
    expect(
      screen.getByText(
        "100% of mismatches explained under the conformance predicate.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("856 real FY 2024 administrative cases"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("3,881,635 distinct comparisons"),
    ).toBeInTheDocument();

    expect(screen.queryByText(/Belgium/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/United Kingdom/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/EUROMOD/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/UKMOD/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/policyengine-uk/i)).not.toBeInTheDocument();
    expect(screen.queryByText("3,881,635")).not.toBeInTheDocument();
    expect(screen.queryByText("99.52%")).not.toBeInTheDocument();
  });

  it("shows the released tuple and the honest API and certificate states", () => {
    render(<Page />);

    expect(
      screen.getByRole("heading", {
        name: "engine v0.1.1 x program-artifacts-59a10dab866e",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Stranger-path reproducible")).toBeInTheDocument();
    expect(screen.getByText("snap_eligible")).toBeInTheDocument();
    expect(screen.getByText("holds")).toBeInTheDocument();
    expect(screen.getByText("snap_allotment")).toBeInTheDocument();
    expect(screen.getByText("478")).toBeInTheDocument();
    expect(screen.getByText("snap_net_income")).toBeInTheDocument();
    expect(screen.getByText("226")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Certificate — certified: 0 — certification is automatic when the harness computes completeness and fidelity green; we expect no current encoding passes yet\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Certified")).not.toBeInTheDocument();

    const apiArticle = screen
      .getByRole("heading", { name: "Hosted API" })
      .closest("article");
    expect(apiArticle).not.toBeNull();
    expect(within(apiArticle!).getByText("Developer preview")).toBeInTheDocument();
    expect(
      within(apiArticle!).getByText(/Developer preview, not Launched\./),
    ).toBeInTheDocument();
    expect(within(apiArticle!).queryByText("Launched")).not.toBeInTheDocument();
    expect(screen.getByText(/api\.snap_net_income=226\.5/)).toBeInTheDocument();
    expect(screen.getByText(/axiom-api#115/)).toBeInTheDocument();
  });

  it("scopes the SNAP QC row to the six compared values and untested eligibility", () => {
    render(<Page />);

    expect(
      screen.getByText("Colorado SNAP QC benefit replay"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "All 856 match at zero tolerance on the benefit Mathematica computes for USDA from each case record and on five intermediate values: gross income, the standard and excess-shelter deductions, net income, and the maximum allotment. The file keeps only eligible households, so eligibility is untested.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/federal computation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stage by stage/i)).not.toBeInTheDocument();
  });

  it("keeps repo closure separate from acknowledged program incompleteness", () => {
    render(<Page />);

    expect(
      screen.getByRole("heading", {
        name: "Closure: what the repository encodes",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Repo closure is the completeness predicate for the law in a declared root. It is not program closure, and it does not claim that a composed program is complete.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "10 CCR 2506-1" })).toBeInTheDocument();
    expect(screen.getByText("289")).toBeInTheDocument();
    expect(screen.getByText("281")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "7 CFR 273" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "7 USC ch. 51" })).toBeInTheDocument();
    expect(screen.getAllByText("Published debt")).toHaveLength(2);
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("267")).toBeInTheDocument();
    expect(screen.getByText("544")).toBeInTheDocument();
    expect(
      screen.getByText("acknowledged_incomplete: snap_eligible"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the public closure ledger" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/axiom-oracles/tree/main/closure/universes/us-co-snap",
    );
  });
});
