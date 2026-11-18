"use client";

import { useEffect, useRef } from "react";
import { CAPTIONS, STORY_LABEL } from "@/components/landing/journey-lamplight/captions";
import { captionOpacity, STORY_END_MS, storyAtTime } from "@/components/landing/journey-lamplight/clock";
import "@/components/landing/style-frames/style-frames.css";
import "@/components/landing/journey-lamplight/journey-lamplight.css";

declare global {
  interface Window {
    /** Resolves once every scene is built and the first frame is drawn. */
    __journeyReady?: Promise<void>;
    /** Draws the frame `ms` into the story at the presenter's pace, captions included (the recorder scales `ms` for a faster cut). */
    __journeyFrame?: (ms: number) => void;
    /** How long the story plays at the presenter's pace, in ms. */
    __journeyMs?: number;
  }
}

/**
 * The Aspen slide's stage (src/components/aspen/journey-slide.tsx) on the
 * whole window, with no clock of its own: the recorder sets story time
 * for each frame and takes a screenshot.
 */
export function JourneyVideoStage() {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlays = useRef<HTMLDivElement[]>([]);
  const caps = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    let dispose = () => {};
    window.__journeyReady = (async () => {
      const el = stage.current!;
      const { createDirector } = await import("@/components/landing/journey-lamplight/director");
      const director = await createDirector({
        canvas: canvas.current!,
        overlays: overlays.current,
        width: el.clientWidth,
        height: el.clientHeight,
        paper: true,
        glint: false,
      });
      dispose = director.dispose;
      await director.prepareAll();
      window.__journeyMs = STORY_END_MS;
      window.__journeyFrame = (ms: number) => {
        const P = storyAtTime(ms);
        caps.current.forEach((c, j) => (c.style.opacity = String(Math.max(0.001, captionOpacity(P, j)))));
        director.jump(P);
      };
      window.__journeyFrame(0);
    })();
    return () => dispose();
  }, []);

  return (
    <div
      ref={stage}
      className="jl-stage sf--lamplight jl-stage--paper is-drawn"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "var(--color-paper)", color: "var(--color-ink)" }}
    >
      {/* the site header and the dev build's badge are not part of the picture */}
      <style>{"nextjs-portal, .nav-bar { display: none !important; }"}</style>
      <canvas ref={canvas} className="jl-canvas is-ready" role="img" aria-label={STORY_LABEL} />
      {CAPTIONS.map((_, i) => (
        <div
          key={i}
          className="jl-overlay"
          ref={(el) => {
            if (el) overlays.current[i] = el;
          }}
        />
      ))}
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
    </div>
  );
}
