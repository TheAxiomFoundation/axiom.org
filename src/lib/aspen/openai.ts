import type { ChatMessage } from "./validate";

/**
 * The "ChatGPT window": OpenAI's Responses API with web search on and no
 * system prompt beyond today's date, which is as close as the API gets
 * to what a resident sees in free ChatGPT. Model and reasoning effort are
 * env-configurable so they can track what ChatGPT serves on the day.
 *
 * Without OPENAI_API_KEY on this project the window falls back to the
 * gallery chatbot's plain-model endpoint (same OpenAI model, no web
 * search, its own short system prompt), and every saved answer records
 * which backend produced it.
 */

export interface ChatSource {
  url: string;
  title?: string;
}

export interface ChatResult {
  text: string;
  sources: ChatSource[];
  backend: "openai" | "finbot-raw";
  model: string;
  webSearch: boolean;
}

export interface StreamHandlers {
  onDelta(text: string): void;
  onStatus?(status: string): void;
}

export const DEFAULT_CHAT_MODEL = "gpt-5.5";

export function chatConfig() {
  const effort = process.env.ASPEN_CHAT_REASONING?.trim() || "low";
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || null,
    model: process.env.ASPEN_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL,
    reasoning: effort === "none" ? null : effort,
    webSearch: process.env.ASPEN_CHAT_WEB_SEARCH !== "off",
  };
}

export function finbotBase(): string {
  return (
    process.env.ASPEN_FINBOT_URL?.trim() || "https://finbot-snap-demo.vercel.app/gallery/chatbot"
  ).replace(/\/+$/, "");
}

/** "Current date: Monday, October 26, 2026." in Phoenix time. */
export function dateInstruction(now: Date = new Date()): string {
  const day = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Phoenix",
  });
  return `Current date: ${day}.`;
}

/** Splits a server-sent-event buffer into parsed JSON payloads and the unfinished tail. */
export function parseSse(buffer: string): { events: Record<string, unknown>[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data) as Record<string, unknown>);
    } catch {
      // A malformed event is skipped, not fatal.
    }
  }
  return { events, rest };
}

function addSource(sources: ChatSource[], annotation: unknown) {
  if (typeof annotation !== "object" || annotation === null) return;
  const { type, url, title } = annotation as Record<string, unknown>;
  if (type !== "url_citation" || typeof url !== "string") return;
  if (sources.some((s) => s.url === url)) return;
  sources.push(typeof title === "string" ? { url, title } : { url });
}

/** Sources cited in a completed response's message content. */
export function sourcesFromResponse(response: unknown): ChatSource[] {
  const sources: ChatSource[] = [];
  const output = (response as { output?: unknown })?.output;
  if (!Array.isArray(output)) return sources;
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const annotations = (part as { annotations?: unknown })?.annotations;
      if (Array.isArray(annotations)) annotations.forEach((a) => addSource(sources, a));
    }
  }
  return sources;
}

/**
 * Applies one Responses API stream event. Returns the error message for
 * a failed response, otherwise null.
 */
export function applyOpenAIEvent(
  event: Record<string, unknown>,
  state: { text: string; sources: ChatSource[]; model?: string },
  handlers: StreamHandlers,
): string | null {
  const type = event.type;
  if (type === "response.output_text.delta" && typeof event.delta === "string") {
    state.text += event.delta;
    handlers.onDelta(event.delta);
  } else if (type === "response.web_search_call.searching" || type === "response.web_search_call.in_progress") {
    handlers.onStatus?.("Searching the web");
  } else if (type === "response.output_text.annotation.added") {
    addSource(state.sources, event.annotation);
  } else if (type === "response.completed") {
    const response = event.response as { model?: unknown } | undefined;
    if (typeof response?.model === "string") state.model = response.model;
    for (const source of sourcesFromResponse(response)) addSource(state.sources, { type: "url_citation", ...source });
  } else if (type === "response.failed" || type === "response.incomplete") {
    const response = event.response as { error?: { message?: string }; incomplete_details?: { reason?: string } } | undefined;
    return response?.error?.message ?? response?.incomplete_details?.reason ?? String(type);
  } else if (type === "error") {
    return typeof event.message === "string" ? event.message : "OpenAI stream error";
  }
  return null;
}

export async function streamOpenAI(
  messages: ChatMessage[],
  handlers: StreamHandlers,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ChatResult> {
  const config = chatConfig();
  if (!config.apiKey) throw new Error("OPENAI_API_KEY is not set");
  const body: Record<string, unknown> = {
    model: config.model,
    instructions: dateInstruction(),
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    store: false,
  };
  if (config.webSearch) body.tools = [{ type: "web_search" }];
  if (config.reasoning) body.reasoning = { effort: config.reasoning };

  const response = await (options.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 300)}`);
  }

  const state: { text: string; sources: ChatSource[]; model?: string } = { text: "", sources: [] };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      const failure = applyOpenAIEvent(event, state, handlers);
      if (failure) throw new Error(failure);
    }
  }
  for (const event of parseSse(`${buffer}\n\n`).events) {
    const failure = applyOpenAIEvent(event, state, handlers);
    if (failure) throw new Error(failure);
  }
  return {
    text: state.text,
    sources: state.sources,
    backend: "openai",
    model: state.model ?? config.model,
    webSearch: config.webSearch,
  };
}

/** The gallery chatbot's plain-model endpoint: one JSON answer, no streaming. */
export async function askFinbotRaw(
  messages: ChatMessage[],
  handlers: StreamHandlers,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ChatResult> {
  const response = await (options.fetchImpl ?? fetch)(`${finbotBase()}/api/raw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: options.signal,
  });
  const payload = (await response.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
  if (!response.ok || typeof payload.text !== "string") {
    throw new Error(typeof payload.error === "string" ? payload.error : `chatbot ${response.status}`);
  }
  handlers.onDelta(payload.text);
  return {
    text: payload.text,
    sources: [],
    backend: "finbot-raw",
    model: `${chatConfig().model} (gallery chatbot, plain)`,
    webSearch: false,
  };
}

/** OpenAI when this project has a key, the gallery chatbot otherwise. */
export function askChatbot(
  messages: ChatMessage[],
  handlers: StreamHandlers,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ChatResult> {
  return chatConfig().apiKey
    ? streamOpenAI(messages, handlers, options)
    : askFinbotRaw(messages, handlers, options);
}
