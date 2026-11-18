// The live journey's layout and clock. Beats 4–8 are drawn as page
// components on one stage of fixed design size, scaled to fit the screen,
// so every position below is a design pixel and every frame is a pure
// function of scroll.
//
// The clock runs in screens of scroll ("u"), starting where the 3D opening
// (beats 1–3) hands over on the corpus address. Each transition carries one
// element into the next beat: the draft becomes the code card, the code
// lines become the graph's nodes, the graph becomes an amber cluster among
// the registry's packages, and that cluster becomes the one source card.

import { CODE, type GraphNodeId } from "../journey-digital/data";

export const DW = 1280;
export const DH = 800;

// ── beats 1–3: the opening, in screens of scroll from the stage's pin
// ("o"). Beat 4 starts at OPEN.
export const OPEN = 6.0;
export const O = {
  shelfIn: [0, 0.8],
  lift: [0.8, 1.4],
  toCover: [1.4, 2.2],
  coverOpen: [2.3, 2.9],
  scan: [2.9, 3.6],
  intoCell: [4.0, 4.6],
  pullBack: [4.0, 5.0],
  labels: [5.0, 5.5],
} as const;
// where the opening's captions (CAPTIONS[0..2]) take over
export const CAPTION_OPEN = [0, 2.3, 4.1];

// beat 1: the library. An old law library in the story's own hand: a
// bookcase that is a card, walnut shelves with a name plate each, and
// bound sets of volumes in flat colour (buckram with a red and a black
// label, as law reports are bound, and a few leather sets). One shelf for
// each kind of source; Title 7 is the volume that comes off.
export const SHELF = { x: 84, y: 30, w: 1112, rowH: 184, spineMax: 146, gap: 2, rows: 3, board: 18 };
// the top of the board each row of spines stands on
export const shelfBase = (row: number) => SHELF.y + SHELF.spineMax + 12 + row * SHELF.rowH;
export const CASE = { x: SHELF.x - 20, y: SHELF.y - 12, w: SHELF.w + 40, h: shelfBase(SHELF.rows - 1) + SHELF.board + 6 - (SHELF.y - 12) };
const USC = Array.from({ length: 54 }, (_, i) => String(i + 1)).filter((n) => n !== "53"); // Title 53 is reserved
const CFR = Array.from({ length: 50 }, (_, i) => String(i + 1));
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
export const SHELVES = [
  { label: "United States Code", spines: USC },
  { label: "Code of Federal Regulations", spines: CFR },
  { label: "State codes and regulations", spines: STATES },
];
export const TITLE7 = { row: 0, index: USC.indexOf("7") };
// how a run of volumes is bound
export const BINDINGS = ["buckram", "buckram", "green", "buckram", "oxblood", "navy", "buckram", "black"] as const;
export type Binding = (typeof BINDINGS)[number] | "title7";
export type Spine = { x: number; y: number; w: number; h: number; set: Binding; label: string; row: number; title7: boolean };
function makeSpines(): Spine[] {
  // a fixed seed: the same shelf on every visit
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const spines: Spine[] = [];
  SHELVES.forEach((shelf, r) => {
    const n = shelf.spines.length;
    // volumes stand in bound sets: a run shares its binding, width and height
    const runs: Array<{ set: Binding; w: number; h: number }> = [];
    let k = r * 3;
    while (runs.length < n) {
      const len = 3 + Math.floor(rnd() * 6);
      const run = { set: BINDINGS[k++ % BINDINGS.length] as Binding, w: 0.85 + rnd() * 0.35, h: SHELF.spineMax - 30 + Math.round(rnd() * 24) };
      for (let i = 0; i < len && runs.length < n; i++) runs.push(run);
    }
    const raw = runs.map((run, i) => (r === TITLE7.row && i === TITLE7.index ? 1.7 : run.w));
    const unit = (SHELF.w - SHELF.gap * (n - 1)) / raw.reduce((a, b) => a + b, 0);
    let x = SHELF.x;
    shelf.spines.forEach((label, i) => {
      const title7 = r === TITLE7.row && i === TITLE7.index;
      const w = raw[i] * unit;
      const h = title7 ? SHELF.spineMax : runs[i].h + Math.round(rnd() * 2);
      spines.push({ x, y: shelfBase(r) - h, w, h, set: title7 ? "title7" : runs[i].set, label, row: r, title7 });
      x += w + SHELF.gap;
    });
  });
  return spines;
}
export const SPINES = makeSpines();
export const SPINE7 = SPINES.find((s) => s.title7)!;

// beat 2: the book's page (the cover opens over the same rect)
export const PAGE = { x: 330, y: 24, w: 620, h: 560 };

// beat 3: the corpus, a plane of provision cells receding in perspective.
// Rows run far to near; a cell's size and place follow 1/z.
export const GRID = { cols: 44, rows: 14, pitch: 52, horizon: 24, k: 520, far: 4.4, near: 1 };
export const TARGET = { col: 23, row: 11 };
export type Cell = { x: number; y: number; w: number; h: number; z: number };
export function cellAt(col: number, row: number): Cell {
  const z = lerp(GRID.far, GRID.near, row / (GRID.rows - 1));
  const size = GRID.pitch / z;
  const cx = DW / 2 + (col - GRID.cols / 2) * size;
  const cy = GRID.horizon + GRID.k / z;
  return { x: cx - size * 0.39, y: cy - size * 0.25, w: size * 0.78, h: size * 0.5, z };
}
export const TARGET_CELL = cellAt(TARGET.col, TARGET.row);
// The titles of the corpus, as tags beside the field, not over its cells.
// The field narrows toward the far rows, so the space left and right of
// them is free: a tag sits there, level with its row, and a short lead
// runs to the field's edge. Title 7, the one the story follows, sits
// over the middle of the far row.
export const REGIONS: Array<{ label: string; side: "left" | "right" | "top"; row: number; own?: true }> = [
  { label: "26 U.S.C. · Internal Revenue Code", side: "left", row: 4 },
  { label: "7 U.S.C. · Agriculture", side: "top", row: 0, own: true },
  { label: "42 U.S.C. · The Public Health and Welfare", side: "right", row: 2 },
];
// the gap a tag keeps from the field, which its lead crosses
export const REGION_LEAD = 26;

// the live timeline, in screens from the start of beat 4
export const U = {
  handIn: [0, 0.6],
  draft1: [0.6, 1.6],
  loop: [1.6, 2.2],
  draft2: [2.2, 3.6],
  t45: [4.0, 4.8],
  marks: [4.8, 8.8],
  t56: [9.1, 9.9],
  flow: [9.9, 12.2],
  t67: [12.5, 13.3],
  registry: [13.3, 14.3],
  t78: [14.3, 15.0],
  beams: [15.0, 16.4],
  end: 17.0,
} as const;

// where each live caption (CAPTIONS[3..7]) takes over
export const CAPTION_AT = [0.3, 4.4, 9.5, 12.9, 14.65];

// ── beat 4: the gates ──
export const STATUTE_CARD = { x: 40, y: 30, w: 460 };
export const GATES = [
  { name: "encode", about: "An AI model drafts the rule" },
  { name: "checks", about: "It compiles, its sources ground, its tests pass" },
  { name: "compare", about: "Against another calculator, where one covers the program" },
  { name: "AI review", about: "One AI model reads the draft" },
] as const;
export const GATE_X = [680, 830, 980, 1130]; // centres
export const GATE_Y = 78; // top
export const GATE_W = 132;
export const GATE_H = 64;
export const RAIL_Y = GATE_Y + GATE_H / 2;
export const DRAFT = { y: 200, w: 300, h: 240 };
export const draftX = (gate: number) => GATE_X[gate] - DRAFT.w / 2;
// the check that sends draft 1 back, from checks round to encode
export const LOOP_D = `M ${GATE_X[1]} ${GATE_Y} C ${GATE_X[1]} 14, ${GATE_X[0]} 14, ${GATE_X[0]} ${GATE_Y}`;

// ── beat 5: the code card ──
export const CODE_CARD = { x: 572, y: 30, w: 668, h: 560 };
export const CODE_BAR = 40;
export const CODE_PAD = 14;
export const ROW_H = 26;
export const CODE_WIN_H = CODE_CARD.h - CODE_BAR;
const LIST_H = CODE_PAD * 2 + CODE.length * ROW_H;
const MAX_PAN = Math.max(0, LIST_H - CODE_WIN_H);
const FOCUS = 0.42;
export const rowIndex = (line: number) => CODE.findIndex((r) => "n" in r && r.n === line);
export const panFor = (line: number) =>
  Math.min(MAX_PAN, Math.max(0, CODE_PAD + rowIndex(line) * ROW_H + ROW_H / 2 - CODE_WIN_H * FOCUS));
// a row's top on the stage, at a pan
export const rowTop = (line: number, pan: number) => CODE_CARD.y + CODE_BAR + CODE_PAD + rowIndex(line) * ROW_H - pan;

// ── beat 6: the graph ──
export const NODE_W = 210;
export const NODE_H = 64;
export const HERO = { w: 190, h: 140 };
export const NODE_AT: Record<GraphNodeId, { x: number; y: number }> = {
  imp2014: { x: 30, y: 20 },
  rate30: { x: 30, y: 130 },
  impUsda: { x: 30, y: 240 },
  size2: { x: 30, y: 350 },
  rate8: { x: 30, y: 460 },
  net: { x: 300, y: 20 },
  minimum: { x: 300, y: 405 },
  contrib: { x: 570, y: 75 },
  before: { x: 840, y: 248 },
  regular: { x: 1070, y: 210 },
};
// when each node takes its test-case value, in screens after the flow
// starts: inputs first, then each rule once what it reads is known
export const NODE_FIRE: Record<GraphNodeId, number> = {
  imp2014: 0.0,
  impUsda: 0.1,
  rate30: 0.2,
  size2: 0.3,
  rate8: 0.4,
  net: 0.75,
  contrib: 1.05,
  minimum: 1.2,
  before: 1.5,
  regular: 1.85,
};

// ── beat 7: the registry ──
// CLUSTERS carry their own map coordinates; this moves them into the stage
export const clusterAt = (c: { x: number; y: number; r: number }) => ({ x: c.x - 120, y: c.y - 120, r: c.r * 0.85 });
export const AMBER = { x: 640, y: 500, r: 34 };

// Beat 7 shows the scope by body of law, not by program or package: the
// acts and codes the 13 core programs sit in, and the kinds of source the
// corpus holds. The Food and Nutrition Act is the lit one, where § 2017(a)
// sits, so it is not in this list. The sizes vary only so the field does
// not read as a grid; they carry no number. (The export keeps its name.)
export const PROGRAMS: Array<{ name: string; x: number; y: number; r: number }> = [
  { name: "Internal Revenue Code", x: 190, y: 128, r: 84 },
  { name: "Social Security Act", x: 520, y: 116, r: 90 },
  { name: "Code of Federal Regulations", x: 852, y: 130, r: 94 },
  { name: "State statutes", x: 1128, y: 190, r: 80 },
  { name: "State regulations", x: 330, y: 372, r: 78 },
  { name: "Agency policy manuals", x: 972, y: 404, r: 74 },
  { name: "Child Nutrition Act", x: 150, y: 470, r: 62 },
];

// ── beat 8: one source, five kinds of user ──
export const SOURCE_CARD = { x: 60, y: 140, w: 380, h: 300 };
export const USER_CARD = { x: 760, w: 480, h: 100, gap: 114, y0: 20 };

// After the RaC Guild deck's OneSourceSlide, as the 3D beat 8 draws it
// (style-frames/lamplight2.ts GROUPS).
export const USERS: Array<{ who: string; items: string[]; href: string }> = [
  { who: "Individuals & navigators", items: ["Benefits screeners, calculators and navigation tools", "Benefit-cliff explorers", "Legal aid assistance"], href: "/demos" },
  { who: "Governments", items: ["The eligibility rules engine inside a state system", "A test oracle to check current rules and workflows", "Policy dashboards and microsimulation"], href: "/validation" },
  { who: "AI systems", items: ["Assistants that call the rules through MCP", "Benefits chatbots grounded in the law", "Model evaluation and rewards"], href: "/docs" },
  { who: "Builders", items: ["A hosted API behind any product", "Embedded libraries — Rust, Python, npm", "Zero-PII WASM, running in the browser"], href: "/docs" },
  { who: "Researchers", items: ["Reproducible analysis, pinned to a dated release", "Reform modeling and forecasting", "Open rules to study and cite"], href: "/coverage" },
];

// ── time helpers ──
export function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}
export function seg(t: number, a: number, b: number) {
  return clamp01((t - a) / (b - a));
}
export function easeOut(x: number) {
  return 1 - Math.pow(1 - x, 3);
}
export function easeInOut(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
