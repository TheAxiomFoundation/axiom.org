import { apiAccess, json, readBody } from "@/lib/aspen/http";
import { isRateLimited } from "@/lib/aspen/limit";
import { askRules } from "@/lib/aspen/rules";
import { getStore, safely } from "@/lib/aspen/store";
import { cleanMessages, isUuid } from "@/lib/aspen/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * "Check against the rules": runs the participant's question through the
 * gallery chatbot's rules-backed route and saves what the rules said next
 * to the chatbot's answer.
 */
export async function POST(request: Request) {
  const { denied } = await apiAccess("participant");
  if (denied) return denied;
  const body = await readBody(request);
  const participantId = body?.participantId;
  const promptId = body?.promptId;
  const messages = cleanMessages(body?.messages);
  if (!isUuid(participantId) || !isUuid(promptId) || !messages) {
    return json({ error: "Missing or invalid question." }, 400);
  }
  if (isRateLimited(`rules:${participantId}`, 12, 10 * 60_000)) {
    return json({ error: "Wait a few minutes before checking again." }, 429);
  }

  const store = getStore();
  if (store) {
    await safely("rules start", () =>
      store.updatePrompt(promptId, participantId, { rules_requested_at: new Date().toISOString() }),
    );
  }
  const started = Date.now();
  try {
    const rules = await askRules(messages, { signal: AbortSignal.timeout(200_000) });
    const latencyMs = Date.now() - started;
    if (store) {
      await safely("rules save", () =>
        store.updatePrompt(promptId, participantId, {
          rules_answer: rules.text,
          rules_program: rules.program,
          rules_period: rules.period,
          rules_amount: rules.amount,
          rules_outputs: rules.computations,
          rules_latency_ms: latencyMs,
          rules_error: rules.errors.length ? rules.errors.join("; ").slice(0, 500) : null,
        }),
      );
    }
    return json({ ...rules, latencyMs });
  } catch (error) {
    console.error("[aspen] rules failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    if (store) {
      await safely("rules error save", () =>
        store.updatePrompt(promptId, participantId, {
          rules_error: message.slice(0, 500),
          rules_latency_ms: Date.now() - started,
        }),
      );
    }
    return json({ error: "The rules check didn't finish. Try again in a moment." }, 502);
  }
}
