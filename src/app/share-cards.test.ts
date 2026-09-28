import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Metadata } from "next";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// The layout's fonts and global stylesheet are build-time concerns
// with nothing to check here.
vi.mock("./globals.css", () => ({}));
vi.mock("next/font/google", () => ({
  JetBrains_Mono: () => ({ variable: "--font-mono", className: "" }),
  Newsreader: () => ({ variable: "--font-serif", className: "" }),
}));
vi.mock("geist/font/sans", () => ({
  GeistSans: { variable: "--font-geist-sans", className: "" },
}));

import { DEFAULT_SHARE_IMAGE, SITE_NAME } from "@/lib/share";
import { expectCompleteShareCard } from "@/test/share-card";
import { metadata as layout } from "./layout";
import { metadata as overview } from "./overview/page";
import { metadata as iariw } from "./events/iariw-2026/page";
import { metadata as receipt } from "./receipt/page";
import { metadata as receiptPaper } from "./receipt/paper/page";
import { metadata as tariffPaper } from "./tariff/paper/page";

// Next merges metadata per top-level key, so a module that sets its own
// openGraph or twitter replaces the root layout's block wholesale and
// silently drops og:url, og:site_name, the brand image or twitter:site.
// This file finds every such module and holds it to the full set:
// static metadata is checked here, and each generateMetadata card must
// have a test beside it that checks its output the same way.

const SRC = join(process.cwd(), "src");

/** Static share cards, checked below. Keys are paths under src/. */
const STATIC_CARDS: Record<string, Metadata> = {
  "app/layout.tsx": layout,
  "app/overview/page.tsx": overview,
  "app/events/iariw-2026/page.tsx": iariw,
  "app/receipt/page.tsx": receipt,
  "app/receipt/paper/page.tsx": receiptPaper,
  "app/tariff/paper/page.tsx": tariffPaper,
};

/** generateMetadata share cards, each mapped to the test that calls
 *  expectCompleteShareCard on its output. Paths are under src/. */
const GENERATED_CARDS: Record<string, string> = {
  "app/axiom/[[...segments]]/page.tsx": "app/axiom/[[...segments]]/share-card.test.ts",
  "app/blog/[slug]/page.tsx": "app/blog/[slug]/blog-post.test.tsx",
};

/** Non-test TypeScript sources under `dir`, as paths under src/. */
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [relative(SRC, path)]
      : [];
  });
}

/** The files among `files` with an object property named `key`,
 *  however it is written: `key: v`, `"key": v` or shorthand `key`. */
function filesSetting(key: string, files: string[]): string[] {
  return files
    .filter((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(SRC, file), "utf8"),
        ts.ScriptTarget.Latest,
        false,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const found = (node: ts.Node): boolean =>
        ((ts.isPropertyAssignment(node) ||
          ts.isShorthandPropertyAssignment(node)) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
          node.name.text === key) ||
        (ts.forEachChild(node, found) ?? false);
      return found(source);
    })
    .sort();
}

/** The public path a route module under src/app serves. */
function routeOf(file: string): string {
  const segments = dirname(file)
    .split("/")
    .slice(1)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

describe("share cards", () => {
  it("registers every module that sets its own openGraph", () => {
    expect(
      filesSetting("openGraph", sources()),
      "Next replaces the root layout's openGraph wholesale when a module sets its own. " +
        "Register the module here: static metadata in STATIC_CARDS, generateMetadata " +
        "in GENERATED_CARDS with a test that calls expectCompleteShareCard.",
    ).toEqual([...Object.keys(STATIC_CARDS), ...Object.keys(GENERATED_CARDS)].sort());
  });

  // Only route modules are scanned: elsewhere a `twitter` key is as
  // likely to be a social handle as metadata.
  it("leaves twitter to the root layout", () => {
    const routeModules = sources(join(SRC, "app")).filter((file) =>
      /\/(page|layout)\.tsx?$/.test(`/${file}`),
    );
    expect(
      filesSetting("twitter", routeModules),
      "A page-level twitter block replaces the root layout's and drops twitter:site. " +
        "Leave twitter out: Next fills twitter:title, :description and :image " +
        "from the page's openGraph.",
    ).toEqual(["app/layout.tsx"]);
    expect(layout.twitter).toEqual({
      site: "@AxiomFdn",
      card: "summary_large_image",
    });
  });

  it("gives the root layout the site-wide defaults", () => {
    expect(layout.openGraph).toMatchObject({
      type: "website",
      url: "./",
      siteName: SITE_NAME,
      images: [DEFAULT_SHARE_IMAGE],
    });
  });

  it.each(Object.entries(GENERATED_CARDS))(
    "checks %s's output in %s",
    (card, test) => {
      expect(dirname(test)).toBe(dirname(card));
      expect(readFileSync(join(SRC, test), "utf8")).toContain(
        "expectCompleteShareCard(",
      );
    },
  );

  it.each(Object.entries(STATIC_CARDS))("%s is complete", (file, metadata) => {
    const dir = join(SRC, dirname(file));
    expectCompleteShareCard(metadata.openGraph, {
      path: file === "app/layout.tsx" ? undefined : routeOf(file),
      imageFromFile: readdirSync(dir).some((name) =>
        /^opengraph-image\.(tsx?|jsx?|png|jpe?g|gif)$/.test(name),
      ),
    });
  });
});
