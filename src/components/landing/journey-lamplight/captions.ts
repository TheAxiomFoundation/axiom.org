// What the page says over each beat: a small kicker and one title. The
// two disclosures the copy rules need ride in the kicker: the encode
// beat is an illustration, and registry numbers carry their snapshot.

import { snapshotMonth } from "../registry-snapshot";

// The timeline, in beats. Progress P runs 0..TOTAL across the scenes;
// each scene's own motion runs over its span, and the last OVERLAP of it
// is shared with the next scene, both moving, while one dissolves into
// the other. The opening shot (shelf to page to corpus) is one scene.
export const OVERLAP = 0.32;
// the encode loop gets the most room after the opening: its light moves
// through four gates and round the loop, slowly
export const SPANS = [5.82, 2.0, 1.3, 1.3, 1.3, 1.3];
// the end of each scene where its motion is done and the reader can look
// (the camera keeps drifting); the opening holds on the corpus address
// the encode loop rests a moment once every gate is lit
export const HOLDS = [0.3, 0.55, 0.3, 0.3, 0.3, 0.3];
export const TOTAL = SPANS.reduce((a, b) => a + b, 0);
export const SCENE_START = SPANS.map((_, i) => SPANS.slice(0, i).reduce((a, b) => a + b, 0));
// where caption j takes over: the middle of each cut. Captions 2 and 3
// come up inside the opening shot: as the cover opens, and as the camera
// comes down over the corpus
export const captionCut = (j: number) =>
  j === 0 ? -1 : j === 1 ? 0.95 : j === 2 ? 4.45 : SCENE_START[j - 2] - OVERLAP / 2;
// the caption on screen at P
export const captionAt = (P: number) => {
  for (let j = CAPTIONS.length - 1; j > 0; j--) if (P >= captionCut(j)) return j;
  return 0;
};

export const CAPTIONS: Array<{ kicker: string; title: string }> = [
  { kicker: "1 / 8 · Off the shelf", title: "It starts with the law as written." },
  { kicker: "2 / 8 · The law, as published", title: "Hundreds of official sources, word for word." },
  { kicker: "3 / 8 · The corpus", title: "Every provision has an address." },
  { kicker: "4 / 8 · Encode · an illustration", title: "AI drafts a rule. A failed check sends it back." },
  { kicker: "5 / 8 · Cited code", title: "Every value cites the sentence it came from." },
  { kicker: "6 / 8 · The graph", title: "Typed, cited, executable." },
  { kicker: `7 / 8 · All the law · ${snapshotMonth()} snapshot`, title: "The same structure, at scale." },
  { kicker: "8 / 8 · Every system", title: "One set of rules powers every kind of tool, built by anyone." },
];
