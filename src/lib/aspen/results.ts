import {
  RATING_SCALES,
  RESIDENT_ACTIONS,
  SOURCE_OF_TRUTH,
  TWISTS,
  DISCUSSION_QUESTIONS,
  DISCUSSION_TOPICS,
  HOUSEHOLDS,
  PERSPECTIVES,
  POST_CHECK,
  USE_CASES,
  VERDICTS,
  WENT_WELL,
  WENT_WRONG,
  WOULD_ACT,
} from "./content";
import type { PromptRow, RunData } from "./types";

/**
 * The room's results, as the reveal and the presenter screen show them.
 * Aggregates only: no participant ids, and pledges contribute states
 * (when the person allowed it) and counts, never names or emails.
 */

export interface Count {
  id: string;
  label: string;
  count: number;
}

export interface FeedItem {
  id: string;
  perspective: string | null;
  household: string | null;
  prompt: string;
  answer: string | null;
  verdict: string | null;
  rulesAmount: number | null;
  rulesProgram: string | null;
  postCheck: string | null;
  createdAt: string | null;
}

/** Could residents act on the answers? Counts over rated answers. */
export interface Viability {
  rated: number;
  right: number;
  unsure: number;
  wrong: number;
  wouldAct: number;
  maybe: number;
  wouldNot: number;
  /** Looked wrong or unsure, yet the person would (or might) act on it: the risky ones. */
  convincing: number;
  /** What people think a resident would do next with the answer. */
  residentActions: Count[];
  /** Answers that would lead a resident not to apply. */
  wouldNotApply: number;
  /** Of those, the ones whose household qualifies under the encoded rules (checked, amount above $0). */
  wouldNotApplyEligible: number;
}

/** How answers held up for one household, added detail, or perspective. */
export interface BreakdownRow {
  id: string;
  kind: "household" | "detail" | "perspective";
  label: string;
  asked: number;
  rated: number;
  wrong: number;
  unsure: number;
}

/** An answer worth talking about, with what the person said about it. */
export interface Spotlight extends FeedItem {
  reason: "convincing" | "checked-wrong" | "wrong" | "unsure";
  wouldAct: string | null;
  wentWrong: string[];
  note: string | null;
  details: string[];
}

export interface ScaleSummary {
  question: string;
  label: string;
  low: string;
  high: string;
  categories: { id: string; label: string; average: number | null; count: number }[];
}

/** Averages each scale category over the discussion events that rated it. */
export function summarizeScales(events: { payload: Record<string, unknown> }[]): ScaleSummary[] {
  return DISCUSSION_QUESTIONS.flatMap((q) => {
    const scale = RATING_SCALES[q.id];
    if (!scale) return [];
    const rated = events.filter((e) => e.payload.question === q.id);
    return [
      {
        question: q.id,
        label: scale.title,
        low: scale.low,
        high: scale.high,
        categories: scale.categories.map((c) => {
          const scores = rated
            .map((e) => (e.payload.ratings as Record<string, unknown> | undefined)?.[c.id])
            .filter((v): v is number => typeof v === "number");
          const average = scores.length ? Math.round((10 * scores.reduce((a, b) => a + b, 0)) / scores.length) / 10 : null;
          return { id: c.id, label: c.label, average, count: scores.length };
        }),
      },
    ];
  });
}

export interface RunSummary {
  participants: number;
  prompts: number;
  rated: number;
  checked: number;
  perspectives: Count[];
  households: Count[];
  /** Details people added to their household, most used first. */
  twists: Count[];
  states: Count[];
  verdicts: Count[];
  wouldAct: Count[];
  wentWell: Count[];
  wentWrong: Count[];
  postCheck: Count[];
  feed: FeedItem[];
  viability: Viability;
  breakdown: BreakdownRow[];
  spotlight: Spotlight[];
  /** Before tonight: can anyone check an answer against the state's official rules? (Rate it) */
  sourceOfTruth: Count[];
  /** Notes people wrote when they rated an answer or in Rate it, newest first. */
  voices: { text: string; verdict: string | null }[];
  discussion: {
    questions: Count[];
    topics: Count[];
    notes: { question: string; text: string }[];
    /** The room's average 1–5 score per rated category, by question. */
    scales: ScaleSummary[];
  };
  breakouts: { useCases: Count[]; notes: { useCase: string; text: string }[] };
  pledges: { people: number; states: string[]; accurateAi: number; stateSystems: number };
}

const FEED_SIZE = 24;
const NOTES_SIZE = 40;

/** Markdown to plain text, for excerpts: links keep their text, markers go. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|`)/g, "");
}

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const flat = plainText(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Counts per known option, in the options' order, then any unknown values. */
export function countBy(
  values: (string | null | undefined)[],
  options: readonly { id: string; label: string }[],
): Count[] {
  const tally = new Map<string, number>();
  for (const value of values) {
    if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  const known = options.map((o) => ({ id: o.id, label: o.label, count: tally.get(o.id) ?? 0 }));
  const extra = [...tally.entries()]
    .filter(([id]) => !options.some((o) => o.id === id))
    .map(([id, count]) => ({ id, label: id, count }));
  return [...known, ...extra];
}

/** Counts of free values, most frequent first. */
export function rank(values: (string | null | undefined)[]): Count[] {
  const tally = new Map<string, number>();
  for (const value of values) {
    if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const asOptions = (labels: readonly string[]) => labels.map((label) => ({ id: label, label }));

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function payloadList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const SPOTLIGHT_SIZE = 4;
const VOICES_SIZE = 12;

export function viabilityOf(rated: PromptRow[]): Viability {
  const count = (pred: (p: PromptRow) => boolean) => rated.filter(pred).length;
  const acts = (p: PromptRow) => p.would_act === "yes" || p.would_act === "maybe";
  return {
    rated: rated.length,
    right: count((p) => p.verdict === "right"),
    unsure: count((p) => p.verdict === "unsure"),
    wrong: count((p) => p.verdict === "wrong"),
    wouldAct: count((p) => p.would_act === "yes"),
    maybe: count((p) => p.would_act === "maybe"),
    wouldNot: count((p) => p.would_act === "no"),
    convincing: count((p) => (p.verdict === "wrong" || p.verdict === "unsure") && acts(p)),
    residentActions: countBy(
      rated.map((p) => p.resident_action),
      RESIDENT_ACTIONS,
    ),
    wouldNotApply: count((p) => p.resident_action === "not-apply"),
    wouldNotApplyEligible: count(
      (p) => p.resident_action === "not-apply" && typeof p.rules_amount === "number" && p.rules_amount > 0,
    ),
  };
}

/** Per household, added detail and perspective: how many first questions, and how their answers were judged. */
export function breakdownOf(firstTurns: PromptRow[]): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  const add = (kind: BreakdownRow["kind"], id: string, label: string, group: PromptRow[]) => {
    if (!group.length) return;
    rows.push({
      id,
      kind,
      label,
      asked: group.length,
      rated: group.filter((p) => p.verdict).length,
      wrong: group.filter((p) => p.verdict === "wrong").length,
      unsure: group.filter((p) => p.verdict === "unsure").length,
    });
  };
  for (const h of HOUSEHOLDS) add("household", h.id, h.label, firstTurns.filter((p) => p.household_id === h.id));
  add("household", "own", "Their own question", firstTurns.filter((p) => !p.household_id));
  for (const t of TWISTS) add("detail", t.id, `+ ${t.label}`, firstTurns.filter((p) => p.twists?.includes(t.id)));
  for (const pr of PERSPECTIVES) add("perspective", pr.id, `Asked as ${pr.label.toLowerCase()}`, firstTurns.filter((p) => p.perspective === pr.id));
  const share = (r: BreakdownRow) => (r.rated ? r.wrong / r.rated : -1);
  return rows.sort((a, b) => share(b) - share(a) || b.asked - a.asked);
}

function spotlightReason(p: PromptRow): Spotlight["reason"] | null {
  const acts = p.would_act === "yes" || p.would_act === "maybe";
  if ((p.verdict === "wrong" || p.verdict === "unsure") && acts) return "convincing";
  if (p.post_check_verdict === "wrong") return "checked-wrong";
  if (p.verdict === "wrong") return "wrong";
  if (p.verdict === "unsure") return "unsure";
  return null;
}

const REASON_RANK: Record<Spotlight["reason"], number> = { convincing: 0, "checked-wrong": 1, wrong: 2, unsure: 3 };

export function summarizeRun(data: RunData): RunSummary {
  const { participants, prompts, events, pledges } = data;
  const answered = prompts.filter((p) => p.answer);
  const rated = prompts.filter((p) => p.verdict);
  const checked = prompts.filter((p) => p.rules_program || typeof p.rules_amount === "number");
  // First turns only: follow-ups repeat the household and perspective.
  const firstTurns = prompts.filter((p) => p.turn === 0);

  const discussion = events.filter((e) => e.kind === "discussion");
  const breakouts = events.filter((e) => e.kind === "breakout");

  const householdLabel = new Map(HOUSEHOLDS.map((h) => [h.id, h.label]));
  const perspectiveLabel = new Map<string, string>(PERSPECTIVES.map((p) => [p.id, p.label]));

  const toFeedItem = (p: PromptRow): FeedItem => ({
    id: p.id,
    perspective: p.perspective ? (perspectiveLabel.get(p.perspective) ?? p.perspective) : null,
    household: p.household_id ? (householdLabel.get(p.household_id) ?? null) : null,
    prompt: clip(p.prompt, 280) ?? "",
    answer: clip(p.answer, 360),
    verdict: p.verdict ?? null,
    rulesAmount: p.rules_amount ?? null,
    rulesProgram: p.rules_program ?? null,
    postCheck: p.post_check_verdict ?? null,
    createdAt: p.created_at ?? null,
  });

  const feed: FeedItem[] = [...answered]
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, FEED_SIZE)
    .map(toFeedItem);

  const twistLabel = new Map<string, string>(TWISTS.map((t) => [t.id, t.label]));
  const spotlight: Spotlight[] = answered
    .flatMap((p) => {
      const reason = spotlightReason(p);
      return reason ? [{ p, reason }] : [];
    })
    .sort(
      (a, b) =>
        REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
        Number(Boolean(b.p.rating_note)) - Number(Boolean(a.p.rating_note)) ||
        (b.p.created_at ?? "").localeCompare(a.p.created_at ?? ""),
    )
    .slice(0, SPOTLIGHT_SIZE)
    .map(({ p, reason }) => ({
      ...toFeedItem(p),
      reason,
      wouldAct: p.would_act ?? null,
      wentWrong: p.went_wrong ?? [],
      note: clip(p.rating_note, 240),
      details: (p.twists ?? []).map((id) => twistLabel.get(id) ?? id),
    }));

  // Notes on single answers, and the notes people added in Rate it.
  const voices = [
    ...rated
      .filter((p) => p.rating_note)
      .map((p) => ({ text: clip(p.rating_note, 240) as string, verdict: p.verdict ?? null, at: p.created_at ?? "" })),
    ...discussion
      .filter((e) => e.stage === "rate" && payloadString(e.payload, "note"))
      .map((e) => ({ text: clip(payloadString(e.payload, "note"), 240) as string, verdict: null, at: e.created_at ?? "" })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, VOICES_SIZE)
    .map(({ text, verdict }) => ({ text, verdict }));

  const shownStates = pledges
    .filter((p) => p.show_state && p.state)
    .map((p) => p.state as string);

  return {
    participants: participants.length,
    prompts: answered.length,
    rated: rated.length,
    checked: checked.length,
    // What people asked as, from their first questions (the welcome pick is optional).
    perspectives: countBy(
      firstTurns.map((p) => p.perspective),
      PERSPECTIVES.map((p) => ({ id: p.id, label: p.label })),
    ),
    households: countBy(
      firstTurns.map((p) => p.household_id ?? "own"),
      [...HOUSEHOLDS.map((h) => ({ id: h.id, label: h.label })), { id: "own", label: "Their own question" }],
    ),
    twists: countBy(
      firstTurns.flatMap((p) => p.twists ?? []),
      TWISTS.map((t) => ({ id: t.id, label: t.label })),
    ).sort((a, b) => b.count - a.count),
    states: rank(participants.map((p) => p.state)),
    verdicts: countBy(rated.map((p) => p.verdict), VERDICTS),
    wouldAct: countBy(rated.map((p) => p.would_act), WOULD_ACT),
    wentWell: countBy(rated.flatMap((p) => p.went_well ?? []), asOptions(WENT_WELL)).sort(
      (a, b) => b.count - a.count,
    ),
    wentWrong: countBy(rated.flatMap((p) => p.went_wrong ?? []), asOptions(WENT_WRONG)).sort(
      (a, b) => b.count - a.count,
    ),
    postCheck: countBy(prompts.map((p) => p.post_check_verdict), POST_CHECK),
    feed,
    viability: viabilityOf(rated),
    sourceOfTruth: countBy(
      events.filter((e) => e.kind === "survey" && e.payload.question === SOURCE_OF_TRUTH.id).map((e) => payloadString(e.payload, "answer")),
      SOURCE_OF_TRUTH.options,
    ),
    breakdown: breakdownOf(firstTurns),
    spotlight,
    voices,
    discussion: {
      questions: countBy(
        discussion.map((e) => payloadString(e.payload, "question")),
        DISCUSSION_QUESTIONS,
      ),
      topics: countBy(
        discussion.flatMap((e) => payloadList(e.payload, "topics")),
        asOptions(DISCUSSION_TOPICS),
      ).sort((a, b) => b.count - a.count),
      // Notes from Rate it go to "In their words" (voices), not here.
      notes: discussion
        .filter((e) => e.stage !== "rate")
        .map((e) => ({
          question: payloadString(e.payload, "question") ?? "",
          text: clip(payloadString(e.payload, "note"), 280) ?? "",
        }))
        .filter((n) => n.text)
        .slice(-NOTES_SIZE)
        .reverse(),
      scales: summarizeScales(discussion),
    },
    breakouts: {
      useCases: countBy(
        breakouts.map((e) => payloadString(e.payload, "useCase")),
        USE_CASES.map((u) => ({ id: u.id, label: u.label })),
      ),
      notes: breakouts
        .map((e) => ({
          useCase: payloadString(e.payload, "useCase") ?? "",
          text: clip(payloadString(e.payload, "note"), 400) ?? "",
        }))
        .filter((n) => n.text)
        .slice(-NOTES_SIZE)
        .reverse(),
    },
    pledges: {
      people: pledges.length,
      states: [...new Set(shownStates)].sort(),
      accurateAi: pledges.filter((p) => p.accurate_ai).length,
      stateSystems: pledges.filter((p) => p.state_systems).length,
    },
  };
}

export const EMPTY_SUMMARY: RunSummary = summarizeRun({
  participants: [],
  prompts: [],
  events: [],
  pledges: [],
});
