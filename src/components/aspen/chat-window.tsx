"use client";

import { useEffect, useRef, useState } from "react";
import {
  HOUSEHOLDS,
  PERSPECTIVES,
  QUESTIONS,
  TWIST_IDS,
  composePrompt,
  findHousehold,
  isPerspectiveId,
  twistsFor,
  type PerspectiveId,
  type QuestionId,
} from "@/lib/aspen/content";
import type { ChatSource } from "@/lib/aspen/openai";
import { AnswerText } from "./answer-text";
import { RatingCard, RulesCheck } from "./answer-feedback";
import { newId, participantId, readStored, sendEvent, writeStored } from "./client";
import { Disclosure } from "./disclosure";
import { BUTTON, Chip, FIELD } from "./ui";

/**
 * The hands-on segment: pick a perspective and a household, send the
 * composed (and editable) question to the chatbot, rate the answer,
 * and, once the presenter reaches "The fix", check it against the rules.
 */

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
export const CHAT_KEY = "aspen.chat.v1";

export interface SavedChat {
  perspective: PerspectiveId;
  householdId: string | null;
  questionId: QuestionId;
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
  perspective: initialPerspective,
  stage,
  rulesUnlocked,
  onPerspective,
  onRateOverall,
}: {
  perspective: string | null;
  stage: string;
  rulesUnlocked: boolean;
  onPerspective?: (id: PerspectiveId) => void;
  /** Opens the "Rate it" stage once the answer is rated. */
  onRateOverall?: () => void;
}) {
  const startPerspective: PerspectiveId = isPerspectiveId(initialPerspective) ? initialPerspective : "resident";
  const [perspective, setPerspective] = useState<PerspectiveId>(startPerspective);
  // Nothing is picked until the participant picks: a default would skew "Households picked".
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [questionId, setQuestionId] = useState<QuestionId>("amount");
  const [twists, setTwists] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => newId());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [rated, setRated] = useState<Set<string>>(new Set());
  // After the first answer the follow-up box stays closed, so rating comes next.
  const [followUp, setFollowUp] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const draftBox = useRef<HTMLTextAreaElement>(null);
  // False until the saved conversation is read, so the first render never overwrites it.
  const [hydrated, setHydrated] = useState(false);

  // A phone that reloads (or a browser that drops the tab) keeps its conversation.
  useEffect(() => {
    const saved = readStored<SavedChat>(CHAT_KEY);
    if (saved && Array.isArray(saved.turns)) {
      setPerspective(isPerspectiveId(saved.perspective) ? saved.perspective : "resident");
      setHouseholdId(saved.householdId ?? null);
      setQuestionId(saved.questionId);
      setTwists(Array.isArray(saved.twists) ? saved.twists.filter((t) => TWIST_IDS.includes(t)) : []);
      setDraft(saved.draft ?? "");
      setTemplate(saved.template ?? null);
      setConversationId(saved.conversationId);
      setTurns(
        saved.turns.map((t) =>
          t.status === "streaming" ? { ...t, status: "error", content: "Interrupted. Ask again." } : t,
        ),
      );
      setRated(new Set(saved.rated ?? []));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStored(CHAT_KEY, {
      perspective,
      householdId,
      questionId,
      twists,
      draft,
      template,
      conversationId,
      turns: turns.filter((t) => t.status !== "streaming"),
      rated: [...rated],
    } satisfies SavedChat);
  }, [hydrated, perspective, householdId, questionId, twists, draft, template, conversationId, turns, rated]);

  // A perspective picked on the welcome screen arrives after first render.
  useEffect(() => {
    if (hydrated && isPerspectiveId(initialPerspective) && initialPerspective !== perspective && turns.length === 0) {
      choose(initialPerspective, householdId, questionId, twists);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, initialPerspective]);

  // The question box grows to show the whole question, so nobody scrolls inside it on a phone.
  useEffect(() => {
    const el = draftBox.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft]);

  const started = turns.length > 0;
  const household = findHousehold(householdId);

  function choose(p: PerspectiveId, h: string | null, q: QuestionId, t: string[]) {
    const found = findHousehold(h);
    // Details that do not fit the new household drop away.
    const fitting = found ? t.filter((id) => twistsFor(found).some((tw) => tw.id === id)) : t;
    setPerspective(p);
    setHouseholdId(h);
    setQuestionId(q);
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
    const q = next.q ?? questionId;
    const t = next.twist
      ? twists.includes(next.twist)
        ? twists.filter((id) => id !== next.twist)
        : [...twists, next.twist]
      : twists;
    choose(p, h, q, t);
    if (next.p) onPerspective?.(next.p);
    sendEvent("chip", { perspective: p, householdId: h, questionId: q, twists: t }, stage);
  }

  function startOver() {
    setFollowUp(false);
    setTurns([]);
    setConversationId(newId());
    choose(perspective, householdId, questionId, twists);
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    const history = turns
      .filter((t) => t.status !== "error" && t.status !== "streaming")
      .map((t) => ({ role: t.role, content: t.content }));
    const messages = [...history, { role: "user" as const, content: text }];
    const turnIndex = turns.filter((t) => t.role === "user").length;
    const userKey = newId();
    const answerKey = newId();
    setTurns((prev) => [
      ...prev,
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
            questionId: turnIndex === 0 && householdId !== OWN ? questionId : null,
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

  const tile = (selected: boolean) =>
    `flex flex-col items-start justify-start rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${
      selected
        ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
        : "border-[var(--color-rule)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]"
    }`;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-8">
      <div className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] shadow-[0_1px_3px_rgba(28,25,23,0.05)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-rule)] px-4 py-3">
          <span className="font-body text-[0.85rem] text-[var(--color-ink-secondary)]">
            {started ? "Your conversation" : "Ask as"}
          </span>
          {started ? (
            <button type="button" className="aspen-link font-body text-[0.85rem]" onClick={startOver}>
              New question
            </button>
          ) : (
            <div role="group" aria-label="Ask as" className="inline-flex rounded-full border border-[var(--color-rule)] bg-[var(--color-paper)] p-0.5">
              {PERSPECTIVES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={p.label}
                  aria-pressed={perspective === p.id}
                  onClick={() => pick({ p: p.id })}
                  className={`rounded-full px-3 py-1 font-body text-[0.8rem] transition-colors ${
                    perspective === p.id ? "bg-[var(--color-ink)] text-white" : "text-[var(--color-ink-secondary)]"
                  }`}
                >
                  {p.short}
                </button>
              ))}
            </div>
          )}
        </div>

        {!started && (
          <div className="flex flex-col gap-4 px-4 pt-4">
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 font-body text-[0.85rem] text-[var(--color-ink-secondary)]">
                Pick a household
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {HOUSEHOLDS.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    aria-pressed={householdId === h.id}
                    onClick={() => pick({ h: h.id })}
                    className={tile(householdId === h.id)}
                  >
                    <span className="block font-body text-[0.88rem] font-medium leading-snug text-[var(--color-ink)]">
                      {h.label}
                    </span>
                    <span className="block font-body text-[0.75rem] text-[var(--color-ink-muted)]">{h.state}</span>
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={householdId === OWN}
                  onClick={() => pick({ h: OWN })}
                  className={`${tile(householdId === OWN)} col-span-2 border-dashed sm:col-span-3`}
                >
                  <span className="block font-body text-[0.88rem] font-medium text-[var(--color-ink)]">
                    Your own question
                  </span>
                  <span className="block font-body text-[0.75rem] text-[var(--color-ink-muted)]">Any benefit, any state</span>
                </button>
              </div>
            </fieldset>
            {household && (
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-2 font-body text-[0.85rem] text-[var(--color-ink-secondary)]">
                  Add details <span className="text-[var(--color-ink-muted)]">(optional)</span>
                </legend>
                <div role="group" aria-label="Details" className="flex flex-wrap gap-1.5">
                  {twistsFor(household).map((t) => (
                    <Chip
                      key={t.id}
                      selected={twists.includes(t.id)}
                      onClick={() => pick({ twist: t.id })}
                      className="px-3 py-1 text-[0.82rem]"
                    >
                      {twists.includes(t.id) ? "✓ " : "+ "}
                      {t.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            )}
            {household && (
              <div role="group" aria-label="Question" className="flex flex-wrap gap-2">
                {QUESTIONS.map((q) => (
                  <Chip key={q.id} selected={questionId === q.id} onClick={() => pick({ q: q.id })}>
                    {q.label}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}

        {started && (
          <div className="flex flex-col gap-4 px-4 py-4" aria-live="polite">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <div
                  key={turn.key}
                  className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--color-ink)] px-4 py-2.5 font-body text-[0.92rem] leading-relaxed text-white"
                >
                  {turn.content}
                </div>
              ) : (
                <div key={turn.key} className="flex flex-col gap-3">
                  {turn.status === "error" ? (
                    <p className="m-0 font-body text-[0.92rem] text-[var(--color-error)]">{turn.content}</p>
                  ) : (
                    <>
                      {turn.content ? (
                        <AnswerText
                          text={turn.content}
                          className="flex flex-col gap-2.5 font-body text-[0.95rem] leading-relaxed text-[var(--color-ink)]"
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
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="max-w-full truncate rounded-full border border-[var(--color-rule)] px-2.5 py-0.5 font-body text-[0.75rem] text-[var(--color-ink-secondary)] no-underline hover:border-[var(--color-accent)]"
                                >
                                  {s.title || hostname(s.url)}
                                </a>
                              ))}
                            </div>
                          )}
                          <span className="font-mono text-[0.64rem] text-[var(--color-ink-muted)]">
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
          <div className="border-t border-[var(--color-rule)] px-4 py-3">
            <button
              type="button"
              className="aspen-link font-body text-[0.88rem]"
              disabled={sending}
              onClick={() => setFollowUp(true)}
            >
              Ask a follow-up
            </button>
          </div>
        ) : (
          <div className={`flex flex-col gap-3 px-4 pb-4 ${started ? "border-t border-[var(--color-rule)] pt-3" : "pt-4"}`}>
            <label htmlFor="aspen-draft" className="sr-only">
              Your question
            </label>
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
            <button
              type="button"
              className={`${BUTTON} w-full py-3`}
              disabled={!draft.trim() || sending}
              onClick={send}
            >
              {sending ? "Asking…" : started ? "Send" : "Ask the AI"}
            </button>
            {!started && (
              <Disclosure
                lead="Your question goes to OpenAI's GPT model, the one behind ChatGPT."
                onOpen={() => sendEvent("disclosure", { opened: true }, stage)}
              />
            )}
          </div>
        )}
      </div>

      {latest?.promptId ? (
        <section aria-label="Your verdict" className="flex flex-col gap-4 lg:sticky lg:top-24">
          {rated.has(latest.promptId) ? (
            <p className="m-0 font-body text-[0.92rem] text-[var(--color-success)]">Your rating is saved. Thank you.</p>
          ) : (
            <RatingCard
              key={latest.promptId}
              promptId={latest.promptId}
              onRated={() => setRated((s) => new Set(s).add(latest.promptId as string))}
            />
          )}
          {rated.has(latest.promptId) && onRateOverall && (
            <button
              type="button"
              onClick={onRateOverall}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent-light)] px-4 py-3 text-left font-body text-[0.95rem] text-[var(--color-ink)]"
            >
              Next: rate how AI did overall
              <span aria-hidden className="text-[var(--color-accent)]">→</span>
            </button>
          )}
          {(rated.has(latest.promptId) || rulesUnlocked) && (
            <RulesCheck
              key={`rules-${latest.promptId}`}
              promptId={latest.promptId}
              messages={latest.messages}
              unlocked={rulesUnlocked}
            />
          )}
        </section>
      ) : (
        <aside aria-label="How it works" className="hidden rounded-xl border border-dashed border-[var(--color-rule)] p-5 lg:sticky lg:top-24 lg:block">
          <span className="mb-3 block font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            How it works
          </span>
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 font-body text-[0.9rem] leading-snug text-[var(--color-ink-secondary)]">
            <li>Pick a household, add details if you like, and ask.</li>
            <li>Rate the answer you get.</li>
            <li>Then rate how AI did overall, in Rate it.</li>
            <li>Later tonight, check the answer against the encoded rules.</li>
          </ol>
        </aside>
      )}
    </div>
  );
}
