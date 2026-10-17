"use client";

// One style frame: a 1920×1080 still of one beat in one art direction,
// with that direction's caption typography laid over it. Sets
// window.__frameReady once the frame is drawn, for the render script.

import { useEffect, useRef } from "react";
import { createBeat, loadFonts, makeRenderer, Pipeline, placeLabels, W, H, type BeatBuilder } from "./kit";
import { lamplightShelf } from "./lamplight0";
import { lamplightShelfToBook } from "./lamplight01";
import { lamplightExplore } from "./lamplight3";
import { lamplightBeat1, lamplightBeat5 } from "./lamplight";
import { lamplightBeat2, lamplightBeat3, lamplightBeat4, lamplightBeat6, lamplightBeat7 } from "./lamplight2";
import { snapshotMonth } from "../registry-snapshot";
import "./style-frames.css";

export type Direction = "lamplight";

// beat keys in story order: 0 shelf … 7 every system, 9 the end state
export const BUILDERS: Record<string, BeatBuilder> = {
  "0": lamplightShelf,
  "01": lamplightShelfToBook, // beats 1 and 2 as one shot
  "1": lamplightBeat1,
  "2": lamplightBeat2,
  "3": lamplightBeat3,
  "4": lamplightBeat4,
  "5": lamplightBeat5,
  "6": lamplightBeat6,
  "7": lamplightBeat7,
  "9": lamplightExplore,
};

const CAPTIONS: Record<string, { kicker: string; title: string }> = {
  "9": {
    kicker: "Explore",
    title: "Open any step.",
  },
  "0": {
    kicker: "1 / 8 · Off the shelf",
    title: "It starts with the law as written.",
  },
  "1": {
    kicker: "2 / 8 · The law, as published",
    title: "Hundreds of official sources, word for word.",
  },
  "2": {
    kicker: "3 / 8 · The corpus",
    title: "Every provision has an address.",
  },
  "3": {
    kicker: "4 / 8 · Encode · an illustration",
    title: "AI drafts a rule. A failed check sends it back.",
  },
  "4": {
    kicker: "5 / 8 · Cited code",
    title: "Every value cites the sentence it came from.",
  },
  "6": {
    kicker: `7 / 8 · All the law · ${snapshotMonth()} snapshot`,
    title: "The same structure, at scale.",
  },
  "7": {
    kicker: "8 / 8 · Every system",
    title: "One set of rules powers every kind of tool, built by anyone.",
  },
  "5": {
    kicker: "6 / 8 · The graph",
    title: "Typed, cited, executable.",
  },
};

export function StyleFrame({ dir, beat, t = 1 }: { dir: Direction; beat: string; t?: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    const build = BUILDERS[beat];
    if (!host || !overlay || !build) return;
    let dead = false;
    const renderer = makeRenderer();
    renderer.setPixelRatio(1);
    renderer.setSize(W, H);
    host.appendChild(renderer.domElement);
    document.body.classList.add("sf-body");
    (async () => {
      await loadFonts();
      if (dead) return;
      const b = createBeat(build, overlay);
      await b.ready;
      if (dead) return;
      b.update?.(t);
      const pipe = new Pipeline(renderer, W, H, true);
      pipe.render(b);
      placeLabels(b, W, H);
      // a second pass lets late textures settle
      requestAnimationFrame(() => {
        pipe.render(b);
        (window as unknown as { __frameReady?: boolean }).__frameReady = true;
      });
    })();
    return () => {
      dead = true;
      document.body.classList.remove("sf-body");
      renderer.dispose();
      host.innerHTML = "";
      overlay.innerHTML = "";
    };
  }, [dir, beat, t]);

  const cap = CAPTIONS[beat];
  return (
    <div className={`sf sf--${dir}`}>
      <div ref={hostRef} className="sf-host" />
      <div ref={overlayRef} className="sf-overlay" />
      {cap && (
        <div className="sf-caption">
          <div className="sf-caption__kicker">{cap.kicker}</div>
          <div className="sf-caption__title">{cap.title}</div>
        </div>
      )}
    </div>
  );
}
