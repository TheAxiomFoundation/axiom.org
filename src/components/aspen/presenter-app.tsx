"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BREAKOUT_PROMPT,
  DISCUSSION_QUESTIONS,
  EVENT,
  GOLDEN_A,
  NEXT_STEPS,
  ONE_SET_OF_RULES,
  POLICYBENCH,
  STAGES,
  USE_CASES,
  percent,
  stageIndex,
  type StageId,
} from "@/lib/aspen/content";
import type { Control } from "@/lib/aspen/types";
import { EMPTY_SUMMARY, type Count, type RunSummary } from "@/lib/aspen/results";
import { countWord, snapQcTotals } from "@/lib/verification-evidence";
import { postJson, useControl, useResults } from "./client";
import { BAD, GOOD, MAYBE, ScaleCard, SplitBar } from "./results-board";
import { BUTTON_QUIET, FIELD } from "./ui";
import { BrandLogo } from "./brand-logo";

/** The slide canvas: drawn at 1600×900 and scaled to fit the screen, so every stage fits 16:9. */
const SLIDE_W = 1600;
const SLIDE_H = 900;

/** Stages shown as more than one slide; the arrows step through them before moving the room. */
const SLIDES: Partial<Record<StageId, number>> = { scale: 2, foundation: 2 };
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
  const [showStates, setShowStates] = useState(false);
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
    <div className="fixed inset-0 z-1 overflow-hidden bg-[var(--color-ink)]">
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
                  title={current.title}
                  summary={sub === 0 ? current.summary : undefined}
                  part={slideCount(stage) > 1 ? `${sub + 1}/${slideCount(stage)}` : undefined}
                />
              )}
              <div className="min-h-0 flex-1">
                {stage === "welcome" && <WelcomeSlide summary={summary} joinPassword={joinPassword} />}
                {stage === "try" && <TrySlide summary={summary} joinPassword={joinPassword} />}
                {stage === "rate" && <RateSlide summary={summary} />}
                {stage === "reveal" && <RevealSlide summary={summary} />}
                {stage === "scale" && (sub === 0 ? <ScaleShareSlide /> : <ScaleCaseSlide />)}
                {stage === "foundation" &&
                  (sub === 0 ? <FoundationSlide summary={summary} /> : <TiersSlide />)}
                {stage === "vote" && <VoteSlide votes={summary.votes} />}
                {stage === "groups" && <GroupsSlide summary={summary} />}
                {stage === "next" && <NextSlide states={showStates ? summary.pledges.states : null} />}
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

      <div
        className={`absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 border-t border-[var(--color-rule)] bg-[var(--color-paper)]/95 px-6 py-2 ${fade}`}
      >
        <span className="font-body text-[0.8rem] text-[var(--color-ink-muted)]">
          New run (clears the screen after a rehearsal):
        </span>
        <input
          className={`${FIELD} w-48 py-1.5 text-[0.85rem]`}
          placeholder="e.g. phoenix"
          value={runDraft}
          onChange={(e) => setRunDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          aria-label="New run name"
        />
        <button
          type="button"
          className={BUTTON_QUIET}
          disabled={!runDraft}
          onClick={() => {
            if (window.confirm(`Start run "${runDraft}" and move everyone to Welcome?`)) {
              setSlide({ stage: "welcome", sub: 0 });
              void move({ runId: runDraft, stage: "welcome" });
              setRunDraft("");
              setShowStates(false);
            }
          }}
        >
          Start run
        </button>
        {stage === "next" && (
          <button type="button" className={`${BUTTON_QUIET} ml-auto`} onClick={() => setShowStates((v) => !v)}>
            {showStates ? "Hide the states" : "Show the states going further"}
          </button>
        )}
      </div>
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
      <h1 className="heading-page m-0" style={{ fontSize: 64, lineHeight: 1.05 }}>
        {title}
      </h1>
      {summary && (
        <p className="m-0 mt-[16px] max-w-[1200px] font-body text-[28px] leading-snug text-[var(--color-ink-secondary)]">
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

function Join({ joinPassword, large = false }: { joinPassword: string | null; large?: boolean }) {
  return (
    <Panel className="flex flex-col gap-[10px]">
      <Label>Join on your phone or laptop</Label>
      <span
        className="font-display font-light leading-tight text-[var(--color-accent)]"
        style={{ fontSize: large ? 80 : 56 }}
      >
        {EVENT.joinUrl}
      </span>
      {joinPassword && (
        <span className="font-body text-[var(--color-ink)]" style={{ fontSize: large ? 38 : 30 }}>
          Password: <strong className="font-mono">{joinPassword}</strong>
        </span>
      )}
    </Panel>
  );
}

function BigStat({
  value,
  label,
  tone = "ink",
  size = 96,
}: {
  value: ReactNode;
  label: string;
  tone?: "ink" | "bad" | "accent";
  size?: number;
}) {
  const color = { ink: "var(--color-ink)", bad: "var(--color-error)", accent: "var(--color-accent)" }[tone];
  return (
    <div>
      <span className="block font-display font-light leading-none tabular-nums" style={{ fontSize: size, color }}>
        {value}
      </span>
      <span className="mt-[8px] block font-body text-[24px] text-[var(--color-ink-secondary)]">{label}</span>
    </div>
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
    <div className="flex h-full flex-col justify-center gap-[48px]">
      <div>
        <span className="mb-[24px] block font-mono text-[18px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          {EVENT.cohort} · {EVENT.place}
        </span>
        <h1 className="heading-page m-0 max-w-[1300px] text-balance" style={{ fontSize: 88, lineHeight: 1.02 }}>
          {EVENT.title}
        </h1>
      </div>
      <div className="flex items-end justify-between gap-[48px]">
        <div className="w-[860px]">
          <Join joinPassword={joinPassword} large />
        </div>
        <div className="flex flex-col items-end gap-[6px] text-right">
          {summary.participants > 0 && (
            <span className="font-body text-[28px] text-[var(--color-ink)]">
              <strong className="font-medium tabular-nums">{summary.participants}</strong> joined
            </span>
          )}
          <span className="font-body text-[22px] text-[var(--color-ink-muted)]">With {EVENT.hosts}</span>
        </div>
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

function RateSlide({ summary }: { summary: RunSummary }) {
  const ratings = Math.max(0, ...summary.discussion.scales.flatMap((sc) => sc.categories.map((c) => c.count)));
  return (
    <div className="flex h-full flex-col gap-[20px]">
      <span className="font-body text-[26px] text-[var(--color-ink-secondary)]">
        <strong className="font-medium tabular-nums text-[var(--color-accent)]">{ratings}</strong>{" "}
        {ratings === 1 ? "person has" : "people have"} rated so far
      </span>
      <div className="grid grid-cols-[1.3fr_1fr] items-start gap-[32px]" style={{ zoom: 1.45 }}>
        {summary.discussion.scales.map((sc) => (
          <ScaleCard key={sc.question} scale={sc} />
        ))}
      </div>
    </div>
  );
}

function RevealSlide({ summary }: { summary: RunSummary }) {
  const v = summary.viability;
  if (v.rated === 0) {
    return <p className="m-0 font-body text-[30px] text-[var(--color-ink-muted)]">Results appear here as people rate their answers.</p>;
  }
  return (
    <div className="flex h-full flex-col gap-[24px]">
      <div className="grid grid-cols-3 gap-[24px]">
        <Panel className="py-[24px]">
          <BigStat size={76} value={`${v.right} of ${v.rated}`} label="answers looked right" />
        </Panel>
        <Panel className={`py-[24px] ${v.convincing > 0 ? "border-l-[8px] border-l-[var(--color-error)]" : ""}`}>
          <BigStat
            size={76}
            value={v.convincing}
            label="looked wrong, yet people would act on them"
            tone={v.convincing > 0 ? "bad" : "ink"}
          />
        </Panel>
        <Panel className={`py-[24px] ${v.wouldNotApply > 0 ? "border-l-[8px] border-l-[var(--color-error)]" : ""}`}>
          <BigStat
            size={76}
            value={v.wouldNotApply}
            label={
              v.wouldNotApplyEligible > 0
                ? `would stop a resident from applying. ${v.wouldNotApplyEligible} of them qualify.`
                : "would stop a resident from applying"
            }
            tone={v.wouldNotApply > 0 ? "bad" : "ink"}
          />
        </Panel>
      </div>
      <div className="grid grid-cols-2 gap-[40px]" style={{ zoom: 1.5 }}>
        <div>
          <span className="mb-2 block font-body text-[0.95rem] text-[var(--color-ink)]">Did the answer look right?</span>
          <SplitBar
            parts={[
              { label: "Looks right", count: v.right, color: GOOD },
              { label: "Not sure", count: v.unsure, color: MAYBE },
              { label: "Looks wrong", count: v.wrong, color: BAD },
            ]}
          />
        </div>
        <div>
          <span className="mb-2 block font-body text-[0.95rem] text-[var(--color-ink)]">What would a resident do next?</span>
          <SplitBar
            parts={v.residentActions.map((a) => ({
              label: a.label,
              count: a.count,
              color: { apply: GOOD, "not-apply": BAD, call: "var(--color-ink-secondary)", unsure: MAYBE }[a.id] ?? MAYBE,
            }))}
          />
        </div>
      </div>
      <div className="mt-auto border-t-2 border-[var(--color-accent)] pt-[16px]">
        <Label className="text-[var(--color-accent)]">To discuss</Label>
        <ol className="m-0 grid grid-cols-3 gap-[32px] pl-[28px] font-body text-[22px] leading-snug text-[var(--color-ink)]">
          {DISCUSSION_QUESTIONS.map((q) => (
            <li key={q.id}>{q.label}</li>
          ))}
        </ol>
      </div>
    </div>
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
          of AI answers told a family that qualifies for SNAP they&apos;d get <strong className="font-normal">$0</strong>.
        </p>
        <p className="m-0 font-body text-[24px] text-[var(--color-ink-muted)]">
          {POLICYBENCH.saidZero} of {POLICYBENCH.eligibleAnswers} answers · {POLICYBENCH.models} AI models ·{" "}
          {POLICYBENCH.eligibleHouseholds} households that qualify · PolicyBench, {POLICYBENCH.snapshot}
        </p>
      </div>
    </div>
  );
}

/** At scale, slide 2: the household every model got wrong. */
function ScaleCaseSlide() {
  const az = POLICYBENCH.azCase;
  return (
    <div className="flex h-full flex-col gap-[40px]">
      <p className="m-0 max-w-[1300px] font-body text-[30px] leading-snug text-[var(--color-ink)]">{az.description}</p>
      <div className="grid grid-cols-2 gap-[32px]">
        <Panel className="border-l-[8px] border-l-[var(--color-error)]">
          <Label className="text-[var(--color-error)]">
            {az.modelsSaidZero} of {az.modelsAsked} AI models said
          </Label>
          <span className="font-display font-light leading-none text-[var(--color-error)]" style={{ fontSize: 150 }}>
            $0
          </span>
        </Panel>
        <Panel className="border-l-[8px] border-l-[var(--color-accent)]">
          <Label className="text-[var(--color-accent)]">The rules say</Label>
          <span className="font-display font-light leading-none text-[var(--color-accent)]" style={{ fontSize: 150 }}>
            $24
          </span>
          <span className="ml-[12px] font-body text-[30px] text-[var(--color-ink-secondary)]">a month</span>
        </Panel>
      </div>
      <p className="m-0 font-body text-[26px] leading-snug text-[var(--color-ink-secondary)]">
        Arizona&apos;s expanded categorical eligibility drops the asset test. A wrong $0 tells an eligible person not to
        apply.
      </p>
    </div>
  );
}

/** Shared foundation, slide 1: one set of rules under every tool. */
function FoundationSlide({ summary }: { summary: RunSummary }) {
  const qc = snapQcTotals();
  const answered = summary.sourceOfTruth.reduce((sum, c) => sum + c.count, 0);
  const cannot = summary.sourceOfTruth.filter((c) => c.id !== "yes").reduce((sum, c) => sum + c.count, 0);
  return (
    <div className="flex h-full flex-col gap-[32px]">
      <div className="grid grid-cols-[440px_auto_1fr] items-stretch gap-[28px]">
        <div className="flex flex-col justify-center gap-[12px] rounded-[14px] bg-[var(--color-ink)] p-[36px] text-white">
          <span className="font-mono text-[15px] uppercase tracking-[0.18em] text-white/60">One source of truth</span>
          <span className="font-display text-[40px] font-light leading-tight">One open, validated set of rules</span>
          <span className="font-body text-[22px] text-white/75">Cited to the law. Checked against your manuals.</span>
        </div>
        <span aria-hidden className="self-center font-display text-[64px] text-[var(--color-accent)]">
          →
        </span>
        <ul className="m-0 grid list-none grid-cols-2 gap-[14px] p-0">
          {ONE_SET_OF_RULES.map((use) => (
            <li
              key={use.label}
              className="flex items-center rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[28px] py-[22px] font-body text-[28px] font-medium text-[var(--color-ink)]"
            >
              {use.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto flex flex-col gap-[10px] border-l-[4px] border-[var(--color-accent)] pl-[24px]">
        {answered > 0 && (
          <p className="m-0 font-body text-[26px] text-[var(--color-ink)]">
            In this room, <strong className="font-medium tabular-nums">{cannot}</strong> of{" "}
            <strong className="font-medium tabular-nums">{answered}</strong>{" "}
            can&apos;t fully check an answer against their state&apos;s rules today.
          </p>
        )}
        <p className="m-0 font-body text-[22px] text-[var(--color-ink-secondary)]">
          SNAP benefit math already checks out: we replay USDA&apos;s quality-control cases from{" "}
          {countWord(qc.states)} states ({qc.households.toLocaleString("en-US")} households), and every amount matches.
        </p>
      </div>
    </div>
  );
}

/** Shared foundation, slide 2: what it takes for a state. */
function TiersSlide() {
  const seals = ["#9a6b3f", "#8a9199", "#b7862b"];
  return (
    <div className="flex h-full flex-col gap-[24px]">
      <p className="m-0 font-display text-[40px] font-light text-[var(--color-ink)]">What it takes for a state</p>
      <div className="grid flex-1 grid-cols-3 gap-[24px]">
        {GOLDEN_A.map((tier, i) => (
          <Panel key={tier.tier} className="flex flex-col gap-[18px]">
            <div className="flex items-center gap-[16px]">
              <span
                aria-hidden
                className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full font-display text-[30px] font-semibold text-white"
                style={{ background: seals[i] }}
              >
                A
              </span>
              <div>
                <span className="block font-mono text-[15px] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                  {tier.tier}
                </span>
                <span className="block font-body text-[26px] font-medium text-[var(--color-ink)]">{tier.name}</span>
              </div>
            </div>
            <p className="m-0 font-body text-[21px] leading-snug text-[var(--color-ink)]">{tier.gets}</p>
            <p className="m-0 mt-auto font-body text-[19px] leading-snug text-[var(--color-ink-secondary)]">
              <span className="font-medium text-[var(--color-ink)]">It takes:</span> {tier.takes}
            </p>
          </Panel>
        ))}
      </div>
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

function GroupsSlide({ summary }: { summary: RunSummary }) {
  const ideas = summary.breakouts.notes.slice(0, 6);
  return (
    <div className="grid h-full grid-cols-[1fr_1.3fr] gap-[40px]">
      <p className="m-0 font-display text-[40px] font-light leading-snug text-[var(--color-ink)]">{BREAKOUT_PROMPT}</p>
      {ideas.length === 0 ? (
        <p className="m-0 self-center font-body text-[26px] text-[var(--color-ink-muted)]">
          Ideas appear here as groups share them.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[14px] p-0">
          {ideas.map((n, i) => (
            <li
              key={`${i}-${n.text}`}
              className="rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-[24px] py-[16px] font-body text-[22px] leading-snug text-[var(--color-ink)]"
            >
              <span className="mb-[4px] block font-mono text-[14px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
                {USE_CASES.find((u) => u.id === n.useCase)?.label ?? "Idea"}
              </span>
              <span className="line-clamp-3">{n.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NextSlide({ states }: { states: string[] | null }) {
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
      {states ? (
        <ul className="m-0 mt-auto flex list-none flex-wrap gap-[12px] p-0">
          {states.map((s) => (
            <li key={s} className="rounded-full bg-[var(--color-ink)] px-[24px] py-[10px] font-display text-[30px] font-light text-white">
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 mt-auto font-body text-[28px] text-[var(--color-ink-secondary)]">
          Fill in the short form on your phone at <strong className="font-medium text-[var(--color-accent)]">{EVENT.joinUrl}</strong>.
        </p>
      )}
    </div>
  );
}

function ThankYouSlide() {
  return (
    <div className="flex h-full flex-col justify-center gap-[36px]">
      <h1 className="heading-page m-0" style={{ fontSize: 120, lineHeight: 1 }}>
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
