"use client";

// The encoder section's story, in the Lamplight direction: a law book off
// the shelf, to cited code, to the systems that run on it — eight beats
// scrubbed by scroll on one WebGL canvas, then eight cards that each link
// to the real thing behind a step.
//
// Desktop with motion: a pinned stage. The poster of the current beat
// sits under the canvas until the canvas has drawn, so the stage is never
// empty while three.js loads (it loads only when the section is near).
// Phones, reduced motion and no WebGL 2: the posters as a plain sequence,
// then the same cards. The server renders that sequence too.

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EXPLORE } from "../journey-digital/data";
import { captionAt, captionCut, CAPTIONS, TOTAL } from "./captions";
import { PACE } from "./pacing";
import type { Director } from "./director";
import "../style-frames/style-frames.css";
import "./journey-lamplight.css";

const STORY = TOTAL; // beats; progress runs 0..STORY over them

// One steady pace on scroll: scroll moves through "scroll beats", and the
// pacing table (measured from the picture itself, see
// scripts/journey-pacing.cjs) turns them into story time, so a stretch
// that moves fast gets more scroll. A table measured for another
// timeline is not used.
const paced = Math.abs(PACE.total - TOTAL) < 1e-3;
const S_STORY = paced ? PACE.S[PACE.S.length - 1] : TOTAL;
const lookup = (xs: number[], ys: number[], x: number) => {
  let lo = 0;
  let hi = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo]);
};
// scroll beats → story time, and back; past the story they run 1:1
const storyAt = (s: number) => (s > S_STORY ? TOTAL + (s - S_STORY) : paced ? lookup(PACE.S, PACE.P, s) : s);
const scrollAt = (P: number) => (P > TOTAL ? S_STORY + (P - TOTAL) : paced ? lookup(PACE.P, PACE.S, P) : P);
// then the cards come up (by TOTAL + 0.45) and hold a moment, about a
// screen and a half of scroll, before the page moves on
const END = TOTAL + 1.0;
const END_S = scrollAt(END);
// scroll length, in screen heights: ~1.6 per scroll beat
const TRACK = Math.round(END_S * 1.6);

// the stills (paper); the night version keeps its own under /journey/night
const night = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("night");
const POSTER = (i: number) => `/journey${night() ? "/night" : ""}/posters/beat-${i + 1}.jpg`;
// the stand-in before the canvas draws: on paper, the story's exact first
// frame, so the hand-over to the live canvas shows no jump
const STANDIN = (i: number) => (i === 0 && !night() ? "/journey/start.webp" : POSTER(i));
// small copies for the cards: decoding eight full posters at once stalls
// the frame they appear on
const THUMB = (i: number) => `/journey${night() ? "/night" : ""}/thumbs/beat-${i + 1}.jpg`;

const ALT = [
  "A dark law library under one lamp. The amber volume, United States Code Title 7, Agriculture, is pulled half off its shelf.",
  "An open law book. Its pages lift off and break into small square cells that stream away as letters of light.",
  "A dark plain of lit page-cells, like a city at night. A stream of letters lands in one cell, addressed us/statute/7/2017/a.",
  "The words “30 per centum” flow into the first of four gates: encode, checks, compare and AI review. Draft 1 comes out of encode and fails checks; a pulse of light carries the failure back round a loop into encode. Draft 2 comes out as loose letters that draw tighter at every gate and run as one line into the encoded rule.",
  "Section 2017(a) beside its encoding in rulespec-us, us/statutes/7/2017/a.yaml. Numbered threads join each phrase to the line that encodes it; “30 per centum” joins 0.30.",
  "The rules of section 2017(a) as a graph of cards. Test case 1’s values run along the wires to snap_regular_month_allotment, $182.",
  "The runtime registry’s packages as clusters of light, with their counts; the eight rules of section 2017(a) are a small amber cluster in front.",
  "One source card, encoded and cited rules, sends beams to five kinds of user: individuals and navigators, governments, AI systems, builders, and researchers.",
];

const seg = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));

function ExploreCards({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? "jl-cards jl-cards--list" : "jl-cards"}>
      {EXPLORE.map((e) => {
        const external = e.href.startsWith("http");
        return (
          <li key={e.n}>
            <a className="jl-card" href={e.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {!compact && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={THUMB(e.n - 1)} alt="" loading="eager" decoding="async" width={720} height={405} />
              )}
              <span className="jl-card__meta">
                <span className="jl-card__n">{e.n}</span>
                <span className="jl-card__name">{e.name}</span>
              </span>
              <span className="jl-card__go">{e.go} →</span>
              <span className="jl-card__about">{e.about}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

// the real page behind a step, under its caption
function StepLink({ i }: { i: number }) {
  const e = EXPLORE[i];
  if (!e) return null;
  const external = e.href.startsWith("http");
  return (
    <a className="jl-steplink" href={e.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {e.go} →
    </a>
  );
}

function PosterJourney() {
  return (
    <>
    {night() && <div className="jl-dusk" aria-hidden />}
    <div className={night() ? "jl-posters jl-posters--night" : "jl-posters"}>
      {CAPTIONS.map((c, i) => (
        <figure key={c.kicker} className="jl-poster">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={POSTER(i)} alt={ALT[i]} loading="lazy" />
          <figcaption>
            <span className="jl-kicker">{c.kicker}</span>
            <span className="jl-title">{c.title}</span>
            <StepLink i={i} />
          </figcaption>
        </figure>
      ))}
      <div className="jl-explore jl-explore--static">
        <span className="jl-kicker">Explore</span>
        <span className="jl-title">Open any step.</span>
        {/* the posters were just shown: here the steps are a list of links */}
        <ExploreCards compact />
      </div>
    </div>
    {night() && <div className="jl-dawn" aria-hidden />}
    </>
  );
}

// the story is drawn on the page's own background ("paper"); the night
// version (Lamplight) stays reachable for comparison at ?night=1
const wantsPaper = () => typeof window === "undefined" || !new URLSearchParams(window.location.search).has("night");

function ScrollJourney() {
  const [paper] = useState(wantsPaper);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const exploreRef = useRef<HTMLDivElement | null>(null);
  const overlayRefs = useRef<HTMLDivElement[]>([]);
  const capRefs = useRef<HTMLDivElement[]>([]);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!track || !stage || !canvas) return;
    gsap.registerPlugin(ScrollTrigger);
    // the site's fixed nav covers the top of the viewport: the stage pins
    // just under it
    const navH = () => Math.round(document.querySelector("header.nav-bar")?.getBoundingClientRect().height ?? 0);
    // the stage is held by CSS (position: sticky), not by script: the
    // browser keeps it in place however fast the page scrolls. The track
    // is the stage's height plus the scroll the story runs over.
    const size = () => {
      track.style.setProperty("--nav-h", `${navH()}px`);
      track.style.setProperty("--jl-run", `${Math.round(window.innerHeight * TRACK)}px`);
    };
    size();
    let director: Director | null = null;
    let dead = false;
    let lastPoster = -1;

    // a caption hands over to the next at the middle of each cut: the
    // old one is gone just before, the new one comes up just after
    const cut = captionCut;
    const apply = (P: number) => {
      (window as unknown as { __jlP?: number }).__jlP = P;
      const i = captionAt(P);
      capRefs.current.forEach((el, j) => {
        const inn = j === 0 ? 1 : seg(P, cut(j) + 0.02, cut(j) + 0.12);
        const out = j < CAPTIONS.length - 1 ? 1 - seg(P, cut(j + 1) - 0.12, cut(j + 1) - 0.02) : 1 - seg(P, STORY, STORY + 0.15);
        const op = Math.min(inn, out);
        el.style.opacity = String(Math.max(0.001, op));
        const live = op > 0.6;
        if (el.hasAttribute("inert") === live) el.toggleAttribute("inert", !live);
      });
      // the poster only stands in until the canvas draws; after that it
      // never changes (each swap would decode a large image mid-scroll)
      if (!readyRef.current && i !== lastPoster && posterRef.current) {
        posterRef.current.src = STANDIN(i);
        lastPoster = i;
      }
      const e = seg(P, STORY + 0.05, STORY + 0.45);
      if (exploreRef.current) {
        // never fully 0, so the layer stays painted and ready
        exploreRef.current.style.opacity = String(Math.max(0.001, e));
        exploreRef.current.style.pointerEvents = e > 0.5 ? "auto" : "none";
        exploreRef.current.toggleAttribute("inert", e <= 0.5);
      }
      stage.style.setProperty("--dim", String(e));
      director?.setProgress(Math.min(STORY, P));
    };

    const st = ScrollTrigger.create({
      trigger: track,
      start: () => `top ${navH()}px`,
      end: () => `+=${Math.round(window.innerHeight * TRACK)}`,
      onUpdate: (self) => apply(storyAt(self.progress * END_S)),
    });
    apply(storyAt(st.progress * END_S));

    // three.js and the scenes load only as the section comes near
    // three.js and the scenes load in idle time soon after the page opens
    // (or at once if the reader is already near), so the first approach to
    // the story does not pay for building it
    let started = false;
    // building the scenes is one long task (~100 ms): run it while the
    // reader is not scrolling, unless the story is already close
    let lastScroll = 0;
    const onScroll = () => (lastScroll = performance.now());
    window.addEventListener("scroll", onScroll, { passive: true });
    const near = () => track.getBoundingClientRect().top < window.innerHeight * 3.5;
    const start = () => {
      if (started || director || dead) return;
      if (!near() && performance.now() - lastScroll < 220) {
        window.setTimeout(start, 120);
        return;
      }
      started = true;
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      load();
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) start();
      },
      // start well ahead of the story, never at its entrance
      { rootMargin: "350% 0px" },
    );
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 4000 });
      else setTimeout(cb, 1500);
    };
    const early = window.setTimeout(() => idle(start), 1200);
    const load = () => {
        import("./director").then(async ({ createDirector }) => {
          if (dead) return;
          const d = await createDirector({
            canvas,
            overlays: overlayRefs.current,
            width: stage.clientWidth,
            height: stage.clientHeight,
            paper: wantsPaper(),
            onFirstFrame: () => {
              readyRef.current = true;
              setReady(true);
            },
          });
          if (dead) return d.dispose();
          director = d;
          apply(storyAt(st.progress * END_S));
        }).catch((e) => {
          // the posters stay up if the scenes cannot be built
          console.error("journey: the scenes could not be built", e);
        });
    };
    io.observe(track);

    const onResize = () => {
      size();
      director?.resize(stage.clientWidth, stage.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // dev only: drive the story from a test harness. __jlSeek scrolls
    // (the canvas glides there); __jlRender draws P exactly, for video.
    if (process.env.NODE_ENV !== "production") {
      const hooks = window as unknown as {
        __jlSeek?: (P: number) => void;
        __jlReady?: () => Promise<unknown>;
        __jlRender?: (P: number) => void;
      };
      hooks.__jlSeek = (P) => window.scrollTo(0, st.start + (scrollAt(P) / END_S) * (st.end - st.start));
      hooks.__jlReady = async () => {
        while (!director) await new Promise((r) => setTimeout(r, 50));
        return director.prepareAll();
      };
      (window as unknown as { __jlTotal?: number }).__jlTotal = STORY;
      // for recordings at the reader's pace: scroll beats ↔ story time
      Object.assign(window, { __jlScrollTotal: S_STORY, __jlStoryAt: storyAt });
      (window as unknown as { __jlDirector?: () => Director | null }).__jlDirector = () => director;
      hooks.__jlRender = (P) => {
        window.scrollTo(0, st.start + (scrollAt(P) / END_S) * (st.end - st.start));
        apply(P);
        director?.jump(Math.min(STORY, P));
      };
    }
    return () => {
      dead = true;
      window.clearTimeout(early);
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      window.removeEventListener("resize", onResize);
      st.kill();
      director?.dispose();
    };
  }, []);

  return (
    <>
    {/* the page falls into the story's night, and comes back out of it,
        over half a screen each way: no edge between page and story */}
    {!paper && <div className="jl-dusk" aria-hidden />}
    <div ref={trackRef} className={paper ? "jl-track jl--paper" : "jl-track"}>
      <div ref={stageRef} className={`jl-stage sf--lamplight${paper ? " jl-stage--paper" : ""}${ready ? " is-drawn" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={posterRef} className="jl-poster-bg" src={STANDIN(0)} alt="" aria-hidden />
        <canvas
          ref={canvasRef}
          className={ready ? "jl-canvas is-ready" : "jl-canvas"}
          role="img"
          aria-label="From a law book to running code: Title 7 comes off the shelf, its pages become data, section 2017(a) is encoded and checked, each value cites its words, the rules form a graph that computes $182 for test case 1, the registry comes into view, and one source powers every kind of tool."
        />
        {CAPTIONS.map((_, i) => (
          <div
            key={i}
            className="jl-overlay"
            ref={(el) => {
              if (el) overlayRefs.current[i] = el;
            }}
          />
        ))}
        {CAPTIONS.map((c, i) => (
          <div
            key={c.kicker}
            className="jl-cap"
            ref={(el) => {
              if (el) capRefs.current[i] = el;
            }}
          >
            <span className="jl-kicker">{c.kicker}</span>
            <span className="jl-title">{c.title}</span>
          </div>
        ))}
        <div ref={exploreRef} className="jl-explore" inert>
          <span className="jl-kicker">Explore</span>
          <span className="jl-title">Open any step.</span>
          <ExploreCards />
        </div>
      </div>
    </div>
    {!paper && <div className="jl-dawn" aria-hidden />}
    </>
  );
}

export function JourneyLamplight() {
  const [mode, setMode] = useState<"posters" | "scroll">("posters");
  useEffect(() => {
    const mm = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
    let gl = false;
    try {
      gl = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      gl = false;
    }
    const wide = mm("(min-width: 900px)") && window.innerWidth >= window.innerHeight;
    if (gl && wide && !mm("(prefers-reduced-motion: reduce)")) setMode("scroll");
  }, []);
  return mode === "scroll" ? <ScrollJourney /> : <PosterJourney />;
}
