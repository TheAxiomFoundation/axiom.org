import { finbotBase } from "./openai";
import type { ChatMessage } from "./validate";

/**
 * "Check against the rules": the same question, sent to the gallery
 * chatbot (axiom.org/gallery/chatbot), which answers by running the
 * encoded rules (rulespec-us through axiom-rules-engine) instead of from
 * memory. Its /api/chat route streams the AI SDK v4 data-stream protocol:
 * one `<code>:<json>` line per part. We keep the prose (code 0), the tool
 * calls (9) and their results (a), and errors (3).
 */

export interface DataStream {
  text: string;
  toolCalls: { toolCallId: string; toolName: string; args: unknown }[];
  toolResults: { toolCallId: string; toolName: string; result: unknown }[];
  errors: string[];
}

export function parseDataStream(body: string): DataStream {
  const stream: DataStream = { text: "", toolCalls: [], toolResults: [], errors: [] };
  const names = new Map<string, string>();
  for (const line of body.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const code = line.slice(0, colon);
    let value: unknown;
    try {
      value = JSON.parse(line.slice(colon + 1));
    } catch {
      continue;
    }
    if (code === "0" && typeof value === "string") {
      stream.text += value;
    } else if (code === "3" && typeof value === "string") {
      stream.errors.push(value);
    } else if (code === "9" && value && typeof value === "object") {
      const { toolCallId, toolName, args } = value as Record<string, unknown>;
      if (typeof toolCallId === "string" && typeof toolName === "string") {
        names.set(toolCallId, toolName);
        stream.toolCalls.push({ toolCallId, toolName, args });
      }
    } else if (code === "a" && value && typeof value === "object") {
      const { toolCallId, result } = value as Record<string, unknown>;
      if (typeof toolCallId === "string") {
        stream.toolResults.push({ toolCallId, toolName: names.get(toolCallId) ?? "unknown", result });
      }
    }
  }
  return stream;
}

export interface RulesOutput {
  name: string;
  label: string;
  value: unknown;
  unit: string | null;
  incomplete: boolean;
  legalId: string | null;
}

export interface RulesComputation {
  program: string;
  displayName: string;
  period: string | null;
  primary: RulesOutput | null;
  outputs: RulesOutput[];
}

export interface RulesAnswer {
  text: string;
  computations: RulesComputation[];
  /** The first computation's primary output, when it is a dollar amount. */
  amount: number | null;
  program: string | null;
  period: string | null;
  /** Outputs the rules release marks as not yet complete. */
  incomplete: string[];
  /** Legal ids of every output the answer used. */
  citations: string[];
  errors: string[];
}

function toOutput(raw: unknown): RulesOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string") return null;
  return {
    name: o.name,
    label: typeof o.label === "string" ? o.label : o.name,
    value: o.value,
    unit: typeof o.unit === "string" ? o.unit : null,
    incomplete: o.acknowledged_incomplete === true,
    legalId: typeof o.legal_id === "string" ? o.legal_id : null,
  };
}

export function summarizeRules(stream: DataStream): RulesAnswer {
  const computations: RulesComputation[] = [];
  const errors = [...stream.errors];
  for (const { toolName, result } of stream.toolResults) {
    if (toolName !== "compute" || !result || typeof result !== "object") continue;
    const r = result as Record<string, unknown>;
    if (typeof r.error === "string") {
      errors.push(r.error);
      continue;
    }
    if (typeof r.program !== "string" || !Array.isArray(r.outputs)) continue;
    const outputs = r.outputs.map(toOutput).filter((o): o is RulesOutput => o !== null);
    computations.push({
      program: r.program,
      displayName: typeof r.display_name === "string" ? r.display_name : r.program,
      period: typeof r.period === "string" ? r.period : null,
      primary: outputs.find((o) => o.name === r.primary_output) ?? outputs[0] ?? null,
      outputs,
    });
  }
  const first = computations[0];
  const amount =
    first?.primary && first.primary.unit === "USD" && typeof first.primary.value === "number"
      ? first.primary.value
      : null;
  const all = computations.flatMap((c) => c.outputs);
  return {
    text: stream.text.trim(),
    computations,
    amount,
    program: first?.displayName ?? null,
    period: first?.period ?? null,
    incomplete: [...new Set(all.filter((o) => o.incomplete).map((o) => o.label))],
    citations: [...new Set(all.map((o) => o.legalId).filter((id): id is string => id !== null))],
    errors,
  };
}

/** Asks the rules chatbot. It sees only the participant's own turns. */
export async function askRules(
  messages: ChatMessage[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<RulesAnswer> {
  const userTurns = messages.filter((m) => m.role === "user");
  const response = await (options.fetchImpl ?? fetch)(`${finbotBase()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: userTurns }),
    signal: options.signal,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`rules chatbot ${response.status}: ${body.slice(0, 200)}`);
  }
  return summarizeRules(parseDataStream(body));
}
