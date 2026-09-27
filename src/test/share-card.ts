import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { expect } from "vitest";
import { SITE_NAME } from "@/lib/share";
import { SITE_URL } from "@/lib/urls";

// Pages may hard-code the production origin (the IARIW card does), so
// it counts as local whatever NEXT_PUBLIC_SITE_URL says.
const LOCAL_ORIGINS = new Set([new URL(SITE_URL).origin, "https://axiom.org"]);

/**
 * Asserts a page-level openGraph is complete. Next replaces the root
 * layout's openGraph wholesale when a page sets its own, so the page
 * must restate what the layout's would have supplied: og:type, og:url,
 * og:site_name and an image.
 *
 * - `path`: the route the card belongs to; og:url must be "./" or
 *   resolve to it.
 * - `imageFromFile`: the page's directory has an opengraph-image file.
 *   Next applies it only while the block has no images key, so the
 *   block must leave images out.
 *
 * Images on this site must be files under public/; images hosted
 * elsewhere (a blog post's Ghost cover) are accepted as they are.
 */
export function expectCompleteShareCard(
  openGraph: Metadata["openGraph"],
  { path, imageFromFile = false }: { path?: string; imageFromFile?: boolean } = {},
) {
  const og = (openGraph ?? {}) as Record<string, unknown>;
  expect(["website", "article"], "og:type").toContain(og.type);
  expect(og.siteName, "og:site_name").toBe(SITE_NAME);
  expect(og.url, "og:url").toBeTruthy();
  if (path && og.url !== "./") {
    expect(new URL(String(og.url), SITE_URL).pathname, "og:url").toBe(path);
  }

  if (imageFromFile) {
    expect(
      og,
      "an images key would take precedence over the sibling opengraph-image",
    ).not.toHaveProperty("images");
    return;
  }
  const images = [og.images].flat().filter(Boolean) as (
    | string
    | URL
    | { url: string | URL }
  )[];
  expect(images.length, "og:image").toBeGreaterThan(0);
  for (const image of images) {
    const url = new URL(
      String(typeof image === "object" && "url" in image ? image.url : image),
      SITE_URL,
    );
    if (LOCAL_ORIGINS.has(url.origin)) {
      expect(
        existsSync(join(process.cwd(), "public", url.pathname)),
        `og:image ${url.pathname} is not a file under public/`,
      ).toBe(true);
    }
  }
}
