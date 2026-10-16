"use client";

import { useEffect, useRef, useState } from "react";
import {
  AGENCY_COMMENT,
  DISCUSSION_QUESTIONS,
  DISCUSSION_TOPICS,
  RATING_POINTS,
  RATING_SCALES,
  SOURCE_OF_TRUTH,
} from "@/lib/aspen/content";
import { OVERALL_KEY, readStored, sendEvent, writeStored } from "./client";
import { BUTTON, Chip, FIELD, QUESTION, StepFrame } from "./ui";

/** One category on a 1–5 scale: five equal buttons; the ends are labelled once above the list. */
export function ScaleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
      <span className="font-body text-[1rem] text-[var(--color-ink)]">{label}</span>
      <div className="grid grid-cols-5 gap-1.5 sm:w-[14rem]">
        {RATING_POINTS.map((point) => (
          <button
            key={point}
            type="button"
            aria-pressed={value === point}
            aria-label={`${label}: ${point} of 5`}
            onClick={() => onChange(point)}
            className={`rounded-lg border py-2.5 font-body text-[1rem] font-medium tabular-nums transition-colors ${
              value === point
                ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink-secondary)] hover:border-[var(--color-accent)]"
            }`}
          >
            {point}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The questions rated on a scale, in discussion order: how the AI did, then the agency's experience. */
const SCALED = DISCUSSION_QUESTIONS.flatMap((q) => {
  const scale = RATING_SCALES[q.id];
  return scale ? [{ id: q.id, label: scale.title, scale }] : [];
});

/**
 * How AI did overall, and how the agency has found AI so far: asked in Try
 * it, right after the participant rates their own answer. Five short steps,
 * one at a time, with Continue and Back; everything is sent once, at Share,
 * so going back never counts a rating twice. The room's averages feed "What
 * we saw". Each phone shares it once.
 */
export function OverallRating({ stage }: { stage: string }) {
  const [step, setStep] = useState(0);
  const [ratings, setRatings] = useState<Record<string, Record<string, number>>>({});
  const [note, setNote] = useState("");
  // The comment under the agency question: sent with that question, shown only when the presenter chooses.
  const [agencyNote, setAgencyNote] = useState("");
  const [truth, setTruth] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const question = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (readStored<boolean>(OVERALL_KEY)) setDone(true);
  }, []);
  useEffect(() => {
    if (moved.current) question.current?.focus({ preventScroll: true });
  }, [step]);

  if (done) {
    return (
      <p className="m-0 font-body text-[1.02rem] font-medium text-[var(--color-ink)]">
        <span aria-hidden className="mr-1.5 text-[var(--color-success)]">✓</span>
        Your ratings are in. You&apos;ll see the room&apos;s results in What we saw.
      </p>
    );
  }

  const rated = Object.values(ratings).some((r) => Object.keys(r).length > 0);
  const canShare =
    rated || note.trim().length > 0 || agencyNote.trim().length > 0 || truth !== null || topics.length > 0;

  function go(next: number) {
    moved.current = true;
    setStep(next);
  }

  function share() {
    for (const q of SCALED) {
      const scores = ratings[q.id] ?? {};
      const comment = q.id === "experience" ? agencyNote.trim() : "";
      if (Object.keys(scores).length || comment) {
        sendEvent("discussion", { question: q.id, ratings: scores, topics: [], note: comment }, stage);
      }
    }
    if (truth) sendEvent("survey", { question: SOURCE_OF_TRUTH.id, answer: truth }, stage);
    if (topics.length) sendEvent("discussion", { question: "misunderstood", topics, ratings: {}, note: "" }, stage);
    // A note about the session as a whole, not about one scale.
    if (note.trim()) sendEvent("discussion", { question: null, ratings: {}, topics: [], note }, stage);
    writeStored(OVERALL_KEY, true);
    setDone(true);
  }

  const heading = (text: string, hint?: string) => (
    <div className="mb-1">
      <h3 ref={question} tabIndex={-1} className={`${QUESTION} mb-1 outline-none`}>
        {text}
      </h3>
      {hint && <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)]">{hint}</p>}
    </div>
  );
  const scaleStep = (q: (typeof SCALED)[number]) => (
    <>
      {heading(q.label, `1 = ${q.scale.low} · 5 = ${q.scale.high}`)}
      {q.scale.categories.map((c) => (
        <ScaleRow
          key={c.id}
          label={c.label}
          value={ratings[q.id]?.[c.id]}
          onChange={(value) => setRatings((r) => ({ ...r, [q.id]: { ...r[q.id], [c.id]: value } }))}
        />
      ))}
    </>
  );
  const STEPS = 5;
  const next = (
    <button type="button" className={`${BUTTON} w-full py-3`} onClick={() => go(step + 1)}>
      Continue
    </button>
  );

  return (
    <StepFrame at={step + 1} of={STEPS} onBack={step > 0 ? () => go(step - 1) : undefined}>
      {step === 0 && SCALED[0] && (
        <>
          {scaleStep(SCALED[0])}
          {next}
        </>
      )}
      {step === 1 && SCALED[1] && (
        <>
          {scaleStep(SCALED[1])}
          <div className="flex flex-col gap-1.5 font-body text-[1rem] text-[var(--color-ink)]">
            <label htmlFor="agency-comment">{AGENCY_COMMENT.prompt}</label>
            <textarea
              id="agency-comment"
              rows={2}
              maxLength={500}
              value={agencyNote}
              onChange={(e) => setAgencyNote(e.target.value)}
              className={FIELD}
              aria-describedby="agency-comment-hint"
            />
            <span id="agency-comment-hint" className="text-[0.9rem] text-[var(--color-ink-muted)]">
              {AGENCY_COMMENT.hint}
            </span>
          </div>
          {next}
        </>
      )}
      {step === 2 && (
        <>
          {heading(SOURCE_OF_TRUTH.question)}
          <div role="group" aria-label={SOURCE_OF_TRUTH.question} className="grid grid-cols-3 gap-2">
            {SOURCE_OF_TRUTH.options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={truth === o.id}
                onClick={() => setTruth(o.id)}
                className={`rounded-lg border py-3 font-body text-[1rem] transition-colors ${
                  truth === o.id
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                    : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink)] hover:border-[var(--color-accent)]"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {next}
        </>
      )}
      {step === 3 && (
        <>
          {heading(`${DISCUSSION_QUESTIONS.find((q) => q.id === "misunderstood")?.label ?? "Most often misunderstood"}`, "Pick any.")}
          <div role="group" aria-label="Most often misunderstood" className="flex flex-wrap gap-2">
            {DISCUSSION_TOPICS.map((t) => (
              <Chip
                key={t}
                selected={topics.includes(t)}
                onClick={() => setTopics((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]))}
              >
                {t}
              </Chip>
            ))}
          </div>
          {next}
        </>
      )}
      {step === 4 && (
        <>
          <label className="flex flex-col gap-2 font-body text-[1rem] text-[var(--color-ink)]">
            <span ref={question} tabIndex={-1} className={`${QUESTION} mb-0 outline-none`}>
              What should the room hear? <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
            </span>
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={FIELD}
              placeholder="A story, a worry or a surprise from today"
            />
          </label>
          <button type="button" className={`${BUTTON} w-full py-3`} disabled={!canShare} onClick={share}>
            Share my ratings
          </button>
          <span className="font-body text-[0.95rem] text-[var(--color-ink-muted)]">
            The room sees the averages and notes next.
          </span>
        </>
      )}
    </StepFrame>
  );
}
