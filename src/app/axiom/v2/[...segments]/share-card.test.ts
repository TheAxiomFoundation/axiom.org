import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/axiom/metadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/axiom/metadata")>()),
  getAxiomRuleMetadata: vi.fn(),
}));

import { getAxiomRuleMetadata } from "@/lib/axiom/metadata";
import { expectCompleteShareCard } from "@/test/share-card";
import { generateMetadata } from "./page";

// The metadata resolved the request to its section, so every URL the
// card carries is the section's, whatever suffix the request had.
const META = {
  rule: null,
  title: "us/statute/26/32 — Earned income · Axiom",
  description: "There shall be allowed a credit...",
  canonicalUrl: "https://axiom.org/us/statute/26/32",
  citationPath: "us/statute/26/32/%3Cb%3E",
  jurisdiction: "us",
  docType: "statute",
};

describe("v2 reader share card", () => {
  beforeEach(() => {
    vi.mocked(getAxiomRuleMetadata).mockClear().mockResolvedValue(META);
  });

  it("points og:url and the canonical at the resolved section, not the request", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({
        segments: ["us", "statute", "26", "32", "%3Cb%3E"],
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
    expectCompleteShareCard(meta.openGraph, { path: "/us/statute/26/32" });
    expect(meta.alternates).toEqual({ canonical: META.canonicalUrl });
    expect(meta).not.toHaveProperty("twitter");
  });

  it("leaves browse depth on the root layout's card", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ segments: ["us", "statute", "26"] }),
    });
    expect(meta).not.toHaveProperty("openGraph");
    expect(getAxiomRuleMetadata).not.toHaveBeenCalled();
  });
});
