import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CAPTIONS, captionAt } from "./captions";
import { captionOpacity, END, END_S, PLAY_MS, S_STORY, STORY, STORY_END_MS, scrollAt, storyAt, storyAtTime } from "./clock";

const scroll = fc.double({ min: 0, max: END_S, noNaN: true });
const story = fc.double({ min: 0, max: END, noNaN: true });
const time = fc.double({ min: -10_000, max: PLAY_MS + 10_000, noNaN: true });
const anyP = fc.double({ min: -1, max: STORY + 1, noNaN: true });

/** The first time, in ms of playing, from which caption j is clear (above 0.6). */
function clearFrom(j: number): number {
  for (let t = 0; t <= PLAY_MS; t += 10) if (captionOpacity(storyAtTime(t), j) > 0.6) return t;
  return Infinity;
}

describe("the journey's clock", () => {
  it("turns scroll into story time and back", () => {
    fc.assert(fc.property(scroll, (s) => void expect(scrollAt(storyAt(s))).toBeCloseTo(s, 9)));
    fc.assert(fc.property(story, (P) => void expect(storyAt(scrollAt(P))).toBeCloseTo(P, 9)));
  });

  it("never runs story time backwards as the scroll moves on", () => {
    fc.assert(
      fc.property(scroll, scroll, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(storyAt(lo)).toBeLessThanOrEqual(storyAt(hi));
      }),
    );
  });

  it("keeps every caption between hidden and shown, and shows one at a time", () => {
    fc.assert(
      fc.property(anyP, (P) => {
        const shown = CAPTIONS.map((_, j) => captionOpacity(P, j));
        for (const o of shown) {
          expect(o).toBeGreaterThanOrEqual(0);
          expect(o).toBeLessThanOrEqual(1);
        }
        expect(shown.filter((o) => o > 0).length).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("shows the caption captionAt names wherever a caption is clear", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: STORY, noNaN: true }), (P) => {
        const clear = CAPTIONS.findIndex((_, j) => captionOpacity(P, j) > 0.6);
        if (clear >= 0) expect(clear).toBe(captionAt(P));
      }),
    );
  });
});

describe("the presenter's pace", () => {
  it("plays the story in about two and a half minutes, stopping before the end cards", () => {
    expect(STORY_END_MS).toBeGreaterThan(140_000);
    expect(STORY_END_MS).toBeLessThan(PLAY_MS);
    expect(S_STORY).toBeLessThan(END_S);
  });

  it("starts at the first frame and holds the last", () => {
    expect(storyAtTime(0)).toBe(0);
    expect(storyAtTime(-5_000)).toBe(0);
    expect(storyAtTime(STORY_END_MS)).toBeCloseTo(STORY, 9);
    expect(storyAtTime(PLAY_MS * 3)).toBe(STORY);
    fc.assert(
      fc.property(time, (t) => {
        const P = storyAtTime(t);
        expect(P).toBeGreaterThanOrEqual(0);
        expect(P).toBeLessThanOrEqual(STORY);
      }),
    );
  });

  it("never runs backwards", () => {
    fc.assert(
      fc.property(time, time, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(storyAtTime(lo)).toBeLessThanOrEqual(storyAtTime(hi));
      }),
    );
  });

  it("plays the homepage's scroll at a steady rate", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: STORY_END_MS, noNaN: true }), (t) => {
        expect(storyAtTime(t)).toBeCloseTo(storyAt((t / PLAY_MS) * END_S), 9);
      }),
    );
  });

  it("brings the captions up in order, each clear long enough to read", () => {
    const from = CAPTIONS.map((_, j) => clearFrom(j));
    expect(from[0]).toBe(0);
    for (let j = 1; j < from.length; j++) expect(from[j]).toBeGreaterThan(from[j - 1]);
    // Each caption stays clear for at least ten seconds before the next comes up.
    for (let j = 0; j < from.length - 1; j++) {
      let last = from[j];
      while (captionOpacity(storyAtTime(last + 10), j) > 0.6) last += 10;
      expect(last - from[j]).toBeGreaterThanOrEqual(10_000);
    }
    // The last stays up on the held last frame.
    expect(captionOpacity(storyAtTime(PLAY_MS * 2), CAPTIONS.length - 1)).toBe(1);
  });
});
