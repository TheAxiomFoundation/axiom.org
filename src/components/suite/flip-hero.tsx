"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { SUITE_LINES } from "./lines";

/** PROTOTYPE (suite-mock): the founder's flip-card hero. One sentence,
 *  "{what it is} for all", and the subject cycles through the five lines
 *  in that line's hue. Pauses on hover or focus, and does not animate
 *  when the visitor prefers reduced motion (the first card stays).
 *  The slot glides to the next subject's measured width across the whole
 *  flip, clipped at its sides, so "for all." slides instead of jumping. */
const CARDS = SUITE_LINES.map(({ slug, subject, hue }) => ({ slug, subject, hue }));
const COUNT_WORDS: Record<number, string> = { 3: "three", 4: "four", 5: "five", 6: "six" };
const HOLD_MS = 2200;
const FLIP_MS = 520;
const GLIDE = "cubic-bezier(0.65, 0, 0.35, 1)";

export function FlipHero() {
  const [i, setI] = useState(0);
  // The card the slot is sized for: the next one from the moment a flip starts.
  const [target, setTarget] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [widths, setWidths] = useState<number[] | null>(null);
  const reduced = useRef(false);
  const measure = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // The headline size follows the viewport, so widths are re-read on resize
  // and once the display font has loaded.
  useLayoutEffect(() => {
    const read = () =>
      setWidths(measure.current.map((el) => (el ? el.getBoundingClientRect().width : 0)));
    read();
    document.fonts?.ready.then(read);
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  useEffect(() => {
    if (paused || reduced.current) return;
    const next = (i + 1) % CARDS.length;
    const t = setTimeout(() => {
      setTarget(next);
      setFlipping(true);
      setTimeout(() => {
        setI(next);
        setFlipping(false);
      }, FLIP_MS / 2);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [i, paused]);

  const card = CARDS[i];

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
          <span
            className="relative inline-block align-baseline"
            style={{
              width: widths ? widths[target] : undefined,
              transition: `width ${FLIP_MS}ms ${GLIDE}`,
              clipPath: "inset(-0.4em 0 -0.4em 0)",
              perspective: "900px",
            }}
            data-flip-slot
          >
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
          {CARDS.map((c, n) => (
            <span
              key={c.slug}
              ref={(el) => {
                measure.current[n] = el;
              }}
              aria-hidden
              className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap"
            >
              {c.subject}
            </span>
          ))}
        </h1>

        <p className="mt-6 max-w-[600px] text-pretty font-body text-[1.1rem] leading-relaxed text-[var(--color-ink-secondary)]">
          The Axiom Institute builds open models of law and policy.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/suite/rules" className="btn-primary">
            Start with the rules
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
          <a href="#lines" className="btn-outline">
            See all {COUNT_WORDS[SUITE_LINES.length] ?? SUITE_LINES.length}
          </a>
        </div>
      </div>
    </section>
  );
}
