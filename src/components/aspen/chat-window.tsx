"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEMO_NOTE,
  HOUSEHOLDS,
  PERSPECTIVES,
  QUESTIONS,
  QUESTION_IDS,
  TWIST_GROUPS,
  TWIST_IDS,
  composePrompt,
  findHousehold,
  isPerspectiveId,
  orderedQuestions,
  twistsFor,
  type PerspectiveId,
  type QuestionId,
} from "@/lib/aspen/content";
import type { ChatSource } from "@/lib/aspen/openai";
import { AnswerText } from "./answer-text";
import { RatingCard, readRatingDraft } from "./answer-feedback";
import { CHAT_KEY, newId, participantId, readStored, sendEvent, writeStored } from "./client";
import { Disclosure } from "./disclosure";
import { BUTTON, BUTTON_QUIET, Chip, FIELD, STEP_NUMBER } from "./ui";

/**
 * The hands-on segment: pick a perspective and a household, send the
 * composed (and editable) question to the chatbot, rate the answer,
 * and, once the presenter reaches "A shared foundation", check it against
 * the rules. A new question waits until the last answer is rated.
 */

/** What the shell needs from the chat. */
export interface ChatStatus {
  /** An answer came back in this chat. */
  asked: boolean;
  /** Some answer is rated (Try it's Next link opens). */
  rated: boolean;
  /** The current conversation's newest answer is rated (the overall rating shows under it). */
  current: boolean;
}

export interface Turn {
  key: string;
  role: "user" | "assistant";
  content: string;
  promptId?: string;
  status?: "streaming" | "done" | "error";
  statusText?: string;
  model?: string;
  backend?: string;
  webSearch?: boolean;
  sources?: ChatSource[];
}

const OWN = "own";
/** A numbered step heading in the composer, bold so each step stands out: ask as, household, details, questions, your question. */
const STEP = "mb-3 flex items-center gap-2.5 font-body text-[1.08rem] font-semibold text-[var(--color-ink)]";
/** The quieter part of a step heading, such as "(optional)". */
const STEP_NOTE = "font-normal text-[var(--color-ink-muted)]";
export { CHAT_KEY };

export interface SavedChat {
  perspective: PerspectiveId;
  householdId: string | null;
  /** The questions picked, in display order. */
  questionIds: QuestionId[];
  /** Saves from before several questions could be picked. */
  questionId?: QuestionId;
  /** Details added to the household (TWISTS ids). */
  twists?: string[];
  draft: string;
  template: string | null;
  conversationId: string;
  turns: Turn[];
  rated: string[];
}

/** A source's host for its label; the raw URL when it does not parse. */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Reads an NDJSON response body line by line. */
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onLine: (line: Record<string, unknown>) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onLine(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Skip a garbled line rather than lose the answer.
      }
    }
    if (done) break;
  }
}

export function ChatWindow({
  stage,
  onRateOverall,
  onStatus,
  onNewQuestion,
}: {
  stage: string;
  /** Leads to the two questions about the agency, below the chat, once the answer is rated. */
  onRateOverall?: () => void;
  onStatus?: (status: ChatStatus) => void;
  /** Called when the participant starts a new question. */
  onNewQuestion?: () => void;
}) {
  const [perspective, setPerspective] = useState<PerspectiveId>("resident");
  // Nothing is picked until the participant picks: a default would skew "Households picked".
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [questionIds, setQuestionIds] = useState<QuestionId[]>(["amount"]);
  const [twists, setTwists] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => newId());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [rated, setRated] = useState<Set<string>>(new Set());
  // After the first answer the follow-up box stays closed, so rating comes next.
  const [followUp, setFollowUp] = useState(false);
  // A picked household asks its question as written; details, question type and edits open on request.
  const [editing, setEditing] = useState(false);
  // "Change the question" goes away when pressed; focus moves to the details it opens, not to the page.
  const detailsLegend = useRef<HTMLLegendElement>(null);
  const focusDetails = useRef(false);
  useEffect(() => {
    if (!editing || !focusDetails.current) return;
    focusDetails.current = false;
    detailsLegend.current?.focus({ preventScroll: true });
  }, [editing]);
  const threadEnd = useRef<HTMLDivElement>(null);
  const draftBox = useRef<HTMLTextAreaElement>(null);
  const ratingBox = useRef<HTMLElement>(null);
  const chatCard = useRef<HTMLDivElement>(null);
  // False until the saved conversation is read, so the first render never overwrites it.
  const [hydrated, setHydrated] = useState(false);

  // A phone that reloads (or a browser that drops the tab) keeps its conversation.
  useEffect(() => {
    const saved = readStored<SavedChat>(CHAT_KEY);
    if (saved && Array.isArray(saved.turns)) {
      setPerspective(isPerspectiveId(saved.perspective) ? saved.perspective : "resident");
      setHouseholdId(saved.householdId ?? null);
      const savedQuestions = Array.isArray(saved.questionIds) ? saved.questionIds : saved.questionId ? [saved.questionId] : [];
      const known = orderedQuestions(savedQuestions.filter((q) => QUESTION_IDS.includes(q)));
      setQuestionIds(known.length ? known : ["amount"]);
      setTwists(Array.isArray(saved.twists) ? saved.twists.filter((t) => TWIST_IDS.includes(t)) : []);
      setDraft(saved.draft ?? "");
      setTemplate(saved.template ?? null);
      setConversationId(saved.conversationId);
      setTurns(
        saved.turns.map((t) =>
          t.status === "streaming" ? { ...t, status: "error", content: "Interrupted. Ask again." } : t,
        ),
      );
      // A card whose latest save never confirmed reopens with it, even if an earlier save finished the card.
      setRated(new Set((saved.rated ?? []).filter((id) => !readRatingDraft(id)?.unsaved)));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStored(CHAT_KEY, {
      perspective,
      householdId,
      questionIds,
      twists,
      draft,
      template,
      conversationId,
      // An answer still on its way is kept as a placeholder, so a reload or another tab says it was cut off.
      turns: turns.map((t) => (t.status === "streaming" ? { key: t.key, role: t.role, content: "", status: t.status, promptId: t.promptId } : t)),
      rated: [...rated],
    } satisfies SavedChat);
  }, [hydrated, perspective, householdId, questionIds, twists, draft, template, conversationId, turns, rated]);

  const asked = turns.some((t) => t.role === "assistant" && t.status === "done");
  const newestAnswer = turns.findLast((t) => t.role === "assistant" && t.status === "done" && t.promptId);
  const current = Boolean(newestAnswer?.promptId && rated.has(newestAnswer.promptId));
  useEffect(() => {
    if (hydrated) onStatus?.({ asked, rated: rated.size > 0, current });
  }, [hydrated, asked, rated, current, onStatus]);

  // The question box grows to show the whole question, so nobody scrolls inside it on a phone.
  // Measuring collapses it for a moment, which would shorten the page and jump it while typing:
  // the scroll position goes back where it was.
  useEffect(() => {
    const el = draftBox.current;
    if (!el) return;
    const y = window.scrollY;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
    if (window.scrollY !== y) window.scrollTo({ top: y, behavior: "instant" });
  }, [draft, editing]);

  const started = turns.length > 0;
  const household = findHousehold(householdId);
  // Steps number in the order they show: details, questions and the editable question open under "Change the question".
  const step = household
    ? { askAs: 1, household: 2, details: 3, question: 4, draft: editing ? 5 : 3 }
    : { askAs: 1, household: 2, details: null, question: null, draft: 3 };
  // A household's question shows as written until the participant opens it to change it.
  const preview = !started && Boolean(household) && !editing;

  function choose(p: PerspectiveId, h: string | null, q: QuestionId[], t: string[]) {
    const found = findHousehold(h);
    // Details that do not fit the new household drop away.
    const fitting = found ? t.filter((id) => twistsFor(found).some((tw) => tw.id === id)) : t;
    setPerspective(p);
    setHouseholdId(h);
    setQuestionIds(q);
    setTwists(fitting);
    if (found) {
      const composed = composePrompt(p, found, q, fitting);
      setDraft(composed);
      setTemplate(composed);
    } else {
      // Keep a question the participant typed; drop one the chips wrote.
      setDraft((d) => (d === template ? "" : d));
      setTemplate(null);
    }
  }

  function pick(next: { p?: PerspectiveId; h?: string; q?: QuestionId; twist?: string }) {
    const p = next.p ?? perspective;
    const h = next.h ?? householdId;
    // Questions toggle; the last one picked stays, so there is always something to ask.
    const q = !next.q
      ? questionIds
      : questionIds.includes(next.q)
        ? questionIds.length > 1
          ? questionIds.filter((id) => id !== next.q)
          : questionIds
        : orderedQuestions([...questionIds, next.q]);
    const t = next.twist
      ? twists.includes(next.twist)
        ? twists.filter((id) => id !== next.twist)
        : [...twists, next.twist]
      : twists;
    choose(p, h, q, t);
    sendEvent("chip", { perspective: p, householdId: h, questionIds: q, twists: t }, stage);
  }

  /** A new question starts blank: no household, details or text. Who you ask as stays. */
  function startOver() {
    setFollowUp(false);
    setEditing(false);
    setTurns([]);
    setConversationId(newId());
    setHouseholdId(null);
    setTwists([]);
    setQuestionIds(["amount"]);
    setDraft("");
    setTemplate(null);
    onNewQuestion?.();
  }

  /** Asks `text` after the turns in `base`: the box's question after the whole conversation, or a question asked again. */
  async function send(text = draft.trim(), base = turns) {
    if (!text || sending) return;
    const history = base
      .filter((t) => t.status !== "error" && t.status !== "streaming")
      .map((t) => ({ role: t.role, content: t.content }));
    const messages = [...history, { role: "user" as const, content: text }];
    const turnIndex = base.filter((t) => t.role === "user").length;
    const userKey = newId();
    const answerKey = newId();
    setTurns([
      ...base,
      { key: userKey, role: "user", content: text },
      { key: answerKey, role: "assistant", content: "", status: "streaming", statusText: "Thinking" },
    ]);
    setDraft("");
    setFollowUp(false);
    setSending(true);
    const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
      setTurns((prev) =>
        prev.map((t) => (t.key === answerKey ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)),
      );
    try {
      const response = await fetch("/api/aspen/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: participantId(),
          conversationId,
          turn: turnIndex,
          messages,
          meta: {
            stage,
            perspective,
            householdId: householdId === OWN ? null : householdId,
            questionIds: turnIndex === 0 && householdId !== OWN ? questionIds : [],
            twists: householdId !== OWN && household ? twists : [],
            promptTemplate: turnIndex === 0 ? template : null,
          },
        }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        update({ status: "error", content: data.error ?? "The chatbot didn't answer. Try again." });
        return;
      }
      await readNdjson(response.body, (line) => {
        if (line.type === "meta") update({ promptId: String(line.promptId) });
        else if (line.type === "status") update({ statusText: String(line.text) });
        else if (line.type === "delta") update((t) => ({ content: t.content + String(line.text), statusText: undefined }));
        else if (line.type === "done") {
          update({
            status: "done",
            model: typeof line.model === "string" ? line.model : undefined,
            backend: typeof line.backend === "string" ? line.backend : undefined,
            webSearch: line.webSearch === true,
            sources: Array.isArray(line.sources) ? (line.sources as ChatSource[]) : [],
          });
        } else if (line.type === "error") update({ status: "error", content: String(line.message) });
      });
      update((t) =>
        t.status !== "streaming"
          ? {}
          : t.content
            ? { status: "done" }
            : { status: "error", content: "The AI didn't answer. Try again." },
      );
    } catch {
      update({ status: "error", content: "The connection dropped. Try again." });
    } finally {
      setSending(false);
      requestAnimationFrame(() => threadEnd.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
    }
  }

  // The newest finished answer: the one the participant rates and checks, below the chat box.
  const latestIndex = turns.findLastIndex((t) => t.role === "assistant" && t.status === "done" && t.promptId);
  const latest =
    latestIndex >= 0
      ? {
          promptId: turns[latestIndex].promptId,
          messages: turns.slice(0, latestIndex).map((t) => ({ role: t.role, content: t.content })),
        }
      : null;
  // Rating is not optional for Try it, but a blank question can go back and forth first:
  // its follow-ups don't wait for the rating. Start over never waits.
  const mustRate = Boolean(latest?.promptId && !rated.has(latest.promptId));
  const blank = householdId === OWN || householdId === null;
  const followUpWaits = mustRate && !blank;

  const tile = (selected: boolean) =>
    `flex flex-col items-start justify-start rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${
      selected
        ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
        : "border-[var(--color-rule)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]"
    }`;

  // On a phone the grid has one column. It must be minmax(0, 1fr), not the
  // implicit auto track: an auto track grows to its widest unbreakable line,
  // and a long web-search source title (one line, truncated) pushed the
  // answer, the rating card and the rules check past a 375px screen.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-8">
      <div
        ref={chatCard}
        className="scroll-mt-20 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] shadow-[0_1px_3px_rgba(28,25,23,0.05)]"
      >
        {started && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-rule)] px-4 py-3">
            <span className="font-body text-[0.95rem] text-[var(--color-ink-secondary)]">Your conversation</span>
            <button type="button" className="aspen-link font-body text-[1rem] font-medium" onClick={startOver}>
              Start over
            </button>
          </div>
        )}

        {!started && (
          <div className="flex flex-col gap-5 px-4 pt-4">
            {(householdId !== null || draft.trim() !== "") && (
              <button type="button" className="aspen-link -mb-2 self-end font-body text-[1rem] font-medium" onClick={startOver}>
                Start over
              </button>
            )}
            <fieldset className="m-0 border-0 p-0">
              <legend className={STEP}>
                <span className={STEP_NUMBER}>{step.askAs}</span>Ask as
              </legend>
              <div role="group" aria-label="Ask as" className="grid grid-cols-2 gap-1 rounded-full border border-[var(--color-rule)] bg-[var(--color-paper)] p-1">
                {PERSPECTIVES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={p.label}
                    aria-pressed={perspective === p.id}
                    onClick={() => pick({ p: p.id })}
                    className={`rounded-full px-3.5 py-2.5 font-body text-[1rem] font-medium transition-colors ${
                      perspective === p.id ? "bg-[var(--color-ink)] text-white" : "text-[var(--color-ink)]"
                    }`}
                  >
                    {p.short}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 border-0 border-t border-[var(--color-rule)] p-0 pt-4">
              <legend className={`${STEP} float-left w-full`}>
                <span className={STEP_NUMBER}>{step.household}</span>Pick a household
              </legend>
              <div className="clear-left grid grid-cols-2 gap-2 sm:grid-cols-3">
                {HOUSEHOLDS.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    aria-pressed={householdId === h.id}
                    onClick={() => pick({ h: h.id })}
                    className={tile(householdId === h.id)}
                  >
                    <span className="block font-body text-[0.98rem] font-medium leading-snug text-[var(--color-ink)]">
                      {h.label}
                    </span>
                    <span className="block font-body text-[0.84rem] text-[var(--color-ink-muted)]">{h.state}</span>
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={householdId === OWN}
                  onClick={() => pick({ h: OWN })}
                  className={`${tile(householdId === OWN)} col-span-2 border-dashed sm:col-span-3`}
                >
                  <span className="block font-body text-[0.98rem] font-medium text-[var(--color-ink)]">
                    Start from a blank question
                  </span>
                  <span className="block font-body text-[0.84rem] text-[var(--color-ink-muted)]">
                    Your own question: any benefit, any state
                  </span>
                </button>
              </div>
            </fieldset>
            {household && editing && (
              <fieldset className="m-0 border-0 border-t border-[var(--color-rule)] p-0 pt-4">
                <legend ref={detailsLegend} tabIndex={-1} className={`${STEP} float-left w-full outline-none`}>
                  <span className={STEP_NUMBER}>{step.details}</span>Add details <span className={STEP_NOTE}>(optional)</span>
                </legend>
                <div role="group" aria-label="Details" className="clear-left flex flex-col gap-3">
                  {TWIST_GROUPS.map((g) => {
                    const items = twistsFor(household).filter((t) => t.group === g.id);
                    if (!items.length) return null;
                    return (
                      <div key={g.id} className="flex flex-col gap-1.5">
                        <span className="font-body font-medium text-[0.82rem] text-[var(--color-ink-muted)]">
                          {g.label}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map((t) => (
                            <Chip
                              key={t.id}
                              selected={twists.includes(t.id)}
                              onClick={() => pick({ twist: t.id })}
                              className="px-3 py-1.5 text-[0.92rem]"
                            >
                              {twists.includes(t.id) ? "✓ " : "+ "}
                              {t.label}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {household && editing && (
              <fieldset className="m-0 border-0 border-t border-[var(--color-rule)] p-0 pt-4">
                <legend className={`${STEP} float-left w-full`}>
                  <span className={STEP_NUMBER}>{step.question}</span>What do you want to know?{" "}
                  <span className={STEP_NOTE}>(pick one or more)</span>
                </legend>
                <div role="group" aria-label="Question" className="clear-left flex flex-wrap gap-2">
                  {QUESTIONS.map((q) => (
                    <Chip key={q.id} selected={questionIds.includes(q.id)} onClick={() => pick({ q: q.id })}>
                      {questionIds.includes(q.id) ? "✓ " : ""}
                      {q.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}

        {started && (
          <div className="flex flex-col gap-4 px-4 py-4" aria-live="polite">
            {turns.map((turn, index) =>
              turn.role === "user" ? (
                <div
                  key={turn.key}
                  className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-[var(--color-ink)] px-4 py-2.5 font-body text-[1rem] leading-relaxed text-white"
                >
                  {turn.content}
                </div>
              ) : (
                <div key={turn.key} className="flex flex-col gap-3">
                  {turn.status === "error" ? (
                    <>
                      <p className="m-0 break-words font-body text-[0.92rem] text-[var(--color-error)]">{turn.content}</p>
                      {/* The newest answer failed: one tap asks the same question again, in place of it. */}
                      {index === turns.length - 1 && turns[index - 1]?.role === "user" && (
                        <button
                          type="button"
                          className={`${BUTTON_QUIET} self-start`}
                          disabled={sending}
                          onClick={() => void send(turns[index - 1].content, turns.slice(0, index - 1))}
                        >
                          Ask again
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {turn.content ? (
                        <AnswerText
                          text={turn.content}
                          className="flex flex-col gap-2.5 font-body text-[1.02rem] leading-relaxed text-[var(--color-ink)]"
                        />
                      ) : (
                        <p className="m-0 flex items-center gap-2 font-body text-[0.92rem] text-[var(--color-ink-muted)]" role="status">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
                          {turn.statusText ?? "Thinking"}…
                        </p>
                      )}
                      {turn.status === "done" && (
                        <>
                          {turn.sources && turn.sources.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {turn.sources.slice(0, 6).map((s) => (
                                <a
                                  key={s.url}
                                  href={s.url}
                                  title={s.title || hostname(s.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="max-w-full truncate rounded-full border border-[var(--color-rule)] px-2.5 py-0.5 font-body text-[0.8rem] text-[var(--color-ink-secondary)] no-underline hover:border-[var(--color-accent)]"
                                >
                                  {s.title || hostname(s.url)}
                                </a>
                              ))}
                            </div>
                          )}
                          <span className="font-mono text-[0.95rem] text-[var(--color-ink-muted)]">
                            {turn.model}
                            {turn.webSearch ? " · web search on" : " · no web search"}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              ),
            )}
            <div ref={threadEnd} />
          </div>
        )}

        {started && !followUp ? (
          <div className="flex flex-col gap-2 border-t border-[var(--color-rule)] px-4 py-3">
            {followUpWaits ? (
              <>
                <p className="m-0 font-body text-[0.98rem] text-[var(--color-ink)]">Rate this answer to ask another question.</p>
                {/* The rating comes next, so on a phone it is a button, not a link in the sentence. */}
                <button
                  type="button"
                  className={`${BUTTON} w-full py-3 text-[1rem] lg:hidden`}
                  onClick={() => ratingBox.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
                >
                  Rate it ↓
                </button>
              </>
            ) : (
              <button
                type="button"
                className="aspen-link self-start font-body text-[0.98rem]"
                disabled={sending}
                onClick={() => setFollowUp(true)}
              >
                Ask a follow-up
              </button>
            )}
            <p className="m-0 font-body text-[0.95rem] leading-snug text-[var(--color-ink-muted)]">{DEMO_NOTE}</p>
          </div>
        ) : (
          <div className={`flex flex-col gap-3 px-4 pb-4 ${started ? "border-t border-[var(--color-rule)] pt-3" : "mt-5 border-t border-[var(--color-rule)] pt-4"}`}>
            {preview ? (
              <div role="group" aria-labelledby="aspen-question-preview" className="flex flex-col gap-2">
                <div id="aspen-question-preview" className={`${STEP} mb-0`}>
                  <span className={STEP_NUMBER}>{step.draft}</span>
                  The question
                </div>
                <p className="m-0 whitespace-pre-wrap rounded-lg bg-[var(--color-paper)] px-3.5 py-3 font-body text-[1rem] leading-relaxed text-[var(--color-ink)]">
                  {draft}
                </p>
                <button
                  type="button"
                  className="aspen-link self-start font-body text-[1rem] font-medium"
                  onClick={() => {
                    focusDetails.current = true;
                    setEditing(true);
                  }}
                >
                  Change the question
                </button>
              </div>
            ) : (
              <>
                {started ? (
                  <label htmlFor="aspen-draft" className="sr-only">
                    Your question
                  </label>
                ) : (
                  <div className={`${STEP} mb-0`}>
                    <span className={STEP_NUMBER}>{step.draft}</span>
                    <label htmlFor="aspen-draft">Your question</label>{" "}
                    <span className={STEP_NOTE}>{household ? "(edit it if you like)" : "(any benefit, any state)"}</span>
                  </div>
                )}
                <textarea
                  ref={draftBox}
                  id="aspen-draft"
                  rows={started ? 2 : 4}
                  value={draft}
                  maxLength={2000}
                  autoFocus={started}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
                  }}
                  placeholder={started ? "Ask a follow-up" : "Pick a household above, or type your own question"}
                  className={`${FIELD} resize-none bg-[var(--color-paper)] leading-relaxed`}
                />
              </>
            )}
            <button
              type="button"
              className={`${BUTTON} w-full py-3`}
              disabled={!draft.trim() || sending}
              onClick={() => void send()}
            >
              {sending ? "Asking…" : started ? "Send" : "Ask the AI"}
            </button>
            {!started && (
              <Disclosure lead={DEMO_NOTE} onOpen={() => sendEvent("disclosure", { opened: true }, stage)} />
            )}
          </div>
        )}
      </div>

      {latest?.promptId ? (
        <section ref={ratingBox} aria-label="Your verdict" className="flex scroll-mt-20 flex-col gap-4 lg:sticky lg:top-24">
          {rated.has(latest.promptId) ? (
            // Once rated: one clear next step, and a quieter way to ask again.
            <div className="flex flex-col gap-3">
              <p className="m-0 font-body text-[1.02rem] font-medium text-[var(--color-ink)]">
                <span aria-hidden className="mr-1.5 text-[var(--color-success)]">✓</span>
                Your rating is saved. Thank you.
              </p>
              {onRateOverall && (
                <button type="button" onClick={onRateOverall} className={`${BUTTON_QUIET} w-full justify-between py-3 text-left text-[1rem]`}>
                  Next: two more, about your agency
                  <span aria-hidden className="text-[var(--color-accent)]">↓</span>
                </button>
              )}
              {/* On a phone the chat's own "New question" link is far above; this one sits where the thumb is. */}
              <button
                type="button"
                onClick={() => {
                  startOver();
                  chatCard.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                }}
                className={`${BUTTON_QUIET} w-full justify-between py-3 text-left text-[1rem]`}
              >
                Start over
                <span aria-hidden className="text-[var(--color-accent)]">↑</span>
              </button>
            </div>
          ) : (
            <RatingCard
              key={latest.promptId}
              promptId={latest.promptId}
              onRated={() => setRated((s) => new Set(s).add(latest.promptId as string))}
            />
          )}
        </section>
      ) : (
        <aside aria-label="How it works" className="hidden rounded-xl border border-dashed border-[var(--color-rule)] p-5 lg:sticky lg:top-24 lg:block">
          <span className="mb-3 block font-body font-medium text-[0.82rem] text-[var(--color-accent)]">
            How it works
          </span>
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 font-body text-[0.9rem] leading-snug text-[var(--color-ink-secondary)]">
            <li>Pick a household, or write your own question, and ask.</li>
            <li>Rate the answer you get.</li>
            <li>Then answer two more, about your agency, right below.</li>
          </ol>
        </aside>
      )}
    </div>
  );
}
