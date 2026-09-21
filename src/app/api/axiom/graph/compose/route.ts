import { NextResponse } from "next/server";
import { cachedCompose } from "@/lib/axiom/runtime/compose-cache";

const FOCUS_RE = /^[a-z]{2}(?:-[a-z]{2,3})?:[\w./–-]+(?:#[\w-]+)?$/;

/** Compose-on-demand passthrough for the in-app graph viewer:
 *  builds a graph from the encodings mirror for law no compiled
 *  package covers. */
export async function GET(request: Request) {
  const focus = new URL(request.url).searchParams.get("focus")?.trim();
  if (!focus || !FOCUS_RE.test(focus)) {
    return NextResponse.json(
      { status: "error", error: { code: "invalid_focus" } },
      { status: 400 },
    );
  }
  const { status, body } = await cachedCompose(focus);
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": status >= 200 && status < 300 ? "public, max-age=300" : "no-store" },
  });
}
