"use client";

// Beat 5 of the encoder story ("Every value cites the sentence it came
// from") built from real page components instead of a canvas: the
// statute is live text, a.yaml is a live code card, and scroll draws a
// thread from each marked phrase to the line that encodes it.
//
// Motion rules: one clock (Lenis drives the scroll, the GSAP ticker
// drives both Lenis and the frame), every frame is a pure function of
// scroll progress, and only transform, opacity and SVG stroke change.
// Reduced motion gets the finished state with no smooth scroll.

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { CODE, MARKS, STATUTE, type MarkId } from "../journey-digital/data";
import "./cites-beat.css";

// share of the track before the first mark and after the last
const INTRO = 0.06;
const OUTRO = 0.06;
// where the active code line sits in the code window, as a share of its height
const FOCUS = 0.42;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const phraseOf = (id: MarkId) => {
  for (const s of STATUTE) if (typeof s === "object" && "mark" in s && s.mark === id) return s.text;
  return "";
};
const short = (s: string) => (s.length > 30 ? `${s.slice(0, 28).trimEnd()}…` : s);

export function CitesBeat() {
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const codeWinRef = useRef<HTMLDivElement>(null);
  const codeListRef = useRef<HTMLOListElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    const codeWin = codeWinRef.current;
    const codeList = codeListRef.current;
    const svg = svgRef.current;
    if (!track || !stage || !codeWin || !codeList || !svg) return;

    // phones stack the cards and show the finished state, like reduced motion
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia("(max-width: 900px)").matches;
    const q = <T extends Element>(sel: string) => Array.from(stage.querySelectorAll<T>(sel));
    const phrases = MARKS.map((m) => stage.querySelector<HTMLElement>(`[data-phrase="${m.id}"]`)!);
    const rows = MARKS.map((m) => codeList.querySelector<HTMLElement>(`[data-line="${m.line}"]`)!);
    const wires = q<SVGPathElement>("[data-wire]");
    const ends = q<SVGCircleElement>("[data-end]");
    const starts = q<SVGCircleElement>("[data-start]");
    const dots = q<HTMLElement>("[data-dot]");
    const counter = stage.querySelector<HTMLElement>("[data-count]")!;
    const cards = q<HTMLElement>("[data-card]");

    // where each mark's code line wants the code list to stand
    let pans: number[] = [];
    const measure = () => {
      const winH = codeWin.clientHeight;
      const max = Math.max(0, codeList.scrollHeight - winH);
      pans = rows.map((r) => Math.min(max, Math.max(0, r.offsetTop + r.offsetHeight / 2 - winH * FOCUS)));
    };
    measure();

    const render = (p: number) => {
      // the story clock: 0..MARKS.length across the marks
      const m = span(p, INTRO, 1 - OUTRO) * MARKS.length;
      const intro = easeOut(span(p, 0, INTRO));

      cards.forEach((c, i) => {
        const lift = (1 - intro) * (i === 0 ? 1 : 1.6);
        c.style.transform = `translate3d(0, ${lift * 48}px, 0) rotateX(${lift * 8}deg)`;
        c.style.opacity = String(0.2 + 0.8 * intro);
      });

      // the code window pans line to line in the first half of each mark
      const i0 = Math.min(MARKS.length - 1, Math.floor(m));
      const into = easeInOut(span(m - i0, 0, 0.5));
      const from = pans[Math.max(0, i0 - 1)] ?? 0;
      const pan = i0 === 0 ? pans[0] * easeInOut(span(m, 0, 0.5)) : from + (pans[i0] - from) * into;
      codeList.style.transform = `translate3d(0, ${-pan}px, 0)`;

      const box = stage.getBoundingClientRect();
      const win = codeWin.getBoundingClientRect();
      const statuteRect = cards[0].getBoundingClientRect();
      let done = 0;

      MARKS.forEach((_, i) => {
        const t = m - i; // this mark's own clock: 0..1 while it is active
        const mark = easeOut(span(t, 0, 0.35));
        const draw = easeInOut(span(t, 0.2, 0.6));
        const lit = easeOut(span(t, 0.5, 0.8));
        const leave = easeOut(span(t, 1, 1.25)); // fades as the next mark starts
        if (t >= 0.8) done++;

        const ph = phrases[i];
        ph.style.setProperty("--mark", String(mark));
        ph.style.setProperty("--active", String(t > 0 && t < 1.25 ? 1 - leave : 0));

        const row = rows[i];
        row.style.setProperty("--lit", String(lit * (1 - 0.65 * leave)));
        row.style.setProperty("--chip", String(lit * (1 - leave)));

        dots[i].style.transform = `scale(${0.6 + 0.4 * lit})`;
        dots[i].style.opacity = String(0.25 + 0.75 * lit);

        // the thread: from the end of the phrase to the start of the line
        const wire = wires[i];
        const end = ends[i];
        const vis = draw * (1 - leave);
        const start = starts[i];
        if (vis <= 0.001) {
          wire.style.opacity = "0";
          end.style.opacity = "0";
          start.style.opacity = "0";
          return;
        }
        const rects = ph.getClientRects();
        const last = rects[rects.length - 1];
        const r = row.getBoundingClientRect();
        const ty = r.top + r.height / 2;
        const inView = ty > win.top + 6 && ty < win.bottom - 6;
        // leave the statute card at its edge, level with the phrase, so the
        // thread never crosses the words after it
        const x1 = statuteRect.right - box.left;
        const y1 = last.top + last.height / 2 - box.top;
        const x2 = r.left - box.left - 6;
        const y2 = ty - box.top;
        const dx = Math.max(60, (x2 - x1) * 0.5);
        wire.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
        wire.style.strokeDashoffset = String(1 - draw);
        wire.style.opacity = String(inView ? 1 - leave : 0);
        end.setAttribute("cx", String(x2));
        end.setAttribute("cy", String(y2));
        end.style.opacity = String(inView ? easeOut(span(t, 0.55, 0.65)) * (1 - leave) : 0);
        start.setAttribute("cx", String(x1));
        start.setAttribute("cy", String(y1));
        start.style.opacity = String(inView ? easeOut(span(t, 0.2, 0.3)) * (1 - leave) : 0);
      });

      counter.textContent = String(done);
    };

    if (reduced) {
      render(1 - OUTRO);
      const onResize = () => {
        measure();
        render(1 - OUTRO);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ autoRaf: false, lerp: 0.085, wheelMultiplier: 0.9 });
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const st = ScrollTrigger.create({ trigger: track, start: "top top", end: "bottom bottom" });
    const frame = () => render(st.progress);
    gsap.ticker.add(frame);
    const onResize = () => {
      measure();
      ScrollTrigger.refresh();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      gsap.ticker.remove(frame);
      gsap.ticker.remove(raf);
      st.kill();
      lenis.destroy();
    };
  }, []);

  return (
    <div ref={trackRef} className="cb-track">
      <div ref={stageRef} className="cb-stage">
        <header className="cb-head">
          <span className="cb-kicker">5 / 8 · Cited code</span>
          <h2 className="cb-title">Every value cites the sentence it came from.</h2>
        </header>

        <div className="cb-grid">
          <article data-card className="cb-card cb-statute">
            <div className="cb-card-bar">
              <span className="cb-path">us / statute / 7 / 2017 / a</span>
              <span className="cb-count">
                <span data-count>0</span> / {MARKS.length} cited
              </span>
            </div>
            <p className="cb-text">
              {STATUTE.map((s, i) =>
                typeof s === "string" ? (
                  <span key={i}>{s}</span>
                ) : "em" in s ? (
                  <em key={i}>{s.em}</em>
                ) : (
                  <span key={i} data-phrase={s.mark} className="cb-phrase">
                    {s.text}
                  </span>
                ),
              )}
            </p>
            <div className="cb-dots" aria-hidden>
              {MARKS.map((m) => (
                <span key={m.id} data-dot className="cb-dot" />
              ))}
            </div>
          </article>

          <article data-card className="cb-card cb-code">
            <div className="cb-card-bar">
              <span className="cb-path">rulespec-us / us / statutes / 7 / 2017 / a.yaml</span>
            </div>
            <div ref={codeWinRef} className="cb-code-win">
              <ol ref={codeListRef} className="cb-code-list">
                {CODE.map((row, i) =>
                  "gap" in row ? (
                    <li key={`g${i}`} className="cb-gap" aria-hidden>
                      ⋯
                    </li>
                  ) : (
                    <li key={row.n} data-line={row.n} className="cb-line">
                      <span className="cb-n">{row.n}</span>
                      <code className="cb-src">{row.text}</code>
                      {MARKS.some((m) => m.line === row.n) && (
                        <span className="cb-chip">
                          “{short(phraseOf(MARKS.find((m) => m.line === row.n)!.id))}”
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ol>
            </div>
          </article>
        </div>

        <svg ref={svgRef} className="cb-wires" aria-hidden>
          {MARKS.map((m) => (
            <g key={m.id}>
              <path data-wire pathLength={1} className="cb-wire" />
              <circle data-end r={3.5} className="cb-end" />
              <circle data-start r={3} className="cb-end" />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
