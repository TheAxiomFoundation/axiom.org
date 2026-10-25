"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captionAt, CAPTIONS, STORY_LABEL } from "@/components/landing/journey-lamplight/captions";
import { captionOpacity, STORY_END_MS, storyAtTime } from "@/components/landing/journey-lamplight/clock";
import type { Director } from "@/components/landing/journey-lamplight/director";
import "@/components/landing/style-frames/style-frames.css";
import "@/components/landing/journey-lamplight/journey-lamplight.css";

/** The first frame holds this long before the camera moves. */
export const HOLD_MS = 1500;
/** A frame that comes this late (a hidden tab, a stall) moves the story on by no more than this. */
export const MAX_STEP_MS = 250;
/** The canvas has this long to draw before the stills take over. */
const DRAW_TIMEOUT_MS = 8000;

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
 * Shared foundation, after the pipeline: the homepage's encoding journey,
 * played at a steady pace on its own WebGL canvas with its own captions.
 * It holds the first frame, plays the eight beats in about two and a half
 * minutes, and holds the last. Space pauses and resumes it, and Home starts
 * it over; the arrows still move between slides. Without WebGL 2, or with
 * reduced motion on, the homepage's stills take turns on the same clock.
 *
 * The scaled slide would draw the canvas at 1600×900 and stretch it, and
 * the captions are sized to the screen, so the stage sits over the slide at
 * the slide's size on screen, in the presenter's overlay layer
 * ([data-aspen-overlay]), under its controls.
 */
export function JourneySlide() {
  const slot = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const overlays = useRef<HTMLDivElement[]>([]);
  const caps = useRef<HTMLDivElement[]>([]);
  const posters = useRef<HTMLImageElement[]>([]);
  const bar = useRef<HTMLDivElement | null>(null);
  const director = useRef<Director | null>(null);
  const played = useRef(0);
  const pausedRef = useRef(false);
  const readyRef = useRef(false);
  const [box, setBox] = useState<Box | null>(null);
  const [mode, setMode] = useState<"canvas" | "stills">(() => (canAnimate() ? "canvas" : "stills"));
  const [drawn, setDrawn] = useState(false);
  const [paused, setPaused] = useState(false);
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

  // The stills need nothing loaded; the canvas waits for its first frame.
  useEffect(() => {
    if (mode === "stills") readyRef.current = true;
  }, [mode]);

  // The clock: story time from the time played, held at the start and the end.
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
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
      if (last !== null && readyRef.current && !pausedRef.current) played.current += Math.min(MAX_STEP_MS, now - last);
      last = now;
      const P = storyAtTime(played.current - HOLD_MS);
      if (P !== shown) {
        apply(P);
        shown = P;
      }
      if (bar.current) bar.current.style.width = `${(100 * Math.min(1, Math.max(0, played.current - HOLD_MS) / STORY_END_MS)).toFixed(2)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Space pauses and resumes; Home starts over. The presenter leaves Space to this slide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      } else if (e.key === "Home") {
        e.preventDefault();
        played.current = 0;
        // Straight to the first frame: eased, the camera would travel back through the story.
        director.current?.jump(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The homepage's director on this canvas, once the stage is on screen.
  const placed = box !== null && host !== null;
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
        made.jump(storyAtTime(played.current - HOLD_MS));
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
            data-paused={paused ? "true" : "false"}
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
                <img className="jl-poster-bg" src={STANDIN} alt="" aria-hidden />
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
                      if (el) posters.current[i] = el;
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
                  if (el) caps.current[i] = el;
                }}
              >
                <span className="jl-title">{c.title}</span>
              </div>
            ))}
            {paused && (
              <span className="absolute right-[24px] top-[20px] rounded-full bg-[var(--color-paper)]/90 px-[14px] py-[4px] font-body text-[15px] text-[var(--color-ink-secondary)]">
                Paused: Space plays on
              </span>
            )}
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--color-rule-subtle)]">
              <div ref={bar} className="h-full bg-[var(--color-accent)]" style={{ width: "0%" }} />
            </div>
          </div>,
          host,
        )}
    </>
  );
}
