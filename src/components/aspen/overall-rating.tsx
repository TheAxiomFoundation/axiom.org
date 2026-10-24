"use client";

import { useEffect, useRef, useState } from "react";
import { AGENCY_COMMENT, RATING_POINTS, RATING_SCALES, SOURCE_OF_TRUTH } from "@/lib/aspen/content";
import { OVERALL_KEY, nextRev, participantId, readStored, saveJson, saveMark, writeStored } from "./client";
import { BUTTON_QUIET, FIELD, QUESTION } from "./ui";

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

/** What this phone has answered so far, kept for the run so a reload shows it. */
export interface OverallAnswers {
  truth?: string;
  agency?: Record<string, number>;
  comment?: string;
  /** By kind, whether the latest save is still unconfirmed, so a reload still asks for the tap again. */
  unsaved?: Record<string, boolean>;
  /** A removed comment the store hasn't confirmed, so its button stays until it does. */
  removing?: boolean;
  /** By kind, the latest save's saveMark: another tab on the phone may have saved since, and only its own answer may mark the kind saved. */
  pending?: Record<string, string>;
}

/** Merges into this phone's stored answers. */
function remember(patch: Partial<OverallAnswers>) {
  const stored = readStored<OverallAnswers>(OVERALL_KEY);
  writeStored(OVERALL_KEY, { ...(stored && typeof stored === "object" ? stored : {}), ...patch });
}

const AGENCY = RATING_SCALES.experience;

/**
 * One short screen after the participant rates their answer: whether anyone
 * can check an answer against the state's rules today (it feeds Shared
 * foundation), and how AI is doing in their agency, 1–5 for residents, staff
 * and them, with an optional comment (What we saw). Every tap saves straight
 * away and a later tap replaces it (the results count each person's latest
 * answer), so nothing waits for a last button and nothing is lost when the
 * room moves on.
 */
export function OverallRating({ stage }: { stage: string }) {
  const [answers, setAnswers] = useState<OverallAnswers>({});
  const [comment, setComment] = useState("");
  // By kind: the truth answer (survey) and the agency rating (discussion) save as separate events,
  // so each clears only when that kind saves again, and a later rating never hides a failed truth answer.
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [removing, setRemoving] = useState(false);
  // By kind, whether this tab's latest send is still on its way.
  const [sending, setSending] = useState<Record<string, boolean>>({});
  // Sends go one after another, and each carries its tap's stamp, so a slow earlier tap never counts as the latest.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // By kind, this tab's latest send: only it decides whether the kind is saved.
  const latest = useRef<Record<string, string>>({});

  useEffect(() => {
    const stored = readStored<OverallAnswers>(OVERALL_KEY);
    if (stored && typeof stored === "object") {
      const { unsaved, removing: wasRemoving, pending: _pending, ...rest } = stored;
      setAnswers(rest);
      setComment(rest.comment ?? "");
      // A save that never confirmed before the reload still asks for the tap again.
      if (unsaved && typeof unsaved === "object") setFailed(Object.fromEntries(Object.entries(unsaved).filter(([, v]) => v === true)));
      setRemoving(wasRemoving === true);
    }
  }, []);

  function keep(next: OverallAnswers) {
    setAnswers(next);
    remember(next);
  }

  function send(kind: string, payload: Record<string, unknown>) {
    const rev = nextRev();
    const mark = saveMark(rev);
    latest.current[kind] = mark;
    setSending((s) => ({ ...s, [kind]: true }));
    const stored = readStored<OverallAnswers>(OVERALL_KEY);
    remember({ unsaved: { ...stored?.unsaved, [kind]: true }, pending: { ...stored?.pending, [kind]: mark } });
    queue.current = queue.current.then(async () => {
      const ok = await saveJson("/api/aspen/event", { participantId: participantId(), kind, payload: { ...payload, rev }, stage });
      if (latest.current[kind] !== mark) return; // A later tap of this kind is on its way and decides.
      setSending((s) => ({ ...s, [kind]: false }));
      setFailed((f) => ({ ...f, [kind]: !ok }));
      // Every agency save carries the comment, so any saved one confirms a removal.
      if (ok && kind === "discussion") setRemoving(false);
      // Another tab may have saved this kind since: then the phone keeps that tab's state, not this one.
      const now = readStored<OverallAnswers>(OVERALL_KEY);
      if (now?.pending?.[kind] !== mark) return;
      remember({ unsaved: { ...now.unsaved, [kind]: !ok }, ...(ok && kind === "discussion" ? { removing: false } : {}) });
    });
  }

  function pickTruth(answer: string) {
    keep({ ...answers, truth: answer });
    send("survey", { question: SOURCE_OF_TRUTH.id, answer });
  }

  /** The agency rating and its comment go together, so the latest event carries both. */
  function sendAgency(agency: Record<string, number>, note: string) {
    send("discussion", { question: "experience", ratings: agency, topics: [], note });
  }

  function rate(category: string, score: number) {
    const agency = { ...answers.agency, [category]: score };
    keep({ ...answers, agency });
    sendAgency(agency, answers.comment ?? "");
  }

  /** Saves the box as it is; an empty box takes back a comment saved earlier. */
  function saveComment() {
    const note = comment.trim();
    if (!note && (answers.comment || removing)) {
      setRemoving(true);
      remember({ removing: true });
    }
    keep({ ...answers, comment: note });
    sendAgency(answers.agency ?? {}, note);
  }

  const savedComment = answers.comment ?? "";
  const commentChanged = comment.trim() !== savedComment;
  // A failed agency save may have carried the comment, so it can be sent again, unless that's already on its way.
  const commentPending = commentChanged || (failed.discussion === true && !sending.discussion);
  const anyFailed = Object.values(failed).some(Boolean);
  const done =
    Boolean(answers.truth) && (AGENCY?.categories.every((c) => answers.agency?.[c.id] !== undefined) ?? false);

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="m-0 border-0 p-0">
        <legend className={`${QUESTION} mb-3`}>{SOURCE_OF_TRUTH.question}</legend>
        <div className="grid grid-cols-3 gap-2">
          {SOURCE_OF_TRUTH.options.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={answers.truth === o.id}
              onClick={() => pickTruth(o.id)}
              className={`rounded-lg border py-3 font-body text-[1rem] transition-colors ${
                answers.truth === o.id
                  ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                  : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink)] hover:border-[var(--color-accent)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      {AGENCY && (
        <fieldset className="m-0 flex flex-col gap-3 border-0 border-t border-[var(--color-rule)] p-0 pt-5">
          <legend className={`${QUESTION} float-left mb-0 w-full`}>{AGENCY.title}</legend>
          <p className="clear-left m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)]">
            1 = {AGENCY.low} · 5 = {AGENCY.high}
          </p>
          {AGENCY.categories.map((c) => (
            <ScaleRow key={c.id} label={c.label} value={answers.agency?.[c.id]} onChange={(score) => rate(c.id, score)} />
          ))}
          <div className="flex flex-col gap-1.5 font-body text-[1rem] text-[var(--color-ink)]">
            <label htmlFor="agency-comment">
              {AGENCY_COMMENT.prompt} <span className="text-[var(--color-ink-muted)]">(optional)</span>
            </label>
            <textarea
              id="agency-comment"
              rows={2}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className={FIELD}
              aria-describedby="agency-comment-hint"
            />
            <span id="agency-comment-hint" className="text-[0.9rem] text-[var(--color-ink-muted)]">
              {AGENCY_COMMENT.hint}
            </span>
            {/* A removal that didn't save keeps its button, so it can be tapped again. */}
            {(commentChanged || savedComment || removing) && (
              <button type="button" className={`${BUTTON_QUIET} self-start`} disabled={!commentPending} onClick={saveComment}>
                {commentPending
                  ? comment.trim()
                    ? "Save comment"
                    : "Remove comment"
                  : sending.discussion
                    ? savedComment
                      ? "Saving…"
                      : "Removing…"
                    : savedComment
                      ? "Comment saved"
                      : "Comment removed"}
              </button>
            )}
          </div>
        </fieldset>
      )}
      <p role="status" className="m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)]">
        {anyFailed ? (
          <span className="text-[var(--color-error)]">That didn&apos;t save. Tap it again.</span>
        ) : done ? (
          <>
            <span aria-hidden className="mr-1.5 text-[var(--color-success)]">✓</span>
            Saved. You&apos;ll see the room&apos;s results on the screen.
          </>
        ) : (
          "Each answer saves as you tap it."
        )}
      </p>
    </div>
  );
}
