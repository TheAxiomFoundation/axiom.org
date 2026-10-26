import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTIONS, STORY_LABEL } from "@/components/landing/journey-lamplight/captions";
import { captionOpacity, PLAY_MS, STORY_END_MS, storyAtTime } from "@/components/landing/journey-lamplight/clock";
import { HOLD_MS, JourneySlide, MAX_STEP_MS } from "./journey-slide";

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

/** The first time, in ms of playing after the hold, from which caption j is clear. */
function clearFrom(j: number): number {
  for (let t = 0; t <= PLAY_MS; t += 10) if (captionOpacity(storyAtTime(t), j) > 0.6) return t;
  throw new Error(`caption ${j} never comes up`);
}

const stage = () => document.querySelector<HTMLElement>(".jl-stage");
const caps = () => [...document.querySelectorAll<HTMLElement>(".jl-cap")].map((c) => Number(c.style.opacity));
/** How far the story has played, in percent, from the progress line. */
const bar = () => parseFloat((stage()!.querySelector("[aria-hidden] > div") as HTMLElement).style.width);
const play = (ms: number) => act(() => vi.advanceTimersByTime(ms));

function show() {
  return render(
    <>
      <div style={{ position: "relative" }}>
        <JourneySlide />
      </div>
      <div data-aspen-overlay />
    </>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  director.create.mockReset();
  Object.values(director.made).forEach((f) => f.mockReset());
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
    const posters = s.querySelectorAll("img");
    expect(posters).toHaveLength(CAPTIONS.length);
    expect([...posters].map((p) => p.getAttribute("src"))).toEqual(CAPTIONS.map((_, i) => `/journey/posters/beat-${i + 1}.jpg`));
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

  it("holds the first frame, then brings each caption and still up on the presenter's pace", () => {
    show();
    play(HOLD_MS - 100);
    expect(caps()[0]).toBe(1);
    expect(bar()).toBe(0);
    const one = clearFrom(1);
    play(100 + one - 200);
    expect(caps()[0]).toBeLessThanOrEqual(0.6);
    expect(caps()[1]).toBeLessThanOrEqual(0.6);
    play(400);
    expect(caps()[1]).toBeGreaterThan(0.6);
    expect(caps().filter((o) => o > 0.001)).toHaveLength(1);
    const posters = [...stage()!.querySelectorAll("img")].map((p) => p.style.opacity);
    expect(posters).toEqual(CAPTIONS.map((_, i) => (i === 1 ? "1" : "0")));
  });

  it("holds the last frame once the story is told", () => {
    show();
    play(HOLD_MS + PLAY_MS);
    expect(bar()).toBe(100);
    expect(caps()[CAPTIONS.length - 1]).toBe(1);
    expect(caps().slice(0, -1).every((o) => o === 0.001)).toBe(true);
  });

  it("pauses and plays on with Space, and starts over with Home", () => {
    show();
    play(HOLD_MS + 5_000);
    const at = bar();
    expect(at).toBeGreaterThan(0);

    // Space is the slide's, not the browser's (no page scroll).
    expect(fireEvent.keyDown(window, { key: " " })).toBe(false);
    expect(stage()!.dataset.paused).toBe("true");
    expect(screen.getByText("Paused: Space plays on")).toBeInTheDocument();
    play(5_000);
    expect(bar()).toBe(at);

    fireEvent.keyDown(window, { key: " " });
    expect(stage()!.dataset.paused).toBe("false");
    expect(screen.queryByText("Paused: Space plays on")).not.toBeInTheDocument();
    play(1_000);
    expect(bar()).toBeGreaterThan(at);

    fireEvent.keyDown(window, { key: "Home" });
    play(20);
    expect(bar()).toBe(0);
    expect(caps()[0]).toBe(1);
  });

  it("leaves the page as it found it", () => {
    const { unmount } = show();
    unmount();
    expect(stage()).toBeNull();
    // Its keys go with it.
    expect(fireEvent.keyDown(window, { key: " " })).toBe(true);
  });

  it("falls back to the page body without the presenter's overlay", () => {
    render(<JourneySlide />);
    expect(stage()!.parentElement).toBe(document.body);
  });
});

describe("the journey slide's clock, frame by frame", () => {
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

  it("moves the story on by a quarter second at most for a frame that comes late", () => {
    show();
    let t = 0;
    for (; t <= HOLD_MS + 1_000; t += 16) frame(t);
    const at = bar();
    expect(at).toBeGreaterThan(0);
    // A minute away (a hidden tab, a stalled machine) comes back where it was, plus one step.
    frame(t + 60_000);
    expect(bar() - at).toBeCloseTo((100 * MAX_STEP_MS) / STORY_END_MS, 1);
  });

  it("stops its clock when the slide goes", () => {
    const { unmount } = show();
    frame(0);
    frame(16);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});

describe("the run-of-show's cue sheet", () => {
  /** The first whole millisecond, after the hold, at which caption j is half up. */
  function halfUp(j: number): number {
    for (let t = 0; t <= PLAY_MS; t++) if (captionOpacity(storyAtTime(t), j) > 0.5) return t;
    throw new Error(`caption ${j} never comes up`);
  }
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1_000)).padStart(2, "0")}`;

  it("gives the times its table prints, from when the slide comes up", () => {
    // The run-of-show's table for Shared foundation 6/7, the journey; it changes with these.
    expect(CAPTIONS.map((_, j) => (j === 0 ? "0:00" : clock(HOLD_MS + halfUp(j))))).toEqual(["0:00", "0:13", "0:43", "0:58", "1:21", "1:37", "1:56", "2:16"]);
    // The story's length pins the homepage's pacing, which a cue a second off wouldn't show.
    expect(STORY_END_MS).toBeCloseTo(145_357.187, 2);
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

  it("draws with the homepage's director on paper, and moves it on the presenter's clock", async () => {
    let first: () => void = () => {};
    director.create.mockImplementation(async (opts: { paper: boolean; overlays: HTMLElement[]; onFirstFrame: () => void }) => {
      first = opts.onFirstFrame;
      return director.made;
    });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { unmount } = show();
    expect(stage()!.dataset.journey).toBe("canvas");
    expect(screen.getByRole("img", { name: STORY_LABEL }).tagName).toBe("CANVAS");
    await waitFor(() => expect(director.create).toHaveBeenCalledTimes(1));
    const opts = director.create.mock.calls[0][0];
    expect(opts.paper).toBe(true);
    expect(opts.canvas).toBe(document.querySelector("canvas"));
    expect(opts.overlays).toHaveLength(CAPTIONS.length);
    await waitFor(() => expect(director.made.jump).toHaveBeenCalledWith(0));

    // Nothing moves until the canvas has drawn.
    play(3_000);
    expect(bar()).toBe(0);
    act(() => first());
    expect(stage()!.className).toContain("is-drawn");
    play(HOLD_MS + 2_000);
    const P = director.made.setProgress.mock.calls.at(-1)![0];
    expect(P).toBeGreaterThan(0);
    expect(P).toBeCloseTo(storyAtTime(2_000), 1);

    unmount();
    expect(director.made.dispose).toHaveBeenCalled();
  });

  it("starts the canvas over at its first frame with Home, rather than easing back through the story", async () => {
    let first: () => void = () => {};
    director.create.mockImplementation(async (opts: { onFirstFrame: () => void }) => {
      first = opts.onFirstFrame;
      return director.made;
    });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    show();
    await waitFor(() => expect(director.made.jump).toHaveBeenCalledWith(0));
    act(() => first());
    play(HOLD_MS + 30_000);
    expect(director.made.setProgress.mock.calls.at(-1)![0]).toBeGreaterThan(1);
    director.made.jump.mockClear();

    fireEvent.keyDown(window, { key: "Home" });
    expect(director.made.jump).toHaveBeenCalledExactlyOnceWith(0);
    play(20);
    expect(bar()).toBe(0);
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
