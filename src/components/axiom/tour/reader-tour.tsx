"use client";

import { GuidedTour, type TourStep } from "./guided-tour";

/** Four beats through the reading surface, in the order the eye
 *  meets them: where you are, how to move, what you can do, what the
 *  machine knows. Anchors that a given page lacks (no TOC below xl,
 *  no rail without encodings) drop out automatically. */
const READER_TOUR_STEPS: TourStep[] = [
  {
    element: '[data-tour="breadcrumbs"]',
    title: "You are inside a citation",
    description:
      "Click any level of the path to jump there — it mirrors the citation, from the jurisdiction down to this section.",
  },
  {
    element: '[data-testid="section-toc"]',
    title: "Move within the section",
    description:
      "Use the contents rail to jump to any subsection — it follows along as you scroll.",
  },
  {
    element: '[data-testid="action-strip"]',
    title: "Do things with this law",
    description:
      "Open the section as an executable graph, build a calculator on it, or copy an exact citation.",
  },
  {
    element: '[data-testid="rail-header"]',
    title: "The encoding rail",
    description:
      "Open the rail's entries to see the machine-readable encodings behind this section — and everything it cites or is cited by.",
  },
];

export function ReaderTour() {
  return <GuidedTour surface="reader" steps={READER_TOUR_STEPS} />;
}
