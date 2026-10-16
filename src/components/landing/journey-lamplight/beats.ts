// The scenes, in story order. A scene may run over more than one beat:
// the shelf, the open book and the corpus are one continuous shot. The scenes live
// with their style frames (style-frames/), so a frame and its beat on the
// page are the same code.

import type { BeatBuilder } from "../style-frames/kit";
import { lamplightShelfToBook } from "../style-frames/lamplight01";
import { lamplightBeat5 } from "../style-frames/lamplight";
import { lamplightBeat3, lamplightBeat4, lamplightBeat6, lamplightBeat7 } from "../style-frames/lamplight2";

export const SCENES: Array<{ build: BeatBuilder; beats: number }> = [
  { build: lamplightShelfToBook, beats: 5.82 }, // off the shelf → the law, as published → the corpus
  { build: lamplightBeat3, beats: 1 }, // encode
  { build: lamplightBeat4, beats: 1 }, // cited code
  { build: lamplightBeat5, beats: 1 }, // the graph
  { build: lamplightBeat6, beats: 1 }, // all the law
  { build: lamplightBeat7, beats: 1 }, // every system
];
