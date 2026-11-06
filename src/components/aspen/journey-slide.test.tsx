import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captionAt, CAPTIONS, STORY_LABEL, TOTAL } from "@/components/landing/journey-lamplight/captions";
import { captionOpacity, S_STORY, scrollAt, storyAt } from "@/components/landing/journey-lamplight/clock";
import { JourneySlide, SCREENS_PER_SCROLL_BEAT, STEP_MAX_MS, STEP_MIN_MS, STOPS, stepMs, type JourneyControl } from "./journey-slide";

// A stand-in for the homepage's WebGL director: jsdom has no WebGL.
const director = vi.hoisted(() => ({
  create: vi.fn(),
  made: {
    setProgress: vi.fn(),
    jump: vi.fn(),
    prepareAll: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  },
}));
vi.mock("@/components/landing/journey-lamplight/director", () => ({ createDirector: director.create }));

const stage = () => document.querySelector<HTMLElement>(".jl-stage");
const caps = () => [...document.querySelectorAll<HTMLElement>(".jl-cap")].map((c) => Number(c.style.opacity));
/** The one caption up, or -1 if none or more than one is. */
const shownCaption = () => {
  const up = caps().flatMap((o, j) => (o > 0.6 ? [j] : []));
  return up.length === 1 && caps().every((o, j) => j === up[0] || o === 0.001) ? up[0] : -1;
};
/** How far through the story the presenter is, in percent, from the progress line. */
const bar = () => parseFloat((stage()!.querySelector("[aria-hidden] > div") as HTMLElement).style.width);
const barAt = (j: number) => (100 * scrollAt(STOPS[j])) / S_STORY;
const posters = () => [...stage()!.querySelectorAll("img")].map((p) => p.style.opacity);
const play = (ms: number) => act(() => vi.advanceTimersByTime(ms));
/** One wheel turn of `beats` of the homepage's scroll beats. */
const wheel = (beats: number, init: WheelEventInit = {}) =>
  fireEvent.wheel(window, { deltaY: beats * window.innerHeight * SCREENS_PER_SCROLL_BEAT, ...init });

function show({ atEnd = false } = {}) {
  const control = createRef<JourneyControl | null>() as { current: JourneyControl | null };
  const view = render(
    <>
      <div style={{ position: "relative" }}>
        <JourneySlide control={control} atEnd={atEnd} />
      </div>
      <div data-aspen-overlay />
    </>,
  );
  /** The presenter's right arrow, as it asks the journey; true if the journey took it. */
  const ask = (key: "next" | "back") => {
    let took = false;
    act(() => {
      took = control.current![key]();
    });
    return took;
  };
  const next = () => ask("next");
  const back = () => ask("back");
  return { ...view, control, next, back };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  director.create.mockReset();
  Object.values(director.made).forEach((f) => f.mockReset());
});

describe("the journey's stops", () => {
  it("land on each caption, alone and fully up, in story order from the first frame to the last", () => {
    expect(STOPS).toHaveLength(CAPTIONS.length);
    expect(STOPS[0]).toBe(0);
    expect(STOPS.at(-1)).toBe(TOTAL);
    STOPS.forEach((P, j) => {
      expect(captionAt(P)).toBe(j);
      expect(captionOpacity(P, j)).toBe(1);
      CAPTIONS.forEach((_, k) => k !== j && expect(captionOpacity(P, k)).toBeLessThanOrEqual(0));
      if (j > 0) expect(P).toBeGreaterThan(STOPS[j - 1]);
    });
  });

  it("round-trips through the homepage's scroll beats", () => {
    for (const P of STOPS) expect(storyAt(scrollAt(P))).toBeCloseTo(P, 9);
    expect(scrollAt(TOTAL)).toBeCloseTo(S_STORY, 9);
  });

  it("glides any step in 2 to 6 seconds, longer for a longer way", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: S_STORY, noNaN: true }), fc.double({ min: 0, max: S_STORY, noNaN: true }), (a, b) => {
        const ms = stepMs(a, b);
        expect(ms).toBeGreaterThanOrEqual(STEP_MIN_MS);
        expect(ms).toBeLessThanOrEqual(STEP_MAX_MS);
        expect(stepMs(b, a)).toBe(ms);
      }),
    );
    fc.assert(
      fc.property(fc.double({ min: 0, max: S_STORY, noNaN: true }), fc.double({ min: 0, max: S_STORY, noNaN: true }), (d1, d2) => {
        const [near, far] = d1 <= d2 ? [d1, d2] : [d2, d1];
        expect(stepMs(0, near)).toBeLessThanOrEqual(stepMs(0, far));
      }),
    );
    // Between the limits a longer way takes longer, not just as long.
    expect(stepMs(0, 1.5)).toBeGreaterThan(STEP_MIN_MS);
    expect(stepMs(0, 3.5)).toBeLessThan(STEP_MAX_MS);
    expect(stepMs(0, 1.5)).toBeLessThan(stepMs(0, 3.5));
  });
});

describe("the journey slide, without WebGL 2", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  });

  it("sits over the slide in the presenter's overlay, with the stills and the captions", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 40,
      top: 30,
      width: 1280,
      height: 714,
      right: 1320,
      bottom: 744,
      x: 40,
      y: 30,
      toJSON: () => ({}),
    });
    show();
    const s = stage()!;
    expect(s.parentElement).toBe(document.querySelector("[data-aspen-overlay]"));
    expect(s.dataset.journey).toBe("stills");
    expect(s.style.position).toBe("fixed");
    expect([s.style.left, s.style.top, s.style.width, s.style.height]).toEqual(["40px", "30px", "1280px", "714px"]);
    expect(screen.getByRole("img", { name: STORY_LABEL })).toBeInTheDocument();
    for (const c of CAPTIONS) expect(screen.getByText(c.title)).toBeInTheDocument();
    const imgs = s.querySelectorAll("img");
    expect(imgs).toHaveLength(CAPTIONS.length);
    expect([...imgs].map((p) => p.getAttribute("src"))).toEqual(CAPTIONS.map((_, i) => `/journey/posters/beat-${i + 1}.jpg`));
    expect(screen.queryByRole("img", { name: STORY_LABEL })!.querySelector("canvas")).toBeNull();
    expect(director.create).not.toHaveBeenCalled();
  });

  it("follows the slide when the window changes size", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const at = (width: number) =>
      ({ left: 0, top: 6, width, height: (width * 9) / 16 - 6, right: width, bottom: (width * 9) / 16, x: 0, y: 6, toJSON: () => ({}) }) as DOMRect;
    rect.mockReturnValue(at(1600));
    show();
    expect(stage()!.style.width).toBe("1600px");
    rect.mockReturnValue(at(1920));
    act(() => void window.dispatchEvent(new Event("resize")));
    play(20);
    expect(stage()!.style.width).toBe("1920px");
  });

  it("opens on the first frame and waits for the presenter (Max, Oct 26)", () => {
    show();
    play(5 * 60_000);
    expect(bar()).toBe(0);
    expect(shownCaption()).toBe(0);
    expect(posters()).toEqual(CAPTIONS.map((_, i) => (i === 0 ? "1" : "0")));
  });

  it("glides to each caption in turn and holds it, then hands the next key to the presenter", () => {
    const { next } = show();
    for (let j = 1; j < CAPTIONS.length; j++) {
      expect(next()).toBe(true);
      play(STEP_MAX_MS + 50);
      expect(shownCaption()).toBe(j);
      expect(bar()).toBeCloseTo(barAt(j), 1);
      expect(posters()).toEqual(CAPTIONS.map((_, i) => (i === j ? "1" : "0")));
      // It holds there until the next key.
      play(30_000);
      expect(bar()).toBeCloseTo(barAt(j), 1);
    }
    expect(bar()).toBe(100);
    // At the last caption the key is the presenter's: on to the next slide.
    expect(next()).toBe(false);
  });

  it("glides back a caption at a time, and hands the key back at the first", () => {
    const { next, back } = show();
    expect(back()).toBe(false);
    for (let j = 1; j < CAPTIONS.length; j++) next();
    play(STEP_MAX_MS * CAPTIONS.length);
    for (let j = CAPTIONS.length - 2; j >= 0; j--) {
      expect(back()).toBe(true);
      play(STEP_MAX_MS + 50);
      expect(shownCaption()).toBe(j);
    }
    expect(bar()).toBe(0);
    expect(back()).toBe(false);
  });

  it("goes on to the caption after when the key comes again mid-glide", () => {
    const { next } = show();
    next();
    play(STEP_MIN_MS / 2);
    expect(bar()).toBeGreaterThan(0);
    expect(bar()).toBeLessThan(barAt(1));
    next();
    play(2 * STEP_MAX_MS);
    expect(shownCaption()).toBe(2);
    expect(bar()).toBeCloseTo(barAt(2), 1);
  });

  it("lands the last glide at once on a press that comes before it does, and hands over the press after", () => {
    const { next, back } = show();
    for (let j = 1; j < CAPTIONS.length; j++) next();
    play(STEP_MIN_MS / 2);
    expect(bar()).toBeLessThan(100);
    // An impatient press (or a clicker's double click) stays on the journey, and shows the end now.
    expect(next()).toBe(true);
    play(20);
    expect(bar()).toBe(100);
    expect(shownCaption()).toBe(CAPTIONS.length - 1);
    expect(next()).toBe(false);
    // The same going back: the press that lands the first caption is still the journey's.
    for (let j = 1; j < CAPTIONS.length; j++) back();
    play(STEP_MIN_MS / 2);
    expect(back()).toBe(true);
    play(20);
    expect(bar()).toBe(0);
    expect(shownCaption()).toBe(0);
    expect(back()).toBe(false);
  });

  it("opens on the last frame when the presenter steps back into it", () => {
    const { next, back } = show({ atEnd: true });
    play(20);
    expect(bar()).toBe(100);
    expect(shownCaption()).toBe(CAPTIONS.length - 1);
    expect(next()).toBe(false);
    expect(back()).toBe(true);
    play(STEP_MAX_MS + 50);
    expect(shownCaption()).toBe(CAPTIONS.length - 2);
  });

  it("leaves a shared control to the slide that set it last", () => {
    const control = { current: null as JourneyControl | null };
    const first = render(<JourneySlide control={control} />);
    render(<JourneySlide control={control} />);
    const second = control.current;
    expect(second).not.toBeNull();
    first.unmount();
    expect(control.current).toBe(second);
  });

  it("jumps to the last frame with End and the first with Home", () => {
    show();
    expect(fireEvent.keyDown(window, { key: "End" })).toBe(false);
    play(20);
    expect(bar()).toBe(100);
    expect(shownCaption()).toBe(CAPTIONS.length - 1);
    expect(fireEvent.keyDown(window, { key: "Home" })).toBe(false);
    play(20);
    expect(bar()).toBe(0);
    expect(shownCaption()).toBe(0);
  });

  it("scrolls through the story at the homepage's rate, from the first frame to the last", () => {
    const { next } = show();
    // The wheel is the journey's, not the browser's: no page scroll, no swipe back.
    expect(wheel(scrollAt(STOPS[3]))).toBe(false);
    play(20);
    expect(shownCaption()).toBe(3);
    expect(bar()).toBeCloseTo(barAt(3), 1);
    // Lines scroll as 16 pixels each.
    fireEvent.wheel(window, { deltaY: -(scrollAt(STOPS[3]) - scrollAt(STOPS[2])) * window.innerHeight * SCREENS_PER_SCROLL_BEAT / 16, deltaMode: 1 });
    play(20);
    expect(bar()).toBeCloseTo(barAt(2), 1);
    // It stops at either end.
    wheel(1_000);
    play(20);
    expect(bar()).toBe(100);
    wheel(-1_000);
    play(20);
    expect(bar()).toBe(0);
  });

  it("lets a key's glide finish before the wheel moves it again, so a trackpad's coasting can't cut it short", () => {
    const { next } = show();
    next();
    play(STEP_MIN_MS / 2);
    // Still the journey's wheel (no page scroll), but it waits.
    expect(wheel(-1_000)).toBe(false);
    play(STEP_MAX_MS);
    expect(shownCaption()).toBe(1);
    expect(bar()).toBeCloseTo(barAt(1), 1);
    wheel(-1_000);
    play(20);
    expect(bar()).toBe(0);
  });

  it("treats a few pixels of drift after a step as still at its caption", () => {
    const { next, back } = show();
    next();
    next();
    play(2 * STEP_MAX_MS);
    expect(shownCaption()).toBe(2);
    fireEvent.wheel(window, { deltaY: 4 });
    play(20);
    expect(back()).toBe(true);
    play(STEP_MAX_MS + 50);
    expect(shownCaption()).toBe(1);
    fireEvent.wheel(window, { deltaY: -4 });
    play(20);
    expect(next()).toBe(true);
    play(STEP_MAX_MS + 50);
    expect(shownCaption()).toBe(2);
  });

  it("leaves a pinch to the browser", () => {
    show();
    expect(wheel(5, { ctrlKey: true })).toBe(true);
    play(20);
    expect(bar()).toBe(0);
  });

  it("leaves the page as it found it", () => {
    const { unmount, control } = show();
    unmount();
    expect(stage()).toBeNull();
    expect(control.current).toBeNull();
    // Its keys and the wheel go with it.
    expect(fireEvent.keyDown(window, { key: "End" })).toBe(true);
    expect(wheel(1)).toBe(true);
  });

  it("falls back to the page body without the presenter's overlay", () => {
    render(<JourneySlide />);
    expect(stage()!.parentElement).toBe(document.body);
  });
});

describe("the journey slide's first frame", () => {
  it("brings up the first caption even when a frame comes before the stage renders", async () => {
    // The stage renders a moment after the slide (it waits for the slide's box), and the
    // browser can draw in between: the caption that frame couldn't reach must still come up.
    const act = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const was = act.IS_REACT_ACT_ENVIRONMENT;
    act.IS_REACT_ACT_ENVIRONMENT = false;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.push(cb), frames.length));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const container = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.setAttribute("data-aspen-overlay", "");
    document.body.append(container, overlay);
    const root = createRoot(container);
    try {
      flushSync(() => root.render(<JourneySlide />));
      expect(document.querySelector(".jl-stage")).toBeNull();
      frames.splice(0).forEach((cb) => cb(16));
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelector(".jl-stage")).not.toBeNull();
      frames.splice(0).forEach((cb) => cb(32));
      expect(caps()[0]).toBe(1);
      expect(caps().slice(1).every((o) => o === 0.001)).toBe(true);
      expect(posters()).toEqual(CAPTIONS.map((_, i) => (i === 0 ? "1" : "0")));
    } finally {
      root.unmount();
      container.remove();
      overlay.remove();
      act.IS_REACT_ACT_ENVIRONMENT = was;
    }
  });
});

describe("the journey slide's glide, frame by frame", () => {
  /** Frames the test hands out itself, at the times it chooses. */
  let frames: Map<number, FrameRequestCallback>;
  beforeEach(() => {
    frames = new Map();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.set(++id, cb), id));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.delete(id));
  });
  const frame = (now: number) =>
    act(() => {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((cb) => cb(now));
    });

  it("starts on the frame after the key, eases in and out, and lands exactly on the caption", () => {
    const { next } = show();
    frame(1_000);
    next();
    const ms = stepMs(0, scrollAt(STOPS[1]));
    // However long since the last frame, the glide starts from here.
    frame(50_000);
    expect(bar()).toBe(0);
    frame(50_000 + ms / 10);
    const early = bar();
    frame(50_000 + ms / 2);
    expect(bar()).toBeCloseTo(barAt(1) / 2, 1);
    // Eased: the first tenth covers less than a tenth of the way.
    expect(early).toBeLessThan(barAt(1) / 10);
    frame(50_000 + ms);
    // The progress line rounds to a hundredth of a percent.
    expect(bar()).toBeCloseTo(barAt(1), 2);
    frame(60_000);
    expect(bar()).toBeCloseTo(barAt(1), 2);
  });

  it("stops its frames when the slide goes", () => {
    const { unmount } = show();
    frame(0);
    frame(16);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});

describe("the journey slide, with WebGL 2", () => {
  beforeEach(() => {
    // The test setup answers yes to reduced motion; here motion is allowed.
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    vi.stubGlobal("WebGL2RenderingContext", function WebGL2RenderingContext() {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "webgl2" ? ({} as WebGL2RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext);
  });

  it("draws with the homepage's director on paper, and moves it only when the presenter does", async () => {
    let first: () => void = () => {};
    director.create.mockImplementation(async (opts: { paper: boolean; overlays: HTMLElement[]; onFirstFrame: () => void }) => {
      first = opts.onFirstFrame;
      return director.made;
    });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { unmount, next } = show();
    expect(stage()!.dataset.journey).toBe("canvas");
    // Until the first frame draws, the first still stands in.
    expect(document.querySelector(".jl-poster-bg")).toHaveAttribute("src", "/journey/start.webp");
    expect(screen.getByRole("img", { name: STORY_LABEL }).tagName).toBe("CANVAS");
    await waitFor(() => expect(director.create).toHaveBeenCalledTimes(1));
    const opts = director.create.mock.calls[0][0];
    expect(opts.paper).toBe(true);
    expect(opts.canvas).toBe(document.querySelector("canvas"));
    expect(opts.overlays).toHaveLength(CAPTIONS.length);
    await waitFor(() => expect(director.made.jump).toHaveBeenCalledWith(0));
    act(() => first());
    expect(stage()!.className).toContain("is-drawn");

    // No clock: a minute on, it's still on the first frame.
    play(60_000);
    expect(director.made.setProgress.mock.calls.every(([P]) => P === 0)).toBe(true);
    next();
    play(STEP_MAX_MS + 50);
    expect(director.made.setProgress.mock.calls.at(-1)![0]).toBeCloseTo(STOPS[1], 6);

    unmount();
    expect(director.made.dispose).toHaveBeenCalled();
  });

  it("starts a canvas that comes late where the presenter already is", async () => {
    let made!: (d: typeof director.made) => void;
    director.create.mockImplementation(() => new Promise((resolve) => (made = resolve)));
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { next } = show();
    await waitFor(() => expect(director.create).toHaveBeenCalledTimes(1));
    next();
    next();
    play(2 * STEP_MAX_MS);
    await act(async () => made(director.made));
    expect(director.made.jump).toHaveBeenCalledTimes(1);
    expect(director.made.jump.mock.calls[0][0]).toBeCloseTo(STOPS[2], 6);
  });

  it("goes straight to the first and last frames with Home and End, rather than easing through the story", async () => {
    director.create.mockResolvedValue(director.made);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    show();
    await waitFor(() => expect(director.made.jump).toHaveBeenCalledWith(0));
    director.made.jump.mockClear();

    fireEvent.keyDown(window, { key: "End" });
    expect(director.made.jump).toHaveBeenCalledTimes(1);
    expect(director.made.jump.mock.calls[0][0]).toBeCloseTo(TOTAL, 9);
    play(20);
    expect(bar()).toBe(100);
    fireEvent.keyDown(window, { key: "Home" });
    expect(director.made.jump).toHaveBeenLastCalledWith(0);
    play(20);
    expect(bar()).toBe(0);
  });

  it("shows the still for the caption it's holding when it falls back mid-story", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let opts!: { onFirstFrame: () => void; onError: (e: unknown) => void };
    director.create.mockImplementation(async (o: typeof opts) => {
      opts = o;
      return director.made;
    });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { next } = show();
    await waitFor(() => expect(director.made.jump).toHaveBeenCalled());
    act(() => opts.onFirstFrame());
    for (let j = 0; j < 4; j++) next();
    play(5 * STEP_MAX_MS);
    expect(shownCaption()).toBe(4);

    act(() => opts.onError(new Error("MOCK: scene 5 failed")));
    expect(stage()!.dataset.journey).toBe("stills");
    play(20);
    expect(posters()).toEqual(CAPTIONS.map((_, i) => (i === 4 ? "1" : "0")));
    expect(shownCaption()).toBe(4);
  });

  it("keeps a click on the picture from following the homepage's links, but still lets them show on hover", async () => {
    director.create.mockResolvedValue(director.made);
    show();
    await waitFor(() => expect(director.made.jump).toHaveBeenCalled());
    const canvas = document.querySelector("canvas")!;
    const clicked = vi.fn();
    const hovered = vi.fn();
    canvas.addEventListener("click", clicked);
    canvas.addEventListener("pointermove", hovered);
    fireEvent.click(canvas);
    fireEvent.pointerMove(canvas);
    expect(clicked).not.toHaveBeenCalled();
    expect(hovered).toHaveBeenCalled();
    // The links sit in the stage's overlays: one reached by Tab and pressed with Enter goes nowhere either.
    const link = document.createElement("a");
    link.href = "/coverage";
    document.querySelector(".jl-stage")!.lastElementChild!.appendChild(link);
    expect(fireEvent.click(link)).toBe(false);
  });

  it("waits on the last still, not the first, when the presenter steps back into it", async () => {
    director.create.mockResolvedValue(director.made);
    show({ atEnd: true });
    expect(document.querySelector(".jl-poster-bg")).toHaveAttribute("src", `/journey/posters/beat-${CAPTIONS.length}.jpg`);
    await waitFor(() => expect(director.made.jump).toHaveBeenCalled());
    expect(director.made.jump.mock.calls.at(-1)![0]).toBeCloseTo(TOTAL, 9);
  });

  it("opens where the presenter brings it back to, with that caption's still, and keeps the still as the presenter re-renders", async () => {
    director.create.mockResolvedValue(director.made);
    const slide = (from?: number) => (
      <>
        <div style={{ position: "relative" }}>
          <JourneySlide from={from} />
        </div>
        <div data-aspen-overlay />
      </>
    );
    const { rerender, unmount } = render(slide(scrollAt(STOPS[2])));
    expect(document.querySelector(".jl-poster-bg")).toHaveAttribute("src", "/journey/posters/beat-3.jpg");
    await waitFor(() => expect(director.made.jump).toHaveBeenCalled());
    expect(director.made.jump.mock.calls.at(-1)![0]).toBeCloseTo(STOPS[2], 9);
    // The presenter clears `from` once the journey has opened: the still stays (the review of #376).
    rerender(slide(undefined));
    expect(document.querySelector(".jl-poster-bg")).toHaveAttribute("src", "/journey/posters/beat-3.jpg");
    unmount();
    // Brought back at the very start, the first still.
    render(slide(0));
    expect(document.querySelector(".jl-poster-bg")).toHaveAttribute("src", "/journey/start.webp");
  });

  it("falls back to the stills when a later scene can't be built", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let opts!: { onFirstFrame: () => void; onError: (e: unknown) => void };
    director.create.mockImplementation(async (o: typeof opts) => {
      opts = o;
      return director.made;
    });
    show();
    await waitFor(() => expect(director.made.jump).toHaveBeenCalled());
    act(() => opts.onFirstFrame());
    expect(stage()!.dataset.journey).toBe("canvas");

    act(() => opts.onError(new Error("MOCK: scene 3 failed")));
    expect(stage()!.dataset.journey).toBe("stills");
    expect(director.made.dispose).toHaveBeenCalled();
    expect(stage()!.querySelectorAll("img")).toHaveLength(CAPTIONS.length);
    expect(error).toHaveBeenCalledWith("journey slide: a scene could not be built", expect.any(Error));
  });

  it("falls back to the stills when the scenes can't be built", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    director.create.mockRejectedValue(new Error("no context"));
    show();
    await waitFor(() => expect(stage()!.dataset.journey).toBe("stills"));
    expect(stage()!.querySelectorAll("img")).toHaveLength(CAPTIONS.length);
  });

  it("falls back to the stills when the canvas never draws", async () => {
    director.create.mockResolvedValue(director.made);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    show();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(director.create).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(stage()!.dataset.journey).toBe("canvas");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(stage()!.dataset.journey).toBe("stills");
    expect(director.made.dispose).toHaveBeenCalled();
  });

  it("stays on the stills with reduced motion on", () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    show();
    expect(stage()!.dataset.journey).toBe("stills");
    expect(director.create).not.toHaveBeenCalled();
  });
});
