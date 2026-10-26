"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { captionAt, captionCut, CAPTIONS, OVERLAP, SCENE_START, STORY_LABEL, TOTAL } from "@/components/landing/journey-lamplight/captions";
import { captionOpacity, END_S, PLAY_MS, S_STORY, scrollAt, storyAt, TRACK } from "@/components/landing/journey-lamplight/clock";
import type { Director } from "@/components/landing/journey-lamplight/director";
import "@/components/landing/style-frames/style-frames.css";
import "@/components/landing/journey-lamplight/journey-lamplight.css";

/** The canvas has this long to draw before the stills take over. */
const DRAW_TIMEOUT_MS = 8000;

/**
 * Where each caption's picture has settled, in story time: the first frame; in
 * the opening shot, just before the corpus caption comes up; then the end of
 * each scene's hold, just before the next scene dissolves in; and the story's end.
 */
export const STOPS = CAPTIONS.map((_, j) =>
  j === 0 ? 0 : j === 1 ? captionCut(2) - 0.15 : j === CAPTIONS.length - 1 ? TOTAL : SCENE_START[j - 1] - OVERLAP,
);
const STOPS_S = STOPS.map(scrollAt);

/** A step glides at three times the old pace (the cue sheet's two and a half minutes), in 2 to 6 seconds. */
export const STEP_MIN_MS = 2000;
export const STEP_MAX_MS = 6000;
const MS_PER_SCROLL_BEAT = PLAY_MS / END_S / 3;
export const stepMs = (from: number, to: number) =>
  Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, Math.abs(to - from) * MS_PER_SCROLL_BEAT));

/** Scroll at the homepage's own rate: its track is TRACK screen heights for END_S scroll beats. */
export const SCREENS_PER_SCROLL_BEAT = TRACK / END_S;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clampS = (s: number) => Math.min(S_STORY, Math.max(0, s));
/** Positions this close count as the same stop: a few pixels of trackpad drift after a step. */
const EPS = 0.05;

/** What the presenter's keys ask of the journey: true when it moved, false at its first or last caption. */
export type JourneyControl = { next: () => boolean; back: () => boolean };

// The homepage's paper stills (journey-lamplight.tsx): the first frame,
// then one poster per beat.
const STANDIN = "/journey/start.webp";
const POSTER = (i: number) => `/journey/posters/beat-${i + 1}.jpg`;

type Box = { left: number; top: number; width: number; height: number };

/** WebGL 2 with motion allowed: the homepage's own test for its animation. */
function canAnimate(): boolean {
  if (typeof window === "undefined" || typeof WebGL2RenderingContext === "undefined") return false;
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/**
 * Shared foundation 6/7: the homepage's encoding journey on its own WebGL
 * canvas with its own captions, moved by the presenter, not a clock (Max,
 * Oct 26: "more control as I'm talking over it"). It opens on the first
 * frame and waits.
 * - Scrolling moves it as scrolling moves the homepage, at the same rate.
 * - The right arrow, the clicker's page key or Space glides to the next
 *   caption and holds there; the left arrow glides back one. At the last
 *   caption the presenter moves on to the next slide, and at the first, back.
 *   Pressing again mid-glide goes on to the caption after; a press while the
 *   glide to the last (or first) caption is under way lands it there at once,
 *   and only the press after leaves the slide. While a key's glide runs, the
 *   wheel waits, so a trackpad's coasting can't cut it short.
 * - Home and End go straight to the first and last frame.
 * - Coming back from the next slide (`atEnd`) opens on the last frame.
 * The presenter's on-screen arrows still move between slides, so the journey
 * can be skipped. A click on the picture does nothing: the homepage's links in
 * it would take the presenter's tab away. Without WebGL 2, or with reduced
 * motion on, the homepage's stills take turns at the same positions.
 *
 * The scaled slide would draw the canvas at 1600×900 and stretch it, and
 * the captions are sized to the screen, so the stage sits over the slide at
 * the slide's size on screen, in the presenter's overlay layer
 * ([data-aspen-overlay]), under its controls.
 */
export function JourneySlide({ control, atEnd = false }: { control?: RefObject<JourneyControl | null>; atEnd?: boolean } = {}) {
  const slot = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const overlays = useRef<HTMLDivElement[]>([]);
  const caps = useRef<HTMLDivElement[]>([]);
  const posters = useRef<HTMLImageElement[]>([]);
  const bar = useRef<HTMLDivElement | null>(null);
  const director = useRef<Director | null>(null);
  /** Where the story is, in the homepage's scroll beats (0 to S_STORY). */
  const pos = useRef(atEnd ? S_STORY : 0);
  /** A step under way: it starts on the first frame after the key. */
  const glide = useRef<{ from: number; to: number; ms: number; start: number | null } | null>(null);
  const readyRef = useRef(false);
  /** Set when the picture or its captions change hands (a first render, canvas to stills), so the next frame draws even at rest. */
  const redraw = useRef(true);
  const [box, setBox] = useState<Box | null>(null);
  const [mode, setMode] = useState<"canvas" | "stills">(() => (canAnimate() ? "canvas" : "stills"));
  const [drawn, setDrawn] = useState(false);
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => setHost(document.querySelector("[data-aspen-overlay]") ?? document.body), []);

  // The slide's box on screen, again after the slide rescales.
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (b && b.left === r.left && b.top === r.top && b.width === r.width && b.height === r.height ? b : { left: r.left, top: r.top, width: r.width, height: r.height }));
    };
    measure();
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // The stills need nothing loaded; the canvas waits for its first frame. Either way the next frame draws.
  useEffect(() => {
    if (mode === "stills") readyRef.current = true;
    redraw.current = true;
  }, [mode]);

  // Each frame: a step's glide, then the story time at the position.
  useEffect(() => {
    let raf = 0;
    let shown = -1;
    const apply = (P: number) => {
      caps.current.forEach((el, j) => {
        el.style.opacity = String(Math.max(0.001, captionOpacity(P, j)));
      });
      const beat = captionAt(P);
      posters.current.forEach((el, j) => {
        el.style.opacity = j === beat ? "1" : "0";
      });
      director.current?.setProgress(P);
    };
    const tick = (now: number) => {
      const g = glide.current;
      if (g) {
        if (g.start === null) g.start = now;
        const t = Math.min(1, (now - g.start) / g.ms);
        pos.current = g.from + (g.to - g.from) * ease(t);
        if (t >= 1) glide.current = null;
      }
      const P = storyAt(pos.current);
      if (P !== shown || redraw.current) {
        apply(P);
        shown = P;
        redraw.current = false;
      }
      if (bar.current) bar.current.style.width = `${((100 * pos.current) / S_STORY).toFixed(2)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The presenter's keys: a caption on or back, from where a step under way is headed.
  useEffect(() => {
    if (!control) return;
    const go = (dir: 1 | -1) => {
      const at = glide.current?.to ?? pos.current;
      const to = dir > 0 ? STOPS_S.find((s) => s > at + EPS) : STOPS_S.findLast((s) => s < at - EPS);
      if (to === undefined) {
        // Past the first or last caption the key is the presenter's once the story is at rest. A press
        // while the glide to it runs lands it there now (the picture catches up as a scroll does), so
        // the key always shows something, and the next one moves on.
        if (!glide.current) return false;
        pos.current = glide.current.to;
        glide.current = null;
        return true;
      }
      glide.current = { from: pos.current, to, ms: stepMs(pos.current, to), start: null };
      return true;
    };
    const mine: JourneyControl = { next: () => go(1), back: () => go(-1) };
    control.current = mine;
    return () => {
      if (control.current === mine) control.current = null;
    };
  }, [control]);

  // Home and End go straight to the first and last frame: eased, the camera would travel through the story.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      glide.current = null;
      pos.current = e.key === "Home" ? 0 : S_STORY;
      director.current?.jump(storyAt(pos.current));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scrolling moves the story as it moves the homepage's. The presenter never scrolls, so the
  // journey takes the wheel while it's up, and a sideways swipe can't take the browser back.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // a pinch zooms
      e.preventDefault();
      if (glide.current) return;
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      pos.current = clampS(pos.current + px / (window.innerHeight * SCREENS_PER_SCROLL_BEAT));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // The homepage's director on this canvas, once the stage is on screen.
  const placed = box !== null && host !== null;

  // A click stops at the stage, before the canvas: its links would take the presenter's tab away.
  // Hovering still shows where they go. Cancelling it too keeps a link reached by Tab and Enter from
  // following itself.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const stop = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("click", stop, true);
    return () => el.removeEventListener("click", stop, true);
  }, [placed]);
  useEffect(() => {
    if (mode !== "canvas" || !placed || !canvas.current || !stage.current) return;
    const el = stage.current;
    let dead = false;
    let made: Director | null = null;
    const giveUp = window.setTimeout(() => {
      if (!readyRef.current) setMode("stills");
    }, DRAW_TIMEOUT_MS);
    import("@/components/landing/journey-lamplight/director")
      .then(async ({ createDirector }) => {
        if (dead || !canvas.current) return;
        made = await createDirector({
          canvas: canvas.current,
          overlays: overlays.current,
          width: el.clientWidth,
          height: el.clientHeight,
          paper: true,
          onFirstFrame: () => {
            readyRef.current = true;
            setDrawn(true);
          },
          // A later scene that can't be built would hold the story on the last one drawn.
          onError: (e) => {
            console.error("journey slide: a scene could not be built", e);
            if (!dead) setMode("stills");
          },
        });
        if (dead) return made.dispose();
        director.current = made;
        made.jump(storyAt(pos.current));
      })
      .catch((e) => {
        console.error("journey slide: the scenes could not be built", e);
        if (!dead) setMode("stills");
      });
    return () => {
      dead = true;
      window.clearTimeout(giveUp);
      made?.dispose();
      director.current = null;
    };
  }, [mode, placed]);

  useEffect(() => {
    if (box && stage.current) director.current?.resize(stage.current.clientWidth, stage.current.clientHeight);
  }, [box]);

  return (
    <>
      {/* The whole slide under the stage progress line. */}
      <div ref={slot} data-testid="journey-slot" className="absolute inset-x-0 bottom-0 top-[6px]" />
      {box &&
        host &&
        createPortal(
          <div
            ref={stage}
            data-journey={mode}
            className={`jl-stage sf--lamplight jl-stage--paper${drawn ? " is-drawn" : ""}`}
            // On the homepage the stage is see-through over the page (.jl--paper);
            // here it is the page: the canvas turns its white see-through.
            style={{
              position: "fixed",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              background: "var(--color-paper)",
              color: "var(--color-ink)",
            }}
          >
            {mode === "canvas" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* Stepped back into, the stage waits on the last frame, not the first. */}
                <img className="jl-poster-bg" src={atEnd ? POSTER(CAPTIONS.length - 1) : STANDIN} alt="" aria-hidden />
                <canvas ref={canvas} className={drawn ? "jl-canvas is-ready" : "jl-canvas"} role="img" aria-label={STORY_LABEL} />
                {CAPTIONS.map((_, i) => (
                  <div
                    key={i}
                    className="jl-overlay"
                    ref={(el) => {
                      if (el) overlays.current[i] = el;
                    }}
                  />
                ))}
              </>
            ) : (
              <div role="img" aria-label={STORY_LABEL} className="absolute inset-0">
                {CAPTIONS.map((c, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={c.kicker}
                    ref={(el) => {
                      if (el) {
                        posters.current[i] = el;
                        redraw.current = true;
                      }
                    }}
                    src={POSTER(i)}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
                    style={{ opacity: i === 0 ? 1 : 0 }}
                  />
                ))}
              </div>
            )}
            {CAPTIONS.map((c, i) => (
              <div
                key={c.kicker}
                className="jl-cap"
                ref={(el) => {
                  if (el) {
                    caps.current[i] = el;
                    redraw.current = true;
                  }
                }}
              >
                <span className="jl-title">{c.title}</span>
              </div>
            ))}
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--color-rule-subtle)]">
              <div ref={bar} className="h-full bg-[var(--color-accent)]" style={{ width: "0%" }} />
            </div>
          </div>,
          host,
        )}
    </>
  );
}
