"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { VERDICTS, WENT_WELL, WENT_WRONG, WOULD_ACT, RESIDENT_ACTIONS } from "@/lib/aspen/content";
import { participantId, postJson } from "./client";
import { BUTTON, Chip, FIELD, QUESTION, StepFrame } from "./ui";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * How the participant rates one chatbot answer: four short steps, one at a
 * time. Tapping an answer moves on; Back goes to the one before. Focus
 * follows the question, so a screen reader reads each one as it appears.
 */
export function RatingCard({ promptId, onRated }: { promptId: string; onRated?: () => void }) {
  const [step, setStep] = useState(0);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [wouldAct, setWouldAct] = useState<string | null>(null);
  const [residentAction, setResidentAction] = useState<string | null>(null);
  const [wentWell, setWentWell] = useState<string[]>([]);
  const [wentWrong, setWentWrong] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showOther, setShowOther] = useState(false);
  const question = useRef<HTMLLegendElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    // Not on first render: only once the participant has moved between steps.
    if (moved.current) question.current?.focus({ preventScroll: true });
  }, [step]);

  function go(next: number) {
    moved.current = true;
    setStep(next);
  }

  async function submit() {
    setState("saving");
    const { ok } = await postJson("/api/aspen/rate", {
      participantId: participantId(),
      promptId,
      verdict,
      wouldAct,
      residentAction,
      wentWell,
      wentWrong,
      note,
    }).catch(() => ({ ok: false }));
    setState(ok ? "saved" : "error");
    if (ok) onRated?.();
  }

  if (state === "saved") {
    return (
      <p className="m-0 font-body text-[1rem] font-medium text-[var(--color-ink)]">
        <span aria-hidden className="mr-1.5 text-[var(--color-success)]">✓</span>
        Rating saved. Thank you.
      </p>
    );
  }

  const praise = verdict === "right";
  const firstTags = praise ? WENT_WELL : WENT_WRONG;
  const otherTags = praise ? WENT_WRONG : WENT_WELL;
  const firstPicked = praise ? wentWell : wentWrong;
  const otherPicked = praise ? wentWrong : wentWell;
  const setFirst = praise ? setWentWell : setWentWrong;
  const setOther = praise ? setWentWrong : setWentWell;
  const legend = (text: ReactNode) => (
    <legend ref={question} tabIndex={-1} className={`${QUESTION} outline-none`}>
      {text}
    </legend>
  );

  return (
    <StepFrame title="Rate this answer" at={step + 1} of={4} onBack={step > 0 ? () => go(step - 1) : undefined}>
      {step === 0 && (
        <fieldset className="m-0 border-0 p-0">
          {legend("Does it look right?")}
          <div className="grid grid-cols-3 gap-2">
            {VERDICTS.map((v) => (
              <Segment key={v.id} selected={verdict === v.id} onClick={() => (setVerdict(v.id), go(1))}>
                {v.label}
              </Segment>
            ))}
          </div>
        </fieldset>
      )}
      {step === 1 && (
        <fieldset className="m-0 border-0 p-0">
          {legend("Would you act on it?")}
          <div className="grid grid-cols-3 gap-2">
            {WOULD_ACT.map((v) => (
              <Segment key={v.id} selected={wouldAct === v.id} onClick={() => (setWouldAct(v.id), go(2))}>
                {v.label}
              </Segment>
            ))}
          </div>
        </fieldset>
      )}
      {step === 2 && (
        <fieldset className="m-0 border-0 p-0">
          {legend("What would a resident do next?")}
          <div className="grid grid-cols-2 gap-2">
            {RESIDENT_ACTIONS.map((a) => (
              <Segment key={a.id} selected={residentAction === a.id} onClick={() => (setResidentAction(a.id), go(3))}>
                {a.label}
              </Segment>
            ))}
          </div>
        </fieldset>
      )}
      {step === 3 && (
        <>
          <fieldset className="m-0 border-0 p-0">
            {legend(
              <>
                {praise ? "What went well?" : "What went wrong?"}{" "}
                <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
              </>,
            )}
            <div className="flex flex-wrap gap-2">
              {firstTags.map((tag) => (
                <Chip key={tag} selected={firstPicked.includes(tag)} onClick={() => setFirst((l) => toggle(l, tag))}>
                  {tag}
                </Chip>
              ))}
            </div>
            {showOther ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {otherTags.map((tag) => (
                  <Chip key={tag} selected={otherPicked.includes(tag)} onClick={() => setOther((l) => toggle(l, tag))}>
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
              onChange={(e) => setNote(e.target.value)}
              className={FIELD}
              placeholder="What would you tell the resident?"
            />
          </label>
          <button type="button" className={`${BUTTON} w-full py-3`} disabled={state === "saving"} onClick={submit}>
            {state === "saving" ? "Saving…" : "Save rating"}
          </button>
          {state === "error" && (
            <span className="font-body text-[0.9rem] text-[var(--color-error)]">That didn&apos;t save. Try again.</span>
          )}
        </>
      )}
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
