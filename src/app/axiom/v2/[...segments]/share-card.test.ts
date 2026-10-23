import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rule } from "@/lib/supabase";

vi.mock("@/lib/axiom/section-page", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/axiom/section-page")>()),
  resolveSection: vi.fn(),
}));

import { resolveSection, type SectionResolution } from "@/lib/axiom/section-page";
import { expectCompleteShareCard } from "@/test/share-card";
import { generateMetadata } from "./page";

const SECTION = {
  id: "r1",
  citation_path: "us/statute/26/32",
  heading: "Earned income",
  body: "There shall be allowed a credit...",
  jurisdiction: "us",
  doc_type: "statute",
} as Rule;

// The reader resolved the request to its section (the ancestor fallback
// for a suffix the corpus doesn't have), so every URL the card carries
// is the section's, whatever the request said.
const RESOLUTION = {
  root: SECTION,
  citationPath: "us/statute/26/32",
  requestedPath: "us/statute/26/32/<b>",
  focusAnchor: null,
} as unknown as SectionResolution;

describe("v2 reader share card", () => {
  beforeEach(() => {
    vi.mocked(resolveSection).mockReset().mockResolvedValue(RESOLUTION);
  });

  it("points og:url and the canonical at the resolved section, not the request", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({
        segments: ["us", "statute", "26", "32", "%3Cb%3E"],
      }),
    });
    expect(resolveSection).toHaveBeenCalledWith(["us", "statute", "26", "32", "<b>"]);
    expect(meta.title).toBe("us/statute/26/32 — Earned income · Axiom");
    expect(meta.openGraph).toEqual({
      title: "us/statute/26/32 — Earned income · Axiom",
      description: "There shall be allowed a credit...",
      url: "https://axiom.org/us/statute/26/32",
      type: "article",
      siteName: "Axiom Foundation",
      images: ["/og-image.png"],
    });
    expectCompleteShareCard(meta.openGraph, { path: "/us/statute/26/32" });
    expect(meta.alternates).toEqual({ canonical: "https://axiom.org/us/statute/26/32" });
    expect(meta).not.toHaveProperty("twitter");
  });

  it("keeps the requested path, encoded, when nothing resolves", async () => {
    vi.mocked(resolveSection).mockResolvedValue(null);
    const meta = await generateMetadata({
      params: Promise.resolve({ segments: ["us", "statute", "99", "%3Cb%3E"] }),
    });
    expect(meta.alternates).toEqual({
      canonical: "https://axiom.org/us/statute/99/%3Cb%3E",
    });
    expectCompleteShareCard(meta.openGraph, { path: "/us/statute/99/%3Cb%3E" });
  });

  it("leaves browse depth on the root layout's card", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ segments: ["us", "statute", "26"] }),
    });
    expect(meta).not.toHaveProperty("openGraph");
    expect(resolveSection).not.toHaveBeenCalled();
  });
});
