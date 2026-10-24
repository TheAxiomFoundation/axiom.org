"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChartColumn,
  Check,
  ClipboardCheck,
  GraduationCap,
  Landmark,
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
  FRONT_DOOR,
  LIVE_DEMO,
  liveDemoUrl,
  POLICYBENCH,
  SAME_RULES,
  SILVER_ASK,
  TOOL_PILOT,
  FREE_PLAN_PILOT,
  distinguishable,
  formatPoints,
  shownChange,
  share,
  toolPilotMisses,
  wholeShare,
  type FreePlanPilot,
  type ToolPilot,
  type ToolPilotArmId,
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

/**
 * At scale's slides, in order. The free-plan pilot comes after the tool pilot
 * only once its numbers are set; the live demo is always last.
 */
export function scaleSlides(freePlan: FreePlanPilot | null): string[] {
  return ["share", "household", "break", "miss", "front-door", "tool", ...(freePlan ? ["free-plan"] : []), "live-demo"];
}
const SCALE_SLIDES = scaleSlides(FREE_PLAN_PILOT);

/** A slide that turns its stage's argument gets its own heading: At scale from the front door on. */
const SLIDE_TITLES: Partial<Record<StageId, Record<number, string>>> = {
  scale: Object.fromEntries(
    SCALE_SLIDES.map((_, i) => i).filter((i) => i >= SCALE_SLIDES.indexOf("front-door")).map((i) => [i, FRONT_DOOR.heading]),
  ),
  foundation: { 1: SAME_RULES.heading, 2: BUILD_HEADING },
};

/** Stages shown as more than one slide; the arrows step through them before moving the room. */
const SLIDES: Partial<Record<StageId, number>> = { reveal: 2, scale: SCALE_SLIDES.length, foundation: 3, groups: 2, next: 2 };
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRunOpen(false);
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return;
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
  }, [step]);

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
                <SlideHeader
                  number={index + 1}
                  label={current.label}
                  title={SLIDE_TITLES[stage]?.[sub] ?? current.title}
                  summary={sub === 0 ? current.summary : undefined}
                  part={slideCount(stage) > 1 ? `${sub + 1}/${slideCount(stage)}` : undefined}
                />
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
                {/* Slides 2 to 5 of At scale, and 2 of Shared foundation, come from Max's Nava deck; then the tool
                    pilot, the free-plan pilot once it has numbers, and the live chatbot. */}
                {stage === "scale" &&
                  {
                    share: <ScaleShareSlide key="share" />,
                    household: <HouseholdSlide key="household" />,
                    break: <BreakSlide key="break" />,
                    miss: <MissSlide key="miss" />,
                    "front-door": <FrontDoorSlide key="front-door" />,
                    tool: <ToolSlide key="tool" />,
                    "free-plan": FREE_PLAN_PILOT && <FreePlanSlide key="free-plan" pilot={FREE_PLAN_PILOT} />,
                    "live-demo": <LiveDemoSlide key="live-demo" />,
                  }[SCALE_SLIDES[sub]]}
                {stage === "foundation" &&
                  [<FoundationSlide key="foundation" summary={summary} />, <SameRulesSlide key="same-rules" />, <TiersSlide key="tiers" />][
                    sub
                  ]}
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

function SlideHeader({
  number,
  label,
  title,
  summary,
  part,
}: {
  number: number;
  label: string;
  title: string;
  summary?: string;
  part?: string;
}) {
  return (
    <header className="mb-[40px]">
      <span className="mb-[18px] flex items-center gap-[14px] font-mono text-[17px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
        <span>
          {String(number).padStart(2, "0")} · {label}
        </span>
        {part && <span className="text-[var(--color-ink-muted)]">{part}</span>}
      </span>
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
      <div className="flex justify-between font-mono text-[15px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
        <span>1 · {scale.low}</span>
        <span>{scale.high} · 5</span>
      </div>
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
          // Four at most, two per row, each clamped to two lines, so the slide still fits 16:9.
          <ul className="m-0 grid list-none grid-cols-2 gap-[14px] p-0">
            {comments.slice(0, 4).map((text, i) => (
              <li
                key={`${i}-${text}`}
                className={`rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[24px] py-[16px] ${BOX_TEXT}`}
              >
                <span className="line-clamp-2">{text}</span>
              </li>
            ))}
          </ul>
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
 * stay quiet there: the two most worth discussing, with what the person
 * said about each. Before anyone flags one, the spoken questions show instead.
 */
function WorthDiscussing({ summary }: { summary: RunSummary }) {
  const items = summary.spotlight.slice(0, 2);
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
      <Label>Answers worth discussing</Label>
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
function StandardsNote() {
  const ex = POLICYBENCH.example;
  return (
    <p className="m-0 font-body text-[18px] leading-snug text-[var(--color-ink-secondary)]">
      ${ex.reference.monthly} a month under the benchmark&apos;s July 2026 rules ({ex.reference.standards} standards).{" "}
      The minimum rose to ${ex.fromOctober.monthly} on October 1, so 2026 comes to ${ex.currentLaw.annual} under current law.
    </p>
  );
}

/** One tile per model: $0 in red, other wrong amounts muted, the reference amount in the accent, no answer as a dash. */
function answerTile(answer: number | null, reference: number) {
  if (answer === null) return { text: "–", label: "no answer", tone: "border-[var(--color-rule)] text-[var(--color-ink-muted)]" };
  if (answer === reference)
    return { text: `$${answer}`, label: `$${answer}, matches the reference`, tone: "border-[var(--color-accent)] bg-[var(--color-accent-light)] font-semibold text-[var(--color-accent)]" };
  if (answer <= 0) return { text: "$0", label: "$0", tone: "border-[var(--color-error)]/30 text-[var(--color-error)]" };
  return { text: `$${answer.toLocaleString("en-US")}`, label: `$${answer.toLocaleString("en-US")}`, tone: "border-[var(--color-rule)] text-[var(--color-ink-secondary)]" };
}

/** At scale, slide 2 (Max's Nava deck): accuracy by program, owed money against owed $0. */
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
            <BigStat value={`$${h.reference}`} label="PolicyEngine's reference in PolicyBench" tone="accent" />
            <BigStat value="$0" label={`from ${ex.modelsSaidZero} of ${ex.modelsAnswered} AI models · ${ex.modelsExact} matched exactly`} tone="bad" />
          </div>
          <StandardsNote />
          {/* Every model's answer: the $0s as one block, then the others at full width so no amount is cut. */}
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

/** At scale, slide 5 (Max's Nava deck): how the top two models explain $0, beside the rule they skip. */
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
        <Panel className="flex flex-col border-l-[8px] border-l-[var(--color-accent)]">
          <Label>{m.ruleLabel}</Label>
          <p className={`m-0 ${BOX_TEXT}`}>{m.rule}</p>
          <div className="mt-auto pt-[8px]">
            <BigStat value={`$${m.amount}`} unit="in 2026" label={m.amountLabel} tone="accent" size={80} />
          </div>
          <StandardsNote />
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

/**
 * The tool pilot's bar colours, by arm: the model on its own recedes in the
 * same gray as the "Where models still break" chart, and the tool carries the
 * accent. Every bar is labelled with its value, so color never carries it alone.
 */
const ARM_COLORS: Record<ToolPilotArmId, string> = {
  alone: "#bdb6ae",
  web: "#8e9aaa",
  tool: "var(--color-accent)",
  both: "var(--color-accent-hover)",
};
/** Arms that run the engine, whose numbers read in full ink. */
const ENGINE_ARMS: ReadonlySet<ToolPilotArmId> = new Set(["tool", "both"]);

/**
 * At scale, slide 6: PolicyBench's tool pilot. The same models in each arm
 * (on their own, and with a tool that runs a rules engine) beside the benefit
 * amounts on their own, then the note's caveat that the tool runs the engine
 * behind the reference, across the full width so it fits at 1600×900.
 */
function ToolSlide() {
  const t = TOOL_PILOT;
  const { misses, scored } = toolPilotMisses(t);
  const bar = t.arms.length > 2 ? 20 : 26;
  return (
    <div className="flex h-full flex-col gap-[12px]">
      <div className="flex items-end justify-between gap-[24px]">
        <p className="m-0 font-display text-[40px] font-light leading-tight text-[var(--color-ink)]">{t.title}</p>
        <span className="flex shrink-0 flex-wrap justify-end gap-x-[24px] gap-y-[4px] font-body text-[20px] text-[var(--color-ink-secondary)]">
          {t.arms.map((arm) => (
            <span key={arm.id} className="flex items-center gap-[8px]">
              <span aria-hidden className="h-[14px] w-[14px] rounded-[3px]" style={{ background: ARM_COLORS[arm.id] }} /> {arm.label}
            </span>
          ))}
        </span>
      </div>
      <p className="m-0 font-body text-[20px] text-[var(--color-ink-secondary)]">{t.note}</p>
      <div
        className={`grid min-h-0 items-start gap-[40px] pt-[8px] ${t.benefits ? "grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]" : "grid-cols-1"}`}
      >
        <ul className={`m-0 flex list-none flex-col p-0 ${t.arms.length > 2 ? "gap-[20px]" : "gap-[28px]"}`}>
          {t.rows.map((row) => (
            <li key={row.model} className="grid grid-cols-[220px_minmax(0,1fr)] items-center gap-[24px]">
              <span className={BOX_TEXT}>{row.model}</span>
              <span className="flex flex-col gap-[8px]">
                {t.arms.map((arm) => {
                  const hits = row.hits[arm.id];
                  if (typeof hits !== "number") return null;
                  const value = share(hits, t.amounts);
                  return (
                    <span key={arm.id} className="flex items-center gap-[14px]">
                      <span className="rounded-[4px]" style={{ height: bar, width: `${value * 0.78}%`, background: ARM_COLORS[arm.id] }} />
                      <span
                        className={`whitespace-nowrap font-mono text-[22px] leading-none tabular-nums ${ENGINE_ARMS.has(arm.id) ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}
                      >
                        <span className="sr-only">{arm.label}: </span>
                        {value.toFixed(1)}%
                      </span>
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
        {t.benefits && <BenefitsPanel benefits={t.benefits} />}
      </div>
      <Panel className="flex flex-col gap-[8px] py-[18px]">
        <Label className="mb-0">What this measures</Label>
        <p className="m-0 font-body text-[22px] leading-snug text-[var(--color-ink)]">
          {t.measures}{" "}
          <span className="text-[var(--color-ink-secondary)]">
            The {misses} of {scored} amounts still wrong with the tool {t.missesCause}
          </span>
        </p>
      </Panel>
      <BenchFooter source={t.source} />
    </div>
  );
}

/** The benefit amounts alone, as a small table: the part of the pilot this room runs. */
function BenefitsPanel({ benefits: b }: { benefits: NonNullable<ToolPilot["benefits"]> }) {
  const cell = "px-[10px] py-[2px] text-right font-mono text-[22px] tabular-nums";
  return (
    <Panel className="flex flex-col gap-[10px] py-[16px]">
      <Label className="mb-0">{b.title}</Label>
      <table className="w-full border-collapse font-body text-[21px] leading-snug text-[var(--color-ink)]">
        <caption className="sr-only">Benefit amounts right, of {b.amounts}, by model</caption>
        <thead>
          <tr className="text-[var(--color-ink-muted)]">
            <th scope="col" className="py-[2px] text-left font-normal">
              <span className="sr-only">Arm</span>
            </th>
            {b.rows.map((r) => (
              <th key={r.model} scope="col" className={`${cell} font-body font-normal`}>
                <abbr title={r.model} className="no-underline">
                  {r.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="py-[2px] text-left font-normal text-[var(--color-ink-secondary)]">
              On its own
            </th>
            {b.rows.map((r) => (
              <td key={r.model} className={`${cell} text-[var(--color-ink-muted)]`}>
                {r.alone}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="py-[2px] text-left font-normal text-[var(--color-ink-secondary)]">
              With the tool
            </th>
            {b.rows.map((r) => (
              <td key={r.model} className={`${cell} font-medium`}>
                {r.tool}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="m-0 font-body text-[19px] leading-snug text-[var(--color-ink-secondary)]">{b.also}</p>
    </Panel>
  );
}

/**
 * At scale, after the tool pilot: the models on free plans, in every setting.
 * Each row reads across, from on its own to with the tool; the last column is
 * that model's change from no tools to the tool, with its 95% interval, in
 * gray when the interval includes zero. Shows only when FREE_PLAN_PILOT is set.
 */
export function FreePlanSlide({ pilot: p }: { pilot: FreePlanPilot }) {
  // Up to three models get room; four to six take a tighter type scale. With
  // PolicyBench's caveat and footnotes at full length, roomy rows fit 1600×900
  // only up to three.
  const compact = p.rows.length > 3;
  const z = compact
    ? { cell: "py-[1px]", model: "text-[22px] leading-tight", plan: "text-[15px] leading-tight", value: "text-[24px]", small: "text-[15px]", bar: "mt-[4px] h-[6px]", caveat: "text-[17px]", note: "text-[15px]", head: "text-[16px]" }
    : { cell: "py-[10px]", model: "text-[24px] leading-snug", plan: "text-[17px] leading-snug", value: "text-[26px]", small: "text-[16px]", bar: "mt-[8px] h-[8px]", caveat: "text-[20px]", note: "text-[17px]", head: "text-[18px]" };
  return (
    <div className={`flex h-full flex-col ${compact ? "gap-[10px]" : "gap-[12px]"}`}>
      <div className="flex items-start justify-between gap-[24px]">
        <p className="m-0 font-display text-[40px] font-light leading-tight text-[var(--color-ink)]">{p.title}</p>
        <span className="mt-[6px] shrink-0 rounded-full border-2 border-[var(--color-error)] px-[16px] py-[4px] font-body text-[20px] font-medium text-[var(--color-error)]">
          {p.label}
        </span>
      </div>
      <p className="m-0 font-body text-[20px] leading-snug text-[var(--color-ink-secondary)]">{p.note}</p>
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Share of amounts right, by model and setting, and each model&apos;s change from no tools to the tool</caption>
        <colgroup>
          <col className="w-[24%]" />
          {p.arms.map((arm) => (
            <col key={arm.id} />
          ))}
          <col className="w-[20%]" />
        </colgroup>
        <thead>
          <tr className={`border-b border-[var(--color-rule)] text-left align-bottom font-body leading-snug text-[var(--color-ink-secondary)] ${z.head}`}>
            <th scope="col" className="pb-[8px] font-normal">
              <span className="sr-only">Model</span>
            </th>
            {p.arms.map((arm) => (
              <th key={arm.id} scope="col" className="px-[12px] pb-[8px] font-normal">
                <span className="flex items-center gap-[8px]">
                  <span aria-hidden className="h-[14px] w-[14px] shrink-0 rounded-[3px]" style={{ background: ARM_COLORS[arm.id] }} />
                  {arm.label}
                </span>
              </th>
            ))}
            <th scope="col" className="pb-[8px] pl-[12px] font-normal">
              No tools to tool, in points, with its 95% interval
            </th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((row) => {
            const c = row.toolVsAlone;
            const sure = distinguishable(c);
            return (
              <tr key={row.model} className="border-b border-[var(--color-rule-subtle)] align-middle">
                <th scope="row" className={`${z.cell} pr-[12px] text-left font-normal`}>
                  <span className={`block font-body text-[var(--color-ink)] ${z.model}`}>{row.model}</span>
                  {row.freePlan && <span className={`block font-body text-[var(--color-ink-muted)] ${z.plan}`}>{row.freePlan}</span>}
                </th>
                {p.arms.map((arm) => {
                  const count = row.counts[arm.id];
                  if (!count) return <td key={arm.id} className={z.cell} />;
                  const value = wholeShare(count);
                  return (
                    <td key={arm.id} className={`${z.cell} px-[12px]`}>
                      <span className="flex items-baseline gap-[8px]">
                        <span
                          className={`font-mono leading-none tabular-nums ${z.value} ${ENGINE_ARMS.has(arm.id) ? "text-[var(--color-ink)]" : "text-[var(--color-ink-secondary)]"}`}
                        >
                          {value}%
                        </span>
                        <span className={`whitespace-nowrap font-body text-[var(--color-ink-muted)] ${z.small}`}>
                          {count.k} of {count.n}
                        </span>
                      </span>
                      <span aria-hidden className={`block overflow-hidden rounded-full bg-[var(--color-rule-subtle)] ${z.bar}`}>
                        <span className="block h-full rounded-full" style={{ width: `${value}%`, background: ARM_COLORS[arm.id] }} />
                      </span>
                    </td>
                  );
                })}
                <td className={`${z.cell} pl-[12px]`}>
                  {/* Compact rows put the interval beside the change, so a row is one line of numbers. */}
                  <span className={compact ? "flex items-baseline gap-[10px]" : "block"}>
                    <span
                      className={`block font-mono leading-none tabular-nums ${z.value} ${sure ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}
                    >
                      {formatPoints(shownChange(c))}
                    </span>
                    <span className={`block font-body text-[var(--color-ink-muted)] ${z.small} ${compact ? "" : "mt-[6px]"}`}>
                      {formatPoints(c.lo)} to {formatPoints(c.hi)}
                      {sure ? "" : ", includes 0"}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-col gap-[4px]">
        <p className={`m-0 font-body leading-snug text-[var(--color-ink)] ${z.caveat}`}>{p.caveat}</p>
        {/* One run-in paragraph, so a short footnote shares a line. */}
        <p className={`m-0 font-body leading-snug text-[var(--color-ink-muted)] ${z.note}`}>{p.footnotes.join(" ")}</p>
      </div>
      <BenchFooter source={p.source} />
    </div>
  );
}

/**
 * At scale, the last slide: the live chatbot, plain AI beside AI with the Axiom rules
 * engine. A cross-origin frame inside the slide's scaled canvas paints blank,
 * so the slide holds a slot and the frame sits over it, fixed to the slot's
 * on-screen box; the demo also shows at its own size rather than scaled.
 */
function LiveDemoSlide() {
  const slot = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
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
      <p className="m-0 font-display text-[36px] font-light leading-tight text-[var(--color-ink)]">{LIVE_DEMO.title}</p>
      <div ref={slot} className="min-h-0 flex-1 rounded-[14px] border border-[var(--color-rule)] bg-white" />
      {box &&
        createPortal(
          <iframe
            title="Live chatbot demo: plain AI beside AI with the Axiom rules engine"
            src={liveDemoUrl()}
            className="fixed z-30 border-0 bg-white"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />,
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

/** Shared foundation, slide 1: one set of rules under every tool. */
function FoundationSlide({ summary }: { summary: RunSummary }) {
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

/**
 * Shared foundation, slide 3: how a shared foundation gets built, from public
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
