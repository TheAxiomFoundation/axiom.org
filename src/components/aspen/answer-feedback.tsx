"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { POST_CHECK, RESIDENT_ACTIONS, VERDICTS, WENT_WELL, WENT_WRONG } from "@/lib/aspen/content";
import { eligibilityNote, otherDisclosures, standardsMismatch, standardsUsed, testsEligibility } from "@/lib/aspen/coverage";
import type { RulesAnswer, RulesComputation, RulesOutput } from "@/lib/aspen/rules";
import { AnswerText } from "./answer-text";
import { RATING_KEY, formatValue, participantId, postJson, readStored, saveJson, writeStored } from "./client";
import { BUTTON, BUTTON_QUIET, Chip, Eyebrow, FIELD, QUESTION, StepFrame } from "./ui";

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
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** This prompt's saved draft, if the phone has a readable one. */
export function readRatingDraft(promptId: string): RatingDraft | null {
  const all = readStored<Record<string, unknown>>(RATING_KEY);
  const raw = all && typeof all === "object" ? (all[promptId] as Partial<{ rating: Record<string, unknown>; step: unknown }>) : null;
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
  // Saves go one after another, so a quick second tap never lands before the first.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // A reloaded tab (a locked phone often drops it) reopens the card where it was,
  // so the next tap doesn't save an empty rating over the one already saved.
  useEffect(() => {
    const draft = readRatingDraft(promptId);
    if (!draft) return;
    setRating(draft.rating);
    setStep(draft.step);
  }, [promptId]);

  useEffect(() => {
    // Not on first render: only once the participant has moved between steps.
    if (moved.current) question.current?.focus({ preventScroll: true });
  }, [step]);

  /** Shows and keeps the card's state; every change goes through here. */
  function keep(nextRating: Rating, nextStep: number) {
    setRating(nextRating);
    setStep(nextStep);
    writeRatingDraft(promptId, { rating: nextRating, step: nextStep });
  }

  function go(next: number) {
    moved.current = true;
    keep(rating, next);
  }

  /** Saves the whole rating with `patch` applied; the server needs a verdict first. */
  function save(patch: Partial<Rating>, then?: () => void) {
    const next = { ...rating, ...patch };
    keep(next, step);
    if (!next.verdict) return;
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
      });
      setFailed(!ok);
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

/** A computation as saved, from before or after the fields this panel reads were added. */
type Check = Pick<RulesComputation, "program" | "displayName" | "period" | "outputs"> &
  Partial<Pick<RulesComputation, "disclosures" | "standardsYears" | "eligibilityTested">>;

function isJudgment(output: RulesOutput): boolean {
  return output.semantics === "judgment" || output.value === "holds" || output.value === "not_holds";
}

/** An output as the panel shows it: a yes/no verdict from rules that don't test eligibility reads "Not tested". */
export function shownValue(output: RulesOutput, check: Pick<Check, "program" | "disclosures" | "eligibilityTested">): string {
  if (isJudgment(output) && !testsEligibility(check)) return "Not tested";
  return formatValue(output.value, output.unit);
}

/**
 * The rows under the headline. For rules that don't test eligibility, no
 * yes/no verdict shows at all, sub-tests included (a resource test that
 * BBCE would waive must not read "No"); one row says eligibility wasn't
 * tested instead, under the first row.
 */
export function panelRows(check: Check): { name: string; label: string; value: string; incomplete: boolean }[] {
  const tested = testsEligibility(check);
  const rows = check.outputs
    .filter((o) => tested || !isJudgment(o))
    .map((o) => ({ name: o.name, label: outputLabel(o.label), value: formatValue(o.value, o.unit), incomplete: o.incomplete }));
  // Rule names are snake_case words, so this name can't collide with a real output's row key.
  if (!tested) rows.splice(Math.min(1, rows.length), 0, { name: "(eligibility)", label: "Eligibility", value: "Not tested", incomplete: false });
  return rows;
}

/** "FY2026" or "FY2025 and FY2026". */
function fiscalYears(years: number[]): string {
  return years.map((y) => `FY${y}`).join(" and ");
}

/** What the panel must say next to the numbers: eligibility it didn't test, the standards year, other limits. */
export function rulesCaveats(result: { computations: Check[] }): {
  eligibility: string[];
  standards: string[];
  other: string[];
} {
  const unique = (list: (string | null)[]) => [...new Set(list.filter((s): s is string => s !== null))];
  const eligibility = unique(result.computations.map((c) => eligibilityNote(c)));
  const standards = unique(
    result.computations.map((c) => {
      const mismatch = standardsMismatch(standardsUsed(c), c.period, c.disclosures ?? []);
      if (!mismatch) return null;
      const due = `FY${mismatch.due} standards (from October 1, ${mismatch.due - 1})`;
      return `Uses ${fiscalYears(mismatch.used)} SNAP standards, but ${formatPeriod(c.period)} falls under ${due}${
        mismatch.notEncoded ? ", which Axiom hasn't encoded yet" : ""
      }. The amount may differ.`;
    }),
  );
  // Each line once on the panel: a disclosure that is word for word one of the panel's own notes doesn't repeat.
  const other = unique(result.computations.flatMap((c) => otherDisclosures(c))).filter(
    (text) => !eligibility.includes(text) && !standards.includes(text),
  );
  return { eligibility, standards, other };
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

  const first = result.computations[0];
  const primary = first?.primary ?? null;
  const monthly = primary?.unit === "USD" && result.period !== null && /^\d{4}-\d{2}$/.test(result.period);
  const ifEligible = primary?.unit === "USD" && !testsEligibility(first);
  const suffix = [monthly && "a month", ifEligible && "if eligible"].filter(Boolean).join(" ");
  const caveats = rulesCaveats(result);
  // Keyed by position: two computations of one program (a "what if I earned more?") repeat output names.
  const rows = result.computations.flatMap((c, i) =>
    panelRows(c).map((row) => ({ key: `${i}-${row.name}`, computation: c.displayName, row })),
  );
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-light)] p-4">
      <Eyebrow className="text-[var(--color-accent)]">What the encoded rules say</Eyebrow>
      {result.computations.length > 0 ? (
        <div>
          <span className="block font-display text-[2.2rem] font-light leading-none tabular-nums text-[var(--color-accent)]">
            {primary ? shownValue(primary, first) : "—"}
            {suffix && <span className="ml-1 font-body text-[0.95rem] text-[var(--color-ink-muted)]">{suffix}</span>}
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
      {caveats.eligibility.map((note) => (
        <p
          key={note}
          role="note"
          className="m-0 border-l-4 border-[var(--color-warning)] bg-[var(--color-paper-elevated)] px-3 py-2 font-body text-[0.9rem] leading-snug text-[var(--color-ink)]"
        >
          {note}
        </p>
      ))}
      {caveats.standards.map((note) => (
        <p key={note} className="m-0 font-body text-[0.85rem] leading-snug text-[var(--color-warning)]">
          {note}
        </p>
      ))}
      {rows.length > 1 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map(({ key, computation, row }) => (
            <li key={key} className="flex justify-between gap-3 font-body text-[0.86rem]">
              <span className="text-[var(--color-ink-secondary)]">
                {result.computations.length > 1 ? `${computation}: ` : ""}
                {row.label}
                {row.incomplete && <span className="ml-1 text-[var(--color-warning)]">(still being encoded)</span>}
              </span>
              <span className="font-mono tabular-nums text-[var(--color-ink)]">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
      {result.incomplete.length > 0 && (
        <p className="m-0 font-body text-[0.85rem] text-[var(--color-warning)]">
          Not final: the rules release marks {result.incomplete.map(outputLabel).join(", ")} as still being
          encoded.
        </p>
      )}
      {caveats.other.length > 0 && (
        <ul aria-label="Notes on this check" className="m-0 flex list-none flex-col gap-1 p-0">
          {caveats.other.map((note) => (
            <li key={note} className="font-body text-[0.85rem] leading-snug text-[var(--color-ink-secondary)]">
              {note}
            </li>
          ))}
        </ul>
      )}
      {result.citations.length > 0 && (
        <div>
          <span className="mb-1 block font-body text-[0.8rem] text-[var(--color-ink-muted)]">Rules used</span>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {[...new Set(result.citations.map(citationPath))].slice(0, 6).map((path) => (
              <li key={path} className="break-all font-mono text-[0.8rem] text-[var(--color-ink-secondary)]">
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
