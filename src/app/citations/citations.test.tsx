import { existsSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CitationsPage from "./page";
import {
  CITATIONS,
  formatCitationDate,
  groupedCitations,
  sortedCitations,
  type Citation,
} from "@/lib/citations";

type Plain = { children: React.ReactNode; className?: string };
vi.mock("@/components/landing/reveal", () => ({
  Reveal: ({ children, className }: Plain) => (
    <div className={className}>{children}</div>
  ),
  RevealGroup: ({ children, className }: Plain) => (
    <div className={className}>{children}</div>
  ),
  RevealItem: ({ children, className }: Plain) => (
    <div className={className}>{children}</div>
  ),
}));

const SAMPLE: Citation[] = [
  {
    id: "older-paper",
    kind: "paper",
    title: "An older paper",
    by: "Someone",
    date: "2025-11",
    href: "https://example.org/older",
    summary: "Cites the corpus.",
    source: "A journal",
    image: { src: "/citations/older.jpg", width: 1200, height: 630, alt: "" },
  },
  {
    id: "newer-product",
    kind: "product",
    title: "A newer product",
    by: "A company",
    date: "2026-07-09",
    href: "https://example.org/newer",
    summary: "Runs the engine.",
    source: "A company site",
    image: { src: "/citations/newer.jpg", width: 1200, height: 630, alt: "" },
  },
  {
    id: "newer-paper",
    kind: "paper",
    title: "A newer paper",
    by: "Someone else",
    date: "2026-03",
    href: "https://example.org/newer-paper",
    summary: "Cites the encodings.",
    source: "Another journal",
    image: { src: "/citations/newer-paper.jpg", width: 1200, height: 630, alt: "" },
  },
];

describe("citations data", () => {
  it("every curated entry links somewhere, carries a date, and ships its preview image", () => {
    for (const entry of CITATIONS) {
      expect(entry.href).toMatch(/^https:\/\//);
      expect(entry.date).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(entry.summary.length).toBeGreaterThan(20);
      expect(entry.image.src).toMatch(/^\/citations\/.+\.(jpg|png)$/);
      expect(existsSync(join(process.cwd(), "public", entry.image.src))).toBe(true);
    }
  });

  it("sorts newest first", () => {
    expect(sortedCitations(SAMPLE).map((c) => c.id)).toEqual([
      "newer-product",
      "newer-paper",
      "older-paper",
    ]);
  });

  it("groups in display order and drops empty kinds", () => {
    const groups = groupedCitations(SAMPLE);
    expect(groups.map((g) => g.label)).toEqual(["Papers", "Products & tools"]);
    expect(groups[0]!.entries.map((c) => c.id)).toEqual([
      "newer-paper",
      "older-paper",
    ]);
  });

  it("formats month-only and full dates", () => {
    expect(formatCitationDate("2026-07")).toBe("July 2026");
    expect(formatCitationDate("2026-07-09")).toBe("9 July 2026");
  });
});

describe("CitationsPage", () => {
  it("renders the header and every curated entry with its link", () => {
    render(<CitationsPage />);
    expect(
      screen.getByRole("heading", { name: "Who cites Axiom" })
    ).toBeInTheDocument();
    for (const entry of CITATIONS) {
      expect(screen.getByText(entry.title)).toBeInTheDocument();
      const card = screen.getByText(entry.title).closest(".citation-card");
      const links = card?.querySelectorAll("a") ?? [];
      // The preview image and the "Read the piece" line both open the
      // reference; every outbound link is rel=noopener.
      expect(links.length).toBe(2);
      for (const link of links) {
        expect(link).toHaveAttribute("href", entry.href);
        expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      }
      expect(card?.querySelector("img")).toHaveAttribute("alt", entry.image.alt);
    }
  });
});
