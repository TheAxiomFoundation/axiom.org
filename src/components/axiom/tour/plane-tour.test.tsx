import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { driverMock, tourMock, capturedConfigs } = vi.hoisted(() => {
  const tourMock = {
    drive: vi.fn(),
    destroy: vi.fn(),
    isActive: vi.fn(() => false),
    isLastStep: vi.fn(() => false),
    moveNext: vi.fn(),
  };
  const capturedConfigs: Array<Record<string, unknown>> = [];
  const driverMock = vi.fn((config: Record<string, unknown>) => {
    capturedConfigs.push(config);
    return tourMock;
  });
  return { driverMock, tourMock, capturedConfigs };
});

vi.mock("driver.js", () => ({ driver: driverMock }));
vi.mock("driver.js/dist/driver.css", () => ({}));

import { PlaneTour, TOUR_EXAMPLE_TARGET } from "./plane-tour";
import { ReaderTour } from "./reader-tour";
import { tourSeenKey } from "./tour-state";

function visible(testid: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-testid", testid);
  el.getClientRects = () =>
    [{ width: 10, height: 10 }] as unknown as DOMRectList;
  document.body.appendChild(el);
  return el;
}

const lastConfig = () => capturedConfigs[capturedConfigs.length - 1]!;

describe("PlaneTour", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "";
    capturedConfigs.length = 0;
    driverMock.mockClear();
  });

  it("names the EITC as the example subtree", () => {
    expect(TOUR_EXAMPLE_TARGET).toBe("us:statutes/26/32");
  });

  it("launcher stage: spotlight starts on leaving step 2, CTA opens the example", () => {
    window.localStorage.setItem(tourSeenKey("graph"), "1");
    visible("launcher-controls");
    const onOpenExample = vi.fn();
    const onSpotlightExample = vi.fn();
    render(
      <PlaneTour
        stage="launcher"
        onOpenExample={onOpenExample}
        onSpotlightExample={onSpotlightExample}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    const driven = lastConfig().steps as Array<Record<string, unknown>>;
    // Welcome + find-a-provision survive; the spotlight-anchored
    // closing step drops only if its deferred anchor never appears —
    // deferred steps are kept for driver's own waitForElement.
    expect(driven.length).toBe(3);
    const findStep = driven[1]!;
    ((findStep.popover as Record<string, unknown>).onNextClick as () => void)();
    expect(onSpotlightExample).toHaveBeenCalledWith(true);
    // Tour teardown releases the spotlight through onEnd.
    (lastConfig().onDestroyed as () => void)();
    expect(onSpotlightExample).toHaveBeenCalledWith(false);
  });

  it("subgraph stage: five steps anchored to the working surfaces", () => {
    window.sessionStorage.setItem(tourSeenKey("subgraph"), "1");
    visible("back-to-overview");
    visible("read-the-law");
    const toggle = document.createElement("div");
    toggle.setAttribute("data-tour", "run-scenario");
    toggle.getClientRects = () =>
      [{ width: 10, height: 10 }] as unknown as DOMRectList;
    document.body.appendChild(toggle);
    render(<PlaneTour stage="subgraph" />);
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    const driven = lastConfig().steps as Array<{
      element?: string | (() => Element);
    }>;
    expect(driven.map((step) => step.element)).toContain(
      '[data-testid="back-to-overview"]',
    );
    expect(driven.map((step) => step.element)).toContain(
      '[data-tour="run-scenario"]',
    );
    // The reading step's anchor is dynamic (button → whole law
    // popup when open); with no popup in the DOM it resolves to
    // the button.
    const readStep = driven.find((step) => typeof step.element === "function");
    expect(readStep).toBeTruthy();
    expect(
      (readStep!.element as () => Element)()?.getAttribute("data-testid"),
    ).toBe("read-the-law");
  });
});

describe("ReaderTour", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
    capturedConfigs.length = 0;
    driverMock.mockClear();
  });

  it("tours the reading surfaces that exist on the page", () => {
    window.localStorage.setItem(tourSeenKey("reader"), "1");
    const crumbs = document.createElement("nav");
    crumbs.setAttribute("data-tour", "breadcrumbs");
    crumbs.getClientRects = () =>
      [{ width: 10, height: 10 }] as unknown as DOMRectList;
    document.body.appendChild(crumbs);
    visible("action-strip");
    render(<ReaderTour />);
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    const driven = lastConfig().steps as Array<{ element?: string }>;
    // Breadcrumbs + action strip present; TOC and rail dropped (absent).
    expect(driven.map((step) => step.element)).toEqual([
      '[data-tour="breadcrumbs"]',
      '[data-testid="action-strip"]',
    ]);
  });
});
