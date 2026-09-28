"use client";

import { GuidedTour, type TourStep } from "./guided-tour";

/** The subtree the launcher tour's closing CTA opens — the EITC
 *  (26 USC § 32), the corpus's most recognizable program. Opening it
 *  hands the visitor straight to the subgraph tour. */
export const TOUR_EXAMPLE_TARGET = "us:statutes/26/32";

/** Three beats, launcher-screen only: what this place is, how to find
 *  a provision, what opening one gets you. Deep links skip the
 *  launcher, so the tour simply waits for a visit that shows it. On
 *  the last step the field glides to the EITC and pins its label —
 *  presented, not opened — and the CTA does the opening. */
function launcherSteps(
  onOpenExample?: () => void,
  onSpotlightExample?: (on: boolean) => void
): TourStep[] {
  return [
    {
      title: "Explore encoded law",
      description:
        "Search or browse provisions to open a rule workspace. Switch to Field for a map of the corpus.",
    },
    {
      element: '[data-testid="launcher-controls"]',
      title: "Find a provision",
      description:
        "Search here to find any encoded provision, or switch views: the Field to see the open map, the List to browse by jurisdiction.",
      // Leaving this step starts the camera's glide to the example —
      // its landing anchor must exist before the next step resolves.
      onLeave: onSpotlightExample
        ? () => onSpotlightExample(true)
        : undefined,
    },
    {
      // Anchored to the field's spotlight mark: the overlay cuts its
      // hole around the EITC while the rest of the field dims.
      element: onSpotlightExample
        ? '[data-testid="field-spotlight"]'
        : undefined,
      // Deferred only when there IS an anchor to wait for — an
      // element-less step must not carry a wait.
      deferred: onSpotlightExample ? true : undefined,
      title: "Open a law, then run it",
      description:
        "Open any subtree to inspect how its rules relate, read the law at each node, and run scenarios with your own answers.",
      onEnter: onSpotlightExample
        ? () => onSpotlightExample(true)
        : undefined,
      action: onOpenExample
        ? {
            label: "Open the EITC subtree →",
            onClick: onOpenExample,
          }
        : undefined,
    },
  ];
}

/** Once per session, the first time a subgraph opens: the canvas is
 *  the navigation, the inspector walks it, the run toggle executes
 *  it, Overview is the way back. Inspector steps only appear when a
 *  node is inspected (compose focus opens one); the run toggle waits
 *  on the graph fetch and the tour waits with it. */
function subgraphSteps(
  onCloseLaw?: () => void,
  onCloseRunPanel?: () => void,
): TourStep[] {
  // Overlays opened along the way (the law popup, the run sheet)
  // must never sit over a later step's target and swallow its
  // clicks — entering any step closes what that step doesn't own.
  const closeAll = () => {
    onCloseLaw?.();
    onCloseRunPanel?.();
  };
  return [
    {
      title: "This is the law, as a graph",
      description:
        "Every node is a concept from the law. Click one to see how it's defined, what it depends on, and the statute text behind it.",
      onEnter: closeAll,
    },
    {
      element: '[data-tour="mini-graph"]',
      title: "Concept dependencies",
      description:
        "See what the selected rule is built from and what uses it. Click any neighbor to move through the graph.",
      onEnter: closeAll,
    },
    {
      element: '[data-testid="read-the-law"]',
      title: "Read the law",
      description:
        "Click here to read the section of law behind this node — without leaving the graph.",
      onEnter: onCloseRunPanel,
      // The button sits at the bottom of the inspector's scrollbox —
      // reveal it there so driver doesn't scroll the whole document.
      // Optional call: jsdom has no scrollIntoView.
      prepare: () =>
        document
          .querySelector('[data-testid="read-the-law"]')
          ?.scrollIntoView?.({ block: "nearest" }),
      // Clicking the highlighted button opens the law popup ON TOP
      // of the spotlit button — if it's open, the popup itself is
      // what deserves the spotlight.
      resolveElement: () =>
        document.querySelector(".law-popup")
          ? ".law-popup"
          : '[data-testid="read-the-law"]',
    },
    {
      element: '[data-tour="run-scenario"]',
      title: "Run a scenario",
      description:
        "Answer a household's questions to execute the law — every result traces back through the graph. Unanswered questions use the program's defaults.",
      onEnter: onCloseLaw,
      // No modal-spotlight here (unlike the law popup): opening the
      // run sheet means the visitor is DOING the thing — the viewer
      // ends the tour instead of floating a card over the sheet.
    },
    {
      element: '[data-testid="back-to-overview"]',
      title: "Back to the overview",
      description:
        "Return to the field any time to pick another provision.",
      onEnter: closeAll,
    },
  ];
}

/**
 * The Plane's tours, staged by what's on screen: the launcher gets
 * the welcome tour (once per browser), an open subgraph gets its own
 * (once per session). One mount, so the replay "?" always replays
 * the tour for the view you're in.
 */
export function PlaneTour({
  stage,
  onOpenExample,
  onSpotlightExample,
  onCloseLawPopup,
  onCloseRunPanel,
}: {
  stage: "launcher" | "subgraph";
  /** Opens the example subtree (TOUR_EXAMPLE_TARGET) in compose
   *  mode — the launcher tour's closing CTA. Omit if the example
   *  isn't in the corpus. */
  onOpenExample?: () => void;
  /** Points the corpus field's camera at the example subtree (true)
   *  or releases it (false) — the closing step's presentation. */
  onSpotlightExample?: (on: boolean) => void;
  /** Closes the law popup — stepping through the subgraph tour must
   *  never leave the modal covering the next step's target. */
  onCloseLawPopup?: () => void;
  /** Same for the run sheet. */
  onCloseRunPanel?: () => void;
}) {
  return stage === "subgraph" ? (
    // No onEnd cleanup: someone who opens the law or the run sheet
    // during its step and then exits the tour means to keep using it.
    <GuidedTour
      surface="subgraph"
      steps={subgraphSteps(onCloseLawPopup, onCloseRunPanel)}
    />
  ) : (
    <GuidedTour
      surface="graph"
      steps={launcherSteps(onOpenExample, onSpotlightExample)}
      onEnd={onSpotlightExample ? () => onSpotlightExample(false) : undefined}
    />
  );
}
