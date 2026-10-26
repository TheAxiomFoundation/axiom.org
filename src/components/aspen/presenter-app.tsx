"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BookText,
  ChartColumn,
  Check,
  ClipboardCheck,
  Database,
  Download,
  FileCode,
  GraduationCap,
  Landmark,
  Layers,
  Network,
  Package,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  BREAKOUT_PROMPT,
  GROUP_QUESTIONS,
  DISCUSSION_QUESTIONS,
  EVENT,
  GOLDEN_A,
  NEXT_STEPS,
  ONE_SET_OF_RULES,
  ONE_SET_STATEMENT,
  FOUNDATION_TRAITS,
  EXAMPLE_HOUSEHOLD,
  BUILD_HEADING,
  ENCODING_PIPELINE,
  FRONT_DOOR,
  LIVE_DEMO,
  liveDemoUrl,
  POLICYBENCH,
  SAME_RULES,
  SILVER_ASK,
  ENGINE_PILOT,
  percentChange,
  WHAT_MODELS_MISS,
  WHERE_MODELS_BREAK,
  STAGES,
  USE_CASES,
  percent,
  stageIndex,
  type StageId,
} from "@/lib/aspen/content";
import type { Control } from "@/lib/aspen/types";
import { EMPTY_SUMMARY, ifEligibleSentence, type Count, type RunSummary, type ScaleSummary } from "@/lib/aspen/results";
import { postJson, useControl, useResults } from "./client";
import { BUTTON_QUIET, FIELD } from "./ui";
import { BrandLogo } from "./brand-logo";
import { JoinQr } from "./join-qr";
import { JourneySlide } from "./journey-slide";
import { TIERS, TierMedal } from "./tier-medal";

/** The slide canvas: drawn at 1600×900 and scaled to fit the screen, so every stage fits 16:9. */
const SLIDE_W = 1600;
const SLIDE_H = 900;

/** Aspen headings read in sentence case, not the site's uppercase display style. */
const SENTENCE = { textTransform: "none", letterSpacing: "-0.01em" } as const;

/** Bar colours for a good, bad or in-between answer. */
const GOOD = "var(--color-success)";
const BAD = "var(--color-error)";
const MAYBE = "var(--color-rule-strong)";

/** Why an answer is worth discussing. */
const REASON_LABEL: Record<string, string> = {
  "checked-wrong": "Wrong against the rules",
  wrong: "Looked wrong",
  unsure: "Not sure",
};

/** Why an answer is worth discussing, in the rater's own terms: an answer acted on says how it looked. */
function reasonLabel(item: { reason: string; verdict: string | null }): string {
  if (item.reason === "convincing") return item.verdict === "unsure" ? "Not sure, yet acted on" : "Looked wrong, yet acted on";
  return REASON_LABEL[item.reason] ?? item.reason;
}

/** The journey covers its slide, heading too; this names it for a screen reader. */
const JOURNEY_HEADING = "From the law as written to running code";

/** A slide that turns its stage's argument gets its own heading. */
const SLIDE_TITLES: Partial<Record<StageId, Record<number, string>>> = {
  scale: { 4: FRONT_DOOR.heading, 5: FRONT_DOOR.heading, 6: FRONT_DOOR.heading },
  foundation: { 1: JOURNEY_HEADING },
};

/**
 * Shared foundation's slides, in order; the journey takes Space for itself. A title slide, then the
 * journey, which shows how the rules get built and what they power (the dry run, Oct 25). The
 * same-rules, pipeline and tiers slides stay below, off the deck, in case they come back.
 */
const FOUNDATION_SLIDES = ["foundation", "journey"] as const;

/** Stages shown as more than one slide; the arrows step through them before moving the room. */
const SLIDES: Partial<Record<StageId, number>> = { reveal: 2, scale: 7, foundation: FOUNDATION_SLIDES.length, groups: 2, next: 2 };
const slideCount = (id: StageId) => SLIDES[id] ?? 1;

/** The largest scale at which the 16:9 canvas fits the window. */
function useFit(): number {
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const measure = () => setFit(Math.min(window.innerWidth / SLIDE_W, window.innerHeight / SLIDE_H));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return fit;
}

/**
 * The big screen at axiom.org/aspen/present. Arrow keys (or the buttons)
 * step through the slides and move the whole room between stages; results
 * refresh every few seconds. The controls fade when the mouse rests.
 */
export function PresenterApp({ joinPassword }: { joinPassword: string | null }) {
  const { data: polled } = useControl(3000);
  const [control, setControl] = useState<Control | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runDraft, setRunDraft] = useState("");
  // The new-run form stays folded away until the presenter opens it.
  const [runOpen, setRunOpen] = useState(false);
  // Agency comments stay hidden until the presenter chooses to show them.
  const [showComments, setShowComments] = useState(false);
  // Which slide of a multi-slide stage is up; any other stage starts at its first slide.
  const [slide, setSlide] = useState<{ stage: StageId; sub: number }>({ stage: "welcome", sub: 0 });
  // The controls fade out when the mouse rests, so the room sees only the slide.
  const [idle, setIdle] = useState(false);
  const fit = useFit();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setIdle(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 3000);
    };
    window.addEventListener("mousemove", wake);
    timer = setTimeout(() => setIdle(true), 3000);
    return () => {
      window.removeEventListener("mousemove", wake);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Moves in flight: a poll that started before a move must not undo it.
  const moving = useRef(0);

  useEffect(() => {
    if (!polled || moving.current > 0) return;
    // Drop a poll older than the change this screen already saved.
    setControl((c) =>
      c?.updatedAt && polled.updatedAt && polled.updatedAt < c.updatedAt ? c : polled,
    );
  }, [polled]);

  const stage = (stageIndex(control?.stage) >= 0 ? control?.stage : "welcome") as StageId;
  const index = stageIndex(stage);
  const sub = slide.stage === stage ? Math.min(slide.sub, slideCount(stage) - 1) : 0;
  const { data: results } = useResults(true, 4000, control?.runId);
  const summary: RunSummary = results?.summary ?? EMPTY_SUMMARY;

  const move = useCallback(async (patch: { stage?: StageId; runId?: string }) => {
    if (patch.stage) setControl((c) => (c ? { ...c, stage: patch.stage as string } : c));
    moving.current += 1;
    const response = await postJson<Control & { error?: string }>("/api/aspen/state", patch).catch(() => null);
    moving.current -= 1;
    if (response?.ok) {
      setControl(response.data);
      setError(null);
    } else {
      setError(response?.data.error ?? "The stage did not change. Check the connection.");
    }
  }, []);

  const step = useCallback(
    (delta: number) => {
      const target = sub + delta;
      if (target >= 0 && target < slideCount(stage)) {
        setSlide({ stage, sub: target });
        return;
      }
      const next = STAGES[Math.min(STAGES.length - 1, Math.max(0, index + delta))];
      if (next.id === stage) return;
      // Stepping back lands on the last slide of the stage before.
      setSlide({ stage: next.id, sub: delta < 0 ? slideCount(next.id) - 1 : 0 });
      void move({ stage: next.id });
    },
    [index, stage, sub, move],
  );

  const onJourney = stage === "foundation" && FOUNDATION_SLIDES[sub] === "journey";
  // The journey's chunk (three.js and its scenes) loads while the stage's first slides are up.
  useEffect(() => {
    if (stage === "foundation") void import("@/components/landing/journey-lamplight/director").catch(() => {});
  }, [stage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRunOpen(false);
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      // A clicked button keeps the focus, and Space and Enter press it; the
      // arrows and a clicker's page keys still move the slides.
      if (target?.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      // On the journey, Space pauses it instead.
      if (e.key === " " && onJourney) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        step(1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onJourney]);

  const current = STAGES[index];
  const fade = `transition-opacity duration-500 focus-within:opacity-100 ${idle ? "opacity-0" : "opacity-100"}`;

  return (
    <div data-aspen-presenter className="fixed inset-0 z-1 overflow-hidden bg-[var(--color-ink)]">
      <div className="flex h-full w-full items-center justify-center">
        <div style={{ width: SLIDE_W * fit, height: SLIDE_H * fit }}>
          <div
            data-testid="slide"
            className="relative overflow-hidden bg-[var(--color-paper)]"
            style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${fit})`, transformOrigin: "top left" }}
          >
            <div aria-hidden className="absolute inset-x-0 top-0 h-[6px] bg-[var(--color-rule)]">
              <div
                className="h-full bg-[var(--color-accent)] transition-[width] duration-700"
                style={{ width: `${((index + 1) / STAGES.length) * 100}%` }}
              />
            </div>
            <div className="flex h-full flex-col px-[96px] pb-[64px] pt-[72px]">
              {stage !== "welcome" && stage !== "dinner" && (
                <SlideHeader title={SLIDE_TITLES[stage]?.[sub] ?? current.title} summary={sub === 0 ? current.summary : undefined} />
              )}
              <div className="min-h-0 flex-1">
                {stage === "welcome" && <WelcomeSlide summary={summary} joinPassword={joinPassword} />}
                {stage === "try" && <TrySlide summary={summary} joinPassword={joinPassword} />}
                {stage === "reveal" &&
                  (sub === 0 ? (
                    <RevealSlide summary={summary} />
                  ) : (
                    // The agency rating; the 5x5 "How did the AI do?" grid left the phones on Oct 23, so its slide went too.
                    <RatingSlide
                      summary={summary}
                      comments={
                        showComments
                          ? summary.discussion.notes.filter((n) => n.question === "experience").map((n) => n.text)
                          : null
                      }
                    />
                  ))}
                {/* Slides 2 to 5 of At scale, and 2 of Shared foundation, come from Max's Nava deck; 6 is the tool pilot and 7 the live chatbot.
                    What the models miss follows the household it explains (the dry run, Oct 25).
                    Shared foundation 3 is the encoding pipeline from the InnovateUS deck. */}
                {stage === "scale" &&
                  [
                    <ScaleShareSlide key="share" />,
                    <HouseholdSlide key="household" />,
                    <MissSlide key="miss" />,
                    <BreakSlide key="break" />,
                    <FrontDoorSlide key="front-door" />,
                    <ToolSlide key="tool" />,
                    <LiveDemoSlide key="live-demo" />,
                  ][sub]}
                {/* Shared foundation 4 plays the homepage's encoding journey after the pipeline it shows. */}
                {stage === "foundation" &&
                  [
                    <FoundationSlide key="foundation" summary={summary} />,
                    <JourneySlide key="journey" />,
                  ][sub]}
                {stage === "groups" &&
                  (sub === 0 ? <VoteSlide votes={summary.votes} /> : <GroupsSlide summary={summary} />)}
                {stage === "next" &&
                  (sub === 0 ? <AskSlide /> : <NextSlide />)}
                {stage === "dinner" && <ThankYouSlide />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Over the slide and under the controls: a slide that can't draw inside the scaled canvas places itself here. */}
      <div data-aspen-overlay />

      <div
        className={`absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-rule)] bg-[var(--color-paper)]/95 px-6 py-2.5 ${fade}`}
      >
        <span className="flex items-center gap-3">
          <BrandLogo className="h-8" />
          <span aria-hidden className="h-6 w-px bg-[var(--color-rule)]" />
          <span className="flex flex-col justify-center gap-0.5">
            <span className="font-body text-[0.8rem] font-medium leading-none text-[var(--color-ink)]">Presenter</span>
            <span className="font-mono text-[0.58rem] uppercase leading-none tracking-[0.14em] text-[var(--color-ink-muted)]">
              Run {control?.runId ?? "…"}
              {control && !control.live && " · not syncing (no store)"}
            </span>
          </span>
          {runOpen ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                className={`${FIELD} py-1 text-[0.78rem]`}
                style={{ width: "7.5rem" }}
                placeholder="e.g. phoenix"
                value={runDraft}
                onChange={(e) => setRunDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                aria-label="New run name"
              />
              <button
                type="button"
                className={`${BUTTON_QUIET} whitespace-nowrap px-2.5 py-1 text-[0.75rem]`}
                disabled={!runDraft}
                onClick={() => {
                  if (window.confirm(`Start run "${runDraft}" and move everyone to Welcome?`)) {
                    setSlide({ stage: "welcome", sub: 0 });
                    void move({ runId: runDraft, stage: "welcome" });
                    setRunDraft("");
                    setRunOpen(false);
                    setShowComments(false);
                  }
                }}
              >
                Start run
              </button>
              <button
                type="button"
                className="px-1.5 font-body text-[0.9rem] leading-none text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                onClick={() => setRunOpen(false)}
                aria-label="Close new run"
              >
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="rounded-full border border-[var(--color-rule)] px-2 py-0.5 font-body text-[0.7rem] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              onClick={() => setRunOpen(true)}
              title="Clears the room's results after a rehearsal"
            >
              New run
            </button>
          )}
        </span>
        <nav aria-label="Stages" className="flex flex-wrap gap-1">
          {STAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void move({ stage: s.id })}
              aria-current={s.id === stage ? "step" : undefined}
              className={`rounded-full px-2.5 py-1 font-body text-[0.78rem] ${
                s.id === stage
                  ? "bg-[var(--color-ink)] text-white"
                  : "text-[var(--color-ink-secondary)] hover:bg-[var(--color-rule-subtle)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <span className="flex items-center gap-2">
          <button type="button" className={BUTTON_QUIET} onClick={() => step(-1)} aria-label="Previous slide">
            ←
          </button>
          {slideCount(stage) > 1 && (
            <span aria-label="Slide" className="font-body text-[0.78rem] tabular-nums text-[var(--color-ink-muted)]">
              {sub + 1}/{slideCount(stage)}
            </span>
          )}
          <button type="button" className={BUTTON_QUIET} onClick={() => step(1)} aria-label="Next slide">
            →
          </button>
        </span>
        {error && <p className="m-0 w-full font-body text-[0.85rem] text-[var(--color-error)]">{error}</p>}
      </div>

      {/* The only control at the bottom: a small toggle on the slides that hide something until asked.
          The live demo is At scale's last slide. */}
      {((stage === "reveal" && sub === slideCount("reveal") - 1) || (stage === "scale" && sub === slideCount("scale") - 1)) && (
        <div
          className={`absolute bottom-3 right-3 rounded-full border border-[var(--color-rule)] bg-[var(--color-paper)]/95 px-1.5 py-1 ${fade}`}
        >
          {stage === "scale" ? (
            // The demo keeps keyboard focus once clicked: the arrows in the top bar still move the slides.
            <a href={liveDemoUrl()} target="_blank" rel="noreferrer" className={`${BUTTON_QUIET} px-3 py-1 text-[0.78rem]`}>
              Open demo in a new tab ↗
            </a>
          ) : (
            <button type="button" className={`${BUTTON_QUIET} px-3 py-1 text-[0.78rem]`} onClick={() => setShowComments((v) => !v)}>
              {showComments ? "Hide agency comments" : "Show agency comments"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slide parts. Sizes are in px: the canvas is always 1600×900.
// ---------------------------------------------------------------------------

/** A slide's heading, with no eyebrow above it (the dry run, Oct 25); the controls show which slide it is. */
function SlideHeader({ title, summary }: { title: string; summary?: string }) {
  return (
    <header className="mb-[40px]">
      <h1 className="heading-page m-0" style={{ fontSize: 48, lineHeight: 1.1, ...SENTENCE }}>
        {title}
      </h1>
      {summary && (
        <p className="m-0 mt-[16px] max-w-[1408px] font-body text-[28px] leading-snug text-[var(--color-ink-secondary)]">
          {summary}
        </p>
      )}
    </header>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-[32px] ${className}`}>
      {children}
    </div>
  );
}

function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`mb-[12px] block font-mono text-[15px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)] ${className}`}>
      {children}
    </span>
  );
}

/** A question or a call to act inside a box: a sentence at box size, never an eyebrow. */
function Prompt({ children, className = "", size = 24 }: { children: ReactNode; className?: string; size?: number }) {
  return (
    <span
      className={`mb-[12px] block font-body font-medium leading-snug text-[var(--color-ink)] ${className}`}
      style={{ fontSize: size }}
    >
      {children}
    </span>
  );
}

function Join({ joinPassword, large = false }: { joinPassword: string | null; large?: boolean }) {
  return (
    <Panel className="flex items-start gap-[28px]">
      <JoinQr size={large ? 220 : 140} className="border border-[var(--color-rule)]" />
      <div className="flex min-w-0 flex-col gap-[10px]">
        <Prompt className="mb-0" size={large ? 32 : 26}>Join on your phone or laptop</Prompt>
        <span
          className="font-display font-light leading-tight text-[var(--color-accent)]"
          style={{ fontSize: large ? 72 : 44 }}
        >
          {EVENT.joinUrl}
        </span>
        {joinPassword && (
          <span className="font-body text-[var(--color-ink)]" style={{ fontSize: large ? 36 : 26 }}>
            Password: <strong className="font-mono">{joinPassword}</strong>
          </span>
        )}
      </div>
    </Panel>
  );
}

function BigStat({
  value,
  label,
  tone = "ink",
  size = 96,
  unit,
  note,
}: {
  value: ReactNode;
  label: string;
  tone?: "ink" | "bad" | "accent";
  size?: number;
  /** A short unit beside the number, e.g. "in 2026", so an annual total doesn't read as monthly. */
  unit?: string;
  /** A caveat on the count, smaller than the label so a long one doesn't push the slide off the screen. */
  note?: string | null;
}) {
  const color = { ink: "var(--color-ink)", bad: "var(--color-error)", accent: "var(--color-accent)" }[tone];
  const number = (
    <span className="block font-display font-light leading-none tabular-nums" style={{ fontSize: size, color }}>
      {value}
    </span>
  );
  return (
    <div>
      {unit ? (
        <span className="flex items-baseline gap-[12px]">
          {number}
          <span className="font-body text-[28px] text-[var(--color-ink-secondary)]">{unit}</span>
        </span>
      ) : (
        number
      )}
      <span className="mt-[8px] block font-body text-[24px] leading-snug text-[var(--color-ink-secondary)]">{label}</span>
      {note && <span className="mt-[6px] block font-body text-[19px] leading-snug text-[var(--color-ink-muted)]">{note}</span>}
    </div>
  );
}

/** Text inside a box on the big screen: one size on every slide. */
const BOX_TEXT = "font-body text-[24px] leading-snug text-[var(--color-ink)]";

/**
 * A split bar at slide size: one track, then a legend with counts. The legend
 * is a step smaller than box text so four parts with two-digit counts stay on
 * one line in half the slide.
 */
function BigSplit({ parts }: { parts: { label: string; count: number; color: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.count, 0);
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex h-[22px] overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
        {parts.map((p) =>
          p.count > 0 ? (
            <span
              key={p.label}
              className="h-full transition-[width] duration-500"
              style={{ width: `${(100 * p.count) / Math.max(1, total)}%`, background: p.color }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-[4px]">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-[8px] font-body text-[20px] leading-snug text-[var(--color-ink)]">
            <span aria-hidden className="h-[12px] w-[12px] rounded-full" style={{ background: p.color }} />
            {p.label} <span className="font-mono tabular-nums">{p.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A 1–5 rating question at slide size: the question as a sentence, one row per category. */
function ScalePanel({ scale }: { scale: ScaleSummary }) {
  return (
    <Panel className="flex flex-col gap-[16px] py-[24px]">
      <Prompt className="mb-0">{scale.label}</Prompt>
      <ul className="m-0 flex list-none flex-col gap-[16px] p-0">
        {scale.categories.map((c) => (
          <li key={c.id} className="grid grid-cols-[440px_minmax(0,1fr)_120px] items-center gap-[24px]">
            <span className={BOX_TEXT}>{c.label}</span>
            <span className="relative h-[20px] overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
              {c.average !== null && (
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
                  style={{ width: `${(c.average / 5) * 100}%` }}
                />
              )}
            </span>
            <span className="text-right font-mono text-[24px] tabular-nums text-[var(--color-ink)]">
              {c.average !== null ? c.average.toFixed(1) : "—"}
              <span className="ml-[6px] text-[17px] text-[var(--color-ink-muted)]">({c.count})</span>
            </span>
          </li>
        ))}
      </ul>
      {/* The scale's ends, under the ends of the bars (the dry run, Oct 25). */}
      <div className="-mt-[8px] grid grid-cols-[440px_minmax(0,1fr)_120px] gap-[24px] font-body text-[20px] text-[var(--color-ink-muted)]">
        <span className="col-start-2 flex justify-between">
          <span>1 · {scale.low}</span>
          <span>{scale.high} · 5</span>
        </span>
      </div>
    </Panel>
  );
}

/** Large labelled bars for the big screen. */
function BigBars({ items, empty }: { items: Count[]; empty: string }) {
  const max = Math.max(0, ...items.map((i) => i.count));
  if (max === 0) return <p className="m-0 font-body text-[26px] text-[var(--color-ink-muted)]">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-[22px] p-0">
      {items.map((item) => (
        <li key={item.id} className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_64px] items-center gap-[24px]">
          <span className="truncate font-body text-[26px] text-[var(--color-ink)]" title={item.label}>
            {item.label}
          </span>
          <span className="h-[26px] overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
            <span
              className="block h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
              style={{ width: `${(100 * item.count) / max}%` }}
            />
          </span>
          <span className="text-right font-mono text-[28px] tabular-nums text-[var(--color-ink)]">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// One slide per stage
// ---------------------------------------------------------------------------

function WelcomeSlide({ summary, joinPassword }: { summary: RunSummary; joinPassword: string | null }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col justify-center gap-[48px]">
        <div>
          <span className="mb-[24px] block font-mono text-[18px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            {EVENT.cohort} · {EVENT.place} · {EVENT.coverDate}
          </span>
          <h1 className="heading-page m-0 max-w-[1300px] text-balance" style={{ fontSize: 68, lineHeight: 1.08, ...SENTENCE }}>
            {EVENT.title}
          </h1>
        </div>
        <div className="flex items-stretch gap-[24px]">
          <div className="w-[860px]">
            <Join joinPassword={joinPassword} large />
          </div>
          {/* Labels sit at the top of both boxes, on one line. */}
          <Panel className="flex w-[280px] flex-col">
            <Label>Joined</Label>
            <span className="font-display font-light leading-none tabular-nums text-[var(--color-accent)]" style={{ fontSize: 120 }}>
              {summary.participants}
            </span>
          </Panel>
        </div>
      </div>
      <div className="flex items-end justify-between gap-[24px]">
        <span className="font-body text-[24px] text-[var(--color-ink-secondary)]">With your hosts: {EVENT.presenters}</span>
        <BrandLogo className="h-[72px]" />
      </div>
    </div>
  );
}

function TrySlide({ summary, joinPassword }: { summary: RunSummary; joinPassword: string | null }) {
  const picked = summary.households.filter((h) => h.count > 0).slice(0, 5);
  return (
    <div className="grid h-full grid-cols-[0.85fr_1.15fr] gap-[40px]">
      <div className="flex flex-col gap-[32px]">
        <Join joinPassword={joinPassword} />
        <div className="grid grid-cols-2 gap-[24px]">
          <BigStat value={summary.prompts} label="questions asked" />
          <BigStat value={summary.rated} label="answers rated" tone="accent" />
        </div>
      </div>
      <Panel>
        <Label>Households people picked</Label>
        <BigBars items={picked} empty="Picks appear here as people ask." />
      </Panel>
    </div>
  );
}

/**
 * What we saw, slide 2: how AI is doing in their agencies, the room's 1–5
 * ratings, with the comments once the presenter shows them.
 */
/** Agency comments on screen at once, and answers worth discussing. */
const COMMENTS_SHOWN = 4;
const ANSWERS_SHOWN = 2;

/** How long each page of rotating comments stays up. */
const ROTATE_MS = 12_000;

/**
 * Which page of `count` items, `size` at a time, shows at `tick`: it cycles
 * through every page, and stays on the first while everything fits on one.
 */
export function rotationPage(tick: number, count: number, size: number): number {
  const pages = Math.max(1, Math.ceil(count / size));
  return ((tick % pages) + pages) % pages;
}

/** A counter that goes up every `ms` while `active`, to turn pages of comments. */
function useTick(active: boolean, ms = ROTATE_MS): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return tick;
}

/** "1–4 of 9", or "9 of 9" for a last page of one: which of the items a page shows. */
export function pageRange(page: number, size: number, count: number): string {
  const first = page * size + 1;
  const last = Math.min(count, (page + 1) * size);
  return first === last ? `${last} of ${count}` : `${first}\u2013${last} of ${count}`;
}

function RatingSlide({
  summary,
  comments = null,
}: {
  summary: RunSummary;
  /** Agency comments, once the presenter shows them; null keeps them hidden. */
  comments?: string[] | null;
}) {
  const scale = summary.discussion.scales.find((sc) => sc.question === "experience");
  const ratings = scale ? Math.max(0, ...scale.categories.map((c) => c.count)) : 0;
  const tick = useTick(Boolean(comments && comments.length > COMMENTS_SHOWN));
  const commentPage = rotationPage(tick, comments?.length ?? 0, COMMENTS_SHOWN);
  return (
    <div className="flex h-full flex-col gap-[24px]">
      <span className="font-body text-[26px] text-[var(--color-ink-secondary)]">
        <strong className="font-medium tabular-nums text-[var(--color-accent)]">{ratings}</strong>{" "}
        {ratings === 1 ? "person has" : "people have"} rated AI overall
      </span>
      {scale && <ScalePanel scale={scale} />}
      {comments &&
        (comments.length === 0 ? (
          <p className="m-0 font-body text-[24px] text-[var(--color-ink-muted)]">No comments yet.</p>
        ) : (
          <>
            {/* Four at a time, two per row, each clamped to two lines, so the slide still fits 16:9. With more,
                the four turn every few seconds, so every comment gets its turn (the dry run, Oct 25). */}
            <ul className="m-0 grid list-none grid-cols-2 gap-[14px] p-0">
              {comments.slice(commentPage * COMMENTS_SHOWN, (commentPage + 1) * COMMENTS_SHOWN).map((text, i) => (
                <li
                  key={`${commentPage}-${i}-${text}`}
                  className={`rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[24px] py-[16px] ${BOX_TEXT}`}
                >
                  <span className="line-clamp-2">{text}</span>
                </li>
              ))}
            </ul>
            {comments.length > COMMENTS_SHOWN && (
              <span className="font-body text-[18px] tabular-nums text-[var(--color-ink-muted)]">
                Comments {pageRange(commentPage, COMMENTS_SHOWN, comments.length)}
              </span>
            )}
          </>
        ))}
    </div>
  );
}

/**
 * The note under "would stop a resident from applying": "2 of them qualify."
 * An amount from rules that don't test eligibility counts apart
 * (ifEligibleSentence). Null when there's nothing to add.
 */
export function notApplyNote(v: Pick<RunSummary["viability"], "wouldNotApplyEligible" | "wouldNotApplyIfEligible">): string | null {
  const parts: string[] = [];
  if (v.wouldNotApplyEligible > 0) {
    parts.push(`${v.wouldNotApplyEligible} of them ${v.wouldNotApplyEligible === 1 ? "qualifies" : "qualify"}.`);
  }
  const ifEligible = ifEligibleSentence(v, "of them");
  if (ifEligible) parts.push(ifEligible);
  return parts.length ? parts.join(" ") : null;
}

function RevealSlide({ summary }: { summary: RunSummary }) {
  const v = summary.viability;
  if (v.rated === 0) {
    return <p className="m-0 font-body text-[30px] text-[var(--color-ink-muted)]">Results appear here as people rate their answers.</p>;
  }
  return (
    // Sized to fit 1600×900 with the longest labels, two-digit counts and two long spotlight notes.
    <div className="flex h-full flex-col gap-[12px]">
      {/* The third stat carries the eligibility note, so it gets the most room. */}
      <div className="grid grid-cols-[0.85fr_1fr_1.25fr] gap-[24px]">
        <Panel className="py-[14px]">
          <BigStat size={64} value={`${v.right} of ${v.rated}`} label="answers looked right" />
        </Panel>
        <Panel className={`py-[14px] ${v.convincing > 0 ? "border-l-[8px] border-l-[var(--color-error)]" : ""}`}>
          <BigStat
            size={64}
            value={v.convincing}
            label="looked wrong or unsure, yet a resident would act on them"
            tone={v.convincing > 0 ? "bad" : "ink"}
          />
        </Panel>
        <Panel className={`py-[14px] ${v.wouldNotApply > 0 ? "border-l-[8px] border-l-[var(--color-error)]" : ""}`}>
          <BigStat
            size={64}
            value={v.wouldNotApply}
            label="would stop a resident from applying"
            note={notApplyNote(v)}
            tone={v.wouldNotApply > 0 ? "bad" : "ink"}
          />
        </Panel>
      </div>
      <div className="grid grid-cols-2 gap-[24px]">
        <Panel className="py-[16px]">
          <Prompt>Did the answer look right?</Prompt>
          <BigSplit
            parts={[
              { label: "Looks right", count: v.right, color: GOOD },
              { label: "Not sure", count: v.unsure, color: MAYBE },
              { label: "Looks wrong", count: v.wrong, color: BAD },
            ]}
          />
        </Panel>
        <Panel className="py-[16px]">
          <Prompt>What would a resident do next?</Prompt>
          <BigSplit
            parts={v.residentActions.map((a) => ({
              label: a.label,
              count: a.count,
              color: { apply: GOOD, "not-apply": BAD, call: "var(--color-ink-secondary)", unsure: MAYBE }[a.id] ?? MAYBE,
            }))}
          />
        </Panel>
      </div>
      <WorthDiscussing summary={summary} />
    </div>
  );
}

/**
 * The answers Max reads out in What we saw, on the screen now that phones
 * stay quiet there: the most worth discussing, two at a time, with what the
 * person said about each. Before anyone flags one, the spoken questions show instead.
 */
function WorthDiscussing({ summary }: { summary: RunSummary }) {
  // Two at a time; with more, they turn every few seconds (the dry run, Oct 25).
  const all = summary.spotlight;
  const tick = useTick(all.length > ANSWERS_SHOWN);
  const page = rotationPage(tick, all.length, ANSWERS_SHOWN);
  const items = all.slice(page * ANSWERS_SHOWN, (page + 1) * ANSWERS_SHOWN);
  if (!items.length) {
    return (
      <Panel className="mt-auto py-[20px]">
        <Label>To discuss</Label>
        <ol className={`m-0 grid grid-cols-2 gap-[32px] pl-[28px] ${BOX_TEXT}`}>
          {/* The agency question has its own slide (2/2). */}
          {DISCUSSION_QUESTIONS.filter((q) => q.id !== "experience").map((q) => (
            <li key={q.id}>{q.label}</li>
          ))}
        </ol>
      </Panel>
    );
  }
  return (
    <Panel className="mt-auto py-[16px]">
      <Label>
        Answers worth discussing{all.length > ANSWERS_SHOWN && <span className="normal-case tracking-normal">{` · ${pageRange(page, ANSWERS_SHOWN, all.length)}`}</span>}
      </Label>
      <ul className="m-0 grid list-none grid-cols-2 gap-[32px] p-0">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 flex-col gap-[6px]">
            <span className="font-body text-[19px] font-medium text-[var(--color-ink-muted)]">
              <span className={item.reason === "unsure" ? "" : "text-[var(--color-error)]"}>{reasonLabel(item)}</span>
              {" · "}
              {item.household ?? "Own question"}
            </span>
            {item.note ? (
              <q className="line-clamp-2 font-body text-[22px] leading-snug text-[var(--color-ink)]">{item.note}</q>
            ) : (
              item.wentWrong.length > 0 && (
                <span className="font-body text-[22px] leading-snug text-[var(--color-ink)]">{item.wentWrong.join(" · ")}</span>
              )
            )}
            {item.answer && (
              <p className="m-0 line-clamp-1 font-body text-[18px] leading-snug text-[var(--color-ink-secondary)]">
                <span className="font-medium text-[var(--color-ink-muted)]">The AI: </span>
                {item.answer}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** At scale, slide 1: the one number. */
function ScaleShareSlide() {
  const share = percent(POLICYBENCH.saidZero, POLICYBENCH.eligibleAnswers);
  return (
    <div className="flex h-full items-center gap-[64px]">
      <span className="font-display font-light leading-none tabular-nums text-[var(--color-error)]" style={{ fontSize: 260 }}>
        {share}%
      </span>
      <div className="flex max-w-[760px] flex-col gap-[24px]">
        <p className="m-0 font-display text-[52px] font-light leading-tight text-[var(--color-ink)]">
          of AI answers told a household that qualifies for SNAP it would get <strong className="font-normal">$0</strong>.
        </p>
        <p className="m-0 font-body text-[24px] text-[var(--color-ink-muted)]">
          {POLICYBENCH.saidZero} of {POLICYBENCH.eligibleAnswers} answers · {POLICYBENCH.models} AI models ·{" "}
          {POLICYBENCH.eligibleHouseholds} households that qualify · PolicyBench, {POLICYBENCH.snapshot}
        </p>
      </div>
    </div>
  );
}

/** The source line on every PolicyBench slide. */
function BenchFooter({ source }: { source: string }) {
  return (
    <p className="m-0 mt-auto font-body text-[17px] leading-snug text-[var(--color-ink-muted)]">
      {source}
    </p>
  );
}

/** The annual reference uses FY2026's monthly minimum in every month, October to December included. */
function StandardsNote({ mark = false }: { mark?: boolean }) {
  const ex = POLICYBENCH.example;
  return (
    <p className="m-0 font-body text-[18px] leading-snug text-[var(--color-ink-secondary)]">
      {mark && <>*{TRUE_BENEFIT_NOTE} </>}${ex.reference.monthly} a month under the benchmark&apos;s July 2026 rules ({ex.reference.standards} standards).{" "}
      The minimum rose to ${ex.fromOctober.monthly} on October 1, so 2026 comes to ${ex.currentLaw.annual} under current law.
    </p>
  );
}

/**
 * What "the true benefit" on At scale 2/7 is: PolicyBench's reference answer. Max asked for "true
 * benefit" with an asterisk in the dry run (Oct 25), for no PolicyEngine on the screens, and for
 * PolicyBench as our own benchmark; the note under it says which rules.
 */
const TRUE_BENEFIT_NOTE = "The reference answer in PolicyBench, our benchmark:";

/** One tile per model: $0 in red, other wrong amounts muted, the reference amount in the accent, and "no answer" said in words (the dry run, Oct 25). */
function answerTile(answer: number | null, reference: number) {
  if (answer === null) return { text: "no answer", label: "no answer", tone: "border-[var(--color-rule)] text-[var(--color-ink-muted)]" };
  if (answer === reference)
    return { text: `$${answer}`, label: `$${answer}, matches the reference`, tone: "border-[var(--color-accent)] bg-[var(--color-accent-light)] font-semibold text-[var(--color-accent)]" };
  if (answer <= 0) return { text: "$0", label: "$0", tone: "border-[var(--color-error)]/30 text-[var(--color-error)]" };
  return { text: `$${answer.toLocaleString("en-US")}`, label: `$${answer.toLocaleString("en-US")}`, tone: "border-[var(--color-rule)] text-[var(--color-ink-secondary)]" };
}

/** At scale, slide 4 (Max's Nava deck): accuracy by program, owed money against owed $0. */
function BreakSlide() {
  const b = WHERE_MODELS_BREAK;
  return (
    <div className="flex h-full flex-col gap-[12px]">
      <div className="flex items-end justify-between gap-[24px]">
        <p className="m-0 font-display text-[40px] font-light leading-tight text-[var(--color-ink)]">{b.title}</p>
        <span className="flex gap-[24px] font-body text-[20px] text-[var(--color-ink-secondary)]">
          <span className="flex items-center gap-[8px]">
            <span aria-hidden className="h-[14px] w-[14px] rounded-[3px] bg-[var(--color-accent)]" /> Households owed money
          </span>
          <span className="flex items-center gap-[8px]">
            <span aria-hidden className="h-[14px] w-[14px] rounded-[3px] bg-[#bdb6ae]" /> Households owed $0
          </span>
        </span>
      </div>
      <p className="m-0 font-body text-[20px] text-[var(--color-ink-secondary)]">{b.note}</p>
      <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
        {b.rows.map((r) => (
          <li key={r.program} className="grid grid-cols-[360px_minmax(0,1fr)] items-center gap-[24px]">
            <span className={BOX_TEXT}>{r.program}</span>
            <span className="flex flex-col gap-[4px]">
              {[
                { value: r.owed, color: "var(--color-accent)", label: `${Math.round(r.owed)}% · ${r.households} households`, strong: true },
                { value: r.zero, color: "#bdb6ae", label: `${Math.round(r.zero)}%`, strong: false },
              ].map((bar, i) => (
                <span key={i} className="flex items-center gap-[12px]">
                  <span className="h-[13px] rounded-[4px]" style={{ width: `${bar.value * 0.72}%`, background: bar.color }} />
                  <span
                    className={`whitespace-nowrap font-mono text-[17px] tabular-nums ${bar.strong ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}
                  >
                    {bar.label}
                  </span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <BenchFooter source={b.source} />
    </div>
  );
}

/** At scale, slide 2 (Max's Nava deck): the example household, as every model answers it. */
function HouseholdSlide() {
  const h = EXAMPLE_HOUSEHOLD;
  const ex = POLICYBENCH.example;
  return (
    <div className="flex h-full flex-col gap-[20px]">
      <p className="m-0 font-display text-[40px] font-light leading-tight text-[var(--color-ink)]">{h.title}</p>
      <div className="grid grid-cols-[0.8fr_1.2fr] gap-[24px]">
        <Panel>
          <Label>The facts</Label>
          <ul className={`m-0 flex list-disc flex-col gap-[8px] pl-[26px] ${BOX_TEXT}`}>
            {h.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Panel>
        <Panel className="flex flex-col gap-[18px]">
          <Label className="mb-0">{h.program}</Label>
          <div className="grid grid-cols-2 gap-[24px]">
            <BigStat value={`$${h.reference}`} label="The true benefit*" tone="accent" />
            <BigStat value="$0" label={`from ${ex.modelsSaidZero} of ${ex.modelsAnswered} AI models · ${ex.modelsExact} matched exactly`} tone="bad" />
          </div>
          <StandardsNote mark />
          {/* Every model's answer: the $0s as one block, then the others at full width so no amount is cut. */}
          <Label className="mb-0">Each model&apos;s answer for the year, one per model</Label>
          <div
            role="group"
            aria-label={`${h.models} models: ${ex.modelsSaidZero} said $0, ${ex.modelsExact} said $${h.reference}, ${ex.modelsAnswered - ex.modelsSaidZero - ex.modelsExact} gave other amounts, ${h.models - ex.modelsAnswered} gave no answer`}
            className="flex flex-col gap-[8px]"
          >
            <ul className="m-0 grid list-none grid-cols-[repeat(21,minmax(0,1fr))] gap-[6px] p-0">
              {h.answers.filter((a) => a === 0).map((answer, i) => {
                const tile = answerTile(answer, h.reference);
                return (
                  <li key={i} className={`rounded-[6px] border py-[4px] text-center font-mono text-[15px] ${tile.tone}`}>
                    {tile.text}
                  </li>
                );
              })}
            </ul>
            <ul className="m-0 flex list-none flex-wrap items-center gap-[6px] p-0">
              {h.answers.filter((a) => a !== 0).map((answer, i) => {
                const tile = answerTile(answer, h.reference);
                return (
                  <li key={i} className={`rounded-[6px] border px-[10px] py-[4px] text-center font-mono text-[15px] ${tile.tone}`}>
                    <span aria-hidden={tile.text !== tile.label}>{tile.text}</span>
                    {tile.text !== tile.label && <span className="sr-only">{tile.label}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>
      </div>
      <BenchFooter source={h.source} />
    </div>
  );
}

/** At scale, slide 3 (Max's Nava deck): how the top two models explain $0 for the household on 2, beside the rule they skip. */
function MissSlide() {
  const m = WHAT_MODELS_MISS;
  return (
    <div className="flex h-full flex-col gap-[16px]">
      <p className="m-0 font-display text-[40px] font-light leading-tight text-[var(--color-ink)]">{m.title}</p>
      {/* One row of column labels, then boxes that share a top edge and a bottom edge. */}
      <div className="grid grid-cols-2 gap-x-[24px] gap-y-[10px]">
        <Label className="mb-0">How the top two models explain $0</Label>
        <Label className="mb-0 text-[var(--color-accent)]">The rule they skip</Label>
        <div className="flex flex-col gap-[16px]">
          {m.quotes.map((q) => (
            <Panel key={q.model} className="flex-1">
              <Label>{q.model}</Label>
              <p className={`m-0 ${BOX_TEXT}`}>&ldquo;{q.text}&rdquo;</p>
            </Panel>
          ))}
        </div>
        {/* The rule alone: the room knows BBCE, and the amount isn't the point here (the dry run, Oct 25). */}
        <Panel className="flex flex-col border-l-[8px] border-l-[var(--color-accent)]">
          <Label>{m.ruleLabel}</Label>
          <p className="m-0 font-body text-[30px] leading-snug text-[var(--color-ink)]">{m.rule}</p>
        </Panel>
      </div>
      <BenchFooter source={m.sources} />
    </div>
  );
}

/** Max's front-door diagram, ported from his Nava deck's SVG with the deck's colors. */
const DOOR = {
  ink: "#1c1917",
  muted: "#706964",
  faint: "#76716f",
  card: "#fffefb",
  line: "#d6cfc2",
  accent: "#92400e",
  accentSoft: "#f5ece0",
} as const;
const DOOR_LINE = { fill: "none", stroke: DOOR.line, strokeWidth: 2 } as const;
const DOOR_STRONG = { fill: "none", stroke: DOOR.accent, strokeWidth: 2.6 } as const;
const DOOR_ICON = { fill: "none", stroke: DOOR.accent, strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const DOOR_HEAD = { fill: DOOR.ink, fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em" } as const;
const DOOR_SUB = { fill: DOOR.muted, fontSize: 14.5 } as const;
const DOOR_KICKER = { fontSize: 11, fontWeight: 500, letterSpacing: "0.14em", style: { textTransform: "uppercase" } } as const;

function FrontDoorDiagram() {
  const f = FRONT_DOOR;
  return (
    <svg
      viewBox="0 0 1100 360"
      role="img"
      aria-label="People and AI agents ask an AI model what the law says. Today the model guesses from its training data and web search; with Axiom it calls open, cited, executable encoded law and returns the rule with its citation."
      className="block h-auto w-full font-body"
    >
      <defs>
        <marker id="door-a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill={DOOR.accent} />
        </marker>
        <marker id="door-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill={DOOR.faint} />
        </marker>
        <linearGradient id="door-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b45309" />
          <stop offset="1" stopColor="#8a3d08" />
        </linearGradient>
      </defs>

      {/* People and agents */}
      <circle cx="100" cy="178" r="62" fill={DOOR.accentSoft} stroke="#e6d5bf" strokeWidth={1.2} />
      <g {...DOOR_ICON} transform="translate(83 178)">
        <circle cx="0" cy="-9" r="7" />
        <path d="M-13 15c0-8 5.8-13 13-13s13 5 13 13" />
      </g>
      <g {...DOOR_ICON} transform="translate(119 180) scale(0.85)">
        <rect x="-12" y="-8" width="24" height="18" rx="5" />
        <path d="M0-8v-5" />
        <circle cx="0" cy="-15" r="2" />
        <circle cx="-5" cy="1" r="1.6" />
        <circle cx="5" cy="1" r="1.6" />
      </g>
      <text {...DOOR_HEAD} x="100" y="270" textAnchor="middle">{f.asker.name}</text>
      <text {...DOOR_SUB} x="100" y="292" textAnchor="middle">{f.asker.detail}</text>
      <path {...DOOR_LINE} d="M168 178 H282" markerEnd="url(#door-a)" />

      {/* AI model */}
      <rect x="290" y="132" width="170" height="92" rx="14" fill={DOOR.card} stroke={DOOR.line} strokeWidth={1.4} />
      <g transform="translate(375 162) scale(0.9)">
        <path d="M0-14 3.5-3.5 14 0 3.5 3.5 0 14-3.5 3.5-14 0-3.5-3.5Z" fill={DOOR.accent} />
      </g>
      <text {...DOOR_HEAD} x="375" y="202" textAnchor="middle">{f.model}</text>

      {/* Today: a guess */}
      <path d="M468 178 C520 178 500 78 552 78 H870" fill="none" stroke={DOOR.faint} strokeWidth={2} strokeDasharray="6 6" opacity={0.7} markerEnd="url(#door-g)" />
      <text {...DOOR_KICKER} className="font-mono" fill={DOOR.faint} x="552" y="64">{f.today.label}</text>
      <rect x="880" y="34" width="210" height="88" rx="14" fill="#f1eee8" stroke={DOOR.line} strokeWidth={1.4} strokeDasharray="4 4" />
      <g {...DOOR_ICON} stroke={DOOR.faint} transform="translate(918 78)">
        <circle cx="0" cy="0" r="13" />
        <path d="M-4.5-4a4.5 4.5 0 1 1 6 4.2c-1.2.5-1.5 1.2-1.5 2.6" />
        <circle cx="0" cy="7.5" r=".9" />
      </g>
      <text {...DOOR_HEAD} x="944" y="65">{f.today.result}</text>
      <text {...DOOR_SUB} x="944" y="87">from training data</text>
      <text {...DOOR_SUB} x="944" y="106">and web search</text>

      {/* With Axiom: encoded law, then the rule */}
      <path {...DOOR_STRONG} d="M468 178 C520 178 500 278 552 278 H588" markerEnd="url(#door-a)" />
      <text {...DOOR_KICKER} className="font-mono" fill={DOOR.accent} x="596" y="220">{f.axiom.label}</text>
      <rect x="596" y="234" width="240" height="88" rx="14" fill="url(#door-grad)" />
      <g {...DOOR_ICON} stroke={DOOR.card} transform="translate(634 278)">
        <path d="M-13-10h9a4 4 0 0 1 4 4v17a3 3 0 0 0-3-3h-10z" />
        <path d="M13-10h-9a4 4 0 0 0-4 4v17a3 3 0 0 1 3-3h10z" />
      </g>
      <text className="aspen-on-dark" fill={DOOR.card} fontSize={19} fontWeight={700} x="662" y="274">{f.axiom.source}</text>
      <text className="aspen-on-dark" fill={DOOR.card} fontSize={13.5} opacity={0.9} x="662" y="296">{f.axiom.sourceDetail}</text>
      <path {...DOOR_STRONG} d="M842 278 H870" markerEnd="url(#door-a)" />
      <rect x="880" y="234" width="210" height="88" rx="14" fill={DOOR.accentSoft} stroke={DOOR.accent} strokeWidth={1.4} />
      <g {...DOOR_ICON} transform="translate(918 278)">
        <circle cx="0" cy="0" r="13" />
        <path d="m-6 0 4.2 4.2L6.5-4.5" />
      </g>
      <text {...DOOR_HEAD} x="944" y="275">{f.axiom.result}</text>
      <text {...DOOR_SUB} x="944" y="297">{f.axiom.detail}</text>
    </svg>
  );
}

/** At scale, slide 5 (Max's Nava deck): AI is becoming the front door to the law. */
function FrontDoorSlide() {
  const f = FRONT_DOOR;
  return (
    <div className="flex h-full flex-col gap-[24px]">
      <p className="m-0 max-w-[1300px] text-balance font-display text-[40px] font-light leading-tight text-[var(--color-ink)]">{f.title}</p>
      <div className="flex min-h-0 flex-1 items-center">
        <FrontDoorDiagram />
      </div>
    </div>
  );
}

/** The pilot's bars: web search alone recedes in the "Where models still break" gray; our rules engine carries the accent. */
const PILOT_COLORS = { web: "#bdb6ae", both: "var(--color-accent)" } as const;

/** A whole percent of the pilot's amounts, as the slide shows it. */
const pilotPct = (k: number) => Math.round((100 * k) / ENGINE_PILOT.amounts);
/** A signed whole number of points, with a true minus sign. */
const signed = (n: number) => `${n < 0 ? "\u2212" : "+"}${Math.abs(Math.round(n))}`;
/** Dollars per household to the tenth of a cent. */
const perHousehold = (d: number) => `$${d.toFixed(3)}`;

/**
 * At scale, slide 6: PolicyBench's preliminary internal pilot. Each model with web search alone and with
 * web search and our rules engine, the change in accuracy and the change in cost (Max, the dry run, Oct 25).
 */
function ToolSlide() {
  const t = ENGINE_PILOT;
  const head = "pb-[10px] text-left align-bottom font-body text-[20px] font-normal text-[var(--color-ink-muted)]";
  return (
    <div className="flex h-full flex-col gap-[14px]">
      <div className="flex items-end justify-between gap-[24px]">
        <p className="m-0 font-display text-[40px] font-light leading-tight text-[var(--color-ink)]">{t.title}</p>
        <span className="flex shrink-0 gap-[24px] font-body text-[20px] text-[var(--color-ink-secondary)]">
          {(["web", "both"] as const).map((arm) => (
            <span key={arm} className="flex items-center gap-[8px]">
              <span aria-hidden className="h-[14px] w-[14px] rounded-[3px]" style={{ background: PILOT_COLORS[arm] }} /> {t.arms[arm]}
            </span>
          ))}
        </span>
      </div>
      <p className="m-0 font-body text-[20px] text-[var(--color-ink-secondary)]">{t.note}</p>
      <table className="w-full border-collapse">
        <caption className="sr-only">
          {t.title}: share of nonzero dollar amounts right, the change in points with its 95% interval, and the change in cost per household
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${head} w-[300px]`}>
              <span className="sr-only">Model</span>
            </th>
            <th scope="col" className={head}>
              Amounts right
            </th>
            <th scope="col" className={`${head} w-[250px]`}>
              Accuracy
            </th>
            <th scope="col" className={`${head} w-[250px]`}>
              Cost per household
            </th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.model} className="border-t border-[var(--color-rule)]">
              <th scope="row" className={`py-[16px] pr-[24px] text-left font-normal ${BOX_TEXT}`}>
                {r.model}
              </th>
              <td className="py-[16px] pr-[32px]">
                <span className="flex flex-col gap-[8px]">
                  {(["web", "both"] as const).map((arm) => (
                    <span key={arm} className="flex items-center gap-[14px]">
                      <span className="h-[22px] rounded-[4px]" style={{ width: `${pilotPct(r[arm]) * 0.8}%`, background: PILOT_COLORS[arm] }} />
                      <span
                        className={`whitespace-nowrap font-mono text-[22px] leading-none tabular-nums ${arm === "both" ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}
                      >
                        <span className="sr-only">{t.arms[arm]}: </span>
                        {pilotPct(r[arm])}%
                      </span>
                    </span>
                  ))}
                </span>
              </td>
              <td className="py-[16px]">
                <span className="block font-display text-[48px] font-light leading-none tabular-nums text-[var(--color-accent)]">
                  {signed(r.change.points)} <span className="font-body text-[22px] text-[var(--color-ink-secondary)]">points</span>
                </span>
                <span className="mt-[6px] block font-body text-[18px] text-[var(--color-ink-muted)]">
                  95%: {signed(r.change.lo)} to {signed(r.change.hi)}
                </span>
              </td>
              <td className="py-[16px]">
                <span className="block font-display text-[48px] font-light leading-none tabular-nums text-[var(--color-ink)]">
                  {signed(percentChange(r.cost.web, r.cost.both))}%
                </span>
                <span className="mt-[6px] block font-body text-[18px] tabular-nums text-[var(--color-ink-muted)]">
                  {perHousehold(r.cost.web)} to {perHousehold(r.cost.both)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Panel className="mt-auto flex flex-col gap-[8px] py-[18px]">
        <Label className="mb-0">What this measures</Label>
        <p className="m-0 font-body text-[22px] leading-snug text-[var(--color-ink)]">{t.measures}</p>
      </Panel>
      <BenchFooter source={t.source} />
    </div>
  );
}

/**
 * At scale, slide 7: the live chatbot, plain AI beside AI with the Axiom rules
 * engine. A cross-origin frame inside the slide's scaled canvas paints blank,
 * so the slide holds a slot and the frame sits over it, fixed to the slot's
 * on-screen box; the demo also shows at its own size rather than scaled.
 */
function LiveDemoSlide() {
  const slot = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // Full screen fills the window with the same frame, so the conversation in it carries over (the dry run, Oct 25).
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // Inside the slot's 1px border.
      const inset = (r.width / Math.max(el.offsetWidth, 1)) * el.clientLeft;
      setBox({ left: r.left + inset, top: r.top + inset, width: Math.max(r.width - 2 * inset, 0), height: Math.max(r.height - 2 * inset, 0) });
    };
    measure();
    let frame = 0;
    // The canvas rescales after a resize; measure once it has.
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return (
    <div className="flex h-full flex-col gap-[16px]">
      <div className="flex items-end justify-between gap-[24px]">
        <p className="m-0 font-display text-[36px] font-light leading-tight text-[var(--color-ink)]">{LIVE_DEMO.title}</p>
        <button type="button" className={`${BUTTON_QUIET} shrink-0 px-[20px] py-[10px] text-[20px]`} onClick={() => setFull(true)}>
          Full screen
        </button>
      </div>
      <div ref={slot} className="min-h-0 flex-1 rounded-[14px] border border-[var(--color-rule)] bg-white" />
      {box &&
        createPortal(
          <>
            <iframe
              title="Live chatbot demo: plain AI beside AI with the Axiom rules engine"
              src={liveDemoUrl()}
              className={`fixed border-0 bg-white ${full ? "z-50" : "z-30"}`}
              style={full ? { inset: 0, width: "100vw", height: "100dvh" } : { left: box.left, top: box.top, width: box.width, height: box.height }}
            />
            {full && (
              <button
                type="button"
                className={`${BUTTON_QUIET} fixed bottom-3 right-3 z-[60] shadow-[0_2px_8px_rgba(28,25,23,0.18)]`}
                onClick={() => setFull(false)}
              >
                Exit full screen
              </button>
            )}
          </>,
          document.body,
        )}
    </div>
  );
}

/** An icon for each group a shared foundation serves. */
const AUDIENCE_ICONS: Record<(typeof SAME_RULES.audiences)[number]["label"], LucideIcon> = {
  "For individuals": User,
  "For AI systems": Sparkles,
  "For builders": Wrench,
  "For researchers": ChartColumn,
};

/** A box's icon beside its label, the same in every box. */
function IconLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="mb-[14px] flex items-center gap-[14px]">
      <Icon aria-hidden size={32} strokeWidth={1.75} className="shrink-0 text-[var(--color-accent)]" />
      <Label className="mb-0">{children}</Label>
    </div>
  );
}

/**
 * How programs cross-reference each other, for the governments box: each
 * arrow is a real eligibility or benefit link (TANF confers SNAP categorical
 * eligibility; LIHEAP sets SNAP's utility allowance; SNAP directly certifies
 * school meals; SSI opens Medicaid; SNAP and Medicaid confer WIC eligibility).
 */
const POLICY_NODES = {
  TANF: { x: 62, y: 50, w: 104 },
  LIHEAP: { x: 62, y: 106, w: 104 },
  SSI: { x: 62, y: 162, w: 104 },
  SNAP: { x: 280, y: 78, w: 104 },
  Medicaid: { x: 280, y: 162, w: 104 },
  "School meals": { x: 488, y: 50, w: 136 },
  WIC: { x: 488, y: 134, w: 136 },
} as const;
type PolicyNode = keyof typeof POLICY_NODES;
const POLICY_LINKS: { from: PolicyNode; to: PolicyNode; label: string }[] = [
  { from: "TANF", to: "SNAP", label: "eligibility" },
  { from: "LIHEAP", to: "SNAP", label: "utilities" },
  { from: "SSI", to: "Medicaid", label: "eligibility" },
  { from: "SNAP", to: "School meals", label: "certifies" },
  { from: "SNAP", to: "WIC", label: "eligibility" },
  { from: "Medicaid", to: "WIC", label: "eligibility" },
];

function PolicyGraph() {
  const h = 32;
  return (
    <svg
      viewBox="0 0 560 182"
      role="img"
      aria-label="How programs cross-reference: TANF confers SNAP eligibility, LIHEAP sets SNAP's utility allowance, SSI opens Medicaid, SNAP certifies children for school meals, and SNAP and Medicaid confer WIC eligibility."
      className="block h-auto w-full font-body"
    >
      <defs>
        <marker id="policy-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#a8a29e" />
        </marker>
      </defs>
      <text x="0" y="14" className="font-mono" fontSize={12} letterSpacing="0.16em" fill="var(--color-ink-muted)" style={{ textTransform: "uppercase" }}>
        How the rules cross-reference
      </text>
      {POLICY_LINKS.map(({ from, to, label }) => {
        const a = POLICY_NODES[from];
        const b = POLICY_NODES[to];
        const x1 = a.x + a.w / 2;
        const x2 = b.x - b.w / 2 - 3;
        return (
          <g key={`${from}-${to}`}>
            <line x1={x1} y1={a.y} x2={x2} y2={b.y} stroke="#c9c2b6" strokeWidth={1.6} markerEnd="url(#policy-arrow)" />
            <text
              x={(x1 + x2) / 2}
              y={(a.y + b.y) / 2 - 4}
              textAnchor="middle"
              fontSize={13}
              fill="var(--color-ink-muted)"
              stroke="var(--color-paper-elevated)"
              strokeWidth={4}
              paintOrder="stroke"
            >
              {label}
            </text>
          </g>
        );
      })}
      {(Object.keys(POLICY_NODES) as PolicyNode[]).map((name) => {
        const n = POLICY_NODES[name];
        const strong = name === "SNAP";
        return (
          <g key={name}>
            <rect
              x={n.x - n.w / 2}
              y={n.y - h / 2}
              width={n.w}
              height={h}
              rx={8}
              fill={strong ? "var(--color-accent)" : "var(--color-paper)"}
              stroke={strong ? "var(--color-accent)" : "#d6cfc2"}
              strokeWidth={1.4}
            />
            <text x={n.x} y={n.y + 6} textAnchor="middle" fontSize={17} fontWeight={600} fill={strong ? "#fff" : "var(--color-ink)"}>
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Shared foundation, slide 2 (from Max's Nava deck): what a shared foundation enables, governments first. */
function SameRulesSlide() {
  const r = SAME_RULES;
  return (
    <div className="grid h-full grid-cols-[1.8fr_1fr_1fr] grid-rows-2 gap-[18px]">
      <Panel className="row-span-2 flex flex-col">
        <IconLabel icon={Landmark}>{r.governments.label}</IconLabel>
        <ul className={`m-0 flex list-none flex-col gap-[10px] p-0 ${BOX_TEXT}`}>
          {r.governments.uses.map((use) => (
            <li key={use} className="flex gap-[12px]">
              <Check aria-hidden size={24} strokeWidth={2.25} className="mt-[3px] shrink-0 text-[var(--color-accent)]" />
              {use}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-[14px]">
          <PolicyGraph />
        </div>
      </Panel>
      {r.audiences.map((a) => (
        <Panel key={a.label} className="flex flex-col">
          <IconLabel icon={AUDIENCE_ICONS[a.label]}>{a.label}</IconLabel>
          <p className={`m-0 ${BOX_TEXT}`}>{a.text}</p>
        </Panel>
      ))}
    </div>
  );
}

/** An icon for each use of the one set of rules. */
const USE_ICONS: Record<(typeof ONE_SET_OF_RULES)[number]["label"], LucideIcon> = {
  "AI tools": Sparkles,
  "Community screeners": ClipboardCheck,
  "State systems": Landmark,
  "Staff training": GraduationCap,
  "Policy changes": SlidersHorizontal,
  Research: ChartColumn,
};

/**
 * Shared foundation, slide 1: the title that sets up the journey, with the room's own answer (the dry
 * run, Oct 25). Before anyone answers, the statement and the cue carry it alone.
 */
function FoundationSlide({ summary }: { summary: RunSummary }) {
  const answered = summary.sourceOfTruth.reduce((sum, c) => sum + c.count, 0);
  const cannot = summary.sourceOfTruth.filter((c) => c.id !== "yes").reduce((sum, c) => sum + c.count, 0);
  return (
    <div className="flex h-full flex-col justify-center gap-[48px] pb-[40px]">
      {answered > 0 && (
        <p className="m-0 max-w-[1300px] border-l-[6px] border-[var(--color-accent)] pl-[32px] font-body text-[40px] leading-snug text-[var(--color-ink)]">
          In this room, <strong className="font-medium tabular-nums text-[var(--color-accent)]">{cannot}</strong> of{" "}
          <strong className="font-medium tabular-nums">{answered}</strong>{" "}
          say a resident, screener or AI can&apos;t fully check an answer against their state&apos;s rules today.
        </p>
      )}
      <p className="m-0 max-w-[1300px] font-body text-[34px] font-medium leading-snug tracking-[-0.01em] text-[var(--color-ink)]">
        {ONE_SET_STATEMENT.text} <span className="text-[var(--color-accent)]">{ONE_SET_STATEMENT.accent}</span>
      </p>
      <p className="m-0 font-body text-[28px] text-[var(--color-ink-secondary)]">{FOUNDATION_CUE}</p>
    </div>
  );
}

/** What the journey after the title slide shows, said on the slide so the room knows what's coming. */
const FOUNDATION_CUE = "Next: how we build it, from the law as written to running code, and what it can power.";

/** The earlier Shared foundation 1/5: one set of rules under every tool. Off the deck since the dry run, Oct 25. */
function OneSetSlide({ summary }: { summary: RunSummary }) {
  const answered = summary.sourceOfTruth.reduce((sum, c) => sum + c.count, 0);
  const cannot = summary.sourceOfTruth.filter((c) => c.id !== "yes").reduce((sum, c) => sum + c.count, 0);
  return (
    <div className="flex h-full flex-col gap-[20px]">
      <div className="grid grid-cols-[440px_auto_1fr] items-stretch gap-[28px]">
        <div className="flex flex-col justify-center gap-[12px] rounded-[14px] bg-[var(--color-ink)] p-[36px] text-white">
          <span className="font-display text-[40px] font-light leading-tight">One open, validated set of rules</span>
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0 font-body text-[22px] leading-snug text-white/80">
            {FOUNDATION_TRAITS.map((trait) => (
              <li key={trait} className="flex gap-[12px]">
                {/* A plain bullet, not a check: these describe how the rules are built, not work that is finished. */}
                <span aria-hidden className="mt-[12px] h-[8px] w-[8px] shrink-0 rounded-full bg-[#e8a25c]" />
                {trait}
              </li>
            ))}
          </ul>
        </div>
        <span aria-hidden className="self-center font-display text-[64px] text-[var(--color-accent)]">
          →
        </span>
        <ul className="m-0 grid list-none grid-cols-2 gap-[14px] p-0">
          {ONE_SET_OF_RULES.map((use) => {
            const Icon = USE_ICONS[use.label];
            return (
              <li
                key={use.label}
                className="flex items-center gap-[18px] rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[28px] py-[22px] font-body text-[28px] font-medium text-[var(--color-ink)]"
              >
                <Icon aria-hidden size={34} strokeWidth={1.75} className="shrink-0 text-[var(--color-accent)]" />
                {use.label}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="m-0 max-w-[1300px] border-t border-[var(--color-rule)] pt-[20px] font-body text-[28px] font-medium leading-snug tracking-[-0.01em] text-[var(--color-ink)]">
        {ONE_SET_STATEMENT.text} <span className="text-[var(--color-accent)]">{ONE_SET_STATEMENT.accent}</span>
      </p>
      {answered > 0 && (
        <p className="m-0 mt-auto border-l-[4px] border-[var(--color-accent)] pl-[24px] font-body text-[26px] text-[var(--color-ink)]">
          In this room, <strong className="font-medium tabular-nums">{cannot}</strong> of{" "}
          <strong className="font-medium tabular-nums">{answered}</strong>{" "}
          say a resident, screener or AI can&apos;t fully check an answer against their state&apos;s rules today.
        </p>
      )}
    </div>
  );
}

/** An icon for each step of the encoding pipeline, as on the InnovateUS slide. */
const PIPELINE_ICONS: Record<(typeof ENCODING_PIPELINE.steps)[number]["name"], LucideIcon> = {
  Intake: Download,
  Corpus: BookText,
  "Encoding loop": RefreshCw,
  RuleSpec: FileCode,
  Graph: Network,
  "Compile and serve": Layers,
};

/** The small mono labels and code inside the pipeline's cards. */
const PIPE_LABEL = "font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-muted)]";
const PIPE_MONO = "font-mono text-[13px] leading-[1.45] text-[var(--color-ink)] [overflow-wrap:anywhere]";
const PIPE_QUOTE = "font-body text-[15px] italic leading-snug text-[var(--color-accent)]";

function PipeDown() {
  return (
    <span aria-hidden className="text-center font-body text-[18px] leading-none text-[var(--color-ink-muted)]">
      ↓
    </span>
  );
}

/** A row of blank squares: the rest of the law around the one provision shown. */
function LawSquares() {
  return (
    <div aria-hidden className="grid grid-cols-6 gap-[5px]">
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} className="block aspect-square rounded-[3px] border border-[var(--color-rule-strong)]" />
      ))}
    </div>
  );
}

/** What the pipeline's graph shows, for screen readers. */
export const PIPELINE_GRAPH_LABEL = "snap_allotment reads tfp and income and feeds benefit; fpl and elig are the rest of the graph";

/**
 * The spec becoming a node: snap_allotment reads tfp and income and feeds the
 * benefit; the faint nodes are the rest of the graph. Sized so its labels stay
 * legible at slide scale.
 */
function PipelineGraph() {
  const box = (x: number, y: number, w: number, label: string, faint = false) => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={22} rx={4} fill="var(--color-paper-elevated)" stroke={faint ? "var(--color-rule-strong)" : "var(--color-accent)"} strokeWidth={1.3} />
      <text x={x + w / 2} y={y + 15} textAnchor="middle" className="font-mono" fontSize={11.5} fill={faint ? "var(--color-ink-muted)" : "var(--color-ink)"}>
        {label}
      </text>
    </g>
  );
  const line = (x1: number, y1: number, x2: number, y2: number, faint = false) => (
    <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={faint ? "var(--color-rule-strong)" : "var(--color-accent)"} strokeWidth={1.2} />
  );
  return (
    <svg role="img" aria-label={PIPELINE_GRAPH_LABEL} viewBox="0 0 170 140" className="block h-auto w-full">
      {line(26, 30, 40, 62)}
      {line(85, 30, 66, 62)}
      {line(85, 30, 136, 62, true)}
      {line(146, 30, 146, 62, true)}
      {line(56, 84, 76, 116)}
      {line(141, 84, 98, 116, true)}
      {box(6, 8, 40, "tfp")}
      {box(56, 8, 58, "income")}
      {box(126, 8, 40, "fpl", true)}
      {box(4, 62, 108, "snap_allotment")}
      {box(120, 62, 46, "elig", true)}
      {box(52, 116, 66, "benefit")}
    </svg>
  );
}

/** What each step of the pipeline looks like, as on the InnovateUS slide. */
function PipelineViz({ name }: { name: (typeof ENCODING_PIPELINE.steps)[number]["name"] }) {
  const p = ENCODING_PIPELINE;
  switch (name) {
    case "Intake":
      return (
        <>
          <span className={PIPE_LABEL}>Scraping pipelines</span>
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {p.sources.map((source) => (
              <li key={source} className={`${PIPE_MONO} rounded-full border border-[var(--color-rule-strong)] bg-[var(--color-paper-elevated)] px-[8px] py-[2px] text-center`}>
                {source}
              </li>
            ))}
          </ul>
          <PipeDown />
          <div className="flex items-center gap-[10px]">
            <Database aria-hidden size={30} strokeWidth={1.4} className="shrink-0 text-[var(--color-rule-strong)]" />
            <span className={PIPE_LABEL}>Database</span>
          </div>
        </>
      );
    case "Corpus":
      return (
        <>
          <LawSquares />
          <div className="flex flex-col gap-[4px] rounded-[8px] border-[1.5px] border-[var(--color-accent)] bg-[var(--color-paper-elevated)] px-[10px] py-[8px]">
            <span className={PIPE_MONO}>
              us:statutes/
              <wbr />
              7/2017/a
            </span>
            <span className="font-body text-[16px] font-semibold leading-snug text-[var(--color-ink)]">§ 2017 · Value of allotment</span>
            <span className={PIPE_QUOTE}>“…30 per centum…”</span>
          </div>
          <LawSquares />
        </>
      );
    case "Encoding loop":
      return (
        <div className="relative flex flex-col gap-[8px] pr-[24px]">
          <div
            className="mr-[8px] rounded-[8px] border border-[var(--color-rule-strong)] bg-[var(--color-paper-elevated)] px-[10px] py-[8px]"
            style={{
              borderTop: "3px solid var(--color-accent)",
              boxShadow:
                "4px 4px 0 -1px var(--color-paper-elevated), 4px 4px 0 0 var(--color-rule-strong), 8px 8px 0 -1px var(--color-paper-elevated), 8px 8px 0 0 var(--color-rule-strong)",
            }}
          >
            <span className={`${PIPE_LABEL} mb-[4px] block`}>Encoders</span>
            <span className={`${PIPE_QUOTE} block`}>“30 per centum”</span>
            <span className={`${PIPE_MONO} block`}>
              <b>→ 0.30</b> <span className="text-[var(--color-ink-muted)]">rev 43</span>
            </span>
          </div>
          <PipeDown />
          <span className={PIPE_LABEL}>Validators</span>
          <ul className="m-0 flex list-none flex-col gap-[5px] p-0">
            {p.checks.map((check) => (
              <li
                key={check.label}
                className="rounded-[12px] border border-[var(--color-success)] bg-[rgba(22,101,52,0.07)] px-[10px] py-[2px] font-mono text-[12px] leading-snug text-[var(--color-success)]"
              >
                {check.required ? `✓ ${check.label}` : check.label}
              </li>
            ))}
          </ul>
          {/* The loop back: a draft that fails a required check goes round again. */}
          <span
            aria-hidden
            className="absolute bottom-[14px] right-[2px] top-[26px] w-[14px] rounded-r-[10px] border-[1.5px] border-l-0 border-dashed border-[var(--color-accent)]"
          />
        </div>
      );
    case "RuleSpec":
      return (
        <>
          <span className={`${PIPE_MONO} text-[var(--color-ink-muted)]`}>¶ rulespec-us</span>
          <span className={`${PIPE_MONO} font-semibold`}>snap_allotment</span>
          <div className={`${PIPE_MONO} rounded-[8px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[10px] py-[8px] leading-[1.6]`}>
            <div className="text-[var(--color-ink-muted)]">imports:</div>
            <div className="pl-[12px]">
              us:statutes/
              <wbr />
              7/2017/a
            </div>
            <div>
              <span className="text-[var(--color-ink-muted)]">entity:</span> Household
            </div>
            <div className="text-[var(--color-ink-muted)]">formula:</div>
            <div className="pl-[12px]">
              max(0, tfp − <b className="text-[var(--color-accent)]">0.30</b> × net)
            </div>
            <div className="text-[var(--color-accent)]">0.30 ← “30 per centum”</div>
          </div>
        </>
      );
    case "Graph":
      return <PipelineGraph />;
    case "Compile and serve":
      return (
        <>
          <div className="overflow-hidden rounded-[10px] border-[1.5px] border-[var(--color-accent)] bg-[var(--color-paper-elevated)]">
            <div className="flex items-center gap-[8px] border-b border-[var(--color-rule)] bg-[var(--color-accent-light)] px-[10px] py-[5px] text-[var(--color-accent)]">
              <Package aria-hidden size={18} strokeWidth={1.8} className="shrink-0" />
              <span className="font-mono text-[12px] font-medium uppercase tracking-[0.12em]">Program artifact</span>
            </div>
            <div className="px-[10px] py-[8px]">
              <div className={`${PIPE_MONO} font-semibold`}>SNAP · US · 2026</div>
              <div className="font-mono text-[13px] text-[var(--color-success)]">✓ compiled</div>
            </div>
          </div>
          <PipeDown />
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {p.surfaces.map((surface) => (
              <li
                key={surface.name}
                className="flex flex-col rounded-[6px] border border-[var(--color-rule-strong)] bg-[var(--color-paper-elevated)] px-[10px] py-[5px]"
                style={{ borderTop: "2px solid var(--color-accent)" }}
              >
                <span className="font-body text-[16px] font-semibold leading-tight text-[var(--color-ink)]">{surface.name}</span>
                <span className="font-mono text-[12px] text-[var(--color-ink-muted)]">{surface.who}</span>
              </li>
            ))}
          </ul>
        </>
      );
  }
}

/**
 * Shared foundation, slide 3: the encoding pipeline, from the InnovateUS deck
 * (slide 12). Cards share the row's grid (subgrid), so icons, names, captions,
 * illustrations and footnotes line up across all six.
 */
function PipelineSlide() {
  const p = ENCODING_PIPELINE;
  return (
    <div className="flex h-full flex-col gap-[22px]">
      <p className="m-0 font-body text-[21px] leading-snug text-[var(--color-ink-secondary)]">{p.lead}</p>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.2fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.12fr)] grid-rows-[auto_auto_auto_1fr_auto] gap-x-[6px]">
        {p.steps.map((step, i) => {
          const Icon = PIPELINE_ICONS[step.name];
          return (
            <Fragment key={step.name}>
              {i > 0 && (
                <span aria-hidden className="row-span-5 self-center font-body text-[20px] text-[var(--color-ink-muted)]">
                  →
                </span>
              )}
              <div
                className="row-span-5 grid min-w-0 grid-rows-subgrid gap-y-[7px] rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[14px] pb-[14px] pt-[12px] shadow-[0_1px_3px_rgba(28,25,23,0.06)]"
                style={{ borderTop: "5px solid var(--color-accent)" }}
              >
                <span className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                  <Icon aria-hidden size={22} strokeWidth={1.75} />
                </span>
                <span className="font-body text-[22px] font-semibold leading-tight text-[var(--color-ink)]">{step.name}</span>
                <span className="font-body text-[16px] leading-snug text-[var(--color-ink-secondary)]">{step.caption}</span>
                <div className={`flex min-h-0 flex-col gap-[6px] border-t border-[var(--color-rule)] pt-[10px] ${step.foot ? "" : "row-span-2"}`}>
                  <PipelineViz name={step.name} />
                </div>
                {step.foot && (
                  <span className="border-t border-[var(--color-rule)] pt-[8px] font-body text-[14px] italic leading-snug text-[var(--color-ink-secondary)]">
                    {step.foot}
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Shared foundation, slide 4: how a shared foundation gets built, from public
 * documents to Gold A. Cards share the grid's rows (subgrid), so medallions,
 * names, what a state gets and "It takes" line up across all three.
 */
function TiersSlide() {
  return (
    <div className="grid h-full grid-cols-3 grid-rows-[auto_1fr_auto] gap-x-[24px] gap-y-[20px]">
      {GOLDEN_A.map((tier) => {
        const palette = tier.medal ? TIERS[tier.medal] : null;
        return (
          <div
            key={tier.tier}
            className={`row-span-3 grid grid-rows-subgrid rounded-b-[14px] px-[32px] pb-[32px] pt-[28px] ${
              palette ? "" : "border-x border-b border-[var(--color-rule)] bg-[var(--color-paper-elevated)]"
            }`}
            style={{ borderTop: `5px solid ${palette?.ring ?? "var(--color-accent)"}`, background: palette?.tint }}
          >
            <div className="flex items-center gap-[16px]">
              <TierMedal medal={tier.medal} size={64} />
              <div>
                <span
                  className="block font-mono text-[15px] uppercase tracking-[0.16em]"
                  style={{ color: palette?.ink ?? "var(--color-accent)" }}
                >
                  {tier.tier}
                </span>
                <span className="block font-body text-[26px] font-medium leading-tight text-[var(--color-ink)]">{tier.name}</span>
              </div>
            </div>
            <div className="flex flex-col gap-[14px]">
              <p className="m-0 font-body text-[21px] leading-snug text-[var(--color-ink)]">{tier.gets}</p>
              {"goal" in tier && <p className="m-0 font-body text-[21px] leading-snug text-[var(--color-ink)]">{tier.goal}</p>}
              {"programs" in tier && (
                <ul className="m-0 grid list-none grid-cols-2 gap-x-[16px] gap-y-[6px] p-0 font-body text-[18px] leading-snug text-[var(--color-ink-secondary)]">
                  {(tier.programs as readonly string[]).map((program) => (
                    <li key={program} className="flex gap-[8px]">
                      {/* A plain bullet, not a check: these are the programs to encode, not programs done. */}
                      <span aria-hidden className="mt-[10px] h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--color-ink-muted)]" />
                      {program}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="m-0 font-body text-[19px] leading-snug text-[var(--color-ink-secondary)]">
              <span className="font-medium text-[var(--color-ink)]">It takes:</span> {tier.takes}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function VoteSlide({ votes }: { votes: Count[] }) {
  const total = votes.reduce((sum, v) => sum + v.count, 0);
  return (
    <div className="flex h-full flex-col gap-[28px]">
      <span className="font-body text-[26px] text-[var(--color-ink-secondary)]">
        <strong className="font-medium tabular-nums text-[var(--color-accent)]">{total}</strong>{" "}
        {total === 1 ? "vote" : "votes"} · vote on your phone
      </span>
      <Panel>
        <BigBars items={votes} empty="Votes appear here as people vote." />
      </Panel>
    </div>
  );
}

type GroupNote = RunSummary["breakouts"]["notes"][number];

/** One group's answers, by question: the idea, who uses it, what earns trust. */
function groupLines(n: GroupNote) {
  return GROUP_QUESTIONS.map((q, i) => ({ q, number: i + 1, text: q.id === "note" ? n.text : n[q.id] })).filter((l) => l.text);
}

/**
 * Small groups, slide 2: the three questions, then one report-back card per
 * group. Clicking a card fills the slide with that group's full answers while
 * it reports; clicking again, or Escape, goes back to all of them.
 */
function GroupsSlide({ summary }: { summary: RunSummary }) {
  // Six groups at most, two per row, each clamped, so a full room still fits the 16:9 slide.
  const ideas = summary.breakouts.notes.slice(0, 6);
  const [open, setOpen] = useState<number | null>(null);
  const spotlight = open !== null ? ideas[open] : undefined;
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const useCaseLabel = (n: GroupNote) => USE_CASES.find((u) => u.id === n.useCase)?.label ?? "Group idea";
  // Rows only for the groups there are: with four or fewer, each card gets half the space and its lines can wrap.
  const rows = Math.min(3, Math.max(1, Math.ceil(ideas.length / 2)));
  const roomy = rows <= 2;
  return (
    <div className="relative flex h-full flex-col gap-[18px]">
      <ol className="m-0 grid list-none grid-cols-3 gap-[16px] p-0">
        {GROUP_QUESTIONS.map((q, i) => (
          <li key={q.id} className="flex gap-[12px] border-l-[4px] border-[var(--color-accent)] pl-[16px]">
            <span className="font-mono text-[20px] text-[var(--color-accent)]">{i + 1}</span>
            <span className="font-body text-[24px] font-medium leading-snug text-[var(--color-ink)]">{q.label}</span>
          </li>
        ))}
      </ol>
      <p className="m-0 font-body text-[20px] text-[var(--color-ink-secondary)]">{BREAKOUT_PROMPT}</p>
      {ideas.length === 0 ? (
        <p className="m-0 font-body text-[26px] text-[var(--color-ink-muted)]">Ideas appear here as groups share them.</p>
      ) : (
        <ul
          className="m-0 grid min-h-0 flex-1 list-none grid-cols-2 gap-[14px] p-0"
          style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {ideas.map((n, i) => {
            const [first, ...rest] = groupLines(n);
            return (
              <li key={`${i}-${n.text}`} className="min-h-0">
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-label={`Report back: ${useCaseLabel(n)}`}
                  className="h-full w-full cursor-pointer overflow-hidden rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[22px] py-[12px] text-left font-body text-[var(--color-ink)] hover:border-[var(--color-accent)]"
                >
                  <span className="mb-[2px] block font-mono text-[14px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
                    {useCaseLabel(n)}
                  </span>
                  {first ? (
                    <span className={`${roomy ? "line-clamp-3" : "line-clamp-2"} text-[21px] leading-snug`}>{first.text}</span>
                  ) : (
                    n.raised && <span className={`${roomy ? "line-clamp-3" : "line-clamp-2"} text-[21px] leading-snug`}>{n.raised}</span>
                  )}
                  {rest.map((l) => (
                    <span
                      key={l.q.id}
                      className={`mt-[2px] ${roomy ? "line-clamp-3" : "line-clamp-1"} text-[17px] text-[var(--color-ink-secondary)]`}
                    >
                      <span className="font-medium text-[var(--color-ink)]">{l.q.short}:</span> {l.text}
                    </span>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {spotlight && (
        <div
          role="dialog"
          aria-label={`Report back: ${useCaseLabel(spotlight)}`}
          className="absolute inset-0 z-10 flex flex-col gap-[22px] rounded-[14px] border-2 border-[var(--color-accent)] bg-[var(--color-paper-elevated)] p-[40px]"
        >
          <div className="flex items-start justify-between gap-[24px]">
            <Label className="mb-0 text-[var(--color-accent)]">{useCaseLabel(spotlight)}</Label>
            <button type="button" onClick={() => setOpen(null)} className={`${BUTTON_QUIET} px-3 py-1 text-[0.85rem]`}>
              Back to all groups
            </button>
          </div>
          {groupLines(spotlight).map((l) => (
            <div key={l.q.id} className="flex gap-[16px]">
              <span className="font-mono text-[22px] text-[var(--color-accent)]">{l.number}</span>
              <div className="min-w-0">
                <span className="block font-body text-[20px] text-[var(--color-ink-muted)]">{l.q.label}</span>
                <p className="m-0 line-clamp-4 font-body text-[30px] leading-snug text-[var(--color-ink)]">{l.text}</p>
              </div>
            </div>
          ))}
          {spotlight.raised && (
            <p className="m-0 mt-auto line-clamp-3 border-t border-[var(--color-rule)] pt-[16px] font-body text-[22px] leading-snug text-[var(--color-ink-secondary)]">
              <span className="font-medium text-[var(--color-ink)]">Also raised:</span> {spotlight.raised}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Next steps, slide 1: the ask. What Silver A takes from a state, and what it never asks for. */
function AskSlide() {
  return (
    <div className="flex h-full flex-col gap-[28px]">
      <div className="flex items-center gap-[20px]">
        <TierMedal medal="silver" size={64} />
        <div>
          <p className="m-0 font-display text-[44px] font-light leading-tight text-[var(--color-ink)]">{SILVER_ASK.title}</p>
          <p className="m-0 font-body text-[24px] text-[var(--color-ink-secondary)]">{SILVER_ASK.lead}</p>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-[24px]">
        <Panel className="border-l-[8px] border-l-[var(--color-accent)]">
          <Label className="text-[var(--color-accent)]">What it takes</Label>
          <ul className="m-0 flex list-disc flex-col gap-[14px] pl-[28px] font-body text-[26px] leading-snug text-[var(--color-ink)]">
            {SILVER_ASK.takes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <Label>Your guardrails</Label>
          <ul className="m-0 flex list-disc flex-col gap-[14px] pl-[28px] font-body text-[26px] leading-snug text-[var(--color-ink)]">
            {SILVER_ASK.guardrails.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

// Nothing from the pledges goes on this slide: it asks, and points to the form.
function NextSlide() {
  return (
    <div className="flex h-full flex-col gap-[32px]">
      <p className="m-0 max-w-[1200px] font-display text-[44px] font-light leading-snug text-[var(--color-ink)]">
        {NEXT_STEPS.ask}
      </p>
      <div className="grid grid-cols-2 gap-[24px]">
        {NEXT_STEPS.options.map((o) => (
          <Panel key={o.id}>
            <span className="block font-body text-[32px] font-medium text-[var(--color-ink)]">{o.label}</span>
            <span className="mt-[6px] block font-body text-[22px] leading-snug text-[var(--color-ink-secondary)]">{o.detail}</span>
          </Panel>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-[24px]">
        <JoinQr size={120} className="border border-[var(--color-rule)]" />
        <p className="m-0 font-body text-[28px] text-[var(--color-ink-secondary)]">
          Fill in the short form on your phone at <strong className="font-medium text-[var(--color-accent)]">{EVENT.joinUrl}</strong>.
        </p>
      </div>
    </div>
  );
}

function ThankYouSlide() {
  return (
    <div className="flex h-full flex-col justify-center gap-[36px]">
      <h1 className="heading-page m-0" style={{ fontSize: 88, lineHeight: 1.05, ...SENTENCE }}>
        Thank you
      </h1>
      <p className="m-0 max-w-[1150px] font-display text-[46px] font-light leading-snug text-[var(--color-ink)]">
        To the Aspen Institute and to every leader in the room. <span className="serif-italic">Enjoy dinner.</span>
      </p>
      <p className="m-0 font-body text-[26px] text-[var(--color-ink-secondary)]">
        {EVENT.hosts} · {EVENT.contactEmail}
      </p>
    </div>
  );
}
