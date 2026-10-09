"use client";

import { useEffect, useState } from "react";
import {
  BREAKOUT_PROMPT,
  EVENT,
  GOLDEN_A,
  NEXT_STEPS,
  ONE_SET_OF_RULES,
  POLICYBENCH,
  STAGES,
  USE_CASES,
  US_STATES,
  percent,
  type StageId,
} from "@/lib/aspen/content";
import type { Count } from "@/lib/aspen/results";
import { SourceOfTruthCard } from "./results-board";
import { countWord, snapQcTotals } from "@/lib/verification-evidence";
import { VOTE_KEY, participantId, postJson, readStored, sendEvent, writeStored } from "./client";
import { Disclosure } from "./disclosure";
import { BUTTON, Card, Chip, Eyebrow, FIELD } from "./ui";

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
}: {
  live?: StageId | null;
  current?: StageId;
  onPick?: (id: StageId) => void;
  compact?: boolean;
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
        const row = (
          <>
            <span
              className={`relative z-1 flex h-7 w-7 items-center justify-center rounded-full border-2 font-mono text-[0.68rem] tabular-nums ${
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
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    if the room allows
                  </span>
                )}
                {isLive && (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-white">
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
                onClick={() => onPick(stage.id)}
                className={`${grid} rounded-md px-1.5 ${here && compact ? "bg-[var(--color-accent-light)]" : "hover:bg-[var(--color-rule-subtle)]/60"}`}
              >
                {row}
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
export function WelcomeLanding({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col justify-center gap-8 py-6 md:max-w-[760px]">
      <section>
        <span className="kicker mb-4 inline-flex">
          <span className="kicker-mark">&sect;</span>
          Aspen Institute · {EVENT.place}
        </span>
        <h1 className="heading-page m-0 mb-4 text-balance" style={{ fontSize: "clamp(1.7rem, 1.1rem + 2.4vw, 2.8rem)" }}>
          {EVENT.title}
        </h1>
        <p className="m-0 max-w-[560px] font-body text-[1.1rem] leading-relaxed text-[var(--color-ink-secondary)] text-pretty">
          {STAGES[0].summary}
        </p>
        <p className="m-0 mt-3 font-mono text-[0.7rem] leading-relaxed tracking-[0.04em] text-[var(--color-ink-muted)]">
          With {EVENT.hosts}
        </p>
      </section>
      <div className="flex max-w-[440px] flex-col gap-3">
        <button type="button" className={`${BUTTON} w-full py-3.5 text-[1.05rem]`} onClick={onStart}>
          Start: ask the AI <span aria-hidden>→</span>
        </button>
        <Disclosure onOpen={() => sendEvent("disclosure", { opened: true }, "welcome")} />
      </div>
    </div>
  );
}

/** What the participant asked in Try it, as the thread needs it on later stages. */
export interface ThreadQuestion {
  householdId: string | null;
  householdLabel: string | null;
  perspective: string | null;
  asked: boolean;
  rated: boolean;
}

/**
 * The participant's own question, carried through the session: a short
 * line on the stages after Try it that ties the stage back to it.
 */
export function YourThread({
  stage,
  thread,
  onOpen,
}: {
  stage: StageId;
  thread: ThreadQuestion | null;
  onOpen: () => void;
}) {
  if (!["rate", "reveal", "scale", "foundation"].includes(stage)) return null;
  const asked = thread?.asked ?? false;
  const about = thread?.householdLabel ? `“${thread.householdLabel}”` : "your own question";
  let line: string;
  let action: string | null = null;
  if (!asked) {
    line = "You haven't asked the AI yet. It takes a minute, and your answer joins the room's.";
    action = "Ask the AI";
  } else if (stage === "rate") {
    line = `Think of the answer about ${about}, and the others you've seen, as you rate.`;
  } else if (stage === "reveal") {
    line = thread?.rated
      ? `You asked about ${about}. Your rating is in the results below.`
      : `You asked about ${about}. Rate the answer so it counts in the results below.`;
    action = thread?.rated ? null : "Rate my answer";
  } else if (stage === "scale") {
    line =
      thread?.householdId === "az-savings"
        ? "You asked about the Arizona household below: every one of the 46 models said it gets $0."
        : `You asked about ${about}. Here is how AI does on households like it, at scale.`;
  } else {
    line = `Now check the AI's answer about ${about} against the encoded rules.`;
    action = "Check my answer";
  }
  return (
    <div className="mb-8 border-l-2 border-[var(--color-accent)] py-1 pl-4">
      <span className="mb-1 block font-mono text-[0.6rem] uppercase tracking-[0.18em] text-[var(--color-accent)]">
        Your question
      </span>
      <p className="m-0 font-body text-[0.95rem] leading-snug text-[var(--color-ink)]">
        {line}
        {action && (
          <>
            {" "}
            <button type="button" className="aspen-link whitespace-nowrap font-medium" onClick={onOpen}>
              {action} →
            </button>
          </>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// At scale: PolicyBench
// ---------------------------------------------------------------------------

/** At scale, on a phone: the one number, then the one household every model got wrong. */
export function PolicyBenchContent() {
  const zeroShare = percent(POLICYBENCH.saidZero, POLICYBENCH.eligibleAnswers);
  const az = POLICYBENCH.azCase;
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-2 border-l-4 border-l-[var(--color-error)] p-5">
        <span className="font-display text-[3.6rem] font-light leading-none tabular-nums text-[var(--color-error)]">
          {zeroShare}%
        </span>
        <p className="m-0 font-body text-[1.08rem] leading-snug text-[var(--color-ink)]">
          of AI answers told a family that qualifies for SNAP they&apos;d get <strong>$0</strong>.
        </p>
        <p className="m-0 font-body text-[0.88rem] text-[var(--color-ink-muted)]">
          {POLICYBENCH.saidZero} of {POLICYBENCH.eligibleAnswers} answers, from {POLICYBENCH.models} models.
        </p>
      </Card>
      <Card className="flex flex-col gap-3 p-5">
        <Eyebrow className="text-[var(--color-error)]">
          An Arizona household · {az.modelsSaidZero} of {az.modelsAsked} models said $0
        </Eyebrow>
        <p className="m-0 font-body text-[1rem] leading-relaxed text-[var(--color-ink)]">{az.description}</p>
        <p className="m-0 font-body text-[1rem] leading-relaxed text-[var(--color-ink)]">
          <strong className="text-[var(--color-accent)]">The rules: eligible, $24 a month.</strong>
        </p>
      </Card>
      <p className="m-0 font-body text-[0.8rem] text-[var(--color-ink-muted)]">
        PolicyBench, {POLICYBENCH.snapshot}. Models answered without tools.{" "}
        <a className="aspen-link" href={POLICYBENCH.url} target="_blank" rel="noopener noreferrer">
          policybench.org
        </a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A shared foundation
// ---------------------------------------------------------------------------

export function FoundationContent({ sourceOfTruth }: { sourceOfTruth?: Count[] }) {
  const qc = snapQcTotals();
  const asked = sourceOfTruth?.some((c) => c.count > 0) ?? false;
  return (
    <div className="flex flex-col gap-8">
      {asked && sourceOfTruth && (
        <div className="max-w-[760px]">
          <SourceOfTruthCard counts={sourceOfTruth} />
        </div>
      )}
      <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1.4fr]">
        <div className="flex flex-col justify-center gap-2 rounded-lg bg-[var(--color-ink)] p-5 text-white">
          <span className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-white/60">One source of truth</span>
          <span className="font-display text-[1.45rem] font-light leading-tight">
            One open, validated set of rules
          </span>
          <span className="font-body text-[0.86rem] text-white/75">Cited to the law. Checked against your manuals.</span>
        </div>
        <span aria-hidden className="hidden self-center font-display text-[2rem] text-[var(--color-accent)] md:block">
          →
        </span>
        <ul className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 lg:grid-cols-3">
          {ONE_SET_OF_RULES.map((use) => (
            <li
              key={use.label}
              className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3.5 py-2.5"
            >
              <span className="block font-body text-[0.95rem] font-medium text-[var(--color-ink)]">{use.label}</span>
              <span className="block font-body text-[0.8rem] leading-snug text-[var(--color-ink-muted)]">{use.detail}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="m-0 max-w-[600px] border-l-2 border-[var(--color-accent)] pl-4 font-body text-[0.98rem] leading-relaxed text-[var(--color-ink-secondary)]">
        <span className="text-[var(--color-ink)]">SNAP benefit math already checks out.</span> We replay USDA&apos;s
        quality-control cases from {countWord(qc.states)} states ({qc.households.toLocaleString("en-US")} households),
        and the benefit amount matches in every case.
      </p>

      <section>
        <h2 className="heading-sub m-0 mb-2">What it takes for a state</h2>
        <p className="m-0 mb-4 max-w-[640px] font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-secondary)]">
          Three levels of validation. Each one is a step a state can take on its own schedule.
        </p>
        <GoldenContent />
      </section>
    </div>
  );
}

export function GoldenContent() {
  const tones = [
    { seal: "#9a6b3f", card: "" },
    { seal: "#8a9199", card: "bg-[#eef0f2]" },
    { seal: "#b7862b", card: "border-[#b7862b] bg-[#f6eed8]" },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {GOLDEN_A.map((tier, i) => (
        <Card key={tier.tier} className={`flex flex-col gap-3 ${tones[i].card}`}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[1.25rem] font-semibold text-white"
              style={{ background: tones[i].seal }}
            >
              A
            </span>
            <div>
              <span className="block font-mono text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                {tier.tier}
              </span>
              <span className="block font-body text-[1.02rem] font-medium text-[var(--color-ink)]">{tier.name}</span>
            </div>
          </div>
          <div>
            <Eyebrow className="mb-1">Your state gets</Eyebrow>
            <p className="m-0 font-body text-[0.92rem] leading-relaxed text-[var(--color-ink)]">{tier.gets}</p>
          </div>
          <div className="mt-auto">
            <Eyebrow className="mb-1">It takes</Eyebrow>
            <p className="m-0 font-body text-[0.88rem] leading-relaxed text-[var(--color-ink-secondary)]">{tier.takes}</p>
          </div>
        </Card>
      ))}
    </div>
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
      <p className="m-0 font-body text-[1rem] text-[var(--color-ink)]">
        <span aria-hidden className="mr-1.5 text-[var(--color-success)]">✓</span>
        You voted: <strong className="font-medium">{votedFor.label}</strong>
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
            <span className="block font-body text-[1.05rem] font-medium text-[var(--color-ink)]">{u.label}</span>
            <span className="block font-body text-[0.9rem] leading-snug text-[var(--color-ink-muted)]">{u.detail}</span>
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
  const step = "heading-sub m-0 mb-4 flex items-baseline gap-3";
  const number = "font-mono text-[0.8rem] text-[var(--color-accent)]";
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className={step}>
          <span className={number}>1</span>Vote
        </h2>
        <VoteCard stage={stage} />
      </section>
      <section>
        <h2 className={step}>
          <span className={number}>2</span>Talk it through
        </h2>
        <GroupsCard stage={stage} />
      </section>
    </div>
  );
}

/** Small groups: the prompt, and a box to share the group's best idea with the room. */
export function GroupsCard({ stage }: { stage: string }) {
  const [useCase, setUseCase] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(0);

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <p className="m-0 border-l-2 border-[var(--color-accent)] pl-4 font-body text-[1.08rem] leading-relaxed text-[var(--color-ink)]">
        {BREAKOUT_PROMPT}
      </p>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 font-body text-[1rem] text-[var(--color-ink)]">
          Your group talked about <span className="text-[var(--color-ink-muted)]">(optional)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {USE_CASES.map((u) => (
            <Chip key={u.id} selected={useCase === u.id} onClick={() => setUseCase(useCase === u.id ? null : u.id)}>
              {u.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2 font-body text-[1rem] text-[var(--color-ink)]">
        Your group&apos;s best idea
        <textarea
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={FIELD}
          placeholder="One or two sentences"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={`${BUTTON} py-3`}
          disabled={!note.trim()}
          onClick={() => {
            sendEvent("breakout", { useCase, note }, stage);
            setShared((n) => n + 1);
            setNote("");
          }}
        >
          Share with the room
        </button>
        {shared > 0 && (
          <span className="font-body text-[0.95rem] text-[var(--color-success)]">
            Shared. It&apos;s on the big screen.
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

export function NextStepsForm() {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState("");
  const [email, setEmail] = useState("");
  const [accurateAi, setAccurateAi] = useState(false);
  const [stateSystems, setStateSystems] = useState(false);
  const [showState, setShowState] = useState(true);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const response = await postJson<{ error?: string }>("/api/aspen/pledge", {
      participantId: participantId(),
      name,
      title,
      state,
      email,
      accurateAi,
      stateSystems,
      showState,
      note,
    }).catch(() => null);
    if (response?.ok) {
      setStatus("done");
      return;
    }
    setError(response?.data.error ?? "That didn't send. Try again.");
    setStatus("error");
  }

  if (status === "done") {
    return (
      <Card className="border-[var(--color-success)] p-5">
        <p className="m-0 font-display text-[1.4rem] font-light text-[var(--color-ink)]">Thank you.</p>
        <p className="m-0 mt-2 font-body text-[0.95rem] text-[var(--color-ink-secondary)]">
          We&apos;ll follow up after the convening. Questions before then: {EVENT.contactEmail}.
        </p>
      </Card>
    );
  }

  const checked = { accurate_ai: [accurateAi, setAccurateAi], state_systems: [stateSystems, setStateSystems] } as const;
  return (
    <form onSubmit={submit} className="flex max-w-[760px] flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 font-body text-[0.95rem] font-medium text-[var(--color-ink)]">
          I&apos;d like to talk about
        </legend>
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
                <span className="block font-body text-[1rem] font-medium text-[var(--color-ink)]">{option.label}</span>
                <span className="block font-body text-[0.84rem] text-[var(--color-ink-muted)]">{option.detail}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={FIELD} placeholder="Name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Name" autoComplete="name" />
        <input className={FIELD} placeholder="Title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} aria-label="Title" autoComplete="organization-title" />
        <select className={FIELD} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
          <option value="">State</option>
          {US_STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input
          className={FIELD}
          type="email"
          required
          placeholder="Email"
          value={email}
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
          autoComplete="email"
        />
      </div>
      <textarea
        rows={2}
        className={FIELD}
        placeholder="Anything we should know? (optional)"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Note"
      />
      <label className="flex items-center gap-2 font-body text-[0.86rem] text-[var(--color-ink-secondary)]">
        <input type="checkbox" checked={showState} onChange={(e) => setShowState(e.target.checked)} className="accent-[var(--color-accent)]" />
        Show my state on the screen (never my name)
      </label>
      <button
        type="submit"
        className={`${BUTTON} w-full py-3 text-[1rem] sm:w-auto sm:self-start`}
        disabled={status === "saving" || !email.trim() || (!accurateAi && !stateSystems)}
      >
        {status === "saving" ? "Sending…" : "Send"}
      </button>
      {status === "error" && <p className="m-0 font-body text-[0.85rem] text-[var(--color-error)]">{error}</p>}
      <p className="m-0 font-body text-[0.78rem] text-[var(--color-ink-muted)]">
        This goes to the Axiom Foundation as a request to follow up. It isn&apos;t a commitment.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Thank you (and dinner)
// ---------------------------------------------------------------------------

export function ThankYouContent() {
  const links = [
    { label: "Try the rules chatbot", href: "https://axiom.org/gallery/chatbot" },
    { label: "PolicyBench", href: POLICYBENCH.url },
    { label: "The Axiom Foundation", href: "https://axiom.org" },
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="m-0 max-w-[620px] font-display text-[1.45rem] font-light leading-snug text-[var(--color-ink)]">
          Thank you to the Aspen Institute and to every leader in the room.{" "}
          <span className="serif-italic">Enjoy dinner.</span>
        </p>
        <p className="m-0 max-w-[620px] font-body text-[1.05rem] leading-relaxed text-[var(--color-ink-secondary)]">
          We&apos;ll follow up with every state that asked. This page stays open this week, so you can come back to
          your answers. Questions: {EVENT.contactEmail}.
        </p>
        <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)]">{EVENT.hosts}</p>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-4 py-2 font-body text-[0.95rem] text-[var(--color-ink)] no-underline hover:border-[var(--color-accent)]"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
