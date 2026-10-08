import type { MetadataRoute } from "next";
import { AXIOM_SITEMAP_CHUNKS } from "@/lib/sitemap-config";
import { SITE_URL } from "@/lib/urls";

/**
 * Open policy — we actively want axiom rule pages to be crawled and
 * indexed so external citations (papers, LLM retrieval, policy tools)
 * can resolve them. The sitemap below enumerates every ingested
 * citation_path.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    // /aspen is a private, password-gated event page.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/aspen", "/api/aspen"] }],
    sitemap: Array.from(
      { length: AXIOM_SITEMAP_CHUNKS },
      (_, id) => `${SITE_URL}/sitemap/${id}.xml`
    ),
  };
}
