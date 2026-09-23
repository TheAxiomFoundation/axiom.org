import { describe, expect, it } from "vitest";
import {
  chapterAt,
  JOURNEY_CHAPTERS,
  verificationAt,
} from "./journey-timeline";

describe("encoding journey story", () => {
  it("lands every chapter shortcut in its own chapter, forward and backward", () => {
    for (const index of [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0])
      expect(chapterAt(JOURNEY_CHAPTERS[index].at)).toBe(index);
  });
  it("shows disagreement before the correction and reruns comparison before review", () => {
    expect([0.51, 0.53, 0.59, 0.63, 0.67, 0.7].map(verificationAt)).toEqual([
      "run",
      "checks",
      "disagreement",
      "corrected",
      "compare",
      "review",
    ]);
    expect(verificationAt(0.59)).toBe("disagreement");
  });
});
