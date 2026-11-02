// The journey's clock, shared by the homepage, where scroll drives it, and
// the Aspen presenter's slide, where time does: scroll beats to story time
// and back, each caption's opacity at a story time, and the presenter's
// steady pace.

import { captionCut, CAPTIONS, TOTAL } from "./captions";
import { PACE } from "./pacing";

export const STORY = TOTAL; // beats; progress runs 0..STORY over them

// One steady pace on scroll: scroll moves through "scroll beats", and the
// pacing table (measured from the picture itself, see
// scripts/journey-pacing.cjs) turns them into story time, so a stretch
// that moves fast gets more scroll. A table measured for another
// timeline is not used.
const paced = Math.abs(PACE.total - TOTAL) < 1e-3;
export const S_STORY = paced ? PACE.S[PACE.S.length - 1] : TOTAL;
const lookup = (xs: number[], ys: number[], x: number) => {
  let lo = 0;
  let hi = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo]);
};
// scroll beats → story time, and back; past the story they run 1:1
export const storyAt = (s: number) => (s > S_STORY ? TOTAL + (s - S_STORY) : paced ? lookup(PACE.S, PACE.P, s) : s);
export const scrollAt = (P: number) => (P > TOTAL ? S_STORY + (P - TOTAL) : paced ? lookup(PACE.P, PACE.S, P) : P);
// then the cards come up (by TOTAL + 0.45) and hold a moment, about a
// screen and a half of scroll, before the page moves on
export const END = TOTAL + 1.0;
export const END_S = scrollAt(END);
// scroll length, in screen heights: ~1.6 per scroll beat
export const TRACK = Math.round(END_S * 1.6);

export const seg = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));

// a caption hands over to the next at the middle of each cut: the old one
// is gone just before, the new one comes up just after; the last goes as
// the cards come up
export function captionOpacity(P: number, j: number): number {
  const cut = captionCut;
  const inn = j === 0 ? 1 : seg(P, cut(j) + 0.02, cut(j) + 0.12);
  const out = j < CAPTIONS.length - 1 ? 1 - seg(P, cut(j + 1) - 0.12, cut(j + 1) - 0.02) : 1 - seg(P, STORY, STORY + 0.15);
  return Math.min(inn, out);
}

// The presenter's pace: the whole track, cards included, in two and a half
// minutes, the pace the run-of-show's cue sheet times (its bookmark scrolls
// the homepage at it). A slide stops at the story's end, before the cards.
export const PLAY_MS = 150_000;
export const STORY_END_MS = (S_STORY / END_S) * PLAY_MS;
/** Story time after `ms` of playing at the presenter's pace, held at the story's end. */
export const storyAtTime = (ms: number) => Math.min(STORY, storyAt((Math.max(0, ms) / PLAY_MS) * END_S));
