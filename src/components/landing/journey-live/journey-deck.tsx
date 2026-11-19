"use client";

// The encoder walkthrough as a slide: the same story as the landing page
// (journey-live.tsx), but the presenter holds the clock, not the window's
// scroll. Two ways to drive it:
//
//   video   each "next" plays one step, like a clip, and stops at its
//           rest. "Play" runs all eight with a short hold on each.
//   scroll  the wheel, a trackpad or a drag scrubs the story inside the
//           slide; the page itself does not move. "Next" glides to the
//           next rest.
//
// Keys: → Space PageDown next · ← PageUp back · 1–8 a step · Home / End ·
// P play or pause (video) · F full screen.
//
// To reuse it in another deck, put the page in a frame with ?embed=1. The
// frame then shows the picture alone, with no words and no controls, and
// talks to the page around it (the axiom-slides deck does this):
//
//   in   { type: "axiom-walkthrough:go", step, play }
//          step 0 is the start of the story, 1–7 the stops after it (the
//          first is the captured page, the last the end of the story);
//          play moves there as a clip, otherwise it is a cut
//   in   { type: "axiom-walkthrough:play" }
//          the whole story from the start, with a short hold on each step
//   out  { type: "axiom-walkthrough:step", step, total, title, about }
//          at the start and on each change of step, so the slide can
//          write the words
//   out  { type: "axiom-walkthrough:key", key }
//          a "next" at the end or a "back" at the start, for the deck

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CAPTIONS } from "../journey-lamplight/captions";
import { EXPLORE } from "../journey-digital/data";
import { CAPTION_ALL, LiveStory, TOTAL_S } from "./journey-live";
import { nextStop, prevStop, stepAt } from "./deck-clock";
import { REST_AT, WALK, WALK_CUT } from "./layout";
import "./journey-deck.css";

export type DeckMode = "video" | "scroll";

// Where a "next" stops. The first one runs the whole opening as one clip:
// down the aisle, the book off the shelf, and the page captured. The walk
// alone is not a stop.
const STOPS = REST_AT.slice(1);
const STEPS = CAPTION_ALL.length;
// clock units (screens of the landing page's scroll) a second
const PLAY_RATE = 0.62;
const GLIDE_RATE = 2.6;
// "Play": how long each step holds at its rest
const HOLD_MS = 1800;
// the walk down the aisle runs faster than the rest, as on the page
const WALK_GAIN = WALK / (WALK - WALK_CUT);

export const MSG = "axiom-walkthrough";

export function JourneyDeck({ mode = "video", base = "", embed = false }: { mode?: DeckMode; base?: string; embed?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  // where the clock is going, and how fast; null when it rests
  const run = useRef<{ to: number; rate: number } | null>(null);
  const auto = useRef(false);
  const holdUntil = useRef(0);
  // scroll mode: where the wheel has asked the clock to be
  const want = useRef(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [moving, setMoving] = useState(false);
  const [touched, setTouched] = useState(false);

  const goTo = useCallback((to: number, rate: number) => {
    run.current = { to, rate };
    want.current = to;
  }, []);
  const jump = useCallback((to: number) => {
    run.current = null;
    clock.current = to;
    want.current = to;
  }, []);
  const stopAuto = useCallback(() => {
    auto.current = false;
    setPlaying(false);
  }, []);

  const toParent = useCallback(
    (msg: Record<string, unknown>) => {
      if (embed && window.parent !== window) window.parent.postMessage(msg, "*");
    },
    [embed],
  );

  const next = useCallback(() => {
    setTouched(true);
    stopAuto();
    if (clock.current >= TOTAL_S - 0.01) return toParent({ type: `${MSG}:key`, key: "ArrowRight" });
    // a second "next" while a step plays finishes it at once
    if (run.current && mode === "video") return jump(run.current.to);
    goTo(nextStop(STOPS, clock.current), mode === "video" ? PLAY_RATE : GLIDE_RATE);
  }, [goTo, jump, mode, stopAuto, toParent]);
  const back = useCallback(() => {
    setTouched(true);
    stopAuto();
    if (clock.current <= 0.01) return toParent({ type: `${MSG}:key`, key: "ArrowLeft" });
    jump(prevStop(STOPS, clock.current));
  }, [jump, stopAuto, toParent]);
  const toStep = useCallback(
    (j: number) => {
      setTouched(true);
      stopAuto();
      jump(REST_AT[Math.max(0, Math.min(STEPS - 1, j))]);
    },
    [jump, stopAuto],
  );
  const togglePlay = useCallback(() => {
    setTouched(true);
    if (auto.current) {
      // pause holds the picture where it is
      run.current = null;
      return stopAuto();
    }
    if (clock.current >= TOTAL_S - 0.01) jump(0);
    auto.current = true;
    holdUntil.current = 0;
    setPlaying(true);
    goTo(nextStop(STOPS, clock.current), PLAY_RATE);
  }, [goTo, jump, stopAuto]);
  const fullScreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  // the clock
  useEffect(() => {
    // dev only: read the deck's clock
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __jd: { clock, run, stops: STOPS, gsap } });
    let shown = -1;
    let wasMoving = false;
    // on the story's own ticker, so the clock moves before each draw
    const tick = (_time: number, deltaMs: number) => {
      const now = performance.now();
      const dt = Math.min(0.05, deltaMs / 1000);
      const r = run.current;
      let isMoving = false;
      if (r) {
        const d = r.to - clock.current;
        const stepBy = r.rate * dt * (clock.current < WALK && d > 0 ? WALK_GAIN : 1);
        if (Math.abs(d) <= stepBy) {
          clock.current = r.to;
          run.current = null;
          if (auto.current) holdUntil.current = now + HOLD_MS;
        } else {
          clock.current += Math.sign(d) * stepBy;
          isMoving = true;
        }
      } else if (auto.current) {
        if (clock.current >= TOTAL_S - 0.01) {
          auto.current = false;
          setPlaying(false);
        } else if (now >= holdUntil.current) {
          run.current = { to: nextStop(STOPS, clock.current), rate: PLAY_RATE };
        }
      } else if (mode === "scroll") {
        const d = want.current - clock.current;
        if (Math.abs(d) > 0.0005) {
          clock.current += d * Math.min(1, dt * 9);
          isMoving = Math.abs(d) > 0.01;
        }
      }
      const j = stepAt(CAPTION_ALL, clock.current);
      if (j !== shown) setStep((shown = j));
      if (isMoving !== wasMoving) setMoving((wasMoving = isMoving));
    };
    gsap.ticker.add(tick, false, true);
    return () => gsap.ticker.remove(tick);
  }, [mode]);

  // in a frame: tell the slide which step is up, and take its orders
  useEffect(() => {
    toParent({ type: `${MSG}:step`, step: step + 1, total: STEPS, title: CAPTIONS[step].title, about: EXPLORE[step].about });
  }, [step, toParent]);
  useEffect(() => {
    if (!embed) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; step?: number; play?: boolean } | null;
      if (e.source !== window.parent || !d) return;
      if (d.type === `${MSG}:play`) {
        jump(0);
        setTouched(true);
        auto.current = true;
        holdUntil.current = performance.now() + 700;
        setPlaying(true);
        return;
      }
      if (d.type !== `${MSG}:go` || typeof d.step !== "number") return;
      const to = d.step <= 0 ? 0 : STOPS[Math.min(STOPS.length, Math.round(d.step)) - 1];
      stopAuto();
      setTouched(true);
      if (d.play && to > clock.current) goTo(to, PLAY_RATE);
      else jump(to);
    };
    window.addEventListener("message", onMessage);
    // the slide may have asked before this page could listen
    toParent({ type: `${MSG}:ready` });
    return () => window.removeEventListener("message", onMessage);
  }, [embed, goTo, jump, stopAuto, toParent]);

  // keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") next();
      else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") back();
      else if (k === "Home") (setTouched(true), stopAuto(), jump(0));
      else if (k === "End") toStep(STEPS - 1);
      else if (k === "p" || k === "P") {
        if (mode === "video") togglePlay();
      } else if (k === "f" || k === "F") fullScreen();
      else if (/^[1-8]$/.test(k)) toStep(Number(k) - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, fullScreen, jump, mode, next, stopAuto, toStep, togglePlay]);

  // scroll mode: the wheel and a drag scrub the story; the page stays put
  useEffect(() => {
    const el = rootRef.current;
    if (!el || mode !== "scroll") return;
    const scrub = (screens: number) => {
      run.current = null;
      const gain = want.current < WALK && screens > 0 ? WALK_GAIN : 1;
      want.current = Math.max(0, Math.min(TOTAL_S, want.current + screens * gain));
      setTouched(true);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      scrub((px / window.innerHeight) * 0.9);
    };
    let dragY: number | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("a,button")) return;
      dragY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (dragY === null) return;
      scrub(((dragY - e.clientY) / window.innerHeight) * 1.4);
      dragY = e.clientY;
    };
    const onUp = () => (dragY = null);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [mode]);

  return (
    <div ref={rootRef} className="jd" data-mode={mode} data-moving={moving ? "1" : "0"} data-embed={embed ? "" : undefined}>
      <LiveStory base={base} clock={clock} bare={embed} />
      <div className="jd-bar" role="group" aria-label="Slide controls" hidden={embed}>
        <button type="button" className="jd-btn" onClick={back} aria-label="Back one step">
          ←
        </button>
        <button type="button" className="jd-btn" onClick={next} aria-label={mode === "video" ? "Play the next step" : "Next step"}>
          →
        </button>
        {mode === "video" ? (
          <button type="button" className="jd-btn jd-btn--text" onClick={togglePlay} aria-pressed={playing}>
            {playing ? "Pause" : "Play all"}
          </button>
        ) : null}
        <ol className="jd-dots" aria-label="Steps">
          {CAPTION_ALL.map((_, j) => (
            <li key={j}>
              <button
                type="button"
                className="jd-dot"
                aria-label={`Step ${j + 1}`}
                aria-current={j === step ? "step" : undefined}
                onClick={() => toStep(j)}
              />
            </li>
          ))}
        </ol>
        <span className="jd-count" aria-live="polite">
          {step + 1} / {STEPS}
        </span>
        <span className="jd-modes">
          <a href="?mode=video" aria-current={mode === "video" ? "page" : undefined}>
            Video
          </a>
          <a href="?mode=scroll" aria-current={mode === "scroll" ? "page" : undefined}>
            Scroll
          </a>
        </span>
        <button type="button" className="jd-btn jd-btn--text" onClick={fullScreen}>
          Full screen
        </button>
      </div>
      {touched || embed ? null : (
        <p className="jd-hint">{mode === "video" ? "Press → to play each step, or P to play all" : "Scroll to move through the story, or press →"}</p>
      )}
    </div>
  );
}
