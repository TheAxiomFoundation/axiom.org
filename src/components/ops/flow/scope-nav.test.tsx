import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScopeNav } from "./scope-nav";

const href = (j: string | null, only = false) => `/ops?j=${j ?? ""}${only ? "&only=1" : ""}`;
const subdivisions = { us: ["us-az", "us-co"] };

/** Each dropdown by its label: the chosen option and every option's label. */
function dropdowns(current: string | null, only = false) {
  const { unmount } = render(<ScopeNav current={current} only={only} options={["us", "dk"]} subdivisions={subdivisions} href={href} />);
  const out = (screen.getAllByRole("combobox") as HTMLSelectElement[]).map((select) => ({
    label: select.getAttribute("aria-label"),
    chosen: select.selectedOptions[0]?.textContent,
    options: [...select.options].map((o) => o.textContent),
  }));
  unmount();
  return out;
}

describe("ScopeNav", () => {
  it("offers All and each root in capitals, and a scope from the address last", () => {
    expect(dropdowns(null)).toEqual([{ label: "Jurisdiction", chosen: "All", options: ["All", "US", "DK"] }]);
    expect(dropdowns("nz")).toEqual([{ label: "Jurisdiction", chosen: "NZ", options: ["All", "US", "DK", "NZ"] }]);
    expect(dropdowns("dk")).toHaveLength(1);
  });

  it("offers a root's subdivisions, and the root alone, once that root is chosen", () => {
    const within = (options: string[], chosen: string) => ({ label: "Within US", chosen, options });
    const us = ["All US", "Federal", "AZ", "CO"];
    expect(dropdowns("us")).toEqual([{ label: "Jurisdiction", chosen: "US", options: ["All", "US", "DK"] }, within(us, "All US")]);
    expect(dropdowns("us", true)[1]).toEqual(within(us, "Federal"));
    expect(dropdowns("us-az")).toEqual([{ label: "Jurisdiction", chosen: "US", options: ["All", "US", "DK"] }, within(us, "AZ")]);
    // A state from the address with no runs listed still shows, last.
    expect(dropdowns("us-tn")[1]).toEqual(within([...us, "TN"], "TN"));
  });

  it("switches in place when the caller can", () => {
    const chosen: Array<[string | null, boolean | undefined]> = [];
    render(<ScopeNav current="us" options={["us", "dk"]} subdivisions={subdivisions} href={href} onSelect={(j, only) => chosen.push([j, only])} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Within US" }), { target: { value: "us|only" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Within US" }), { target: { value: "us-az" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Jurisdiction" }), { target: { value: "" } });
    expect(chosen).toEqual([
      ["us", true],
      ["us-az", false],
      [null, false],
    ]);
  });
});
