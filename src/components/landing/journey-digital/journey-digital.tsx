"use client";

// THE DIGITAL JOURNEY — one provision, from the corpus to the graph,
// built from the real artifacts (see data.ts) rather than drawn ones.
//
//   address   a canvas field of page-cells; the camera resolves
//             us/statute/7/2017/a level by level and lands the one cell
//             on the statute panel
//   read      § 2017(a) in real type, word by word
//   mark      a scan finds each rate, limit and rounding rule
//   encode    a.yaml types in beside it; a trace runs from every marked
//             phrase to the line that encodes it
//   run       test case 1's values appear inline, debugger-style
//   graph     the rules lift out of the code into their dependency
//             graph, and the camera pulls back to the registry
//
// One GSAP timeline, scrubbed by ScrollTrigger (pin + scrub). The stage
// has a fixed design size and is scaled to fit, so DOM measurements, the
// SVG overlay and the canvas share one coordinate system. Reduced motion
// gets the "run" frame as a still.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { registrySummary, snapshotMonth } from "../registry-snapshot";
import {
  ADDRESS,
  CASE,
  CODE,
  GRAPH_EDGES,
  GRAPH_NODES,
  MARKS,
  STATUTE,
  fmtValue,
  type CodeRow,
  type MarkId,
} from "./data";
import { COLORS, drawConstellation, drawField, makeConstellation, makeField, pullState } from "./field";
import { pickLayout, type Box, type Layout } from "./layout";
import "./journey-digital.css";

const STEPS = ["address", "read", "mark", "encode", "run", "graph"];

const CAPTIONS: Array<{ at: number; step: number; title: string; sub: string }> = [
  {
    at: 0,
    step: 0,
    title: "Find the provision",
    sub: "Every provision in the corpus has an address. Follow one down to us/statute/7/2017/a.",
  },
  {
    at: 16,
    step: 1,
    title: "Read it, word for word",
    sub: "Section 2017(a) of the U.S. Code, exactly as the corpus holds it.",
  },
  {
    at: 24.5,
    step: 2,
    title: "Mark what it decides",
    sub: "Each rate, limit and rounding rule in the sentence is something to encode.",
  },
  {
    at: 36,
    step: 3,
    title: "Write it as code",
    sub: "The encoder writes each rule in RuleSpec and cites the words it came from.",
  },
  {
    at: 54,
    step: 4,
    title: "Run a case",
    sub: "Test case 1: one person earning $1,000 a month. The rules give an allotment of $182.",
  },
  {
    at: 70,
    step: 5,
    title: "Connect it",
    sub: "Each rule becomes a node, linked to the rules it reads.",
  },
  {
    at: 84,
    step: 5,
    title: "The same structure, at scale",
    sub: `${registrySummary()} in the runtime registry (${snapshotMonth()} snapshot).`,
  },
];

const END = 100; // timeline length; the scroll maps onto it
const RUN_STILL = 69 / END; // the reduced-motion frame

const box = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h });

// ── statute ──────────────────────────────────────────────────────────

function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((p, i) =>
        p === "" ? null : /^\s+$/.test(p) ? p : (
          <span key={i} className="jd-w">
            {p}
          </span>
        ),
      )}
    </>
  );
}

function StatutePanel({ L }: { L: Layout }) {
  return (
    <div className="jd-panel jd-text" style={box(L.text)}>
      <div className="jd-text__eyebrow">United States Code · Title 7 · Chapter 51</div>
      <div className="jd-text__title">§ 2017. Value of allotment</div>
      <div className="jd-text__sub">(a) Calculation</div>
      <p className="jd-statute">
        {STATUTE.map((seg, i) =>
          typeof seg === "string" ? (
            <Words key={i} text={seg} />
          ) : "mark" in seg ? (
            <span key={i} className="jd-mark" data-mark={seg.mark}>
              <Words text={seg.text} />
            </span>
          ) : (
            <em key={i}>
              <Words text={seg.em} />
            </em>
          ),
        )}
        <span className="jd-scan" aria-hidden />
      </p>
      {MARKS.map((m) => (
        <span key={m.id} className="jd-tag" data-tag={m.id} aria-hidden>
          {m.tag}
        </span>
      ))}
      <div className="jd-text__foot">
        <span className="jd-dot" /> corpus · us/statute/7/2017/a
      </div>
    </div>
  );
}

// ── code ─────────────────────────────────────────────────────────────

const FUNCS = new Set(["floor", "max", "min"]);
const KEYWORDS = new Set(["if", "else"]);

function tokens(expr: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|(\s+)|([^\sA-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(expr))) {
    const [t, id, num, ws] = m;
    const cls = id
      ? FUNCS.has(id)
        ? "t-f"
        : KEYWORDS.has(id)
          ? "t-kw"
          : "t-i"
      : num
        ? "t-n"
        : ws
          ? ""
          : "t-p";
    out.push(cls ? <span key={`${key}${i++}`} className={cls}>{t}</span> : t);
  }
  return out;
}

// A small YAML-aware highlighter. Quoted statute words inside a
// `source:` line are set in the statute's own serif — the law's
// typeface appears in the code wherever the code cites it.
function highlight(text: string): ReactNode[] {
  const m = text.match(/^(\s*)(- )?([a-z_]+:)?( ?)(.*)$/)!;
  const [, indent, dash, key, sp, rest] = m;
  const out: ReactNode[] = [indent];
  if (dash) out.push(<span key="d" className="t-p">- </span>);
  if (key) out.push(<span key="k" className="t-k">{key}</span>);
  out.push(sp);
  if (key === "name:") out.push(<span key="n" className="t-name">{rest}</span>);
  else if (key === "source:") {
    const q = rest.indexOf('"');
    out.push(<span key="c" className="t-c">{q < 0 ? rest : rest.slice(0, q)}</span>);
    if (q >= 0) out.push(<span key="q" className="t-q">{rest.slice(q)}</span>);
  } else if (key) out.push(<span key="v" className="t-c">{rest}</span>);
  else if (/^us:/.test(rest)) out.push(<span key="p" className="t-path">{rest}</span>);
  else out.push(...tokens(rest, "x"));
  return out;
}

const VALUE_AT = new Map<number, (typeof CASE.values)[number]>(CASE.values.map((v) => [v.line, v]));

function CodeLine({ row }: { row: CodeRow }) {
  if ("gap" in row) {
    return (
      <div className="jd-row jd-row--gap" aria-hidden>
        <span className="jd-ln">⋮</span>
      </div>
    );
  }
  const v = VALUE_AT.get(row.n);
  return (
    <div className="jd-row" data-line={row.n}>
      <span className="jd-ln">{row.n}</span>
      <span className="jd-src">{highlight(row.text)}</span>
      {v && (
        <span className={"hero" in v ? "jd-val jd-val--hero" : "jd-val"} data-val={row.n}>
          <span className="jd-val__eq">=</span> <b>{fmtValue(v.value, v.fmt)}</b>
          {"note" in v && <span className="jd-val__note"> {v.note}</span>}
        </span>
      )}
    </div>
  );
}

function CodePanel({ L }: { L: Layout }) {
  return (
    <div className="jd-panel jd-code" style={box(L.code)}>
      <div className="jd-code__bar">
        <span className="jd-code__tab">a.yaml</span>
        <span className="jd-code__path">rulespec-us / us / statutes / 7 / 2017</span>
        <span className="jd-code__run">
          <span className="jd-code__play">▶</span> test case 1 · a.test.yaml
        </span>
      </div>
      <div className="jd-code__body">
        {CODE.map((row, i) => (
          <CodeLine key={i} row={row} />
        ))}
      </div>
    </div>
  );
}

// ── graph ────────────────────────────────────────────────────────────

const NODE_INDEX = new Map(GRAPH_NODES.map((n, i) => [n.id, i]));

function Graph({ L }: { L: Layout }) {
  return (
    <div className="jd-graph" style={{ width: L.W, height: L.H }}>
      <svg className="jd-edges" viewBox={`0 0 ${L.W} ${L.H}`} aria-hidden>
        {GRAPH_EDGES.map(([a, b]) => {
          const [x1, y1] = L.graph[a];
          const [x2, y2] = L.graph[b];
          const d =
            L.kind === "wide"
              ? `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
          return <path key={`${a}-${b}`} className="jd-edge" d={d} pathLength={1} />;
        })}
        {GRAPH_EDGES.map(([a, b]) => (
          <circle key={`p-${a}-${b}`} className="jd-packet" r={3} cx={-20} cy={-20} />
        ))}
      </svg>
      {GRAPH_NODES.map((n) => (
        <div
          key={n.id}
          className={`jd-node jd-node--${n.kind}`}
          data-node={n.id}
          style={{ left: L.graph[n.id][0], top: L.graph[n.id][1] }}
        >
          <span className="jd-node__kind">{n.kind}</span>
          <span className="jd-node__label">{n.label}</span>
          <span className="jd-node__val">{n.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── the stage ────────────────────────────────────────────────────────

function Stage({ L }: { L: Layout }) {
  return (
    <>
      <canvas className="jd-canvas" aria-hidden />
      <div className="jd-rail" style={box(L.rail)}>
        <div className="jd-addr" aria-label="us/statute/7/2017/a">
          {ADDRESS.map((seg, i) => (
            <span key={seg} className="jd-addr__part">
              {i > 0 && <span className="jd-addr__sep">/</span>}
              <span className="jd-addr__seg" data-seg={i} />
            </span>
          ))}
          <span className="jd-caret" />
        </div>
        <ol className="jd-steps">
          {STEPS.map((s) => (
            <li key={s} className="jd-step">
              {s}
            </li>
          ))}
          <span className="jd-steps__track">
            <span className="jd-steps__fill" />
          </span>
        </ol>
      </div>
      <StatutePanel L={L} />
      <CodePanel L={L} />
      <div className="jd-result" style={{ right: L.W - (L.result.x + L.result.w), top: L.result.y }}>
        <div className="jd-result__label">snap_regular_month_allotment</div>
        <div className="jd-result__value">
          ${CASE.result}
          <span> a month</span>
        </div>
        <div className="jd-result__case">{CASE.label}</div>
      </div>
      <svg className="jd-threads" viewBox={`0 0 ${L.W} ${L.H}`} aria-hidden>
        <path className="jd-answer" pathLength={1} />
        {MARKS.map((m) => (
          <g key={m.id} className="jd-thread" data-thread={m.id}>
            <path className="jd-thread__glow" pathLength={1} />
            <path className="jd-thread__line" pathLength={1} />
            <circle className="jd-thread__end" r={2.6} />
          </g>
        ))}
      </svg>
      <Graph L={L} />
      <div className="jd-captions" style={box(L.caption)}>
        {CAPTIONS.map((c, i) => (
          <div key={i} className="jd-caption" data-caption={i}>
            <div className="jd-caption__title">{c.title}</div>
            <div className="jd-caption__sub">{c.sub}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── the timeline ─────────────────────────────────────────────────────

type Scene = { lv: number; field: number; pull: number };

function build(root: HTMLElement, L: Layout, k: number, reduced: boolean) {
  const q = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
  const one = (s: string) => root.querySelector<HTMLElement>(s)!;
  const stage = one(".jd-stage");
  const canvas = root.querySelector<HTMLCanvasElement>(".jd-canvas")!;
  const textPanel = one(".jd-text");
  const codePanel = one(".jd-code");
  const graphWrap = one(".jd-graph");
  const mono =
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
    "ui-monospace, monospace";

  // ── measure, in stage units, with everything at its final layout ──
  const sr = stage.getBoundingClientRect();
  k = sr.width / L.W; // the scale actually rendered
  const P = (x: number, y: number): [number, number] => [(x - sr.left) / k, (y - sr.top) / k];
  const tr = textPanel.getBoundingClientRect();
  const body = one(".jd-statute").getBoundingClientRect();
  const bodyTop = (body.top - tr.top) / k;
  const bodyH = body.height / k;

  const markGeo = new Map<MarkId, { end: [number, number]; first: [number, number]; yRel: number }>();
  q(".jd-mark").forEach((el) => {
    const rects = el.getClientRects();
    const first = rects[0];
    const last = rects[rects.length - 1];
    markGeo.set(el.dataset.mark as MarkId, {
      end: P(last.right + 2, last.top + last.height / 2),
      first: [(first.left - tr.left) / k, (first.top - tr.top) / k],
      yRel: (first.top - body.top) / k / bodyH,
    });
  });

  const rowGeo = new Map<number, { x: number; y: number; idx: number }>();
  q(".jd-row[data-line]").forEach((el, idx) => {
    const src = el.querySelector(".jd-src")!.getBoundingClientRect();
    const [x, y] = P(src.left, src.top + src.height / 2);
    rowGeo.set(Number(el.dataset.line), { x, y, idx });
  });

  const nodeW = new Map<string, number>();
  q(".jd-node").forEach((el) => nodeW.set(el.dataset.node!, el.offsetWidth));

  // ── static geometry: tags, threads ──
  q(".jd-tag").forEach((el) => {
    const g = markGeo.get(el.dataset.tag as MarkId)!;
    el.style.left = `${g.first[0]}px`;
    el.style.top = `${g.first[1] - 15}px`;
  });
  const shiftX = L.textFrom.x - L.text.x;
  const shiftY = L.textFrom.y - L.text.y;
  root.querySelectorAll<SVGGElement>(".jd-thread").forEach((g) => {
    const m = MARKS.find((mm) => mm.id === g.dataset.thread)!;
    const a = markGeo.get(m.id)!.end;
    const r = rowGeo.get(m.line)!;
    const b: [number, number] = [r.x - 4, r.y];
    const d =
      L.kind === "wide"
        ? `M ${a[0]} ${a[1]} C ${a[0] + 70} ${a[1]}, ${b[0] - 90} ${b[1]}, ${b[0]} ${b[1]}`
        : `M ${a[0]} ${a[1]} C ${a[0]} ${a[1] + (b[1] - a[1]) * 0.6}, ${b[0] - 40} ${b[1]}, ${b[0]} ${b[1]}`;
    g.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
    const c = g.querySelector("circle")!;
    c.setAttribute("cx", String(b[0]));
    c.setAttribute("cy", String(b[1]));
  });

  // the answer's connector: from the output's inline value to the card
  {
    const hero = one(".jd-val--hero").getBoundingClientRect();
    const [ax, ay] = P(hero.left + hero.width / 2, hero.bottom + 2);
    const bx = L.result.x + L.result.w / 2;
    const by = L.result.y;
    one(".jd-answer").setAttribute("d", `M ${ax} ${ay} C ${ax} ${ay + (by - ay) * 0.6}, ${bx} ${by - (by - ay) * 0.6}, ${bx} ${by}`);
  }

  // ── canvas ──
  const field = makeField(L);
  const cons = makeConstellation(
    L,
    GRAPH_NODES.map((n) => L.graph[n.id]),
    GRAPH_EDGES.map(([a, b]) => [NODE_INDEX.get(a)!, NODE_INDEX.get(b)!]),
  );
  const ctx = canvas.getContext("2d")!;
  let scale = 1;
  const sizeCanvas = (kk: number) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = dpr * kk;
    canvas.width = Math.round(L.W * scale);
    canvas.height = Math.round(L.H * scale);
  };
  sizeCanvas(k);

  const scene: Scene = { lv: 0, field: 1, pull: 0 };
  const edgeEls = Array.from(root.querySelectorAll<SVGPathElement>(".jd-edge"));
  const packets = Array.from(root.querySelectorAll<SVGCircleElement>(".jd-packet"));

  const render = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawField(ctx, field, scene.lv, scene.field, L.W, L.H, mono);
    drawConstellation(ctx, cons, scene.pull, mono);
    // the DOM graph rides the same camera as the canvas constellation
    const ps = pullState(cons, scene.pull);
    const gc = cons.graphCenter;
    gsap.set(graphWrap, {
      x: ps.heroScreen.x - gc.x,
      y: ps.heroScreen.y - gc.y,
      scale: ps.graphScale,
      transformOrigin: `${gc.x}px ${gc.y}px`,
      autoAlpha: scene.pull > 0.86 ? 0 : 1 - Math.max(0, (scene.pull - 0.7) / 0.16),
    });
  };

  // ── initial states ──
  const words = q(".jd-w");
  const tags = q(".jd-tag");
  const srcs = q(".jd-row[data-line] .jd-src");
  const lns = q(".jd-row .jd-ln");
  const vals = q(".jd-val");
  const nodes = q(".jd-node");
  const captions = q(".jd-caption");
  const steps = q(".jd-step");
  gsap.set(textPanel, { x: shiftX, y: shiftY, autoAlpha: 0 });
  gsap.set(codePanel, { autoAlpha: 0, x: L.kind === "wide" ? 36 : 0, y: L.kind === "wide" ? 0 : 36 });
  gsap.set(one(".jd-code__run"), { autoAlpha: 0 });
  gsap.set(one(".jd-result"), { autoAlpha: 0, y: 12 });
  gsap.set(words, { opacity: 0.07 });
  gsap.set(tags, { autoAlpha: 0, scale: 0.7, y: 5, transformOrigin: "0% 100%" });
  gsap.set(srcs, { clipPath: "inset(0% 100% 0% 0%)" });
  gsap.set(lns, { opacity: 0 });
  gsap.set(vals, { autoAlpha: 0, x: -6 });
  gsap.set([".jd-thread path", ".jd-answer"], { strokeDasharray: 1, strokeDashoffset: 1 });
  gsap.set(".jd-thread circle", { autoAlpha: 0 });
  gsap.set(nodes, { xPercent: -50, yPercent: -50, autoAlpha: 0 });
  gsap.set(edgeEls, { strokeDasharray: 1, strokeDashoffset: 1 });
  gsap.set(packets, { autoAlpha: 0 });
  gsap.set(captions, { autoAlpha: 0, y: 10 });
  gsap.set(captions[0], { autoAlpha: 1, y: 0 });
  gsap.set(steps, { color: "rgba(232, 222, 206, 0.32)" });
  gsap.set(steps[0], { color: COLORS.amberHex });
  gsap.set(one(".jd-steps__fill"), { scaleX: 0, transformOrigin: "0% 50%" });
  gsap.set(one(".jd-scan"), { autoAlpha: 0, top: 0 });

  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" }, onUpdate: render, paused: true });
  tl.to(one(".jd-steps__fill"), { scaleX: 1, duration: 93, ease: "none" }, 0);

  // ── address: the camera resolves the path one level at a time ──
  const segs = q(".jd-addr__seg");
  const parts = q(".jd-addr__part");
  gsap.set(parts.slice(1), { display: "none" });
  [0.2, 1.4, 4.4, 7.4, 10.4].forEach((t, i) => {
    if (i > 0) tl.set(parts[i], { display: "inline-flex" }, t);
    tl.to(segs[i], { duration: 0.9, ease: "none", scrambleText: { text: ADDRESS[i], chars: "abcdefghijklmnopqrstuvwxyz0123456789", speed: 0.6 } }, t);
  });
  tl.to(scene, { lv: 1, duration: 2.4 }, 0.6)
    .to(scene, { lv: 2, duration: 2.4 }, 3.6)
    .to(scene, { lv: 3, duration: 2.4 }, 6.6)
    .to(scene, { lv: 4, duration: 2.4 }, 9.6)
    .to(scene, { lv: 5, duration: 2.8, ease: "power2.in" }, 12.2)
    .to(scene, { field: 0, duration: 1.0, ease: "none" }, 14.6)
    .to(textPanel, { autoAlpha: 1, duration: 1.0, ease: "none" }, 14.4);

  // ── read ──
  tl.to(words, { opacity: 1, duration: 0.6, ease: "none", stagger: { amount: 6.4 } }, 16.4);

  // ── mark: a scan line finds each decision in the sentence ──
  const scan = one(".jd-scan");
  tl.set(scan, { autoAlpha: 1 }, 24.6)
    .fromTo(scan, { top: 0 }, { top: bodyH, duration: 10, ease: "none" }, 24.6)
    .to(scan, { autoAlpha: 0, duration: 0.4 }, 34.6);
  MARKS.forEach((m) => {
    const el = one(`.jd-mark[data-mark="${m.id}"]`);
    const t = 24.6 + 10 * markGeo.get(m.id)!.yRel + 0.25;
    tl.to(el, { backgroundColor: "rgba(232, 150, 58, 0.16)", color: "#fff4e2", boxShadow: "inset 0 -1.5px 0 rgba(232, 150, 58, 0.95)", duration: 0.5 }, t);
    tl.to(one(`.jd-tag[data-tag="${m.id}"]`), { autoAlpha: 1, scale: 1, y: 0, duration: 0.5, ease: "back.out(2.2)" }, t + 0.2);
  });

  // ── encode: the code types in; a trace ties each phrase to its line ──
  if (shiftX || shiftY) tl.to(textPanel, { x: 0, y: 0, duration: 2.4, ease: "power3.inOut" }, 36);
  tl.to(codePanel, { autoAlpha: 1, x: 0, y: 0, duration: 1.6, ease: "power2.out" }, 37.4);
  const rowEls = q(".jd-row");
  rowEls.forEach((row, i) => {
    const t = 38.6 + i * 0.48;
    const src = row.querySelector<HTMLElement>(".jd-src");
    const ln = row.querySelector<HTMLElement>(".jd-ln");
    if (ln) tl.to(ln, { opacity: 1, duration: 0.15, ease: "none" }, t);
    if (src) {
      const n = (src.textContent || "").length;
      tl.to(src, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.2 + n * 0.011, ease: `steps(${Math.max(3, Math.round(n / 2))})` }, t);
    }
  });
  MARKS.forEach((m) => {
    const g = one(`.jd-thread[data-thread="${m.id}"]`);
    const t = 38.6 + rowEls.findIndex((el) => el.dataset.line === String(m.line)) * 0.48 + 0.35;
    tl.to(g.querySelectorAll("path"), { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" }, t);
    tl.to(g.querySelector("circle"), { autoAlpha: 1, duration: 0.2 }, t + 1.0);
    tl.to(g, { opacity: 0.2, duration: 1.2, ease: "none" }, t + 1.6);
  });

  // ── run: test case 1, values inline ──
  tl.to(one(".jd-code__run"), { autoAlpha: 1, duration: 0.5 }, 54.2);
  CASE.values.forEach((v, i) => {
    const el = one(`.jd-val[data-val="${v.line}"]`);
    const b = el.querySelector("b")!;
    const t = 55 + i * 1.15;
    const proxy = { v: 0 };
    tl.to(el, { autoAlpha: 1, x: 0, duration: 0.35, ease: "power2.out" }, t);
    tl.to(proxy, { v: v.value, duration: 0.9, ease: "power1.out", onUpdate: () => void (b.textContent = fmtValue(proxy.v, v.fmt)) }, t);
    const row = one(`.jd-row[data-line="${v.line}"]`);
    tl.fromTo(row, { backgroundColor: "rgba(232, 150, 58, 0)" }, { backgroundColor: "rgba(232, 150, 58, 0.10)", duration: 0.3, ease: "none" }, t)
      .to(row, { backgroundColor: "rgba(232, 150, 58, 0)", duration: 0.6, ease: "none" }, t + 0.6);
  });
  tl.to(one(".jd-answer"), { strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut" }, 66.2);
  tl.to(one(".jd-result"), { autoAlpha: 1, y: 0, duration: 0.8, ease: "power2.out" }, 66.8);
  // the result traces back to the words that set it
  (["rate30", "income", "tfp", "floor", "eligible"] as MarkId[]).forEach((id, i) => {
    tl.to(`.jd-thread[data-thread="${id}"]`, { opacity: 1, duration: 0.5 }, 67 + i * 0.25);
  });

  // ── graph: the rules lift out of the code ──
  tl.to([textPanel, codePanel, one(".jd-result")], { autoAlpha: 0, scale: 0.985, duration: 1.2 }, 70.2);
  tl.to(".jd-threads", { autoAlpha: 0, duration: 0.8 }, 70.2);
  GRAPH_NODES.forEach((n, i) => {
    const el = one(`.jd-node[data-node="${n.id}"]`);
    const r = rowGeo.get(n.line)!;
    const [gx, gy] = L.graph[n.id];
    const w = nodeW.get(n.id) || 200;
    tl.fromTo(
      el,
      { x: r.x + w / 2 - gx, y: r.y - gy, autoAlpha: 0, scale: 0.9 },
      { x: 0, y: 0, autoAlpha: 1, scale: 1, duration: 2.4, ease: "power3.inOut" },
      70.6 + i * 0.16,
    );
  });
  // edges draw in dependency order, then one packet runs each edge
  edgeEls.forEach((e, i) => {
    tl.to(e, { strokeDashoffset: 0, duration: 1.1, ease: "power1.inOut" }, 73.4 + i * 0.22);
  });
  const depth: Record<string, number> = { imp2014: 0, impUsda: 0, rate30: 0, size2: 0, rate8: 0, net: 1, contrib: 2, minimum: 2, before: 3, regular: 4 };
  GRAPH_EDGES.forEach(([a], i) => {
    const path = edgeEls[i];
    const dot = packets[i];
    const proxy = { t: 0 };
    const len = () => path.getTotalLength();
    tl.fromTo(
      proxy,
      { t: 0 },
      {
        t: 1,
        duration: 1.6,
        ease: "power1.inOut",
        onUpdate: () => {
          const p = path.getPointAtLength(proxy.t * len());
          dot.setAttribute("cx", String(p.x));
          dot.setAttribute("cy", String(p.y));
          dot.style.opacity = String(proxy.t <= 0 || proxy.t >= 1 ? 0 : Math.min(1, Math.min(proxy.t, 1 - proxy.t) * 8));
          dot.style.visibility = "visible";
        },
      },
      76.4 + depth[a] * 1.3,
    );
  });

  // ── pull back: the graph becomes one cluster in the registry ──
  tl.to(scene, { pull: 1, duration: 8.6, ease: "none" }, 84.2);

  // ── captions + rail ──
  CAPTIONS.forEach((c, i) => {
    if (i === 0) return;
    tl.to(captions[i - 1], { autoAlpha: 0, y: -8, duration: 0.5 }, c.at - 0.6);
    tl.fromTo(captions[i], { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.6 }, c.at - 0.1);
    const prev = CAPTIONS[i - 1].step;
    if (prev !== c.step) {
      tl.to(steps[prev], { color: "rgba(232, 222, 206, 0.62)", duration: 0.3 }, c.at - 0.2);
      tl.to(steps[c.step], { color: COLORS.amberHex, duration: 0.3 }, c.at - 0.2);
    }
  });
  tl.to({}, { duration: END - tl.duration() }, tl.duration());

  render();
  let st: ScrollTrigger | null = null;
  if (reduced) {
    tl.progress(RUN_STILL);
    render();
  } else {
    st = ScrollTrigger.create({
      trigger: root,
      start: "top top",
      end: () => `+=${Math.round(window.innerHeight * (L.kind === "wide" ? 8 : 6.5))}`,
      pin: true,
      scrub: 0.8,
      animation: tl,
    });
  }
  // dev only: lets a test harness jump to a point of the story — the
  // scroll and the timeline move together, so the scrub has no lag to
  // play out
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __jdSeek?: (p: number) => void }).__jdSeek = (p) => {
      if (st) window.scrollTo(0, st.start + p * (st.end - st.start));
      tl.progress(p);
      render();
    };
  }

  return {
    resize(kk: number) {
      sizeCanvas(kk);
      render();
    },
    kill() {
      st?.kill();
      tl.kill();
    },
  };
}

// ── the component ────────────────────────────────────────────────────

export function JourneyDigital() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [L, setL] = useState<Layout | null>(null);

  // pick the stage for the viewport's shape; a hidden or zero-size
  // viewport waits for a real one
  useEffect(() => {
    const pick = () => {
      if (!window.innerWidth || !window.innerHeight) return;
      const next = pickLayout(window.innerWidth, window.innerHeight);
      setL((prev) => (prev?.kind === next.kind ? prev : next));
    };
    pick();
    window.addEventListener("resize", pick);
    return () => window.removeEventListener("resize", pick);
  }, []);

  useEffect(() => {
    if (!L) return;
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    gsap.registerPlugin(ScrollTrigger, ScrambleTextPlugin);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // the site's fixed nav sits over the top of the pinned stage; fit
    // the stage into the space under it
    const navH = () => document.querySelector("header.nav-bar")?.getBoundingClientRect().height ?? 0;
    const fitK = () => {
      const top = navH();
      root.style.setProperty("--jd-top", `${top}px`);
      return Math.min(root.clientWidth / L.W, (root.clientHeight - top) / L.H);
    };
    let ctx: gsap.Context | null = null;
    let api: ReturnType<typeof build> | null = null;
    let dead = false;
    let fontsReady = false;
    const apply = () => {
      const k = fitK();
      if (!(k > 0)) return;
      stage.style.setProperty("--k", String(k));
      if (api) api.resize(k);
      else if (fontsReady && !dead) {
        ctx = gsap.context(() => {
          api = build(root, L, k, reduced);
        }, root);
      }
    };
    document.fonts.ready.then(() => {
      fontsReady = true;
      apply();
    });
    const ro = new ResizeObserver(apply);
    ro.observe(root);
    return () => {
      dead = true;
      ro.disconnect();
      api?.kill();
      ctx?.revert();
    };
  }, [L]);

  return (
    <div ref={rootRef} className="jd-pin">
      {L && (
        <div
          ref={stageRef}
          className={`jd-stage jd-stage--${L.kind}`}
          style={{ width: L.W, height: L.H }}
          role="img"
          aria-label="7 U.S.C. § 2017(a), Value of allotment, followed from its corpus address to code: each rate, limit and rounding rule in the sentence is marked and traced to the line of RuleSpec that encodes it; test case 1 (one person earning $1,000 a month) runs to an allotment of $182; the rules then join their dependency graph and the runtime registry."
        >
          <Stage L={L} />
        </div>
      )}
    </div>
  );
}
