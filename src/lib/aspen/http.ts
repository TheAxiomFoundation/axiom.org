import { cookies } from "next/headers";
import { accessFromCookies, type Access } from "./auth";

/** JSON that no cache keeps: everything under /api/aspen is per-room and live. */
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The request's access, or the 401/403 response to send instead. API
 * routes check the cookie themselves; the pages' gate does not cover them.
 */
export async function apiAccess(
  kind: "participant" | "presenter",
): Promise<{ access: Access; denied: null } | { access: null; denied: Response }> {
  const jar = await cookies();
  const access = await accessFromCookies((name) => jar.get(name)?.value);
  const allowed = kind === "presenter" ? access.presenter : access.participant;
  if (allowed) return { access, denied: null };
  return { access: null, denied: json({ error: "Sign in at /aspen first." }, access.participant ? 403 : 401) };
}

/** The request body as an object, or null. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
