import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  COOKIE_MAX_AGE,
  PRESENTER_COOKIE,
  accessToken,
  kindForPassword,
  participantPassword,
  presenterPassword,
} from "@/lib/aspen/auth";
import { json, readBody } from "@/lib/aspen/http";
import { clientIp, isRateLimited } from "@/lib/aspen/limit";

export const dynamic = "force-dynamic";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};

export async function POST(request: Request) {
  if (!participantPassword()) return json({ error: "This page is not open yet." }, 503);
  if (isRateLimited(`sign-in:${clientIp(request)}`, 10, 5 * 60_000)) {
    return json({ error: "Too many tries. Wait a few minutes." }, 429);
  }
  const body = await readBody(request);
  const typed = typeof body?.password === "string" ? body.password.trim() : "";
  const kind = typed ? kindForPassword(typed) : null;
  if (!kind) return json({ error: "That password doesn't match." }, 401);

  const jar = await cookies();
  jar.set(ACCESS_COOKIE, await accessToken("participant", participantPassword() as string), cookieOptions);
  if (kind === "presenter") {
    jar.set(PRESENTER_COOKIE, await accessToken("presenter", presenterPassword() as string), cookieOptions);
  }
  return json({ ok: true, kind });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(PRESENTER_COOKIE);
  return json({ ok: true });
}
