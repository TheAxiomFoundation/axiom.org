/** Input cleaning for the Aspen API routes. Everything a phone sends is untrusted. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_RE.test(value);
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value);
}

/** Trimmed text within a length cap; empty or over-long input is null. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Like cleanText, but over-long input is cut instead of dropped. */
export function clipText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Only the values a list allows, without duplicates. */
export function cleanChoices(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const picked = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && allowed.includes(item)) picked.add(item);
  }
  return [...picked];
}

/** One value from a list, or null. */
export function cleanChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const MAX_PROMPT_CHARS = 2000;
export const MAX_ANSWER_CHARS = 12000;
export const MAX_TURNS = 12;

/**
 * A conversation that alternates freely but ends on the user's turn,
 * capped in turns and length.
 */
export function cleanMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TURNS * 2) {
    return null;
  }
  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { role, content } = item as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return null;
    const cap = role === "user" ? MAX_PROMPT_CHARS : MAX_ANSWER_CHARS;
    const text = clipText(content, cap);
    if (!text) return null;
    messages.push({ role, content: text });
  }
  if (messages[messages.length - 1].role !== "user") return null;
  return messages;
}
