/**
 * Password gate for axiom.org/aspen, in the same spirit as the audience
 * pages (axiom-audiences): one shared password per page, set as a Vercel
 * env var, and a 30-day cookie holding an HMAC of the password, so
 * changing the password signs everyone out.
 *
 * ASPEN_PASSWORD           participants (the room)
 * ASPEN_PRESENTER_PASSWORD presenters: moves the room between stages and
 *                          starts a new run; also counts as a participant.
 *
 * With no ASPEN_PASSWORD the page is closed ("not open yet").
 */

export const ACCESS_COOKIE = "aspen_access";
export const PRESENTER_COOKIE = "aspen_presenter";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type AccessKind = "participant" | "presenter";

export function participantPassword(): string | null {
  return process.env.ASPEN_PASSWORD?.trim() || null;
}

export function presenterPassword(): string | null {
  return process.env.ASPEN_PRESENTER_PASSWORD?.trim() || null;
}

const encoder = new TextEncoder();

/** Hex HMAC-SHA256 of the kind, keyed by the password. */
export async function accessToken(kind: AccessKind, password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`aspen:${kind}`));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface Access {
  /** A participant password is configured. */
  open: boolean;
  participant: boolean;
  presenter: boolean;
}

async function tokenMatches(
  kind: AccessKind,
  password: string | null,
  cookie: string | undefined,
): Promise<boolean> {
  if (!password || !cookie) return false;
  return safeEqual(cookie, await accessToken(kind, password));
}

/** What a request's cookies grant. */
export async function accessFromCookies(get: (name: string) => string | undefined): Promise<Access> {
  const participantPw = participantPassword();
  const presenter = await tokenMatches("presenter", presenterPassword(), get(PRESENTER_COOKIE));
  const participant =
    presenter || (await tokenMatches("participant", participantPw, get(ACCESS_COOKIE)));
  return { open: participantPw !== null, participant: participantPw !== null && participant, presenter };
}

/** Phones capitalize the first letter, so case never decides a match. */
function sameWord(typed: string, password: string): boolean {
  return safeEqual(typed.toLowerCase(), password.toLowerCase());
}

/** Which kind of access a typed password grants, if any. Case does not matter. */
export function kindForPassword(typed: string): AccessKind | null {
  const presenterPw = presenterPassword();
  const participantPw = participantPassword();
  if (presenterPw && participantPw && sameWord(typed, presenterPw)) return "presenter";
  if (participantPw && sameWord(typed, participantPw)) return "participant";
  return null;
}

/** A `next` path that stays inside /aspen. */
export function safeNext(value: string | null | undefined, fallback = "/aspen"): string {
  if (!value) return fallback;
  const inside = value === "/aspen" || value.startsWith("/aspen/") || value.startsWith("/aspen?");
  return inside ? value : fallback;
}
