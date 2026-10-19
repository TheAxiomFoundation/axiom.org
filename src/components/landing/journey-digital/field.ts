// Canvas layers of the digital journey, drawn in stage design units.
//
//   FIELD          the corpus as a grid of page-shaped cells. A camera
//                  resolves the address level by level (us → statute →
//                  title 7 → § 2017 → (a)) and finally lands the one
//                  cell exactly on the statute panel's rectangle, so the
//                  DOM panel can take over without a seam.
//   CONSTELLATION  the runtime registry snapshot: one dot cloud per
//                  package, one dot per package output (real counts),
//                  plus the hero module's eight rules.

import { CLUSTERS } from "../registry-snapshot";
import type { Layout } from "./layout";

type Rect = { c: number; r: number; w: number; h: number };

export type FieldGeom = {
  x0: number;
  y0: number;
  px: number; // pitch
  py: number;
  cw: number; // cell size
  ch: number;
  cols: number;
  rows: number;
  target: { c: number; r: number };
  regions: Rect[]; // level 1..4 (index 0 = level 1)
  depth: Uint8Array; // deepest region each cell sits in (0..4)
  tone: Float32Array; // per-cell ink density
  lines: Uint8Array; // per-cell text-line count (page look)
  cams: Array<{ z: number; cx: number; cy: number; bx: number; by: number }>;
  labels: string[];
};

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function makeField(L: Layout): FieldGeom {
  const { x0, y0, cols, rows, target, regions, gutC, gutR } = L.field;
  const gc = new Set(gutC);
  const gr = new Set(gutR);
  const px = 8;
  const py = 10;
  const cw = 6;
  const ch = 7.5;
  const regs: Rect[] = regions.map(([c, r, w, h]) => {
    const c0 = Math.max(0, c);
    const r0 = Math.max(0, r);
    return { c: c0, r: r0, w: Math.min(cols - c0, w), h: Math.min(rows - r0, h) };
  });
  const n = cols * rows;
  const depth = new Uint8Array(n);
  const tone = new Float32Array(n);
  const lines = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let d = 0;
      regs.forEach((g, gi) => {
        if (c >= g.c && c < g.c + g.w && r >= g.r && r < g.r + g.h) d = gi + 1;
      });
      depth[i] = d;
      const h = hash(c, r);
      // a few empty slots so the wall reads as filed documents, not noise
      tone[i] = h < 0.04 || gc.has(c) || gr.has(r) ? 0 : 0.12 + 0.4 * hash(c + 911, r + 37);
      lines[i] = 3 + Math.floor(hash(c + 3, r + 17) * 5);
    }
  }

  // camera keyframes: frame the whole field, then each region, then
  // land the target cell on the statute panel (textFrom)
  const vb = { x: x0, y: y0, w: cols * px, h: rows * py };
  const center = (g: Rect) => ({
    x: x0 + (g.c + g.w / 2) * px - (px - cw) / 2,
    y: y0 + (g.r + g.h / 2) * py - (py - ch) / 2,
  });
  const frame = (g: Rect, pad: number) => {
    const z = Math.min(vb.w / (g.w * px * pad), vb.h / (g.h * py * pad));
    const c = center(g);
    return { z, cx: c.x, cy: c.y, bx: vb.x + vb.w / 2, by: vb.y + vb.h / 2 };
  };
  const all: Rect = { c: 0, r: 0, w: cols, h: rows };
  const T: Rect = { c: target.c, r: target.r, w: 1, h: 1 };
  const tf = L.land;
  const land = {
    z: tf.w / cw,
    cx: center(T).x,
    cy: center(T).y,
    bx: tf.x + tf.w / 2,
    by: tf.y + tf.h / 2,
  };
  const cams = [
    frame(all, 1),
    frame(regs[0], 1.04),
    frame(regs[1], 1.5),
    frame(regs[2], 1.25),
    { ...frame(T, 1), z: land.z * 0.34 },
    land,
  ];

  return {
    x0, y0, px, py, cw, ch, cols, rows,
    target, regions: regs, depth, tone, lines, cams,
    labels: [
      "us · statute — the united states code",
      "title 7 · agriculture",
      "§ 2017 · value of allotment",
      "(a) calculation",
    ],
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function camAt(g: FieldGeom, lv: number) {
  const i = Math.min(g.cams.length - 2, Math.max(0, Math.floor(lv)));
  const t = clamp01(lv - i);
  const a = g.cams[i];
  const b = g.cams[i + 1];
  // zoom in log space; the anchor follows the zoom so the move reads as
  // one camera, not a slide plus a scale
  const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), t));
  const zt = (z - a.z) / (b.z - a.z || 1);
  return {
    z,
    cx: lerp(a.cx, b.cx, zt),
    cy: lerp(a.cy, b.cy, zt),
    bx: lerp(a.bx, b.bx, zt),
    by: lerp(a.by, b.by, zt),
  };
}

export const COLORS = {
  bg: "#100e0c",
  cell: "232, 222, 206",
  amber: "232, 150, 58",
  amberHex: "#e8963a",
  green: "124, 194, 148",
  line: "rgba(232, 222, 206, 0.08)",
};

export function drawField(
  ctx: CanvasRenderingContext2D,
  g: FieldGeom,
  lv: number,
  alpha: number,
  W: number,
  H: number,
  mono: string,
) {
  if (alpha <= 0.001) return;
  const cam = camAt(g, lv);
  const sx = (x: number) => (x - cam.cx) * cam.z + cam.bx;
  const sy = (y: number) => (y - cam.cy) * cam.z + cam.by;
  const cwS = g.cw * cam.z;
  const chS = g.ch * cam.z;

  // visible cell range
  const c0 = Math.max(0, Math.floor(((cam.cx + (0 - cam.bx) / cam.z) - g.x0) / g.px) - 1);
  const c1 = Math.min(g.cols - 1, Math.ceil(((cam.cx + (W - cam.bx) / cam.z) - g.x0) / g.px) + 1);
  const r0 = Math.max(0, Math.floor(((cam.cy + (0 - cam.by) / cam.z) - g.y0) / g.py) - 1);
  const r1 = Math.min(g.rows - 1, Math.ceil(((cam.cy + (H - cam.by) / cam.z) - g.y0) / g.py) + 1);

  const focus = Math.min(4, lv); // which region is "current"
  const page = cwS >= 10; // big enough to draw as a page

  ctx.save();
  ctx.globalAlpha = alpha;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * g.cols + c;
      const t = g.tone[i];
      if (t === 0) continue;
      const d = g.depth[i];
      // cells outside the current focus dim as the address narrows
      const out = clamp01(focus - d);
      const isT = c === g.target.c && r === g.target.r;
      const lit = clamp01((focus - 1.6) * 1.2) * (d >= 3 ? 1 : 0);
      const a = t * (1 - 0.82 * out) + (isT ? 0.5 * clamp01(focus - 2.4) : 0);
      const x = sx(g.x0 + c * g.px);
      const y = sy(g.y0 + r * g.py);
      const rgb = isT && focus > 2.4 ? COLORS.amber : lit > 0 && d >= 3 ? COLORS.amber : COLORS.cell;
      if (!page) {
        ctx.fillStyle = `rgba(${rgb}, ${a})`;
        ctx.fillRect(x, y, cwS, chS);
        continue;
      }
      // a page: faint sheet, hairline edge, lines of text
      ctx.fillStyle = `rgba(${rgb}, ${a * 0.18})`;
      ctx.fillRect(x, y, cwS, chS);
      ctx.strokeStyle = `rgba(${rgb}, ${Math.min(0.9, a * 1.3)})`;
      ctx.lineWidth = Math.max(0.6, cwS / 220);
      ctx.strokeRect(x + 0.5, y + 0.5, cwS - 1, chS - 1);
      const n = g.lines[i] + (isT ? 6 : 0);
      const pad = cwS * 0.12;
      const lh = (chS - pad * 2.4) / (n + 1);
      ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.85, a * 1.1)})`;
      for (let k = 0; k < n; k++) {
        const w = (k === 0 ? 0.55 : k === n - 1 ? 0.5 : 0.78 + 0.2 * hash(i, k)) * (cwS - pad * 2);
        ctx.fillRect(x + pad, y + pad * 1.4 + lh * (k + 0.6), w, Math.max(0.8, lh * 0.22));
      }
    }
  }

  // region outlines + labels, one level at a time
  ctx.font = `500 11px ${mono}`;
  ctx.textBaseline = "bottom";
  g.regions.forEach((rg, ri) => {
    const L = ri + 1;
    // one label at a time: each fades out before the next fades in
    const vis = clamp01((lv - (L - 0.4)) / 0.25) * (L === 4 ? 1 - clamp01((lv - 4.3) / 0.3) : 1 - clamp01((lv - (L + 0.35)) / 0.2));
    if (vis <= 0.01) return;
    const x = sx(g.x0 + rg.c * g.px) - 4;
    const y = sy(g.y0 + rg.r * g.py) - 4;
    const w = (rg.w * g.px - (g.px - g.cw)) * cam.z + 8;
    const h = (rg.h * g.py - (g.py - g.ch)) * cam.z + 8;
    ctx.globalAlpha = alpha * vis;
    ctx.strokeStyle = `rgba(${COLORS.amber}, 0.75)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.amberHex;
    ctx.fillText(g.labels[ri].toUpperCase(), x, y - 6);
  });
  ctx.restore();
}

// ── the constellation ────────────────────────────────────────────────

export type Constellation = {
  dots: Float32Array; // x, y pairs
  clusters: Array<{ id: string; count: number; x: number; y: number; r: number }>;
  hero: { x: number; y: number };
  heroDots: Array<[number, number]>; // the rule graph, shrunk to a cluster
  heroEdges: Array<[number, number]>;
  heroScale: number;
  graphCenter: { x: number; y: number };
};

export function makeConstellation(
  L: Layout,
  nodes: Array<[number, number]>,
  edges: Array<[number, number]>,
): Constellation {
  const map = L.mapFilm;
  const k = L.kind === "wide" ? 0.9 : 0.42;
  const clusters = CLUSTERS.map((c) => {
    const [x, y] = map(c.x, c.y);
    return { id: c.id, count: c.count, x, y, r: c.r * k };
  });
  const total = clusters.reduce((t, c) => t + c.count, 0);
  const dots = new Float32Array(total * 2);
  let o = 0;
  const GA = Math.PI * (3 - Math.sqrt(5));
  clusters.forEach((c, ci) => {
    for (let i = 0; i < c.count; i++) {
      const rr = c.r * Math.sqrt((i + 0.5) / c.count);
      const a = i * GA;
      const j = (hash(ci, i) - 0.5) * 2.2;
      dots[o++] = c.x + Math.cos(a) * rr + j;
      dots[o++] = c.y + Math.sin(a) * rr + j;
    }
  });
  // the hero cluster keeps the exact shape of the rule graph, so the DOM
  // graph can shrink onto it without a cut
  const xs = nodes.map((n) => n[0]);
  const ys = nodes.map((n) => n[1]);
  const gc = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const heroScale = (L.kind === "wide" ? 56 : 40) / span;
  const [hx, hy] = L.heroSlot;
  return {
    dots,
    clusters,
    hero: { x: hx, y: hy },
    heroDots: nodes.map(([x, y]) => [hx + (x - gc.x) * heroScale, hy + (y - gc.y) * heroScale]),
    heroEdges: edges,
    heroScale,
    graphCenter: gc,
  };
}

// pull: 0 = the rule graph fills the stage; 1 = the wide registry shot
export function pullState(k: Constellation, pull: number) {
  const e = pull < 0.5 ? 4 * pull * pull * pull : 1 - Math.pow(-2 * pull + 2, 3) / 2;
  const graphScale = Math.exp(Math.log(k.heroScale) * e);
  const hx = k.graphCenter.x + (k.hero.x - k.graphCenter.x) * e;
  const hy = k.graphCenter.y + (k.hero.y - k.graphCenter.y) * e;
  return { e, graphScale, heroScreen: { x: hx, y: hy }, cz: graphScale / k.heroScale };
}

const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function drawConstellation(
  ctx: CanvasRenderingContext2D,
  k: Constellation,
  pull: number,
  mono: string,
) {
  if (pull <= 0.001) return;
  const { cz, heroScreen } = pullState(k, pull);
  const sx = (x: number) => (x - k.hero.x) * cz + heroScreen.x;
  const sy = (y: number) => (y - k.hero.y) * cz + heroScreen.y;
  const alpha = smooth(0.08, 0.55, pull);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgba(${COLORS.green}, 0.72)`;
  const d = k.dots;
  const s = Math.min(6, Math.max(1.2, 1.4 * Math.sqrt(cz)));
  for (let i = 0; i < d.length; i += 2) {
    const x = sx(d[i]);
    const y = sy(d[i + 1]);
    if (x < -10 || y < -10 || x > 4000 || y > 4000) continue;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.font = `500 10px ${mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.globalAlpha = alpha * smooth(0.6, 0.95, pull);
  k.clusters.forEach((c) => {
    if (c.count < 30) return;
    ctx.fillStyle = "rgba(232, 222, 206, 0.5)";
    ctx.fillText(c.id, sx(c.x), sy(c.y) + c.r * cz + 6);
  });

  // the hero: the same graph, now one small cluster among many
  const ha = smooth(0.7, 0.9, pull);
  if (ha > 0.001) {
    ctx.globalAlpha = ha;
    ctx.strokeStyle = `rgba(${COLORS.amber}, 0.55)`;
    ctx.lineWidth = 0.8;
    k.heroEdges.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(sx(k.heroDots[a][0]), sy(k.heroDots[a][1]));
      ctx.lineTo(sx(k.heroDots[b][0]), sy(k.heroDots[b][1]));
      ctx.stroke();
    });
    ctx.fillStyle = COLORS.amberHex;
    k.heroDots.forEach(([x, y]) => ctx.fillRect(sx(x) - 2, sy(y) - 2, 4, 4));
    ctx.globalAlpha = ha * smooth(0.85, 1, pull);
    ctx.fillStyle = COLORS.amberHex;
    ctx.fillText("us/statute/7/2017/a · 8 rules", heroScreen.x, heroScreen.y + 40);
  }
  ctx.restore();
}
