// The live journey's layout and clock. Beats 4–8 are drawn as page
// components on one stage of fixed design size, scaled to fit the screen,
// so every position below is a design pixel and every frame is a pure
// function of scroll.
//
// The clock runs in screens of scroll ("u"), starting where the 3D opening
// (beats 1–3) hands over on the corpus address. Each transition carries one
// element into the next beat: the draft becomes the code card, the code
// lines become the graph's nodes, the graph becomes an amber cluster among
// other bodies of law, and that cluster becomes the one source card.

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
// The walk down the aisle fills the clock from 0 to WALK, but it takes only
// WALK - WALK_CUT screens of scroll: the walk plays faster than the rest,
// and every later moment keeps its place on the clock.
export const WALK = 1.45;
export const WALK_CUT = 0.7;
/** screens of scroll → the story's clock */
export const toClock = (x: number) => (x < WALK - WALK_CUT ? (x * WALK) / (WALK - WALK_CUT) : x + WALK_CUT);
/** the story's clock → screens of scroll */
export const toScroll = (s: number) => (s < WALK ? (s * (WALK - WALK_CUT)) / WALK : s - WALK_CUT);
// where the opening's captions (CAPTIONS[0..2]) take over
// (the second waits until the book is off the shelf and starts to open:
// a deck rests on the closed book, with the first words still up)
export const CAPTION_OPEN = [0, 2.45, 4.1];

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

// Where each of the eight steps is at rest, on the story's clock (OPEN + u
// from beat 4 on): its picture is complete and the move to the next step
// has not started. A deck stops here after each step (journey-deck.tsx).
// The encoder step (its drafts, the check that sends one back) plays at
// this share of a deck's pace: there is more to read in it.
export const ENCODER_PACE = 0.5;
export const REST_AT = [
  2.2, // Title 7 is off the shelf, closed; its cover opens from 2.3
  3.8, // the page is captured; the pull back to the corpus starts at 4.0
  5.85, // the corpus, its regions and the address; the field goes at OPEN
  OPEN + 3.85, // draft 2 is through the checks; t45 starts at 4.0
  OPEN + 9.0, // every part of the rule is traced; t56 starts at 9.1
  OPEN + 12.4, // the graph has run; t67 starts at 12.5
  OPEN + 14.25, // every body of law is named; t78 starts at 14.3
  OPEN + U.end,
];

// ── beat 4: the gates ──
// The rail holds the steps a draft must pass before the encoder applies
// it, and only those (axiom-encode caa46624, 2026-11-24): encode writes the
// draft, and checks run the RuleSpec CI run's compile, executable-test and
// source-grounding checks on it (validator_pipeline _run_rulespec_ci, whose
// _run_rulespec_ci_impl carries that docstring, in
// the overlay validation in cmd_encode, built with oracles off and
// reviewers skipped). A draft that fails checks goes back to encode. The
// gate names the checks, not what they prove: grounding skips some numbers
// (see data.ts).
export const STATUTE_CARD = { x: 40, y: 30, w: 460 };
export const GATES = [
  { name: "encode", about: "An AI model drafts the rule" },
  { name: "checks", about: "It passes compile, grounding and test checks" },
] as const;
// Two more steps sit off the rail, so neither reads as one the draft must
// pass, and neither ever shows a pass. The AI review reads a draft once
// its first compile and CI checks pass (evals.py), before apply-time
// repairs and the overlay validation check the draft again (cli.py
// _run_encode_attempt), so the overlay can still reject a reviewed draft.
// Its verdict stops nothing unless the encoder runs with --require-review,
// which is off by default and which no signed or CI workflow sets (cli.py),
// so the aside says "by default". Comparisons never run inside
// encode or apply (the overlay validation builds its pipeline with oracles
// off). axiom-oracles runs them apart, each suite on the outputs it names:
// a whole benefit in some, one credit or a tax before credits in others
// (us-savers-grid.yaml compares the saver's credit before the section 26
// limit). At axiom-oracles c599a7d8, 17 of its 192 suites run in the
// weekly matrix and 6 in the weekly SNAP QC replay; the rest run by hand.
// So the aside claims no scope and no schedule.
export const ASIDES = [
  { id: "review", name: "AI review · advisory", about: "One AI model reads the draft. By default, its verdict does not stop the draft." },
  { id: "compare", name: "Comparison", about: "Runs separately, on selected outputs, where another calculator covers them" },
] as const;
export type AsideId = (typeof ASIDES)[number]["id"];
export const GATE_X = [680, 830]; // centres
export const GATE_Y = 78; // top
export const GATE_W = 132;
export const GATE_H = 64;
export const RAIL_Y = GATE_Y + GATE_H / 2;
// the rail runs under encode and checks, and stops short of the asides
export const RAIL = { x0: GATE_X[0] - 40, x1: GATE_X[GATE_X.length - 1] + 80 };
export const DRAFT = { y: 200, w: 300, h: 240 };
export const draftX = (gate: number) => GATE_X[gate] - DRAFT.w / 2;
// the gate a passing draft stops at, and grows into the code card from
export const LAST_GATE = GATE_X.length - 1;
// the off-rail steps: a column right of the draft, below the rail's row
export const ASIDE = { x: 1010, w: 240, h: 96, gap: 16, y0: DRAFT.y };
export const asideY = (i: number) => ASIDE.y0 + i * (ASIDE.h + ASIDE.gap);
// the check that sends draft 1 back, from checks round to encode
export const LOOP_D = `M ${GATE_X[1]} ${GATE_Y} C ${GATE_X[1]} 14, ${GATE_X[0]} 14, ${GATE_X[0]} ${GATE_Y}`;

// Draft 2 goes from encode to checks in one soft move, as draft 1 did, and
// stops there: once it passes checks it is applied, and at t45 it grows
// into the code card from that gate.
export const MOVE2 = [2.45, 2.95] as const;
// Draft 2's own tests pass as it reaches checks (its test strip), and the
// AI review reads it while checks are still at work: encode runs the
// review after the first compile and CI checks and before the overlay
// checks the draft again, so checks pass only after the review has read
// it. Draft 1 never reaches the review: the encoder skips it when the
// first checks reject a draft.
export const REVIEW_READ = [3.0, 3.4] as const;
export const CHECKS_PASS = 3.55;

/** the draft card at u: where it is, which draft it holds, and whether its test shows */
export function draftAt(u: number) {
  if (u < U.draft1[0] || (u >= U.draft1[1] && u < U.draft2[0])) return null;
  if (u < U.draft2[0]) {
    const form = easeOut(seg(u, 0.6, 0.8));
    const x = lerp(draftX(0), draftX(1), easeInOut(seg(u, 0.8, 1.2)));
    const drop = easeOut(seg(u, 1.38, 1.6));
    return { n: 1, x, y: DRAFT.y + 28 * drop, o: form * (1 - drop), test: u >= 1.2 };
  }
  const form = easeOut(seg(u, 2.2, 2.45));
  const p = easeInOut(seg(u, MOVE2[0], MOVE2[1]));
  return { n: 2, x: lerp(draftX(0), draftX(LAST_GATE), p), y: DRAFT.y, o: form, test: p >= 1 };
}

export type GateState = "idle" | "active" | "done" | "pass" | "fail";
/** a gate on the rail at u: its state (which sets its mark) and its line */
export function gateAt(i: number, u: number): { state: GateState; text: string } {
  if (i === 0) {
    const on = (u >= 0.55 && u < 0.85) || (u >= 2.05 && u < MOVE2[0] + 0.05);
    return { state: on ? "active" : u >= 0.6 ? "done" : "idle", text: u < 0.6 ? "waiting" : u < 2.2 ? "draft 1" : "draft 2" };
  }
  if (u >= 1.2 && u < 2.2) return { state: "fail", text: u < 1.6 ? "test 1 fails" : "sent back" };
  // at work as draft 2 comes up to it and while the review reads it,
  // passed once the overlay's checks are through
  if (u >= CHECKS_PASS) return { state: "pass", text: "passes" };
  const p = seg(u, MOVE2[0], MOVE2[1]);
  return { state: p >= 0.5 ? "active" : "idle", text: "—" };
}

// An aside has no pass state, and its markup has no mark to draw one.
export type AsideState = "idle" | "active" | "aside";
/** an off-rail step at u: the review waits, reads draft 2, then stands aside; the comparison stands apart throughout */
export function asideAt(id: AsideId, u: number): AsideState {
  if (id === "compare") return "aside";
  if (u < REVIEW_READ[0]) return "idle";
  return u < REVIEW_READ[1] ? "active" : "aside";
}

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
// The band of the design height the beats draw in: shelf, page, corpus,
// cards and graph all sit inside it, and a split or bare stage fits it.
export const BAND = [10, 600] as const;
export const NODE_AT: Record<GraphNodeId, { x: number; y: number }> = {
  imp2014: { x: 30, y: 20 },
  rate30: { x: 30, y: 120 },
  impUsda: { x: 30, y: 220 },
  impTfp: { x: 30, y: 320 },
  size2: { x: 30, y: 420 },
  rate8: { x: 30, y: 520 },
  net: { x: 300, y: 20 },
  minimum: { x: 300, y: 405 },
  contrib: { x: 570, y: 75 },
  before: { x: 840, y: 248 },
  regular: { x: 1070, y: 210 },
};
export const nodeBox = (id: GraphNodeId) => (id === "regular" ? HERO : { w: NODE_W, h: NODE_H });
// An edge leaves its source's right middle and enters its target's left
// middle. The output takes its two inputs at their own heights: the $182
// line straight across from the card beside it, the $24 line lower, so it
// runs below that card instead of behind it and reaches the output alone.
const IN_DY: Partial<Record<GraphNodeId, Partial<Record<GraphNodeId, number>>>> = { regular: { minimum: 50 } };
/** the path of the graph edge from a to b */
export function edgeD(a: GraphNodeId, b: GraphNodeId) {
  const p = { x: NODE_AT[a].x + nodeBox(a).w, y: NODE_AT[a].y + nodeBox(a).h / 2 };
  const q = { x: NODE_AT[b].x, y: NODE_AT[b].y + nodeBox(b).h / 2 + (IN_DY[b]?.[a] ?? 0) };
  const dx = Math.max(30, (q.x - p.x) * 0.5);
  return `M ${p.x} ${p.y} C ${p.x + dx} ${p.y}, ${q.x - dx} ${q.y}, ${q.x} ${q.y}`;
}
// when each node takes its test-case value, in screens after the flow
// starts: inputs first, then each rule once what it reads is known
export const NODE_FIRE: Record<GraphNodeId, number> = {
  imp2014: 0.0,
  impUsda: 0.08,
  impTfp: 0.16,
  rate30: 0.24,
  size2: 0.32,
  rate8: 0.4,
  net: 0.75,
  contrib: 1.05,
  minimum: 1.2,
  before: 1.5,
  regular: 1.85,
};

// ── beat 7: the scope, by body of law ──
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

// ── beat 8: one source, four potential uses ──
export const SOURCE_CARD = { x: 60, y: 140, w: 380, h: 300 };
export const USER_CARD = { x: 760, w: 480, h: 108, gap: 130, y0: 64 };
// the "Potential uses" heading over the four branches (11px type)
export const USES_Y = 34;

// The four kinds of tool, in the words of the journey film's last slide
// (style-frames/lamplight2.ts GROUPS). They are uses the rules could
// serve, so the stage heads them "Potential uses".
export const USERS: Array<{ who: string; items: string[]; href: string }> = [
  { who: "AI tools", items: ["The chatbots and assistants residents and staff already ask"], href: "/docs" },
  { who: "Government tools", items: ["Eligibility systems, caseworker guidance and training, and policy changes tested before they land"], href: "/validation" },
  { who: "Navigation tools", items: ["Community screeners and navigators that say what to apply for"], href: "/demos" },
  { who: "Research tools", items: ["Microsimulation and policy analysis that show how a change reaches households and budgets"], href: "/coverage" },
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
