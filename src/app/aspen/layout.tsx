import type { Metadata } from "next";

// Private event page: kept out of search and share previews. No openGraph
// block, so nothing here replaces the root layout's card.
export const metadata: Metadata = {
  title: "Aspen convening — Axiom Foundation",
  description: "Private session page for the Aspen Institute State Benefits Leadership Cohort.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AspenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
