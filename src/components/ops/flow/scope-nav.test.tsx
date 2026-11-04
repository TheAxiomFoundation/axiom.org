import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScopeNav } from "./scope-nav";

describe("ScopeNav", () => {
  it("links All and each root in capitals, marks the current one, and shows a scope from the address last", () => {
    render(<ScopeNav current="nz" options={["us", "dk"]} href={(j) => `/ops?j=${j ?? ""}`} />);
    const nav = screen.getByRole("navigation", { name: "Jurisdiction" });
    expect([...nav.children].map((c) => [c.textContent, c.getAttribute("href"), c.getAttribute("aria-current")])).toEqual([
      ["All", "/ops?j=", null],
      ["US", "/ops?j=us", null],
      ["DK", "/ops?j=dk", null],
      ["NZ", null, "page"],
    ]);
  });

  it("offers a root's subdivisions in a second row only once that root is chosen", () => {
    const subdivisions = { us: ["us-az", "us-co"] };
    const href = (j: string | null) => `/ops?j=${j ?? ""}`;
    const rows = (current: string | null) => {
      const { unmount } = render(<ScopeNav current={current} options={["us", "dk"]} subdivisions={subdivisions} href={href} />);
      const navs = screen.getAllByRole("navigation").map((nav) => [nav.getAttribute("aria-label"), [...nav.children].map((c) => [c.textContent, c.getAttribute("aria-current")])]);
      unmount();
      return navs;
    };
    // All or another root: one row, no states.
    expect(rows(null)).toHaveLength(1);
    expect(rows("dk")).toHaveLength(1);
    // US: a second row, US itself current.
    expect(rows("us")).toEqual([
      ["Jurisdiction", [["All", null], ["US", "page"], ["DK", null]]],
      ["Within US", [["All US", "page"], ["AZ", null], ["CO", null]]],
    ]);
    // A state: US stays marked and links back to all of the US.
    expect(rows("us-az")).toEqual([
      ["Jurisdiction", [["All", null], ["US", "true"], ["DK", null]]],
      ["Within US", [["All US", null], ["AZ", "page"], ["CO", null]]],
    ]);
    // A state from the address with no runs listed still shows, last.
    expect(rows("us-tn")[1]).toEqual(["Within US", [["All US", null], ["AZ", null], ["CO", null], ["TN", "page"]]]);
  });
});
