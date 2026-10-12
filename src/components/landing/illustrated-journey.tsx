"use client";

import { useEffect, useRef, useState } from "react";
import "./illustrated-journey.css";
import type { createJourneyScene } from "./journey-3d";

import {
  JOURNEY_CHAPTERS as CHAPTERS,
  chapterAt,
  verificationAt,
} from "./journey-timeline";

const CHECK_COPY = {
  run: ["Run", "Execute the draft calculation against example inputs."],
  checks: [
    "Checks",
    "Check the rule’s types, structure, and expected behavior.",
  ],
  disagreement: [
    "Comparison disagrees",
    "The draft uses 0.03. The source says 30 per centum: 0.30. Return to the encoding.",
  ],
  corrected: [
    "Correct and rerun",
    "The coefficient changes to 0.30. The revised rule returns through the checks.",
  ],
  compare: [
    "Compare again",
    "The corrected example agrees with the independent calculation.",
  ],
  review: [
    "Review complete",
    "The illustrated rule is ready to join its dependencies.",
  ],
} as const;

export function IllustratedJourney() {
  const track = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0),
    [ready, setReady] = useState(false),
    [fallback, setFallback] = useState(false);
  const [check, setCheck] = useState<ReturnType<typeof verificationAt>>("run");
  useEffect(() => {
    const root = track.current,
      canvasHost = host.current;
    if (!root || !canvasHost) return;
    const media = matchMedia(
      "(prefers-reduced-motion: reduce), (max-height: 540px)",
    );
    let disposed = false,
      loading = false,
      inRange = false,
      visible = false,
      scene: ReturnType<typeof createJourneyScene> | undefined,
      lastChapter = -1,
      lastCheck = "";
    const update = () => {
      const rect = root.getBoundingClientRect();
      const p = Math.max(
        0,
        Math.min(1, -rect.top / Math.max(1, rect.height - innerHeight)),
      );
      scene?.setProgress(p);
    };
    const load = async () => {
      if (loading || scene || disposed || media.matches || !inRange) return;
      loading = true;
      try {
        const { createJourneyScene } = await import("./journey-3d");
        if (disposed || media.matches) return;
        scene = createJourneyScene(
          canvasHost,
          (p) => {
            const index = chapterAt(p);
            const nextCheck = verificationAt(p);
            if (nextCheck !== lastCheck) {
              lastCheck = nextCheck;
              setCheck(nextCheck);
            }
            if (index !== lastChapter) {
              lastChapter = index;
              setActive(index);
            }
            root.style.setProperty("--ij-progress", String(p));
          },
          () => {
            setFallback(true);
            scene?.dispose();
            scene = undefined;
          },
        );
        scene.setVisible(visible);
        update();
        setReady(true);
      } catch {
        if (!disposed) setFallback(true);
      } finally {
        loading = false;
      }
    };
    const preference = () => {
      setFallback(media.matches);
      if (media.matches) {
        scene?.dispose();
        scene = undefined;
        setReady(false);
      } else void load();
    };
    preference();
    const preload = new IntersectionObserver(
      ([entry]) => {
        inRange = entry.isIntersecting;
        if (inRange) void load();
      },
      { rootMargin: "500px" },
    );
    preload.observe(root);
    const viewport = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      scene?.setVisible(visible);
      if (visible) update();
    });
    viewport.observe(root);
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    media.addEventListener("change", preference);
    return () => {
      disposed = true;
      preload.disconnect();
      viewport.disconnect();
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
      media.removeEventListener("change", preference);
      scene?.dispose();
    };
  }, []);
  const goTo = (index: number) => {
    const e = track.current;
    if (e)
      scrollTo({
        top:
          scrollY +
          e.getBoundingClientRect().top +
          CHAPTERS[index].at * (e.offsetHeight - innerHeight),
        behavior: "smooth",
      });
  };
  return (
    <div
      className={`ij-track${fallback ? " ij-static" : ""}`}
      ref={track}
      data-chapter={active}
    >
      <div className="ij-stage">
        <div className="ij-canvas" ref={host} />
        <div className="ij-vignette" aria-hidden="true" />
        <header className="ij-caption">
          <span className="ij-kicker">
            0{(fallback ? 2 : active) + 1} /{" "}
            {CHAPTERS[fallback ? 2 : active].label}
          </span>
          <h3>{CHAPTERS[fallback ? 2 : active].title}</h3>
          <p>{CHAPTERS[fallback ? 2 : active].text}</p>
        </header>
        {(!ready || fallback) && (
          <div className="ij-fallback">
            <div className="ij-fallback-cover">
              <small>UNITED STATES CODE</small>
              <strong>Title 7</strong>
              <span>Agriculture</span>
            </div>
            <article>
              <span>7 USC § 2017(a)</span>
              <h4>Value of allotment</h4>
              <p>
                …reduced by an amount equal to{" "}
                <mark>30 per centum of the household’s income</mark>…
              </p>
            </article>
          </div>
        )}
        <div
          className={`ij-source${active === 2 || fallback ? " is-visible" : ""}`}
        >
          <span>7 USC § 2017(a)</span>
          <p>
            “…reduced by an amount equal to{" "}
            <mark>30 per centum of the household’s income</mark>…”
          </p>
        </div>
        {active === 3 && !fallback && (
          <aside className="ij-insight">
            <span>DRAFT ENCODING</span>
            <p>
              The highlighted words become a typed calculation. Its citation
              stays attached.
            </p>
            <small>Simplified example · the draft still needs checking</small>
          </aside>
        )}
        {active === 4 && !fallback && (
          <aside
            className={`ij-insight ij-check-panel ${check === "disagreement" ? "has-failure" : ""}`}
          >
            <div className="ij-gates" aria-label="Verification gates">
              {["Run", "Checks", "Compare", "Review"].map((label, i) => {
                const completed = {
                  run: 0,
                  checks: 1,
                  disagreement: 2,
                  corrected: 0,
                  compare: 2,
                  review: 4,
                }[check];
                const done = i < completed;
                return (
                  <span key={label} className={done ? "is-done" : ""}>
                    {done
                      ? "✓"
                      : check === "disagreement" && i === 2
                        ? "×"
                        : "·"}{" "}
                    {label}
                  </span>
                );
              })}
            </div>
            <strong>{CHECK_COPY[check][0]}</strong>
            <p>{CHECK_COPY[check][1]}</p>
          </aside>
        )}
        {active === 5 && !fallback && (
          <aside className="ij-insight">
            <span>SHARED, NOT COPIED</span>
            <p>
              Thrifty food plan, net income, and eligibility connect to the
              allotment. State programs reuse the federal foundation.
            </p>
            <small>Illustrative dependencies and program reuse</small>
          </aside>
        )}
        {active === 6 && !fallback && (
          <aside className="ij-insight ij-legend">
            <span>
              <i /> Encoded & connected
            </span>
            <span>
              <i /> Still to encode
            </span>
            <p>
              An illustration of the wider corpus, not a live coverage count.
            </p>
          </aside>
        )}
        <div className="ij-footer">
          <span>
            THE ENCODING JOURNEY <b>·</b> ILLUSTRATIVE SEQUENCE
          </span>
          {!fallback && <span>Scroll to follow the rule ↓</span>}
        </div>
        {!fallback && (
          <nav className="ij-navigation" aria-label="Encoding journey chapters">
            {CHAPTERS.map(({ label }, i) => (
              <button
                key={label}
                aria-label={`0${i + 1} ${label}`}
                onClick={() => goTo(i)}
                aria-current={active === i ? "step" : undefined}
              >
                <span>0{i + 1}</span>
                <b>{label}</b>
              </button>
            ))}
            <i className="ij-progress" />
          </nav>
        )}
        <p className="ij-accessible">
          A three-dimensional law library. Title 7 moves off its shelf, turns
          toward the reader, and opens to section 2017. The passage lifts into a
          cited rule. A comparison catches an incorrect coefficient; the
          corrected rule connects to dependencies and state programs. The camera
          pulls back to the wider graph.
        </p>
      </div>
      {fallback && (
        <ol className="ij-static-story">
          {CHAPTERS.slice(3).map((chapter) => (
            <li key={chapter.label}>
              <span>{chapter.label}</span>
              <h4>{chapter.title}</h4>
              <p>{chapter.text}</p>
              {chapter.label === "The encoding" && (
                <code>max(0, tfp − 0.30 × net_income)</code>
              )}
              {chapter.label === "The verification" && (
                <p>
                  The draft uses 0.03. Comparison identifies the disagreement
                  with “30 per centum”; the coefficient is corrected to 0.30 and
                  the checks run again.
                </p>
              )}
              {chapter.label === "The connections" && (
                <p>
                  Thrifty food plan, net income, and eligibility → SNAP
                  allotment → state programs.
                </p>
              )}
            </li>
          ))}
          <li>
            <small>
              Illustrative sequence and simplified formula; not a live execution
              or coverage report.
            </small>
          </li>
        </ol>
      )}
    </div>
  );
}
