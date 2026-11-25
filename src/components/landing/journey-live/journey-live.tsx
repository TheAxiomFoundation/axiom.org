"use client";

// The encoder section's story, live: all eight beats as real page
// components on one pinned stage. A law book comes off the shelf, opens
// on § 2017, and shrinks into one addressed cell of the corpus; that cell
// becomes the statute card, whose draft passes encode and checks, cites
// its code, runs as a graph, joins the registry and becomes the one source.
//
// Lenis drives the scroll and the GSAP ticker drives Lenis and every
// frame, so there is one clock; each frame is a pure function of scroll,
// and only transform, opacity, SVG stroke and a few text values change.
//
// Copy rules (journey-film.tsx, lamplight2.ts): the failed draft is an
// illustration and says so (the draft's test strip is marked "example");
// only encode and checks are on the rail and only they can pass; the AI
// review is one AI model's read and advisory, and program comparison runs
// separately, both off the rail and with no mark (layout.ts ASIDES); the
// registry numbers carry their snapshot month; nothing says certified,
// signed or sealed. The words that state facts live in copy.ts.
//
// Phones and reduced motion get StaticStory: the same components, one
// beat after another, at rest.

import { useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { CODE, EXPLORE, GRAPH_EDGES, GRAPH_NODES, MARKS, STATUTE } from "../journey-digital/data";
import { CAPTIONS } from "../journey-lamplight/captions";
import {
  AMBER, ASIDE, ASIDES, CAPTION_AT, CAPTION_OPEN, CODE_BAR, CODE_CARD, CODE_PAD, DH, DRAFT, DW, GATE_H, GATE_W, GATE_X, GATE_Y,
  GATES, GRID, LAST_GATE, LOOP_D, NODE_AT, NODE_FIRE, O, OPEN, PAGE, PROGRAMS, RAIL, RAIL_Y, REGIONS, REGION_LEAD, ROW_H, SHELF, SHELVES, WALK, WALK_CUT, toClock, toScroll,
  SOURCE_CARD, SPINE7, SPINES, STATUTE_CARD, TARGET_CELL, U, USER_CARD, USERS, USES_Y, asideAt, asideY, cellAt, clamp01, draftAt, draftX,
  easeInOut, easeOut, edgeD, gateAt, lerp, nodeBox, panFor, rowTop, seg, shelfBase,
} from "./layout";
import { CODE_WAIVER_NOTE, NODE_NAME, OUTPUT_NOTE, SOURCE_ABOUT, STAGE_LABEL, USES_HEADING } from "./copy";
import type { Aisle } from "../style-frames/aisle";
import { PHRASE_PARENT, RULE_LINES, RULE_ROW_H, RULE_STEPS, RULE_THREADS, SUB_PHRASES } from "./rule";
import "../journey-lamplight/journey-lamplight.css";
import "./journey-live.css";

export const TOTAL_S = OPEN + U.end;
// the scroll run is shorter than the clock by the cut in the walk
const RUN_S = TOTAL_S - WALK_CUT;
/** where each of the eight steps starts, on the story's clock */
export const CAPTION_ALL = [...CAPTION_OPEN, ...CAPTION_AT.map((a) => a + OPEN)];
// from this stage width the words move into a column on the left
// (journey-live.css uses the same width)
const SPLIT_MIN = 1100;
// the space between the column and the stage, and at the stage's right
const SIDE_GAP = 40;
// the band of the design height that the beats draw in (shelf, page,
// corpus, cards and graph all sit inside it)
const BAND = [10, 600] as const;

const phraseOf = (id: string) => {
  for (const s of STATUTE) if (typeof s === "object" && "mark" in s && s.mark === id) return s.text;
  return "";
};
const short = (s: string) => (s.length > 30 ? `${s.slice(0, 28).trimEnd()}…` : s);
// a computed rule is called a result (the plain names are in copy.ts)
const KIND_NAME: Record<string, string> = { import: "import", parameter: "parameter", derived: "result", output: "output" };
const MARK_PANS = MARKS.map((m) => panFor(m.line));
const PAN0 = panFor(27);
const ADDRESS = ["us", "statute", "7", "2017", "a"];
// the corpus cells, far rows first so near ones draw over them
const CELLS = Array.from({ length: GRID.rows }, (_, r) => Array.from({ length: GRID.cols }, (_, c) => cellAt(c, r))).flat();
const TCX = TARGET_CELL.x + TARGET_CELL.w / 2;
const TCY = TARGET_CELL.y + TARGET_CELL.h / 2;

// text with the words beat 5 marks on their own (rule.ts) wrapped;
// `within` is the marked phrase the text stands in, or null
function withSubPhrases(text: string, within: string | null): ReactNode {
  for (const sub of SUB_PHRASES) {
    if (sub.within !== within) continue;
    const at = text.indexOf(sub.words);
    if (at < 0) continue;
    return (
      <>
        {withSubPhrases(text.slice(0, at), within)}
        <span data-phrase={sub.id} className="jv-phrase">
          {sub.words}
        </span>
        {withSubPhrases(text.slice(at + sub.words.length), within)}
      </>
    );
  }
  return text;
}

function StatuteText({ marked = true }: { marked?: boolean }) {
  return (
    <>
      {STATUTE.map((s, i) =>
        typeof s === "string" ? (
          <span key={i}>{marked ? withSubPhrases(s, null) : s}</span>
        ) : "em" in s ? (
          <em key={i}>{s.em}</em>
        ) : (
          <span key={i} data-phrase={marked ? s.mark : undefined} className={marked ? "jv-phrase" : undefined}>
            {marked ? withSubPhrases(s.text, s.mark) : s.text}
          </span>
        ),
      )}
    </>
  );
}

const links = (base: string) => ({
  href: (h: string) => (h.startsWith("http") ? h : base + h),
  away: base ? { target: "_blank", rel: "noopener noreferrer" } : {},
});

// `base` makes the page's own links absolute (the standalone preview page)
/**
 * The scroll-driven story. On the landing page the window's scroll drives
 * it. Given a `clock`, it reads the story's time from that instead and
 * takes no scroll of its own: a deck (journey-deck.tsx) owns the clock.
 * `bare` leaves the words out and gives the whole stage to the picture:
 * a slide that frames the story writes the words itself.
 */
export function LiveStory({ base = "", clock, bare = false }: { base?: string; clock?: { current: number }; bare?: boolean }) {
  const { href, away } = links(base);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    const live = liveRef.current;
    if (!track || !stage || !live) return;
    gsap.registerPlugin(ScrollTrigger);

    const $ = <T extends Element>(sel: string) => live.querySelector<T>(sel)!;
    const $$ = <T extends Element>(sel: string) => Array.from(live.querySelectorAll<T>(sel));
    const caps = Array.from(stage.querySelectorAll<HTMLElement>("[data-cap]"));
    const capShown: boolean[] = [];
    const steps = Array.from(stage.querySelectorAll<HTMLElement>("[data-step]"));
    let stepNow = -1;
    const side = stage.querySelector<HTMLElement>(":scope > [data-side]")!;
    // beats 1–3
    const aisleCanvas = stage.querySelector<HTMLCanvasElement>("[data-aisle]")!;
    const spine7 = $<HTMLElement>("[data-spine7]");
    const cover = $<HTMLElement>("[data-cover]");
    const page = $<HTMLElement>("[data-page]");
    const veil = $<HTMLElement>("[data-veil]");
    const scan = $<HTMLElement>("[data-scan]");
    const grid = $<HTMLElement>("[data-grid]");
    const regions = $$<HTMLElement>("[data-region]");
    const cell = $<HTMLElement>("[data-cell]");
    const address = $<HTMLElement>("[data-address]");
    // beats 4–8
    const statute = $<HTMLElement>("[data-statute]");
    const phrases = MARKS.map((m) => $<HTMLElement>(`[data-phrase="${m.id}"]`));
    const dots = $$<HTMLElement>("[data-dot]");
    const gatesBox = $<HTMLElement>("[data-gates]");
    const gates = $$<HTMLElement>("[data-gate]");
    const gateText = gates.map((g) => g.querySelector<HTMLElement>("[data-gate-text]")!);
    const asides = ASIDES.map((a) => $<HTMLElement>(`[data-aside="${a.id}"]`));
    const draft = $<HTMLElement>("[data-draft]");
    const draftName = $<HTMLElement>("[data-draft-name]");
    const draftRate = $<HTMLElement>("[data-draft-rate]");
    const draftTest = $<HTMLElement>("[data-draft-test]");
    const draftVerdict = $<HTMLElement>("[data-draft-verdict]");
    const draftGot = $<HTMLElement>("[data-draft-got]");
    const stream = $<SVGPathElement>("[data-stream]");
    const loop = $<SVGPathElement>("[data-loop]");
    const pulse = $<SVGCircleElement>("[data-pulse]");
    const code = $<HTMLElement>("[data-code]");
    // beat 5: the statute's marked words by id (the address in the card's
    // bar counts as one), each step's tokens, and the row its thread runs to
    const phraseById = new Map<string, HTMLElement>($$<HTMLElement>("[data-phrase]").map((el) => [el.dataset.phrase!, el]));
    const stepPhrases = RULE_STEPS.map((st) => st.phrases.map((id) => phraseById.get(id)!));
    const stepToks = RULE_STEPS.map((_, i) => $$<HTMLElement>(`[data-tok="${i}"]`));
    const ruleRows = $$<HTMLElement>("[data-line]");
    // every token in order, the row each stands in, and one thread for
    // each token a step sets
    const tokEls = $$<HTMLElement>("[data-tok]");
    const tokRow = tokEls.map((el) => el.closest<HTMLElement>("[data-line]")!);
    const threads = $$<SVGPathElement>("[data-thread]");
    const threadStarts = $$<SVGCircleElement>("[data-thread-start]");
    const what = $<HTMLElement>("[data-what]");
    const nodes = GRAPH_NODES.map((n) => $<HTMLElement>(`[data-node="${n.id}"]`));
    const nodeVal = nodes.map((n) => n.querySelector<HTMLElement>("[data-node-value]")!);
    const edgeBase = $$<SVGPathElement>("[data-edge-base]");
    const edgeLit = $$<SVGPathElement>("[data-edge-lit]");
    const amber = $<HTMLElement>("[data-amber]");
    const amberLabel = amber.querySelector<HTMLElement>(".jv-amber__label")!;
    const clusters = $$<HTMLElement>("[data-cluster]");
    const clusterLabels = $$<HTMLElement>("[data-cluster-label]");
    const source = $<HTMLElement>("[data-source]");
    const uses = $<HTMLElement>("[data-uses]");
    const users = $$<HTMLElement>("[data-user]");
    const beams = $$<SVGPathElement>("[data-beam]");
    const beamDots = $$<SVGCircleElement>("[data-beam-dot]");

    // fixed geometry of the graph edges (layout.ts edgeD) and beams
    GRAPH_EDGES.forEach(([a, b], i) => {
      const d = edgeD(a, b);
      edgeBase[i].setAttribute("d", d);
      edgeLit[i].setAttribute("d", d);
    });
    USERS.forEach((_, i) => {
      const x1 = SOURCE_CARD.x + SOURCE_CARD.w;
      const y1 = SOURCE_CARD.y + SOURCE_CARD.h / 2 + (i - 2) * 30;
      const x2 = USER_CARD.x;
      const y2 = USER_CARD.y0 + i * USER_CARD.gap + USER_CARD.h / 2;
      beams[i].setAttribute("d", `M ${x1} ${y1} C ${x1 + 150} ${y1}, ${x2 - 150} ${y2}, ${x2} ${y2}`);
      beamDots[i].setAttribute("cx", String(x2));
      beamDots[i].setAttribute("cy", String(y2));
    });
    const loopLen = loop.getTotalLength();

    // the stage's scale and the screen → design mapping
    let k = 1;
    let statuteH = 0;
    const fit = () => {
      // on a wide screen the side column takes the left; the stage fits
      // the rest, centred in it
      const split = bare || stage.clientWidth >= SPLIT_MIN;
      const sideW = bare ? 0 : split ? side.offsetLeft + side.offsetWidth + SIDE_GAP : 0;
      const padR = bare ? 0 : split ? SIDE_GAP : 0;
      // beside the column, fit the band the beats draw in, not the whole
      // design height, and centre that band on the stage; without it, the
      // caption over the stage keeps the space below the band
      k = Math.min((stage.clientWidth - sideW - padR) / DW, stage.clientHeight / (split ? BAND[1] - BAND[0] + 40 : DH));
      live.style.setProperty("--k", String(k));
      stage.style.setProperty("--side", `${sideW}px`);
      live.style.setProperty("--ox", `${-padR / 2}px`);
      live.style.setProperty("--oy", split ? `${(DH / 2 - (BAND[0] + BAND[1]) / 2) * k}px` : "0px");
      statuteH = statute.offsetHeight;
    };
    fit();

    const texts = new WeakMap<Element, string>();
    const text = (el: Element, s: string) => {
      if (texts.get(el) !== s) {
        el.textContent = s;
        texts.set(el, s);
      }
    };
    const attr = (el: Element, name: string, v: string) => {
      if (el.getAttribute(name) !== v) el.setAttribute(name, v);
    };
    const place = (el: HTMLElement | SVGElement, x: number, y: number, s = 1, o = 1) => {
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
      el.style.opacity = String(o);
    };
    // a plain box from one rect to another (origin top-left)
    const box2 = (el: HTMLElement, w0: number, h0: number, x: number, y: number, w: number, h: number, o: number) => {
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${w / w0}, ${h / h0})`;
      el.style.opacity = String(o);
    };

    // ── the aisle: built once the fonts are in (its spines carry type),
    // drawn only while the opening is on screen and only when it changes
    let aisle: Aisle | null = null;
    let aisleGl: import("three").WebGLRenderer | null = null;
    let aisleKey = "";
    let gone = false;
    const heroBox = { x: PAGE.x + PAGE.w / 2 - 30, y: PAGE.y + PAGE.h / 2 - 70, w: 60, h: 140, ok: false };
    (async () => {
      const [THREE, { buildAisle }, { loadFonts }] = await Promise.all([import("three"), import("../style-frames/aisle"), import("../style-frames/kit")]);
      await loadFonts();
      if (gone) return;
      const gl = new THREE.WebGLRenderer({ canvas: aisleCanvas, antialias: true, alpha: true, powerPreference: "high-performance" });
      gl.outputColorSpace = THREE.SRGBColorSpace;
      gl.toneMapping = THREE.NeutralToneMapping;
      gl.toneMappingExposure = 1.02;
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = THREE.VSMShadowMap;
      gl.setClearColor(0x000000, 0);
      gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      aisleGl = gl;
      aisle = buildAisle("blend");
      aisleCanvas.dataset.ready = "1";
    })();
    const drawAisle = (o: number) => {
      const show = 1 - seg(o, 1.5, 1.9);
      aisleCanvas.style.opacity = String(show);
      if (!aisle || !aisleGl || show <= 0) return heroBox;
      const w = aisleCanvas.clientWidth;
      const h = aisleCanvas.clientHeight;
      const t = seg(o, 0, WALK);
      const turn = 0;
      const key = `${w}x${h}:${t.toFixed(4)}:${turn.toFixed(4)}`;
      if (key !== aisleKey) {
        if (!aisleKey.startsWith(`${w}x${h}:`)) {
          aisleGl.setSize(w, h, false);
          aisle.camera.aspect = w / h;
          aisle.camera.updateProjectionMatrix();
        }
        aisleKey = key;
        aisle.update(t, turn);
        aisleGl.render(aisle.scene, aisle.camera);
        // Title 7's place on screen, in the stage's design pixels
        const c = aisleCanvas.getBoundingClientRect();
        const lb = live.getBoundingClientRect();
        const [x0, y0, x1, y1] = aisle.heroRect();
        heroBox.x = (c.left + x0 * c.width - lb.left) / k;
        heroBox.y = (c.top + y0 * c.height - lb.top) / k;
        heroBox.w = ((x1 - x0) * c.width) / k;
        heroBox.h = ((y1 - y0) * c.height) / k;
        heroBox.ok = true;
      }
      return heroBox;
    };

    const render = (s: number) => {
      const o = s; // the opening's clock
      const u = s - OPEN; // beats 4–8

      caps.forEach((el, j) => {
        const at = CAPTION_ALL[j];
        const next = CAPTION_ALL[j + 1];
        const inn = j === 0 ? 1 : easeOut(seg(s, at, at + 0.25));
        const out = next === undefined ? 1 : 1 - seg(s, next - 0.2, next);
        const v = inn * out;
        el.style.opacity = String(Math.max(0.001, v));
        el.style.setProperty("--dy", `${(1 - inn) * 16 - (1 - out) * 12}px`);
        // only the caption in view takes clicks and focus
        const shown = v > 0.5;
        if (capShown[j] !== shown) {
          capShown[j] = shown;
          el.inert = !shown;
          el.style.pointerEvents = shown ? "auto" : "none";
        }
      });

      let now = 0;
      for (let j = 1; j < CAPTION_ALL.length; j++) if (s >= CAPTION_ALL[j]) now = j;
      if (now !== stepNow) {
        stepNow = now;
        steps.forEach((el, j) => attr(el, "data-on", j < now ? "past" : j === now ? "now" : ""));
      }

      // ── beat 1: the aisle (a 3D scene on its own canvas, see below);
      // the camera goes down it and stops with the end bookcase in view; the
      // light on Title 7 grows. The volume stays in its row. A block the
      // cover's colour then opens from the spine's place on screen into the
      // cover, as a picked item opens into its page, and the room fades.
      const hero = drawAisle(o);
      const morph = easeInOut(seg(o, 1.5, 2.1));
      box2(
        spine7,
        SPINE7.w,
        SPINE7.h,
        lerp(hero.x, PAGE.x, morph),
        lerp(hero.y, PAGE.y, morph),
        lerp(hero.w, PAGE.w, morph),
        lerp(hero.h, PAGE.h, morph),
        (hero.ok ? seg(o, 1.4, 1.5) : seg(o, 1.5, 1.7)) * (1 - seg(o, 2.0, 2.2)),
      );
      // ── beat 2: the cover opens on § 2017; the capture line reads it
      const open = easeInOut(seg(o, ...O.coverOpen));
      cover.style.transform = `translate3d(${PAGE.x}px, ${PAGE.y}px, 0) perspective(1800px) rotateY(${-170 * open}deg)`;
      cover.style.opacity = String(seg(o, 1.95, 2.15) * (1 - seg(o, 2.7, 2.9)));
      const sc = seg(o, ...O.scan);
      veil.style.transform = `translate3d(0, ${sc * 100}%, 0)`;
      scan.style.transform = `translate3d(0, ${sc * (PAGE.h - 4)}px, 0)`;
      scan.style.opacity = String(sc > 0 && sc < 1 ? 1 : 0);
      // ── beat 3: the page shrinks into one cell; the camera pulls back
      const cs = lerp(2.5, 1, easeInOut(seg(o, ...O.pullBack)));
      const into = easeInOut(seg(o, 4.0, 4.5));
      const pS = lerp(1, (TARGET_CELL.w * cs) / PAGE.w, into);
      const pX = lerp(PAGE.x, TCX - (PAGE.w * pS) / 2, into);
      const pY = lerp(PAGE.y, TCY - (PAGE.h * pS) / 2, into);
      place(page, pX, pY, pS, seg(o, 2.3, 2.55) * (1 - seg(o, 4.35, 4.55)));
      const gridOut = 1 - seg(o, OPEN, OPEN + 0.3);
      grid.style.transform = `translate3d(${TCX * (1 - cs)}px, ${TCY * (1 - cs)}px, 0) scale(${cs})`;
      // never fully 0: the grid stays painted, so it never paints mid-scroll
      grid.style.opacity = String(Math.max(0.001, seg(o, 4.15, 4.6) * gridOut));
      regions.forEach((r) => (r.style.opacity = String(seg(o, ...O.labels))));
      address.style.opacity = String(seg(o, 5.2, 5.5) * (1 - seg(o, OPEN, OPEN + 0.2)));
      // the lit cell: in the zoom, then it grows into the statute card
      const hand = easeInOut(seg(u, 0, 0.5));
      cell.style.setProperty("--card", String(seg(u, 0, 0.18)));
      const cw = TARGET_CELL.w * cs;
      const ch = TARGET_CELL.h * cs;
      box2(
        cell,
        TARGET_CELL.w,
        TARGET_CELL.h,
        lerp(TCX - cw / 2, STATUTE_CARD.x, hand),
        lerp(TCY - ch / 2, STATUTE_CARD.y, hand),
        lerp(cw, STATUTE_CARD.w, hand),
        lerp(ch, statuteH || 460, hand),
        seg(o, 4.3, 4.5) * (1 - seg(u, 0.4, 0.6)),
      );
      const box = live.getBoundingClientRect();
      const toD = (x: number, y: number) => ({ x: (x - box.left) / k, y: (y - box.top) / k });

      // ── statute card: grown from the cell, out as the graph forms
      const sIn = easeOut(seg(u, 0.3, 0.55));
      const sOut = easeInOut(seg(u, 9.1, 9.5));
      place(statute, STATUTE_CARD.x - 80 * sOut, STATUTE_CARD.y, 1, sIn * (1 - sOut));
      const sRect = statute.getBoundingClientRect();
      const phraseY = (el: HTMLElement) => {
        const r = el.getClientRects();
        const last = r[r.length - 1];
        return toD(0, last.top + last.height / 2).y;
      };
      const sRight = toD(sRect.right, 0).x;

      // ── beat 4: the gates
      const gOut = easeOut(seg(u, U.t45[0], U.t45[0] + 0.4));
      place(gatesBox, 0, -20 * gOut, 1, (1 - gOut) * easeOut(seg(u, 0.35, 0.7)));
      gates.forEach((g, i) => {
        const st = gateAt(i, u);
        attr(g, "data-state", st.state);
        text(gateText[i], st.text);
      });
      // the steps off the rail never pass: the review reads draft 2 once
      // it has passed checks, and the comparison stands apart throughout
      ASIDES.forEach((a, i) => attr(asides[i], "data-state", asideAt(a.id, u)));
      // the text runs into encode as each draft is written
      const streamDraw = Math.max(easeInOut(seg(u, 0.45, 0.75)) * (1 - seg(u, 0.85, 1.05)), easeInOut(seg(u, 2.05, 2.3)) * (1 - seg(u, 2.4, 2.6)));
      if (streamDraw > 0.001) {
        const y1 = phraseY(phrases[2]);
        const x2 = GATE_X[0] - GATE_W / 2;
        stream.setAttribute("d", `M ${sRight} ${y1} C ${sRight + 60} ${y1}, ${x2 - 60} ${RAIL_Y}, ${x2} ${RAIL_Y}`);
        stream.style.strokeDashoffset = String(1 - easeInOut(Math.min(1, streamDraw * 1.4)));
      }
      stream.style.opacity = String(streamDraw);
      // checks sends draft 1 back round the loop to encode
      const loopOn = easeInOut(seg(u, 1.6, 1.95)) * (1 - seg(u, 2.15, 2.35));
      loop.style.strokeDashoffset = String(1 - easeInOut(seg(u, 1.6, 1.95)));
      loop.style.opacity = String(loopOn);
      const pf = seg(u, 1.65, 2.15);
      const pt = loop.getPointAtLength(loopLen * pf);
      pulse.setAttribute("cx", String(pt.x));
      pulse.setAttribute("cy", String(pt.y));
      pulse.style.opacity = String(pf > 0 && pf < 1 ? 1 : 0);

      // the draft card; at the end of beat 4 it grows into the code card
      // from checks, the last gate it passed
      const d = draftAt(u);
      const grow = easeInOut(seg(u, U.t45[0], U.t45[1]));
      const gx = lerp(draftX(LAST_GATE), CODE_CARD.x, grow);
      const gy = lerp(DRAFT.y, CODE_CARD.y, grow);
      if (u >= U.t45[0]) {
        place(draft, gx, gy, lerp(1, CODE_CARD.w / DRAFT.w, grow), 1 - seg(u, 4.1, 4.5));
      } else if (d) {
        place(draft, d.x, d.y, 1, d.o);
      } else {
        draft.style.opacity = "0";
      }
      const n = u < U.draft2[0] ? 1 : 2;
      text(draftName, `us/statutes/7/2017/a.yaml · draft ${n}`);
      text(draftRate, n === 1 ? "          30" : "          0.30");
      attr(draft, "data-draft", n === 1 ? "1" : "2");
      // the draft's test, in plain words: what the test expects, and what
      // this draft's rule gives
      text(draftVerdict, n === 1 ? "Test fails" : "Test passes");
      text(draftGot, n === 1 ? "$11,595.00" : "$115.95");
      draftTest.style.opacity = String(d?.test || u >= U.t45[0] ? 1 : 0);

      // ── beat 5: the code card and the threads
      const cIn = seg(u, 4.1, 4.5);
      const cOut = easeInOut(seg(u, 9.2, 9.7));
      place(code, gx, gy, u >= U.t45[1] ? 1 : lerp(DRAFT.w / CODE_CARD.w, 1, grow), Math.max(0.001, cIn * (1 - cOut)));
      if (u >= U.t45[1]) code.style.transform = `translate3d(${CODE_CARD.x}px, ${CODE_CARD.y}px, 0) scale(${1 - 0.02 * cOut})`;

      // each step: its words in the statute light, and a thread runs from
      // them to the left side of the row of each token they set; the row
      // lights and the token comes into the rule as the thread arrives
      const m = seg(u, U.marks[0], U.marks[1]) * RULE_STEPS.length;
      const cardLeft = CODE_CARD.x;
      let done = 0;
      let stepOn = -1;
      const markOf = new Map<HTMLElement, number>();
      const activeOf = new Map<HTMLElement, number>();
      const rowLit = new Map<HTMLElement, number>();
      // beat 4 already marks the rate as the draft is written
      markOf.set(phrases[2], easeOut(seg(u, 0.5, 0.8)));
      activeOf.set(phrases[2], u < U.t45[1] ? streamDraw : 0);
      const stepT = RULE_STEPS.map((_, i) => m - i);
      RULE_STEPS.forEach((_, i) => {
        const t = stepT[i];
        const mark = easeOut(seg(t, 0, 0.3));
        const fill = easeOut(seg(t, 0.5, 0.8));
        const leave = easeOut(seg(t, 1, 1.25));
        if (t >= 0.8) done++;
        if (t > 0 && t < 1.1) stepOn = i;
        const active = t > 0 && t < 1.25 ? 1 - leave : 0;
        stepPhrases[i].forEach((el) => {
          markOf.set(el, Math.max(markOf.get(el) ?? 0, mark));
          activeOf.set(el, Math.max(activeOf.get(el) ?? 0, active));
        });
        stepToks[i].forEach((el) => {
          el.style.setProperty("--on", String(fill));
          el.style.setProperty("--hot", String(fill * (1 - leave)));
        });
        dots[i].style.transform = `scale(${0.6 + 0.4 * fill})`;
        dots[i].style.opacity = String(0.25 + 0.75 * fill);
      });
      RULE_THREADS.forEach((th, j) => {
        const t = stepT[th.step];
        const draw = easeInOut(seg(t, 0.12, 0.6));
        const leave = easeOut(seg(t, 1, 1.25));
        const fill = easeOut(seg(t, 0.5, 0.8));
        const row = tokRow[th.tok];
        rowLit.set(row, Math.max(rowLit.get(row) ?? 0, fill * (1 - leave)));
        if (draw * (1 - leave) <= 0.001 || u > U.t56[0]) {
          threads[j].style.opacity = threadStarts[j].style.opacity = "0";
          return;
        }
        // from the end of the step's last words…
        const ph = stepPhrases[th.step];
        const fr = ph[ph.length - 1].getClientRects();
        const lastRect = fr[fr.length - 1];
        const y1 = toD(0, lastRect.top + lastRect.height / 2).y;
        const x1 = sRight;
        // …to the left side of the token's row, at the row's middle. The
        // row lights there and the token lights in it.
        const rr = tokRow[th.tok].getBoundingClientRect();
        const y2 = toD(0, rr.top + rr.height / 2).y;
        const x2 = cardLeft + 9;
        const dx = Math.max(36, (x2 - x1) * 0.5);
        threads[j].setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
        threads[j].style.strokeDashoffset = String(1 - draw);
        threads[j].style.opacity = String(1 - leave);
        threadStarts[j].setAttribute("cx", String(x1));
        threadStarts[j].setAttribute("cy", String(y1));
        threadStarts[j].style.opacity = String(easeOut(seg(t, 0.12, 0.22)) * (1 - leave));
      });
      // a marked word inside a marked phrase is lit when the phrase is
      for (const [child, parent] of Object.entries(PHRASE_PARENT)) {
        const c = phraseById.get(child)!;
        const pa = phraseById.get(parent)!;
        markOf.set(c, Math.max(markOf.get(c) ?? 0, markOf.get(pa) ?? 0));
        activeOf.set(c, Math.max(activeOf.get(c) ?? 0, activeOf.get(pa) ?? 0));
      }
      phraseById.forEach((el) => {
        el.style.setProperty("--mark", String(markOf.get(el) ?? 0));
        el.style.setProperty("--active", String(activeOf.get(el) ?? 0));
      });
      ruleRows.forEach((el) => el.style.setProperty("--lit", String(rowLit.get(el) ?? 0)));
      // what the words in hand set, under the rule
      text(what, stepOn >= 0 ? RULE_STEPS[stepOn].what : done >= RULE_STEPS.length ? "every marked piece, from the sentence" : "");
      what.style.opacity = String(u >= U.marks[0] && u < U.t56[0] ? 1 : 0);

      // ── beat 6: the code lines become the graph's nodes
      const fu = u - U.flow[0];
      GRAPH_NODES.forEach((nd, j) => {
        const el = nodes[j];
        const a = easeInOut(seg(u, 9.15 + 0.05 * j, 9.75 + 0.05 * j));
        const op = seg(u, 9.15 + 0.05 * j, 9.4 + 0.05 * j);
        const at = NODE_AT[nd.id];
        // and later shrink into the amber cluster
        const g = easeInOut(seg(u, U.t67[0] + 0.04 * j, U.t67[0] + 0.45 + 0.04 * j));
        const b = nodeBox(nd.id);
        const x0 = CODE_CARD.x + 64;
        // each node starts from the rule card, down its left side
        const y0 = CODE_CARD.y + CODE_BAR + 24 + j * 44;
        let x = lerp(x0, at.x, a);
        let y = lerp(y0, at.y, a);
        x = lerp(x, AMBER.x - b.w / 2, g);
        y = lerp(y, AMBER.y - b.h / 2, g);
        place(el, x, y, lerp(lerp(0.55, 1, a), 0.12, g), op * (1 - g));
        const fire = NODE_FIRE[nd.id];
        const fired = fu >= fire;
        el.style.setProperty("--fire", String(fired ? 1 - seg(fu, fire, fire + 0.45) : 0));
        attr(el, "data-fired", fired ? "1" : "0");
        // every node, the output too, shows its value once it fires: a
        // count-up from $0 would read as a running sum beside its note
        text(nodeVal[j], fired ? nd.value : "—");
      });
      const eIn = seg(u, 9.7, 9.95);
      const eOut = 1 - seg(u, U.t67[0], U.t67[0] + 0.3);
      GRAPH_EDGES.forEach(([, b], i) => {
        edgeBase[i].style.opacity = String(0.35 * eIn * eOut);
        const f = NODE_FIRE[b];
        const lit = easeInOut(seg(fu, f - 0.3, f - 0.02));
        edgeLit[i].style.strokeDashoffset = String(1 - lit);
        edgeLit[i].style.opacity = String(lit > 0 ? eOut : 0);
      });

      // ── beat 7: the registry, with the graph as one small amber cluster
      const aIn = easeOut(seg(u, 12.85, 13.25));
      const toSrc = easeInOut(seg(u, U.t78[0], U.t78[0] + 0.6));
      const srcX = SOURCE_CARD.x + SOURCE_CARD.w / 2;
      const srcY = SOURCE_CARD.y + SOURCE_CARD.h / 2;
      place(
        amber,
        lerp(AMBER.x, srcX, toSrc) - AMBER.r,
        lerp(AMBER.y, srcY, toSrc) - AMBER.r,
        lerp(0.5, 1, aIn) * lerp(1, 2.4, toSrc),
        aIn * (1 - seg(u, 14.45, 14.75)),
      );
      // the label goes before the cluster grows into the source card
      amberLabel.style.opacity = String(1 - seg(u, U.t78[0], U.t78[0] + 0.12));
      const dim = 1 - 0.88 * seg(u, U.t78[0], U.t78[0] + 0.4);
      const labelsOut = 1 - seg(u, U.t78[0], U.t78[0] + 0.2);
      PROGRAMS.forEach((p, i) => {
        const dist = Math.hypot(p.x - AMBER.x, p.y - AMBER.y) / 900;
        const a = easeOut(seg(u, 13.0 + dist * 0.6, 13.4 + dist * 0.6));
        place(clusters[i], p.x - p.r, p.y - p.r, lerp(0.4, 1, a) * lerp(1, 0.9, 1 - dim), a * dim);
        clusterLabels[i].style.opacity = String(seg(u, 13.5 + dist * 0.4, 13.8 + dist * 0.4) * labelsOut);
      });

      // ── beat 8: the cluster becomes the one source; beams to four
      // potential uses, under their heading
      const scIn = easeOut(seg(u, 14.6, 15.0));
      place(source, SOURCE_CARD.x, SOURCE_CARD.y, lerp(0.92, 1, scIn), scIn);
      const usesIn = easeOut(seg(u, 15.1, 15.4));
      place(uses, USER_CARD.x + 18 * (1 - usesIn), USES_Y, 1, usesIn);
      USERS.forEach((_, i) => {
        const b = easeInOut(seg(u, 15.0 + i * 0.22, 15.35 + i * 0.22));
        beams[i].style.strokeDashoffset = String(1 - b);
        beams[i].style.opacity = String(b > 0 ? 1 : 0);
        beamDots[i].style.opacity = String(seg(u, 15.3 + i * 0.22, 15.35 + i * 0.22));
        const a = easeOut(seg(u, 15.3 + i * 0.22, 15.55 + i * 0.22));
        place(users[i], USER_CARD.x + 18 * (1 - a), USER_CARD.y0 + i * USER_CARD.gap, 1, a);
      });
    };

    // the track: the stage's height plus the scroll the story runs over
    const navH = () => Math.round(document.querySelector("header.nav-bar")?.getBoundingClientRect().height ?? 0);
    const size = () => {
      track.style.setProperty("--nav-h", `${navH()}px`);
      track.style.setProperty("--jl-run", clock ? "0px" : `${Math.round(window.innerHeight * RUN_S)}px`);
    };
    size();

    const lenis = clock ? null : new Lenis({ autoRaf: false, lerp: 0.085, wheelMultiplier: 0.9 });
    lenis?.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => lenis?.raf(time * 1000);
    gsap.ticker.add(raf);
    if (lenis) gsap.ticker.lagSmoothing(0);
    const st = clock
      ? null
      : ScrollTrigger.create({
          trigger: track,
          start: () => `top ${navH()}px`,
          end: () => `+=${Math.round(window.innerHeight * RUN_S)}`,
        });
    // draw only while the story is on screen or near it
    const frame = () => {
      if (clock) return render(Math.min(TOTAL_S, Math.max(0, clock.current)));
      const r = track.getBoundingClientRect();
      if (r.bottom < -window.innerHeight || r.top > window.innerHeight * 2) return;
      render(toClock(clamp01(st!.progress) * RUN_S));
    };
    gsap.ticker.add(frame);
    render(clock ? clock.current : 0);

    const onResize = () => {
      size();
      fit();
      if (!clock) ScrollTrigger.refresh();
    };
    window.addEventListener("resize", onResize);
    // The stage's place depends on the size of the words' column. That
    // size is not final at mount (the styles and fonts can arrive after
    // this runs), and a window resize is not the only thing that changes
    // it, so the fit follows the column and the stage themselves.
    let lastFit = "";
    const refit = new ResizeObserver(() => {
      const key = `${stage.clientWidth}x${stage.clientHeight}:${side.offsetLeft}+${side.offsetWidth}`;
      if (key === lastFit) return;
      lastFit = key;
      onResize();
    });
    refit.observe(stage);
    refit.observe(side);
    document.fonts?.ready.then(() => fit());

    // dev only: jump the story to a point (s, in screens from the pin)
    if (process.env.NODE_ENV !== "production") {
      Object.assign(window, {
        __jvSeek: (s: number) =>
          clock ? (clock.current = s) : lenis!.scrollTo(st!.start + (toScroll(s) / RUN_S) * (st!.end - st!.start), { immediate: true }),
        __jvTotal: { open: OPEN, total: TOTAL_S },
      });
    }

    return () => {
      window.removeEventListener("resize", onResize);
      refit.disconnect();
      gsap.ticker.remove(frame);
      gsap.ticker.remove(raf);
      st?.kill();
      lenis?.destroy();
      gone = true;
      aisle?.dispose();
      aisleGl?.dispose();
    };
  }, [clock, bare]);

  return (
    <>
      <div ref={trackRef} className="jl-track jl--paper jv-track">
        <div ref={stageRef} className="jl-stage jl-stage--paper jv-stage" data-bare={bare ? "" : undefined}>
          {/* beat 1: the library aisle, a 3D scene that fades into the page on every side */}
          <canvas data-aisle className="jv-aisle" aria-hidden />
          <div ref={liveRef} className="jv-live" role="img" aria-label={STAGE_LABEL}>
            {/* beat 1: the block that takes Title 7's place and grows into the cover */}
            <div data-spine7 className="jv-spine7" style={{ width: SPINE7.w, height: SPINE7.h }} />

            {/* beat 2: the page, and the cover that opens over it */}
            <article data-page className="jv-card jv-page" style={{ width: PAGE.w, height: PAGE.h }}>
              <header className="jv-page__head">
                <span>United States Code · Title 7 · Agriculture</span>
                <span>Chapter 51</span>
              </header>
              <h4 className="jv-page__title">§ 2017. Value of allotment</h4>
              <p className="jv-page__text" data-quote>
                <b>(a)</b> <StatuteText marked={false} />
              </p>
              {/* the rest of § 2017, as lines */}
              <div className="jv-page__more" aria-hidden>
                {["(b)", "(c)", "(d)"].map((l, i) => (
                  <p key={l}>
                    <b>{l}</b>
                    <i />
                    <i />
                    <i style={{ width: `${[58, 74, 41][i]}%` }} />
                  </p>
                ))}
              </div>
              <div data-veil className="jv-veil" />
              <div data-scan className="jv-scan" />
            </article>
            <div data-cover className="jv-cover" style={{ width: PAGE.w, height: PAGE.h }}>
              <span className="jv-cover__kicker">United States Code</span>
              <span className="jv-cover__title">Title 7</span>
              <span className="jv-cover__sub">Agriculture</span>
            </div>

            {/* beat 3: the corpus, every provision a cell */}
            <div data-grid className="jv-grid" style={{ width: DW, height: DH }}>
              <svg width={DW} height={DH} aria-hidden>
                {CELLS.map((c, i) => {
                  const near = (1 / c.z - 1 / GRID.far) / (1 - 1 / GRID.far);
                  return (
                    <g key={i} opacity={0.62 + 0.38 * near}>
                      <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={c.w * 0.06} className="jv-cellbox" />
                      <line x1={c.x + c.w * 0.14} x2={c.x + c.w * 0.86} y1={c.y + c.h * 0.36} y2={c.y + c.h * 0.36} className="jv-cellline" strokeWidth={Math.max(0.4, c.h * 0.07)} />
                      <line x1={c.x + c.w * 0.14} x2={c.x + c.w * 0.62} y1={c.y + c.h * 0.64} y2={c.y + c.h * 0.64} className="jv-cellline" strokeWidth={Math.max(0.4, c.h * 0.07)} />
                    </g>
                  );
                })}
              </svg>
              {REGIONS.map((r) => {
                const first = cellAt(0, r.row);
                const last = cellAt(GRID.cols - 1, r.row);
                const mid = first.y + first.h / 2;
                const at =
                  r.side === "left"
                    ? { right: DW - (first.x - REGION_LEAD), top: mid }
                    : r.side === "right"
                      ? { left: last.x + last.w + REGION_LEAD, top: mid }
                      : { left: DW / 2, top: first.y - REGION_LEAD };
                return (
                  <span key={r.label} data-region data-at={r.side} data-own={r.own ? "" : undefined} className="jv-region" style={at}>
                    {r.label}
                  </span>
                );
              })}
            </div>
            <div data-cell className="jv-cell" style={{ width: TARGET_CELL.w, height: TARGET_CELL.h }} />
            <p data-address className="jv-address" style={{ left: TCX - 200, top: TARGET_CELL.y - 46, width: 400 }}>
              {ADDRESS.map((a, i) => (
                <span key={i}>
                  {i > 0 && <i> / </i>}
                  {a}
                </span>
              ))}
            </p>

            <svg className="jv-svg" width={DW} height={DH} aria-hidden>
              <path data-stream pathLength={1} className="jv-wire" />
              <path data-loop d={LOOP_D} pathLength={1} className="jv-wire jv-wire--fail" />
              <circle data-pulse r={4} className="jv-dot jv-dot--fail" />
              {GRAPH_EDGES.map(([a, b]) => (
                <g key={`${a}-${b}`}>
                  <path data-edge-base className="jv-edge" />
                  <path data-edge-lit pathLength={1} className="jv-wire" />
                </g>
              ))}
              {USERS.map((g) => (
                <g key={g.who}>
                  <path data-beam pathLength={1} className="jv-wire jv-wire--beam" />
                  <circle data-beam-dot r={3.5} className="jv-dot" />
                </g>
              ))}
            </svg>

            {/* beat 4–5: the statute */}
            <article data-statute className="jv-card jv-statute" style={{ width: STATUTE_CARD.w }}>
              <div className="jv-bar">
                <span data-phrase="address" className="jv-phrase jv-phrase--bar">
                  us / statute / 7 / 2017 / a
                </span>
              </div>
              <p className="jv-text" data-quote>
                <StatuteText />
              </p>
              <div className="jv-dots" aria-hidden>
                {RULE_STEPS.map((st) => (
                  <span key={st.what} data-dot className="jv-dot-ui" />
                ))}
              </div>
            </article>

            {/* beat 4: the gates a draft must pass on the rail; the AI review
                and program comparison beside it, off the rail and with no mark */}
            <div data-gates className="jv-gates">
              <span className="jv-rail" style={{ top: RAIL_Y, left: RAIL.x0, width: RAIL.x1 - RAIL.x0 }} />
              {GATES.map((g, i) => (
                <div key={g.name} data-gate data-state="idle" className="jv-gate" style={{ left: GATE_X[i] - GATE_W / 2, top: GATE_Y, width: GATE_W, height: GATE_H }}>
                  <span className="jv-gate__name">{g.name}</span>
                  <span data-gate-text className="jv-gate__state">
                    —
                  </span>
                  <span className="jv-gate__mark" aria-hidden />
                </div>
              ))}
              {ASIDES.map((a, i) => (
                <div key={a.id} data-aside={a.id} data-state="idle" className="jv-aside" style={{ left: ASIDE.x, top: asideY(i), width: ASIDE.w, height: ASIDE.h }}>
                  <span className="jv-aside__name">{a.name}</span>
                  <span className="jv-aside__about">{a.about}</span>
                </div>
              ))}
            </div>

            <article data-draft="1" className="jv-card jv-draft" style={{ width: DRAFT.w, height: DRAFT.h }}>
              <div className="jv-bar">
                <span data-draft-name>us/statutes/7/2017/a.yaml · draft 1</span>
              </div>
              <ol className="jv-rows">
                <li><span className="jv-n">13</span><code>- name: snap_household_food_contribution_rate</code></li>
                <li><span className="jv-n">16</span><code>  source: 7 USC 2017(a), &quot;30 per centum&quot;</code></li>
                <li><span className="jv-n">26</span><code>      formula: |-</code></li>
                <li className="jv-rate"><span className="jv-n">27</span><code data-draft-rate>          30</code></li>
              </ol>
              <p data-draft-test className="jv-test">
                <span className="jv-test__head">
                  <b data-draft-verdict>Test fails</b>
                  <i>example</i>
                </span>
                <span className="jv-test__row">
                  <i>The test expects</i>
                  <em>$115.95</em>
                </span>
                <span className="jv-test__row">
                  <i>This draft gives</i>
                  <em data-draft-got>$11,595.00</em>
                </span>
              </p>
            </article>

            {/* beat 5: the code card */}
            <article data-code className="jv-card jv-code" style={{ width: CODE_CARD.w, height: CODE_CARD.h }}>
              <div className="jv-bar">
                <span>rulespec-us / us / statutes / 7 / 2017 / a.yaml</span>
                <span data-code-meta>
                  lines {RULE_LINES[0].n}–{RULE_LINES[RULE_LINES.length - 1].n} · {CODE_WAIVER_NOTE}
                </span>
              </div>
              <ol className="jv-rule">
                {RULE_LINES.map((row) => (
                  <li key={row.n} data-line={row.n} className="jv-line" style={{ height: RULE_ROW_H }}>
                    <span className="jv-n">{row.n}</span>
                    <code className="jv-src">
                      {row.parts.map((part, i) =>
                        typeof part === "string" ? (
                          part
                        ) : (
                          <span key={i} data-tok={part.step} className="jv-tok">
                            {part.t}
                          </span>
                        ),
                      )}
                    </code>
                  </li>
                ))}
              </ol>
              <p data-what className="jv-what" />
            </article>
            {/* beat 5: the threads, over both cards, each to its own token */}
            <svg className="jv-svg jv-svg--over" width={DW} height={DH} aria-hidden>
              {RULE_THREADS.map((th) => (
                <g key={th.tok}>
                  <path data-thread pathLength={1} className="jv-wire jv-wire--thread" />
                  <circle data-thread-start r={3} className="jv-dot" />
                </g>
              ))}
            </svg>

            {/* beat 6: the graph */}
            {GRAPH_NODES.map((nd) => {
              const b = nodeBox(nd.id);
              return (
                <div key={nd.id} data-node={nd.id} data-kind={nd.kind} className={nd.id === "regular" ? "jv-node jv-node--hero" : "jv-node"} style={{ width: b.w, height: b.h }}>
                  <span className="jv-node__kind">{KIND_NAME[nd.kind]}</span>
                  <span className="jv-node__label">{NODE_NAME[nd.id]}</span>
                  <span data-node-value className="jv-node__value">
                    —
                  </span>
                  {/* the output takes the greater of its two inputs; shown once it fires */}
                  {nd.id === "regular" && <span className="jv-node__note">{OUTPUT_NOTE}</span>}
                </div>
              );
            })}

            {/* beat 7: the scope, program by program */}
            {PROGRAMS.map((p) => (
              <div key={p.name} data-cluster className="jv-cluster" style={{ width: p.r * 2, height: p.r * 2 }}>
                <span data-cluster-label className="jv-cluster__label">
                  {p.name}
                </span>
              </div>
            ))}
            <div data-amber className="jv-amber" style={{ width: AMBER.r * 2, height: AMBER.r * 2 }}>
              <span className="jv-amber__label">
                Food and Nutrition Act
                <i>§ 2017(a)</i>
              </span>
            </div>

            {/* beat 8: one source, four potential uses */}
            <article data-source className="jv-card jv-source" style={{ width: SOURCE_CARD.w, height: SOURCE_CARD.h }}>
              <span className="jv-kicker">One source</span>
              <h3 className="jv-source__title">Encoded, cited rules</h3>
              <p className="jv-source__about">{SOURCE_ABOUT}</p>
              <div className="jv-chips">
                {["App", "API", "MCP", "Rust · Python · npm", "WASM"].map((c) => (
                  <span key={c} className="jv-chip-ui">
                    {c}
                  </span>
                ))}
              </div>
            </article>
            <h4 data-uses className="jv-kicker jv-uses">
              {USES_HEADING}
            </h4>
            {USERS.map((g) => (
              <a key={g.who} data-user href={href(g.href)} {...away} className="jv-card jv-user" style={{ width: USER_CARD.w, height: USER_CARD.h }}>
                <span className="jv-user__who">{g.who}</span>
                <span className="jv-user__items">{g.items.join(" · ")}</span>
              </a>
            ))}
          </div>

          {/* the words for each beat: on a wide screen a column on the left
              (the stage moves into the space to its right), with what the
              beat shows and a link to open it; on a narrower one, the title
              alone over the stage */}
          <div data-side className="jv-side">
            {CAPTIONS.map((c, j) => {
              const e = EXPLORE[j];
              const external = e.href.startsWith("http");
              return (
                <div key={c.kicker} data-cap className="jl-cap jv-cap">
                  <span className="jl-title">{c.title}</span>
                  <span className="jv-cap__about">{e.about}</span>
                  <a className="jv-cap__go" href={href(e.href)} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : away)}>
                    {e.go} →
                  </a>
                </div>
              );
            })}
            <div className="jv-steps" aria-hidden>
              {CAPTIONS.map((c) => (
                <i key={c.kicker} data-step />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Phones and reduced motion: every beat at rest, one after another, with
// the same components and the same copy.
export function StaticStory({ base = "" }: { base?: string }) {
  const { href, away } = links(base);
  // the first spines of the U.S. Code shelf, Title 7 among them
  const strip = SPINES.filter((sp) => sp.row === 0).slice(0, 15);
  const byFire = [...GRAPH_NODES].sort((a, b) => NODE_FIRE[a.id] - NODE_FIRE[b.id]);
  const beat = (i: number, visual: ReactNode) => (
    <figure key={i} className="js-beat">
      <div className="js-visual">{visual}</div>
      <figcaption>
        <span className="js-n">{i + 1} / 8</span>
        <span className="js-title">{CAPTIONS[i].title}</span>
        <span className="js-about">{EXPLORE[i].about}</span>
        <a className="js-go" href={href(EXPLORE[i].href)} {...(EXPLORE[i].href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : away)}>
          {EXPLORE[i].go} →
        </a>
      </figcaption>
    </figure>
  );
  return (
    <>
      <div className="js-story">
        {beat(
          0,
          <div className="js-shelf" role="img" aria-label="A law library: a shelf of the United States Code, with Title 7, Agriculture, marked.">
            <div className="js-shelf__row">
              {strip.map((sp, i) => (
                <span key={i} className={sp.title7 ? "jv-spine js-spine js-spine--7" : "jv-spine js-spine"} data-set={sp.set} style={{ height: sp.h * 0.8 }}>
                  <i>{sp.label}</i>
                </span>
              ))}
            </div>
            <span className="js-shelf__label">{SHELVES[0].label}</span>
          </div>,
        )}
        {beat(
          1,
          <article className="js-card js-page">
            <span className="js-meta">United States Code · Title 7 · Agriculture</span>
            <h4>§ 2017. Value of allotment</h4>
            <p data-quote>
              <b>(a)</b> <StatuteText marked={false} />
            </p>
          </article>,
        )}
        {beat(
          2,
          <div className="js-card js-address">
            <span className="js-meta">7 U.S.C. · Agriculture</span>
            <p>
              {ADDRESS.map((a, i) => (
                <span key={i}>
                  {i > 0 && <i> / </i>}
                  <b>{a}</b>
                </span>
              ))}
            </p>
          </div>,
        )}
        {beat(
          3,
          <div className="js-card">
            {/* the gates a draft must pass, each ticked */}
            <ol className="js-gates">
              {GATES.map((g) => (
                <li key={g.name}>
                  <span className="js-gate">{g.name}</span>
                  <span className="js-gate__about">{g.about}</span>
                  <span className="js-gate__ok">✓</span>
                </li>
              ))}
            </ol>
            {/* below a dashed rule, the steps off the rail, with no tick */}
            <ul className="js-asides">
              {ASIDES.map((a) => (
                <li key={a.id}>
                  <span className="js-aside">{a.name}</span>
                  <span className="js-gate__about">{a.about}</span>
                </li>
              ))}
            </ul>
          </div>,
        )}
        {beat(
          4,
          <ol className="js-card js-cites">
            {MARKS.map((m) => {
              const row = CODE.find((r) => "n" in r && r.n === m.line) as { n: number; text: string };
              return (
                <li key={m.id}>
                  <span className="js-phrase" data-quote>“{phraseOf(m.id)}”</span>
                  <code>
                    {m.line} · {row.text.trim()}
                  </code>
                </li>
              );
            })}
          </ol>,
        )}
        {beat(
          5,
          <div className="js-card">
            <ol className="js-nodes">
              {byFire.map((nd) => (
                <li key={nd.id} className={nd.id === "regular" ? "js-node js-node--hero" : "js-node"}>
                  <span className="js-node__label">
                    {NODE_NAME[nd.id]}
                    {nd.id === "regular" && <span className="js-node__note">{OUTPUT_NOTE}</span>}
                  </span>
                  <b>{nd.value}</b>
                </li>
              ))}
            </ol>
          </div>,
        )}
        {beat(
          6,
          <div className="js-card">
            <ul className="js-clusters">
              <li className="js-cluster--amber">Food and Nutrition Act · § 2017(a)</li>
              {PROGRAMS.map((p) => (
                <li key={p.name}>{p.name}</li>
              ))}
            </ul>
          </div>,
        )}
        {beat(
          7,
          <div className="js-source">
            <article className="js-card">
              <span className="jv-kicker">One source</span>
              <h4>Encoded, cited rules</h4>
              <p>{SOURCE_ABOUT}</p>
            </article>
            <h4 className="jv-kicker js-uses">{USES_HEADING}</h4>
            {USERS.map((g) => (
              <a key={g.who} href={href(g.href)} {...away} className="js-card js-user">
                <b>{g.who}</b>
                <span>{g.items.join(" · ")}</span>
              </a>
            ))}
          </div>,
        )}
      </div>
    </>
  );
}

export function JourneyLive({ base = "" }: { base?: string }) {
  const [mode, setMode] = useState<"static" | "live">("static");
  useEffect(() => {
    const mm = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
    if (mm("(min-width: 900px) and (min-height: 560px)") && !mm("(prefers-reduced-motion: reduce)")) setMode("live");
  }, []);
  return mode === "live" ? <LiveStory base={base} /> : <StaticStory base={base} />;
}
