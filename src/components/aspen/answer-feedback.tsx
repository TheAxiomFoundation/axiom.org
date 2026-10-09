"use client";

import { useEffect, useState } from "react";
import {
  POST_CHECK,
  VERDICTS,
  WENT_WELL,
  WENT_WRONG,
  WOULD_ACT,
  RESIDENT_ACTIONS,
} from "@/lib/aspen/content";
import type { RulesAnswer } from "@/lib/aspen/rules";
import { AnswerText } from "./answer-text";
import { formatValue, participantId, postJson } from "./client";
import { BUTTON, BUTTON_QUIET, Chip, Eyebrow, FIELD } from "./ui";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** How the participant rates one chatbot answer. */
export function RatingCard({ promptId, onRated }: { promptId: string; onRated?: () => void }) {
  const [verdict, setVerdict] = useState<string | null>(null);
  const [wouldAct, setWouldAct] = useState<string | null>(null);
  const [residentAction, setResidentAction] = useState<string | null>(null);
  const [wentWell, setWentWell] = useState<string[]>([]);
  const [wentWrong, setWentWrong] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showOther, setShowOther] = useState(false);

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
      <p className="m-0 font-body text-[0.9rem] text-[var(--color-success)]">
        Rating saved. Thank you.
      </p>
    );
  }

  // One question at a time: the verdict, whether you'd act on it, what a resident would do, then what stood out.
  const praise = verdict === "right";
  const firstTags = praise ? WENT_WELL : WENT_WRONG;
  const otherTags = praise ? WENT_WRONG : WENT_WELL;
  const firstPicked = praise ? wentWell : wentWrong;
  const otherPicked = praise ? wentWrong : wentWell;
  const setFirst = praise ? setWentWell : setWentWrong;
  const setOther = praise ? setWentWrong : setWentWell;

  return (
    <div className="flex flex-col gap-5 rounded-xl border-2 border-[var(--color-accent)] bg-[var(--color-paper-elevated)] p-4">
      <div>
        <Eyebrow className="text-[var(--color-accent)]">Rate this answer</Eyebrow>
        <p className="m-0 mt-1 font-body text-[0.92rem] text-[var(--color-ink-muted)]">
          Three quick questions. Your rating counts in the room&apos;s results.
        </p>
      </div>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 font-body text-[1.02rem] text-[var(--color-ink)]">Does it look right?</legend>
        <div className="grid grid-cols-3 gap-2">
          {VERDICTS.map((v) => (
            <Segment key={v.id} selected={verdict === v.id} onClick={() => setVerdict(v.id)}>
              {v.label}
            </Segment>
          ))}
        </div>
      </fieldset>
      {verdict && (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2.5 font-body text-[1.02rem] text-[var(--color-ink)]">Would you act on it?</legend>
          <div className="grid grid-cols-3 gap-2">
            {WOULD_ACT.map((v) => (
              <Segment key={v.id} selected={wouldAct === v.id} onClick={() => setWouldAct(v.id)}>
                {v.label}
              </Segment>
            ))}
          </div>
        </fieldset>
      )}
      {verdict && wouldAct && (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2.5 font-body text-[1.02rem] text-[var(--color-ink)]">
            What would a resident do next?
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RESIDENT_ACTIONS.map((a) => (
              <Segment key={a.id} selected={residentAction === a.id} onClick={() => setResidentAction(a.id)}>
                {a.label}
              </Segment>
            ))}
          </div>
        </fieldset>
      )}
      {verdict && wouldAct && residentAction && (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2.5 font-body text-[1.02rem] text-[var(--color-ink)]">
            {praise ? "What went well?" : "What went wrong?"}{" "}
            <span className="text-[0.82rem] text-[var(--color-ink-muted)]">Optional</span>
          </legend>
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
            <button type="button" className="aspen-link mt-3 font-body text-[0.84rem]" onClick={() => setShowOther(true)}>
              {praise ? "Something went wrong too?" : "Something went well too?"}
            </button>
          )}
        </fieldset>
      )}
      {verdict && wouldAct && residentAction && (
        <>
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
            <span className="font-body text-[0.85rem] text-[var(--color-error)]">That didn&apos;t save. Try again.</span>
          )}
        </>
      )}
    </div>
  );
}

/** A large, equal-width choice button for one-handed tapping. */
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
      className={`whitespace-nowrap rounded-lg border px-1 py-3 font-body text-[0.95rem] transition-colors ${
        selected
          ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
          : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink)] hover:border-[var(--color-accent)]"
      }`}
    >
      {children}
    </button>
  );
}

const PROGRESS = [
  "Reading the household",
  "Finding the program's rules",
  "Running the encoded rules",
  "Writing up the answer",
];

/** Turns a legal id like "us-az:policies/des/faa5/x#y" into "us-az/policies/des/faa5/x". */
export function citationPath(legalId: string): string {
  return legalId.split("#")[0].replace(":", "/");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10" → "October 2026"; other periods unchanged. */
export function formatPeriod(period: string | null): string | null {
  const match = period?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return period;
  return `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

const ACRONYMS = /\b(snap|tanf|tca|ctc|eitc|sua|fpl)\b/gi;

/** Engine labels like "Snap excess shelter deduction" → "Excess shelter deduction". */
export function outputLabel(label: string): string {
  const trimmed = label.replace(/^(snap|tanf|tca|ctc|eitc)\s+/i, "");
  const cased = trimmed.replace(ACRONYMS, (m) => m.toUpperCase());
  return cased.charAt(0).toUpperCase() + cased.slice(1);
}

/**
 * "Check against the rules": asks the rules-backed chatbot the same
 * question and puts its result next to the chatbot's answer.
 */
export function RulesCheck({
  promptId,
  messages,
  unlocked,
}: {
  promptId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  unlocked: boolean;
}) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<(RulesAnswer & { latencyMs?: number }) | null>(null);
  const [step, setStep] = useState(0);
  const [postCheck, setPostCheck] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    if (state !== "running") return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS.length - 1)), 3500);
    return () => clearInterval(timer);
  }, [state]);

  async function run() {
    setState("running");
    setStep(0);
    const response = await postJson<RulesAnswer & { error?: string; latencyMs?: number }>(
      "/api/aspen/rules",
      { participantId: participantId(), promptId, messages },
    ).catch(() => null);
    if (!response?.ok || response.data.error) {
      setState("error");
      return;
    }
    setResult(response.data);
    setState("done");
  }

  async function savePostCheck(id: string) {
    setPostCheck(id);
    await postJson("/api/aspen/rate", { participantId: participantId(), promptId, postCheck: id }).catch(
      () => undefined,
    );
  }

  if (!unlocked) {
    return (
      <p className="m-0 rounded-md bg-[var(--color-rule-subtle)] px-3 py-2 font-body text-[0.88rem] text-[var(--color-ink-secondary)]">
        Later in the session, you&apos;ll check this answer against the encoded rules.
      </p>
    );
  }

  if (state === "idle" || state === "error") {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" className={BUTTON} onClick={run}>
          Check against the rules
        </button>
        {state === "error" && (
          <span className="font-body text-[0.85rem] text-[var(--color-error)]">
            The rules check didn&apos;t finish. Try again.
          </span>
        )}
      </div>
    );
  }

  if (state === "running" || !result) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--color-rule)] px-4 py-3" role="status">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
        <span className="font-body text-[0.92rem] text-[var(--color-ink-secondary)]">{PROGRESS[step]}…</span>
      </div>
    );
  }

  const primary = result.computations[0]?.primary ?? null;
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-light)] p-4">
      <Eyebrow className="text-[var(--color-accent)]">What the encoded rules say</Eyebrow>
      {result.computations.length > 0 ? (
        <div>
          <span className="block font-display text-[2.2rem] font-light leading-none tabular-nums text-[var(--color-accent)]">
            {primary ? formatValue(primary.value, primary.unit) : "—"}
            {primary?.unit === "USD" && result.period && /^\d{4}-\d{2}$/.test(result.period) && (
              <span className="ml-1 font-body text-[0.95rem] text-[var(--color-ink-muted)]">a month</span>
            )}
          </span>
          <span className="mt-1 block font-body text-[0.84rem] text-[var(--color-ink-muted)]">
            {[result.program, result.period && `for ${formatPeriod(result.period)}`].filter(Boolean).join(" · ")}
          </span>
        </div>
      ) : (
        <p className="m-0 font-body text-[0.92rem] text-[var(--color-ink-secondary)]">
          The rules chatbot answered without running a calculation, so the rules for this question may not be
          encoded yet. That is the honest answer for now.
        </p>
      )}
      {result.computations.flatMap((c) => c.outputs).length > 1 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {result.computations.flatMap((c) =>
            c.outputs.map((o) => (
              <li key={`${c.program}-${o.name}`} className="flex justify-between gap-3 font-body text-[0.86rem]">
                <span className="text-[var(--color-ink-secondary)]">
                  {result.computations.length > 1 ? `${c.displayName}: ` : ""}
                  {outputLabel(o.label)}
                  {o.incomplete && <span className="ml-1 text-[var(--color-warning)]">(still being encoded)</span>}
                </span>
                <span className="font-mono tabular-nums text-[var(--color-ink)]">{formatValue(o.value, o.unit)}</span>
              </li>
            )),
          )}
        </ul>
      )}
      {result.incomplete.length > 0 && (
        <p className="m-0 font-body text-[0.85rem] text-[var(--color-warning)]">
          Not final: the rules release marks {result.incomplete.map(outputLabel).join(", ")} as still being
          encoded.
        </p>
      )}
      {result.citations.length > 0 && (
        <div>
          <span className="mb-1 block font-body text-[0.8rem] text-[var(--color-ink-muted)]">Rules used</span>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {[...new Set(result.citations.map(citationPath))].slice(0, 6).map((path) => (
              <li key={path} className="break-all font-mono text-[0.72rem] text-[var(--color-ink-secondary)]">
                {path}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <button type="button" className="aspen-link font-body text-[0.88rem]" onClick={() => setShowFull((v) => !v)}>
          {showFull ? "Hide" : "Show"} the full rules answer
        </button>
        {showFull && (
          <AnswerText
            text={result.text}
            className="mt-2 flex flex-col gap-2 font-body text-[0.9rem] leading-relaxed text-[var(--color-ink)]"
          />
        )}
      </div>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 font-body text-[0.92rem] text-[var(--color-ink)]">
          Next to the rules, the AI&apos;s answer was:
        </legend>
        <div className="flex flex-wrap gap-2">
          {POST_CHECK.map((p) => (
            <Chip key={p.id} selected={postCheck === p.id} onClick={() => savePostCheck(p.id)}>
              {p.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <button type="button" className={`${BUTTON_QUIET} self-start`} onClick={run}>
        Run the check again
      </button>
    </div>
  );
}
