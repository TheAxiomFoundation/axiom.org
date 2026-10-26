"use client";

import { useEffect, useRef, useState } from "react";
import { EVENT, LOOK_UP, POLICYBENCH, STAGES, isStageId, percent, stageIndex, type StageId } from "@/lib/aspen/content";
import { ChatWindow, type ChatStatus } from "./chat-window";
import { OverallRating } from "./overall-rating";
import { enterRun, participantId, readStored, sendEvent, useControl, useResults, useTabHold, writeStored } from "./client";
import { Agenda, LookUp, NextStepsForm, SmallGroups, ThankYouContent, WelcomeLanding } from "./stages";
import { BUTTON, StageHeading } from "./ui";
import { BrandLogo } from "./brand-logo";
import { TextSizeButton } from "./text-size";

const VIEW_KEY = "aspen.view";

/** Stages whose screens show a number from the room's live results. */
const RESULT_STAGES: readonly StageId[] = ["reveal", "foundation"];

/** The stage a history entry belongs to, if it is one of ours. */
function historyStage(state: unknown): StageId | null {
  const stage = (state as { aspenStage?: unknown } | null)?.aspenStage;
  return isStageId(stage) ? stage : null;
}

/**
 * The participant's page at axiom.org/aspen: a guided run of the session.
 * It follows the presenter's stage (polled from /api/aspen/state) until
 * the participant taps another stage, and keeps the chat mounted across
 * stages so a conversation survives the reveal. Stages the participant
 * opens are browser history entries, so Back returns to the last stage
 * instead of leaving the page.
 */
export function AspenApp() {
  const { data: control, failed: controlFailed } = useControl();
  // One tab at a time keeps the phone's answers, so two tabs never overwrite each other's.
  const { elsewhere, takeBack } = useTabHold();
  const [view, setView] = useState<StageId>("welcome");
  const [follow, setFollow] = useState(true);
  // False until the stored stage is read, so the first render never overwrites it.
  const [hydrated, setHydrated] = useState(false);
  const [tryStatus, setTryStatus] = useState<ChatStatus>({ asked: false, rated: false, current: false });
  // Whether this phone sent the Next steps form in this run.
  const [pledged, setPledged] = useState(false);
  const overall = useRef<HTMLElement>(null);
  const live = control?.live && stageIndex(control.stage) >= 0 ? (control.stage as StageId) : null;
  // Phones never go past the presenter: a later stage opens when the room gets there (the dry run, Oct 25).
  // Until the first poll answers, only Welcome is open, so a phone that just joined can't start ahead of
  // the room (the review of #368). Without a live presenter (no control row), or if the poll fails, every
  // stage stays open.
  const limit = live ? stageIndex(live) : control === null && !controlFailed ? 0 : STAGES.length - 1;
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    participantId();
    const stored = readStored<{ view: StageId; follow: boolean }>(VIEW_KEY, true);
    const saved = stored && stageIndex(stored.view) >= 0 ? stored : null;
    if (saved) {
      setView(saved.view);
      setFollow(saved.follow !== false);
    }
    window.history.replaceState({ aspenStage: saved?.view ?? "welcome" }, "");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeStored(VIEW_KEY, { view, follow }, true);
  }, [hydrated, view, follow]);

  // Back and Forward move between the stages this participant opened.
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const stage = historyStage(event.state);
      if (!stage) return;
      // Forward never carries a phone past the room.
      const to = live && stageIndex(stage) > stageIndex(live) ? live : stage;
      if (to !== stage) window.history.replaceState({ aspenStage: to }, "");
      setView(to);
      setFollow(live === null || to === live);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [live]);

  // Follow the presenter until the participant goes their own way. A move
  // by the room replaces the history entry, so Back skips it. A phone that hasn't
  // sent the Next steps form stays on it when the room moves to Thank you; the
  // banner offers the jump (Pavel, Oct 26). Sending it doesn't move the phone either,
  // so the form's own thank-you stays up.
  useEffect(() => {
    const keepsForm = view === "next" && live === "dinner" && !pledged;
    if (hydrated && follow && live && live !== view && !keepsForm) {
      setView(live);
      window.history.replaceState({ aspenStage: live }, "");
      // A new screen opens at its top, straight away; a smooth scroll can stop short on a phone.
      window.scrollTo?.({ top: 0, behavior: "instant" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, live, follow]);

  // A phone past the room (one opened before phones waited, or the room stepped back) returns to it.
  useEffect(() => {
    if (!hydrated || !live || stageIndex(view) <= stageIndex(live)) return;
    setView(live);
    setFollow(true);
    window.history.replaceState({ aspenStage: live }, "");
    window.scrollTo?.({ top: 0, behavior: "instant" });
  }, [hydrated, live, view]);

  // Once the room catches up with a participant who went ahead, follow it again.
  useEffect(() => {
    if (live && live === view && !follow) setFollow(true);
  }, [live, view, follow]);

  useEffect(() => {
    if (hydrated) sendEvent("stage_view", { stage: view, followed: follow }, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, view]);

  // A new run on the presenter view (after a rehearsal) starts this device
  // clean: the chat and the overall rating remount without the old run's answers, and
  // the page follows the room again. Only a live control row counts, so a
  // database error (which falls back to the default run) never clears a phone.
  const [runEpoch, setRunEpoch] = useState(0);
  useEffect(() => {
    if (!hydrated || !control?.live) return;
    if (enterRun(control.runId)) {
      setRunEpoch((n) => n + 1);
      setFollow(true);
      setPledged(false);
    }
  }, [hydrated, control?.live, control?.runId]);

  const { data: results } = useResults(RESULT_STAGES.includes(view), 5000);
  // TV moments: the phone shows one number from the room or PolicyBench while everyone looks up.
  const viability = results?.summary.viability;
  const truth = results?.summary.sourceOfTruth ?? [];
  const truthAnswered = truth.reduce((sum, c) => sum + c.count, 0);
  const truthCannot = truth.filter((c) => c.id !== "yes").reduce((sum, c) => sum + c.count, 0);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // The stage menu closes on a click outside it, or on Escape (focus returns to its button).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!menuRoot.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function go(stage: StageId) {
    if (stageIndex(stage) > limit) return;
    if (stage !== view) window.history.pushState({ aspenStage: stage }, "");
    setView(stage);
    setFollow(live === null || stage === live);
    setMenuOpen(false);
    // A new screen opens at its top, straight away; a smooth scroll can stop short on a phone.
    window.scrollTo?.({ top: 0, behavior: "instant" });
  }

  const current = STAGES.find((s) => s.id === view) ?? STAGES[0];
  const index = stageIndex(view);
  const nextStage = STAGES[index + 1];
  const prevStage = index > 0 ? STAGES[index - 1] : null;
  // Try it ends with a rated answer: the Next link waits for one. Past that, it waits for the room.
  const mustRate = view === "try" && !tryStatus.rated;
  const waitsForRoom = Boolean(nextStage) && stageIndex(nextStage.id) > limit;
  // One wide frame for every stage; text inside keeps its own reading width.
  const frame = "max-w-[1120px] sm:px-6";
  // Only nudge a participant who fell behind the room; one who went ahead is left alone.
  const behind = live !== null && stageIndex(live) > index;

  if (elsewhere) {
    return (
      <div data-aspen-page className="relative z-1 flex min-h-screen items-center justify-center bg-[var(--color-paper)] px-4">
        <div className="flex max-w-sm flex-col gap-4">
          <h1 className="m-0 font-display text-[1.6rem] font-light leading-tight text-[var(--color-ink)]">This page is open in another tab</h1>
          <p className="m-0 font-body text-[1rem] text-[var(--color-ink-secondary)]">
            Only one tab keeps your answers, so they never overwrite each other. Go back to the other tab, or use this one instead.
          </p>
          <button type="button" className={`${BUTTON} w-full py-3`} onClick={takeBack}>
            Use this tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={top} data-aspen-page className={`relative z-1 min-h-screen bg-[var(--color-paper)] ${view === "welcome" ? "" : "pb-24"}`}>
      <header className="sticky top-0 z-30 bg-[var(--color-paper)]/95 backdrop-blur">
        <div className={`mx-auto flex items-center justify-between gap-3 px-4 py-2.5 ${frame}`}>
          <button
            type="button"
            onClick={() => go("welcome")}
            className="flex shrink-0 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            aria-label="Back to the start"
          >
            <BrandLogo className="h-8" />
            <span aria-hidden className="hidden h-7 w-px bg-[var(--color-rule)] sm:block" />
            <span className="hidden flex-col justify-center gap-0.5 sm:flex">
              <span className="font-body text-[0.82rem] font-medium leading-none text-[var(--color-ink)]">
                Aspen Institute
              </span>
              <span className="font-body font-medium text-[0.82rem] leading-none text-[var(--color-ink-muted)]">
                {EVENT.place} · {EVENT.shortDate}
              </span>
            </span>
          </button>
          <div className="flex min-w-0 items-center gap-2">
          <TextSizeButton />
          <div ref={menuRoot} className="relative min-w-0">
            <button
              ref={menuButton}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="aspen-stages"
              aria-haspopup="true"
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex max-w-full items-center gap-2 whitespace-nowrap rounded-full border py-1.5 pl-3.5 pr-2.5 font-body text-[0.88rem] text-[var(--color-ink)] transition-colors ${
                menuOpen
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                  : "border-[var(--color-rule)] bg-[var(--color-paper-elevated)] hover:border-[var(--color-accent)]"
              }`}
            >
              {/* A long stage name gives way at large text sizes; the logo keeps its place. */}
              <span className="min-w-0 truncate font-medium">{current.label}</span>
              {/* The count steps aside on the narrowest phones; the progress line still shows it. */}
              <span aria-hidden className="hidden h-3.5 w-px bg-[var(--color-rule)] min-[380px]:block" />
              <span className="hidden font-mono text-[0.8rem] tabular-nums text-[var(--color-ink-muted)] min-[380px]:inline">
                {index + 1} of {STAGES.length}
              </span>
              <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${menuOpen ? "rotate-180" : ""}`}>
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {menuOpen && (
              <nav
                id="aspen-stages"
                aria-label="Session"
                className="absolute right-0 top-[calc(100%+0.5rem)] z-40 max-h-[calc(100dvh-5rem)] w-[min(17rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-2 shadow-[0_12px_32px_rgba(28,25,23,0.14)]"
              >
                <span className="block px-2 pb-1 pt-1 font-body font-medium text-[0.82rem] text-[var(--color-ink-muted)]">
                  Agenda
                </span>
                <Agenda live={live} current={view} onPick={go} compact limit={limit} />
              </nav>
            )}
          </div>
          </div>
        </div>
        <div aria-hidden className="h-[2px] bg-[var(--color-rule)]">
          <div
            className="h-full bg-[var(--color-accent)] transition-[width] duration-700"
            style={{ width: `${((index + 1) / STAGES.length) * 100}%` }}
          />
        </div>
        {behind && live && (
          <button
            type="button"
            onClick={() => go(live)}
            className="flex w-full items-center justify-center gap-2 bg-[var(--color-go)] px-4 py-2 font-body text-[0.9rem] font-medium text-white hover:bg-[var(--color-go-hover)]"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {/* Where the room is, not how far this phone got (Michaela, Oct 26). */}
            Jump to where the room is: {STAGES[stageIndex(live)].label}
            <span aria-hidden>→</span>
          </button>
        )}
      </header>

      <div className={`mx-auto px-4 ${frame} ${view === "welcome" ? "" : "pt-8"}`}>
        {view === "welcome" ? (
          <WelcomeLanding onStart={() => go("try")} waiting={stageIndex("try") > limit} />
        ) : (
          <>
            {prevStage && (
              <button
                type="button"
                onClick={() => go(prevStage.id)}
                aria-label={`Back to ${prevStage.label}`}
                className="mb-3 inline-flex items-center gap-1.5 rounded-md font-body text-[1rem] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
              >
                <span aria-hidden>←</span>
                {prevStage.label}
              </button>
            )}
            {/* The thank-you is its own centered page, like the landing. */}
            {view !== "dinner" && <StageHeading title={current.title} summary={current.phoneSummary ?? current.summary} />}
          </>
        )}

        <div hidden={view !== "try"}>
          <ChatWindow
            key={runEpoch}
            stage={view}
            onRateOverall={() => overall.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
            onStatus={setTryStatus}
          />
          {/* Both ratings happen here: the answer first, then two questions about the agency, right below.
              They stay once any answer is rated, so starting over never hides them (Ariel, Oct 23); answered,
              they fold to one line while a new question is under way (Max, Oct 26). */}
          {tryStatus.rated && (
            <section ref={overall} aria-labelledby="aspen-overall" className="mt-12 scroll-mt-20 border-t-2 border-[var(--color-accent)] pt-6">
              <h2 id="aspen-overall" className="m-0 mb-5 font-body text-[1.4rem] font-semibold text-[var(--color-ink)]">
                Two more, about your agency
              </h2>
              <OverallRating key={runEpoch} stage="try" fold={!tryStatus.current} />
            </section>
          )}
        </div>

        {view === "reveal" && (
          <LookUp
            stat={viability && viability.rated > 0 ? `${viability.right} of ${viability.rated}` : null}
            label={viability && viability.rated > 0 ? LOOK_UP.reveal.label : LOOK_UP.reveal.empty}
          />
        )}
        {view === "scale" && (
          <LookUp stat={`${percent(POLICYBENCH.saidZero, POLICYBENCH.eligibleAnswers)}%`} label={LOOK_UP.scale.label} />
        )}
        {view === "foundation" && (
          <LookUp
            stat={truthAnswered > 0 ? `${truthCannot} of ${truthAnswered}` : null}
            label={truthAnswered > 0 ? LOOK_UP.foundation.label : LOOK_UP.foundation.empty}
          />
        )}
        {view === "groups" && <SmallGroups key={runEpoch} stage={view} />}
        {/* Mounted for the whole run, like Try it, so a move away and back keeps what was typed. */}
        <div hidden={view !== "next"}>
          <NextStepsForm key={runEpoch} onSent={() => setPledged(true)} />
        </div>
        {view === "dinner" && <ThankYouContent onReturn={() => go("try")} />}

        {nextStage && view !== "welcome" && (
          <button
            type="button"
            onClick={() => go(nextStage.id)}
            disabled={mustRate || waitsForRoom}
            className="group mt-12 flex w-full items-center justify-between gap-4 rounded-xl bg-[var(--color-go)] px-5 py-4 text-left text-white shadow-[0_2px_8px_rgba(28,25,23,0.18)] transition-colors hover:bg-[var(--color-go-hover)] disabled:cursor-not-allowed disabled:border-2 disabled:border-dashed disabled:border-[var(--color-rule-strong)] disabled:bg-[var(--color-paper)] disabled:text-[var(--color-ink)] disabled:shadow-none"
          >
            {/* A filled button, not a link: on a phone it is the one thing to do once the stage is done. */}
            <span className="min-w-0">
              <span className="block font-body text-[0.9rem] font-medium text-white/85 group-disabled:text-[var(--color-ink)]">
                {!mustRate && waitsForRoom ? "Up next, when the room gets there" : "Next"}
              </span>
              <span className="block font-body text-[1.15rem] font-semibold leading-snug">
                {mustRate ? "Rate your answer to continue" : nextStage.title}
              </span>
            </span>
            <span aria-hidden className="font-display text-[1.8rem] leading-none transition-transform group-hover:translate-x-1 group-disabled:hidden">
              →
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
