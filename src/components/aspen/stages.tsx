"use client";

import { useState } from "react";
import {
  BREAKOUT_PROMPT,
  EVENT,
  GOLDEN_A,
  NEXT_STEPS,
  ONE_SET_OF_RULES,
  PERSPECTIVES,
  POLICYBENCH,
  ROLES,
  STAGES,
  USE_CASES,
  US_STATES,
  percent,
  type StageId,
} from "@/lib/aspen/content";
import type { Count, RunSummary } from "@/lib/aspen/results";
import { SourceOfTruthCard } from "./results-board";
import { countWord, snapQcTotals } from "@/lib/verification-evidence";
import { participantId, postJson, sendEvent, type Profile } from "./client";
import { Disclosure } from "./disclosure";
import { BUTTON, Card, Eyebrow, FIELD } from "./ui";

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
 * The evening at a glance: one numbered line through every segment (the
 * red thread), with the live segment marked. `current` marks where the
 * participant is (the session menu); `compact` drops the descriptions.
 */
export function Agenda({
  live,
  current,
  onPick,
  compact = false,
  columns = 1,
}: {
  live?: StageId | null;
  current?: StageId;
  onPick?: (id: StageId) => void;
  compact?: boolean;
  /** Two short threads side by side (1–4, 5–8), for the one-screen landing. */
  columns?: 1 | 2;
}) {
  const liveIndex = live ? STAGES.findIndex((s) => s.id === live) : -1;
  const dense = columns === 2;
  const tight = compact || dense;

  const list = (indices: number[]) => (
    // Tappable rows carry side padding for their highlight; pull the list back so the circles keep their edge.
    <ol className={`relative m-0 flex list-none flex-col p-0 ${onPick ? "-mx-1.5" : ""}`}>
      <span
        aria-hidden
        className={`absolute w-[2px] rounded-full bg-[var(--color-accent)] opacity-70 ${onPick ? (dense ? "left-[17px]" : "left-[19px]") : dense ? "left-[11px]" : "left-[13px]"} ${tight ? "bottom-4 top-4" : "bottom-6 top-6"}`}
      />
      {indices.map((i) => {
        const stage = STAGES[i];
        const isLive = i === liveIndex;
        const done = liveIndex > i;
        const here = current === stage.id;
        const row = (
          <>
            <span
              className={`relative z-1 flex items-center justify-center rounded-full border-2 font-mono tabular-nums ${dense ? "h-6 w-6 text-[0.62rem]" : "h-7 w-7 text-[0.68rem]"} ${
                isLive
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                  : done
                    ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-paper))] text-[var(--color-accent)]"
                    : "border-[var(--color-accent)] bg-[var(--color-paper)] text-[var(--color-accent)]"
              }`}
            >
              {isLive && dense && (
                <span aria-hidden className="absolute inset-[-3px] animate-ping rounded-full border-2 border-[var(--color-accent)] opacity-40" />
              )}
              {i + 1}
            </span>
            <span className={tight ? "self-center" : "pb-1"}>
              <span
                className={`flex flex-wrap items-center gap-2 font-body text-[var(--color-ink)] ${dense ? "text-[0.9rem] leading-tight" : "text-[1rem]"} ${here ? "font-semibold" : "font-medium"}`}
              >
                {stage.label}
                {stage.optional && !tight && (
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    if the room allows
                  </span>
                )}
                {isLive &&
                  (dense ? (
                    <span className="sr-only">Now</span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-white">
                      <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
                      Now
                    </span>
                  ))}
                {here && compact && <span className="sr-only">You are here</span>}
              </span>
              {!tight && (
                <span className="block font-body text-[0.88rem] leading-snug text-[var(--color-ink-secondary)]">
                  {stage.agenda}
                </span>
              )}
            </span>
          </>
        );
        const grid = `grid w-full items-start text-left ${dense ? "grid-cols-[24px_minmax(0,1fr)] gap-2.5 py-0.5 sm:py-1" : `grid-cols-[28px_minmax(0,1fr)] gap-4 ${tight ? "py-1.5" : "py-2.5"}`}`;
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

  const all = STAGES.map((_, i) => i);
  if (!dense) return list(all);
  const half = Math.ceil(all.length / 2);
  return (
    <div className="grid grid-cols-2 items-start gap-x-3">
      {list(all.slice(0, half))}
      {list(all.slice(half))}
    </div>
  );
}

export function ProfileForm({
  profile,
  onChange,
  onDone,
  compact = false,
}: {
  profile: Profile;
  onChange: (profile: Profile) => void;
  onDone?: () => void;
  /** Labels only, for the one-screen landing. */
  compact?: boolean;
}) {
  const select = `${FIELD} px-2.5 text-[0.92rem]`;
  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      <fieldset className="m-0 border-0 p-0">
        <legend className={compact ? "sr-only" : "mb-2.5 font-body text-[0.92rem] text-[var(--color-ink-secondary)]"}>
          Tonight, ask as
        </legend>
        <div className="grid grid-cols-2 gap-2.5">
          {PERSPECTIVES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={profile.perspective === p.id}
              onClick={() => onChange({ ...profile, perspective: p.id })}
              className={`${OPTION} ${compact ? "py-2.5" : ""} ${profile.perspective === p.id ? OPTION_ON : OPTION_OFF}`}
            >
              <span className="block font-body text-[1rem] font-medium text-[var(--color-ink)]">{p.label}</span>
              {!compact && (
                <span className="block font-body text-[0.8rem] leading-snug text-[var(--color-ink-muted)]">{p.description}</span>
              )}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex min-w-0 flex-col gap-1.5 font-body text-[0.82rem] text-[var(--color-ink-muted)]">
          <span className={compact ? "sr-only" : undefined}>Your state (optional)</span>
          <select
            className={select}
            value={profile.state ?? ""}
            onChange={(e) => onChange({ ...profile, state: e.target.value || null })}
          >
            <option value="">{compact ? "Your state" : "Choose"}</option>
            {US_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 font-body text-[0.82rem] text-[var(--color-ink-muted)]">
          <span className={compact ? "sr-only" : undefined}>Your role (optional)</span>
          <select
            className={select}
            value={profile.role ?? ""}
            onChange={(e) => onChange({ ...profile, role: e.target.value || null })}
          >
            <option value="">{compact ? "Your role" : "Choose"}</option>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      {onDone && (
        <button type="button" className={`${BUTTON} mt-1 w-full py-3 text-[1rem]`} onClick={onDone}>
          Start: ask the AI <span aria-hidden>→</span>
        </button>
      )}
    </div>
  );
}

export { Disclosure };

/**
 * The landing fits one screen: on wide screens the hero and the evening sit
 * left of the start card; on a phone they stack, tightened to fit.
 */
export function WelcomeLanding({
  profile,
  live,
  onProfile,
  onStart,
  onPick,
}: {
  profile: Profile;
  live: StageId | null;
  onProfile: (profile: Profile) => void;
  onStart: () => void;
  onPick: (id: StageId) => void;
}) {
  const label = "m-0 mb-2 font-mono text-[0.64rem] font-normal uppercase tracking-[0.18em] text-[var(--color-accent)]";
  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col justify-center gap-4 py-2 md:grid md:grid-cols-[1.15fr_1fr] md:items-center md:gap-12 md:py-4">
      <div className="flex flex-col gap-4 md:gap-8">
        <section>
          <span className="kicker mb-2 inline-flex md:mb-5">
            <span className="kicker-mark">&sect;</span>
            Aspen Institute · {EVENT.place}
          </span>
          <h1 className="heading-page m-0 mb-3 text-balance md:mb-4" style={{ fontSize: "clamp(1.45rem, 1rem + 2vw, 2.4rem)" }}>
            {EVENT.title}
          </h1>
          <p className="m-0 max-w-[520px] font-body text-[0.98rem] leading-relaxed text-[var(--color-ink-secondary)] text-pretty md:text-[1.08rem]">
            Residents already ask AI about benefits. Tonight you ask it too
            <span className="hidden sm:inline">
              , and we follow <span className="serif-italic text-[var(--color-ink)]">one question</span> through the
              evening
            </span>
            .
          </p>
          <p className="m-0 mt-3 hidden font-mono text-[0.68rem] leading-relaxed tracking-[0.04em] text-[var(--color-ink-muted)] sm:block">
            <span>{EVENT.date}</span>
            <span className="hidden sm:inline"> · With {EVENT.hosts}</span>
          </p>
        </section>

        <section>
          <h2 className={label}>
            <span className="text-[var(--color-accent)]">The evening</span>
          </h2>
          <Agenda live={live} onPick={onPick} columns={2} />
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 shadow-[0_1px_3px_rgba(28,25,23,0.05)] md:p-6">
        <h2 className={`${label} mb-0`}>
          <span className="text-[var(--color-accent)]">Start here</span>{" "}
          <span className="text-[var(--color-ink-muted)]">· Tonight, ask as</span>
        </h2>
        <ProfileForm profile={profile} onChange={onProfile} onDone={onStart} compact />
        <Disclosure onOpen={() => sendEvent("disclosure", { opened: true }, "welcome")} />
      </section>
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
 * The participant's own question, carried through the evening: a short
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
// What we saw: discussion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// At scale: PolicyBench
// ---------------------------------------------------------------------------

export function PolicyBenchContent() {
  const zeroShare = percent(POLICYBENCH.saidZero, POLICYBENCH.eligibleAnswers);
  const bbceShare = percent(POLICYBENCH.saidZeroBbce, POLICYBENCH.saidZero);
  const az = POLICYBENCH.azCase;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-2 p-5">
          <span className="font-display text-[3.4rem] font-light leading-none tabular-nums text-[var(--color-error)]">
            {zeroShare}%
          </span>
          <p className="m-0 font-body text-[1.02rem] leading-snug text-[var(--color-ink)]">
            of AI answers told a household that qualifies for SNAP it would get <strong>$0</strong>.
          </p>
          <p className="m-0 font-body text-[0.84rem] text-[var(--color-ink-muted)]">
            {POLICYBENCH.saidZero} of {POLICYBENCH.eligibleAnswers} answers from {POLICYBENCH.models} models, for{" "}
            {POLICYBENCH.eligibleHouseholds} households that qualify.
          </p>
        </Card>
        <Card className="flex flex-col gap-2 p-5">
          <span className="font-display text-[3.4rem] font-light leading-none tabular-nums text-[var(--color-ink)]">
            {bbceShare}%
          </span>
          <p className="m-0 font-body text-[1.02rem] leading-snug text-[var(--color-ink)]">
            of those wrongful denials missed <strong>broad-based categorical eligibility</strong>.
          </p>
          <p className="m-0 font-body text-[0.84rem] text-[var(--color-ink-muted)]">
            Even the best models told {POLICYBENCH.bestModelZeros} of {POLICYBENCH.eligibleHouseholds} eligible
            households they would get nothing.
          </p>
        </Card>
      </div>
      <Card className="border-l-4 border-l-[var(--color-error)] p-5">
        <Eyebrow className="mb-2 text-[var(--color-error)]">
          An Arizona household · {az.modelsSaidZero} of {az.modelsAsked} models said $0
        </Eyebrow>
        <p className="m-0 font-body text-[1rem] leading-relaxed text-[var(--color-ink)]">{az.description}</p>
        <p className="m-0 mt-2 font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
          <strong className="text-[var(--color-ink)]">The rules:</strong> {az.answer}
        </p>
      </Card>
      <p className="m-0 max-w-[640px] font-body text-[1rem] leading-relaxed text-[var(--color-ink)]">
        A tool built on a wrong answer tells eligible people they don&apos;t qualify, and many of them{" "}
        <span className="serif-italic">stop applying</span>.
      </p>
      <p className="m-0 font-body text-[0.78rem] text-[var(--color-ink-muted)]">
        PolicyBench, snapshot of {POLICYBENCH.snapshot}. Models answered without tools; reference values from
        PolicyEngine.{" "}
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
// Small groups
// ---------------------------------------------------------------------------

export function GroupsCard({ stage }: { stage: string }) {
  const [useCase, setUseCase] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 font-body text-[0.95rem] font-medium text-[var(--color-ink)]">
          A tool that lets your team
        </legend>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((u) => (
            <button
              key={u.id}
              type="button"
              aria-pressed={useCase === u.id}
              onClick={() => setUseCase(u.id)}
              className={`${OPTION} ${useCase === u.id ? OPTION_ON : OPTION_OFF}`}
            >
              <span className="block font-body text-[1rem] font-medium text-[var(--color-ink)]">{u.label}</span>
              <span className="block font-body text-[0.83rem] leading-snug text-[var(--color-ink-muted)]">{u.detail}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex max-w-[760px] flex-col gap-2 font-body text-[0.95rem] text-[var(--color-ink)]">
        {BREAKOUT_PROMPT}
        <textarea
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSent(false);
          }}
          className={FIELD}
          placeholder="Your group's ideas"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={BUTTON}
          disabled={!useCase && !note.trim()}
          onClick={() => {
            sendEvent("breakout", { useCase, note }, stage);
            setSent(true);
          }}
        >
          Save our ideas
        </button>
        {sent && <span className="font-body text-[0.85rem] text-[var(--color-success)]">Saved.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

export function NextStepsForm({ profile }: { profile: Profile }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState(profile.state ?? "");
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

export function ThankYouContent({ summary }: { summary?: RunSummary | null }) {
  const links = [
    { label: "Try the rules chatbot", href: "https://axiom.org/gallery/chatbot" },
    { label: "PolicyBench", href: POLICYBENCH.url },
    { label: "The Axiom Foundation", href: "https://axiom.org" },
  ];
  const states = summary?.pledges.states.length ?? 0;
  return (
    <div className="flex flex-col gap-8">
      {summary && summary.prompts > 0 && (
        <Card className="p-5 sm:p-6">
          <Eyebrow className="mb-4 text-[var(--color-accent)]">Tonight, this room</Eyebrow>
          <div className={`grid gap-4 ${states > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
            <div>
              <span className="block font-display text-[2.4rem] font-light leading-none tabular-nums">{summary.prompts}</span>
              <span className="font-body text-[0.85rem] text-[var(--color-ink-muted)]">questions asked</span>
            </div>
            <div>
              <span className="block font-display text-[2.4rem] font-light leading-none tabular-nums">{summary.rated}</span>
              <span className="font-body text-[0.85rem] text-[var(--color-ink-muted)]">answers rated</span>
            </div>
            {states > 0 && (
              <div>
                <span className="block font-display text-[2.4rem] font-light leading-none tabular-nums text-[var(--color-accent)]">
                  {states}
                </span>
                <span className="font-body text-[0.85rem] text-[var(--color-ink-muted)]">
                  {states === 1 ? "state" : "states"} ready to go further
                </span>
              </div>
            )}
          </div>
        </Card>
      )}
      <div className="flex flex-col gap-3">
        <p className="m-0 max-w-[620px] font-display text-[1.35rem] font-light leading-snug text-[var(--color-ink)]">
          Thank you to the Aspen Institute and to every leader in the room.{" "}
          <span className="serif-italic">Enjoy dinner.</span>
        </p>
        <p className="m-0 max-w-[620px] font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
          We&apos;ll follow up with every state that asked. This page stays open this week, so you can come back to
          your answers. Questions: {EVENT.contactEmail}.
        </p>
        <p className="m-0 font-body text-[0.9rem] text-[var(--color-ink-muted)]">{EVENT.hosts}</p>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-4 py-2 font-body text-[0.92rem] text-[var(--color-ink)] no-underline hover:border-[var(--color-accent)]"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
