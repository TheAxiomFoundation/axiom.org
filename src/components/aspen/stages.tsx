"use client";

import { useEffect, useRef, useState } from "react";
import {
  GROUP_PHONE_INTRO,
  EVENT,
  GROUP_QUESTIONS,
  GROUP_RAISED,
  NEXT_STEPS,
  LOOK_UP,
  POLICYBENCH,
  STAGES,
  USE_CASES,
  type StageId,
} from "@/lib/aspen/content";
import { PLEDGE_KEY, VOTE_KEY, participantId, postJson, readStored, sendEvent, writeStored } from "./client";
import { Disclosure } from "./disclosure";
import { BUTTON, BUTTON_QUIET, Card, FIELD, Part } from "./ui";

const OPTION_BOX =
  "rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
/** A choice card: label over description, top-aligned so a row of cards lines up. */
const OPTION = `${OPTION_BOX} flex flex-col items-start justify-start`;
const OPTION_ON = "border-[var(--color-accent)] bg-[var(--color-accent-light)]";
const OPTION_OFF = "border-[var(--color-rule)] bg-[var(--color-paper-elevated)] hover:border-[var(--color-accent)]";

// ---------------------------------------------------------------------------
// Welcome: the landing
// ---------------------------------------------------------------------------

/**
 * The session at a glance: one numbered line through every segment (the
 * red thread), with the live segment marked. `current` marks where the
 * participant is (the session menu); `compact` drops the descriptions.
 */
export function Agenda({
  live,
  current,
  onPick,
  compact = false,
  limit,
}: {
  live?: StageId | null;
  current?: StageId;
  onPick?: (id: StageId) => void;
  compact?: boolean;
  /** The last stage a participant may open; later ones wait for the room (the dry run, Oct 25). */
  limit?: number;
}) {
  const liveIndex = live ? STAGES.findIndex((s) => s.id === live) : -1;
  return (
    // Tappable rows carry side padding for their highlight; pull the list back so the circles keep their edge.
    <ol className={`relative m-0 flex list-none flex-col p-0 ${onPick ? "-mx-1.5" : ""}`}>
      <span
        aria-hidden
        className={`absolute w-[2px] rounded-full bg-[var(--color-accent)] opacity-70 ${onPick ? "left-[19px]" : "left-[13px]"} ${compact ? "bottom-4 top-4" : "bottom-6 top-6"}`}
      />
      {STAGES.map((stage, i) => {
        const isLive = i === liveIndex;
        const done = liveIndex > i;
        const here = current === stage.id;
        const locked = limit !== undefined && i > limit;
        const row = (
          <>
            <span
              className={`relative z-1 flex h-7 w-7 items-center justify-center rounded-full border-2 font-mono text-[0.8rem] tabular-nums ${
                isLive
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                  : done
                    ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-paper))] text-[var(--color-accent)]"
                    : "border-[var(--color-accent)] bg-[var(--color-paper)] text-[var(--color-accent)]"
              }`}
            >
              {i + 1}
            </span>
            <span className={compact ? "self-center" : "pb-1"}>
              <span
                className={`flex flex-wrap items-center gap-2 font-body text-[1rem] text-[var(--color-ink)] ${here ? "font-semibold" : "font-medium"}`}
              >
                {stage.label}
                {stage.optional && !compact && (
                  <span className="font-body font-medium text-[0.82rem] text-[var(--color-ink-muted)]">
                    if the room allows
                  </span>
                )}
                {isLive && (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-2 py-0.5 font-body font-medium text-[0.82rem] text-white">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
                    Now
                  </span>
                )}
                {here && compact && <span className="sr-only">You are here</span>}
              </span>
              {!compact && (
                <span className="block font-body text-[0.88rem] leading-snug text-[var(--color-ink-secondary)]">
                  {stage.agenda}
                </span>
              )}
            </span>
          </>
        );
        const grid = `grid w-full grid-cols-[28px_minmax(0,1fr)] items-start gap-4 text-left ${compact ? "py-1.5" : "py-2.5"}`;
        return (
          <li key={stage.id}>
            {onPick ? (
              <button
                type="button"
                aria-current={here ? "step" : undefined}
                disabled={locked}
                onClick={() => onPick(stage.id)}
                className={`${grid} rounded-md px-1.5 disabled:cursor-not-allowed disabled:opacity-45 ${here && compact ? "bg-[var(--color-accent-light)]" : "enabled:hover:bg-[var(--color-rule-subtle)]/60"}`}
              >
                {row}
                {locked && <span className="sr-only">, opens when the room gets there</span>}
              </button>
            ) : (
              <div className={grid}>{row}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export { Disclosure };

/**
 * The landing: what this is, and one button. Who you ask as (a resident or a
 * caseworker) is picked in the chat itself, so nothing here asks who you are.
 */
export function WelcomeLanding({ onStart, waiting = false }: { onStart: () => void; waiting?: boolean }) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4.5rem)] max-w-[760px] flex-col items-center justify-center gap-8 py-6 text-center">
      <section className="flex flex-col items-center">
        <span className="kicker mb-4 inline-flex">
          <span className="kicker-mark">&sect;</span>
          Aspen Institute · {EVENT.place}
        </span>
        <h1 className="heading-page m-0 text-balance" style={{ fontSize: "clamp(1.5rem, 1rem + 2vw, 2.25rem)" }}>
          {EVENT.title}
        </h1>
      </section>
      <div className="flex w-full max-w-[440px] flex-col gap-3">
        <button
          type="button"
          disabled={waiting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-3.5 font-body text-[1.05rem] font-medium text-white transition-colors enabled:hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onStart}
        >
          Start: ask the AI <span aria-hidden>→</span>
        </button>
        {/* Phones wait for the presenter rather than run ahead (the dry run, Oct 25). */}
        {waiting && <p className="m-0 font-body text-[0.98rem] text-[var(--color-ink-secondary)]">This opens when the session starts.</p>}
        <Disclosure onOpen={() => sendEvent("disclosure", { opened: true }, "welcome")} />
      </div>
    </div>
  );
}

/**
 * A TV moment on a phone (the run-through, Oct 23): while the room looks at
 * the screen together, the phone shows one line and, when there is one, one
 * number to carry, then says when it is needed again.
 */
export function LookUp({ stat, label }: { stat: string | null; label: string }) {
  return (
    <section aria-label={LOOK_UP.heading} className="flex flex-col gap-4 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-6">
      <p className="m-0 flex items-center gap-2.5 font-body text-[1.3rem] font-semibold text-[var(--color-ink)]">
        <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-[var(--color-accent)]">
          <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8.5 20h7M12 16.5V20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {LOOK_UP.heading}
      </p>
      {stat !== null ? (
        <p className="m-0 flex flex-col gap-1">
          <span className="font-display text-[3.4rem] font-light leading-none tabular-nums text-[var(--color-accent)]">{stat}</span>
          <span className="font-body text-[1.12rem] leading-snug text-[var(--color-ink)]">{label}</span>
        </p>
      ) : (
        <p className="m-0 font-body text-[1.12rem] leading-snug text-[var(--color-ink)]">{label}</p>
      )}
      <p className="m-0 font-body text-[1rem] text-[var(--color-ink-muted)]">{LOOK_UP.later}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vote, then small groups
// ---------------------------------------------------------------------------

/** One vote per phone (per run): what the team would build first. Once cast, it shrinks to one line. */
export function VoteCard({ stage }: { stage: string }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [voted, setVoted] = useState<string | null>(null);

  useEffect(() => {
    setVoted(readStored<string>(VOTE_KEY));
  }, []);

  const votedFor = USE_CASES.find((u) => u.id === voted);
  if (votedFor) {
    return (
      <p className="m-0 font-body text-[1.08rem] text-[var(--color-ink)]">
        <span aria-hidden className="mr-1.5 text-[var(--color-success)]">✓</span>
        You voted: <strong className="font-semibold">{votedFor.label}</strong>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Pick one" className="grid gap-2.5 sm:grid-cols-2">
        {USE_CASES.map((u) => (
          <button
            key={u.id}
            type="button"
            aria-pressed={choice === u.id}
            onClick={() => setChoice(u.id)}
            className={`${OPTION} ${choice === u.id ? OPTION_ON : OPTION_OFF}`}
          >
            <span className="block font-body text-[1.12rem] font-semibold text-[var(--color-ink)]">{u.label}</span>
            <span className="block font-body text-[1.02rem] leading-snug text-[var(--color-ink-muted)]">{u.detail}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`${BUTTON} w-full py-3 text-[1rem] sm:w-auto sm:self-start`}
        disabled={!choice}
        onClick={() => {
          sendEvent("vote", { useCase: choice }, stage);
          writeStored(VOTE_KEY, choice);
          setVoted(choice);
        }}
      >
        Vote
      </button>
    </div>
  );
}

/** Small groups on one screen: vote on what to build first, then share the group's best idea. */
export function SmallGroups({ stage }: { stage: string }) {
  return (
    <div className="flex flex-col gap-8">
      <Part n={1} title="Vote" as="h2">
        <VoteCard stage={stage} />
      </Part>
      <Part n={2} title="Talk it through" as="h2">
        <GroupsCard stage={stage} />
      </Part>
    </div>
  );
}

/** This phone's own vote, if it's one of the choices: the group's pick to start with. */
function votedUseCase(): string | null {
  const voted = readStored<string>(VOTE_KEY);
  return voted && USE_CASES.some((u) => u.id === voted) ? voted : null;
}

/**
 * Small groups: the group's pick (this phone's own vote to start with), then
 * the three questions, one box each, and an optional box for what else came
 * up (barriers, workforce, questions). The report-back card on the big screen
 * shows the same three. One person per group fills it in, so it opens on a
 * tap and the other phones stay short (Michaela, Oct 26).
 */
export function GroupsCard({ stage }: { stage: string }) {
  const [useCase, setUseCase] = useState<string | null>(null);
  useEffect(() => {
    setUseCase(votedUseCase());
  }, []);
  const [answers, setAnswers] = useState<Record<(typeof GROUP_QUESTIONS)[number]["id"], string>>({ note: "", who: "", trust: "" });
  const [raised, setRaised] = useState("");
  const [shared, setShared] = useState(0);
  const [filling, setFilling] = useState(false);
  // The button goes away when pressed; focus moves to the form it opened, not to the page. The form,
  // not its menu: focusing a menu can open the phone's picker.
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (filling) form.current?.focus();
  }, [filling]);
  const anything = [...Object.values(answers), raised].some((v) => v.trim());

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <p className="m-0 border-l-2 border-[var(--color-accent)] pl-4 font-body text-[1.08rem] leading-relaxed text-[var(--color-ink)]">
        {GROUP_PHONE_INTRO}
      </p>
      {!filling ? (
        <button
          type="button"
          className={`${BUTTON_QUIET} w-full justify-between py-3 text-left text-[1rem] sm:w-auto sm:self-start`}
          onClick={() => {
            // A vote cast on this screen since it opened counts too.
            if (!useCase) setUseCase(votedUseCase());
            setFilling(true);
          }}
        >
          Fill it in for my group
          <span aria-hidden className="text-[var(--color-accent)]">↓</span>
        </button>
      ) : (
        <div ref={form} tabIndex={-1} aria-label="Your group" role="group" className="flex flex-col gap-5 outline-none">
          <label className="flex flex-col gap-2 font-body text-[1.08rem] font-semibold text-[var(--color-ink)]">
            Your group&apos;s pick
            <select value={useCase ?? ""} onChange={(e) => setUseCase(e.target.value || null)} className={FIELD}>
              <option value="">Not decided</option>
              {USE_CASES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          {GROUP_QUESTIONS.map((q, i) => (
            <label key={q.id} className="flex flex-col gap-2 font-body text-[1.08rem] text-[var(--color-ink)]">
              <span className="font-semibold">
                {i + 1}. {q.label}
              </span>
              <textarea
                rows={q.id === "note" ? 3 : 2}
                maxLength={2000}
                value={answers[q.id]}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                className={FIELD}
                placeholder={q.placeholder}
              />
            </label>
          ))}
          <label className="flex flex-col gap-2 font-body text-[1.08rem] text-[var(--color-ink)]">
            <span className="font-semibold">
              {GROUP_RAISED.label} <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
            </span>
            <textarea
              rows={2}
              maxLength={2000}
              value={raised}
              onChange={(e) => setRaised(e.target.value)}
              className={FIELD}
              placeholder={GROUP_RAISED.placeholder}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={`${BUTTON} py-3`}
              disabled={!anything}
              onClick={() => {
                sendEvent("breakout", { useCase, ...answers, raised }, stage);
                setShared((n) => n + 1);
                setAnswers({ note: "", who: "", trust: "" });
                setRaised("");
              }}
            >
              Share with the room
            </button>
            {shared > 0 && (
              <span className="font-body text-[1.05rem] font-medium text-[var(--color-success)]">
                Shared. It&apos;s on the big screen.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

export function NextStepsForm({ onSent }: { onSent?: () => void } = {}) {
  const [email, setEmail] = useState("");
  const [accurateAi, setAccurateAi] = useState(false);
  const [stateSystems, setStateSystems] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // A tab reloaded after sending (iOS reloads one left in the background) shows the thank-you again.
  useEffect(() => {
    if (readStored<boolean>(PLEDGE_KEY) === true) {
      setStatus("done");
      onSent?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const response = await postJson<{ error?: string }>("/api/aspen/pledge", {
      participantId: participantId(),
      email,
      accurateAi,
      stateSystems,
      note,
    }).catch(() => null);
    if (response?.ok) {
      writeStored(PLEDGE_KEY, true);
      setStatus("done");
      onSent?.();
      return;
    }
    setError(response?.data.error ?? "That didn't send. Try again.");
    setStatus("error");
  }

  if (status === "done") {
    return (
      <Card className="border-[var(--color-success)] p-5">
        <p className="m-0 font-display text-[1.4rem] font-light text-[var(--color-ink)]">Thank you.</p>
        <p className="m-0 mt-2 font-body text-[1.05rem] text-[var(--color-ink-secondary)]">
          We&apos;ll follow up after the convening. Questions before then: {EVENT.contactEmail}.
        </p>
      </Card>
    );
  }

  const checked = { accurate_ai: [accurateAi, setAccurateAi], state_systems: [stateSystems, setStateSystems] } as const;
  const label = "flex flex-col gap-1.5 font-body text-[1.05rem] font-semibold text-[var(--color-ink)]";
  return (
    <form onSubmit={submit} className="flex max-w-[760px] flex-col gap-8">
      <Part n={1} title="I'd like to talk about" as="h2">
        <div role="group" aria-label="I'd like to talk about" className="flex flex-col gap-2.5">
          {NEXT_STEPS.options.map((option) => {
            const [on, set] = checked[option.id];
            return (
              <label key={option.id} className={`${OPTION_BOX} flex cursor-pointer items-start gap-3 ${on ? OPTION_ON : OPTION_OFF}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => set(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                />
                <span>
                  <span className="block font-body text-[1.12rem] font-semibold text-[var(--color-ink)]">{option.label}</span>
                  <span className="block font-body text-[1.02rem] leading-snug text-[var(--color-ink-muted)]">{option.detail}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Part>
      <Part n={2} title="How we reach you" as="h2">
        {/* Just an email: Aspen's roster already gives each leader's name, title and state. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Email
            <input
              className={FIELD}
              type="email"
              required
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
        </div>
        <label className={label}>
          <span>
            Note <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
          </span>
          <textarea
            rows={2}
            className={FIELD}
            placeholder="Anything we should know?"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </Part>
      <Part n={3} title="Send" as="h2">
        <button
          type="submit"
          className={`${BUTTON} w-full py-3 text-[1.05rem] sm:w-auto sm:self-start`}
          disabled={status === "saving" || !email.trim() || (!accurateAi && !stateSystems)}
        >
          {status === "saving" ? "Sending…" : "Send"}
        </button>
        {status === "error" && <p className="m-0 font-body text-[1rem] text-[var(--color-error)]">{error}</p>}
        <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)]">
          This goes to the Axiom Foundation as a request to follow up. It isn&apos;t a commitment.
        </p>
      </Part>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Thank you (and dinner)
// ---------------------------------------------------------------------------

/**
 * The closing page: one thank-you, where to go next and how to reach us.
 * Centered like the landing, so the session opens and closes the same way.
 */
export function ThankYouContent({ onReturn }: { onReturn?: () => void }) {
  const links = [
    {
      label: "Try the rules chatbot",
      detail: "Ask the same question, answered by the encoded rules.",
      href: "https://axiom.org/gallery/chatbot",
    },
    { label: "PolicyBench", detail: `How ${POLICYBENCH.models} AI models do on benefits, case by case.`, href: POLICYBENCH.url },
    { label: "The Axiom Foundation", detail: "Open, cited rules that states can validate.", href: "https://axiom.org" },
  ];
  return (
    <div className="mx-auto flex max-w-[860px] flex-col items-center gap-10 py-6 text-center">
      <section className="flex flex-col items-center">
        <span className="kicker mb-4 inline-flex">
          <span className="kicker-mark">&sect;</span>
          Aspen Institute · {EVENT.place}
        </span>
        <h1 className="heading-page m-0 mb-4" style={{ fontSize: "clamp(1.75rem, 1.2rem + 2.4vw, 2.75rem)" }}>
          Thank you
        </h1>
        <p className="m-0 max-w-[560px] font-display text-[1.35rem] font-light leading-snug text-[var(--color-ink)] text-balance">
          To the Aspen Institute and to every leader in the room.
        </p>
        <p className="m-0 mt-2 font-serif text-[1.5rem] italic text-[var(--color-accent)]">Enjoy dinner.</p>
      </section>

      <ul className="m-0 grid w-full list-none gap-3 p-0 text-left sm:grid-cols-3">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col gap-1 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 no-underline transition-colors hover:border-[var(--color-accent)]"
            >
              <span className="flex items-center justify-between gap-2 font-body text-[1.02rem] font-medium text-[var(--color-ink)]">
                {l.label}
                <span aria-hidden className="text-[var(--color-accent)] transition-transform group-hover:translate-x-0.5">
                  ↗
                </span>
              </span>
              <span className="font-body text-[1rem] leading-snug text-[var(--color-ink-muted)]">{l.detail}</span>
            </a>
          </li>
        ))}
      </ul>

      <section className="flex max-w-[560px] flex-col items-center gap-3">
        <p className="m-0 font-body text-[1.02rem] leading-relaxed text-[var(--color-ink-secondary)] text-balance">
          We&apos;ll follow up with every state that asked. Your answers stay here all week.
        </p>
        {onReturn && (
          <button type="button" className="aspen-link font-body text-[1rem] font-medium" onClick={onReturn}>
            Back to your question
          </button>
        )}
      </section>

      <p className="m-0 font-body text-[0.92rem] text-[var(--color-ink-muted)]">
        {EVENT.hosts} ·{" "}
        <a className="aspen-link" href={`mailto:${EVENT.contactEmail}`}>
          {EVENT.contactEmail}
        </a>
      </p>
    </div>
  );
}
