import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/axiom/metadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/axiom/metadata")>()),
  getAxiomRuleMetadata: vi.fn(),
}));

import { getAxiomRuleMetadata } from "@/lib/axiom/metadata";
import { expectCompleteShareCard } from "@/test/share-card";
import { generateMetadata } from "./page";

const META = {
  rule: null,
  title: "ca/statute/example/1 — Example rule · Axiom",
  description: "Example rule description.",
  canonicalUrl: "https://axiom.org/ca/statute/example/1",
  citationPath: "ca/statute/example/1",
  jurisdiction: "ca",
  docType: "statute",
};

// The v1 catch-all still serves /ca/* (the proxy's V1_ONLY_JURISDICTIONS)
// and /search/<x>. Its openGraph replaces the root layout's wholesale, so
// it restates the brand card; before, those pages shared a large card
// with no image.
describe("v1 rule page share card", () => {
  beforeEach(() => {
    vi.mocked(getAxiomRuleMetadata).mockResolvedValue(META);
  });

  it("sets a complete article openGraph with the brand card", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({
        segments: ["ca", "statute", "example", "1"],
      }),
    });
    expect(meta.openGraph).toEqual({
      title: META.title,
      description: META.description,
      url: META.canonicalUrl,
      type: "article",
      siteName: "Axiom Foundation",
      images: ["/og-image.png"],
    });
    expectCompleteShareCard(meta.openGraph, { path: "/ca/statute/example/1" });
    expect(meta.alternates).toEqual({ canonical: META.canonicalUrl });
  });

  // A page-level twitter block drops the layout's twitter:site; Next
  // fills twitter:title, :description and :image from the openGraph.
  it("leaves twitter to the root layout", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ segments: ["ca"] }),
    });
    expect(meta).not.toHaveProperty("twitter");
  });
});
