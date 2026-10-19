// Stage layouts in design units. The stage is drawn at a fixed design
// size and scaled to fit the viewport, so every position here — and
// every position measured from the DOM — lives in one coordinate
// system that the canvas, the SVG overlay and the DOM panels share.
//
// "wide" is the desktop stage (16:9.5); "tall" is the phone stage,
// with the code panel under the statute instead of beside it.

import type { GraphNodeId } from "./data";

export type Box = { x: number; y: number; w: number; h: number };

export type Layout = {
  kind: "wide" | "tall";
  W: number;
  H: number;
  rail: Box;
  textFrom: Box; // where the statute panel first opens
  text: Box; // where it sits beside the code
  land: Box; // where the field's camera lands the provision's cell
  code: Box;
  caption: Box;
  result: Box; // the test case's answer
  field: {
    x0: number;
    y0: number;
    cols: number;
    rows: number;
    target: { c: number; r: number };
    regions: Array<[number, number, number, number]>; // c, r, w, h
    // empty columns and rows: the gutters between shelves of documents,
    // placed so each address level is a block of its own
    gutC: number[];
    gutR: number[];
  };
  graph: Record<GraphNodeId, [number, number]>;
  heroSlot: [number, number];
  // the registry snapshot's cluster positions are in the film's 1420-wide
  // frame; this maps them onto this stage
  mapFilm: (x: number, y: number) => [number, number];
};

const WIDE_TEXT_FROM: Box = { x: 425, y: 84, w: 430, h: 540 };

export const WIDE: Layout = {
  kind: "wide",
  W: 1280,
  H: 760,
  rail: { x: 48, y: 22, w: 1184, h: 34 },
  textFrom: WIDE_TEXT_FROM,
  text: { x: 48, y: 84, w: 430, h: 540 },
  land: WIDE_TEXT_FROM,
  code: { x: 534, y: 84, w: 698, h: 540 },
  caption: { x: 48, y: 652, w: 1184, h: 90 },
  result: { x: 872, y: 646, w: 360, h: 96 },
  field: {
    x0: 40,
    y0: 72,
    cols: 150,
    rows: 56,
    target: { c: 96, r: 26 },
    regions: [
      [38, 0, 88, 56],
      [84, 20, 24, 12],
      [96, 26, 9, 1],
      [96, 26, 1, 1],
    ],
    gutC: [11, 24, 37, 52, 68, 83, 108, 126, 139],
    gutR: [9, 19, 32, 45],
  },
  graph: {
    imp2014: [200, 140],
    impUsda: [200, 450],
    net: [500, 105],
    rate30: [500, 220],
    size2: [500, 410],
    rate8: [500, 525],
    contrib: [800, 165],
    minimum: [800, 470],
    before: [1050, 300],
    regular: [1080, 585],
  },
  heroSlot: [640, 548],
  mapFilm: (x, y) => [x - 80, y - 36],
};

export const TALL: Layout = {
  kind: "tall",
  W: 520,
  H: 990,
  rail: { x: 20, y: 14, w: 480, h: 34 },
  textFrom: { x: 20, y: 64, w: 480, h: 404 },
  text: { x: 20, y: 64, w: 480, h: 404 },
  land: { x: 100, y: 64, w: 320, h: 400 },
  code: { x: 20, y: 482, w: 480, h: 400 },
  caption: { x: 20, y: 898, w: 480, h: 84 },
  result: { x: 220, y: 770, w: 270, h: 100 },
  field: {
    x0: 20,
    y0: 60,
    cols: 60,
    rows: 82,
    target: { c: 36, r: 40 },
    regions: [
      [0, 18, 60, 46],
      [30, 34, 16, 12],
      [36, 40, 9, 1],
      [36, 40, 1, 1],
    ],
    gutC: [14, 29, 46],
    gutR: [8, 17, 33, 46, 55, 64, 74],
  },
  graph: {
    imp2014: [136, 96],
    impUsda: [384, 96],
    net: [136, 196],
    rate30: [384, 196],
    contrib: [260, 296],
    before: [260, 396],
    size2: [260, 496],
    rate8: [260, 586],
    minimum: [260, 676],
    regular: [260, 776],
  },
  heroSlot: [260, 846],
  mapFilm: (x, y) => [30 + (y - 110) * 1.12, 70 + (x - 150) * 0.6],
};

export function pickLayout(vw: number, vh: number): Layout {
  return vw / vh < 0.95 ? TALL : WIDE;
}
