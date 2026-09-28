import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import TariffPaperPage, {
  PAPER_VERSION,
  PINNED_PDF_SHA256,
  metadata,
} from "./page";

describe("tariff paper wrapper", () => {
  it("renders header, actions, and the sandboxed embed", () => {
    render(<TariffPaperPage />);
    expect(screen.getByText("Working paper")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /Executable tariff law/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Revision 3 · 2026-08-25 · Max Ghenis/),
    ).toBeInTheDocument();
    const iframe = screen.getByTitle(/manuscript/);
    expect(iframe).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    expect(screen.getByText("Live schedule browser")).toHaveAttribute(
      "href",
      "/tariff/schedule",
    );
  });

  it("keeps the exact version param on every manuscript URL, discovered dynamically", () => {
    const { container } = render(<TariffPaperPage />);
    const urls = [
      ...[...container.querySelectorAll("a[href]")].map((a) =>
        a.getAttribute("href"),
      ),
      ...[...container.querySelectorAll("iframe[src]")].map((f) =>
        f.getAttribute("src"),
      ),
    ].filter((url): url is string => Boolean(url));
    const manuscriptUrls = urls.filter((url) =>
      url.includes("/tariff/paper/web/"),
    );
    // The wrapper must actually reference the render (iframe + at
    // least the two action links + the footer link).
    expect(manuscriptUrls.length).toBeGreaterThanOrEqual(4);
    for (const url of manuscriptUrls) {
      // Root-absolute, never cross-origin: the route has no trailing
      // slash, so relative URLs would resolve against /tariff/.
      expect(url).toMatch(/^\/tariff\/paper\/web\//);
      const params = new URL(url, "https://axiom.org").searchParams;
      expect(params.getAll("v")).toEqual([PAPER_VERSION]);
    }
  });

  it("embeds a committed render whose internal PDF link is the synced copy", () => {
    const html = readFileSync(
      join(process.cwd(), "public/tariff/paper/web/index.html"),
      "utf8",
    );
    expect(html).toContain('href="index.pdf"');
    expect(html).not.toContain('href="paper.pdf"');
    expect(html).toContain("Max Ghenis");
    expect(html).not.toContain("wire into sections");
    expect(html).not.toContain("Companion-paper authors");
    expect(html).not.toContain("hold no certificate");
    expect(html).toContain("its verdict is no");
    // The axiom-html format's status box — vanilla renders drop it and
    // leave the manuscript's status-note reference dangling.
    expect(html).toContain("axiom-status");
    expect(html).toContain("burndown named");
    expect(html).toContain("github.com/PolicyEngine/tariff-paper");
  });

  it("resolves every local asset the committed render references", () => {
    const webRoot = join(process.cwd(), "public/tariff/paper/web");
    const html = readFileSync(join(webRoot, "index.html"), "utf8");
    const refs = [
      ...html.matchAll(/(?:src|href)="(?!https?|#|mailto|data:)([^"]+)"/g),
    ].map((m) => m[1].split("?")[0]);
    expect(refs.length).toBeGreaterThanOrEqual(10);
    for (const ref of refs) {
      expect(existsSync(join(webRoot, ref)), `missing asset: ${ref}`).toBe(
        true,
      );
    }
    // The axiom-html font bundle in particular — a vanilla sync once
    // shipped a render that 404ed its own stylesheet.
    expect(existsSync(join(webRoot, "_extensions/axiom/fonts.css"))).toBe(true);
  });

  it("keeps the wrapper pill and the embedded title block on the same revision and date", () => {
    const html = readFileSync(
      join(process.cwd(), "public/tariff/paper/web/index.html"),
      "utf8",
    );
    render(<TariffPaperPage />);
    const pill =
      screen.getByText(/Revision \d+ · \d{4}-\d{2}-\d{2}/).textContent ?? "";
    const [, rev, date] =
      pill.match(/Revision (\d+) · (\d{4}-\d{2}-\d{2})/) ?? [];
    expect(rev).toBeTruthy();
    // Scoped to the rendered title block — the loose full-document
    // search once passed off the metadata date while the visible
    // revision line disagreed.
    const revisionBlock =
      html.match(/class="axiom-revision"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(revisionBlock).toContain(`Revision ${rev}`);
    expect(revisionBlock).toContain(date);
  });

  it("ships the pinned PDF render, not a stale blob", () => {
    // PINNED_PDF_SHA256 lives beside PAPER_VERSION in page.tsx so the
    // pair is bumped as one tuple (pin of tariff-rules-paper@1dc3481
    // build/paper.pdf). A forgotten PDF copy fails closed here; r3b
    // shipped a stale blob precisely because nothing checked this.
    const pdf = readFileSync(
      join(process.cwd(), "public/tariff/paper/web/index.pdf"),
    );
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(
      PINNED_PDF_SHA256,
    );
  });

  // The page's openGraph replaces the root layout's wholesale; before it
  // named an image, shares rendered a large card with no image.
  // og:description falls back to the page description.
  it("sets a complete article openGraph with the brand card", () => {
    expect(metadata.openGraph).toEqual({
      type: "article",
      title: "Executable tariff law — working paper",
      url: "https://axiom.org/tariff/paper",
      siteName: "Axiom Foundation",
      images: ["/og-image.png"],
    });
    expect(metadata).not.toHaveProperty("twitter");
  });
});
