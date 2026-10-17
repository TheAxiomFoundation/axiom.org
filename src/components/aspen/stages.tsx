"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  GROUP_PHONE_INTRO,
  EVENT,
  GROUP_QUESTIONS,
  GROUP_RAISED,
  BUILD_HEADING,
  FOUNDATION_TRAITS,
  GOLDEN_A,
  NEXT_STEPS,
  ONE_SET_OF_RULES,
  ONE_SET_STATEMENT,
  POLICYBENCH,
  STAGES,
  USE_CASES,
  US_STATES,
  percent,
  type StageId,
} from "@/lib/aspen/content";
import type { Count } from "@/lib/aspen/results";
import { SourceOfTruthCard } from "./results-board";
import { OVERALL_KEY, VOTE_KEY, participantId, postJson, readStored, sendEvent, writeStored } from "./client";
import { Disclosure } from "./disclosure";
import { TierMedal } from "./tier-medal";
import { BUTTON, BlockHeading, Card, FIELD, Part } from "./ui";

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
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-3.5 font-body text-[1.05rem] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
          onClick={onStart}
        >
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
  // What we saw has its own "What you contributed" summary instead.
  if (!["scale", "foundation"].includes(stage)) return null;
  const asked = thread?.asked ?? false;
  const about = thread?.householdLabel ? `“${thread.householdLabel}”` : "your own question";
  let line: string;
  let action: string | null = null;
  if (!asked) {
    line = "You haven't asked the AI yet.";
    action = "Ask the AI";
  } else if (stage === "scale") {
    line =
      thread?.householdId === "az-savings"
        ? `You asked about the Arizona household below: every one of the ${POLICYBENCH.azCase.modelsAsked} models said it gets $0.`
        : `You asked about ${about}. Here's how AI does at scale.`;
  } else {
    // The rules check lives in the chatbot demo now, so the foundation just recalls the question.
    line = `You asked about ${about}.`;
  }
  return (
    <div className="mb-10 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 sm:p-5">
      <span className="mb-1.5 block font-body text-[1.08rem] font-semibold text-[var(--color-ink)]">Your question</span>
      <p className="m-0 font-body text-[1.08rem] leading-snug text-[var(--color-ink)]">
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

/**
 * The top of What we saw on a phone: what this person put in, each with a
 * check when done or a way to do it now. The room's results follow.
 */
export function YourContribution({ thread, onOpen }: { thread: ThreadQuestion | null; onOpen: () => void }) {
  const [shared, setShared] = useState(false);
  useEffect(() => {
    setShared(Boolean(readStored<boolean>(OVERALL_KEY)));
  }, []);
  const asked = thread?.asked ?? false;
  const rated = thread?.rated ?? false;
  const about = thread?.householdLabel ? `“${thread.householdLabel}”` : "your own question";
  const rows: { done: boolean; text: string; action: string | null }[] = [
    { done: asked, text: asked ? `You asked about ${about}.` : "You haven't asked the AI yet.", action: asked ? null : "Ask the AI" },
    {
      done: rated,
      text: rated ? "You rated the answer." : "You haven't rated an answer yet.",
      action: asked && !rated ? "Rate my answer" : null,
    },
    {
      done: shared,
      text: shared ? "You shared how AI did overall." : "You haven't shared how AI did overall.",
      action: shared ? null : "Share it",
    },
  ];
  return (
    <section aria-labelledby="aspen-you" className="mb-10 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 sm:p-5">
      <h2 id="aspen-you" className="m-0 mb-3 font-body text-[1.4rem] font-semibold text-[var(--color-ink)]">
        What you contributed
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => (
          <li key={r.text} className="flex items-start gap-3 font-body text-[1.08rem] leading-snug text-[var(--color-ink)]">
            <span aria-hidden className={`w-5 shrink-0 text-center ${r.done ? "text-[var(--color-success)]" : "text-[var(--color-rule-strong)]"}`}>
              {r.done ? "✓" : "○"}
            </span>
            <span>
              {r.text}
              {r.action && (
                <>
                  {" "}
                  <button type="button" className="aspen-link whitespace-nowrap font-medium" onClick={onOpen}>
                    {r.action} →
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
    <div className="flex flex-col gap-8">
      <BlockHeading>Across {POLICYBENCH.models} AI models</BlockHeading>
      <Part n={1} title="Families who qualify, told $0">
        <Card className="flex flex-col gap-2 border-l-4 border-l-[var(--color-error)] p-5">
          <span className="font-display text-[3.6rem] font-light leading-none tabular-nums text-[var(--color-error)]">
            {zeroShare}%
          </span>
          <p className="m-0 font-body text-[1.15rem] leading-snug text-[var(--color-ink)]">
            of AI answers told a family that qualifies for SNAP they&apos;d get <strong>$0</strong>.
          </p>
          <p className="m-0 font-body text-[1.02rem] text-[var(--color-ink)]">
            {POLICYBENCH.saidZero} of {POLICYBENCH.eligibleAnswers} answers, from {POLICYBENCH.models} models.
          </p>
        </Card>
      </Part>
      <Part n={2} title="One Arizona household">
        <Card className="flex flex-col gap-3 p-5">
          <p className="m-0 font-body text-[1.08rem] leading-relaxed text-[var(--color-ink)]">{az.description}</p>
          <p className="m-0 font-body text-[1.08rem] font-semibold leading-relaxed text-[var(--color-error)]">
            {az.modelsSaidZero === az.modelsAsked ? `All ${az.modelsAsked}` : `${az.modelsSaidZero} of ${az.modelsAsked}`} AI
            models said $0.
          </p>
          <p className="m-0 font-body text-[1.08rem] leading-relaxed">
            <strong className="text-[var(--color-accent)]">
              PolicyEngine&apos;s reference in PolicyBench, under {az.reference.standards} standards: ${az.reference.monthly} a month.
            </strong>{" "}
            The minimum benefit rose to ${az.fromOctober.monthly} on {az.fromOctober.effective}.
          </p>
        </Card>
      </Part>
      <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink)]">
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

/**
 * Shared foundation on a phone, in What we saw's shape: a block heading for
 * the idea, then numbered parts (what you can check, what it powers, how it
 * gets built), with the room's own answer first once people have given one.
 */
export function FoundationContent({ sourceOfTruth }: { sourceOfTruth?: Count[] }) {
  const asked = sourceOfTruth?.some((c) => c.count > 0) ?? false;
  let n = 0;
  return (
    <div className="flex flex-col gap-8">
      <BlockHeading>One open, validated set of rules</BlockHeading>
      {asked && sourceOfTruth && (
        <Part n={++n} title="Checking answers in this room">
          <SourceOfTruthCard counts={sourceOfTruth} />
        </Part>
      )}
      <Part n={++n} title="What you can check">
        <ul className="m-0 flex list-none flex-col gap-3 rounded-xl bg-[var(--color-ink)] p-5 font-body text-[1.08rem] leading-snug text-white">
          {FOUNDATION_TRAITS.map((trait) => (
            <li key={trait} className="flex gap-2.5">
              <Check aria-hidden size={20} strokeWidth={2.25} className="mt-[2px] shrink-0 text-[#e8a25c]" />
              {trait}
            </li>
          ))}
        </ul>
      </Part>
      <Part n={++n} title="What it powers">
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-3">
          {ONE_SET_OF_RULES.map((use) => (
            <li
              key={use.label}
              className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3.5 py-3 font-body text-[1.08rem] font-medium leading-snug text-[var(--color-ink)]"
            >
              {use.label}
            </li>
          ))}
        </ul>
        <p className="m-0 max-w-[680px] font-body text-[1.15rem] font-medium leading-snug text-[var(--color-ink)]">
          {ONE_SET_STATEMENT.text} <span className="text-[var(--color-accent)]">{ONE_SET_STATEMENT.accent}</span>
        </p>
      </Part>
      <Part n={++n} title={BUILD_HEADING}>
        <GoldenContent />
      </Part>
    </div>
  );
}

/**
 * The three steps, as rows a phone can scan: the medallion, the tier and its
 * name show; a tap opens what the state gets and what it takes. Native
 * <details>, so keyboards and screen readers get it for free.
 */
export function GoldenContent() {
  const cards: Record<string, string> = { "Silver A": "bg-[#eef0f2]", "Gold A": "border-[#b7862b] bg-[#f6eed8]" };
  return (
    <div className="flex flex-col gap-3">
      {GOLDEN_A.map((tier) => (
        <details key={tier.tier} className={`group rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] ${cards[tier.tier] ?? ""}`}>
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <TierMedal medal={tier.medal} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block font-body text-[0.95rem] font-medium text-[var(--color-ink-muted)]">{tier.tier}</span>
              <span className="block font-body text-[1.12rem] font-semibold leading-snug text-[var(--color-ink)]">{tier.name}</span>
            </span>
            <svg aria-hidden viewBox="0 0 12 12" className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)] transition-transform group-open:rotate-180">
              <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="flex flex-col gap-2 px-4 pb-4">
            <p className="m-0 font-body text-[1.05rem] leading-relaxed text-[var(--color-ink)]">{tier.gets}</p>
            {"goal" in tier && <p className="m-0 font-body text-[1.05rem] leading-relaxed text-[var(--color-ink)]">{tier.goal}</p>}
            {"programs" in tier && (
              <p className="m-0 font-body text-[1.02rem] leading-relaxed text-[var(--color-ink-secondary)]">
                {(tier.programs as readonly string[]).join(" · ")}
              </p>
            )}
            <p className="m-0 font-body text-[1.02rem] leading-relaxed text-[var(--color-ink-secondary)]">
              <span className="font-semibold text-[var(--color-ink)]">It takes:</span> {tier.takes}
            </p>
          </div>
        </details>
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

/**
 * Small groups: the group's pick (this phone's own vote to start with), then
 * the three questions, one box each, and an optional box for what else came
 * up (barriers, workforce, questions). The report-back card on the big screen
 * shows the same three.
 */
export function GroupsCard({ stage }: { stage: string }) {
  const [useCase, setUseCase] = useState<string | null>(null);
  useEffect(() => {
    const voted = readStored<string>(VOTE_KEY);
    if (voted && USE_CASES.some((u) => u.id === voted)) setUseCase(voted);
  }, []);
  const [answers, setAnswers] = useState<Record<(typeof GROUP_QUESTIONS)[number]["id"], string>>({ note: "", who: "", trust: "" });
  const [raised, setRaised] = useState("");
  const [shared, setShared] = useState(0);
  const anything = [...Object.values(answers), raised].some((v) => v.trim());

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <p className="m-0 border-l-2 border-[var(--color-accent)] pl-4 font-body text-[1.08rem] leading-relaxed text-[var(--color-ink)]">
        {GROUP_PHONE_INTRO}
      </p>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Name
            <input className={FIELD} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className={label}>
            Title
            <input className={FIELD} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" />
          </label>
          <label className={label}>
            State
            <select className={FIELD} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Pick a state</option>
              {US_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
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
    { label: "The Axiom Foundation", detail: "Open, validated rules for every state.", href: "https://axiom.org" },
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
