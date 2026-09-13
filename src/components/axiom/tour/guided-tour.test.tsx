import { act, fireEvent, render, screen } from "@testing-library/react";
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

import {
  DEFAULT_SMALL_SCREEN_QUERY,
  GuidedTour,
  type TourStep,
} from "./guided-tour";
import { tourSeenKey } from "./tour-state";
import { ANCHOR_POLL_MS, ANCHOR_WAIT_MS } from "./tour-timing";
import { mediaStub } from "@/test/media-stub";

/** An element driver's visibility check accepts: present + painted. */
function anchoredElement(testid: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-testid", testid);
  el.getClientRects = () =>
    [{ width: 10, height: 10 }] as unknown as DOMRectList;
  document.body.appendChild(el);
  return el;
}

const lastConfig = () => capturedConfigs[capturedConfigs.length - 1]!;

/** Past the anchor poll's first two ticks — enough for an ungated
 *  tour to have started. */
const ANCHOR_SETTLE_MS = 600;
/** Past the whole anchor wait and the tick that follows it. */
const PAST_ANCHOR_WAIT_MS = ANCHOR_WAIT_MS + 2 * ANCHOR_POLL_MS;

const PLANE_QUERY = "(max-width: 820px)";

describe("GuidedTour", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "";
    capturedConfigs.length = 0;
    driverMock.mockClear();
    tourMock.drive.mockClear();
    tourMock.destroy.mockClear();
    tourMock.isActive.mockReturnValue(false);
    tourMock.isLastStep.mockReturnValue(false);
  });

  const steps: TourStep[] = [
    { title: "Welcome", description: "intro" },
    {
      element: '[data-testid="anchor-a"]',
      title: "Anchored",
      description: "points at a",
    },
  ];

  it("auto-starts on first visit once anchors settle, marks seen on teardown", async () => {
    vi.useFakeTimers();
    anchoredElement("anchor-a");
    const onEnd = vi.fn();
    render(<GuidedTour surface="graph" steps={steps} onEnd={onEnd} />);
    expect(driverMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(ANCHOR_SETTLE_MS);
    });
    expect(driverMock).toHaveBeenCalledTimes(1);
    expect(tourMock.drive).toHaveBeenCalledTimes(1);
    const config = lastConfig();
    expect(config.popoverClass).toBe("axiom-tour");
    // Teardown marks the surface seen and runs onEnd.
    act(() => {
      (config.onDestroyed as () => void)();
    });
    expect(window.localStorage.getItem(tourSeenKey("graph"))).toBe("1");
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("an anchor that never lands: the tour starts on the first tick past the wait", async () => {
    /* The fallback that scripts/graph-viewport-check.lib.ts watches
       for — a tour can open this late, so an observer that stops
       looking sooner cannot say no tour opened. */
    vi.useFakeTimers();
    anchoredElement("anchor-a");
    render(
      <GuidedTour
        surface="graph"
        steps={[
          ...steps,
          {
            element: '[data-testid="anchor-never"]',
            title: "Late",
            description: "never lands",
          },
        ]}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(ANCHOR_WAIT_MS);
    });
    expect(driverMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(ANCHOR_POLL_MS);
    });
    expect(tourMock.drive).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("gates auto-start on the site's phone breakpoint by default", async () => {
    vi.useFakeTimers();
    const matchMedia = vi.spyOn(window, "matchMedia");
    anchoredElement("anchor-a");
    render(<GuidedTour surface="graph" steps={steps} />);
    expect(DEFAULT_SMALL_SCREEN_QUERY).toBe("(max-width: 767px)");
    expect(matchMedia).toHaveBeenCalledWith(DEFAULT_SMALL_SCREEN_QUERY);
    await act(async () => {
      vi.advanceTimersByTime(ANCHOR_SETTLE_MS);
    });
    expect(tourMock.drive).toHaveBeenCalledTimes(1);
    matchMedia.mockRestore();
    vi.useRealTimers();
  });

  it("a surface can widen its small-screen range: no auto-start inside it", async () => {
    vi.useFakeTimers();
    // 800px wide: past the phone breakpoint, inside the Plane's range.
    const stub = mediaStub({ [PLANE_QUERY]: true });
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockImplementation(stub.impl);
    anchoredElement("anchor-a");
    render(
      <GuidedTour surface="graph" steps={steps} smallScreenQuery={PLANE_QUERY} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(ANCHOR_SETTLE_MS);
    });
    expect(driverMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(tourSeenKey("graph"))).toBeNull();
    matchMedia.mockRestore();
    vi.useRealTimers();
  });

  it("re-checks the gate as the anchors settle: a window narrowed during the wait gets no tour", async () => {
    vi.useFakeTimers();
    const stub = mediaStub({ [PLANE_QUERY]: false });
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockImplementation(stub.impl);
    // Wide at mount, anchor still loading (the Plane's graph fetch).
    render(
      <GuidedTour surface="graph" steps={steps} smallScreenQuery={PLANE_QUERY} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(ANCHOR_SETTLE_MS);
    });
    expect(driverMock).not.toHaveBeenCalled();
    // The window narrows under the boundary, then the anchor lands.
    stub.set(PLANE_QUERY, true);
    anchoredElement("anchor-a");
    await act(async () => {
      vi.advanceTimersByTime(PAST_ANCHOR_WAIT_MS);
    });
    expect(driverMock).not.toHaveBeenCalled();
    // Not a dismissal: the next wide visit still gets the tour.
    expect(window.localStorage.getItem(tourSeenKey("graph"))).toBeNull();
    matchMedia.mockRestore();
    vi.useRealTimers();
  });

  it("the host's tour-end event ends a running tour", () => {
    window.localStorage.setItem(tourSeenKey("graph"), "1");
    anchoredElement("anchor-a");
    render(<GuidedTour surface="graph" steps={steps} />);
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    tourMock.isActive.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("axiom:tour-end"));
    });
    expect(tourMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("never auto-starts when already seen; the ? button replays", () => {
    window.localStorage.setItem(tourSeenKey("graph"), "1");
    anchoredElement("anchor-a");
    render(<GuidedTour surface="graph" steps={steps} />);
    expect(driverMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    expect(driverMock).toHaveBeenCalledTimes(1);
    expect(tourMock.drive).toHaveBeenCalledTimes(1);
  });

  it("won't run a tour whose anchors are all missing", () => {
    window.localStorage.setItem(tourSeenKey("graph"), "1");
    render(<GuidedTour surface="graph" steps={steps} />);
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    expect(driverMock).not.toHaveBeenCalled();
  });

  it("drops hidden anchored steps but keeps floating ones", () => {
    window.localStorage.setItem(tourSeenKey("graph"), "1");
    anchoredElement("anchor-a");
    // A second anchored step whose element exists but has no paint.
    const hidden = document.createElement("div");
    hidden.setAttribute("data-testid", "anchor-b");
    document.body.appendChild(hidden);
    render(
      <GuidedTour
        surface="graph"
        steps={[
          ...steps,
          {
            element: '[data-testid="anchor-b"]',
            title: "Hidden",
            description: "invisible",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    const driven = lastConfig().steps as Array<{ element?: string }>;
    expect(driven).toHaveLength(2);
    expect(driven.map((step) => step.element)).toEqual([
      undefined,
      '[data-testid="anchor-a"]',
    ]);
  });

  it("onPopoverRender prepends Skip everywhere and a CTA on action steps", () => {
    window.localStorage.setItem(tourSeenKey("graph"), "1");
    anchoredElement("anchor-a");
    const action = vi.fn();
    render(
      <GuidedTour
        surface="graph"
        steps={[
          {
            element: '[data-testid="anchor-a"]',
            title: "With action",
            description: "has CTA",
            action: { label: "Open the example →", onClick: action },
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    const config = lastConfig();
    const footerButtons = document.createElement("span");
    const description = document.createElement("p");
    document.body.append(footerButtons, description);
    (config.onPopoverRender as (
      popover: { footerButtons: HTMLElement; description: HTMLElement },
      opts: { state: { activeIndex?: number } },
    ) => void)({ footerButtons, description }, { state: { activeIndex: 0 } });
    expect(footerButtons.querySelector(".axiom-tour-skip")).not.toBeNull();
    const cta = document.querySelector(
      ".axiom-tour-action",
    ) as HTMLButtonElement;
    expect(cta?.textContent).toBe("Open the example →");
    // The CTA completes the tour, tears down, then runs the action.
    cta.click();
    expect(tourMock.destroy).toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
    // Skip tears down too.
    (footerButtons.querySelector(".axiom-tour-skip") as HTMLButtonElement).click();
    expect(tourMock.destroy).toHaveBeenCalledTimes(2);
  });

  it("wires prepare/onEnter to highlight and onLeave to a manual Next", () => {
    window.localStorage.setItem(tourSeenKey("graph"), "1");
    anchoredElement("anchor-a");
    const prepare = vi.fn();
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    render(
      <GuidedTour
        surface="graph"
        steps={[
          {
            element: '[data-testid="anchor-a"]',
            title: "Hooked",
            description: "with hooks",
            prepare,
            onEnter,
            onLeave,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    // prepare runs upfront, before drive().
    expect(prepare).toHaveBeenCalledTimes(1);
    const driven = (lastConfig().steps as Array<Record<string, unknown>>)[0]!;
    (driven.onHighlightStarted as () => void)();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(2);
    const popover = driven.popover as Record<string, unknown>;
    (popover.onNextClick as () => void)();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(tourMock.moveNext).toHaveBeenCalledTimes(1);
  });

  it("onDestroyStarted records completion state and destroys", () => {
    window.localStorage.setItem(tourSeenKey("subgraph"), "1");
    anchoredElement("anchor-a");
    render(<GuidedTour surface="subgraph" steps={steps} />);
    fireEvent.click(screen.getByRole("button", { name: /replay/i }));
    const config = lastConfig();
    tourMock.isLastStep.mockReturnValue(true);
    (config.onDestroyStarted as () => void)();
    expect(tourMock.destroy).toHaveBeenCalledTimes(1);
    // subgraph teardown writes the session-scoped flag.
    (config.onDestroyed as () => void)();
    expect(window.sessionStorage.getItem(tourSeenKey("subgraph"))).toBe("1");
  });
});
