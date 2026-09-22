"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";

/** PROTOTYPE (suite-mock): the founder's flip-card hero. One sentence,
 *  "{what it is} for all", and the subject cycles through the five lines
 *  in that line's hue. Pauses on hover or focus, and does not animate
 *  when the visitor prefers reduced motion (the first card stays). */
const CARDS = [
  { slug: "rules", subject: "Computable law", hue: "#B45309" },
  { slug: "records", subject: "Official statistics", hue: "#33547D" },
  { slug: "microcosm", subject: "The economy in miniature", hue: "#3E7A5E" },
  { slug: "simulator", subject: "Policy simulations", hue: "#2C7A7B" },
  { slug: "forecasts", subject: "Scored forecasts", hue: "#A94E80" },
];
const HOLD_MS = 2200;
const FLIP_MS = 520;

export function FlipHero() {
  const [i, setI] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (paused || reduced.current) return;
    const t = setTimeout(() => {
      setFlipping(true);
      setTimeout(() => {
        setI((n) => (n + 1) % CARDS.length);
        setFlipping(false);
      }, FLIP_MS / 2);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [i, paused]);

  const card = CARDS[i];
  // The slot takes the current subject's width; the subject changes while
  // it is invisible (mid-flip), so "for all." moves only while nothing shows.

  return (
    <section className="relative z-1 px-8 pb-16 pt-20">
      <div className="mx-auto max-w-[1280px]">
        <h1
          className="mt-2 font-display text-[clamp(2.2rem,4.6vw,3.9rem)] font-light leading-[1.05] tracking-[-0.02em] text-[var(--color-ink)]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          aria-live="polite"
        >
          <span className="relative inline-block align-baseline" style={{ perspective: "900px" }} data-flip-slot>
            <Link
              href={`/suite/${card.slug}`}
              className="whitespace-nowrap no-underline"
              data-flip-subject
              style={{
                color: card.hue,
                display: "inline-block",
                transformOrigin: "50% 50%",
                transform: flipping ? "rotateX(90deg)" : "rotateX(0deg)",
                opacity: flipping ? 0 : 1,
                transition: `transform ${FLIP_MS / 2}ms ease-in, opacity ${FLIP_MS / 2}ms ease-in`,
              }}
            >
              {card.subject}
            </Link>
          </span>{" "}
          <span className="whitespace-nowrap">for all.</span>
        </h1>

        <p className="mt-6 max-w-[600px] text-pretty font-body text-[1.1rem] leading-relaxed text-[var(--color-ink-secondary)]">
          Open, executable implementations of government rules and records, and the models that run on them.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/suite/rules" className="btn-primary">
            Start with the rules
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
          <a href="#lines" className="btn-outline">
            See all five
          </a>
        </div>
      </div>
    </section>
  );
}
