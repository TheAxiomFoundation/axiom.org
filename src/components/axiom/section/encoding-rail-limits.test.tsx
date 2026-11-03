import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The rail's overflow note must quote the query bounds, not copies of them:
// with other bounds the note changes too.
vi.mock("@/lib/axiom/cited-by-limits", () => ({
  MAX_CITED_RULES: 7,
  MAX_CITED_BY_MODULES: 3,
}));

import { EncodingRail } from "./encoding-rail";

function renderOverflow(unit: "rules" | "modules") {
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
      citedByOverflow={2}
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
