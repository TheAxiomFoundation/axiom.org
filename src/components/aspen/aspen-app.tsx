"use client";

import { useEffect, useRef, useState } from "react";
import { EVENT, STAGES, findHousehold, isStageId, stageIndex, type StageId } from "@/lib/aspen/content";
import { CHAT_KEY, ChatWindow, type ChatStatus, type SavedChat } from "./chat-window";
import { OverallRating } from "./overall-rating";
import { enterRun, participantId, readStored, sendEvent, useControl, useResults, writeStored } from "./client";
import { ResultsBoard } from "./results-board";
import {
  Agenda,
  FoundationContent,
  GroupsCard,
  NextStepsForm,
  PolicyBenchContent,
  ThankYouContent,
  VoteCard,
  WelcomeLanding,
  YourThread,
  type ThreadQuestion,
} from "./stages";
import { StageHeading } from "./ui";
import { BrandLogo } from "./brand-logo";

const VIEW_KEY = "aspen.view";

/** The participant's question from Try it, read back from the chat's saved state. */
function readThread(): ThreadQuestion | null {
  const saved = readStored<SavedChat>(CHAT_KEY);
  if (!saved || !Array.isArray(saved.turns)) return null;
  const firstUser = saved.turns.find((t) => t.role === "user");
  const household = firstUser && saved.householdId !== "own" ? findHousehold(saved.householdId) : undefined;
  return {
    householdId: household?.id ?? null,
    householdLabel: household?.label ?? null,
    perspective: saved.perspective ?? null,
    asked: saved.turns.some((t) => t.role === "assistant" && t.status === "done"),
    rated: (saved.rated ?? []).length > 0,
  };
}

/** Stages whose screens show the room's live results. */
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
  const { data: control } = useControl();
  const [view, setView] = useState<StageId>("welcome");
  const [follow, setFollow] = useState(true);
  // False until the stored stage is read, so the first render never overwrites it.
  const [hydrated, setHydrated] = useState(false);
  const [tryStatus, setTryStatus] = useState<ChatStatus>({ asked: false, rated: false });
  const live = control?.live && stageIndex(control.stage) >= 0 ? (control.stage as StageId) : null;
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
      setView(stage);
      setFollow(live === null || stage === live);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [live]);

  // Follow the presenter until the participant goes their own way. A move
  // by the room replaces the history entry, so Back skips it.
  useEffect(() => {
    if (hydrated && follow && live && live !== view) {
      setView(live);
      window.history.replaceState({ aspenStage: live }, "");
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, live, follow]);

  // Once the room catches up with a participant who went ahead, follow it again.
  useEffect(() => {
    if (live && live === view && !follow) setFollow(true);
  }, [live, view, follow]);

  useEffect(() => {
    if (hydrated) sendEvent("stage_view", { stage: view, followed: follow }, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, view]);

  // A new run on the presenter view (after a rehearsal) starts this device
  // clean: the chat and Rate it remount without the old run's answers, and
  // the page follows the room again. Only a live control row counts, so a
  // database error (which falls back to the default run) never clears a phone.
  const [runEpoch, setRunEpoch] = useState(0);
  useEffect(() => {
    if (!hydrated || !control?.live) return;
    if (enterRun(control.runId)) {
      setRunEpoch((n) => n + 1);
      setFollow(true);
    }
  }, [hydrated, control?.live, control?.runId]);

  const { data: results } = useResults(RESULT_STAGES.includes(view), 5000);
  const [thread, setThread] = useState<ThreadQuestion | null>(null);
  useEffect(() => {
    setThread(readThread());
  }, [view, runEpoch]);

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
    if (stage !== view) window.history.pushState({ aspenStage: stage }, "");
    setView(stage);
    setFollow(live === null || stage === live);
    setMenuOpen(false);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  // "A shared foundation" unlocks the rules check. Without a live presenter it is always open.
  const rulesUnlocked = live === null || stageIndex(live) >= stageIndex("foundation");
  const current = STAGES.find((s) => s.id === view) ?? STAGES[0];
  const index = stageIndex(view);
  const nextStage = STAGES[index + 1];
  // Try it ends with a rated answer: the Next link waits for one.
  const mustRate = view === "try" && !tryStatus.rated;
  // One wide frame for every stage; text inside keeps its own reading width.
  const frame = "max-w-[1120px] sm:px-6";
  // Only nudge a participant who fell behind the room; one who went ahead is left alone.
  const behind = live !== null && stageIndex(live) > index;

  return (
    <div ref={top} data-aspen-page className={`relative z-1 min-h-screen bg-[var(--color-paper)] ${view === "welcome" ? "" : "pb-24"}`}>
      <header className="sticky top-0 z-30 bg-[var(--color-paper)]/95 backdrop-blur">
        <div className={`mx-auto flex items-center justify-between gap-3 px-4 py-2.5 ${frame}`}>
          <button
            type="button"
            onClick={() => go("welcome")}
            className="flex items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            aria-label="Back to the start"
          >
            <BrandLogo className="h-8" />
            <span aria-hidden className="hidden h-7 w-px bg-[var(--color-rule)] sm:block" />
            <span className="hidden flex-col justify-center gap-0.5 sm:flex">
              <span className="font-body text-[0.82rem] font-medium leading-none text-[var(--color-ink)]">
                Aspen Institute
              </span>
              <span className="font-mono text-[0.58rem] uppercase leading-none tracking-[0.14em] text-[var(--color-ink-muted)]">
                {EVENT.place} · {EVENT.shortDate}
              </span>
            </span>
          </button>
          <div ref={menuRoot} className="relative">
            <button
              ref={menuButton}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="aspen-stages"
              aria-haspopup="true"
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-full border py-1.5 pl-3 pr-2.5 font-body text-[0.88rem] text-[var(--color-ink)] transition-colors ${
                menuOpen
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                  : "border-[var(--color-rule)] bg-[var(--color-paper-elevated)] hover:border-[var(--color-accent)]"
              }`}
            >
              <span className="font-mono text-[0.72rem] tabular-nums text-[var(--color-ink-muted)]">
                {index + 1}/{STAGES.length}
              </span>
              {current.label}
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
                <span className="block px-2 pb-1 pt-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                  Agenda
                </span>
                <Agenda live={live} current={view} onPick={go} compact />
              </nav>
            )}
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
            className="flex w-full items-center justify-center gap-2 bg-[var(--color-accent)] px-4 py-2 font-body text-[0.9rem] text-white"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            The room has moved on to {STAGES[stageIndex(live)].label}
            <span aria-hidden>→</span>
          </button>
        )}
      </header>

      <div className={`mx-auto px-4 ${frame} ${view === "welcome" ? "" : "pt-8"}`}>
        {view === "welcome" ? (
          <WelcomeLanding onStart={() => go("try")} />
        ) : (
          <>
            <StageHeading title={current.title} summary={current.summary} />
            <YourThread stage={view} thread={thread} onOpen={() => go("try")} />
          </>
        )}

        <div hidden={view !== "try"}>
          <ChatWindow
            key={runEpoch}
            stage={view}
            rulesUnlocked={rulesUnlocked}
            onRateOverall={() => go("rate")}
            onStatus={setTryStatus}
          />
        </div>

        {view === "rate" && <OverallRating key={runEpoch} stage={view} />}

        {view === "reveal" &&
          (results ? (
            <ResultsBoard summary={results.summary} />
          ) : (
            <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)]">Loading the room&apos;s results…</p>
          ))}

        {view === "scale" && <PolicyBenchContent />}
        {view === "foundation" && <FoundationContent sourceOfTruth={results?.summary.sourceOfTruth} />}
        {view === "vote" && <VoteCard key={runEpoch} stage={view} />}
        {view === "groups" && <GroupsCard stage={view} />}
        {view === "next" && <NextStepsForm />}
        {view === "dinner" && <ThankYouContent />}

        {nextStage && view !== "welcome" && (
          <button
            type="button"
            onClick={() => go(nextStage.id)}
            disabled={mustRate}
            className="group mt-16 flex w-full items-center justify-between gap-4 border-t-2 border-[var(--color-accent)] pt-4 text-left disabled:cursor-not-allowed disabled:border-[var(--color-rule)]"
          >
            <span>
              <span className="block font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--color-accent)] group-disabled:text-[var(--color-ink-muted)]">
                Next
              </span>
              <span className="block font-body text-[1.08rem] text-[var(--color-ink)] group-hover:text-[var(--color-accent)] group-disabled:text-[var(--color-ink-muted)]">
                {mustRate ? "Rate your answer to continue" : nextStage.title}
              </span>
            </span>
            <span
              aria-hidden
              className="font-display text-[1.4rem] text-[var(--color-accent)] transition-transform group-hover:translate-x-1 group-disabled:text-[var(--color-ink-muted)]"
            >
              →
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
