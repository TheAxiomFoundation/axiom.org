"use client";

import { useEffect, useState } from "react";
import {
  AGENCY_COMMENT,
  DISCUSSION_QUESTIONS,
  DISCUSSION_TOPICS,
  RATING_POINTS,
  RATING_SCALES,
  SOURCE_OF_TRUTH,
} from "@/lib/aspen/content";
import { OVERALL_KEY, readStored, sendEvent, writeStored } from "./client";
import { BUTTON, Chip, FIELD } from "./ui";

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
      <span className="font-body text-[0.9rem] text-[var(--color-ink)]">{label}</span>
      <div className="grid grid-cols-5 gap-1 sm:w-[10rem]">
        {RATING_POINTS.map((point) => (
          <button
            key={point}
            type="button"
            aria-pressed={value === point}
            aria-label={`${label}: ${point} of 5`}
            onClick={() => onChange(point)}
            className={`rounded-md border py-1.5 font-mono text-[0.8rem] tabular-nums transition-colors ${
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
 * it, right after the participant rates their own answer, so both ratings
 * happen in one place. The room's averages feed "What we saw". Each phone
 * shares it once.
 */
export function OverallRating({ stage }: { stage: string }) {
  const [ratings, setRatings] = useState<Record<string, Record<string, number>>>({});
  const [note, setNote] = useState("");
  // The comment under the agency question: sent with that question, shown only when the presenter chooses.
  const [agencyNote, setAgencyNote] = useState("");
  const [truth, setTruth] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (readStored<boolean>(OVERALL_KEY)) setDone(true);
  }, []);

  if (done) {
    return (
      <p className="m-0 font-body text-[1.02rem] text-[var(--color-ink)]">
        <span aria-hidden className="mr-1.5 text-[var(--color-success)]">✓</span>
        Your ratings are in. You&apos;ll see the room&apos;s results in What we saw.
      </p>
    );
  }

  const rated = Object.values(ratings).some((r) => Object.keys(r).length > 0);
  const canShare =
    rated || note.trim().length > 0 || agencyNote.trim().length > 0 || truth !== null || topics.length > 0;

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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
      {SCALED.map((q) => (
        <section key={q.id} className="flex flex-col gap-3 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 sm:p-5">
          <div>
            <h3 className="m-0 font-body text-[0.92rem] font-medium text-[var(--color-ink)]">{q.label}</h3>
            <p className="m-0 mt-1 font-body font-medium text-[0.82rem] text-[var(--color-ink-muted)]">
              1 = {q.scale.low} · 5 = {q.scale.high}
            </p>
          </div>
          {q.scale.categories.map((c) => (
            <ScaleRow
              key={c.id}
              label={c.label}
              value={ratings[q.id]?.[c.id]}
              onChange={(value) => setRatings((r) => ({ ...r, [q.id]: { ...r[q.id], [c.id]: value } }))}
            />
          ))}
          {q.id === "experience" && (
            <div className="mt-1 flex flex-col gap-1.5 font-body text-[0.88rem] text-[var(--color-ink)]">
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
              <span id="agency-comment-hint" className="text-[0.8rem] text-[var(--color-ink-muted)]">
                {AGENCY_COMMENT.hint}
              </span>
            </div>
          )}
        </section>
      ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 sm:p-5">
          <div>
            <h3 className="m-0 font-body text-[0.92rem] font-medium text-[var(--color-ink)]">{SOURCE_OF_TRUTH.title}</h3>
            <p className="m-0 mt-1 font-body text-[0.88rem] text-[var(--color-ink-secondary)]">{SOURCE_OF_TRUTH.question}</p>
          </div>
          <div role="group" aria-label={SOURCE_OF_TRUTH.question} className="grid grid-cols-3 gap-2">
            {SOURCE_OF_TRUTH.options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={truth === o.id}
                onClick={() => setTruth(o.id)}
                className={`rounded-lg border py-2.5 font-body text-[0.88rem] transition-colors ${
                  truth === o.id
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                    : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink)] hover:border-[var(--color-accent)]"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 sm:p-5">
          <div>
            <h3 className="m-0 font-body text-[0.92rem] font-medium text-[var(--color-ink)]">Most often misunderstood</h3>
            <p className="m-0 mt-1 font-body text-[0.88rem] text-[var(--color-ink-secondary)]">
              {DISCUSSION_QUESTIONS.find((q) => q.id === "misunderstood")?.label} Pick any.
            </p>
          </div>
          <div role="group" aria-label="Most often misunderstood" className="flex flex-wrap gap-1.5">
            {DISCUSSION_TOPICS.map((t) => (
              <Chip
                key={t}
                selected={topics.includes(t)}
                onClick={() => setTopics((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]))}
                className="px-3 py-1 text-[0.82rem]"
              >
                {t}
              </Chip>
            ))}
          </div>
        </section>
      </div>
      <label className="flex max-w-[760px] flex-col gap-2 font-body text-[0.92rem] text-[var(--color-ink)]">
        <span>
          What should the room hear? <span className="text-[var(--color-ink-muted)]">(optional)</span>
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <button type="button" className={`${BUTTON} w-full py-3 sm:w-auto sm:px-8`} disabled={!canShare} onClick={share}>
          Share my ratings
        </button>
        <span className="font-body text-[0.84rem] text-[var(--color-ink-muted)]">
          Rate what you like. The room sees the averages and notes next.
        </span>
      </div>
    </div>
  );
}
