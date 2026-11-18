import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The rail's overflow note must quote the query bounds, not copies of them:
// with other bounds the note changes too.
vi.mock("@/lib/axiom/cited-by-limits", () => ({
  MAX_CITED_RULES: 7,
  MAX_CITED_BY_MODULES: 3,
}));

import { EncodingRail } from "./encoding-rail";

function renderOverflow(unit: "rules" | "modules", count = 2) {
  render(
    <EncodingRail
      encoding={null}
      jurisdiction="us"
      citationPath="us/statute/26/32"
      isRepealed={false}
      chunks={[]}
      encodedRules={[{ name: "rule_for_a", kind: "derived", anchors: [] }]}
      outgoing={[]}
      incoming={[]}
      citedByFiles={[]}
      citedByOverflow={count}
      citedByOverflowUnit={unit}
    />,
  );
  return screen.getByTestId("rail-cited-by-overflow").textContent;
}

describe("EncodingRail overflow bounds", () => {
  it("quotes the rule index's bound", () => {
    expect(renderOverflow("rules")).toBe(
      "2 more rules cite this provision. This view shows the first 7 by rank and module path.",
    );
  });

  it("quotes the fallback's bound", () => {
    expect(renderOverflow("modules")).toBe(
      "2 more modules cite this provision. This view shows the first 3 by module path.",
    );
  });
});

// One left out reads in the singular; any other count in the plural.
describe.each([
  { unit: "rules" as const, one: "rule cites", many: "rules cite", tail: "first 7 by rank and module path." },
  { unit: "modules" as const, one: "module cites", many: "modules cite", tail: "first 3 by module path." },
])("EncodingRail overflow note in $unit", ({ unit, one, many, tail }) => {
  it.each([1, 2, 42])("agrees with a count of %i", (count) => {
    expect(renderOverflow(unit, count)).toBe(
      `${count} more ${count === 1 ? one : many} this provision. This view shows the ${tail}`,
    );
  });
});

