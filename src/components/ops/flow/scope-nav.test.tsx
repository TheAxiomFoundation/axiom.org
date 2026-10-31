import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScopeNav } from "./scope-nav";

describe("ScopeNav", () => {
  it("links All and each root, marks the current one, and shows a scope from the address last", () => {
    render(<ScopeNav current="nz" options={["us", "dk"]} href={(j) => `/ops?j=${j ?? ""}`} />);
    const nav = screen.getByRole("navigation", { name: "Jurisdiction" });
    expect([...nav.children].map((c) => [c.textContent, c.getAttribute("href"), c.getAttribute("aria-current")])).toEqual([
      ["All", "/ops?j=", null],
      ["us", "/ops?j=us", null],
      ["dk", "/ops?j=dk", null],
      ["nz", null, "page"],
    ]);
  });
});
