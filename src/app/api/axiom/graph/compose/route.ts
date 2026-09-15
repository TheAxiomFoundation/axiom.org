import { NextResponse } from "next/server";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";

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
  const { status, body } = await runtimeProxyGet(
    `/graph/compose?focus=${encodeURIComponent(focus)}`,
    { fresh: true },
  );
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": status === 200 ? "public, max-age=300" : "no-store",
    },
  });
}
