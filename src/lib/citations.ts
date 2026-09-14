/**
 * Who cites Axiom — the curated list behind /citations.
 *
 * Every entry is a real, checkable reference: an article, paper,
 * report, or product that discusses or builds on Axiom. Each carries
 * the link where the reference appears and a preview image saved
 * under public/citations (a copy, not a hotlink — the source's card
 * image can change or vanish). The page sorts newest first and
 * groups by kind.
 */

export type CitationKind = "article" | "paper" | "report" | "product";

export interface Citation {
  /** Stable id, used as the React key. */
  id: string;
  kind: CitationKind;
  /** The piece's own title, verbatim. */
  title: string;
  /** Who wrote or made it. */
  by: string;
  /** The publication or venue it appears in. */
  source: string;
  /** ISO date of publication (YYYY-MM or YYYY-MM-DD). */
  date: string;
  /** Where the reference appears. */
  href: string;
  /** What it says about Axiom, in a sentence or two, neutral. */
  summary: string;
  /** Preview image, served from public/. */
  image: { src: string; width: number; height: number; alt: string };
}

export const CITATION_KIND_LABELS: Record<CitationKind, string> = {
  article: "Articles & newsletters",
  paper: "Papers",
  report: "Reports",
  product: "Products & tools",
};

/** Display order of the groups on the page. */
export const CITATION_KIND_ORDER: CitationKind[] = [
  "paper",
  "report",
  "article",
  "product",
];

export const CITATIONS: Citation[] = [
  {
    id: "markhor-2026-09-axiom-foundation",
    kind: "article",
    title: "Tax and Benefit Rules in the AI Era: A Look at Axiom Foundation",
    by: "Markhor Corp.",
    source: "markhor.jp",
    date: "2026-09-07",
    href: "https://markhor.jp/2026/09/07/tax-and-benefit-rules-in-the-ai-era-a-look-at-axiom-foundation/",
    summary:
      "A look at the foundation's launch: open, machine-readable encodings of tax and benefit rules tied back to statutes, regulations, and guidance, encoded at scale with AI and validated against external implementations and government datasets — shared infrastructure rather than a replacement for tools like OpenFisca.",
    image: {
      src: "/citations/markhor-axiom-foundation-2026-09.jpg",
      width: 1200,
      height: 618,
      alt: "Markhor Corp. article card: Tax and Benefit Rules in the AI Era",
    },
  },
  {
    id: "things-that-caught-my-attention-s21e19",
    kind: "article",
    title:
      "Artificially intelligent pragmatism; Your subjective experience is generative; The Profane Town Crier",
    by: "Dan Hon",
    source: "Things That Caught My Attention, s21e19",
    date: "2026-08-12",
    href: "https://thingsthatcaughtmyattention.com/e/s21e19-artificially-intelligent-pragmatism-your",
    summary:
      "Opens with the foundation's launch and its premise — every tax and benefit system re-implements the same rules, so encode them once, openly — and why the PolicyEngine and PolicyBench lineage makes that credible.",
    image: {
      src: "/citations/things-that-caught-my-attention-s21e19.jpg",
      width: 1200,
      height: 630,
      alt: "Things That Caught My Attention, issue s21e19 card",
    },
  },
];

/** Entries newest first. */
export function sortedCitations(entries: Citation[] = CITATIONS): Citation[] {
  return entries
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

/** Entries grouped in display order; kinds with no entries are omitted. */
export function groupedCitations(
  entries: Citation[] = CITATIONS
): Array<{ kind: CitationKind; label: string; entries: Citation[] }> {
  const sorted = sortedCitations(entries);
  return CITATION_KIND_ORDER.map((kind) => ({
    kind,
    label: CITATION_KIND_LABELS[kind],
    entries: sorted.filter((c) => c.kind === kind),
  })).filter((group) => group.entries.length > 0);
}

/** "2026-07" → "July 2026"; "2026-07-09" → "9 July 2026". */
export function formatCitationDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const month = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleString(
    "en-GB",
    { month: "long", timeZone: "UTC" }
  );
  return d ? `${d} ${month} ${y}` : `${month} ${y}`;
}
