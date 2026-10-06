import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BundleStrip } from "./bundle-strip";
import type { TierCounts } from "@/lib/axiom/program-bundles";

const counts = (overrides: Partial<TierCounts>): TierCounts => ({
  documents: 0,
  excluded: 0,
  byStatus: { complete: 0, unvalidated: 0, partly: 0, not_started: 0, not_in_corpus: 0 },
  provisions: 0,
  byProvisionState: { encoded: 0, unvalidated: 0, partly: 0, deferred: 0, in_progress: 0, failed: 0, not_started: 0 },
  units: 0,
  byUnitState: {
    encoded: 0,
    unvalidated: 0,
    partly: 0,
    deferred: 0,
    in_progress: 0,
    failed: 0,
    not_encoded: 0,
    not_in_corpus: 0,
  },
  ...overrides,
});

describe("BundleStrip", () => {
  it("links each bundle to its page with each tier's encoded share and complete documents", () => {
    render(
      <BundleStrip
        bundles={[
          {
            id: "us-az/snap",
            title: "Arizona SNAP",
            tiers: [
              {
                id: "screener",
                title: "Screener-level parity",
                counts: counts({
                  documents: 57,
                  byStatus: { complete: 0, unvalidated: 1, partly: 22, not_started: 15, not_in_corpus: 19 },
                  provisions: 156,
                  byProvisionState: { encoded: 13, unvalidated: 27, partly: 21, deferred: 24, in_progress: 0, failed: 0, not_started: 52 },
                }),
              },
              {
                id: "full",
                title: "Full document bundle",
                counts: counts({
                  documents: 183,
                  byStatus: { complete: 2, unvalidated: 2, partly: 29, not_started: 98, not_in_corpus: 52 },
                  provisions: 1271,
                  byProvisionState: { encoded: 55, unvalidated: 15, partly: 19, deferred: 111, in_progress: 10, failed: 2, not_started: 1059 },
                }),
              },
            ],
          },
        ]}
      />
    );
    const link = screen.getByRole("link", { name: /Arizona SNAP/ });
    expect(link).toHaveAttribute("href", "/ops/bundles/us-az/snap");
    expect(link).toHaveTextContent("40 of 156 cited provisions encoded26%1 of 57 documents complete");
    expect(link).toHaveTextContent("70 of 1,271 provisions encoded6%4 of 183 documents complete");
  });

  it("shows nothing without bundles", () => {
    const { container } = render(<BundleStrip bundles={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
