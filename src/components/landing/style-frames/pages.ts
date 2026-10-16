// Printed pages for the style frames: § 2017(a) and chapter 51's
// contents, drawn on paper with a little fibre, for use as textures.

import { STATUTE } from "../journey-digital/data";
import * as THREE from "three";
import { canvasTexture, fbm, fontVar, grainField, noise2, paragraph } from "./kit";

const PAPER = "#efe5d2";
const INK = "#2a2118";

export const STATUTE_TEXT = STATUTE.map((s) => (typeof s === "string" ? s : "mark" in s ? s.text : s.em)).join("");

// chapter 51's contents, for the left-hand page
const CONTENTS: Array<[string, string]> = [
  ["2011", "Congressional declaration of policy"],
  ["2012", "Definitions"],
  ["2013", "Establishment of program"],
  ["2014", "Eligible households"],
  ["2015", "Eligibility disqualifications"],
  ["2016", "Issuance and use of benefits"],
  ["2017", "Value of allotment"],
  ["2018", "Approval of retail food stores"],
  ["2019", "Redemption of benefits"],
  ["2020", "Administration"],
];

export function paperFibre(g: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const nn = noise2(5);
  const fibre = grainField("fibre", w, h, (x, y) => (fbm(nn, x / 90, y / 90, 3) - 0.5) * 14 + (nn(x * 1.7, y * 1.7) - 0.5) * 6);
  void seed;
  const n = noise2(seed);
  const img = g.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = fibre[y * w + x];
      img.data[i] += v;
      img.data[i + 1] += v;
      img.data[i + 2] += v * 0.9;
    }
  }
  g.putImageData(img, 0, 0);
}

// where "30 per centum" was printed on the last statute page drawn,
// word by word, in texture pixels
export const hot: Array<{ x: number; y: number; w: number }> = [];

export function statutePage(seed: number, glow: boolean) {
  hot.length = 0;
  const w = 1024;
  const h = 1408;
  const serif = fontVar("--font-serif");
  const mono = fontVar("--font-mono");
  return canvasTexture(w, h, (g) => {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, h);
    paperFibre(g, w, h, seed);
    g.fillStyle = INK;
    g.globalAlpha = 0.55;
    g.font = `500 20px ${mono}`;
    g.fillText("UNITED STATES CODE · TITLE 7 · CHAPTER 51", 96, 130);
    g.globalAlpha = 0.92;
    g.font = `400 50px ${serif}`;
    g.fillText("§ 2017. Value of allotment", 96, 210);
    g.globalAlpha = 0.8;
    g.font = `italic 400 34px ${serif}`;
    g.fillText("(a) Calculation", 96, 270);
    g.globalAlpha = 0.86;
    g.font = `400 31px ${serif}`;
    paragraph(g, STATUTE_TEXT, 96, 340, w - 192, 50, {
      phrase: "30 per centum",
      paint: (gg, x, y, ww, word) => {
        hot.push({ x, y, w: ww });
        if (glow) {
          gg.save();
          gg.globalAlpha = 0.22;
          gg.fillStyle = "#ff9a2e";
          gg.fillRect(x - 4, y - 32, ww + 8, 44);
          gg.restore();
        }
        gg.save();
        gg.fillStyle = "#b4530a";
        gg.fillText(word, x, y);
        gg.restore();
      },
    });
    g.globalAlpha = 0.45;
    g.font = `400 26px ${serif}`;
    g.fillText("— 2017 —", w / 2 - 50, h - 80);
  });
}

export function contentsPage(seed: number) {
  const w = 1024;
  const h = 1408;
  const serif = fontVar("--font-serif");
  const mono = fontVar("--font-mono");
  return canvasTexture(w, h, (g) => {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, h);
    paperFibre(g, w, h, seed);
    g.fillStyle = INK;
    g.globalAlpha = 0.55;
    g.font = `500 20px ${mono}`;
    g.fillText("TITLE 7 · CHAPTER 51", 96, 130);
    g.globalAlpha = 0.9;
    g.font = `400 42px ${serif}`;
    g.fillText("Supplemental Nutrition", 96, 200);
    g.fillText("Assistance Program", 96, 252);
    g.globalAlpha = 0.5;
    g.fillRect(96, 290, w - 192, 2);
    CONTENTS.forEach(([no, t], i) => {
      const y = 370 + i * 74;
      g.globalAlpha = no === "2017" ? 1 : 0.72;
      g.fillStyle = no === "2017" ? "#b4530a" : INK;
      g.font = `500 26px ${mono}`;
      g.fillText(`§ ${no}`, 96, y);
      g.font = `400 31px ${serif}`;
      g.fillText(t, 230, y);
    });
  });
}


// ── the book's pages, typeset ───────────────────────────────────────
//
// One layout for every page of the volume: a running head (the section
// number on the outer side), a wider margin at the gutter that changes
// sides between recto and verso, justified serif text with a first-line
// indent, section headings ("§ 2017. Value of allotment") and subsection
// headings in italic. Text flows from page to page, so a leaf's back
// continues its front.

const PW = 1024;
const PH = 1408;
const MARGIN = { top: 168, bottom: 112, inner: 128, outer: 100 };
const BODY_PX = 29;
const LEAD = 44;
const HEAD_PX = 39;
const HEAD_LEAD = 50;

export type Side = "recto" | "verso";

type Word = { text: string; font: string; color: string; w: number };
type Line = { words: Word[]; indent: number; justify: boolean; lead: number; gapBefore: number; section: string };

let paperBase: HTMLCanvasElement | null = null;
function paperCanvas() {
  if (paperBase) return paperBase;
  const c = document.createElement("canvas");
  c.width = PW;
  c.height = PH;
  const g = c.getContext("2d")!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, PW, PH);
  paperFibre(g, PW, PH, 5);
  paperBase = c;
  return c;
}

// a section's text as paragraphs: a new paragraph at each subsection whose
// heading the corpus gives ("(a) Calculation …"), and at numbered
// paragraphs that open a new sentence
function paragraphsOf(raw: string, subheads: Record<string, string> = {}) {
  // the corpus keeps a space inside some brackets: "[ 42 U.S.C. … ]"
  const text = raw.replace(/([[(]) /g, "$1").replace(/ ([\])])/g, "$1");
  const cuts = new Set<number>();
  Object.entries(subheads).forEach(([k, h]) => {
    const i = text.indexOf(`(${k}) ${h}`);
    if (i > 0) cuts.add(i);
  });
  const re = /(?<=[.;:] )\((?:[a-z]|\d+|[A-Z])\) (?=[A-Z\u201c"])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) cuts.add(m.index);
  const at = [0, ...[...cuts].sort((a, b) => a - b), text.length];
  const out: Array<{ text: string; head?: string; label?: string }> = [];
  for (let i = 0; i < at.length - 1; i++) {
    const p = text.slice(at[i], at[i + 1]).trim();
    if (!p) continue;
    const hm = p.match(/^\(([a-z])\) /);
    const head = hm ? subheads[hm[1]] : undefined;
    if (head && p.startsWith(`(${hm![1]}) ${head}`)) {
      out.push({ label: `(${hm![1]})`, head, text: p.slice(`(${hm![1]}) ${head}`.length).trim() });
    } else out.push({ text: p });
  }
  return out;
}

export type FlowPart =
  | { section: { no: string; heading: string; body: string; subheads?: Record<string, string> }; withHeading?: boolean }
  | { continuation: { no: string; text: string; subheads?: Record<string, string> } };

// set the parts into lines, then into as many pages as `sides` asks for;
// text past the last page is left off, as a page break would
export function typesetPages(parts: FlowPart[], sides: Side[], opts: { hot?: string } = {}): THREE.CanvasTexture[] {
  const serif = fontVar("--font-serif");
  const mono = fontVar("--font-mono");
  const fBody = `400 ${BODY_PX}px ${serif}`;
  const fItal = `italic 400 ${BODY_PX}px ${serif}`;
  const fHead = `400 ${HEAD_PX}px ${serif}`;
  const ink = "rgba(42, 33, 24, 0.88)";
  const hotInk = "#b4530a";
  const meas = document.createElement("canvas").getContext("2d")!;
  const measure = (text: string, font: string) => {
    meas.font = font;
    return meas.measureText(text).width;
  };
  const colW = PW - MARGIN.inner - MARGIN.outer;
  const lines: Line[] = [];
  const hotWords = opts.hot ? opts.hot.split(" ") : [];

  const setWords = (words: Word[], indent: number, section: string, gapBefore: number, lead: number, justifyLast: boolean) => {
    const space = measure(" ", words[0]?.font ?? fBody);
    let cur: Word[] = [];
    let w = indent;
    let first = true;
    const flush = (last: boolean) => {
      if (!cur.length) return;
      lines.push({ words: cur, indent: first ? indent : 0, justify: !last || justifyLast, lead, gapBefore: first ? gapBefore : 0, section });
      first = false;
      cur = [];
      w = 0;
    };
    const queue = [...words];
    while (queue.length) {
      const wd = queue.shift()!;
      const add = (cur.length ? space : 0) + wd.w;
      if (w + add > colW && cur.length) {
        const cut = hyphenate(wd, colW - w - space);
        if (cut) {
          cur.push(cut[0]);
          queue.unshift(cut[1]);
          flush(false);
          continue;
        }
        flush(false);
      }
      w += (cur.length ? space : 0) + wd.w;
      cur.push(wd);
    }
    flush(true);
  };

  // split a long word at a syllable break (vowel then consonant, or two
  // consonants) so its first part fits the room left on the line
  const VOWEL = /[aeiouy]/i;
  const DIGRAPH = new Set(["th", "ch", "sh", "ph", "wh", "ck", "qu", "gh", "ng"]);
  const ONSET = new Set(["pr", "br", "tr", "dr", "cr", "gr", "fr", "bl", "cl", "fl", "gl", "pl", "sl", "sc", "sp", "st", "sk", "sm", "sn", "sw", "tw", "qu"]);
  const hyphenate = (wd: Word, room: number): [Word, Word] | null => {
    const m = wd.text.match(/^([A-Za-z]{7,})([^A-Za-z]*)$/);
    if (!m || room < 60) return null;
    const core = m[1];
    for (let i = core.length - 3; i >= 3; i--) {
      const a = core[i - 1];
      const b = core[i];
      const pair = (a + b).toLowerCase();
      const next = core.slice(i, i + 2).toLowerCase();
      // vowel | consonant, when the consonant opens the next syllable alone
      // or with its cluster ("pro-gram", "pre-scribe")
      const vc = VOWEL.test(a) && !VOWEL.test(b) && (VOWEL.test(core[i + 1] ?? "") || ONSET.has(next) || DIGRAPH.has(next));
      // consonant | consonant, never inside a cluster ("deter-mined")
      const cc = !VOWEL.test(a) && !VOWEL.test(b) && !ONSET.has(pair) && !DIGRAPH.has(pair);
      if (!vc && !cc) continue;
      if (core.length - i < 4 || /^(es|ed|er|s)$/i.test(core.slice(i))) continue;
      const head = core.slice(0, i) + "-";
      const hw = measure(head, wd.font);
      if (hw <= room) {
        const tail = core.slice(i) + m[2];
        return [
          { ...wd, text: head, w: hw },
          { ...wd, text: tail, w: measure(tail, wd.font) },
        ];
      }
    }
    return null;
  };

  const toWords = (text: string, font: string, color: string) =>
    text.split(" ").filter(Boolean).map((t) => ({ text: t, font, color, w: measure(t, font) }));

  parts.forEach((part) => {
    const isSection = "section" in part;
    const sec = isSection ? part.section : part.continuation;
    const body = isSection ? part.section.body : part.continuation.text;
    if (isSection && part.withHeading !== false) {
      const head = toWords(`§ ${sec.no}. ${part.section.heading}`, fHead, "rgba(30, 23, 16, 0.95)");
      setWords(head, 0, sec.no, lines.length ? 40 : 0, HEAD_LEAD, false);
      lines[lines.length - 1].gapBefore += 0;
    }
    paragraphsOf(body, sec.subheads).forEach((p, pi) => {
      let words: Word[] = [];
      if (p.label) words.push(...toWords(p.label, fBody, ink));
      if (p.head) words.push(...toWords(p.head, fItal, ink));
      words.push(...toWords(p.text, fBody, ink));
      // paint the hot phrase
      if (hotWords.length) {
        for (let i = 0; i <= words.length - hotWords.length; i++) {
          if (hotWords.every((h, k) => words[i + k].text.replace(/[’',.;:]+$/, "") === h)) {
            for (let k = 0; k < hotWords.length; k++) words[i + k] = { ...words[i + k], color: hotInk };
          }
        }
      }
      words = words.filter((x) => x.text);
      setWords(words, 36, sec.no, pi === 0 && isSection ? 10 : 6, LEAD, false);
    });
  });

  // into pages
  const pages: Array<{ lines: Array<Line & { y: number }>; first: string }> = sides.map(() => ({ lines: [], first: "" }));
  let pi = 0;
  let y = MARGIN.top;
  for (const ln of lines) {
    if (pi >= pages.length) break;
    const gap = pages[pi].lines.length ? ln.gapBefore : 0;
    if (y + gap + ln.lead > PH - MARGIN.bottom) {
      pi++;
      y = MARGIN.top;
      if (pi >= pages.length) break;
    }
    y += pages[pi].lines.length ? gap : 0;
    y += ln.lead;
    pages[pi].lines.push({ ...ln, y });
    if (!pages[pi].first) pages[pi].first = ln.section;
  }

  return pages.map((pg, i) => {
    const side = sides[i];
    const x0 = side === "recto" ? MARGIN.inner : MARGIN.outer;
    const x1 = PW - (side === "recto" ? MARGIN.outer : MARGIN.inner);
    return canvasTexture(PW, PH, (g) => {
      g.drawImage(paperCanvas(), 0, 0);
      // running head
      g.font = `500 17px ${mono}`;
      g.fillStyle = "rgba(42, 33, 24, 0.55)";
      const titleHead = "TITLE 7 — AGRICULTURE";
      const secHead = pg.first ? `§ ${pg.first}` : "";
      g.textBaseline = "alphabetic";
      if (side === "recto") {
        g.fillText(titleHead, x0, 112);
        g.fillText(secHead, x1 - g.measureText(secHead).width, 112);
      } else {
        g.fillText(secHead, x0, 112);
        g.fillText(titleHead, x1 - g.measureText(titleHead).width, 112);
      }
      g.fillStyle = "rgba(42, 33, 24, 0.35)";
      g.fillRect(x0, 128, x1 - x0, 1.5);
      // the text
      pg.lines.forEach((ln) => {
        const words = ln.words;
        g.font = words[0].font;
        const space = g.measureText(" ").width;
        const natural = words.reduce((s, w) => s + w.w, 0) + space * (words.length - 1);
        const avail = x1 - x0 - ln.indent;
        const extra = ln.justify && words.length > 1 ? (avail - natural) / (words.length - 1) : 0;
        let x = x0 + ln.indent;
        words.forEach((wd) => {
          g.font = wd.font;
          g.fillStyle = wd.color;
          if (wd.color === hotInk) {
            g.save();
            g.globalAlpha = 0.16;
            g.fillStyle = "#ff9a2e";
            g.fillRect(x - 3, ln.y - BODY_PX + 2, wd.w + 6 + space, BODY_PX + 10);
            g.restore();
            g.fillStyle = hotInk;
          }
          g.fillText(wd.text, x, ln.y);
          x += wd.w + space + extra;
        });
      });
    });
  });
}
