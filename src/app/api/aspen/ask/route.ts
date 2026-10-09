import {
  QUESTION_IDS,
  TWIST_IDS,
  findHousehold,
  isPerspectiveId,
  isStageId,
} from "@/lib/aspen/content";
import { apiAccess, json, readBody } from "@/lib/aspen/http";
import { clientIp, isRateLimited } from "@/lib/aspen/limit";
import { askChatbot } from "@/lib/aspen/openai";
import { getStore, readControl, safely } from "@/lib/aspen/store";
import {
  MAX_PROMPT_CHARS,
  MAX_TURNS,
  cleanChoice,
  cleanChoices,
  cleanMessages,
  clipText,
  isUuid,
} from "@/lib/aspen/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TEN_MINUTES = 10 * 60_000;

/**
 * Sends a participant's conversation to the chatbot and streams the
 * answer back as NDJSON lines: meta (the saved prompt id), status,
 * delta, then done or error. The prompt row is written before the model
 * is called, so a failed answer is still on record.
 */
export async function POST(request: Request) {
  const { denied } = await apiAccess("participant");
  if (denied) return denied;
  const body = await readBody(request);
  const participantId = body?.participantId;
  const conversationId = body?.conversationId;
  const turn = body?.turn;
  const messages = cleanMessages(body?.messages);
  if (!isUuid(participantId) || !isUuid(conversationId) || !messages) {
    return json({ error: "Missing or invalid question." }, 400);
  }
  if (typeof turn !== "number" || !Number.isInteger(turn) || turn < 0 || turn >= MAX_TURNS) {
    return json({ error: "That conversation is long enough. Start a new one." }, 400);
  }
  if (
    isRateLimited(`ask:${participantId}`, 20, TEN_MINUTES) ||
    isRateLimited(`ask-ip:${clientIp(request)}`, 120, TEN_MINUTES)
  ) {
    return json({ error: "That's a lot of questions. Wait a few minutes." }, 429);
  }

  const meta = (body?.meta ?? {}) as Record<string, unknown>;
  const household = findHousehold(typeof meta.householdId === "string" ? meta.householdId : null);
  const promptTemplate = clipText(meta.promptTemplate, MAX_PROMPT_CHARS);
  const prompt = messages[messages.length - 1].content;

  const store = getStore();
  const control = await readControl(store);
  const promptId = crypto.randomUUID();
  if (store) {
    await safely("participant touch", () =>
      store.upsertParticipant({ id: participantId, run_id: control.runId }),
    );
    await safely("prompt insert", () =>
      store.insertPrompt({
        id: promptId,
        run_id: control.runId,
        participant_id: participantId,
        conversation_id: conversationId,
        turn,
        stage: isStageId(meta.stage) ? meta.stage : null,
        perspective: isPerspectiveId(meta.perspective) ? meta.perspective : null,
        household_id: household?.id ?? null,
        question_id: cleanChoice(meta.questionId, QUESTION_IDS),
        twists: household ? cleanChoices(meta.twists, TWIST_IDS) : [],
        prompt_template: promptTemplate,
        prompt,
        edited: promptTemplate ? promptTemplate !== prompt : null,
      }),
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      send({ type: "meta", promptId, runId: control.runId });
      const started = Date.now();
      try {
        const result = await askChatbot(
          messages,
          {
            onDelta: (text) => send({ type: "delta", text }),
            onStatus: (text) => send({ type: "status", text }),
          },
          { signal: AbortSignal.timeout(240_000) },
        );
        const latencyMs = Date.now() - started;
        if (store) {
          await safely("answer save", () =>
            store.updatePrompt(promptId, participantId, {
              answer: result.text,
              answer_sources: result.sources,
              backend: result.backend,
              model: result.model,
              web_search: result.webSearch,
              latency_ms: latencyMs,
            }),
          );
        }
        send({
          type: "done",
          model: result.model,
          backend: result.backend,
          webSearch: result.webSearch,
          sources: result.sources,
          latencyMs,
        });
      } catch (error) {
        console.error("[aspen] ask failed:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (store) {
          await safely("answer error save", () =>
            store.updatePrompt(promptId, participantId, {
              error: message.slice(0, 500),
              latency_ms: Date.now() - started,
            }),
          );
        }
        send({ type: "error", message: "The chatbot didn't answer. Try again in a moment." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
