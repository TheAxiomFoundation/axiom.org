"use client";

import { useCallback, useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./tour.css";
import {
  hasSeenTour,
  markTourSeen,
  type TourSurface,
} from "./tour-state";
import { trackAxiomEvent } from "@/lib/analytics";

export type TourStep = {
  /** CSS selector to spotlight; omit for a centered, un-anchored step. */
  element?: string;
  title: string;
  description: string;
  /** Runs before the step highlights — e.g. scroll a panel's inner
   *  scrollbox so the anchor is in view and driver never scrolls the
   *  document (which would drag the footer into a full-viewport app). */
  prepare?: () => void;
  /** Optional call-to-action rendered as a block button under the
   *  description. Clicking it completes the tour, then runs the
   *  handler — e.g. "Open the EITC" at the end of the launcher tour,
   *  which hands off to the subgraph tour. */
  action?: { label: string; onClick: () => void };
  /** Runs when the step is highlighted (not upfront like `prepare`) —
   *  e.g. asking the corpus field to zoom to the example subtree. */
  onEnter?: () => void;
  /** Highlight-time selector override, re-evaluated each time the
   *  step highlights — for anchors whose best target changes with
   *  app state (the law popup swallowing its own trigger). Falls
   *  back to `element` when it resolves to nothing. */
  resolveElement?: () => string;
  /** Runs when Next is clicked on this step, before advancing — the
   *  place to conjure what the NEXT step anchors to (driver resolves
   *  the next anchor before any deselect hook would fire). */
  onLeave?: () => void;
  /** The anchor element appears mid-tour (a prior step's onLeave
   *  conjures it): skip the present-at-start checks and let driver
   *  wait for it at highlight time. */
  deferred?: boolean;
};

/** How long to wait for the first anchored element — the Plane's DOM
 *  appears well after mount (ssr:false + corpus fetch). */
const ANCHOR_WAIT_MS = 8000;
const ANCHOR_POLL_MS = 250;

function stepVisible(selector: string): boolean {
  const el = document.querySelector(selector);
  return !!el && el.getClientRects().length > 0;
}

/**
 * One-time guided tour for a surface, plus its replay affordance (a
 * quiet "?" pinned bottom-left). Auto-runs on first visit only —
 * never inside the embed iframe, never on small screens — and steps
 * whose anchor is absent or hidden are dropped rather than shown
 * floating in space.
 */
export function GuidedTour({
  surface,
  steps,
  onEnd,
}: {
  surface: TourSurface;
  steps: TourStep[];
  /** Runs when the tour tears down, however it ends — undoes anything
   *  a step's onEnter set in motion (e.g. the field spotlight). */
  onEnd?: () => void;
}) {
  const activeRef = useRef<ReturnType<typeof driver> | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const start = useCallback(
    (replayed: boolean) => {
      if (activeRef.current?.isActive()) return;
      const present = stepsRef.current.filter(
        (step) => !step.element || step.deferred || stepVisible(step.element)
      );
      // A tour of only floating popovers means the page lost every
      // anchor — nothing useful to point at.
      if (!present.some((step) => step.element)) return;
      let completed = false;
      const tour = driver({
        popoverClass: "axiom-tour",
        showProgress: present.length > 1,
        progressText: "{{current}} / {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        animate: !window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
        steps: present.map((step) => ({
          element: step.resolveElement
            ? () =>
                (document.querySelector(step.resolveElement!()) ??
                  (step.element
                    ? document.querySelector(step.element)
                    : null)) as Element
            : step.element,
          onHighlightStarted:
            step.prepare || step.onEnter
              ? () => {
                  step.prepare?.();
                  step.onEnter?.();
                }
              : undefined,
          // Deferred anchors bridge a React commit (the spotlight
          // mark renders the frame after the previous step's hook
          // sets state) — not a fetch. Keep the wait short so a
          // mode where the anchor never comes (list view) reads as
          // a beat, not a hang.
          ...(step.deferred ? { waitForElement: 600 } : {}),
          popover: {
            title: step.title,
            description: step.description,
            // Providing onNextClick suspends auto-advance — run the
            // hook, then advance ourselves. The key must be ABSENT
            // otherwise: an explicit undefined still overrides
            // driver's built-in advance and deadens the button.
            ...(step.onLeave
              ? {
                  onNextClick: () => {
                    step.onLeave?.();
                    tour.moveNext();
                  },
                }
              : {}),
          },
        })),
        // The × is easy to miss — every popover gets an explicit
        // Skip, left of Back/Next. Steps with an action also get
        // their CTA as a block button under the description.
        onPopoverRender: (popover, opts) => {
          const skip = document.createElement("button");
          skip.type = "button";
          skip.className = "axiom-tour-skip";
          skip.textContent = "Skip";
          skip.onclick = () => tour.destroy();
          popover.footerButtons.prepend(skip);
          const action = present[opts.state.activeIndex ?? -1]?.action;
          if (action) {
            const cta = document.createElement("button");
            cta.type = "button";
            cta.className = "axiom-tour-action";
            cta.textContent = action.label;
            cta.onclick = () => {
              completed = true;
              tour.destroy();
              action.onClick();
            };
            popover.description.insertAdjacentElement("afterend", cta);
          }
        },
        onDestroyStarted: () => {
          completed = !!tour.isLastStep();
          tour.destroy();
        },
        onDestroyed: () => {
          activeRef.current = null;
          markTourSeen(surface);
          onEndRef.current?.();
          trackAxiomEvent("axiom_tour", {
            surface,
            action: completed ? "completed" : "dismissed",
          });
        },
      });
      activeRef.current = tour;
      trackAxiomEvent("axiom_tour", {
        surface,
        action: replayed ? "replayed" : "started",
      });
      // Driver measures anchor visibility before step hooks land, so
      // panel scrollboxes must be positioned before the tour starts —
      // otherwise it scrolls the document to reach them.
      for (const step of present) step.prepare?.();
      tour.drive();
    },
    [surface]
  );

  useEffect(() => {
    if (hasSeenTour(surface)) return;
    if (window.self !== window.top) return;
    if (window.matchMedia("(max-width: 767px)").matches) return;
    if (new URLSearchParams(window.location.search).get("embed") === "1")
      return;
    const anchors = stepsRef.current
      .filter((step) => !step.deferred)
      .map((step) => step.element)
      .filter((el): el is string => !!el);
    if (anchors.length === 0) return;
    // Anchors trickle into the DOM (the graph fetch gates the run
    // toggle) — start once they all exist, or with whichever showed
    // up once the wait runs out. Present-but-hidden (the TOC below
    // xl) counts as settled; the visibility filter drops it at start.
    let waited = 0;
    const timer = window.setInterval(() => {
      const allSettled = anchors.every((sel) => document.querySelector(sel));
      if (
        (allSettled || waited >= ANCHOR_WAIT_MS) &&
        anchors.some(stepVisible)
      ) {
        window.clearInterval(timer);
        start(false);
        return;
      }
      waited += ANCHOR_POLL_MS;
      if (waited > ANCHOR_WAIT_MS) window.clearInterval(timer);
    }, ANCHOR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [start, surface]);

  // App-state changes can invalidate the active step's anchor (the
  // law popup opening over its own trigger). The host dispatches
  // this event; re-driving the current step re-evaluates dynamic
  // anchors (`resolveElement`). No-op without an active tour.
  useEffect(() => {
    const rehighlight = () => {
      const tour = activeRef.current;
      if (!tour?.isActive()) return;
      const index = tour.getActiveIndex();
      if (typeof index === "number") tour.moveTo(index);
    };
    // …and some app actions outgrow the tour entirely (executing a
    // run): the host ends it rather than talking over the results.
    const end = () => activeRef.current?.destroy();
    window.addEventListener("axiom:tour-rehighlight", rehighlight);
    window.addEventListener("axiom:tour-end", end);
    return () => {
      window.removeEventListener("axiom:tour-rehighlight", rehighlight);
      window.removeEventListener("axiom:tour-end", end);
    };
  }, []);

  // Navigating away — or the surface changing under the same mount
  // (launcher tour open, user picks a provision) — tears the overlay
  // down (and counts as a dismissal via onDestroyed).
  useEffect(
    () => () => {
      activeRef.current?.destroy();
    },
    [surface]
  );

  return (
    <button
      type="button"
      className="axiom-tour-replay"
      aria-label="Replay the guided tour"
      title="Replay the guided tour"
      onClick={() => start(true)}
    >
      Tour
    </button>
  );
}
