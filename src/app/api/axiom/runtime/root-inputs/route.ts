import { NextResponse } from "next/server";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";

const ROOT_RE = /^[a-z]{2}(?:-[a-z]{2,3})?:[\w./–-]+(?:#[\w-]+)?$/;

/** Input catalog passthrough for the run panel: every dataset slot of
 *  a compile-on-demand subtree with the dtype and screening default
 *  the runtime inferred from the compiled artifact — so controls are
 *  typed by the engine's truth, not by name-shape guessing. */
export async function GET(request: Request) {
  const root = new URL(request.url).searchParams.get("root")?.trim();
  if (!root || !ROOT_RE.test(root)) {
    return NextResponse.json(
      { status: "error", error: { code: "invalid_root" } },
      { status: 400 }
    );
  }
  const { status, body } = await runtimeProxyGet(
    `/runtime/root-inputs?root=${encodeURIComponent(root)}`,
    { timeoutMs: 20_000, fresh: true }
  );
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": status === 200 ? "public, max-age=300" : "no-store" },
  });
}
