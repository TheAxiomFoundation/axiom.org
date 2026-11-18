"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RESIDENT_ACTIONS, VERDICTS, WENT_WELL, WENT_WRONG } from "@/lib/aspen/content";
import { RATING_KEY, nextRev, participantId, readStored, saveJson, saveMark, writeStored } from "./client";
import { BUTTON, Chip, FIELD, QUESTION, StepFrame } from "./ui";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** What one rating holds; each save sends all of it, so the latest save is the whole rating. */
interface Rating {
  verdict: string | null;
  residentAction: string | null;
  wentWell: string[];
  wentWrong: string[];
  note: string;
}

const EMPTY_RATING: Rating = { verdict: null, residentAction: null, wentWell: [], wentWrong: [], note: "" };

/** A card in progress, kept on the phone so a reloaded tab reopens it where it was. */
interface RatingDraft {
  rating: Rating;
  step: number;
  /** The latest save isn't confirmed, so a reloaded card still asks for the tap again. */
  unsaved?: boolean;
  /** That save's saveMark: another tab on the phone may have saved this card since, and only its own answer may mark it saved. */
  pending?: string;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** This prompt's saved draft, if the phone has a readable one. */
export function readRatingDraft(promptId: string): RatingDraft | null {
  const all = readStored<Record<string, unknown>>(RATING_KEY);
  const raw = all && typeof all === "object" ? (all[promptId] as Partial<{ rating: Record<string, unknown>; step: unknown; unsaved: unknown; pending: unknown }>) : null;
  if (!raw || typeof raw !== "object" || !raw.rating || typeof raw.rating !== "object") return null;
  const r = raw.rating;
  return {
    rating: {
      verdict: stringOrNull(r.verdict),
      residentAction: stringOrNull(r.residentAction),
      wentWell: strings(r.wentWell),
      wentWrong: strings(r.wentWrong),
      note: typeof r.note === "string" ? r.note : "",
    },
    step: raw.step === 1 && typeof r.verdict === "string" ? 1 : 0,
    unsaved: raw.unsaved === true,
    ...(typeof raw.pending === "string" ? { pending: raw.pending } : {}),
  };
}

function writeRatingDraft(promptId: string, draft: RatingDraft) {
  const all = readStored<Record<string, unknown>>(RATING_KEY);
  writeStored(RATING_KEY, { ...(all && typeof all === "object" ? all : {}), [promptId]: draft });
}

/**
 * How the participant rates one chatbot answer, in two short steps: does it
 * look right (with what went well or wrong, and a note, all optional, on the
 * same screen), then what a resident would do next. Every tap saves straight
 * away and a later tap replaces it, in the order tapped, so nothing is lost
 * when the room moves on. Focus follows the question, so a screen reader
 * reads each one as it appears.
 */
export function RatingCard({ promptId, onRated }: { promptId: string; onRated?: () => void }) {
  const [step, setStep] = useState(0);
  const [rating, setRating] = useState<Rating>(EMPTY_RATING);
  // The last rating sent; every save carries the whole rating, so a later one also carries the note.
  const sent = useRef<Rating | null>(null);
  const [failed, setFailed] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const question = useRef<HTMLLegendElement>(null);
  const moved = useRef(false);
  // Saves go one after another, and each carries its tap's stamp, so a slow earlier tap never replaces a later one.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // This tab's latest save, and whether it's unconfirmed: what the draft keeps for a reload.
  const latest = useRef("");
  const unsaved = useRef(false);

  // A reloaded tab (a locked phone often drops it) reopens the card where it was,
  // so the next tap doesn't save an empty rating over the one already saved,
  // and a save that never confirmed still asks for the tap again.
  useEffect(() => {
    const restored = readRatingDraft(promptId);
    if (!restored) return;
    latest.current = restored.pending ?? "";
    unsaved.current = restored.unsaved === true;
    setRating(restored.rating);
    setStep(restored.step);
    setFailed(unsaved.current);
  }, [promptId]);

  useEffect(() => {
    // Not on first render: only once the participant has moved between steps.
    if (moved.current) question.current?.focus({ preventScroll: true });
  }, [step]);

  /** Shows and keeps the card's state; every change goes through here. */
  function keep(nextRating: Rating, nextStep: number) {
    setRating(nextRating);
    setStep(nextStep);
    writeRatingDraft(promptId, { rating: nextRating, step: nextStep, unsaved: unsaved.current, ...(latest.current ? { pending: latest.current } : {}) });
  }

  function go(next: number) {
    moved.current = true;
    keep(rating, next);
  }

  /** Saves the whole rating with `patch` applied; the server needs a verdict first. */
  function save(patch: Partial<Rating>, then?: () => void) {
    const next = { ...rating, ...patch };
    if (!next.verdict) {
      keep(next, step);
      return;
    }
    const rev = nextRev();
    const mark = saveMark(rev);
    latest.current = mark;
    unsaved.current = true;
    keep(next, step);
    sent.current = next;
    queue.current = queue.current.then(async () => {
      const ok = await saveJson("/api/aspen/rate", {
        participantId: participantId(),
        promptId,
        verdict: next.verdict,
        residentAction: next.residentAction,
        wentWell: next.wentWell,
        wentWrong: next.wentWrong,
        note: next.note,
        rev,
      });
      if (latest.current !== mark) return; // A later tap is on its way and decides, and moves on if it saves.
      setFailed(!ok);
      unsaved.current = !ok;
      // Another tab may have saved this card since: then the phone keeps that tab's answer, not this one.
      const stored = readRatingDraft(promptId);
      if (stored?.pending === mark) writeRatingDraft(promptId, { ...stored, unsaved: !ok });
      if (ok) then?.();
    });
  }

  const { verdict, residentAction, wentWell, wentWrong, note } = rating;
  const praise = verdict === "right";
  const firstTags = praise ? WENT_WELL : WENT_WRONG;
  const otherTags = praise ? WENT_WRONG : WENT_WELL;
  const firstKey = praise ? "wentWell" : "wentWrong";
  const otherKey = praise ? "wentWrong" : "wentWell";
  const noteSaved = sent.current?.note === note.trim();
  const legend = (text: ReactNode) => (
    <legend ref={question} tabIndex={-1} className={`${QUESTION} outline-none`}>
      {text}
    </legend>
  );

  return (
    <StepFrame title="Rate this answer" at={step + 1} of={2} onBack={step > 0 ? () => go(step - 1) : undefined}>
      {step === 0 && (
        <>
          <fieldset className="m-0 border-0 p-0">
            {legend("Does it look right?")}
            <div className="grid grid-cols-3 gap-2">
              {VERDICTS.map((v) => (
                <Segment key={v.id} selected={verdict === v.id} onClick={() => save({ verdict: v.id })}>
                  {v.label}
                </Segment>
              ))}
            </div>
          </fieldset>
          {verdict && (
            <>
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-2 font-body text-[1rem] font-semibold text-[var(--color-ink)]">
                  {praise ? "What went well?" : "What went wrong?"}{" "}
                  <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {firstTags.map((tag) => (
                    <Chip key={tag} selected={rating[firstKey].includes(tag)} onClick={() => save({ [firstKey]: toggle(rating[firstKey], tag) })}>
                      {tag}
                    </Chip>
                  ))}
                </div>
                {showOther ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {otherTags.map((tag) => (
                      <Chip key={tag} selected={rating[otherKey].includes(tag)} onClick={() => save({ [otherKey]: toggle(rating[otherKey], tag) })}>
                        {tag}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="aspen-link mt-3 font-body text-[0.95rem]" onClick={() => setShowOther(true)}>
                    {praise ? "Something went wrong too?" : "Something went well too?"}
                  </button>
                )}
              </fieldset>
              <label className="flex flex-col gap-2 font-body text-[1rem] text-[var(--color-ink)]">
                <span>
                  Anything the room should know about this answer? <span className="text-[var(--color-ink-muted)]">(optional)</span>
                </span>
                <textarea
                  rows={2}
                  value={note}
                  maxLength={1000}
                  onChange={(e) => keep({ ...rating, note: e.target.value }, step)}
                  className={FIELD}
                  placeholder="What would you tell the resident?"
                />
              </label>
              <button
                type="button"
                className={`${BUTTON} w-full py-3`}
                onClick={() => {
                  moved.current = true;
                  if (!noteSaved) save({ note: note.trim() });
                  keep({ ...rating, note: noteSaved ? note : note.trim() }, 1);
                }}
              >
                Next
              </button>
            </>
          )}
        </>
      )}
      {step === 1 && (
        <fieldset className="m-0 border-0 p-0">
          {legend("What would a resident do next?")}
          <div className="grid grid-cols-2 gap-2">
            {RESIDENT_ACTIONS.map((a) => (
              <Segment key={a.id} selected={residentAction === a.id} onClick={() => save({ residentAction: a.id }, onRated)}>
                {a.label}
              </Segment>
            ))}
          </div>
        </fieldset>
      )}
      {/* Always in the page, so a screen reader announces the failure when it appears. */}
      <p aria-live="polite" className="m-0 font-body text-[0.9rem] text-[var(--color-error)] empty:hidden">
        {failed ? "That didn't save. Tap it again." : ""}
      </p>
    </StepFrame>
  );
}

/** A large, equal-width choice button for one-handed tapping; a long label wraps instead of overflowing. */
function Segment({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-w-0 rounded-lg border px-2 py-3 font-body text-[0.95rem] leading-tight text-balance break-words transition-colors ${
        selected
          ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
          : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink)] hover:border-[var(--color-accent)]"
      }`}
    >
      {children}
    </button>
  );
}
