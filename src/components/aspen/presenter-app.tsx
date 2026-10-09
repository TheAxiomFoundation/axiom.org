"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BREAKOUT_PROMPT,
  DISCUSSION_QUESTIONS,
  EVENT,
  HOUSEHOLDS,
  NEXT_STEPS,
  STAGES,
  USE_CASES,
  stageIndex,
  type StageId,
} from "@/lib/aspen/content";
import type { Control } from "@/lib/aspen/types";
import { EMPTY_SUMMARY, type RunSummary } from "@/lib/aspen/results";
import { postJson, useControl, useResults } from "./client";
import { AnswerFeed, ResultsBoard, ResultsCounts, ScaleCard } from "./results-board";
import { Agenda, FoundationContent, PolicyBenchContent, ThankYouContent } from "./stages";
import { Bars, BUTTON_QUIET, Card, Eyebrow, FIELD } from "./ui";
import { BrandLogo } from "./brand-logo";

/**
 * The big screen at axiom.org/aspen/present. Arrow keys (or the buttons)
 * move the whole room between stages; results refresh every few seconds.
 * The slide area is zoomed so the participant components read from the
 * back of a restaurant.
 */
export function PresenterApp({ joinPassword }: { joinPassword: string | null }) {
  const { data: polled } = useControl(3000);
  const [control, setControl] = useState<Control | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runDraft, setRunDraft] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  // The controls fade out when the mouse rests, so the room sees only the slide.
  const [idle, setIdle] = useState(false);

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
      const next = STAGES[Math.min(STAGES.length - 1, Math.max(0, index + delta))];
      if (next.id !== stage) void move({ stage: next.id });
    },
    [index, stage, move],
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
  const questionLabel = new Map<string, string>(DISCUSSION_QUESTIONS.map((q) => [q.id, q.label]));

  return (
    <div className="relative z-1 flex min-h-screen flex-col bg-[var(--color-paper)]">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-rule)] px-6 py-2.5 transition-opacity duration-500 focus-within:opacity-100 ${idle ? "opacity-0" : "opacity-100"}`}
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
          <button type="button" className={BUTTON_QUIET} onClick={() => step(-1)} aria-label="Previous stage">
            ←
          </button>
          <button type="button" className={BUTTON_QUIET} onClick={() => step(1)} aria-label="Next stage">
            →
          </button>
        </span>
      </div>
      <div aria-hidden className="h-[3px] bg-[var(--color-rule)]">
        <div
          className="h-full bg-[var(--color-accent)] transition-[width] duration-700"
          style={{ width: `${((index + 1) / STAGES.length) * 100}%` }}
        />
      </div>
      {error && <p className="m-0 bg-[var(--color-error)] px-6 py-1.5 font-body text-[0.85rem] text-white">{error}</p>}

      <div className="flex-1 overflow-y-auto px-8 py-10" style={{ zoom: 1.3 }}>
        <div className="mx-auto max-w-[1180px]">
          {stage === "welcome" ? (
            <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr]">
              <div className="flex flex-col gap-6">
                <span className="kicker inline-flex">
                  <span className="kicker-mark">&sect;</span>
                  {EVENT.cohort}
                </span>
                <h1 className="heading-page m-0 text-balance">{EVENT.title}</h1>
                <Card className="flex flex-col gap-2 p-6">
                  <Eyebrow>Join on your phone</Eyebrow>
                  <span className="font-display text-[2.6rem] font-light leading-tight text-[var(--color-accent)]">
                    {EVENT.joinUrl}
                  </span>
                  {joinPassword && (
                    <span className="font-body text-[1.2rem] text-[var(--color-ink)]">
                      Password: <strong className="font-mono">{joinPassword}</strong>
                    </span>
                  )}
                </Card>
                <div className="flex flex-col gap-3">
                  <ResultsCounts summary={summary} />
                </div>
              </div>
              <Card className="p-6">
                <Eyebrow className="mb-2">Tonight · {EVENT.place}</Eyebrow>
                <Agenda live={stage} compact />
              </Card>
            </div>
          ) : (
            <header className="mb-8">
              <span className="kicker mb-4 inline-flex">
                <span className="kicker-mark">&sect;</span>
                {String(index + 1).padStart(2, "0")} · {current.label}
              </span>
              <h1 className="heading-page m-0">{current.title}</h1>
              <p className="m-0 mt-3 max-w-[860px] font-body text-[1.12rem] leading-relaxed text-[var(--color-ink-secondary)]">
                {current.summary}
              </p>
            </header>
          )}

          {stage === "try" && (
            <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
              <div className="flex flex-col gap-4">
                <Card className="p-5">
                  <ResultsCounts summary={summary} />
                </Card>
                <Card className="p-5">
                  <Eyebrow className="mb-3">Households picked</Eyebrow>
                  <Bars items={summary.households} limit={7} />
                </Card>
                <Card className="p-5">
                  <Eyebrow className="mb-2">Join on your phone</Eyebrow>
                  <span className="font-display text-[1.6rem] font-light text-[var(--color-accent)]">{EVENT.joinUrl}</span>
                </Card>
                <button
                  type="button"
                  className="aspen-link self-start font-body text-[0.8rem]"
                  onClick={() => setShowNotes((v) => !v)}
                >
                  {showNotes ? "Hide" : "Show"} presenter notes on the households
                </button>
                {showNotes && (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {HOUSEHOLDS.map((h) => (
                      <li key={h.id} className="font-body text-[0.82rem] text-[var(--color-ink-secondary)]">
                        <strong className="text-[var(--color-ink)]">{h.label}:</strong> {h.why}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <AnswerFeed summary={summary} limit={4} />
            </div>
          )}

          {stage === "rate" && (
            <div className="flex flex-col gap-5">
              <Card className="flex items-baseline gap-4 p-5">
                <span className="font-display text-[3rem] font-light leading-none tabular-nums text-[var(--color-accent)]">
                  {Math.max(0, ...summary.discussion.scales.flatMap((sc) => sc.categories.map((c) => c.count)))}
                </span>
                <span className="font-body text-[1rem] text-[var(--color-ink-secondary)]">ratings in so far</span>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                {summary.discussion.scales.map((sc) => (
                  <ScaleCard key={sc.question} scale={sc} />
                ))}
              </div>
            </div>
          )}

          {stage === "reveal" && (
            <div className="flex flex-col gap-6">
              <ResultsBoard summary={summary} wide />
              <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
                <Card className="flex flex-col gap-3 p-5">
                  <Eyebrow className="text-[var(--color-accent)]">To discuss</Eyebrow>
                  <ol className="m-0 flex flex-col gap-2 pl-5 font-body text-[1.02rem] text-[var(--color-ink)]">
                    {DISCUSSION_QUESTIONS.map((q) => (
                      <li key={q.id}>{q.label}</li>
                    ))}
                  </ol>
                </Card>
                <ul className="m-0 grid list-none content-start gap-2 p-0 sm:grid-cols-2">
                  {summary.discussion.notes.slice(0, 8).map((note, i) => (
                    <li
                      key={`${i}-${note.text}`}
                      className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-2"
                    >
                      <span className="mb-1 block font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                        {questionLabel.get(note.question) ?? "From the room"}
                      </span>
                      <span className="font-body text-[0.95rem] text-[var(--color-ink)]">{note.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {stage === "scale" && <PolicyBenchContent />}

          {stage === "foundation" && (
            <div className="flex flex-col gap-5">
              {summary.checked > 0 && (
                <Card className="p-5">
                  <Eyebrow className="mb-3">
                    {`The room checked ${summary.checked} ${summary.checked === 1 ? "answer" : "answers"} against the rules. Next to the rules, the AI's answer was:`}
                  </Eyebrow>
                  <Bars items={summary.postCheck} empty="Verdicts appear as phones check their answers." />
                </Card>
              )}
              <FoundationContent sourceOfTruth={summary.sourceOfTruth} />
            </div>
          )}

          {stage === "groups" && (
            <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
              <Card className="flex flex-col gap-4 p-5">
                <p className="m-0 font-display text-[1.25rem] font-light leading-snug text-[var(--color-ink)]">
                  {BREAKOUT_PROMPT}
                </p>
                <Bars items={summary.breakouts.useCases} />
              </Card>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {summary.breakouts.notes.slice(0, 8).map((n, i) => (
                  <li
                    key={`${i}-${n.text}`}
                    className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-2 font-body text-[0.95rem]"
                  >
                    <span className="mr-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--color-accent)]">
                      {USE_CASES.find((u) => u.id === n.useCase)?.label ?? "Ideas"}
                    </span>
                    {n.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {stage === "next" && (
            <div className="flex flex-col gap-6">
              <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
                <Card className="flex flex-col gap-5 p-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block font-display text-[3.6rem] font-light leading-none tabular-nums text-[var(--color-accent)]">
                        {summary.pledges.people}
                      </span>
                      <span className="font-body text-[0.9rem] text-[var(--color-ink-muted)]">people</span>
                    </div>
                    <div>
                      <span className="block font-display text-[3.6rem] font-light leading-none tabular-nums text-[var(--color-ink)]">
                        {summary.pledges.states.length}
                      </span>
                      <span className="font-body text-[0.9rem] text-[var(--color-ink-muted)]">states</span>
                    </div>
                  </div>
                  <Bars
                    items={[
                      { id: "ai", label: NEXT_STEPS.options[0].label, count: summary.pledges.accurateAi },
                      { id: "systems", label: NEXT_STEPS.options[1].label, count: summary.pledges.stateSystems },
                    ]}
                  />
                </Card>
                <Card className="flex flex-col justify-center gap-3 p-6">
                  {revealed ? (
                    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                      {summary.pledges.states.map((s) => (
                        <li
                          key={s}
                          className="animate-in fade-in zoom-in-95 rounded-full bg-[var(--color-ink)] px-4 py-2 font-display text-[1.3rem] font-light text-white duration-500"
                        >
                          {s}
                        </li>
                      ))}
                      {summary.pledges.states.length === 0 && (
                        <li className="font-body text-[1rem] text-[var(--color-ink-muted)]">No states yet.</li>
                      )}
                    </ul>
                  ) : (
                    <button
                      type="button"
                      className={`${BUTTON_QUIET} self-center px-6 py-3 text-[1.1rem]`}
                      onClick={() => setRevealed(true)}
                    >
                      Reveal the states going further
                    </button>
                  )}
                </Card>
              </div>
            </div>
          )}

          {stage === "dinner" && <ThankYouContent summary={summary} />}
        </div>
      </div>

      <div
        className={`flex flex-wrap items-center gap-3 border-t border-[var(--color-rule)] px-6 py-2 transition-opacity duration-500 focus-within:opacity-100 ${idle ? "opacity-0" : "opacity-100"}`}
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
              void move({ runId: runDraft, stage: "welcome" });
              setRunDraft("");
              setRevealed(false);
            }
          }}
        >
          Start run
        </button>
      </div>
    </div>
  );
}
