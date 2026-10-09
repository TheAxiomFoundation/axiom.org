import {
  DISCUSSION_QUESTIONS,
  DISCUSSION_TOPICS,
  QUESTION_IDS,
  RATING_SCALES,
  ROLES,
  SOURCE_OF_TRUTH,
  TWIST_IDS,
  USE_CASES,
  isPerspectiveId,
  isStageId,
  isUsState,
} from "@/lib/aspen/content";
import { apiAccess, json, readBody } from "@/lib/aspen/http";
import { isRateLimited } from "@/lib/aspen/limit";
import { getStore, readControl, safely } from "@/lib/aspen/store";
import { cleanChoice, cleanChoices, clipText, isUuid } from "@/lib/aspen/validate";

export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

/** Whole 1–5 scores for the scale's own categories; everything else is dropped. */
function cleanRatings(
  value: unknown,
  scale: { categories: readonly { id: string }[] } | undefined,
): Record<string, number> {
  if (!scale || !value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean: Record<string, number> = {};
  for (const { id } of scale.categories) {
    const score = (value as Record<string, unknown>)[id];
    if (typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 5) clean[id] = score;
  }
  return clean;
}

/** Each kind keeps only the fields it is allowed to carry. */
const CLEANERS: Record<string, (raw: Payload) => Payload | null> = {
  profile: (raw) => ({
    perspective: isPerspectiveId(raw.perspective) ? raw.perspective : null,
    state: isUsState(raw.state) ? raw.state : null,
    role: cleanChoice(raw.role, ROLES),
  }),
  stage_view: (raw) => (isStageId(raw.stage) ? { stage: raw.stage, followed: raw.followed === true } : null),
  chip: (raw) => ({
    perspective: isPerspectiveId(raw.perspective) ? raw.perspective : null,
    householdId: typeof raw.householdId === "string" ? raw.householdId.slice(0, 40) : null,
    questionId: cleanChoice(raw.questionId, QUESTION_IDS),
    twists: cleanChoices(raw.twists, TWIST_IDS),
  }),
  discussion: (raw) => {
    const question = cleanChoice(raw.question, DISCUSSION_QUESTIONS.map((q) => q.id));
    const topics = cleanChoices(raw.topics, DISCUSSION_TOPICS);
    const ratings = cleanRatings(raw.ratings, question ? RATING_SCALES[question] : undefined);
    const note = clipText(raw.note, 1000);
    return topics.length || note || Object.keys(ratings).length ? { question, topics, ratings, note } : null;
  },
  breakout: (raw) => {
    const useCase = cleanChoice(raw.useCase, USE_CASES.map((u) => u.id));
    const note = clipText(raw.note, 2000);
    return useCase || note ? { useCase, note } : null;
  },
  disclosure: (raw) => ({ opened: raw.opened === true }),
  survey: (raw) => {
    if (raw.question !== SOURCE_OF_TRUTH.id) return null;
    const answer = cleanChoice(raw.answer, SOURCE_OF_TRUTH.options.map((o) => o.id));
    return answer ? { question: SOURCE_OF_TRUTH.id, answer } : null;
  },
};

/** Everything else a participant does: profile, stage views, chip taps, discussion and breakout notes. */
export async function POST(request: Request) {
  const { denied } = await apiAccess("participant");
  if (denied) return denied;
  const body = await readBody(request);
  const participantId = body?.participantId;
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const clean = CLEANERS[kind];
  if (!isUuid(participantId) || !clean) return json({ error: "Unknown event." }, 400);
  if (isRateLimited(`event:${participantId}`, 200, 10 * 60_000)) {
    return json({ error: "Too many events." }, 429);
  }
  const raw = (body?.payload && typeof body.payload === "object" ? body.payload : {}) as Payload;
  const payload = clean(raw);
  if (!payload) return json({ error: "Nothing to save." }, 400);

  const store = getStore();
  if (!store) return json({ ok: true, saved: false });
  const control = await readControl(store);
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;

  if (kind === "profile") {
    await safely("participant upsert", () =>
      store.upsertParticipant({
        id: participantId,
        run_id: control.runId,
        perspective: payload.perspective as string | null,
        state: payload.state as string | null,
        role: payload.role as string | null,
        user_agent: userAgent,
      }),
    );
  } else {
    await safely("participant touch", () =>
      store.upsertParticipant({ id: participantId, run_id: control.runId }),
    );
  }
  const saved = await safely("event insert", () =>
    store.insertEvent({
      run_id: control.runId,
      participant_id: participantId,
      kind,
      stage: isStageId(body?.stage) ? body.stage : control.stage,
      payload,
    }),
  );
  return json({ ok: true, saved: saved !== null });
}
